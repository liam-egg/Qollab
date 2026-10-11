// Cost breakdown, topology maps and the three-target comparison.

import { CAUSE_NAMES } from './explain.js';
import { percent, plural, signed } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const METRICS = {
  depth: { label: 'Depth', long: 'depth' },
  twoq: { label: '2-qubit gates', long: 'two-qubit gates' },
  twoq_depth: { label: '2-qubit depth', long: 'two-qubit depth' },
  size: { label: 'All gates', long: 'total gates' },
};

const CAUSE_ORDER = ['translation', 'routing', 'optimization', 'layout'];

export function finalStep(trace) {
  const changed = trace.steps.filter((s) => s.changed);
  return changed[changed.length - 1];
}

// ---------- cost breakdown ----------

export function budgetSentence(trace, metric) {
  const s = trace.summary;
  const parts = CAUSE_ORDER
    .filter((c) => s.by_cause[c][metric] !== 0)
    .map((c) => `${CAUSE_NAMES[c]} ${signed(s.by_cause[c][metric])}`);
  let text = `${METRICS[metric].label} ${s.initial[metric]} → ${s.final[metric]}`;
  text += parts.length ? `: ${parts.join(', ')}.` : ': no change.';
  const expanded = -s.by_cause.translation.swaps;
  if (s.swaps_inserted > 0 && expanded > 0) {
    text += ` Routing inserted ${plural(s.swaps_inserted, 'SWAP')}; translation then expanded ${expanded === 1 ? 'it' : 'each'} into three CNOTs.`;
  }
  return text;
}

export function renderBudget(container, trace, metric) {
  const s = trace.summary;
  const rows = [{ label: 'Input circuit', kind: 'total', from: 0, to: s.initial[metric] }];
  let running = s.initial[metric];
  for (const c of CAUSE_ORDER) {
    const d = s.by_cause[c][metric];
    if (d === 0 && c === 'layout') continue;
    rows.push({ label: CAUSE_NAMES[c], cause: c, kind: d > 0 ? 'up' : d < 0 ? 'down' : 'zero', from: running, to: running + d, delta: d });
    running += d;
  }
  rows.push({ label: 'Final circuit', kind: 'total', from: 0, to: s.final[metric] });
  const max = Math.max(1, ...rows.map((r) => Math.max(r.from, r.to)));
  container.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'waterfall';
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = `wf-row wf-${r.kind}${r.cause ? ` cause-${r.cause}` : ''}`;
    const lo = Math.min(r.from, r.to);
    const hi = Math.max(r.from, r.to);
    const value = r.kind === 'total' ? String(r.to) : signed(r.delta);
    li.innerHTML = `<span class="wf-label">${r.label[0].toUpperCase()}${r.label.slice(1)}</span>
      <span class="wf-track" aria-hidden="true"><span class="wf-bar" style="left:${(lo / max) * 100}%;width:${Math.max(((hi - lo) / max) * 100, r.kind === 'zero' ? 0 : 0.6)}%"></span></span>
      <span class="wf-value">${value}${r.kind === 'up' ? ' ▲' : r.kind === 'down' ? ' ▼' : ''}</span>`;
    list.appendChild(li);
  }
  container.appendChild(list);
}

// ---------- success estimate ----------

export function successProbability(step, { e1, e2, rzFree }) {
  let p = 1;
  for (const [name, qs] of step.gates) {
    const e = qs.length >= 2 ? e2 : rzFree && name === 'rz' ? 0 : e1;
    p *= 1 - e;
  }
  return p;
}

// ---------- topology map ----------

