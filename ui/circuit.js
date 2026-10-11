// The stage: draws a snapshot's gate list as an SVG circuit that fills the
// player, and animates between snapshots.
//
// Layout. Gates go greedily into columns in the trace's (topological) order,
// so the column count tracks depth. Long circuits fold onto several bands,
// like wrapped text, choosing the band count that makes gates largest on the
// current screen.
//
// Motion. Each drawn gate keeps an identity across passes. Going from one
// snapshot to the next, gates the pass kept stay put or slide to their new
// column (FLIP), gates it moved onto other qubits slide there, added gates
// grow in, removed gates fade out, and the camera eases to the new extent.

import { formatParams, gateLabel, STATUS_WORDS } from './format.js';
import { gateInfo, wikiTitle, wikiUrl } from './wiki.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ROW_H = 46;
const COL_W = 50;
const LEFT = 92;
const RIGHT = 56;
const TOP = 30;
const BAND_GAP = 30;
const BOX = 36;
const MAX_SCALE = 2.4;
// Zoom limits relative to the fitted view, and how much of the circuit must
// stay on screen however far the viewer pans.
const MAX_ZOOM = 8;
const MIN_ZOOM = 0.6;
const KEEP_VISIBLE = 0.3;

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const MOVE_MS = 640;
const ENTER_MS = 520;
const EXIT_MS = 240;

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

function placeGates(gates, rowOf) {
  const nextFree = new Map();
  let columns = 0;
  const placed = gates.map((g) => {
    const rows = g[1].map((q) => rowOf.get(q));
    const lo = Math.min(...rows);
    const hi = Math.max(...rows);
    let col = 0;
    for (let r = lo; r <= hi; r++) col = Math.max(col, nextFree.get(r) || 0);
    for (let r = lo; r <= hi; r++) nextFree.set(r, col + 1);
    columns = Math.max(columns, col + 1);
    return { rows, lo, hi, col };
  });
  return { placed, columns: Math.max(columns, 1) };
}

