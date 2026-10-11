// Transpile Lens: entry point. Python (lens/) produces the traces; this file
// owns the UI. Only JSON strings cross the JS/Python boundary.
import * as service from 'lens.service';
import { gateListTable, Stage } from './ui/circuit.js';
import { CAUSE_NAMES, noteFor, STAGE_NAMES, STAGE_NOTES, wikiForPass } from './ui/explain.js';
import { formatParams, gateLabel, plural, signed } from './ui/format.js';
import { createStageHover, initTips } from './ui/hover.js';
import { CONCEPTS, PRESET_WIKI, TARGET_WIKI, wikiLink } from './ui/wiki.js';
import {
  budgetSentence, compareSentence, METRICS, renderBudget, renderCompare,
} from './ui/panels.js';

const $ = (id) => document.getElementById(id);

const state = {
  presets: [],
  bundles: new Map(),
  bundle: null,
  targetId: 'heavy_hex',
  visible: [], // indices into trace.steps shown on the timeline
  pos: 0, // position within `visible`
  shownIdx: null, // trace step index currently drawn
  showAll: false,
  metric: 'depth',
  timer: null,
  captions: true,
  idleTimer: null,
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const stage = new Stage($('circuit'));
const player = $('player');
const hover = createStageHover({
  stage,
  player,
  card: $('hovercard'),
  getContext: () => {
    const step = stage.step;
    if (!step) return null;
    return { step, isPhysical: step.physical, passName: step.i === 0 ? 'the input' : step.pass, isInput: step.i === 0 };
  },
});

async function callPython(fn, ...args) {
  const result = await fn.callPromising(...args);
  return JSON.parse(typeof result === 'string' ? result : String(result));
}

const trace = () => state.bundle.traces[state.targetId];
const stageName = (s) => STAGE_NAMES[s] || s;

// ---------- steps ----------

function computeVisible() {
  const steps = trace().steps;
  state.visible = steps
    .filter((s) => state.showAll || s.i === 0 || s.changed || s.chosen_layout)
    .map((s) => s.i);
}

// Index of the last changed snapshot at or before step i.
function effectiveIndex(i) {
  const steps = trace().steps;
  let j = i;
  while (j > 0 && !steps[j].changed) j--;
  return j;
}

// A step that changed nothing reuses the last changed snapshot's gates.
function snapshotAt(i) {
  const steps = trace().steps;
  const step = steps[i];
  if (step.changed) return step;
  const base = steps[effectiveIndex(i)];
  return { ...step, gates: base.gates.map(([n, q, p]) => [n, q, p, 'keep']), removed: [], num_qubits: base.num_qubits, physical: base.physical };
}

// 'forward' / 'backward' when the two snapshots are exactly one diff apart,
// so the stage can trust the diff's statuses when pairing gates.
function directionBetween(fromIdx, toIdx) {
  if (fromIdx === null) return null;
  const a = effectiveIndex(fromIdx);
  const b = effectiveIndex(toIdx);
  if (a === b) return 'forward';
  if (b > a && effectiveIndex(b - 1) === a) return 'forward';
  if (a > b && effectiveIndex(a - 1) === b) return 'backward';
  return null;
}

function previousMetrics(i) {
  const steps = trace().steps;
  return i > 0 ? steps[i - 1].metrics : steps[0].metrics;
}

// ---------- words ----------

function countBy(gates, status) {
  const counts = new Map();
  for (const g of gates) if (g[3] === status) counts.set(g[0], (counts.get(g[0]) || 0) + 1);
  return counts;
}

function describeCounts(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c}× ${gateLabel(n)}`).join(', ');
}

function stepSummary(step) {
  if (step.i === 0) {
    const m = step.metrics;
    return `The circuit as written: ${plural(m.size, 'gate')}, depth ${m.depth}, ${plural(m.twoq, 'two-qubit gate')}.`;
  }
  const bits = [];
  if (step.chosen_layout) {
    bits.push(`chose a placement: ${step.chosen_layout.map((p, v) => `q${v}→Q${p}`).join(', ')}`);
  }
  if (!step.changed) {
    if (!bits.length) return 'Changed nothing in the circuit.';
    return `${bits[0][0].toUpperCase()}${bits[0].slice(1)}. The wires are renumbered later, by ApplyLayout.`;
  }
  const added = countBy(step.gates, 'add');
  const moved = [...countBy(step.gates, 'move').values()].reduce((a, b) => a + b, 0);
  const removed = new Map();
  for (const [n] of step.removed) removed.set(n, (removed.get(n) || 0) + 1);
  if (added.size) bits.push(`added ${describeCounts(added)}`);
  if (removed.size) bits.push(`removed ${describeCounts(removed)}`);
  if (moved) bits.push(`moved ${plural(moved, 'gate')} onto different qubits`);
  if (step.renumbered) bits.push('renumbered the wires from logical to physical qubits');
  const prev = previousMetrics(step.i);
  const text = bits.length ? bits.join('; ') : 'rewrote gates without changing counts';
  return `${text[0].toUpperCase()}${text.slice(1)}. Depth ${prev.depth} → ${step.metrics.depth}.`;
}

function renderCaption(step) {
  const cap = $('caption');
  const label = step.i === 0 ? 'Input circuit' : step.pass;
  const where = step.i === 0 ? trace().target.label : `${stageName(step.stage)} · ${CAUSE_NAMES[step.cause]}`;
  const tail = step.i === 0 && player.classList.contains('is-poster')
    ? ' Press play to watch the transpiler rewrite it.'
    : '';
  cap.innerHTML = `<span class="cap-head"><strong></strong><span class="cap-where"></span></span><span class="cap-text"></span>`;
  cap.querySelector('strong').textContent = label;
  cap.querySelector('.cap-where').textContent = where;
  cap.querySelector('.cap-text').textContent = `${stepSummary(step)}${tail} `;
  const article = step.i === 0 ? PRESET_WIKI[state.bundle.circuit.id] : wikiForPass(step.pass, step.stage);
  if (article) {
    const link = wikiLink(article, 'Read more');
    link.dataset.tip = 'Opens the related Wikipedia article in a new tab';
    cap.querySelector('.cap-text').append(link);
  }
  if (!reducedMotion.matches) cap.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
}

function renderExplain(step) {
  $('explain-h').textContent = step.i === 0 ? 'Input circuit' : step.pass;
  $('explain-stage').textContent = step.i === 0
    ? 'Before transpiling'
    : `${stageName(step.stage)} stage · counted as ${CAUSE_NAMES[step.cause]} · step ${state.pos + 1} of ${state.visible.length}`;
  const note = step.i === 0 ? { what: state.bundle.circuit.blurb } : noteFor(step.pass);
  $('explain-what').textContent = stepSummary(step);
  const dl = $('explain-delta');
  dl.innerHTML = '';
  if (step.delta) {
    for (const key of ['depth', 'twoq', 'size', 'swaps']) {
      const label = key === 'swaps' ? 'SWAPs' : METRICS[key].label;
      const d = step.delta[key];
      dl.insertAdjacentHTML('beforeend', `<div class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}"><dt>${label}</dt><dd>${step.metrics[key]} <span>${signed(d)}</span></dd></div>`);
    }
  }
  const why = [note.what, note.why].filter(Boolean).join(' ');
  $('explain-why').textContent = step.i === 0 ? note.what : why || STAGE_NOTES[step.stage] || '';
  const further = $('explain-wiki');
  const article = step.i === 0 ? PRESET_WIKI[state.bundle.circuit.id] : wikiForPass(step.pass, step.stage);
  further.replaceChildren();
  if (article) further.append('Further reading on Wikipedia: ', wikiLink(article), '.');
  const removed = step.removed || [];
  $('explain-removed').textContent = removed.length
    ? `Removed: ${removed.slice(0, 12).map(([n, q, p]) => `${gateLabel(n)}${p.length ? `(${formatParams(n, p)})` : ''} on ${q.map((x) => (step.physical ? `Q${x}` : `q${x}`)).join(', ')}`).join('; ')}${removed.length > 12 ? `; and ${removed.length - 12} more` : ''}.`
    : '';
}

