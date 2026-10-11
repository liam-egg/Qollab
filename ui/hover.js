// Hover interactions.
//
// 1. The stage card: resting the pointer on a gate lights it and its wires
//    up, dims the rest, and shows a card saying what the gate is, what this
//    pass did to it, and where to read more. A short delay keeps cards from
//    flashing while the pointer just crosses the circuit, and the effect ends
//    the moment the pointer leaves the gate. Clicking pins the card so its
//    link can be followed; Escape or the close button unpins it.
// 2. Tips: any element with data-tip shows a small tooltip on hover or focus.

import { formatParams, gateLabel } from './format.js';
import { gateInfo, wikiLink } from './wiki.js';

const SHOW_DELAY = 140;

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createStageHover({ stage, player, card, getContext }) {
  let showTimer = null;
  let pending = null; // gate the pointer is resting on, not yet shown
  let pendingAt = null; // latest pointer position over the pending gate
  let pinned = false;
  let suppressed = false;
  let current = null; // the gate entry being shown

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
    const hint = h('p', 'hc-hint', 'Click the gate to pin this card.');
    return [head, verdict, does, more, hint];
  }

  function show(entry, clientX, clientY) {
    const ctx = getContext();
    if (!ctx) return;
    if (current !== entry) {
      card.querySelector('.hc-body').replaceChildren(...gateCard(entry, ctx));
      stage.highlight({ gates: [entry], qubits: entry.gate[1] });
      current = entry;
    }
    card.hidden = false;
    place(clientX, clientY);
  }

  function cancelPending() {
    window.clearTimeout(showTimer);
    pending = null;
    pendingAt = null;
  }

  function clearShown() {
    current = null;
    card.hidden = true;
    stage.highlight();
  }

  function hideNow() {
    cancelPending();
    pinned = false;
    card.classList.remove('is-pinned');
    clearShown();
  }

  stage.svg.addEventListener('pointermove', (e) => {
    if (pinned || suppressed || e.pointerType === 'touch') return;
    const entry = stage.entryAt(e.target);
    if (entry && entry === current) {
      place(e.clientX, e.clientY);
      return;
    }
    // Off the gate that was showing: its effect ends right away.
    if (current) clearShown();
    if (!entry) {
      cancelPending();
      return;
    }
    // Wait for the pointer to rest on a new gate before showing its card.
    pendingAt = [e.clientX, e.clientY];
    if (entry !== pending) {
      cancelPending();
      pending = entry;
      pendingAt = [e.clientX, e.clientY];
      showTimer = window.setTimeout(() => {
        if (pending === entry && pendingAt) show(entry, ...pendingAt);
      }, SHOW_DELAY);
    }
  });
  stage.svg.addEventListener('pointerleave', () => {
    if (pinned) return;
    cancelPending();
    clearShown();
  });
  card.querySelector('.hc-close').addEventListener('click', hideNow);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !card.hidden) hideNow();
  });

  return {
    // Click (or tap) on a gate pins its card; on empty space unpins.
    click(node, clientX, clientY) {
      const entry = stage.entryAt(node);
      if (!entry) {
        hideNow();
        return;
      }
      cancelPending();
      current = null;
      show(entry, clientX, clientY);
      pinned = true;
      card.classList.add('is-pinned');
    },
    suppress(on) {
      suppressed = on;
      if (on && !pinned) {
        cancelPending();
        clearShown();
      }
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
