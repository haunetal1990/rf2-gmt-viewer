// Undo / redo for everything that is edited in the viewer (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z, toolbar arrows).
// Two kinds of steps share one history:
//  * snapshots: after every user input (debounced, never while a mouse button is held) the editable values of all
//    editors are compared with the last state; what changed becomes one step. Covers materials (JSON), cameras
//    (.cam), seat / mirror / reference points (cockpitinfo), mirror settings (all_vehicles.ini), displays
//    (cockpitinfo) and TGM values. Only the values are compared - saving a file is no step.
//  * actions: scene edits of edit.js (show / hide, delete, GEN properties, added GMTs) with their own undo / redo.
'use strict';

const HIST = { undo: [], redo: [], last: null, timer: 0, busy: false, down: 0 };
const HIST_MAX = 300;

// ---------------------------------------------------------------- domains ---
// each domain: snap() -> { key: string }, restore(key, string), label(key), after() redraws once
const HIST_DOMAINS = [
  {
    id: 'mat',
    snap() { const o = {}; for (const [key, ms] of S.mats) if (ms.json) o[key] = JSON.stringify(ms.json); return o; },
    restore(k, v) { const ms = S.mats.get(k); if (!ms) return; ms.json = JSON.parse(v); ms._hist = true; },
    base(k) { const ms = S.mats.get(k); return ms && ms.saved != null ? ms.saved : undefined; },   // state on disk
    after() { for (const ms of S.mats.values()) if (ms._hist) { delete ms._hist; markDirty(ms, ms === S.selMat); } if (S.selMat) renderMat(); },
    label: k => 'Material ' + ((S.mats.get(k) || {}).name || k),
  },
  {
    id: 'cam',
    snap() { const o = {}; for (const c of CAMS.list || []) o[c.name] = JSON.stringify(c.params); return o; },
    restore(k, v) {
      const c = (CAMS.list || []).find(x => x.name === k); if (!c) return;
      const p = JSON.parse(v);
      for (const key of new Set([...Object.keys(c.params), ...Object.keys(p)])) {
        if (JSON.stringify(c.params[key]) === JSON.stringify(p[key])) continue;
        if (p[key] === undefined) delete c.params[key]; else c.params[key] = p[key];
        (CAMS.edits[c.name] = CAMS.edits[c.name] || {})[key] = p[key];
      }
    },
    after() { if (CAMS.open) renderCamPanel(); else renderCamQuick(); updateCamFooter(); camUpdateScene(); },
    label: k => 'Kamera ' + k,
  },
  {
    id: 'cp',
    snap() { const cp = CAMS.cockpit; return cp && cp.values ? { cockpitinfo: JSON.stringify(cp.values) } : {}; },
    restore(k, v) {
      const cp = CAMS.cockpit; if (!cp) return;
      const val = JSON.parse(v);
      for (const key of Object.keys(val)) if (JSON.stringify(cp.values[key]) !== JSON.stringify(val[key])) { cp.values[key] = val[key]; CAMS.cpEdits[key] = val[key]; }
    },
    after() { if (CAMS.open) renderCamPanel(); else renderCamQuick(); updateCamFooter(); camUpdateScene(); },
    label: () => 'Sitz / Spiegel / Bezugspunkte',
  },
  {
    id: 'mir',
    snap() { const m = CAMS.mp; return m ? { mirror: JSON.stringify([m.L, m.C, m.R, m.phys, m.fov]) } : {}; },
    restore(k, v) {
      const [L, C, R2, phys, fov] = JSON.parse(v), m = CAMS.mp;
      m.L = L; m.C = C; m.R = R2; m.phys = phys; m.fov = fov; CAMS.avDirty = true;
    },
    after() { mirrorSync(); mirrorRenderAll(); camUpdateScene(); },
    label: () => 'Spiegel',
  },
  {
    id: 'dash',
    snap() { const o = {}; for (const d of (typeof DASH !== 'undefined' && DASH.displays) || []) o[d.name] = JSON.stringify([d.scale || null, d.offset || null]); return o; },
    restore(k, v) {
      const d = DASH.displays.find(x => x.name === k); if (!d) return;
      const [sc, of] = JSON.parse(v);
      if (JSON.stringify(d.scale || null) !== JSON.stringify(sc)) { d.scale = sc || undefined; if (sc) DASH.edits[k + 'Scale'] = sc; }
      if (JSON.stringify(d.offset || null) !== JSON.stringify(of)) { d.offset = of || undefined; if (of) DASH.edits[k + 'Offset'] = of; }
      d._hist = true;
    },
    after() {
      for (const d of DASH.displays) if (d._hist) { delete d._hist; dashRerender(d.name); }
      updateDashFooter(); if (DASH.open) renderDashPanel();
    },
    label: k => 'Display ' + k,
  },
  {
    id: 'tgm',
    snap() {
      const o = {};
      if (typeof TG === 'undefined') return o;
      for (const f of TG.files.values()) o[f.path] = JSON.stringify(tgItems(f).map(it => it.value));
      return o;
    },
    restore(k, v) {
      const f = typeof tgFile === 'function' ? tgFile(k) : null; if (!f) return;
      const vals = JSON.parse(v), items = tgItems(f);
      if (vals.length !== items.length) return;
      items.forEach((it, i) => { if (it.value !== vals[i]) tgSetValue(f, it, vals[i]); });
      for (const nd of f.t.nodes) {                       // derived numbers of the nodes
        const g = nd.keys.find(x => x.key.toLowerCase() === 'geometry');
        if (g) { const n = tgNums(g.value); if (n.length >= 3) nd.geometry = n.slice(0, 3); }
      }
    },
    base(k) {                                           // unedited file (values before the first change)
      const f = typeof tgFile === 'function' ? tgFile(k) : null;
      return f ? JSON.stringify(tgItems(f).map(it => (it.orig !== undefined ? it.orig : it.value))) : undefined;
    },
    after() { if (TG.open) { tgRenderPanel(); tgBuild(); } tgFooter(); },
    label: k => 'TGM ' + k.split(/[\\/]/).pop(),
  },
  {
    id: 'clr',
    snap() { return typeof CLR !== 'undefined' && CLR.edit ? { hdv: JSON.stringify(CLR.edit) } : {}; },
    restore(k, v) { CLR.edit = JSON.parse(v); CLR.lockAngles = null; },
    after() { if (CLR.open) { clrRender(); clrPose(); } },
    label: () => 'Freigang (HDV)',
  },
];
function tgItems(f) { return [...f.t.realtime, ...f.t.nodes.flatMap(n => n.keys)]; }

