// Transpile Lens: entry point. Python (lens/) produces the traces; this file
// owns the UI. Only JSON strings cross the JS/Python boundary.
import * as service from 'lens.service';
import { gateListTable, renderCircuit } from './ui/circuit.js';
import { CAUSE_NAMES, noteFor, STAGE_NAMES, STAGE_NOTES } from './ui/explain.js';
import { formatParams, gateLabel, plural, signed } from './ui/format.js';
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
  showAll: false,
  metric: 'depth',
  timer: null,
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

async function callPython(fn, ...args) {
  const result = await fn.callPromising(...args);
  return JSON.parse(typeof result === 'string' ? result : String(result));
}

const trace = () => state.bundle.traces[state.targetId];

// ---------- steps ----------

function computeVisible() {
  const steps = trace().steps;
  state.visible = steps
    .filter((s) => state.showAll || s.i === 0 || s.changed || s.chosen_layout)
    .map((s) => s.i);
}

// A step that changed nothing reuses the last changed snapshot's gates.
function snapshotAt(i) {
  const steps = trace().steps;
  const step = steps[i];
  if (step.changed) return step;
  let j = i;
  while (j > 0 && !steps[j].changed) j--;
  const base = steps[j];
  return { ...step, gates: base.gates.map(([n, q, p]) => [n, q, p, 'keep']), removed: [], num_qubits: base.num_qubits, physical: base.physical };
}

function previousMetrics(i) {
  const steps = trace().steps;
  return i > 0 ? steps[i - 1].metrics : steps[0].metrics;
}

// ---------- explanation ----------

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

function renderExplain(step) {
  const stageName = STAGE_NAMES[step.stage] || step.stage;
  $('explain-stage').textContent = step.i === 0 ? 'Before transpiling' : `${stageName} stage · counted as ${CAUSE_NAMES[step.cause]}`;
  $('explain-h').textContent = step.i === 0 ? 'Input circuit' : step.pass;
  const note = step.i === 0 ? { what: state.bundle.circuit.blurb } : noteFor(step.pass);
  $('explain-what').textContent = stepSummary(step);
  const dl = $('explain-delta');
  dl.innerHTML = '';
  if (step.delta) {
    for (const key of ['depth', 'twoq', 'size', 'swaps']) {
      const label = key === 'swaps' ? 'SWAPs' : METRICS[key].label;
      const d = step.delta[key];
      dl.insertAdjacentHTML('beforeend', `<div class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}"><dt>${label}</dt><dd>${step.metrics[key]} <span>(${signed(d)})</span></dd></div>`);
    }
  }
  const why = [note.what, note.why].filter(Boolean).join(' ');
  $('explain-why').textContent = step.i === 0 ? note.what : why || STAGE_NOTES[step.stage] || '';
  const removed = step.removed || [];
  $('explain-removed').textContent = removed.length
    ? `Removed: ${removed.slice(0, 12).map(([n, q, p]) => `${gateLabel(n)}${p.length ? `(${formatParams(n, p)})` : ''} on ${q.map((x) => (step.physical ? `Q${x}` : `q${x}`)).join(', ')}`).join('; ')}${removed.length > 12 ? `; and ${removed.length - 12} more` : ''}.`
    : '';
}

// ---------- timeline ----------

