// Small formatting helpers shared by the panels.

// IonQ's GPI/GPI2/MS take angles in turns (fractions of a full rotation);
// every other gate here takes radians.
const TURN_GATES = new Set(['gpi', 'gpi2', 'ms', 'zz']);

const GATE_LABELS = {
  h: 'H', x: 'X', y: 'Y', z: 'Z', s: 'S', sdg: 'S†', t: 'T', tdg: 'T†', sx: '√X', sxdg: '√X†',
  rx: 'Rx', ry: 'Ry', rz: 'Rz', p: 'P', u: 'U', u1: 'U1', u2: 'U2', u3: 'U3', r: 'R',
  gpi: 'GPI', gpi2: 'GPI2', ms: 'MS', zz: 'ZZ', rxx: 'Rxx', ryy: 'Ryy', rzz: 'Rzz', rzx: 'Rzx',
  ecr: 'ECR', iswap: 'iSWAP', dcx: 'DCX', id: 'I', unitary: 'U',
};

export function gateLabel(name) {
  return GATE_LABELS[name] || name.toUpperCase();
}

function piFraction(x) {
  if (Math.abs(x) < 1e-9) return '0';
  const r = x / Math.PI;
  for (let d = 1; d <= 16; d++) {
    const n = Math.round(r * d);
    // Parameters arrive rounded to 6 decimals, hence the loose tolerance.
    if (n !== 0 && Math.abs(r * d - n) < 1e-4) {
      const sign = n < 0 ? '−' : '';
      const num = Math.abs(n) === 1 ? 'π' : `${Math.abs(n)}π`;
      return d === 1 ? `${sign}${num}` : `${sign}${num}/${d}`;
    }
  }
  return trimNumber(x);
}

export function trimNumber(x, digits = 3) {
  const s = Number(x).toFixed(digits).replace(/\.?0+$/, '');
  return s.replace('-', '−');
}

export function formatParams(name, params) {
  if (!params || params.length === 0) return '';
  return params
    .map((p) => (typeof p === 'number' ? (TURN_GATES.has(name) ? trimNumber(p) : piFraction(p)) : String(p)))
    .join(', ');
}

export function signed(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '±0';
}

export function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

export function percent(p) {
  return `${(p * 100).toFixed(p >= 0.995 || p < 0.1 ? 1 : 0)}%`;
}

export const STATUS_WORDS = { keep: 'unchanged', add: 'added', move: 'moved' };
