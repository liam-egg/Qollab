// Wikipedia articles for elaboration. Every title and section anchor here was
// checked to exist on en.wikipedia.org (October 2026). Links open in a new
// tab so the player stays where it is.

const BASE = 'https://en.wikipedia.org/wiki/';

export function wikiUrl(article) {
  return BASE + article;
}

// Title shown to the reader for an article path like "Quantum_logic_gate#Swap_gate".
export function wikiTitle(article) {
  const [page, section] = decodeURIComponent(article).split('#');
  const clean = (s) => s.replace(/_/g, ' ');
  return section ? `${clean(page)}: ${clean(section)}` : clean(page);
}

export function wikiLink(article, label = wikiTitle(article)) {
  const a = document.createElement('a');
  a.href = wikiUrl(article);
  a.target = '_blank';
  a.rel = 'noopener';
  a.className = 'wiki';
  a.textContent = label;
  a.setAttribute('aria-label', `${label} (Wikipedia, opens in a new tab)`);
  return a;
}

const GATE = 'Quantum_logic_gate';

// What each gate is, in one line, and where to read more.
export const GATES = {
  h: { full: 'Hadamard', does: 'Turns |0⟩ into an equal superposition of |0⟩ and |1⟩, and back.', wiki: `${GATE}#Hadamard_gate` },
  x: { full: 'Pauli-X (NOT)', does: 'Flips |0⟩ and |1⟩.', wiki: `${GATE}#Pauli_gates_(X,Y,Z)` },
  y: { full: 'Pauli-Y', does: 'A bit flip combined with a phase flip.', wiki: `${GATE}#Pauli_gates_(X,Y,Z)` },
  z: { full: 'Pauli-Z', does: 'Flips the sign of the |1⟩ amplitude.', wiki: `${GATE}#Pauli_gates_(X,Y,Z)` },
  s: { full: 'S (phase)', does: 'Quarter-turn phase on |1⟩.', wiki: `${GATE}#Phase_shift_gates` },
  sdg: { full: 'S-dagger', does: 'Inverse of S.', wiki: `${GATE}#Phase_shift_gates` },
  t: { full: 'T', does: 'Eighth-turn phase on |1⟩.', wiki: `${GATE}#Phase_shift_gates` },
  tdg: { full: 'T-dagger', does: 'Inverse of T.', wiki: `${GATE}#Phase_shift_gates` },
  p: { full: 'Phase', does: 'Adds a phase to the |1⟩ amplitude.', wiki: `${GATE}#Phase_shift_gates` },
  u1: { full: 'U1 (phase)', does: 'Adds a phase to the |1⟩ amplitude.', wiki: `${GATE}#Phase_shift_gates` },
  rz: { full: 'Z rotation', does: 'Rotates the qubit about the Z axis of the Bloch sphere. On IBM-style chips it costs nothing: it is done by relabelling the phase of later pulses.', wiki: 'Bloch_sphere' },
  rx: { full: 'X rotation', does: 'Rotates the qubit about the X axis of the Bloch sphere.', wiki: 'Bloch_sphere' },
  ry: { full: 'Y rotation', does: 'Rotates the qubit about the Y axis of the Bloch sphere.', wiki: 'Bloch_sphere' },
  sx: { full: 'Square root of X', does: 'Half of a NOT: two in a row flip the qubit. One of IBM\'s native pulses.', wiki: `${GATE}#Exponents_of_quantum_gates` },
  sxdg: { full: 'Square root of X, inverse', does: 'Undoes a √X.', wiki: `${GATE}#Exponents_of_quantum_gates` },
  u: { full: 'General one-qubit rotation', does: 'Any rotation of one qubit, given by three angles.', wiki: 'Bloch_sphere' },
  u2: { full: 'U2', does: 'A one-qubit rotation given by two angles.', wiki: 'Bloch_sphere' },
  u3: { full: 'U3', does: 'Any rotation of one qubit, given by three angles.', wiki: 'Bloch_sphere' },
  id: { full: 'Identity', does: 'Does nothing.', wiki: `${GATE}#Identity_gate` },
  cx: { full: 'Controlled-NOT', does: 'Flips the target qubit when the control is |1⟩. The workhorse two-qubit gate, and the one that needs the two qubits to be connected.', wiki: 'Controlled_NOT_gate' },
  cz: { full: 'Controlled-Z', does: 'Flips the sign when both qubits are |1⟩.', wiki: `${GATE}#Controlled_gates` },
  cy: { full: 'Controlled-Y', does: 'Applies Y to the target when the control is |1⟩.', wiki: `${GATE}#Controlled_gates` },
  ch: { full: 'Controlled-Hadamard', does: 'Applies H to the target when the control is |1⟩.', wiki: `${GATE}#Controlled_gates` },
  cp: { full: 'Controlled phase', does: 'Adds a phase when both qubits are |1⟩. The QFT is built from these.', wiki: `${GATE}#Controlled_gates` },
  crx: { full: 'Controlled X rotation', does: 'Rotates the target about X when the control is |1⟩.', wiki: `${GATE}#Controlled_gates` },
  cry: { full: 'Controlled Y rotation', does: 'Rotates the target about Y when the control is |1⟩.', wiki: `${GATE}#Controlled_gates` },
  crz: { full: 'Controlled Z rotation', does: 'Rotates the target about Z when the control is |1⟩.', wiki: `${GATE}#Controlled_gates` },
  cu: { full: 'Controlled-U', does: 'Applies a general rotation to the target when the control is |1⟩.', wiki: `${GATE}#Controlled_gates` },
  swap: { full: 'SWAP', does: 'Exchanges the states of two qubits. On hardware it costs three CNOTs, which is why routing is expensive.', wiki: `${GATE}#Swap_gate` },
  ccx: { full: 'Toffoli (CCNOT)', does: 'Flips the target only when both controls are |1⟩. Needs all three qubits to interact.', wiki: 'Toffoli_gate' },
  ccz: { full: 'Controlled-controlled-Z', does: 'Flips the sign only when all three qubits are |1⟩.', wiki: 'Toffoli_gate' },
  gpi: { full: 'GPI (IonQ native)', does: 'A full-turn laser pulse on one ion, about an axis in the XY plane set by its phase (in turns).', wiki: 'Trapped-ion_quantum_computer#Arbitrary_single_qubit_rotation' },
  gpi2: { full: 'GPI2 (IonQ native)', does: 'A half-turn laser pulse on one ion, about an axis in the XY plane set by its phase (in turns).', wiki: 'Trapped-ion_quantum_computer#Arbitrary_single_qubit_rotation' },
  ms: { full: 'Mølmer–Sørensen (IonQ native)', does: 'Entangles two ions through their shared motion. Any pair of ions in the chain can do this, so no SWAPs are needed.', wiki: 'M%C3%B8lmer%E2%80%93S%C3%B8rensen_gate' },
  zz: { full: 'ZZ (IonQ native)', does: 'A two-ion phase interaction used on IonQ Forte.', wiki: 'Trapped-ion_quantum_computer#Two_qubit_entangling_gates' },
  rzz: { full: 'ZZ rotation', does: 'A two-qubit phase interaction, like an Ising coupling.', wiki: 'Ising_model' },
  rxx: { full: 'XX rotation', does: 'A two-qubit interaction; the Mølmer–Sørensen gate is one of these.', wiki: 'M%C3%B8lmer%E2%80%93S%C3%B8rensen_gate' },
  ryy: { full: 'YY rotation', does: 'A two-qubit interaction about Y.', wiki: GATE },
  ecr: { full: 'Echoed cross-resonance', does: 'A two-qubit pulse used natively on some IBM chips.', wiki: 'Superconducting_quantum_computing' },
  unitary: { full: 'Unitary block', does: 'A block described only by its matrix.', wiki: 'Unitary_matrix' },
};

export function gateInfo(name) {
  return GATES[name] || { full: name.toUpperCase(), does: 'A quantum gate.', wiki: GATE };
}

export const CONCEPTS = {
  transpiler: 'Source-to-source_compiler',
  qubit: 'Qubit',
  ancilla: 'Ancilla_bit',
  depth: 'Circuit_complexity',
  circuit: 'Quantum_circuit',
  fidelity: 'Fidelity_of_quantum_states',
  noise: 'Quantum_noise',
  connectivity: 'Graph_(discrete_mathematics)',
  colorblind: 'Color_blindness',
};

export const PRESET_WIKI = {
  ghz_chain: 'Greenberger%E2%80%93Horne%E2%80%93Zeilinger_state',
  ghz_star: 'Greenberger%E2%80%93Horne%E2%80%93Zeilinger_state',
  qft: 'Quantum_Fourier_transform',
  grover3: 'Grover%27s_algorithm',
  random5: 'Quantum_circuit',
  custom: 'OpenQASM',
};

export const TARGET_WIKI = {
  heavy_hex: 'Superconducting_quantum_computing',
  full_ibm: 'Superconducting_quantum_computing',
  ionq: 'Trapped-ion_quantum_computer',
};