// ---------- scrubber and chapter list ----------

function renderScrubber() {
  const track = $('scrub-track');
  track.innerHTML = '';
  const steps = trace().steps;
  let lastStage = null;
  state.visible.forEach((idx, pos) => {
    const s = steps[idx];
    const slot = document.createElement('span');
    slot.className = `slot cause-${s.cause}${s.stage !== lastStage && pos > 0 ? ' chapter-start' : ''}`;
    slot.dataset.pos = String(pos);
    track.appendChild(slot);
    lastStage = s.stage;
  });
}

function renderChapters() {
  const list = $('chapter-list');
  list.innerHTML = '';
  const steps = trace().steps;
  let lastStage = null;
  state.visible.forEach((idx, pos) => {
    const s = steps[idx];
    if (s.stage !== lastStage) {
      const head = document.createElement('li');
      head.className = 'chapter-stage';
      head.textContent = stageName(s.stage);
      list.appendChild(head);
      lastStage = s.stage;
    }
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pass-chip cause-${s.cause}${s.changed ? '' : ' is-quiet'}`;
    btn.dataset.pos = String(pos);
    const d = s.delta ? s.delta.depth : 0;
    btn.innerHTML = `<span class="chip-name"></span>${s.delta ? `<span class="chip-delta">${signed(d)}</span>` : ''}`;
    btn.querySelector('.chip-name').textContent = s.i === 0 ? 'Input' : s.pass;
    btn.setAttribute('aria-label', `${s.i === 0 ? 'Input circuit' : s.pass}, ${stageName(s.stage)} stage${s.i === 0 ? '' : `, ${CAUSE_NAMES[s.cause]} change`}${s.delta ? `, depth ${signed(d)}` : ''}`);
    btn.dataset.tip = stepSummary(snapshotAt(idx));
    const preview = (on) => {
      const slot = $('scrub-track').children[pos];
      if (slot) slot.classList.toggle('is-preview', on);
    };
    btn.addEventListener('pointerenter', () => preview(true));
    btn.addEventListener('pointerleave', () => preview(false));
    btn.addEventListener('focus', () => preview(true));
    btn.addEventListener('blur', () => preview(false));
    btn.addEventListener('click', () => {
      stopPlaying();
      goTo(pos, { announce: true });
      player.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function renderTable() {
  const tbody = $('metrics-table').querySelector('tbody');
  const steps = trace().steps;
  tbody.innerHTML = state.visible.map((idx, pos) => {
    const s = steps[idx];
    const m = s.metrics;
    return `<tr data-pos="${pos}"><td>${s.i}</td><th scope="row">${s.i === 0 ? 'Input' : s.pass}</th><td>${stageName(s.stage)}</td><td>${s.i === 0 ? '–' : CAUSE_NAMES[s.cause]}</td><td>${m.depth}${s.delta && s.delta.depth ? ` (${signed(s.delta.depth)})` : ''}</td><td>${m.size}</td><td>${m.twoq}</td><td>${m.twoq_depth}</td><td>${m.swaps}</td><td>${s.time_ms.toFixed(2)}</td></tr>`;
  }).join('');
}

function wireTableJumps() {
  $('metrics-table').querySelector('tbody').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-pos]');
    if (!row) return;
    jump(Number(row.dataset.pos));
    player.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  });
}

function syncCurrent(container, selector) {
  for (const node of container.querySelectorAll(selector)) {
    const current = Number(node.dataset.pos) === state.pos;
    node.classList.toggle('is-current', current);
    if (current) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
  }
}

function announce(text) {
  const live = $('announcer');
  live.textContent = '';
  // A fresh text node after clearing makes screen readers re-announce.
  window.setTimeout(() => { live.textContent = text; }, 30);
}

function goTo(pos, { announce: say = false, animate = true } = {}) {
  hover.hide();
  state.pos = Math.max(0, Math.min(pos, state.visible.length - 1));
  const idx = state.visible[state.pos];
  const step = snapshotAt(idx);
  const total = state.visible.length;
  const name = step.i === 0 ? 'Input circuit' : step.pass;

  const slider = $('step');
  slider.max = String(total - 1);
  slider.value = String(state.pos);
  slider.setAttribute('aria-valuetext', `Step ${state.pos + 1} of ${total}: ${name}`);
  $('prev').disabled = state.pos === 0;
  $('next').disabled = state.pos === total - 1;
  $('position').innerHTML = `<span class="pos-num">${state.pos + 1} / ${total}</span><span class="pos-name"></span>`;
  $('position').querySelector('.pos-name').textContent = name;
  for (const slot of $('scrub-track').children) {
    const p = Number(slot.dataset.pos);
    slot.classList.toggle('is-played', p <= state.pos);
    slot.classList.toggle('is-current', p === state.pos);
  }

  const direction = directionBetween(state.shownIdx, idx);
  const { wires, columns, bands } = stage.render(step, { isPhysical: step.physical, direction, animate });
  state.shownIdx = idx;
  const added = step.gates.filter((g) => g[3] === 'add').length;
  const moved = step.gates.filter((g) => g[3] === 'move').length;
  $('circuit-desc').textContent = `Circuit after ${name}: ${plural(step.gates.length, 'gate')} on ${plural(wires, 'wire')}, ${plural(columns, 'column')} wide${bands > 1 ? `, folded onto ${bands} rows` : ''}. ${added} added and ${moved} moved by this pass. The gate list under Details has the same information as text.`;
  $('gate-list').innerHTML = gateListTable(step, step.physical);
  const counts = { keep: 0, add: 0, move: 0 };
  for (const g of step.gates) counts[g[3]] += 1;
  const by = step.i === 0 ? 'the input' : step.pass;
  for (const key of document.querySelectorAll('.legend .key')) {
    const n = counts[key.dataset.status];
    key.dataset.tip = { keep: `${plural(n, 'gate')} unchanged by ${by}`, add: `${plural(n, 'gate')} added by ${by}`, move: `${plural(n, 'gate')} moved onto other qubits by ${by}` }[key.dataset.status];
  }
  updateZoomReadout();
  renderCaption(step);
  renderExplain(step);
  syncCurrent($('chapter-list'), '.pass-chip');
  syncCurrent($('metrics-table'), 'tbody tr');
  if (say) {
    announce(`Step ${state.pos + 1} of ${total}. ${name}${step.i === 0 ? '' : `, ${stageName(step.stage)} stage`}. ${stepSummary(step)}`);
  }
}

// ---------- playback ----------

function leavePoster() {
  if (!player.classList.contains('is-poster')) return;
  player.classList.remove('is-poster');
  renderCaption(snapshotAt(state.visible[state.pos]));
}

function setPlaying(on) {
  player.classList.toggle('is-playing', on);
  $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
  $('play').dataset.tip = on ? 'Pause (Space)' : 'Play (Space)';
  if (!on) wake();
}

function stopPlaying() {
  if (state.timer) {
    window.clearInterval(state.timer);
    state.timer = null;
  }
  setPlaying(false);
}

function togglePlay() {
  leavePoster();
  if (state.timer) return stopPlaying();
  if (state.pos >= state.visible.length - 1) goTo(0);
  setPlaying(true);
  const advance = () => {
    if (state.pos >= state.visible.length - 1) return stopPlaying();
    goTo(state.pos + 1, { announce: true });
    return undefined;
  };
  advance();
  state.timer = window.setInterval(advance, reducedMotion.matches ? 2800 : 2000);
  armIdle();
  return undefined;
}

function step(delta) {
  stopPlaying();
  leavePoster();
  goTo(state.pos + delta, { announce: true });
}

function jump(pos) {
  stopPlaying();
  leavePoster();
  goTo(pos, { announce: true });
}

// Controls fade away while playing and the pointer rests, like a video player.
function wake() {
  player.classList.remove('is-idle');
  armIdle();
}

function armIdle() {
  window.clearTimeout(state.idleTimer);
  if (!state.timer) return;
  state.idleTimer = window.setTimeout(() => {
    if (state.timer && !player.querySelector('.controls:focus-within, .topbar:focus-within')) player.classList.add('is-idle');
  }, 2600);
}

// ---------- zoom and pan ----------

function updateZoomReadout() {
  if (!stage.fitView) return;
  const v = stage.userView || stage.fitView;
  const z = stage.fitView[2] / v[2];
  $('zoom-fit').textContent = `${Math.round(z * 100)}%`;
  player.classList.toggle('is-zoomed', Boolean(stage.userView));
}

let hintTimer = null;
function showZoomHint() {
  const hint = $('zoom-hint');
  hint.hidden = false;
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => { hint.hidden = true; }, 1800);
}

function wireStageGestures() {
  const svg = stage.svg;
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, target: e.target, moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      drag = null;
      hover.suppress(true);
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.d > 0) stage.zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.d = d;
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) {
      drag.moved = true;
      player.classList.add('is-panning');
      hover.suppress(true);
    }
    if (drag.moved) {
      stage.panBy(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (drag && !drag.moved && e.type === 'pointerup') hover.click(drag.target, e.clientX, e.clientY);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      drag = null;
      player.classList.remove('is-panning');
      hover.suppress(false);
    }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  // Plain scrolling keeps scrolling the page (to the details below);
  // Ctrl/⌘ + scroll, or a trackpad pinch, zooms.
  svg.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      stage.zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022)), e.clientX, e.clientY);
    } else if (!stage.userView) {
      showZoomHint();
    }
  }, { passive: false });
  svg.addEventListener('dblclick', (e) => {
    e.preventDefault();
    stage.zoomAt(e.shiftKey ? 0.5 : 2, e.clientX, e.clientY, true);
  });
  stage.onViewChange = updateZoomReadout;
  $('zoom-in').addEventListener('click', () => stage.zoomCenter(1.5));
  $('zoom-out').addEventListener('click', () => stage.zoomCenter(1 / 1.5));
  $('zoom-fit').addEventListener('click', () => stage.fit());
  for (const key of document.querySelectorAll('.legend .key')) {
    const on = () => stage.highlight({ gates: stage.entries.filter((en) => en.gate[3] === key.dataset.status) });
    const off = () => stage.highlight();
    key.addEventListener('pointerenter', on);
    key.addEventListener('pointerleave', off);
    key.addEventListener('focus', on);
    key.addEventListener('blur', off);
  }
}

function setCaptions(on) {
  state.captions = on;
  player.classList.toggle('no-captions', !on);
  $('cc').setAttribute('aria-pressed', String(on));
}

function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else player.requestFullscreen().catch(() => {});
}

// ---------- panels ----------

function renderBudgetPanel() {
  $('budget-detail').textContent = budgetSentence(trace(), state.metric);
  renderBudget($('budget-chart'), trace(), state.metric);
}

function errorModel() {
  const e1 = Number($('err1q').value);
  const e2 = Number($('err2q').value);
  $('err1q-out').textContent = `${(e1 * 100).toFixed(2)}%`;
  $('err2q-out').textContent = `${(e2 * 100).toFixed(2)}%`;
  return { e1, e2, rzFree: $('rz-free').checked };
}

function renderComparePanel() {
  $('compare-sentence').textContent = compareSentence(state.bundle);
  renderCompare($('compare-grid'), state.bundle, errorModel(), {
    activeId: state.targetId,
    onInspect: (tid) => {
      selectTarget(tid);
      player.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      $('step').focus();
    },
  });
}

function renderTargetPicker() {
  const picker = $('target-picker');
  picker.innerHTML = '';
  for (const tid of state.bundle.order) {
    const t = state.bundle.traces[tid].target;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.dataset.target = tid;
    btn.textContent = t.short;
    btn.title = t.label;
    picker.appendChild(btn);
  }
  syncRadios(picker, 'target', state.targetId);
  const t = trace().target;
  $('target-blurb').textContent = `${t.label}: ${t.connectivity}. Native gates: ${t.basis.join(', ')}.`;
}

function renderMetricPicker() {
  const picker = $('budget-metric');
  if (!picker.childElementCount) {
    for (const [key, m] of Object.entries(METRICS)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.dataset.metric = key;
      btn.textContent = m.label;
      picker.appendChild(btn);
    }
  }
  syncRadios(picker, 'metric', state.metric);
}

// Radio groups follow the ARIA pattern: one tab stop, arrow keys move and select.
function syncRadios(group, key, value) {
  for (const btn of group.querySelectorAll('[role="radio"]')) {
    const on = btn.dataset[key] === value;
    btn.setAttribute('aria-checked', String(on));
    btn.tabIndex = on ? 0 : -1;
  }
}

function wireRadios(group, key, onSelect) {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('[role="radio"]');
    if (btn) onSelect(btn.dataset[key]);
  });
  group.addEventListener('keydown', (e) => {
    const radios = [...group.querySelectorAll('[role="radio"]')];
    const i = radios.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % radios.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + radios.length) % radios.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = radios.length - 1;
    if (j === null) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(radios[j].dataset[key]);
    group.querySelector(`[data-${key}="${radios[j].dataset[key]}"]`).focus();
  });
}

function selectTarget(tid) {
  stopPlaying();
  const keepPos = state.bundle && state.targetId !== tid && !player.classList.contains('is-poster');
  state.targetId = tid;
  renderTargetPicker();
  computeVisible();
  renderScrubber();
  renderChapters();
  renderTable();
  renderBudgetPanel();
  renderComparePanel();
  // Switching chips mid-way lands on the final circuit and reflows the gates
  // from one chip's result to the other's; from the poster it starts at the
  // input. shownIdx belongs to the old trace, so drop it.
  state.shownIdx = null;
  goTo(keepPos ? state.visible.length - 1 : 0, { animate: keepPos });
  $('budget-sentence').textContent = budgetSentence(trace(), 'depth');
  const links = [...new Set([PRESET_WIKI[state.bundle.circuit.id], TARGET_WIKI[tid], CONCEPTS.transpiler].filter(Boolean))];
  const further = $('info-links');
  further.replaceChildren('Further reading on Wikipedia: ');
  links.forEach((a, i) => further.append(...(i ? [', ', wikiLink(a)] : [wikiLink(a)])));
  further.append('.');
  $('info-title').textContent = `${state.bundle.circuit.title} · ${trace().target.label}`;
  announce(`${trace().target.label}. ${budgetSentence(trace(), 'depth')}`);
}

function showBundle(bundle) {
  state.bundle = bundle;
  if (!bundle.traces[state.targetId]) state.targetId = bundle.order[0];
  $('preset-blurb').textContent = bundle.circuit.blurb;
  const v = bundle.versions;
  $('versions').textContent = `Seed ${bundle.seed}, optimization level ${bundle.optimization_level}, Qiskit ${v.qiskit}${v.qiskit_ionq ? `, qiskit-ionq ${v.qiskit_ionq}` : ''}`;
  player.classList.add('is-poster');
  selectTarget(state.targetId);
}

async function loadPreset(id) {
  stopPlaying();
  if (!state.bundles.has(id)) state.bundles.set(id, await callPython(service.get_trace, id));
  showBundle(state.bundles.get(id));
}

// ---------- custom circuits ----------

async function runCustom() {
  const status = $('qasm-status');
  const button = $('run-qasm');
  button.disabled = true;
  status.textContent = 'Transpiling for three targets in your browser…';
  try {
    const result = await callPython(service.trace_qasm, $('qasm').value);
    if (result.error) {
      status.textContent = result.error;
      return;
    }
    const failed = Object.keys(result.errors || {});
    status.textContent = `Done. Showing your circuit${failed.length ? ` (couldn't transpile for: ${failed.join(', ')})` : ''}.`;
    const select = $('preset');
    if (!select.querySelector('option[value="custom"]')) select.insertAdjacentHTML('beforeend', '<option value="custom">Your circuit</option>');
    select.value = 'custom';
    state.bundles.set('custom', result);
    showBundle(result);
    player.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  } catch (err) {
    status.textContent = `Something went wrong running Python: ${err.message || err}`;
  } finally {
    button.disabled = false;
  }
}

// ---------- wiring ----------

function slotAt(clientX) {
  const slots = [...$('scrub-track').children];
  let best = 0;
  let bestDist = Infinity;
  slots.forEach((slot, i) => {
    const r = slot.getBoundingClientRect();
    const d = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return { pos: best, slot: slots[best] };
}

function showTip(clientX) {
  const { pos, slot } = slotAt(clientX);
  const s = trace().steps[state.visible[pos]];
  const tip = $('scrub-tip');
  tip.textContent = `${s.i === 0 ? 'Input' : s.pass} · ${stageName(s.stage)}`;
  tip.hidden = false;
  const track = $('scrub').getBoundingClientRect();
  const r = slot.getBoundingClientRect();
  const half = tip.offsetWidth / 2;
  const x = Math.max(half, Math.min(r.left + r.width / 2 - track.left, track.width - half));
  tip.style.left = `${x}px`;
}

function wireScrubber() {
  const scrub = $('scrub');
  let dragging = false;
  const seek = (e) => {
    const { pos } = slotAt(e.clientX);
    if (pos !== state.pos) jump(pos);
  };
  scrub.addEventListener('pointerdown', (e) => {
    dragging = true;
    scrub.setPointerCapture(e.pointerId);
    seek(e);
    $('step').focus({ preventScroll: true });
  });
  scrub.addEventListener('pointermove', (e) => {
    showTip(e.clientX);
    if (dragging) seek(e);
  });
  const end = () => { dragging = false; };
  scrub.addEventListener('pointerup', end);
  scrub.addEventListener('pointercancel', end);
  scrub.addEventListener('pointerleave', () => { if (!dragging) $('scrub-tip').hidden = true; });
}

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    const inPlayer = player.contains(t) || t === document.body;
    if (!inPlayer) return;
    const isSlider = t.id === 'step';
    if (t.matches('select, textarea') || (t.matches('input') && !isSlider)) return;
    const key = e.key.toLowerCase();
    const pans = { arrowright: [-80, 0], arrowleft: [80, 0], arrowup: [0, 80], arrowdown: [0, -80] };
    if (e.shiftKey && key in pans) {
      e.preventDefault();
      stage.panBy(...pans[key], true);
    } else if (key === '+' || key === '=') {
      stage.zoomCenter(1.5);
    } else if (key === '-' || key === '_') {
      stage.zoomCenter(1 / 1.5);
    } else if (key === '0') {
      stage.fit();
    } else if ((key === ' ' || key === 'k') && !t.matches('button, a')) {
      e.preventDefault();
      togglePlay();
    } else if (key === 'c') {
      setCaptions(!state.captions);
    } else if (key === 'f') {
      toggleFullscreen();
    } else if (!isSlider && ['arrowright', 'arrowleft', 'home', 'end'].includes(key)) {
      e.preventDefault();
      const moves = { arrowright: state.pos + 1, arrowleft: state.pos - 1, home: 0, end: state.visible.length - 1 };
      jump(moves[key]);
    }
    wake();
  });
}

function wire() {
  $('preset').addEventListener('change', (e) => loadPreset(e.target.value));
  wireRadios($('target-picker'), 'target', (tid) => selectTarget(tid));
  wireRadios($('budget-metric'), 'metric', (m) => {
    state.metric = m;
    renderMetricPicker();
    renderBudgetPanel();
  });
  $('step').addEventListener('input', (e) => jump(Number(e.target.value)));
  $('prev').addEventListener('click', () => step(-1));
  $('next').addEventListener('click', () => step(1));
  $('play').addEventListener('click', togglePlay);
  $('big-play').addEventListener('click', () => { togglePlay(); $('play').focus({ preventScroll: true }); });
  $('cc').addEventListener('click', () => setCaptions(!state.captions));
  if (document.fullscreenEnabled) {
    $('fullscreen').hidden = false;
    $('fullscreen').addEventListener('click', toggleFullscreen);
  }
  $('show-all').addEventListener('change', (e) => {
    const currentIdx = state.visible[state.pos];
    state.showAll = e.target.checked;
    computeVisible();
    renderScrubber();
    renderChapters();
    renderTable();
    const pos = state.visible.findIndex((i) => i >= currentIdx);
    goTo(pos < 0 ? state.visible.length - 1 : pos, { animate: false });
  });
  wireScrubber();
  wireKeys();
  wireStageGestures();
  wireTableJumps();
  initTips();
  // Player buttons get styled tips instead of native titles.
  for (const node of document.querySelectorAll('.player [title]')) {
    node.dataset.tip = node.title;
    node.removeAttribute('title');
  }
  player.addEventListener('pointermove', wake);
  player.addEventListener('focusin', wake);
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => state.bundle && goTo(state.pos, { animate: false }), 120);
  });
  for (const id of ['err1q', 'err2q', 'rz-free']) $(id).addEventListener('input', renderComparePanel);
  $('run-qasm').addEventListener('click', runCustom);
  $('load-qasm').addEventListener('click', () => { $('qasm').value = state.bundle.circuit.qasm || ''; $('qasm').focus(); });
}

async function start() {
  wire();
  renderMetricPicker();
  try {
    state.presets = await callPython(service.list_presets);
    $('preset').innerHTML = state.presets.map((p) => `<option value="${p.id}">${p.title}</option>`).join('');
    const first = state.presets.find((p) => p.id === 'qft') || state.presets[0];
    $('preset').value = first.id;
    await loadPreset(first.id);
    $('qasm').value = state.bundle.circuit.qasm || '';
    $('load-status').hidden = true;
  } catch (err) {
    $('load-status').textContent = `Couldn't load the traces: ${err.message || err}`;
  }
}

await start();

// Keep the run alive so the Python side stays reachable for custom circuits.
// Press Stop in the Qollab toolbar to end it.
await new Promise(() => {});
