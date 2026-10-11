# Transpile Lens

**See what the Qiskit transpiler did to your circuit, pass by pass, and where the extra depth came from.**

Theme: **Quantum Unlocked** · License: MIT · Built with Qiskit

This effort is supported by Qollab & IonQ.

## The problem

Before a circuit runs on hardware, the transpiler rewrites it. It translates gates into the device's few native gates, assigns logical qubits to physical ones, inserts SWAPs where the chip lacks a direct connection, and then optimises the result. Circuits routinely come out several times deeper, and the tools people use don't show why. Quirk and IBM Quantum Composer show what a circuit *does*. `circuit.draw()`, `DAGCircuit.draw()` and `plot_circuit_layout()` each give one static snapshot. None of them shows what each transpiler pass changed.

Transpile Lens replays the real Qiskit transpiler pass by pass. It shows each step, attributes the cost increase to its causes, and compares the same circuit on three chips. That makes "connectivity", "native gates" and "routing overhead" concrete and measurable.

## What it does

- **Pass timeline.** Step through every pass that changed the circuit (or every pass, including analysis passes). Gates the pass added are drawn with a thick outline and a **+** badge; gates moved onto different qubits get a dashed outline and a **↔** badge; removed gates are listed.
- **Plain-language explanations** for each pass: what it does in general, and what it did to *this* circuit ("SabreLayout added 4× SWAP; moved 10 gates onto different qubits. Depth 9 → 16.").
- **Cost breakdown.** For the QFT on heavy-hex, for example: *depth 10 → 45: translation +41, routing +7, optimization −13. Routing inserted 4 SWAPs; translation then expanded each into three CNOTs.* Switch between depth, two-qubit gates, two-qubit depth and total gates.
- **Same circuit, three chips.** Each comparison changes one thing at a time:
  - *Heavy-hex, IBM gates* (`cx, rz, sx, x`), the limited-connectivity case;
  - *All-to-all, IBM gates*: the same gates with every pair connected, which isolates the **cost of connectivity**;
  - *All-to-all, IonQ native gates* (GPI, GPI2, MS, from `qiskit-ionq`), which isolates the **gate-set difference**.
  Each card shows the coupling map, where each logical qubit was placed, which connections carry SWAPs, the final metrics and an estimated success probability.
- **Your own circuit.** Paste OpenQASM 2 (or 3) with up to 10 qubits. It's transpiled live in the browser by Qiskit on Pyodide.

Presets: GHZ chain (the control case, which fits any chip), GHZ star, 5-qubit QFT, a 3-qubit Grover iteration and a seeded random circuit.

## How to run it

