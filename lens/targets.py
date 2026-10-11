"""Hardware targets compared by Transpile Lens.

Three targets, chosen so each comparison changes one thing at a time:

- ``heavy_hex``: limited connectivity (IBM-style heavy-hex lattice) with the
  IBM basis ``cx, rz, sx, x``.
- ``full_ibm``: all-to-all connectivity with the *same* IBM basis. Comparing it
  with ``heavy_hex`` isolates the cost of connectivity.
- ``ionq``: all-to-all connectivity with IonQ's native gates GPI, GPI2 and MS
  (gate definitions and equivalences from ``qiskit-ionq``). Comparing it with
  ``full_ibm`` isolates the cost of the native gate set.
"""

from __future__ import annotations

import itertools
import math

from qiskit.circuit import Parameter
from qiskit.circuit.library import Measure
from qiskit.transpiler import CouplingMap, Target, generate_preset_pass_manager

IBM_BASIS = ["cx", "rz", "sx", "x"]

# Heavy-hex distance 3 gives a 19-qubit lattice: big enough to place 5-qubit
# circuits in several ways, small enough to draw.
HEAVY_HEX_DISTANCE = 3

TARGETS = {
    "heavy_hex": {
        "label": "Heavy-hex, IBM gates",
        "short": "Heavy-hex",
        "connectivity": "heavy-hex lattice (each qubit has at most 3 neighbours)",
        "basis": IBM_BASIS,
    },
    "full_ibm": {
        "label": "All-to-all, IBM gates",
        "short": "All-to-all (IBM gates)",
        "connectivity": "all-to-all (every pair of qubits can interact)",
        "basis": IBM_BASIS,
    },
    "ionq": {
        "label": "All-to-all, IonQ native gates",
        "short": "IonQ native",
        "connectivity": "all-to-all (every pair of qubits can interact)",
        "basis": ["gpi", "gpi2", "ms"],
    },
}

_ionq_ready = False


def _ionq_target(num_qubits: int) -> Target:
    """An all-to-all Target whose only gates are IonQ's GPI, GPI2 and MS."""
    global _ionq_ready
    from qiskit_ionq import GPI2Gate, GPIGate, MSGate, add_equivalences

    if not _ionq_ready:
        # Registers U -> GPI2·GPI·GPI2 and CX -> MS + GPI2 in the session
        # equivalence library so the standard BasisTranslator can reach them.
        add_equivalences()
        _ionq_ready = True

    qubits = range(num_qubits)
    target = Target(num_qubits=num_qubits)
    target.add_instruction(GPIGate(Parameter("phi")), {(q,): None for q in qubits})
    target.add_instruction(GPI2Gate(Parameter("phi")), {(q,): None for q in qubits})
    target.add_instruction(
        MSGate(Parameter("phi0"), Parameter("phi1"), Parameter("theta")),
        {pair: None for pair in itertools.permutations(qubits, 2)},
    )
    target.add_instruction(Measure(), {(q,): None for q in qubits})
    return target


def coupling_edges(target_id: str, num_qubits: int) -> list[list[int]]:
    """Undirected edge list of the target's coupling graph, for drawing."""
    if target_id == "heavy_hex":
        cmap = CouplingMap.from_heavy_hex(HEAVY_HEX_DISTANCE)
    else:
        cmap = CouplingMap.from_full(num_qubits)
    return sorted({tuple(sorted(edge)) for edge in cmap.get_edges()})


# Drawing coordinates (column, row) for the distance-3 heavy-hex lattice:
# three rows of five qubits joined by "bridge" qubits on rows 1 and 3.
HEAVY_HEX_POSITIONS = {
    2: (0, 0), 14: (1, 0), 1: (2, 0), 13: (3, 0), 0: (4, 0),
    10: (1, 1), 9: (4, 1),
    5: (0, 2), 16: (1, 2), 4: (2, 2), 15: (3, 2), 3: (4, 2),
    12: (0, 3), 11: (3, 3),
    8: (0, 4), 18: (1, 4), 7: (2, 4), 17: (3, 4), 6: (4, 4),
}


def positions(target_id: str, num_qubits: int) -> list[list[float]]:
    """Unit-scale drawing coordinates for each physical qubit."""
    if target_id == "heavy_hex":
        return [list(HEAVY_HEX_POSITIONS[q]) for q in range(len(HEAVY_HEX_POSITIONS))]
    # All-to-all: qubits on a circle.
    return [
        [round(2 + 2 * math.sin(2 * math.pi * q / num_qubits), 4),
         round(2 - 2 * math.cos(2 * math.pi * q / num_qubits), 4)]
        for q in range(num_qubits)
    ]


def pass_manager(target_id: str, num_qubits: int, optimization_level: int, seed: int):
    """Preset staged pass manager for one of the TARGETS."""
    common = {"optimization_level": optimization_level, "seed_transpiler": seed}
    if target_id == "heavy_hex":
        return generate_preset_pass_manager(
            coupling_map=CouplingMap.from_heavy_hex(HEAVY_HEX_DISTANCE),
            basis_gates=IBM_BASIS,
            **common,
        )
    if target_id == "full_ibm":
        return generate_preset_pass_manager(
            coupling_map=CouplingMap.from_full(num_qubits),
            basis_gates=IBM_BASIS,
            **common,
        )
    if target_id == "ionq":
        pm = generate_preset_pass_manager(target=_ionq_target(num_qubits), **common)
        # Qiskit's 1-qubit optimizer has no Euler basis for GPI/GPI2, so runs of
        # them would never merge. qiskit-ionq's rewrite rules do that; they run
        # here as a post-optimization stage so each shows up in the trace.
        from qiskit.transpiler import PassManager
        from qiskit_ionq.rewrite_rules import (
            CancelGPI2Adjoint,
            CancelGPIAdjoint,
            CommuteGPIsThroughMS,
            CompactMoreThanThreeSingleQubitGates,
            FuseConsecutiveMS,
            GPI2TwiceIsGPI,
        )

        pm.post_optimization = PassManager([
            CancelGPI2Adjoint(),
            CancelGPIAdjoint(),
            GPI2TwiceIsGPI(),
            CommuteGPIsThroughMS(),
            CompactMoreThanThreeSingleQubitGates(),
            FuseConsecutiveMS(),
        ])
        return pm
    raise ValueError(f"unknown target {target_id!r}")
