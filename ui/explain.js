// Plain-language notes for the transpiler passes that appear in the traces.
// `what` says what the pass does in general; the step-specific sentence
// (what it did to *this* circuit) is built in main.js from the trace data.

export const STAGE_NAMES = {
  input: 'Input',
  init: 'Init',
  layout: 'Layout',
  routing: 'Routing',
  translation: 'Translation',
  optimization: 'Optimization',
  scheduling: 'Scheduling',
  other: 'Other',
};

export const CAUSE_NAMES = {
  input: 'input',
  translation: 'translation',
  routing: 'routing',
  optimization: 'optimization',
  layout: 'layout',
};

export const STAGE_NOTES = {
  init: 'Cleans up the circuit before it touches hardware: expands multi-qubit gates into one- and two-qubit pieces and removes obvious waste.',
  layout: 'Chooses which physical qubit on the chip plays each logical qubit in your circuit.',
  routing: 'Makes every two-qubit gate act on qubits that are physically connected, inserting SWAPs when they are not.',
  translation: 'Rewrites every gate into the few native gates the hardware can actually perform.',
  optimization: 'Looks for gates that cancel, merge or simplify, and repeats until nothing improves.',
  scheduling: 'Works out timing; for these targets it changes nothing.',
};

const NOTES = {
  HighLevelSynthesis: {
    what: 'Replaces abstract or multi-qubit gates (like a Toffoli) with circuits of one- and two-qubit gates.',
  },
  UnitarySynthesis: {
    what: 'Turns blocks described only by their matrix into explicit gates.',
  },
  BasisTranslator: {
    what: 'Rewrites each gate in terms of the target\'s native gate set using a library of known equivalences. A single CNOT may become several native pulses, and each SWAP becomes three CNOTs.',
    why: 'This is usually the biggest jump in depth: hardware only offers a handful of gates, so everything else must be built from them.',
  },
  ElidePermutations: {
    what: 'Removes SWAP gates at the start of the circuit by renaming qubits instead of moving their states.',
    why: 'A SWAP that only reorders qubits can be done for free in software: the compiler just remembers which wire holds which qubit.',
  },
  RemoveDiagonalGatesBeforeMeasure: { what: 'Drops diagonal gates right before measurement, since they can\'t change the outcome.' },
  RemoveIdentityEquivalent: { what: 'Deletes gates that are equivalent to doing nothing (for example a rotation by an angle of zero).' },
  InverseCancellation: { what: 'Cancels pairs of gates that undo each other, such as two CNOTs in a row on the same qubits.' },
  CommutativeCancellation: {
    what: 'Slides gates past each other where the order doesn\'t matter, then cancels or merges the ones that meet.',
    why: 'Translation often leaves rotations next to each other; merging them claws back depth.',
  },
  ConsolidateBlocks: { what: 'Groups runs of gates on the same two qubits into a single block so they can be re-synthesised more cheaply.' },
  Split2QUnitaries: { what: 'Splits two-qubit blocks that turn out not to entangle into separate one-qubit gates.' },
  SetLayout: { what: 'Uses a layout given by the user, if any. None was given here.' },
  TrivialLayout: { what: 'Maps logical qubit i to physical qubit i.' },
  VF2Layout: {
    what: 'Searches for a placement where every two-qubit gate already lands on connected qubits, so no SWAPs are needed.',
    why: 'If the circuit\'s interaction graph fits inside the chip\'s coupling graph, this finds it; otherwise it gives up and leaves the job to SabreLayout.',
  },
  SabreLayout: {
    what: 'Picks a placement and routes the circuit in the same pass: it simulates routing forwards and backwards several times and keeps the layout that needs the fewest SWAPs.',
    why: 'Although it runs in the layout stage, the SWAPs it inserts are routing, so Transpile Lens counts its changes as routing.',
  },
  SabreSwap: { what: 'Inserts SWAPs so each two-qubit gate acts on neighbouring qubits, choosing them with a look-ahead heuristic.' },
  FullAncillaAllocation: { what: 'Marks the chip\'s unused qubits as spare ancillas.' },
  EnlargeWithAncilla: { what: 'Adds the spare physical qubits to the circuit so its wires match the whole chip.' },
  ApplyLayout: {
    what: 'Renumbers the circuit\'s wires from logical qubits to the physical qubits chosen by the layout.',
    why: 'No gates change, only which wire they sit on.',
  },
  VF2PostLayout: { what: 'After routing, checks whether a different placement of the same circuit would be better, and switches to it if so.' },
  CheckMap: { what: 'Checks whether every two-qubit gate already acts on connected qubits.' },
  BarrierBeforeFinalMeasurements: { what: 'Keeps final measurements together at the end. These circuits have none, so nothing happens.' },
  FilterOpNodes: { what: 'Removes bookkeeping-only instructions.' },
  TwoQubitPeepholeOptimization: {
    what: 'Re-synthesises each two-qubit block and keeps the new version if it uses fewer two-qubit gates.',
    why: 'It optimises for two-qubit gates, the expensive ones, so it can accept a few extra one-qubit gates in exchange.',
  },
  Optimize1qGatesDecomposition: {
    what: 'Merges each run of one-qubit gates into the shortest equivalent sequence of native gates.',
  },
  GatesInBasis: { what: 'Checks whether every gate is already native.' },
  ContractIdleWiresInControlFlow: { what: 'Tidies wires inside if/loop blocks. These circuits have none.' },
  Depth: { what: 'Measures depth so the optimisation loop knows whether it is still improving.' },
  Size: { what: 'Counts gates so the optimisation loop knows whether it is still improving.' },
  FixedPoint: { what: 'Stops the optimisation loop once depth and size stop changing.' },
  ContainsInstruction: { what: 'Checks whether the circuit contains a particular instruction.' },
  TimeUnitConversion: { what: 'Converts gate durations into a common unit for scheduling.' },
  Error: { what: 'Raises an error if an unsupported instruction is present.' },
  // qiskit-ionq rewrite rules, run as a post-optimisation stage on the IonQ target.
  CancelGPI2Adjoint: { what: 'IonQ rule: cancels a GPI2 followed by its inverse.' },
  CancelGPIAdjoint: { what: 'IonQ rule: cancels pairs of GPI gates that undo each other.' },
  GPI2TwiceIsGPI: { what: 'IonQ rule: replaces two identical GPI2 pulses with one GPI pulse.' },
  CommuteGPIsThroughMS: { what: 'IonQ rule: moves GPI pulses through MS gates where that is allowed, so they can meet and merge with other one-qubit gates.' },
  CompactMoreThanThreeSingleQubitGates: {
    what: 'IonQ rule: replaces any run of more than three one-qubit pulses with an equivalent GPI2–GPI–GPI2 sequence.',
    why: 'Qiskit\'s own one-qubit optimiser has no recipe for the GPI/GPI2 basis, so this qiskit-ionq pass does the merging.',
  },
  FuseConsecutiveMS: { what: 'IonQ rule: merges back-to-back MS gates on the same pair of ions.' },
};

export function noteFor(passName) {
  return NOTES[passName] || { what: 'A transpiler pass from Qiskit\'s preset pipeline.' };
}
