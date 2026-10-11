# Submission kit: Transpile Lens

Everything to paste or follow when submitting to the Qollab × IonQ hackathon.
Deadline: **Sun Oct 11, 2026, 19:00 ET (16:00 PT)**. The team captain submits from the hackathon registration page.

---

## Form and project-page fields

| Field | Value |
|---|---|
| Project name | Transpile Lens |
| Theme | **Quantum Unlocked** |
| Short description | Watch the real Qiskit transpiler rewrite a circuit pass by pass, see where the extra depth comes from, and compare heavy-hex, all-to-all and IonQ-native chips. |
| Tags | `qiskit`, `ionq`, `transpiler`, `compilation`, `visualization`, `education`, `accessibility` |
| License | MIT (`LICENSE` in the project) |
| Attribution | This effort is supported by Qollab & IonQ. (in the project card and in the app's footer) |
| Git repository | *(your public GitHub URL)* |
| Demo video | *(your public YouTube / Loom / Vimeo / Drive link)* |

---

## Summary by judging criterion

**Novelty & creativity.** Tools people already use show what a circuit *does* (Quirk, IBM Quantum Composer) or one static picture of it (`circuit.draw()`, `DAGCircuit.draw()`, `plot_circuit_layout()`). None shows what the transpiler *did*. Transpile Lens replays the real Qiskit transpiler like a video:
- each pass animates its changes: kept gates slide, rerouted gates move to new qubits, added gates grow in, removed gates fade;
- the increase in depth and gate count is credited to its causes;
- the same circuit is compared on three chips designed to change one thing at a time. All-to-all with IBM gates isolates the cost of connectivity; IonQ's native gates isolate the cost of the gate set.

The IonQ target uses IonQ's real native gates (GPI, GPI2, MS) through qiskit-ionq's equivalences and rewrite passes, not a stand-in basis.

**Technical execution.**
- **Capture:** a callback on Qiskit's preset staged pass manager records every pass: metrics, the full gate list, a diff against the previous snapshot, and where each logical qubit starts and ends (`TranspileLayout.from_property_set`).
- **Cost attribution:** credited by what a change did, not by Qiskit's stage name. SabreLayout inserts SWAPs during the layout stage, so it counts as routing.
- **Tests:** 64 of them. They check that:
  - the final snapshot equals `transpile()` with the same seed;
  - SWAP counts match a direct count after routing;
  - per-cause deltas sum to the total change;
  - every recorded snapshot is equivalent to the input circuit up to layout and global phase, simulated on the full 19-qubit device.
- **Frontend:** draws circuits as SVG from the gate lists (no matplotlib images), so every gate can be diffed, animated, hovered, zoomed and read as text.
- **Live traces:** custom circuits are traced live in the browser by Qiskit on Pyodide; presets are precomputed so the demo never waits.

**Impact potential.** "Why did my circuit get five times deeper?" is one of the first walls people hit when moving from simulators to hardware. Transpile Lens makes connectivity, native gates and routing overhead concrete. On the 5-qubit QFT:
- **Heavy-hex:** depth 10 → 45 and 26 two-qubit gates, with 4 SWAPs.
- **All-to-all, same IBM gates:** depth 10 → 29 and 20 two-qubit gates.

That gap is the measurable cost of connectivity, which is exactly the trade-off between superconducting and trapped-ion hardware. It suits:
- **Teaching:** a lecture or workshop can step through it live.
- **Self-study:** every gate and pass links to the relevant Wikipedia article.
- **Quick checks:** pasting your own OpenQASM shows where its overhead comes from in seconds.

**Documentation quality.** The project page covers:
- the problem and how to run the app on Qollab;
- the architecture, file by file;
- method notes that keep the numbers honest: depth isn't additive; the success estimate uses illustrative error rates, not device specs; IonQ one-qubit counts are an upper bound;
- what the tests guarantee and how to extend the app (add a preset, a target or a pass explanation);
- an accessibility statement, plus a library and licence disclosure that also states AI assistance.

Inside the app, every pass has a plain-language explanation and a sentence saying what it did to this circuit.

**Accessibility** (a stated requirement):
- **Keyboard:** full control with video-player shortcuts (Space/K, ←/→, Home/End, C, F, +/−/0, Shift+arrows), and an `aria-live` region that announces each step.
- **Text alternatives:** a gate list for every snapshot, a metrics table for every pass, and descriptions of each SVG.
- **Colour:** Okabe-Ito colour-blind-safe colours, and status is never shown by colour alone.
- **Motion:** reduced-motion support.
- **Check:** axe-core 4.10 reports no violations.

---

## Demo video script (about 2:30)

Record the app running **on Qollab** (not localhost) at 1080p, browser full screen, with system audio off. Speak over it or add captions.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | The Qollab project page, then press **Run** with the built-in simulator. The player appears with the QFT poster. | "When you run a circuit on real hardware, the transpiler rewrites it, and circuits often come out several times deeper. Transpile Lens shows you exactly what it did, pass by pass." |
| 0:15–0:45 | Press the big play button. Let ElidePermutations and SabreLayout play. Pause on SabreLayout. | "This is Qiskit's real transpiler, replayed. ElidePermutations deletes the QFT's final SWAPs for free by renaming wires. SabreLayout places the qubits on the heavy-hex chip and inserts four SWAPs. Blue gates were added, yellow dashed gates were moved onto other qubits." |
| 0:45–1:05 | Step → to BasisTranslator, then CommutativeCancellation. Point at the caption. | "Translation rewrites everything into the chip's native gates: each SWAP becomes three CNOTs. Then optimization claws back depth. The caption says exactly what each pass did." |
| 1:05–1:25 | Hover a gate to show the card; click to pin it; Ctrl+scroll to zoom in, drag to pan, press 0 to fit. | "Hover any gate to see what it is, what this pass did to it, and a Wikipedia link to learn more. You can zoom and pan around big circuits." |
| 1:25–1:55 | Scroll to **Where the cost comes from**, then **Same circuit, three chips**. Hover a cost bar and a coupling map. | "Depth went from 10 to 45: translation plus 41, routing plus 7, optimization minus 13. Compare chips: on all-to-all connectivity the same circuit needs no SWAPs and six fewer two-qubit gates. That's the price of connectivity, and why IonQ's all-to-all trapped ions matter. The IonQ card uses IonQ's real native gates: GPI, GPI2 and Mølmer–Sørensen." |
| 1:55–2:10 | Click **IonQ native** at the top; let the circuit reflow; play a couple of passes. | "Switch chips and the circuit reflows. Here qiskit-ionq's own rewrite rules compact the one-qubit pulses." |
| 2:10–2:25 | Scroll to **Try your own circuit**, paste a small QASM (e.g. GHZ star), press **Transpile it**. | "Paste your own OpenQASM and it's transpiled live, in your browser." |
| 2:25–2:40 | Show keyboard use: Space, arrows, C; mention tests. | "Everything works from the keyboard and with a screen reader, and 64 tests check that every step shown is equivalent to the original circuit. Built with Qiskit. This effort is supported by Qollab and IonQ." |

GHZ-star QASM to paste:

```
OPENQASM 2.0;
include "qelib1.inc";
qreg q[5];
h q[0];
cx q[0],q[1];
cx q[0],q[2];
cx q[0],q[3];
cx q[0],q[4];
```

---

## Pre-flight check on Qollab (after uploading)

- [ ] Run starts with no install errors in the console. Watch especially for `qiskit-ionq` failing to install on Pyodide; the fix is below.
- [ ] Player loads the QFT, play works, all three chips switch.
- [ ] Each preset in the dropdown loads.
- [ ] "Try your own circuit" with the QASM above returns a result. This is the only part that runs Qiskit live, so it can take a few seconds.
- [ ] Hover cards appear; Wikipedia links open (if the sandbox blocks new tabs, note it in the project card).
- [ ] Works when the run is started on an **IonQ simulator** backend as well as the built-in one.

**If the run fails while installing `qiskit-ionq`:** delete the `qiskit-ionq==1.1.1` line from `requirements.txt` in the Qollab editor and publish again. Presets keep working, because they're precomputed with qiskit-ionq locally. Live custom circuits then skip only the IonQ target and show a note.