On Qollab: press **Run**, pick any backend (the app doesn't spend credits), and use the page that appears above the console. The run stays live so custom circuits can be traced; press **Stop** when you're done.

Locally:

```bash
pip install "qiskit>=2.5.2,<3" qiskit-ionq==1.1.1 pytest
python scripts/build_traces.py   # regenerate data/traces/*.json
python -m pytest tests           # 64 checks, about a minute
python dev/serve.py              # preview at http://localhost:8765
```

## How it works

```
lens/trace.py      runs a preset pass manager with a callback after every pass
lens/targets.py    the three targets (coupling maps, basis gates, IonQ Target)
lens/presets.py    preset circuits, written gate by gate
lens/service.py    the functions main.js calls (JSON strings in and out)
data/traces/       precomputed traces, so the demo never waits on a backend
main.js, ui/       the page: SVG circuit renderer, timeline, panels
tests/             faithfulness checks (below)
dev/               local preview that stands in for Qollab's JS-to-Python bridge
```

1. `generate_preset_pass_manager(optimization_level=2, seed_transpiler=11, ...)` builds the pipeline. Each pass instance is mapped to its stage by walking the staged pass manager.
2. `pass_manager.run(circuit, callback=...)` calls back after every pass with the DAG and property set. Each call records the pass, stage, depth, gate counts, two-qubit depth, SWAP count, the full gate list, a diff against the previous snapshot, and where each logical qubit starts and ends (`TranspileLayout.from_property_set`).
3. The frontend draws circuits itself as SVG from the gate lists. There are no matplotlib images, so each step can be diffed, highlighted, read as text and navigated by keyboard.

### Method notes (so the numbers aren't overclaimed)

- **Depth isn't additive.** Each pass is credited with the *change* between consecutive snapshots, grouped by the kind of change: translation, routing, optimization or layout. Per-cause totals always sum exactly to the overall change (this is tested).
- **The kind of change can differ from Qiskit's stage name.** SabreLayout runs in the layout stage but inserts SWAPs, so it counts as routing. ElidePermutations removes SWAPs by relabelling wires, so it counts as optimization.
- **IonQ target.** The equivalences in `qiskit-ionq` (U → GPI2·GPI·GPI2, CX → MS + GPI2) let the standard BasisTranslator reach IonQ's native gates. Qiskit's one-qubit optimiser has no recipe for that basis, so qiskit-ionq's rewrite rules (for example `CompactMoreThanThreeSingleQubitGates`) run as a post-optimization stage, and each appears in the trace. This is Qiskit-side compilation only; IonQ's cloud compiles further, so treat IonQ one-qubit counts as an upper bound. Two-qubit counts are the fairest comparison.
- **Success probability** is the product of (1 − error) over all gates, using **illustrative error rates you set with sliders**. Every target uses the same rates, so differences come from gate counts alone. It ignores idle errors, crosstalk and readout. RZ can be treated as error-free, since it's a virtual frame change on IBM-style chips.
- Everything is deterministic: fixed `seed_transpiler=11`, optimisation level 2, Qiskit 2.5.2.

### Testing

`tests/test_trace.py` guards against plausible but wrong output:

- the final snapshot's gate list equals `transpile()`'s output with the same seed (or a fresh run of the same pass manager for the IonQ pipeline), including its final layout;
- the reported SWAP count equals a direct count after running only the init, layout and routing stages;
- **every recorded snapshot is equivalent to the input circuit**, up to layout and global phase. Two random input states are evolved through the snapshot on the full 19-qubit device and checked for fidelity 1;
- per-cause deltas sum to the total change, and gate statuses account for every gate;
- the service functions return the precomputed traces and handle custom and malformed QASM.

## Extend it

- **Add a preset:** write a builder in `lens/presets.py`, add it to `PRESETS`, add its file to `TRACE_FILES` in `lens/service.py` (Qollab only loads data paths written out as plain strings), and run `scripts/build_traces.py`.
- **Add a target:** add an entry to `TARGETS` and a branch in `pass_manager()` in `lens/targets.py`, plus drawing coordinates in `positions()`.
- **Explain a new pass:** add a note to `ui/explain.js`.

## Accessibility

- Full keyboard control. ←/→ step through passes from the slider, the pass chips or the circuit; Home/End jump to the input or final circuit. Radio groups follow the ARIA pattern, and focus states are visible.
- An `aria-live` region announces each step ("Step 3 of 7. SabreLayout, Layout stage. Added 4× SWAP…").
- Text alternatives: a gate list for every circuit snapshot, a metrics table for every pass, a description of each SVG, and sentences summarising each chart.
- Okabe-Ito colourblind-safe palette. Added, moved and removed are never shown by colour alone: they also differ by outline style and badge, and decreases are hatched with a ▼.
- Honours `prefers-reduced-motion` and `prefers-color-scheme`.
- axe-core 4.10 (WCAG 2.1 A/AA plus best-practice rules) reports no violations in light or dark mode.

## Libraries and licences

| Library | Use | Licence |
|---|---|---|
| [Qiskit](https://github.com/Qiskit/qiskit) 2.5.2 | transpiler, circuits, tests | Apache-2.0 |
| [qiskit-ionq](https://github.com/qiskit-community/qiskit-ionq) 1.1.1 | IonQ native gates, equivalences and rewrite passes | Apache-2.0 |
| [Pyodide](https://pyodide.org) (provided by Qollab) | runs Python in the browser | MPL-2.0 |
| [axe-core](https://github.com/dequelabs/axe-core) 4.10 | accessibility testing during development only; not shipped | MPL-2.0 |
| pytest | tests only | MIT |

The frontend uses no third-party JavaScript or CSS. All code was written during the hackathon build window.
