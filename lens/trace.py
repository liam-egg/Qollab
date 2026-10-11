"""Replay the Qiskit transpiler pass by pass and record what each pass did.

The preset pass manager's ``callback`` fires after every pass with the current
DAG and property set. For each call we record the circuit's metrics, its gate
list, a diff against the previous snapshot, and where every logical qubit sits.

Depth is not additive across passes, so the trace never sums depths. It
attributes the *change* between consecutive snapshots to the pass that made
it, and groups those deltas by cause (see ``cause_of``).
"""

from __future__ import annotations

import math
import time
from collections import Counter

import qiskit
from qiskit import QuantumCircuit, qasm2
from qiskit.converters import circuit_to_dag, dag_to_circuit
from qiskit.transpiler import TranspileLayout

from . import targets as targets_mod

SCHEMA_VERSION = 1
DEFAULT_SEED = 11
DEFAULT_OPT_LEVEL = 2

STAGES = ("init", "layout", "routing", "translation", "optimization", "scheduling")

# What *kind* of change a pass makes. Qiskit's stage names don't always say:
# SabreLayout runs in the layout stage but inserts SWAPs, i.e. it routes.
ROUTING_PASSES = {"SabreLayout", "SabreSwap", "StochasticSwap", "LookaheadSwap", "BasicSwap"}
LAYOUT_PASSES = {
    "SetLayout", "TrivialLayout", "DenseLayout", "VF2Layout", "VF2PostLayout",
    "FullAncillaAllocation", "EnlargeWithAncilla", "ApplyLayout", "SabrePreLayout",
}
TRANSLATION_PASSES = {
    "BasisTranslator", "HighLevelSynthesis", "UnitarySynthesis", "Unroll3qOrMore",
    "Decompose", "GateDirection", "UnrollCustomDefinitions",
}
CAUSES = ("translation", "routing", "optimization", "layout")


def cause_of(pass_name: str) -> str:
    if pass_name in ROUTING_PASSES:
        return "routing"
    if pass_name in LAYOUT_PASSES:
        return "layout"
    if pass_name in TRANSLATION_PASSES:
        return "translation"
    return "optimization"


def _walk_tasks(task, out):
    if hasattr(task, "tasks"):
        for sub in task.tasks:
            _walk_tasks(sub, out)
    else:
        out.append(task)


def _stage_map(pm) -> dict[int, str]:
    """Map id(pass instance) -> base stage name ('pre_layout' -> 'layout')."""
    mapping = {}
    for stage in pm.expanded_stages:
        sub = getattr(pm, stage, None)
        if sub is None:
            continue
        base = stage.removeprefix("pre_").removeprefix("post_")
        found = []
        _walk_tasks(sub.to_flow_controller(), found)
        for task in found:
            mapping[id(task)] = base
    return mapping


def _param(p):
    try:
        value = float(p)
    except (TypeError, ValueError):
        return str(p)
    return round(value, 6) if math.isfinite(value) else str(value)


def _gates(dag) -> list[tuple]:
    """(name, qubits, params) for every op, in topological order."""
    out = []
    for node in dag.topological_op_nodes():
        out.append((
            node.op.name,
            tuple(dag.find_bit(q).index for q in node.qargs),
            tuple(_param(p) for p in node.op.params),
        ))
    return out


def _metrics(dag) -> dict:
    circ = dag_to_circuit(dag, copy_operations=False)
    ops = dict(dag.count_ops())
    twoq = sum(1 for inst in circ.data if inst.operation.num_qubits == 2)
    return {
        "depth": circ.depth(),
        "twoq_depth": circ.depth(lambda inst: inst.operation.num_qubits == 2),
        "size": circ.size(),
        "twoq": twoq,
        "swaps": ops.get("swap", 0),
        "ops": ops,
    }


def _chosen_layout(dag, property_set, n_logical: int) -> list[int] | None:
    """Physical qubit picked for each logical wire, before it has been applied."""
    layout = property_set["layout"]
    if layout is None:
        return None
    try:
        return [layout[q] for q in dag.qubits[:n_logical]]
    except KeyError:
        return None


