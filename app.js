'use strict';

// ---------- static model ----------
const RING_NAMES = ['S', 'S4', 'S3', 'S2', 'S1'];
const RING_COLORS = ['#b1216e', '#e8112d', '#f2a0a4', '#f3e1d7', '#e9e4f2'];
const RING_TEXT = ['#ffffff', '#ffffff', '#5c242c', '#6b5648', '#5d5570'];
const COL_C = '#ffe14d', COL_D = '#101014', COL_MASK = '#2a2a31';
const SQ3 = Math.sqrt(3);

// 61 spaxels: centre + 4 rings, flat-top hex cells, ring positions numbered
// clockwise from the top
const spaxels = [];
{
  const byRing = [[], [], [], [], []];
  for (let q = -4; q <= 4; q++) {
    for (let r = -4; r <= 4; r++) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
      if (ring > 4) continue;
      const x = 1.5 * q, y = SQ3 * (r + q / 2);
      byRing[ring].push({ q, r, x, y, ring });
    }
  }
  byRing.forEach(cells => cells.sort((a, b) =>
    ((Math.atan2(a.x, -a.y) + 2 * Math.PI) % (2 * Math.PI)) -
    ((Math.atan2(b.x, -b.y) + 2 * Math.PI) % (2 * Math.PI))));
  byRing.forEach((cells, ring) => cells.forEach((c, i) => {
    c.id = spaxels.length;
    c.idx = i + 1;
    c.label = ring === 0 ? 'S' : `${RING_NAMES[ring]}-${c.idx}`;
    spaxels.push(c);
  }));
}
const ringGroups = [0, 1, 2, 3, 4].map(r => spaxels.filter(s => s.ring === r).map(s => s.id));

// slit: 75 slots, calibration fibres fixed at both ends, the 73 interior
// positions hold 61 spaxel fibres and 12 movable darks (items 61..72).
// Baseline (spec fig. 2): C D S D [6x(D S4)] D [12xS3] D [18xS2] D [24xS1] D C
const NF = 61, NDARK = 12, NITEM = NF + NDARK, NSLOT = NITEM + 2;
const isDark = id => id >= NF;

const baselineTemplate = [];
{
  const push = t => baselineTemplate.push(t);
  push('D'); push('F'); push('D');
  for (let i = 0; i < 6; i++) { push('D'); push('F'); }
  push('D');
  for (let i = 0; i < 12; i++) push('F');
  push('D');
  for (let i = 0; i < 18; i++) push('F');
  push('D');
  for (let i = 0; i < 24; i++) push('F');
  push('D');
}

function orderFromSpaxelSeq(seq) {
  let sp = 0, dk = NF;
  return baselineTemplate.map(t => t === 'F' ? seq[sp++] : dk++);
}

function baselineOrder() {
  return orderFromSpaxelSeq(Array.from({ length: NF }, (_, i) => i));
}

// ---------- state ----------
let state = { order: baselineOrder(), masked: new Array(NF).fill(false) };
let posOf = [];   // item id -> interior position (slot index = pos + 1)
let undoStack = [], redoStack = [];
let mode = 'assign', labelMode = 'slit', sel = null, maskAnchor = 'spaxel';

const slotNum = id => posOf[id] + 2;   // 1-based slit position for display

// Tom's design, July 2026 (same as mask1.json): outer ring S1 plus S2-10 masked,
// conflict-free in both the masked and the inverted-mask exposure
const MASK1 = {
  v: 2,
  order: [61, 0, 62, 25, 64, 1, 65, 2, 66, 3, 67, 4, 68, 5, 69, 6, 70, 7, 72, 9,
          71, 11, 51, 13, 55, 15, 57, 17, 37, 8, 41, 10, 39, 12, 43, 14, 47, 16,
          49, 18, 53, 30, 60, 32, 59, 34, 45, 36, 38, 19, 40, 33, 42, 21, 44, 20,
          46, 22, 48, 27, 50, 29, 52, 24, 54, 31, 56, 26, 58, 23, 28, 35, 63],
  masked: [28, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52,
           53, 54, 55, 56, 57, 58, 59, 60]
};

