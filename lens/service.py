"""Functions main.js calls through Qollab's JS-to-Python bridge.

Every function takes and returns plain strings (JSON), so nothing but strings
crosses the boundary. Qollab preloads only data files whose paths appear as
plain string literals in Python, which is why TRACE_FILES spells each one out.
"""

from __future__ import annotations

import json

INDEX_FILE = "data/traces/index.json"
TRACE_FILES = {
    "ghz_chain": "data/traces/ghz_chain.json",
    "ghz_star": "data/traces/ghz_star.json",
    "qft": "data/traces/qft.json",
    "grover3": "data/traces/grover3.json",
    "random5": "data/traces/random5.json",
}

MAX_CUSTOM_QUBITS = 10
MAX_CUSTOM_GATES = 400


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def list_presets() -> str:
    return _read(INDEX_FILE)


def get_trace(preset_id: str) -> str:
    if preset_id not in TRACE_FILES:
        return json.dumps({"error": f"Unknown preset {preset_id!r}."})
    return _read(TRACE_FILES[preset_id])


def _parse(source: str):
    text = source.strip()
    if text.startswith("OPENQASM 3"):
        from qiskit import qasm3

        return qasm3.loads(text)
    from qiskit import qasm2

    return qasm2.loads(text, custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS)


def trace_qasm(source: str) -> str:
    """Trace a user-supplied OpenQASM 2 (or 3, if supported) circuit live."""
    try:
        circuit = _parse(source)
    except Exception as exc:
        return json.dumps({"error": f"Couldn't parse that circuit: {exc}"})
    circuit.remove_final_measurements(inplace=True)
    if circuit.num_qubits > MAX_CUSTOM_QUBITS:
        return json.dumps({"error": f"Please keep custom circuits to {MAX_CUSTOM_QUBITS} qubits "
                                    f"or fewer (this one has {circuit.num_qubits})."})
    if circuit.size() > MAX_CUSTOM_GATES:
        return json.dumps({"error": f"Please keep custom circuits to {MAX_CUSTOM_GATES} gates "
                                    f"or fewer (this one has {circuit.size()})."})
    if circuit.num_qubits == 0 or circuit.size() == 0:
        return json.dumps({"error": "That circuit has no gates to transpile."})
    from .trace import trace_bundle

    try:
        bundle = trace_bundle(circuit, {"id": "custom", "title": "Your circuit", "blurb": ""})
    except Exception as exc:
        return json.dumps({"error": f"Transpilation failed: {type(exc).__name__}: {exc}"})
    if not bundle["traces"]:
        return json.dumps({"error": "Transpilation failed on every target.", "details": bundle["errors"]})
    return json.dumps(bundle, separators=(",", ":"))