def _layouts(dag, property_set, physical: bool, n_logical: int) -> dict | None:
    """Wire each logical qubit starts and ends on, in the DAG's own numbering."""
    if not physical:
        # Wires are still logical. ElidePermutations may already have dropped
        # SWAPs by renaming outputs: logical qubit v then ends on wire perm[v].
        # Ancillas may already be on the DAG (after a successful VF2Layout);
        # they come after the logical qubits and are left out.
        vpl = property_set["virtual_permutation_layout"]
        if vpl is None:
            return None
        where = vpl.get_virtual_bits()
        return {"initial": list(range(n_logical)),
                "final": [where[q] for q in dag.qubits[:n_logical]]}
    # Between FullAncillaAllocation and EnlargeWithAncilla the layout names
    # ancilla qubits the DAG doesn't have yet; treat that as "not known yet".
    try:
        tl = TranspileLayout.from_property_set(dag, property_set)
        if tl is None:
            return None
        return {
            "initial": tl.initial_index_layout(filter_ancillas=True),
            "final": tl.final_index_layout(filter_ancillas=True),
        }
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def _diff(prev: list[tuple], cur: list[tuple], qubit_map: list[int] | None, allow_moves: bool):
    """Mark each current gate 'keep', 'move' or 'add'; return (statuses, removed).

    Gates are matched by (name, qubits, params) as multisets, so duplicates are
    matched first-come. ``qubit_map`` translates the previous snapshot's qubit
    indices when the numbering changed (applying a layout). With
    ``allow_moves``, leftover gates that match on (name, params) alone count as
    moved: routing shifts every gate after a SWAP onto different qubits.
    """
    if qubit_map is not None:
        prev = [(n, tuple(qubit_map[q] for q in qs), ps) for n, qs, ps in prev]
    pool = Counter(prev)
    statuses = []
    for gate in cur:
        if pool[gate] > 0:
            pool[gate] -= 1
            statuses.append("keep")
        else:
            statuses.append("add")
    removed = list(pool.elements())
    if allow_moves:
        loose = Counter((n, ps) for n, _, ps in removed)
        for idx, (gate, status) in enumerate(zip(cur, statuses)):
            key = (gate[0], gate[2])
            if status == "add" and loose[key] > 0:
                loose[key] -= 1
                statuses[idx] = "move"
        kept_back = []
        for n, qs, ps in removed:
            if loose[(n, ps)] > 0:
                loose[(n, ps)] -= 1
                kept_back.append((n, qs, ps))
        removed = kept_back
    return statuses, removed


def _delta(before: dict, after: dict) -> dict:
    return {k: after[k] - before[k] for k in ("depth", "twoq_depth", "size", "twoq", "swaps")}


def _encode_gates(gates, statuses):
    return [[n, list(qs), list(ps), s] for (n, qs, ps), s in zip(gates, statuses)]