// Pick the band count that gives the largest scale in the available box.
function chooseFold(columns, rowCount, box) {
  const bandH = (rowCount - 1) * ROW_H + 2 * TOP;
  let best = null;
  for (let bands = 1; bands <= Math.min(8, columns); bands++) {
    const perBand = Math.ceil(columns / bands);
    const w = LEFT + perBand * COL_W + RIGHT;
    const h = bands * bandH + (bands - 1) * BAND_GAP;
    const scale = Math.min(box.w / w, box.h / h);
    if (!best || scale > best.scale * 1.04) best = { bands, perBand, w, h, bandH, scale };
  }
  return best;
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

function drawBadge(g, x, y, status) {
  if (status === 'keep') return;
  const badge = el('g', { class: 'badge' }, g);
  el('circle', { cx: x, cy: y, r: 7 }, badge);
  if (status === 'add') {
    el('path', { d: `M${x - 3.5} ${y}H${x + 3.5}M${x} ${y - 3.5}V${y + 3.5}`, class: 'badge-mark' }, badge);
  } else {
    el('path', { d: `M${x - 4} ${y}H${x + 4}M${x - 1.8} ${y - 2.2}L${x - 4} ${y}L${x - 1.8} ${y + 2.2}M${x + 1.8} ${y - 2.2}L${x + 4} ${y}L${x + 1.8} ${y + 2.2}`, class: 'badge-mark' }, badge);
  }
}

// Draws one gate into group g with its top-left anchor at (cx, yLo).
function drawGate(g, gate, cx, ys, yLo, yHi) {
  const [name, , ps, status] = gate;
  g.setAttribute('class', `gate s-${status}`);
  const params = formatParams(name, ps);
  const ctrl = CONTROLLED[name];
  let badgeY = yLo - BOX / 2;
  if (ys.length === 1) {
    badgeY = drawBox(g, cx, yLo, yLo, gateLabel(name), params);
  } else if (name === 'swap') {
    el('line', { x1: cx, x2: cx, y1: yLo, y2: yHi, class: 'gate-line' }, g);
    for (const y of ys) {
      el('path', { d: `M${cx - 7} ${y - 7}L${cx + 7} ${y + 7}M${cx - 7} ${y + 7}L${cx + 7} ${y - 7}`, class: 'gate-stroke' }, g);
    }
    badgeY = yLo - 10;
  } else if (ctrl && ys.length === ctrl.controls + 1) {
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

// Translate a previous snapshot's qubit index into the next one's numbering
// when the wires were renumbered from logical to physical (or back).
function qubitMapper(prev, next) {
  if (!prev || prev.physical === next.physical) return (q) => q;
  if (!prev.physical && next.layout) return (q) => (q < next.layout.initial.length ? next.layout.initial[q] : q);
  if (prev.physical && prev.layout) {
    const back = new Map(prev.layout.initial.map((phys, v) => [phys, v]));
    return (q) => (back.has(q) ? back.get(q) : q);
  }
  return (q) => q;
}

const sigOf = (name, qs, ps) => `${name}|${qs.join(',')}|${ps.join(',')}`;
const looseOf = (name, ps) => `${name}|${ps.join(',')}`;

function take(pool, key) {
  const list = pool.get(key);
  return list && list.length ? list.shift() : null;
}

// Pair each next gate with a previous drawn gate. `direction` is 'forward' or
// 'backward' when the two snapshots are one diff apart (then only gates the
// diff marks as moved may match on name alone), or null for a longer jump.
function matchGates(prevEntries, prevStep, nextStep, direction) {
  const map = qubitMapper(prevStep, nextStep);
  const exact = new Map();
  const mapped = prevEntries.map((e) => ({ ...e, qs: e.gate[1].map(map) }));
  for (const e of mapped) {
    const key = sigOf(e.gate[0], e.qs, e.gate[2]);
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(e);
  }
  const used = new Set();
  const result = nextStep.gates.map((g) => {
    const hit = take(exact, sigOf(g[0], g[1], g[2]));
    if (hit) used.add(hit.id);
    return hit ? hit.id : null;
  });
  const loose = new Map();
  for (const e of mapped) {
    if (used.has(e.id)) continue;
    if (direction === 'backward' && e.gate[3] !== 'move') continue;
    const key = looseOf(e.gate[0], e.gate[2]);
    if (!loose.has(key)) loose.set(key, []);
    loose.get(key).push(e);
  }
  nextStep.gates.forEach((g, i) => {
    if (result[i] !== null) return;
    if (direction === 'forward' && g[3] !== 'move') return;
    const hit = take(loose, looseOf(g[0], g[2]));
    if (hit) {
      used.add(hit.id);
      result[i] = hit.id;
    }
  });
  return { ids: result, gone: prevEntries.filter((e) => !used.has(e.id)) };
}

function currentOffset(node) {
  const t = getComputedStyle(node).transform;
  if (!t || t === 'none') return [0, 0];
  const m = new DOMMatrixReadOnly(t);
  return [m.e, m.f];
}

const easeOutQuart = (t) => 1 - (1 - t) ** 4;

export class Stage {
  constructor(svg) {
    this.svg = svg;
    this.wireLayer = svg.querySelector('.wires');
    this.gateLayer = svg.querySelector('.gates');
    this.entries = []; // [{ id, gate, node, x, y }]
    this.wires = new Map(); // key -> { node, y }
    this.step = null;
    this.nextId = 1;
    this.view = null; // current viewBox [x, y, w, h]
    this.fitView = null; // the view that fits the whole circuit
    this.userView = null; // set while the viewer has zoomed or panned
    this.content = { w: 1, h: 1 };
    this.onViewChange = null;
    this.cameraFrame = null;
    this.layoutInfo = null;
  }

  // Available drawing box in CSS pixels: the player minus the overlaid top
  // bar, the controls and a fixed allowance for a two-line caption (fixed so
  // the camera doesn't jump with each caption's length).
  measure() {
    const player = this.svg.parentElement;
    const r = player.getBoundingClientRect();
    const narrow = r.width < 640;
    const bar = player.querySelector('.topbar > :last-child').getBoundingClientRect();
    const scrub = player.querySelector('.scrub').getBoundingClientRect();
    const insetTop = bar.bottom - r.top + 14;
    const insetBottom = r.bottom - scrub.top + (narrow ? 132 : 112);
    return {
      w: Math.max(r.width - (narrow ? 16 : 48), 200),
      h: Math.max(r.height - insetTop - insetBottom, 140),
      W: r.width, H: r.height, insetTop, insetBottom,
    };
  }

  render(step, { isPhysical, direction = null, animate = true }) {
    const motion = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fade = animate; // reduced motion still crossfades
    const labelFor = (q) => (isPhysical ? `Q${q}` : `q${q}`);
    const wires = visibleWires(step);
    const rowOf = new Map(wires.map((q, i) => [q, i]));
    const { placed, columns } = placeGates(step.gates, rowOf);
    const box = this.measure();
    const fold = chooseFold(columns, wires.length, box);
    this.layoutInfo = { wires: wires.length, columns, bands: fold.bands };
    const bandTop = (b) => b * (fold.bandH + BAND_GAP);
    const pos = (col, row) => {
      const band = Math.floor(col / fold.perBand);
      return {
        band,
        x: LEFT + (col % fold.perBand) * COL_W + COL_W / 2,
        y: bandTop(band) + TOP + row * ROW_H,
      };
    };

    // ----- wires (one set per band) -----
    const start = new Map();
    const end = new Map();
    if (step.layout) {
      step.layout.initial.forEach((phys, v) => start.set(phys, v));
      step.layout.final.forEach((phys, v) => end.set(phys, v));
    } else {
      wires.forEach((q) => { start.set(q, q); end.set(q, q); });
    }
    const keepWires = new Set();
    for (let b = 0; b < fold.bands; b++) {
      wires.forEach((q, r) => {
        const key = `${isPhysical ? 'P' : 'L'}${q}@${b}`;
        keepWires.add(key);
        const y = bandTop(b) + TOP + r * ROW_H;
        const old = this.wires.get(key);
        const node = old ? old.node : el('g', { class: 'wire-row' }, this.wireLayer);
        const oldY = old ? old.y + currentOffset(node)[1] : null;
        node.getAnimations().forEach((a) => a.cancel());
        node.replaceChildren();
        node.dataset.q = String(q);
        el('line', { x1: LEFT - 10, x2: fold.w - RIGHT + 10, y1: y, y2: y, class: 'wire' }, node);
        el('text', { x: 6, y: y + 4, class: 'wire-name' }, node).textContent = labelFor(q);
        if (b === 0 && isPhysical && start.has(q)) {
          el('text', { x: LEFT - 16, y: y + 4, 'text-anchor': 'end', class: 'wire-logical' }, node).textContent = `q${start.get(q)}`;
        }
        if (b === fold.bands - 1 && end.has(q)) {
          el('text', { x: fold.w - RIGHT + 16, y: y + 4, class: 'wire-logical' }, node).textContent = `q${end.get(q)}`;
        }
        if (old && motion && oldY !== y) {
          node.animate([{ transform: `translate(0px, ${oldY - y}px)` }, { transform: 'translate(0px, 0px)' }], { duration: MOVE_MS, easing: EASE_OUT });
        } else if (!old && fade) {
          node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: EASE_OUT });
        }
        this.wires.set(key, { node, y });
      });
    }
    for (const [key, w] of this.wires) {
      if (keepWires.has(key)) continue;
      this.wires.delete(key);
      if (fade) {
        w.node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: EXIT_MS, fill: 'forwards' }).finished
          .then(() => w.node.remove(), () => w.node.remove());
      } else {
        w.node.remove();
      }
    }

    // ----- gates -----
    const { ids, gone } = matchGates(this.entries, this.step, step, direction);
    const byId = new Map(this.entries.map((e) => [e.id, e]));
    const nextEntries = [];
    placed.forEach((p, i) => {
      const gate = step.gates[i];
      const anchor = pos(p.col, p.lo);
      const ys = p.rows.map((r) => pos(p.col, r).y);
      const yLo = anchor.y;
      const yHi = pos(p.col, p.hi).y;
      const prev = ids[i] !== null ? byId.get(ids[i]) : null;
      const node = prev ? prev.node : el('g', {}, this.gateLayer);
      let fromX = 0;
      let fromY = 0;
      if (prev) {
        const [ox, oy] = currentOffset(node);
        fromX = prev.x + ox - anchor.x;
        fromY = prev.y + oy - anchor.y;
      }
      node.getAnimations().forEach((a) => a.cancel());
      node.replaceChildren();
      drawGate(node, gate, anchor.x, ys, yLo, yHi);
      node.dataset.idx = String(i);
      if (prev && motion && (fromX || fromY)) {
        node.animate([{ transform: `translate(${fromX}px, ${fromY}px)` }, { transform: 'translate(0px, 0px)' }], { duration: MOVE_MS, easing: EASE_OUT });
      } else if (!prev && fade) {
        const delay = Math.min(p.col * 10, 220) + (motion ? 120 : 0);
        const frames = motion
          ? [{ opacity: 0, transform: 'scale(0.35)' }, { opacity: 1, transform: 'scale(1)' }]
          : [{ opacity: 0 }, { opacity: 1 }];
        node.animate(frames, { duration: motion ? ENTER_MS : 220, delay, easing: EASE_OUT, fill: 'backwards' });
      }
      // Where a moved gate came from, for the hover card.
      const from = prev && prev.gate[1].join() !== gate[1].join() ? { qubits: prev.gate[1], physical: this.step.physical } : null;
      nextEntries.push({ id: prev ? prev.id : this.nextId++, gate, node, x: anchor.x, y: anchor.y, from });
    });
    for (const e of gone) {
      const frames = motion
        ? [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.5)' }]
        : [{ opacity: 1 }, { opacity: 0 }];
      e.node.classList.add('is-leaving');
      if (fade) {
        e.node.getAnimations().forEach((a) => a.cancel());
        e.node.animate(frames, { duration: EXIT_MS, easing: 'ease-in', fill: 'forwards' }).finished
          .then(() => e.node.remove(), () => e.node.remove());
      } else {
        e.node.remove();
      }
    }
    // Keep paint order stable: leaving gates under, current gates in order.
    for (const e of nextEntries) this.gateLayer.appendChild(e.node);
    this.entries = nextEntries;
    this.step = step;

    // ----- camera -----
    const scale = Math.min(fold.scale, MAX_SCALE);
    const vw = box.W / scale;
    const vh = box.H / scale;
    const cy = fold.h / 2 - ((box.insetTop - box.insetBottom) / 2) / scale;
    this.fitView = [fold.w / 2 - vw / 2, cy - vh / 2, vw, vh];
    this.content = { w: fold.w, h: fold.h };
    // A viewer who zoomed in keeps their zoom from pass to pass; the view is
    // only nudged back if the circuit shrank out from under it.
    if (this.userView) this.userView = this.clampView(this.userView);
    this.moveCamera(this.userView || this.fitView, motion);
    return this.layoutInfo;
  }

  // ----- zoom and pan -----

  zoom() {
    return this.fitView && this.view ? this.fitView[2] / this.view[2] : 1;
  }

  // Keep the zoom within limits and at least KEEP_VISIBLE of the circuit on
  // screen in each direction, so the viewer can't lose it.
  clampView(v) {
    const fit = this.fitView;
    const aspect = fit[3] / fit[2];
    const w = Math.min(Math.max(v[2], fit[2] / MAX_ZOOM), fit[2] / MIN_ZOOM);
    const h = w * aspect;
    const cx = v[0] + v[2] / 2;
    const cy = v[1] + v[3] / 2;
    const mx = KEEP_VISIBLE * Math.min(w, this.content.w);
    const my = KEEP_VISIBLE * Math.min(h, this.content.h);
    const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
    return [clamp(cx - w / 2, mx - w, this.content.w - mx), clamp(cy - h / 2, my - h, this.content.h - my), w, h];
  }

  setUserView(v, animate) {
    const next = this.clampView(v);
    const fit = this.fitView;
    const nearFit = Math.abs(next[2] - fit[2]) / fit[2] < 0.01
      && Math.abs(next[0] - fit[0]) < 2 && Math.abs(next[1] - fit[1]) < 2;
    this.userView = nearFit ? null : next;
    this.moveCamera(next, animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches, 300);
    if (this.onViewChange) this.onViewChange();
  }

  // Zoom by `factor`, keeping the point under (clientX, clientY) still.
  zoomAt(factor, clientX, clientY, animate = false) {
    if (!this.view) return;
    const r = this.svg.getBoundingClientRect();
    const v = this.userView || this.view;
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    const px = v[0] + fx * v[2];
    const py = v[1] + fy * v[3];
    const w = v[2] / factor;
    const h = v[3] / factor;
    this.setUserView([px - fx * w, py - fy * h, w, h], animate);
  }

  zoomCenter(factor, animate = true) {
    const r = this.svg.getBoundingClientRect();
    this.zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2, animate);
  }

  // Pan by a distance in screen pixels.
  panBy(dx, dy, animate = false) {
    if (!this.view) return;
    const r = this.svg.getBoundingClientRect();
    const v = this.userView || this.view;
    this.setUserView([v[0] - (dx * v[2]) / r.width, v[1] - (dy * v[3]) / r.height, v[2], v[3]], animate);
  }

  fit(animate = true) {
    this.userView = null;
    if (this.fitView) this.moveCamera(this.fitView, animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches, 360);
    if (this.onViewChange) this.onViewChange();
  }

  // ----- hover highlighting -----

  entryAt(node) {
    const g = node && node.closest ? node.closest('.gate') : null;
    if (!g || g.classList.contains('is-leaving') || g.dataset.idx === undefined) return null;
    return this.entries[Number(g.dataset.idx)] || null;
  }

  highlight({ gates = [], qubits = [] } = {}) {
    const on = gates.length > 0 || qubits.length > 0;
    this.svg.classList.toggle('has-hot', on);
    const hotGates = new Set(gates);
    for (const e of this.entries) e.node.classList.toggle('is-hot', hotGates.has(e));
    const hotQ = new Set(qubits.map(String));
    for (const { node } of this.wires.values()) node.classList.toggle('is-hot', hotQ.has(node.dataset.q));
  }

  moveCamera(target, motion, duration = MOVE_MS) {
    if (this.cameraFrame) cancelAnimationFrame(this.cameraFrame);
    const from = this.view;
    const apply = (v) => {
      this.view = v;
      this.svg.setAttribute('viewBox', v.map((n) => n.toFixed(2)).join(' '));
    };
    if (!from || !motion) {
      apply(target);
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min((now - t0) / duration, 1);
      const k = easeOutQuart(t);
      apply(from.map((a, i) => a + (target[i] - a) * k));
      if (t < 1) this.cameraFrame = requestAnimationFrame(tick);
    };
    this.cameraFrame = requestAnimationFrame(tick);
  }
}

export function gateListTable(step, isPhysical) {
  const labelFor = (q) => (isPhysical ? `Q${q}` : `q${q}`);
  const rows = step.gates.map((g, i) => {
    const [name, qs, ps, status] = g;
    const info = gateInfo(name);
    const link = `<a class="wiki" href="${wikiUrl(info.wiki)}" target="_blank" rel="noopener" title="${wikiTitle(info.wiki)} (Wikipedia)">${info.full}</a>`;
    return `<tr><td>${i + 1}</td><td>${gateLabel(name)}</td><td>${qs.map(labelFor).join(', ')}</td><td>${formatParams(name, ps) || '–'}</td><td>${STATUS_WORDS[status]}</td><td>${link}</td></tr>`;
  });
  return `<table class="gate-table"><thead><tr><th scope="col">#</th><th scope="col">Gate</th><th scope="col">Qubits</th><th scope="col">Parameters</th><th scope="col">This pass</th><th scope="col">Read more (Wikipedia)</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
