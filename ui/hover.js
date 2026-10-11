// Hover interactions.
//
// 1. The stage card: hovering a gate or a wire in the circuit lights it up
//    (and the wires or gates it touches), dims the rest, and shows a card
//    saying what it is, what this pass did to it, and where to read more.
//    Clicking pins the card so its link can be followed; Escape closes it.
// 2. Tips: any element with data-tip shows a small tooltip on hover or focus.

import { formatParams, gateLabel } from './format.js';
import { gateInfo, wikiLink } from './wiki.js';

const HIDE_DELAY = 220;

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createStageHover({ stage, player, card, getContext }) {
  let hideTimer = null;
  let pinned = false;
  let suppressed = false;
  let current = null; // the gate entry or wire qubit being shown

  const label = (q, physical) => (physical ? `Q${q}` : `q${q}`);

  function place(clientX, clientY) {
    const pr = player.getBoundingClientRect();
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let x = clientX - pr.left + 18;
    let y = clientY - pr.top + 18;
    if (x + cw > pr.width - 12) x = clientX - pr.left - cw - 18;
    if (y + ch > pr.height - 12) y = clientY - pr.top - ch - 18;
    card.style.left = `${Math.max(12, x)}px`;
    card.style.top = `${Math.max(12, y)}px`;
  }

  function gateCard(entry, ctx) {
    const [name, qs, ps, status] = entry.gate;
    const info = gateInfo(name);
    const params = formatParams(name, ps);
    const head = h('div', 'hc-head');
    head.append(h('span', `hc-glyph s-${status}`, gateLabel(name)));
    const titles = h('div');
    titles.append(h('strong', null, info.full));
    titles.append(h('span', 'hc-sub', `on ${qs.map((q) => label(q, ctx.isPhysical)).join(name === 'cx' ? ' → ' : ', ')}${params ? ` · ${params}` : ''}`));
    head.append(titles);
    const verdicts = {
      keep: ctx.isInput ? 'Part of the circuit as written.' : `Unchanged by ${ctx.passName}.`,
      add: `Added by ${ctx.passName}.`,
      move: `Moved by ${ctx.passName}${entry.from ? ` from ${entry.from.qubits.map((q) => label(q, entry.from.physical)).join(', ')}` : ' onto different qubits'}.`,
    };
    const verdict = h('p', `hc-status s-${status}`, verdicts[status]);
    const does = h('p', 'hc-does', info.does);
    const more = h('p', 'hc-more');
    more.append(wikiLink(info.wiki, `${info.full} on Wikipedia`));
    return [head, verdict, does, more];
  }

  function wireCard(q, ctx) {
    const step = ctx.step;
    const head = h('div', 'hc-head');
    head.append(h('span', 'hc-glyph hc-wire', label(q, ctx.isPhysical)));
    const titles = h('div');
    titles.append(h('strong', null, ctx.isPhysical ? `Physical qubit ${q}` : `Logical qubit ${q}`));
    const touching = step.gates.filter((g) => g[1].includes(q));
    const twoq = touching.filter((g) => g[1].length >= 2).length;
    titles.append(h('span', 'hc-sub', `${touching.length} gates on this wire, ${twoq} with other qubits`));
    head.append(titles);
    const parts = [head];
    if (ctx.isPhysical && step.layout) {
      const startV = step.layout.initial.indexOf(q);
      const endV = step.layout.final.indexOf(q);
      const text = startV < 0 && endV < 0
        ? 'A spare (ancilla) qubit: no logical qubit is placed here.'
        : `Holds logical q${startV} at the start${endV >= 0 && endV !== startV ? ` and q${endV} at the end: SWAPs moved states between wires` : endV === startV ? ' and still holds it at the end' : ''}.`;
      parts.push(h('p', 'hc-does', text));
    } else if (step.layout && step.layout.final[q] !== q) {
      parts.push(h('p', 'hc-does', `ElidePermutations renamed outputs: this qubit's state ends on wire q${step.layout.final[q]}.`));
    }
    const more = h('p', 'hc-more');
    more.append(wikiLink('Qubit', 'Qubit on Wikipedia'));
    parts.push(more);
    return parts;
  }

  function show(target, clientX, clientY) {
    window.clearTimeout(hideTimer);
    const ctx = getContext();
    if (!ctx) return;
    if (target.entry) {
      if (current !== target.entry) {
        card.querySelector('.hc-body').replaceChildren(...gateCard(target.entry, ctx));
        stage.highlight({ gates: [target.entry], qubits: target.entry.gate[1] });
        current = target.entry;
      }
    } else if (current !== `w${target.q}`) {
      card.querySelector('.hc-body').replaceChildren(...wireCard(target.q, ctx));
      stage.highlight({ gates: stage.entries.filter((e) => e.gate[1].includes(target.q)), qubits: [target.q] });
      current = `w${target.q}`;
    }
    card.hidden = false;
    place(clientX, clientY);
  }

  function hideNow() {
    pinned = false;
    current = null;
    card.hidden = true;
    card.classList.remove('is-pinned');
    stage.highlight();
  }

  function hideSoon() {
    if (pinned) return;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideNow, HIDE_DELAY);
  }

  function targetFrom(node) {
    const entry = stage.entryAt(node);
    if (entry) return { entry };
    const wire = node.closest ? node.closest('.wire-row') : null;
    if (wire && wire.dataset.q !== undefined) return { q: Number(wire.dataset.q) };
    return null;
  }

  stage.svg.addEventListener('pointermove', (e) => {
    if (pinned || suppressed || e.pointerType === 'touch') return;
    const target = targetFrom(e.target);
    if (target) show(target, e.clientX, e.clientY);
    else hideSoon();
  });
  stage.svg.addEventListener('pointerleave', hideSoon);
  card.addEventListener('pointerenter', () => window.clearTimeout(hideTimer));
  card.addEventListener('pointerleave', hideSoon);
  card.querySelector('.hc-close').addEventListener('click', hideNow);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !card.hidden) hideNow();
  });

  return {
    // Click (or tap) on a gate or wire pins its card; on empty space unpins.
    click(node, clientX, clientY) {
      const target = targetFrom(node);
      if (!target) {
        hideNow();
        return;
      }
      current = null;
      show(target, clientX, clientY);
      pinned = true;
      card.classList.add('is-pinned');
    },
    suppress(on) {
      suppressed = on;
      if (on && !pinned) hideNow();
    },
    hide: hideNow,
  };
}

// Small tooltips for anything with data-tip, on hover and keyboard focus.
export function initTips() {
  const tip = h('div', 'tip');
  tip.setAttribute('role', 'tooltip');
  tip.id = 'tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  let owner = null;

  function show(node) {
    const text = node.getAttribute('data-tip');
    if (!text) return;
    owner = node;
    tip.textContent = text;
    tip.hidden = false;
    const r = node.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
    let y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function hide(node) {
    if (node && node !== owner) return;
    owner = null;
    tip.hidden = true;
  }

  document.addEventListener('pointerover', (e) => {
    const node = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (node) show(node);
  });
  document.addEventListener('pointerout', (e) => {
    const node = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (node && !node.contains(e.relatedTarget)) hide(node);
  });
  document.addEventListener('focusin', (e) => {
    const node = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (node) show(node);
  });
  document.addEventListener('focusout', (e) => hide(e.target.closest ? e.target.closest('[data-tip]') : null));
  window.addEventListener('scroll', () => hide(), { passive: true });
}