function shuffleSeq() {
  const p = Array.from({ length: NF }, (_, i) => i);
  for (let i = p.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

// maximal runs of consecutive spaxel-occupied interior positions
function fibreRuns() {
  const runs = [];
  let cur = null;
  state.order.forEach(id => {
    if (!isDark(id)) { if (!cur) { cur = []; runs.push(cur); } cur.push(id); }
    else cur = null;
  });
  return runs;
}

function alternateMask(parity) {
  const m = new Array(NF).fill(false);
  for (const run of fibreRuns())
    run.forEach((id, off) => { if (off % 2 === parity) m[id] = true; });
  return m;
}

function pushUndo() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state));
  state = JSON.parse(undoStack.pop());
  sel = null; update();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state));
  state = JSON.parse(redoStack.pop());
  sel = null; update();
}

// ---------- svg construction ----------
const NS = 'http://www.w3.org/2000/svg';
function el(name, attrs, parent) {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

const hexsvg = document.getElementById('hexsvg');
const slitsvg = document.getElementById('slitsvg');
const tip = document.getElementById('tip');
const hexCells = [], hexLabels = [], slitCells = [], slitHatch = [], conflictBars = [];

function hatchPattern(svg, id, size, sw) {
  const defs = el('defs', {}, svg);
  const p = el('pattern', { id, width: size, height: size, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: size, height: size, fill: COL_MASK }, p);
  el('line', { x1: 0, y1: 0, x2: 0, y2: size, stroke: '#9a9aa6', 'stroke-width': sw }, p);
}

function buildHex() {
  hatchPattern(hexsvg, 'hhatch', 0.55, 0.09);
  const R = 0.985;
  const corners = a => Array.from({ length: 6 }, (_, k) =>
    `${(a.x + R * Math.cos(k * Math.PI / 3)).toFixed(3)},${(a.y + R * Math.sin(k * Math.PI / 3)).toFixed(3)}`).join(' ');
  for (const s of spaxels) {
    const g = el('g', {}, hexsvg);
    const c = el('polygon', { points: corners(s), class: 'cell hexcell' }, g);
    const t = el('text', {
      x: s.x, y: s.y + 0.02, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 0.62
    }, g);
    hexCells[s.id] = c; hexLabels[s.id] = t;
    c.addEventListener('click', ev => onPick(s.id, ev));
    c.addEventListener('mouseenter', ev => onHover(s.id, ev));
    c.addEventListener('mousemove', moveTip);
    c.addEventListener('mouseleave', () => onHover(null));
  }
}

const SW = 10, CW = 9.2;   // slit slot pitch and cell width
function buildSlit() {
  hatchPattern(slitsvg, 'shatch', 3, 0.6);
  for (let i = 0; i < NSLOT; i++) {
    const x = 1 + i * SW;
    const fixedC = i === 0 || i === NSLOT - 1;
    const base = el('rect', {
      x, y: 1, width: CW, height: 13, rx: 1,
      class: 'cell slitcell' + (fixedC ? ' inert' : '')
    }, slitsvg);
    slitCells[i] = base;
    if (fixedC) {
      base.setAttribute('fill', COL_C);
      base.addEventListener('mouseenter', ev => showTip(`slit ${i + 1} - calibration fibre (fixed)`, ev));
      base.addEventListener('mousemove', moveTip);
      base.addEventListener('mouseleave', hideTip);
    } else {
      const h = el('rect', { x, y: 1, width: CW, height: 13, rx: 1, fill: 'url(#shatch)', 'pointer-events': 'none', visibility: 'hidden' }, slitsvg);
      slitHatch[i] = h;
      base.addEventListener('click', ev => onPick(state.order[i - 1], ev));
      base.addEventListener('mouseenter', ev => onHover(state.order[i - 1], ev));
      base.addEventListener('mousemove', moveTip);
      base.addEventListener('mouseleave', () => onHover(null));
    }
    if ((i + 1) % 5 === 0)
      el('text', { x: x + CW / 2, y: 24.5, 'text-anchor': 'middle', 'font-size': 4.6, fill: '#8a919c' }, slitsvg).textContent = i + 1;
  }
  for (let i = 0; i < NSLOT - 1; i++) {
    conflictBars[i] = el('rect', {
      x: 1 + i * SW + 1.5, y: 15.2, width: SW + CW - 3, height: 1.8, rx: 0.9,
      fill: '#e02020', visibility: 'hidden'
    }, slitsvg);
  }
}

// ---------- interaction ----------
function onPick(itemId, ev) {
  if (ev.shiftKey || mode === 'mask') {
    if (isDark(itemId)) return;
    pushUndo();
    state.masked[itemId] = !state.masked[itemId];
    update();
    return;
  }
  if (sel === null) { sel = itemId; }
  else if (sel === itemId) { sel = null; }
  else {
    pushUndo();
    const pa = posOf[sel], pb = posOf[itemId];
    [state.order[pa], state.order[pb]] = [state.order[pb], state.order[pa]];
    if (maskAnchor === 'slit' && !isDark(sel) && !isDark(itemId))
      [state.masked[sel], state.masked[itemId]] = [state.masked[itemId], state.masked[sel]];
    sel = null;
  }
  update();
}

let hovId = null;
function onHover(itemId, ev) {
  if (hovId !== null) {
    if (!isDark(hovId)) hexCells[hovId].classList.remove('hov');
    slitCells[posOf[hovId] + 1].classList.remove('hov');
  }
  hovId = itemId;
  if (itemId === null) { hideTip(); return; }
  slitCells[posOf[itemId] + 1].classList.add('hov');
  if (isDark(itemId)) { showTip(`slit ${slotNum(itemId)} - dark (movable)`, ev); return; }
  hexCells[itemId].classList.add('hov');
  const st = state.masked[itemId] ? 'masked' : 'lit';
  showTip(`${spaxels[itemId].label} - slit ${slotNum(itemId)} - ${st}`, ev);
}

function showTip(text, ev) { tip.textContent = text; tip.hidden = false; moveTip(ev); }
function moveTip(ev) { if (!tip.hidden) { tip.style.left = (ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 14) + 'px'; } }
function hideTip() { tip.hidden = true; }

// ---------- rendering ----------
function litSlot(i) {
  if (i === 0 || i === NSLOT - 1) return true;
  const id = state.order[i - 1];
  return !isDark(id) && !state.masked[id];
}

function update() {
  posOf = [];
  state.order.forEach((id, p) => { posOf[id] = p; });

  for (const s of spaxels) {
    const masked = state.masked[s.id];
    const cell = hexCells[s.id];
    cell.setAttribute('fill', masked ? 'url(#hhatch)' : RING_COLORS[s.ring]);
    cell.classList.toggle('sel', sel === s.id);
    cell.classList.toggle('masked', masked);
    const t = hexLabels[s.id];
    t.textContent = labelMode === 'none' ? '' :
      labelMode === 'name' ? s.label : slotNum(s.id);
    t.setAttribute('fill', masked ? '#c9c9d2' : RING_TEXT[s.ring]);
    if (labelMode === 'name') t.setAttribute('font-size', s.ring ? 0.42 : 0.62);
    else t.setAttribute('font-size', 0.62);
  }

  state.order.forEach((id, p) => {
    const cell = slitCells[p + 1];
    if (isDark(id)) {
      cell.setAttribute('fill', COL_D);
      slitHatch[p + 1].setAttribute('visibility', 'hidden');
      cell.classList.toggle('sel', sel === id);
      return;
    }
    const masked = state.masked[id];
    cell.setAttribute('fill', masked ? COL_MASK : RING_COLORS[spaxels[id].ring]);
    slitHatch[p + 1].setAttribute('visibility', masked ? 'visible' : 'hidden');
    cell.classList.toggle('sel', sel === id);
  });

  let conflicts = 0;
  for (let i = 0; i < NSLOT - 1; i++) {
    const bad = litSlot(i) && litSlot(i + 1);
    conflictBars[i].setAttribute('visibility', bad ? 'visible' : 'hidden');
    if (bad) conflicts++;
  }

  const nMasked = state.masked.filter(Boolean).length;
  const head = document.getElementById('headline');
  head.innerHTML =
    `${NF - nMasked} lit - ${nMasked} masked - ` +
    (conflicts === 0 ? `<span class="ok">no adjacent lit fibres</span>`
                     : `<span class="bad">${conflicts} adjacent lit pair${conflicts > 1 ? 's' : ''}</span>`);

  const rows = ringGroups.map((ids, r) => {
    const lit = ids.filter(id => !state.masked[id]).length;
    return `<tr><td><span class="sw" style="background:${RING_COLORS[r]}"></span>${RING_NAMES[r]}</td>` +
           `<td>${lit}/${ids.length} lit</td></tr>`;
  }).join('');
  document.getElementById('ringtable').innerHTML =
    `<tr><th>ring</th><th></th></tr>` + rows;

  document.getElementById('m-alt').classList.toggle('on', isAlternate());

  const si = document.getElementById('selinfo');
  if (sel === null) {
    si.textContent = mode === 'assign'
      ? 'nothing selected - click a spaxel, slit fibre or dark'
      : 'mask mode - click to toggle';
  } else if (isDark(sel)) {
    si.innerHTML = `<b>dark</b> at slit ${slotNum(sel)} - click another position to swap`;
  } else {
    si.innerHTML = `<b>${spaxels[sel].label}</b> at slit ${slotNum(sel)} - click another position to swap`;
  }

  save();
}

function buildLegend() {
  const parts = RING_NAMES.map((n, r) =>
    `<span><span class="sw" style="background:${RING_COLORS[r]}"></span>${n} (${ringGroups[r].length})</span>`);
  parts.push(`<span><span class="sw" style="background:${COL_C}"></span>calibration (fixed)</span>`);
  parts.push(`<span><span class="sw" style="background:${COL_D}"></span>dark (movable)</span>`);
  parts.push(`<span><span class="sw" style="background:repeating-linear-gradient(45deg,#2a2a31,#2a2a31 3px,#9a9aa6 3px,#9a9aa6 4px)"></span>masked</span>`);
  document.getElementById('legend').innerHTML = parts.join(' ');
}

// ---------- persistence ----------
const LSKEY = 'andes-ifu-slitdesign-v1';
function serialize() {
  return { v: 2, order: state.order, masked: state.masked.flatMap((m, i) => m ? [i] : []) };
}
function deserialize(o) {
  let order;
  if (o && o.v === 2 && Array.isArray(o.order) && o.order.length === NITEM) {
    order = o.order.slice();
  } else if (o && o.v === 1 && Array.isArray(o.perm) && o.perm.length === NF) {
    order = orderFromSpaxelSeq(o.perm);
  } else throw new Error('bad format');
  if (new Set(order).size !== NITEM || order.some(x => !(x >= 0 && x < NITEM)))
    throw new Error('layout is not a permutation');
  const masked = new Array(NF).fill(false);
  (o.masked || []).forEach(i => { if (i >= 0 && i < NF) masked[i] = true; });
  return { order, masked };
}
function save() { try { localStorage.setItem(LSKEY, JSON.stringify(serialize())); } catch (e) { } }
function load() {
  const h = new URLSearchParams(location.hash.slice(1)).get('s');
  if (h) {
    try {
      state = deserialize(JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/'))));
      history.replaceState(null, '', location.pathname);
      return;
    } catch (e) { console.warn('could not parse shared design:', e); }
  }
  try {
    const raw = localStorage.getItem(LSKEY);
    if (raw) state = deserialize(JSON.parse(raw));
  } catch (e) { }
}

// ---------- toolbar ----------
function setMode(m) {
  mode = m; sel = null;
  document.getElementById('mode-assign').classList.toggle('on', m === 'assign');
  document.getElementById('mode-mask').classList.toggle('on', m === 'mask');
  update();
}
function applyOrder(o) {
  pushUndo();
  if (maskAnchor === 'slit') {
    const m = new Array(NF).fill(false);
    state.order.forEach((id, p) => {
      if (!isDark(id) && state.masked[id] && !isDark(o[p])) m[o[p]] = true;
    });
    state.masked = m;
  }
  state.order = o; sel = null; update();
}
function setAnchor(a) {
  maskAnchor = a;
  document.getElementById('anchor-spaxel').classList.toggle('on', a === 'spaxel');
  document.getElementById('anchor-slit').classList.toggle('on', a === 'slit');
}
document.getElementById('anchor-spaxel').onclick = () => setAnchor('spaxel');
document.getElementById('anchor-slit').onclick = () => setAnchor('slit');
function applyMask(m) { pushUndo(); state.masked = m; update(); }

document.getElementById('mode-assign').onclick = () => setMode('assign');
document.getElementById('mode-mask').onclick = () => setMode('mask');
document.getElementById('labelmode').onchange = e => { labelMode = e.target.value; update(); };
document.getElementById('p-baseline').onclick = () => applyOrder(baselineOrder());
document.getElementById('p-mask1').onclick = () => {
  pushUndo(); state = deserialize(MASK1); sel = null; update();
};
document.getElementById('p-shuffle').onclick = () => applyOrder(orderFromSpaxelSeq(shuffleSeq()));
function isAlternate() {
  const cur = JSON.stringify(state.masked);
  return cur === JSON.stringify(alternateMask(1)) || cur === JSON.stringify(alternateMask(0));
}
document.getElementById('m-alt').onclick = () =>
  applyMask(isAlternate() ? new Array(NF).fill(false) : alternateMask(1));
document.getElementById('m-invert').onclick = () => applyMask(state.masked.map(m => !m));
document.getElementById('m-clear').onclick = () => applyMask(new Array(NF).fill(false));
document.getElementById('undo').onclick = undo;
document.getElementById('redo').onclick = redo;
document.getElementById('reset').onclick = () => {
  if (!confirm('Reset to baseline layout with no mask?')) return;
  pushUndo(); state = { order: baselineOrder(), masked: new Array(NF).fill(false) }; sel = null; update();
};
document.getElementById('export').onclick = () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ifu_slitdesign.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
document.getElementById('import').onclick = () => document.getElementById('importfile').click();
document.getElementById('importfile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const s = deserialize(JSON.parse(await f.text()));
    pushUndo(); state = s; sel = null; update();
  } catch (err) { alert('Import failed: ' + err.message); }
  e.target.value = '';
};
document.getElementById('share').onclick = async () => {
  const b64 = btoa(JSON.stringify(serialize())).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = location.origin === 'null' || location.protocol === 'file:'
    ? location.href.split('#')[0] + '#s=' + b64
    : location.origin + location.pathname + '#s=' + b64;
  try { await navigator.clipboard.writeText(url); alert('Share URL copied to clipboard.'); }
  catch (e) { prompt('Copy this URL:', url); }
};

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault(); e.shiftKey ? redo() : undo();
  } else if (e.key === 'a') setMode('assign');
  else if (e.key === 'm') setMode('mask');
  else if (e.key === 'Escape') { sel = null; update(); }
});

// ---------- init ----------
buildHex();
buildSlit();
buildLegend();
load();
update();