def trace_circuit(
    circuit: QuantumCircuit,
    target_id: str,
    *,
    seed: int = DEFAULT_SEED,
    optimization_level: int = DEFAULT_OPT_LEVEL,
    return_circuit: bool = False,
):
    """Transpile ``circuit`` for ``target_id`` and record every pass.

    Returns the trace dict, or ``(trace, transpiled_circuit, raw)`` when
    ``return_circuit`` is set; ``raw`` keeps per-step circuits and layouts for
    tests.
    """
    n = circuit.num_qubits
    pm = targets_mod.pass_manager(target_id, n, optimization_level, seed)
    stage_of = _stage_map(pm)

    input_dag = circuit_to_dag(circuit)
    first_gates = _gates(input_dag)
    first_metrics = _metrics(input_dag)
    steps = [{
        "i": 0,
        "pass": "Input",
        "stage": "input",
        "cause": "input",
        "time_ms": 0.0,
        "changed": True,
        "num_qubits": n,
        "physical": False,
        "metrics": first_metrics,
        "delta": None,
        "gates": _encode_gates(first_gates, ["keep"] * len(first_gates)),
        "removed": [],
        "layout": None,
    }]
    raw = [{"circuit": circuit.copy(), "layout": None}]
    state = {"gates": first_gates, "metrics": first_metrics, "n": n, "layout": None,
             "physical": False, "chosen": None}

    def callback(**kw):
        pass_, dag, ps = kw["pass_"], kw["dag"], kw["property_set"]
        name = type(pass_).__name__
        gates = _gates(dag)
        # ApplyLayout (or SabreLayout, which applies its own layout) renumbers
        # the DAG's wires from logical to physical qubits.
        was_physical = state["physical"]
        physical = was_physical or name in ("ApplyLayout", "SabreLayout")
        layout = _layouts(dag, ps, physical, n)
        chosen = None if physical else _chosen_layout(dag, ps, n)
        changed = gates != state["gates"]
        step = {
            "i": len(steps),
            "pass": name,
            "stage": stage_of.get(id(pass_), "other"),
            "cause": cause_of(name),
            "time_ms": round(kw["time"] * 1000, 3),
            "changed": changed,
            "num_qubits": dag.num_qubits(),
            "physical": physical,
        }
        if chosen is not None and chosen != state["chosen"]:
            step["chosen_layout"] = chosen
        state["chosen"] = chosen
        if changed:
            qubit_map = None
            if physical and not was_physical and layout is not None:
                qubit_map = layout["initial"]
            allow_moves = qubit_map is not None or step["cause"] in ("routing", "layout")
            statuses, removed = _diff(state["gates"], gates, qubit_map, allow_moves)
            metrics = _metrics(dag)
            step.update({
                "metrics": metrics,
                "delta": _delta(state["metrics"], metrics),
                "gates": _encode_gates(gates, statuses),
                "removed": [[n_, list(q), list(p)] for n_, q, p in removed],
                "renumbered": qubit_map is not None,
            })
            state.update(gates=gates, metrics=metrics, n=dag.num_qubits())
            raw.append({"circuit": dag_to_circuit(dag), "layout": layout, "i": step["i"]})
        else:
            step.update({"metrics": state["metrics"], "delta": None})
        step["layout"] = layout
        step["layout_changed"] = layout != state["layout"]
        state["layout"] = layout
        state["physical"] = physical
        steps.append(step)

    started = time.perf_counter()
    out = pm.run(circuit, callback=callback)
    elapsed = time.perf_counter() - started

    by_cause = {c: {"depth": 0, "twoq_depth": 0, "size": 0, "twoq": 0, "swaps": 0} for c in CAUSES}
    swaps_inserted = 0
    for step in steps[1:]:
        if step["delta"]:
            bucket = by_cause[step["cause"]]
            for k, v in step["delta"].items():
                bucket[k] += v
            if step["cause"] == "routing":
                swaps_inserted += max(step["delta"]["swaps"], 0)

    edges = targets_mod.coupling_edges(target_id, n)
    num_physical = max((max(e) for e in edges), default=n - 1) + 1
    meta = targets_mod.TARGETS[target_id]
    trace = {
        "target": {
            "id": target_id,
            "label": meta["label"],
            "short": meta["short"],
            "connectivity": meta["connectivity"],
            "basis": meta["basis"],
            "num_physical": max(num_physical, n),
            "edges": [list(e) for e in edges],
            "positions": targets_mod.positions(target_id, n),
        },
        "steps": steps,
        "summary": {
            "initial": first_metrics,
            "final": state["metrics"],
            "by_cause": by_cause,
            "swaps_inserted": swaps_inserted,
            "layout": state["layout"],
            "passes_run": len(steps) - 1,
            "passes_changed": sum(1 for s in steps[1:] if s["changed"]),
            "wall_ms": round(elapsed * 1000, 1),
        },
    }
    if return_circuit:
        return trace, out, raw
    return trace


def _versions() -> dict:
    versions = {"qiskit": qiskit.__version__}
    try:
        import qiskit_ionq

        versions["qiskit_ionq"] = qiskit_ionq.__version__
    except Exception:
        versions["qiskit_ionq"] = None
    return versions


def trace_bundle(
    circuit: QuantumCircuit,
    meta: dict,
    *,
    target_ids=tuple(targets_mod.TARGETS),
    seed: int = DEFAULT_SEED,
    optimization_level: int = DEFAULT_OPT_LEVEL,
) -> dict:
    """Trace one circuit on every target; this is what the frontend loads."""
    try:
        source = qasm2.dumps(circuit)
    except Exception:
        source = None
    traces, errors = {}, {}
    for tid in target_ids:
        try:
            traces[tid] = trace_circuit(circuit, tid, seed=seed, optimization_level=optimization_level)
        except Exception as exc:  # keep the other targets if one fails
            errors[tid] = f"{type(exc).__name__}: {exc}"
    return {
        "schema": SCHEMA_VERSION,
        "versions": _versions(),
        "seed": seed,
        "optimization_level": optimization_level,
        "circuit": {
            "id": meta.get("id", "custom"),
            "title": meta.get("title", circuit.name),
            "blurb": meta.get("blurb", ""),
            "num_qubits": circuit.num_qubits,
            "qasm": source,
        },
        "order": [t for t in target_ids if t in traces],
        "traces": traces,
        "errors": errors,
    }