function histSnap() {
  const s = {};
  for (const d of HIST_DOMAINS) { try { s[d.id] = d.snap(); } catch (e) { s[d.id] = {}; } }
  return s;
}
// differences last -> now. A key that is new (file loaded since the last check) is compared with its state on disk
// when the editor knows it (TGM, material JSON) - so the first change right after loading is a step as well
function histDiff(a, b) {
  const ch = [];
  for (const d of HIST_DOMAINS) {
    const A = (a && a[d.id]) || {}, B = b[d.id] || {};
    for (const k in B) {
      let before = A[k];
      if (!(k in A)) { if (!d.base) continue; try { before = d.base(k); } catch (e) { before = undefined; } if (before === undefined) continue; }
      if (before !== B[k]) ch.push({ d: d.id, k, before, after: B[k] });
    }
  }
  return ch;
}
function histLabel(ch) {
  const names = [...new Set(ch.map(c => HIST_DOMAINS.find(d => d.id === c.d).label(c.k)))];
  return names.length > 2 ? names.slice(0, 2).join(', ') + ' + ' + (names.length - 2) : names.join(', ');
}

// ------------------------------------------------------------- checkpoint ---
function histCheckpoint() {
  clearTimeout(HIST.timer); HIST.timer = 0;
  if (HIST.busy || !S.project) return;
  const now = histSnap();
  if (!HIST.last) { HIST.last = now; return; }
  const ch = histDiff(HIST.last, now);
  // keep new keys in the base (lazy loaded TGM files, cameras of a newly opened .cam ...)
  HIST.last = now;
  if (!ch.length) return;
  histPush({ kind: 'snap', label: histLabel(ch), ch });
}
function histSchedule() {
  if (HIST.busy || !S.project) return;
  clearTimeout(HIST.timer);
  HIST.timer = setTimeout(() => { if (HIST.down) histSchedule(); else histCheckpoint(); }, 450);
}
function histPush(step) {
  HIST.undo.push(step);
  if (HIST.undo.length > HIST_MAX) HIST.undo.shift();
  HIST.redo = [];
  histButtons();
}
function histReset() { HIST.undo = []; HIST.redo = []; HIST.last = null; clearTimeout(HIST.timer); histButtons(); }
window.histReset = histReset;
// state was changed from outside (file reloaded from disk): new base, no step
function histRebase() { if (!HIST.busy) HIST.last = histSnap(); }
window.histRebase = histRebase;

