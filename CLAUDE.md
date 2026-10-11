# Project handoff: Transpiler explainer (Qollab × IonQ hackathon)

Working title: **Transpile Lens** (rename freely).
Theme tag: **Quantum Unlocked**.

## Deadline and constraints

- **Hard deadline:** Sun Oct 11, 2026, 7:00 PM ET (4:00 PM PT). The project must be published and runnable on Qollab.xyz by then. A partial submission is still eligible, so keep a working version deployed at all times.
- All code must be written during the build window. Don't pull in pre-existing personal projects.
- License: MIT.
- Built with **Qiskit**.

## The idea in one paragraph

When you run a circuit on hardware, the transpiler rewrites it: gates are translated to the device's native gate set, logical qubits are mapped to physical qubits, SWAPs are inserted where connectivity is limited, and optimization passes trim the result. Circuits routinely come out several times deeper, and almost nobody can see why. This project replays the real Qiskit transpiler pass by pass, attributes the depth increase to its causes, and compares the same circuit on a limited-connectivity chip (heavy-hex) against IonQ-style all-to-all connectivity. The point is to make "connectivity," "native gates," and "routing overhead" concrete and measurable.

## Why it's novel (keep this for the write-up)

Existing tools show what a circuit *does*, or a single static snapshot. None explains what the transpiler *did*:

- **Quirk**, **IBM Quantum Composer**: simulate and visualize state evolution of the logical circuit. Quirk has no hardware model. Composer shows a transpiled circuit on job submission, but only as a before/after snapshot with no per-pass explanation.
- **`QuantumCircuit.draw()` / `circuit_drawer()`**: one static circuit diagram.
- **`DAGCircuit.draw()`**: one static dependency graph image.
- **`plot_circuit_layout()`**: final qubit placement on the coupling map. No SWAP history.
- **`visualize_transition()`**: single-qubit Bloch sphere animation, unrelated to transpilation (and likely removed in Qiskit 1.x; verify).

Our contribution: a pass-by-pass timeline with diffs, a depth "budget" attributed to causes, a side-by-side topology comparison, and plain-language explanations for each pass.

## Core features (in priority order)

1. **Pass timeline.** Capture the circuit after every transpiler pass. Let the user scrub through it and see which gates each pass added, removed, or merged.
2. **Depth budget.** Report metrics per pass and per stage: depth, total gate count, two-qubit gate count, SWAP count. Summarize, e.g. "depth 12 → 61: translation +23, routing +34, optimization −8."
3. **Topology comparison.** The same circuit transpiled for a heavy-hex coupling map and for all-to-all connectivity, side by side, with SWAP counts and an estimated success probability.
4. **Pass explanations.** A short plain-language note for each pass or stage that appears in the trace.
5. **Custom circuits** (stretch). Paste OpenQASM 2/3 or pick from presets.

Cut from the bottom if time runs short. Features 1–3 on preset circuits are a complete submission.

## Technical approach

### Capturing the trace

Use the `callback` argument of `transpile()` (or of a preset pass manager's `run()`). It's called after every pass with keyword arguments including `pass_`, `dag`, `time`, `property_set`, and `count`. Convert each `dag` with `qiskit.converters.dag_to_circuit` and record:

- pass name (`type(pass_).__name__`) and which stage it belongs to (layout / routing / translation / optimization; build the mapping from `generate_preset_pass_manager(...)`'s stages)
- depth, `count_ops()`, two-qubit gate count, SWAP count
- the gate list (name, qubits, params) for rendering and diffing

Skip passes that don't change the circuit (analysis passes) in the UI, but keep them in the raw trace.

Always set `seed_transpiler` so traces are deterministic and reproducible.

### Targets

- **Limited connectivity:** `CouplingMap.from_heavy_hex(...)` with basis gates `['cx', 'rz', 'sx', 'x']`.
- **All-to-all (IonQ-style):** `CouplingMap.from_full(n)`. IonQ's native gates are GPi, GPi2, and MS. **Verify** how to target them: the `qiskit-ionq` package defines these gates, but whether the standard transpiler can translate into them directly is uncertain. Fallback: use an all-to-all map with basis `['rx', 'ry', 'rz', 'rxx']` (MS is an RXX-type interaction) and say so in the docs.

### Depth attribution caveat

Depth is not additive across passes. Attribute the *change* in depth between consecutive snapshots to the pass that caused it, and present per-stage totals as deltas. State this method in the docs so the numbers aren't overclaimed.

### Success-probability estimate

Estimate as the product of (1 − error) over all gates, using assumed error rates per gate type. Label these as illustrative assumptions in the UI, not device specifications.

### Preset circuits

GHZ (5 qubits), QFT (5), a 3-qubit Grover iteration, a small random circuit. Choose sizes where the topology difference is visible but the trace stays readable.

### Architecture

- **Python side (Qiskit):** generate traces and export JSON. Precompute traces for presets so the demo never depends on a live backend.
- **Frontend:** render circuits ourselves as SVG/HTML from the gate lists. **Do not** embed matplotlib images: they can't be animated or diffed, and they fail accessibility (no screen-reader text, no keyboard stepping).
- Live transpilation of user-supplied circuits only if Qollab's runtime supports running Python on demand (see first task).

## First task: verify Qollab

Before writing much code, find out exactly what "runnable on Qollab.xyz" means: whether projects are notebooks, Python apps, static web pages, or something else; what Python and Qiskit versions are available; whether `qiskit-ionq` is installable. The architecture above assumes we can ship a Python trace generator plus a web frontend. Adjust if Qollab differs. (The "runs on the Qollab quantum simulator" requirement is listed for Quantum Impact only, but make sure anything we run there works without errors.)

## Accessibility (a stated requirement)

- Full keyboard control of the timeline (arrow keys to step, Home/End to jump), visible focus states.
- ARIA labels on controls. An `aria-live` region announcing each step's change ("Routing pass inserted 3 SWAPs; depth 18 → 27").
- A text/table alternative for every visual: the metrics table per pass.
- Colorblind-safe palette. Never encode added/removed with red/green alone; also use shape, pattern, or labels.
- Respect `prefers-reduced-motion`.
- Sufficient contrast; test with an automated checker (e.g. axe) before submitting.

## Testing

- Unit-test the trace generator: the final circuit of a trace must equal `transpile()`'s output with the same seed, and SWAP counts must match a direct count after routing.
- Check that every circuit in a trace is equivalent to the original up to layout (e.g. `Operator` equivalence for small circuits). This is the main protection against plausible but wrong output.

## Submission checklist

- [ ] Published and runnable on Qollab.xyz under MIT license
- [ ] Qollab project page: what it does, the problem it explores, how to run it, enough detail to replicate and extend
- [ ] Written summary covering each judging criterion: novelty, technical execution, impact, documentation
- [ ] Attribution line, verbatim: "This effort is supported by Qollab & IonQ."
- [ ] Disclosure of external libraries/templates (Qiskit, qiskit-ionq if used, frontend libraries) with license confirmation
- [ ] Theme tag: Quantum Unlocked
- [ ] Short demo video
- [ ] Code repository link
- [ ] Accessibility pass completed

## Suggested schedule (times PT, Sat 6 PM → Sun 4 PM)

- **Sat evening:** verify Qollab; trace generator for one preset on both topologies; JSON export; tests.
- **Sat late / Sun morning:** frontend circuit renderer, timeline scrubber, metrics table, topology comparison.
- **Sun midday:** pass explanations, accessibility pass, remaining presets, deploy to Qollab.
- **Sun 1–3 PM:** project page, criterion summary, disclosure, demo video.
- **Sun 3–4 PM:** buffer. Submit early.
