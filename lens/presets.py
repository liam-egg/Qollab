"""Preset circuits, written out gate by gate so the starting depth is meaningful.

None of them measure: the trace is about how the transpiler rewrites the
unitary part, and leaving measurements out lets the tests check every
snapshot for exact equivalence.
"""

from __future__ import annotations

import math

from qiskit import QuantumCircuit
from qiskit.circuit.random import random_circuit


def ghz_chain(n: int = 5) -> QuantumCircuit:
    qc = QuantumCircuit(n, name="ghz_chain")
    qc.h(0)
    for q in range(n - 1):
        qc.cx(q, q + 1)
    return qc


def ghz_star(n: int = 5) -> QuantumCircuit:
    qc = QuantumCircuit(n, name="ghz_star")
    qc.h(0)
    for q in range(1, n):
        qc.cx(0, q)
    return qc


def qft(n: int = 5) -> QuantumCircuit:
    qc = QuantumCircuit(n, name="qft")
    for target in reversed(range(n)):
        qc.h(target)
        for control in reversed(range(target)):
            qc.cp(math.pi / 2 ** (target - control), control, target)
    for q in range(n // 2):
        qc.swap(q, n - 1 - q)
    return qc


def grover3() -> QuantumCircuit:
    """One Grover iteration on 3 qubits, marking |101>."""
    qc = QuantumCircuit(3, name="grover3")
    qc.h([0, 1, 2])
    # Oracle: phase-flip |101> (qubit 0 is the rightmost bit).
    qc.x(1)
    qc.h(2)
    qc.ccx(0, 1, 2)
    qc.h(2)
    qc.x(1)
    # Diffuser.
    qc.h([0, 1, 2])
    qc.x([0, 1, 2])
    qc.h(2)
    qc.ccx(0, 1, 2)
    qc.h(2)
    qc.x([0, 1, 2])
    qc.h([0, 1, 2])
    return qc


def random5() -> QuantumCircuit:
    qc = random_circuit(5, 4, max_operands=2, seed=1234)
    qc.name = "random5"
    return qc


PRESETS = {
    "ghz_chain": {
        "title": "GHZ, chain (5 qubits)",
        "blurb": "Entangles 5 qubits with a line of CNOTs. Neighbour-only "
        "interactions fit almost any chip, so this is the control case.",
        "build": ghz_chain,
    },
    "ghz_star": {
        "title": "GHZ, star (5 qubits)",
        "blurb": "Same state, but qubit 0 talks to all four others. No "
        "heavy-hex qubit has four neighbours, so routing must insert SWAPs.",
        "build": ghz_star,
    },
    "qft": {
        "title": "QFT (5 qubits)",
        "blurb": "The quantum Fourier transform: every pair of qubits "
        "interacts once, so connectivity matters a lot.",
        "build": qft,
    },
    "grover3": {
        "title": "Grover iteration (3 qubits)",
        "blurb": "One oracle and one diffuser. Each Toffoli needs all three "
        "qubits to interact pairwise, which heavy-hex can't provide directly.",
        "build": grover3,
    },
    "random5": {
        "title": "Random circuit (5 qubits)",
        "blurb": "Qiskit's random_circuit with depth 4 and fixed seed 1234: "
        "a mix of gate types with no structure to exploit.",
        "build": random5,
    },
}
