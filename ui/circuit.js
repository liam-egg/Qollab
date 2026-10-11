// Draws one snapshot's gate list as an SVG circuit diagram.
// Gates are placed greedily into columns in the order the trace lists them
// (topological order), so the drawing's column count tracks circuit depth.

import { formatParams, gateLabel, STATUS_WORDS } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ROW_H = 46;
const COL_W = 50;
const LEFT = 92;
const RIGHT = 56;
const TOP = 26;
const BOX = 36;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// Which wires to draw: every qubit a gate touches plus the qubits the layout
// assigns, so idle ancillas on a 19-qubit chip don't swamp the picture.
export function visibleWires(step) {
  const used = new Set();
  for (const [, qs] of step.gates) qs.forEach((q) => used.add(q));
  if (step.layout) {
    step.layout.initial.forEach((q) => used.add(q));
    step.layout.final.forEach((q) => used.add(q));
  }
  if (used.size === 0) for (let q = 0; q < step.num_qubits; q++) used.add(q);
  return [...used].sort((a, b) => a - b);
}

export function placeGates(gates, rowOf) {
  const nextFree = new Map();
  let width = 0;
  const placed = gates.map((g) => {
    const rows = g[1].map((q) => rowOf.get(q));
    const lo = Math.min(...rows);
    const hi = Math.max(...rows);
    let col = 0;
    for (let r = lo; r <= hi; r++) col = Math.max(col, nextFree.get(r) || 0);
    for (let r = lo; r <= hi; r++) nextFree.set(r, col + 1);
    width = Math.max(width, col + 1);
    return { gate: g, rows, lo, hi, col };
  });
  return { placed, columns: width };
}

// Wire labels. Once a layout exists, wires are physical qubits ("Q7") and the
// logical qubit that starts / ends on each one is shown at the left / right.
function wireLabels(step, wires, isPhysical) {
  const start = new Map();
  const end = new Map();
  if (step.layout) {
    step.layout.initial.forEach((phys, v) => start.set(phys, v));
    step.layout.final.forEach((phys, v) => end.set(phys, v));
  } else {
    wires.forEach((q) => { start.set(q, q); end.set(q, q); });
  }
  return wires.map((q) => ({
    q,
    name: isPhysical ? `Q${q}` : `q${q}`,
    start: isPhysical && start.has(q) ? `q${start.get(q)}` : '',
    end: end.has(q) ? `q${end.get(q)}` : '',
  }));
}

function describeGate(g, labelFor) {
  const [name, qs, ps, status] = g;
  const params = formatParams(name, ps);
  const on = qs.map(labelFor).join(name === 'cx' ? ' → ' : ', ');
  return `${gateLabel(name)}${params ? `(${params})` : ''} on ${on}, ${STATUS_WORDS[status]}`;
}

function drawBadge(g, x, y, status) {
  if (status === 'keep') return;
  const badge = el('g', { class: 'badge' }, g);
  el('circle', { cx: x, cy: y, r: 7 }, badge);
  const t = el('text', { x, y: y + 3.5, 'text-anchor': 'middle' }, badge);
  t.textContent = status === 'add' ? '+' : '↔';
}

function drawBox(g, cx, y1, y2, label, params) {
  const h = Math.max(BOX, y2 - y1 + BOX);
  const top = (y1 + y2) / 2 - h / 2;
  el('rect', { x: cx - BOX / 2, y: top, width: BOX, height: h, rx: 5, class: 'gate-box' }, g);
  const ty = (y1 + y2) / 2 + (params ? -2 : 4);
  const t = el('text', { x: cx, y: ty, 'text-anchor': 'middle', class: 'gate-label' }, g);
  t.textContent = label;
  if (label.length > 3) t.setAttribute('textLength', String(BOX - 6));
  if (params) {
    const p = el('text', { x: cx, y: ty + 11, 'text-anchor': 'middle', class: 'gate-param' }, g);
    p.textContent = params.length > 7 ? `${params.slice(0, 6)}…` : params;
  }
  return top;
}

const CONTROLLED = {
  cx: { controls: 1, target: 'x' },
  ccx: { controls: 2, target: 'x' },
  cz: { controls: 1, target: 'dot' },
  ccz: { controls: 2, target: 'dot' },
  cp: { controls: 1, target: 'dot' },
  cy: { controls: 1, target: 'Y' },
  ch: { controls: 1, target: 'H' },
  crx: { controls: 1, target: 'Rx' },
  cry: { controls: 1, target: 'Ry' },
  crz: { controls: 1, target: 'Rz' },
  cu: { controls: 1, target: 'U' },
  cu1: { controls: 1, target: 'U1' },
  csx: { controls: 1, target: '√X' },
};