function renderStageStrip() {
  const strip = $('stage-strip');
  strip.innerHTML = '';
  const steps = trace().steps;
  let group = null;
  state.visible.forEach((idx, pos) => {
    const s = steps[idx];
    const stage = s.stage;
    if (!group || group.dataset.stage !== stage) {
      group = document.createElement('li');
      group.className = 'stage-group';
      group.dataset.stage = stage;
      group.innerHTML = `<span class="stage-name">${STAGE_NAMES[stage] || stage}</span><ol class="stage-passes"></ol>`;
      strip.appendChild(group);
    }
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pass-chip cause-${s.cause}${s.changed ? '' : ' is-quiet'}`;
    btn.dataset.pos = String(pos);
    const d = s.delta ? s.delta.depth : 0;
    btn.innerHTML = `<span class="chip-name">${s.i === 0 ? 'Input' : s.pass}</span>${s.delta ? `<span class="chip-delta">${signed(d)}</span>` : ''}`;
    btn.setAttribute('aria-label', `${s.i === 0 ? 'Input circuit' : s.pass}, ${STAGE_NAMES[stage] || stage} stage${s.delta ? `, depth ${signed(d)}` : ''}`);
    btn.addEventListener('click', () => goTo(pos, { announce: true }));
    li.appendChild(btn);
    group.querySelector('.stage-passes').appendChild(li);
  });
}

function renderTable() {
  const tbody = $('metrics-table').querySelector('tbody');
  const steps = trace().steps;
  tbody.innerHTML = state.visible.map((idx, pos) => {
    const s = steps[idx];
    const m = s.metrics;
    return `<tr data-pos="${pos}"><td>${s.i}</td><th scope="row">${s.i === 0 ? 'Input' : s.pass}</th><td>${STAGE_NAMES[s.stage] || s.stage}</td><td>${s.i === 0 ? '–' : CAUSE_NAMES[s.cause]}</td><td>${m.depth}${s.delta && s.delta.depth ? ` (${signed(s.delta.depth)})` : ''}</td><td>${m.size}</td><td>${m.twoq}</td><td>${m.twoq_depth}</td><td>${m.swaps}</td><td>${s.time_ms.toFixed(2)}</td></tr>`;
  }).join('');
}

function announce(text) {
  const live = $('announcer');
  live.textContent = '';
  // A fresh text node after clearing makes screen readers re-announce.
  window.setTimeout(() => { live.textContent = text; }, 30);
}

function goTo(pos, { announce: say = false, focusChip = false } = {}) {
  state.pos = Math.max(0, Math.min(pos, state.visible.length - 1));
  const idx = state.visible[state.pos];
  const step = snapshotAt(idx);
  const total = state.visible.length;
  const slider = $('step');
  slider.max = String(total - 1);
  slider.value = String(state.pos);
  const name = step.i === 0 ? 'Input circuit' : step.pass;
  slider.setAttribute('aria-valuetext', `Step ${state.pos + 1} of ${total}: ${name}`);
  $('prev').disabled = state.pos === 0;
  $('next').disabled = state.pos === total - 1;

  $('circuit-pass').textContent = step.i === 0 ? 'input' : step.pass;
  const isPhysical = step.physical;
  const { wires, columns } = renderCircuit($('circuit'), step, { isPhysical });
  const added = step.gates.filter((g) => g[3] === 'add').length;
  const moved = step.gates.filter((g) => g[3] === 'move').length;
  $('circuit-desc').textContent = `Circuit after ${name}: ${plural(step.gates.length, 'gate')} on ${plural(wires, 'wire')}, about ${plural(columns, 'column')} wide. ${added} added and ${moved} moved by this pass. The gate list below has the same information as text.`;
  $('gate-list').innerHTML = gateListTable(step, isPhysical);
  renderExplain(step);

  for (const chip of document.querySelectorAll('.pass-chip')) {
    const current = Number(chip.dataset.pos) === state.pos;
    chip.classList.toggle('is-current', current);
    if (current) {
      chip.setAttribute('aria-current', 'step');
      chip.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      if (focusChip) chip.focus();
    } else {
      chip.removeAttribute('aria-current');
    }
  }
  for (const row of $('metrics-table').querySelectorAll('tbody tr')) {
    const current = Number(row.dataset.pos) === state.pos;
    row.classList.toggle('is-current', current);
    if (current) row.setAttribute('aria-current', 'step'); else row.removeAttribute('aria-current');
  }
  if (say) {
    const stage = STAGE_NAMES[step.stage] || step.stage;
    announce(`Step ${state.pos + 1} of ${total}. ${name}${step.i === 0 ? '' : `, ${stage} stage`}. ${stepSummary(step)}`);
  }
}

function stopPlaying() {
  if (state.timer) {
    window.clearInterval(state.timer);
    state.timer = null;
  }
  $('play').textContent = 'Play';
  $('play').setAttribute('aria-pressed', 'false');
}

function togglePlay() {
  if (state.timer) return stopPlaying();
  if (state.pos >= state.visible.length - 1) goTo(0);
  $('play').textContent = 'Pause';
  $('play').setAttribute('aria-pressed', 'true');
  state.timer = window.setInterval(() => {
    if (state.pos >= state.visible.length - 1) return stopPlaying();
    goTo(state.pos + 1, { announce: true });
  }, reducedMotion.matches ? 2600 : 1600);
  return undefined;
}

// ---------- panels ----------

function renderBudgetPanel() {
  $('budget-sentence').textContent = budgetSentence(trace(), state.metric);
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
      $('timeline').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
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
    btn.textContent = t.label;
    picker.appendChild(btn);
  }
  syncRadios(picker, 'target', state.targetId);
  const t = trace().target;
  $('target-blurb').textContent = `${t.connectivity}. Native gates: ${t.basis.join(', ')}.`;
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
    onSelect(radios[j].dataset[key]);
    group.querySelector(`[data-${key}="${radios[j].dataset[key]}"]`).focus();
  });
}

function selectTarget(tid, { keepFinal = false } = {}) {
  stopPlaying();
  state.targetId = tid;
  renderTargetPicker();
  computeVisible();
  renderStageStrip();
  renderTable();
  renderBudgetPanel();
  renderComparePanel();
  goTo(keepFinal ? state.visible.length - 1 : 0);
  announce(`${trace().target.label}. ${budgetSentence(trace(), 'depth')}`);
}

function showBundle(bundle) {
  state.bundle = bundle;
  if (!bundle.traces[state.targetId]) state.targetId = bundle.order[0];
  $('preset-blurb').textContent = bundle.circuit.blurb;
  const v = bundle.versions;
  $('versions').textContent = `seed ${bundle.seed}, optimization level ${bundle.optimization_level}, Qiskit ${v.qiskit}${v.qiskit_ionq ? `, qiskit-ionq ${v.qiskit_ionq}` : ''}`;
  selectTarget(state.targetId);
}

async function loadPreset(id) {
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
    $('timeline').scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  } catch (err) {
    status.textContent = `Something went wrong running Python: ${err.message || err}`;
  } finally {
    button.disabled = false;
  }
}

// ---------- wiring ----------

function wire() {
  $('preset').addEventListener('change', (e) => loadPreset(e.target.value));
  wireRadios($('target-picker'), 'target', (tid) => selectTarget(tid));
  wireRadios($('budget-metric'), 'metric', (m) => {
    state.metric = m;
    renderMetricPicker();
    renderBudgetPanel();
  });
  $('step').addEventListener('input', (e) => { stopPlaying(); goTo(Number(e.target.value), { announce: true }); });
  $('prev').addEventListener('click', () => { stopPlaying(); goTo(state.pos - 1, { announce: true }); });
  $('next').addEventListener('click', () => { stopPlaying(); goTo(state.pos + 1, { announce: true }); });
  $('play').addEventListener('click', togglePlay);
  $('show-all').addEventListener('change', (e) => {
    const currentIdx = state.visible[state.pos];
    state.showAll = e.target.checked;
    computeVisible();
    renderStageStrip();
    renderTable();
    const pos = state.visible.findIndex((i) => i >= currentIdx);
    goTo(pos < 0 ? state.visible.length - 1 : pos);
  });
  // Arrow keys / Home / End step the timeline from anywhere in the timeline
  // panel or the circuit, not just the slider (which handles them natively).
  const stepKeys = (e) => {
    if (e.target.matches('input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
    const moves = { ArrowRight: state.pos + 1, ArrowLeft: state.pos - 1, Home: 0, End: state.visible.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    stopPlaying();
    goTo(moves[e.key], { announce: true, focusChip: e.target.classList.contains('pass-chip') });
  };
  $('timeline').addEventListener('keydown', stepKeys);
  $('circuit-scroll').addEventListener('keydown', stepKeys);
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
    $('load-status').textContent = '';
    $('load-status').hidden = true;
  } catch (err) {
    $('load-status').textContent = `Couldn't load the traces: ${err.message || err}`;
  }
}

await start();

// Keep the run alive so the Python side stays reachable for custom circuits.
// Press Stop in the Qollab toolbar to end it.
await new Promise(() => {});