// ------------------------------------------------------- apply undo / redo ---
async function histApply(step, dir) {
  if (step.kind === 'fn') {
    const fn = dir < 0 ? step.undo : step.redo;
    if (!fn) return false;
    await fn();
    return true;
  }
  const touched = new Set();
  for (const c of step.ch) {
    const d = HIST_DOMAINS.find(x => x.id === c.d);
    try { d.restore(c.k, dir < 0 ? c.before : c.after); touched.add(d); } catch (err) { console.warn('undo', c, err); }
  }
  for (const d of touched) { try { d.after(); } catch (err) { console.warn('undo after', d.id, err); } }
  return true;
}
async function histUndo() {
  histCheckpoint();                                  // pending input first becomes its own step
  const step = HIST.undo.pop();
  if (!step) { toast('Nichts zum Rückgängigmachen'); histButtons(); return; }
  HIST.busy = true;
  try {
    await histApply(step, -1);
    HIST.redo.push(step);
    toast('Rückgängig: ' + step.label);
  } catch (err) { toast(err.message, 'err'); }
  finally { HIST.last = histSnap(); HIST.busy = false; histButtons(); }
}
async function histRedo() {
  histCheckpoint();
  if (HIST.redo.length === 0) { toast('Nichts zum Wiederholen'); histButtons(); return; }
  const step = HIST.redo.pop();
  HIST.busy = true;
  try {
    const ok = await histApply(step, +1);
    if (ok) { HIST.undo.push(step); toast('Wiederholt: ' + step.label); }
    else toast('„' + step.label + '“ lässt sich nicht wiederholen', 'warn');
  } catch (err) { toast(err.message, 'err'); }
  finally { HIST.last = histSnap(); HIST.busy = false; histButtons(); }
}
window.histUndo = histUndo; window.histRedo = histRedo;

// scene actions from edit.js: undoPush(label, undo, redo)
function undoPush(label, undo, redo) {
  histCheckpoint();
  histPush({ kind: 'fn', label, undo, redo });
}

// ------------------------------------------------------------------ UI ---
function histButtons() {
  const u = $('#tbUndo'), r = $('#tbRedo');
  if (!u) return;
  const lu = HIST.undo[HIST.undo.length - 1], lr = HIST.redo[HIST.redo.length - 1];
  u.disabled = !lu; r.disabled = !lr;
  u.title = lu ? 'Rückgängig: ' + lu.label + ' (Strg+Z)' : 'Rückgängig (Strg+Z)';
  r.title = lr ? 'Wiederholen: ' + lr.label + ' (Strg+Y)' : 'Wiederholen (Strg+Y)';
}
(() => {
  const nav = $('#toolbar');
  const u = el('button', { class: 'tb tb-icon', id: 'tbUndo', 'aria-label': 'Rückgängig', disabled: true, onclick: histUndo }, icon('undo', 15));
  const r = el('button', { class: 'tb tb-icon', id: 'tbRedo', 'aria-label': 'Wiederholen', disabled: true, onclick: histRedo }, icon('redo', 15));
  nav.prepend(u, r, el('span', { class: 'sep' }));
  histButtons();
  // every user input can change an editor value
  const poke = ev => { if (ev && ev.target && ev.target.closest && ev.target.closest('#tbUndo,#tbRedo')) return; histSchedule(); };
  for (const t of ['input', 'change', 'click', 'keyup', 'wheel']) document.addEventListener(t, poke, true);
  document.addEventListener('pointerdown', () => { HIST.down++; }, true);
  const up = () => { HIST.down = Math.max(0, HIST.down - 1); histSchedule(); };
  window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
  window.addEventListener('blur', () => { HIST.down = 0; });
  window.addEventListener('keydown', ev => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    const redo = k === 'y' || (k === 'z' && ev.shiftKey);
    if (k !== 'z' && !redo) return;
    const f = ev.target.closest && ev.target.closest('input[type=text],input:not([type]),input[type=number],textarea');
    if (f) return;                                     // text fields keep their own Ctrl+Z
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (redo) histRedo(); else histUndo();
  }, true);
})();

if (typeof I18N !== 'undefined' && I18N.extend) I18N.extend({
  'Rückgängig': 'Undo', 'Wiederholen': 'Redo', 'Rückgängig (Strg+Z)': 'Undo (Ctrl+Z)', 'Wiederholen (Strg+Y)': 'Redo (Ctrl+Y)',
  'Nichts zum Wiederholen': 'Nothing to redo', 'Freigang (HDV)': 'Clearance (HDV)', 'Spiegel': 'Mirrors', 'Sitz / Spiegel / Bezugspunkte': 'Seat / mirror / reference points',
}, [
  [/^Rückgängig: (.+) \(Strg\+Z\)$/, 'Undo: $1 (Ctrl+Z)'], [/^Wiederholen: (.+) \(Strg\+Y\)$/, 'Redo: $1 (Ctrl+Y)'],
  [/^Wiederholt: (.+)$/, 'Redone: $1'], [/^„(.+)“ lässt sich nicht wiederholen$/, '"$1" cannot be redone'],
]);