export function renderCircuit(svg, step, { isPhysical }) {
  while (svg.lastChild && svg.lastChild.nodeName !== 'desc') svg.removeChild(svg.lastChild);
  const wires = visibleWires(step);
  const rowOf = new Map(wires.map((q, i) => [q, i]));
  const { placed, columns } = placeGates(step.gates, rowOf);
  const width = LEFT + Math.max(columns, 1) * COL_W + RIGHT;
  const height = TOP * 2 + (wires.length - 1) * ROW_H;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);

  const labels = wireLabels(step, wires, isPhysical);
  const labelFor = (q) => (isPhysical ? `Q${q}` : `q${q}`);
  const wireLayer = el('g', { class: 'wires' }, svg);
  labels.forEach((w, i) => {
    const y = TOP + i * ROW_H;
    el('line', { x1: LEFT - 8, x2: width - RIGHT + 8, y1: y, y2: y, class: 'wire' }, wireLayer);
    const name = el('text', { x: 8, y: y + 4, class: 'wire-name' }, wireLayer);
    name.textContent = w.name;
    if (w.start) {
      const s = el('text', { x: LEFT - 14, y: y + 4, 'text-anchor': 'end', class: 'wire-logical' }, wireLayer);
      s.textContent = w.start;
    }
    if (w.end) {
      const e = el('text', { x: width - RIGHT + 14, y: y + 4, class: 'wire-logical' }, wireLayer);
      e.textContent = w.end;
    }
  });

  const gateLayer = el('g', { class: 'gates' }, svg);
  for (const { gate, rows, lo, hi, col } of placed) {
    const [name, , ps, status] = gate;
    const cx = LEFT + col * COL_W + COL_W / 2;
    const ys = rows.map((r) => TOP + r * ROW_H);
    const yLo = TOP + lo * ROW_H;
    const yHi = TOP + hi * ROW_H;
    const g = el('g', { class: `gate s-${status}` }, gateLayer);
    el('title', {}, g).textContent = describeGate(gate, labelFor);
    const params = formatParams(name, ps);
    const ctrl = CONTROLLED[name];
    let badgeY = yLo - BOX / 2;

    if (rows.length === 1) {
      badgeY = drawBox(g, cx, yLo, yLo, gateLabel(name), params);
    } else if (name === 'swap') {
      el('line', { x1: cx, x2: cx, y1: yLo, y2: yHi, class: 'gate-line' }, g);
      for (const y of ys) {
        el('path', { d: `M${cx - 7} ${y - 7}L${cx + 7} ${y + 7}M${cx - 7} ${y + 7}L${cx + 7} ${y - 7}`, class: 'gate-stroke' }, g);
      }
      badgeY = yLo - 10;
    } else if (ctrl && rows.length === ctrl.controls + 1) {
      const targetY = ys[ys.length - 1];
      el('line', { x1: cx, x2: cx, y1: yLo, y2: yHi, class: 'gate-line' }, g);
      for (const y of ys.slice(0, -1)) el('circle', { cx, cy: y, r: 5.5, class: 'gate-dot' }, g);
      if (ctrl.target === 'x') {
        el('circle', { cx, cy: targetY, r: 12, class: 'gate-target' }, g);
        el('path', { d: `M${cx - 12} ${targetY}H${cx + 12}M${cx} ${targetY - 12}V${targetY + 12}`, class: 'gate-stroke' }, g);
      } else if (ctrl.target === 'dot') {
        el('circle', { cx, cy: targetY, r: 5.5, class: 'gate-dot' }, g);
        if (params) {
          const t = el('text', { x: cx + 9, y: (yLo + yHi) / 2 + 4, class: 'gate-param' }, g);
          t.textContent = params;
        }
      } else {
        drawBox(g, cx, targetY, targetY, ctrl.target, params);
      }
      badgeY = yLo - 10;
    } else {
      // Generic multi-qubit gate (MS, RZZ, ECR, ...): a box spanning its wires,
      // with ticks marking the wires it actually acts on.
      badgeY = drawBox(g, cx, yLo, yHi, gateLabel(name), params);
      for (const y of ys) el('line', { x1: cx - BOX / 2 - 4, x2: cx - BOX / 2, y1: y, y2: y, class: 'gate-stroke' }, g);
    }
    drawBadge(g, cx + BOX / 2 - 2, badgeY + 1, status);
  }
  return { wires: wires.length, columns };
}

export function gateListTable(step, isPhysical) {
  const labelFor = (q) => (isPhysical ? `Q${q}` : `q${q}`);
  const rows = step.gates.map((g, i) => {
    const [name, qs, ps, status] = g;
    return `<tr><td>${i + 1}</td><td>${gateLabel(name)}</td><td>${qs.map(labelFor).join(', ')}</td><td>${formatParams(name, ps) || '–'}</td><td>${STATUS_WORDS[status]}</td></tr>`;
  });
  return `<table class="gate-table"><thead><tr><th scope="col">#</th><th scope="col">Gate</th><th scope="col">Qubits</th><th scope="col">Parameters</th><th scope="col">This pass</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
