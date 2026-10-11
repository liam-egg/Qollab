"""Checks that the trace is a faithful record of what the transpiler did.

The equivalence test is the main protection against plausible but wrong
output: every recorded snapshot must implement the input circuit, up to where
the layout put each logical qubit and a global phase.
"""

from __future__ import annotations

import pathlib
import sys

import numpy as np
import pytest
from qiskit import QuantumCircuit, qasm2, transpile
from qiskit.circuit.library import StatePreparation
from qiskit.converters import circuit_to_dag
from qiskit.quantum_info import Statevector, random_statevector
from qiskit.transpiler import CouplingMap, StagedPassManager

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from lens import service, targets  # noqa: E402
from lens.presets import PRESETS  # noqa: E402
from lens.trace import DEFAULT_OPT_LEVEL, DEFAULT_SEED, _gates, trace_circuit  # noqa: E402

CASES = [(pid, tid) for pid in PRESETS for tid in targets.TARGETS]


@pytest.fixture(scope="module")
def traced():
    cache = {}

    def get(pid, tid):
        if (pid, tid) not in cache:
            circuit = PRESETS[pid]["build"]()
            cache[(pid, tid)] = (circuit, *trace_circuit(circuit, tid, return_circuit=True))
        return cache[(pid, tid)]

    return get


def _reference_transpile(circuit, tid):
    n = circuit.num_qubits
    common = {"optimization_level": DEFAULT_OPT_LEVEL, "seed_transpiler": DEFAULT_SEED}
    if tid == "heavy_hex":
        return transpile(circuit, coupling_map=CouplingMap.from_heavy_hex(targets.HEAVY_HEX_DISTANCE),
                         basis_gates=targets.IBM_BASIS, **common)
    if tid == "full_ibm":
        return transpile(circuit, coupling_map=CouplingMap.from_full(n),
                         basis_gates=targets.IBM_BASIS, **common)
    # The IonQ pipeline adds qiskit-ionq passes, so plain transpile() can't
    # reproduce it; a fresh run of the same pass manager is the reference.
    return targets.pass_manager(tid, n, DEFAULT_OPT_LEVEL, DEFAULT_SEED).run(circuit)


@pytest.mark.parametrize("pid,tid", CASES)
def test_final_snapshot_matches_transpile(traced, pid, tid):
    circuit, trace, out, _ = traced(pid, tid)
    reference = _reference_transpile(circuit, tid)
    final_gates = [s for s in trace["steps"] if s["changed"]][-1]["gates"]
    as_tuples = [(n, tuple(q), tuple(p)) for n, q, p, _ in final_gates]
    assert as_tuples == _gates(circuit_to_dag(reference))
    assert as_tuples == _gates(circuit_to_dag(out))
    assert trace["summary"]["final"]["depth"] == reference.depth()
    assert trace["summary"]["layout"]["final"] == reference.layout.final_index_layout()


@pytest.mark.parametrize("pid,tid", CASES)
def test_swap_count_matches_direct_count_after_routing(traced, pid, tid):
    circuit, trace, _, _ = traced(pid, tid)
    pm = targets.pass_manager(tid, circuit.num_qubits, DEFAULT_OPT_LEVEL, DEFAULT_SEED)
    stages = {s: getattr(pm, s) for s in pm.expanded_stages
              if s.split("_")[-1] in ("init", "layout", "routing")}
    upto_init = StagedPassManager(stages=["init"], **{k: v for k, v in stages.items() if "init" in k})
    upto_routing = StagedPassManager(stages=["init", "layout", "routing"], **stages)
    before = upto_init.run(circuit).count_ops().get("swap", 0)
    after = upto_routing.run(circuit).count_ops().get("swap", 0)
    assert trace["summary"]["swaps_inserted"] == after - before
    if tid != "heavy_hex":
        assert trace["summary"]["swaps_inserted"] == 0


def _embedded_state(psi: Statevector, positions: list[int], num_qubits: int) -> Statevector:
    qc = QuantumCircuit(num_qubits)
    qc.append(StatePreparation(psi), positions)
    return Statevector(qc)


@pytest.mark.parametrize("pid,tid", CASES)
def test_every_snapshot_is_equivalent_up_to_layout(traced, pid, tid):
    circuit, _, _, raw = traced(pid, tid)
    n = circuit.num_qubits
    for seed in (3, 4):
        psi = random_statevector(2**n, seed=seed)
        ideal = psi.evolve(circuit)
        for snap in raw:
            snapshot = snap["circuit"]
            layout = snap["layout"] or {"initial": list(range(n)), "final": list(range(n))}
            big_n = snapshot.num_qubits
            start = _embedded_state(psi, layout["initial"], big_n)
            got = start.evolve(snapshot)
            want = _embedded_state(ideal, layout["final"], big_n)
            fidelity = abs(np.vdot(want.data, got.data)) ** 2
            assert fidelity == pytest.approx(1.0, abs=1e-8), (
                f"{pid}/{tid} step {snap.get('i', 0)} not equivalent (F={fidelity:.6f})")


@pytest.mark.parametrize("pid,tid", CASES)
def test_attribution_deltas_sum_to_total_change(traced, pid, tid):
    _, trace, _, _ = traced(pid, tid)
    s = trace["summary"]
    for key in ("depth", "size", "twoq", "twoq_depth"):
        total = sum(c[key] for c in s["by_cause"].values())
        assert total == s["final"][key] - s["initial"][key]


def test_gate_statuses_account_for_counts(traced):
    _, trace, _, _ = traced("qft", "heavy_hex")
    prev = None
    for step in trace["steps"]:
        if not step["changed"]:
            continue
        if prev is not None:
            kept = sum(1 for g in step["gates"] if g[3] in ("keep", "move"))
            assert kept + len(step["removed"]) == len(prev["gates"])
        prev = step
    sabre = next(s for s in trace["steps"] if s["pass"] == "SabreLayout")
    added = [g for g in sabre["gates"] if g[3] == "add"]
    assert added and all(g[0] == "swap" for g in added)


def test_service_roundtrip_matches_precomputed():
    import json

    listing = json.loads(service.list_presets())
    assert [p["id"] for p in listing] == list(PRESETS)
    for p in listing:
        bundle = json.loads(service.get_trace(p["id"]))
        assert set(bundle["traces"]) == set(targets.TARGETS)
        fresh = trace_circuit(PRESETS[p["id"]]["build"](), "full_ibm")
        assert bundle["traces"]["full_ibm"]["summary"]["final"] == fresh["summary"]["final"]


def test_service_traces_custom_qasm():
    import json

    qc = PRESETS["ghz_star"]["build"]()
    bundle = json.loads(service.trace_qasm(qasm2.dumps(qc)))
    assert not bundle["errors"]
    assert bundle["traces"]["heavy_hex"]["summary"]["swaps_inserted"] >= 1


def test_service_reports_bad_qasm():
    import json

    result = json.loads(service.trace_qasm("OPENQASM 2.0; this is not qasm"))
    assert "error" in result