function svgEl(name, attrs, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// SWAPs as they sit just before translation expands them. Taking them from
// the routing pass itself would be wrong: VF2PostLayout can afterwards move
// the whole routed circuit onto different physical qubits.
function routedSwaps(trace) {
  if (!trace.summary.swaps_inserted) return [];
  const withSwaps = trace.steps.filter((s) => s.changed && s.physical && s.metrics.swaps > 0);
  const last = withSwaps[withSwaps.length - 1];
  return last ? last.gates.filter(([name]) => name === 'swap').map(([, qs]) => qs) : [];
}

export function renderTopology(trace, { compact = false } = {}) {
  const t = trace.target;
  const fin = finalStep(trace);
  const layout = trace.summary.layout;
  const unit = compact ? 34 : 46;
  const pad = 20;
  const xs = t.positions.map((p) => p[0]);
  const ys = t.positions.map((p) => p[1]);
  const w = (Math.max(...xs) - Math.min(...xs)) * unit + pad * 2;
  const h = (Math.max(...ys) - Math.min(...ys)) * unit + pad * 2;
  const pos = (q) => [pad + (t.positions[q][0] - Math.min(...xs)) * unit, pad + (t.positions[q][1] - Math.min(...ys)) * unit];

  const usage = new Map();
  for (const [, qs] of fin.gates) {
    if (qs.length === 2) {
      const key = [...qs].sort((a, b) => a - b).join('-');
      usage.set(key, (usage.get(key) || 0) + 1);
    }
  }
  const swapEdges = new Set(routedSwaps(trace).map((qs) => [...qs].sort((a, b) => a - b).join('-')));
  const logicalAt = new Map((layout ? layout.initial : []).map((phys, v) => [phys, v]));

  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'topology', role: 'img' });
  const usedEdges = [...usage.keys()].length;
  const desc = `${t.short} coupling map with ${t.num_physical} qubits and ${t.edges.length} connections. `
    + `The final circuit uses ${plural(usedEdges, 'connection')}`
    + (swapEdges.size ? `, ${plural(swapEdges.size, 'of which carries', 'of which carry')} routing SWAPs.` : '.');
  svgEl('title', {}, svg).textContent = desc;
  for (const [a, b] of t.edges) {
    const key = `${a}-${b}`;
    const [x1, y1] = pos(a);
    const [x2, y2] = pos(b);
    const cls = ['edge'];
    if (usage.has(key)) cls.push('edge-used');
    if (swapEdges.has(key)) cls.push('edge-swap');
    const line = svgEl('line', { x1, y1, x2, y2, class: cls.join(' ') }, svg);
    if (usage.has(key)) line.setAttribute('stroke-width', String(Math.min(2 + usage.get(key) * 0.7, 7)));
  }
  for (let q = 0; q < t.num_physical; q++) {
    const [x, y] = pos(q);
    const used = logicalAt.has(q);
    svgEl('circle', { cx: x, cy: y, r: used ? 11 : 6, class: used ? 'node node-used' : 'node' }, svg);
    if (used) {
      const label = svgEl('text', { x, y: y + 4, 'text-anchor': 'middle', class: 'node-label' }, svg);
      label.textContent = `q${logicalAt.get(q)}`;
    }
  }
  return svg;
}

// ---------- comparison ----------

export function compareSentence(bundle) {
  const tr = bundle.traces;
  const parts = [];
  if (tr.heavy_hex && tr.full_ibm) {
    const a = tr.heavy_hex.summary.final;
    const b = tr.full_ibm.summary.final;
    const swaps = tr.heavy_hex.summary.swaps_inserted;
    parts.push(swaps === 0
      ? 'Connectivity costs nothing here: the circuit fits the heavy-hex lattice without a single SWAP.'
      : `Connectivity cost (heavy-hex vs all-to-all, same IBM gates): ${plural(swaps, 'SWAP')}, ${signed(a.twoq - b.twoq)} two-qubit gates and ${signed(a.depth - b.depth)} depth.`);
  }
  if (tr.full_ibm && tr.ionq) {
    const b = tr.full_ibm.summary.final;
    const c = tr.ionq.summary.final;
    parts.push(`Gate-set difference (IonQ native vs IBM gates, both all-to-all): ${signed(c.twoq - b.twoq)} two-qubit gates, ${signed(c.size - b.size)} gates in total.`);
  }
  return parts.join(' ');
}

export function renderCompare(container, bundle, errors, { onInspect, activeId }) {
  container.innerHTML = '';
  for (const tid of bundle.order) {
    const trace = bundle.traces[tid];
    const s = trace.summary;
    const fin = finalStep(trace);
    const card = document.createElement('article');
    card.className = `compare-card${tid === activeId ? ' is-active' : ''}`;
    card.setAttribute('aria-labelledby', `cmp-${tid}`);
    const p = successProbability(fin, errors);
    card.innerHTML = `
      <h3 id="cmp-${tid}">${trace.target.label}</h3>
      <p class="hint">${trace.target.connectivity}; native gates ${trace.target.basis.join(', ')}</p>
      <div class="topo-wrap"></div>
      <dl class="stats">
        <div><dt>SWAPs inserted</dt><dd>${s.swaps_inserted}</dd></div>
        <div><dt>2-qubit gates</dt><dd>${s.final.twoq}</dd></div>
        <div><dt>2-qubit depth</dt><dd>${s.final.twoq_depth}</dd></div>
        <div><dt>Depth</dt><dd>${s.final.depth}</dd></div>
        <div><dt>All gates</dt><dd>${s.final.size}</dd></div>
        <div class="stat-success"><dt>Est. success</dt><dd>${percent(p)}</dd></div>
      </dl>
      <div class="meter" aria-hidden="true"><span style="width:${(p * 100).toFixed(1)}%"></span></div>
      <button type="button" class="btn" data-inspect="${tid}">${tid === activeId ? 'Showing in timeline' : 'Inspect in timeline'}</button>`;
    card.querySelector('.topo-wrap').appendChild(renderTopology(trace, { compact: true }));
    const btn = card.querySelector('button');
    if (tid === activeId) btn.setAttribute('aria-current', 'true');
    btn.addEventListener('click', () => onInspect(tid));
    container.appendChild(card);
  }
}
