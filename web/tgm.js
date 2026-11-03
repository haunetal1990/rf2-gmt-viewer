// TGM overlay: the tyre physics (rF2 TGM nodes) as a coloured wire frame at the wheels, with the
// cross section compared to the tyre / rim GMT and the values of the TBC (Radius, Width, Rim).
// Geometry=(x, y, t): x lateral, y = -radius (outer surface), t = thickness inwards;
// [Realtime] SizeMultiplier=(lateral, radial) scales the tyre in the game (checked: TBC Radius = max(-y) * radial).
'use strict';

const TG = {
  open: false, loaded: false, setup: null, wheels: [], files: new Map(), assign: {}, compound: null,
  wheel: null, node: null, collapsed: false,
  opts: { color: 'zone', inner: true, mesh: 'xray', refs: true, spokes: 24, flip: false, sym: true, preview: true, snap: 'edge' },
  meshHidden: [],                                  // tyre / rim parts hidden by the 'Mesh unsichtbar' mode
  sel: null,                                       // multi selection of nodes (only valid while it contains TG.node)
};
let tgPrev = null;                                  // saved view while a slider / node is dragged
const TG_WHEEL_NAME = { FL: 'Vorne links', FR: 'Vorne rechts', RL: 'Hinten links', RR: 'Hinten rechts' };
const TG_ZONE = {
  bead: [0.86, 0.36, 0.92], tread: [1.0, 0.55, 0.16], shoulder: [0.98, 0.86, 0.26], side: [0.3, 0.76, 0.96],
};
const tgFmt = v => { if (!isFinite(v)) return '0'; const s = String(parseFloat((+v).toPrecision(7))); return s === '-0' ? '0' : s; };
const tgMm = v => (v == null || !isFinite(v) ? '–' : (v * 1000).toFixed(1));
// selected nodes: TG.sel when it contains the active node TG.node, else only TG.node (or nothing)
function tgSelSet() {
  if (TG.node == null) return new Set();
  return TG.sel && TG.sel.has(TG.node) ? TG.sel : new Set([TG.node]);
}
const tgNums = s => (String(s || '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);

// ------------------------------------------------------------------ data ---
function tgFile(path) { return path ? TG.files.get(normPath(path)) : null; }
async function tgLoadFile(path, force) {
  const key = normPath(path);
  if (!force && TG.files.has(key)) return TG.files.get(key);
  const t = await api.get('/api/tgm?path=' + encodeURIComponent(path));
  const f = { path: t.path, t, edits: new Map() };
  TG.files.set(key, f);
  return f;
}
function tgSM(f) {
  const it = f.t.realtime.find(x => x.key.toLowerCase() === 'sizemultiplier');
  const n = it ? tgNums(it.value) : [];
  return [n.length > 0 ? n[0] : 1, n.length > 1 ? n[1] : 1];
}
function tgSetValue(f, item, value) {
  if (item.value === value) return;
  if (item.orig === undefined) item.orig = item.value;
  item.value = value;
  if (value === item.orig) f.edits.delete(item.line);
  else f.edits.set(item.line, { line: item.line, key: item.key, value });
}
function tgSetGeometry(f, nd, g) {
  nd.geometry = g;
  const it = nd.keys.find(k => k.key.toLowerCase() === 'geometry');
  if (it) tgSetValue(f, it, '(' + g.map(tgFmt).join(',') + ')');
}
function tgDirtyFiles() { return [...TG.files.values()].filter(f => f.edits.size); }
const tgGeoEdited = f => [...f.edits.values()].some(e => /^(geometry|innergeometryoverride)$/i.test(e.key));

// 2D section of a TGM: outer / inner points (lateral outboard +, radius), scaled like the game
function tgSection(f) {
  const [sx, sy] = tgSM(f), side = TG.opts.flip ? -1 : 1;
  const nodes = f.t.nodes.filter(n => n.geometry);
  const P = nodes.map(n => [n.geometry[0], -n.geometry[1]]);
  const cx = P.reduce((a, p) => a + p[0], 0) / (P.length || 1), cy = P.reduce((a, p) => a + p[1], 0) / (P.length || 1);
  return nodes.map((n, i) => {
    const p = P[i], a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    let nx = -ty, ny = tx;                                       // normal, pointing into the tyre cavity
    if (nx * (cx - p[0]) + ny * (cy - p[1]) < 0) { nx = -nx; ny = -ny; }
    const t = n.geometry[2] || 0;
    const inn = n.inner ? [n.inner[0], -n.inner[1]] : [p[0] + nx * t, p[1] + ny * t];
    return { n, out: [p[0] * sx * side, p[1] * sy], inn: [inn[0] * sx * side, inn[1] * sy] };
  });
}
function tgZone(n) {
  const rr = n.ringAndRim || [0, 0];
  if (rr[1] > 0) return 'bead';
  if (rr[0] >= 0.99) return 'tread';
  if (rr[0] > 0) return 'shoulder';
  return 'side';
}
function tgRamp(t) {                                              // blue - cyan - green - yellow - red
  const st = [[0.25, 0.4, 1], [0.2, 0.85, 0.95], [0.35, 0.85, 0.35], [0.98, 0.86, 0.2], [0.95, 0.3, 0.25]];
  t = Math.max(0, Math.min(1, isFinite(t) ? t : 0)) * (st.length - 1);
  const i = Math.min(st.length - 2, Math.floor(t)), k = t - i;
  return st[i].map((v, j) => v + (st[i + 1][j] - v) * k);
}
function tgColors(f, sec, wh) {
  const m = TG.opts.color;
  if (m === 'zone') return sec.map(s => TG_ZONE[tgZone(s.n)]);
  if (m === 'fit') return sec.map(s => tgFitColor(tgDist(wh, s.out)));
  const val = s => m === 'thick' ? s.n.geometry[2] : m === 'tread' ? (s.n.treadDepth || 0) : s.n.plies;
  const vs = sec.map(val), lo = Math.min(...vs), hi = Math.max(...vs);
  return vs.map(v => tgRamp(hi > lo ? (v - lo) / (hi - lo) : 0.5));
}
// deviation colour: < 1.5 mm green, 3 mm yellow, >= 8 mm red
function tgFitColor(d) {
  if (d == null) return [0.55, 0.58, 0.62];
  if (d < 0.0015) return [0.35, 0.85, 0.35];
  if (d < 0.003) return tgRamp(0.5 + 0.25 * (d - 0.0015) / 0.0015);
  return tgRamp(0.75 + 0.25 * Math.min(1, (d - 0.003) / 0.005));
}
// distance (m) of a TGM outer point to the section of the tyre GMT (edges), null without GMT
function tgDist(wh, p) {
  const s = wh && wh.tire && wh.tire.section;
  if (s && s.edges.length) {
    let best = Infinity;
    for (const [i, j] of s.edges) {
      const a = s.pts[i], b = s.pts[j], dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy;
      const t = ll ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll)) : 0;
      const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
      if (d < best) best = d;
    }
    return best;
  }
  const pr = wh && wh.tire && wh.tire.profile;
  if (!pr || !pr.x.length) return null;
  if (p[0] < pr.x[0] || p[0] > pr.x[pr.x.length - 1]) return null;
  let k = 0; while (k < pr.x.length - 2 && pr.x[k + 1] < p[0]) k++;
  const t = (p[0] - pr.x[k]) / ((pr.x[k + 1] - pr.x[k]) || 1);
  return Math.abs(pr.rmax[k] + (pr.rmax[k + 1] - pr.rmax[k]) * t - p[1]);
}
// TBC entry (Radius, Width, Rim) of the compound whose TGM this wheel shows
function tgTbc(w) {
  const cs = (TG.setup && TG.setup.compounds) || [], p = TG.assign[w];
  if (!p) return null;
  const same = c => c && c.wheels[w] && c.wheels[w].path && normPath(c.wheels[w].path) === normPath(p);
  if (TG.compound != null && same(cs[TG.compound])) return cs[TG.compound].wheels[w];
  const c = cs.find(same);
  return c ? c.wheels[w] : null;
}

// ------------------------------------------------------------- 3D lines ---
function tgBuild() {
  if (!R.setTgm) return;
  if (!TG.open) { R.setTgm(null, null, { visible: false }); return; }
  const pos = [], col = [];
  const line = (a, b, ca, cb) => { pos.push(...a, ...b); col.push(...ca, ...(cb || ca)); };
  const SEG = 96, spokes = Math.max(0, TG.opts.spokes | 0);
  for (const wh of TG.wheels) {
    const f = tgFile(TG.assign[wh.wheel]);
    if (!f || (tgPrev && wh.wheel !== TG.wheel)) continue;
    const sec = tgSection(f), cols = tgColors(f, sec, wh);
    const c = wh.center, os = wh.outSign;
    const P = (lat, r, a) => [c[0] + os * lat, c[1] + r * Math.cos(a), c[2] + r * Math.sin(a)];
    const selW = wh.wheel === TG.wheel, tgSel = tgSelSet();
    const ring = (lat, r, rgba) => { for (let k = 0; k < SEG; k++) line(P(lat, r, k / SEG * 2 * Math.PI), P(lat, r, (k + 1) / SEG * 2 * Math.PI), rgba); };
    sec.forEach((s, i) => {
      const hl = selW && tgSel.has(s.n.index);
      ring(s.out[0], s.out[1], hl ? [1, 1, 1, 1] : [...cols[i], 0.9]);
      if (TG.opts.inner) ring(s.inn[0], s.inn[1], hl ? [1, 1, 1, 0.8] : [...cols[i], 0.28]);
    });
    for (let k = 0; k < spokes; k++) {
      const a = k / spokes * 2 * Math.PI;
      for (let i = 0; i + 1 < sec.length; i++) {
        line(P(sec[i].out[0], sec[i].out[1], a), P(sec[i + 1].out[0], sec[i + 1].out[1], a), [...cols[i], 1], [...cols[i + 1], 1]);
        if (TG.opts.inner) line(P(sec[i].inn[0], sec[i].inn[1], a), P(sec[i + 1].inn[0], sec[i + 1].inn[1], a), [...cols[i], 0.35], [...cols[i + 1], 0.35]);
      }
      if (TG.opts.inner) sec.forEach((s, i) => line(P(s.out[0], s.out[1], a), P(s.inn[0], s.inn[1], a), [...cols[i], 0.3]));
    }
    if (TG.opts.refs) {
      const tb = tgTbc(wh.wheel);
      if (tb && tb.radius) ring(0, tb.radius, [1, 1, 1, 0.75]);
      if (tb && tb.rim) {
        const xs = sec.map(s => s.out[0]);
        ring(Math.min(...xs), tb.rim, [0.6, 0.65, 0.7, 0.7]); ring(Math.max(...xs), tb.rim, [0.6, 0.65, 0.7, 0.7]);
      }
    }
  }
  // preview: no see-through pass - lines inside the tyre / rim mesh are hidden by it, as they should be
  R.setTgm(new Float32Array(pos), new Float32Array(col), { visible: true, xray: TG.opts.mesh === 'xray' && !tgPrev, front: false });
}

// ------------------------------------------------ tyre / rim mesh display ---
// xray: mesh solid, TGM lines behind it shine through dimmed · solid: mesh hides the lines behind it (like while
// dragging) · hidden: tyre + rim meshes off, only the TGM
const TG_MESH_MODES = [['xray', 'Sichtbar, TGM scheint durch'], ['solid', 'Sichtbar, deckend'], ['hidden', 'Unsichtbar (nur TGM)']];
function tgMeshSelect() {
  const s = el('select', { class: 'sel tgm-mesh-sel', 'aria-label': 'Reifen-Mesh' });
  for (const [v, t] of TG_MESH_MODES) s.append(el('option', { value: v, text: t, selected: TG.opts.mesh === v }));
  s.addEventListener('change', () => { TG.opts.mesh = s.value; document.querySelectorAll('.tgm-mesh-sel').forEach(o => { o.value = s.value; }); tgApplyMesh(); tgBuild(); });
  return s;
}
function tgApplyMesh() {
  const want = TG.open && TG.opts.mesh === 'hidden';
  if (!want) { for (const id of TG.meshHidden) if (R.parts.has(id)) R.setVisible(id, true); TG.meshHidden = []; R.requestRender(); return; }
  for (const wh of TG.wheels) for (const id of [wh.tire && wh.tire.id, wh.rim && wh.rim.id]) {
    const p = id != null && R.parts.get(id);
    if (p && p.visible && !TG.meshHidden.includes(id)) { R.setVisible(id, false); TG.meshHidden.push(id); }
  }
  R.requestRender();
}

// ---------------------------------------------------- preview while editing ---
// While a SizeMultiplier slider or a node is dragged: remember the visible meshes, show only tyre + rim of this
// wheel (solid, so TGM lines inside the mesh disappear); the camera stays. Released -> all back.
function tgPreviewStart() {
  if (tgPrev || !TG.open || !TG.opts.preview) return;
  const wh = TG.wheels.find(w => w.wheel === TG.wheel);
  if (!wh) return;
  tgPrev = { vis: [] };
  const keep = new Set(TG.opts.mesh === 'hidden' ? [] : [wh.tire && wh.tire.id, wh.rim && wh.rim.id].filter(id => id != null && R.parts.has(id)));
  for (const [id, p] of R.parts) {
    if (p.visible && !keep.has(id)) { tgPrev.vis.push(id); R.setVisible(id, false); }
    if (keep.has(id) && !p.visible) { tgPrev.shown = (tgPrev.shown || []).concat(id); R.setVisible(id, true); }
  }
  tgBuild();
}
function tgPreviewEnd() {
  if (!tgPrev) return;
  const pv = tgPrev;
  tgPrev = null;
  for (const id of pv.vis) R.setVisible(id, true);
  for (const id of pv.shown || []) R.setVisible(id, false);
  tgBuild();
  R.requestRender();
}
window.addEventListener('pointerup', () => { if (tgPrev) setTimeout(tgPreviewEnd, 0); });
window.addEventListener('blur', tgPreviewEnd);
let tgRaf = 0;
function tgRefresh(panel = true) {
  if (tgRaf) return;
  tgRaf = requestAnimationFrame(() => { tgRaf = 0; tgBuild(); if (panel) { tgRenderSection(); tgRenderFit(); tgRenderNodeInfo(); tgSyncTable(); } tgFooter(); });
}

// ------------------------------------------------------------------- panel ---
async function tgEnsureSetup() {
  if (TG.loaded) return;
  const d = await api.get('/api/tgm/setup');
  TG.setup = d.setup; TG.wheels = d.wheels || [];
  TG.loaded = true;
  const st = TG.setup;
  if (st.compounds.length) {
    TG.compound = Math.min(st.front || 0, st.compounds.length - 1);
    tgApplyCompound(TG.compound, st.rear);
  } else if (st.tgms.length) {
    for (const w of ['FL', 'FR', 'RL', 'RR']) TG.assign[w] = st.tgms[0];
  }
  if (!TG.wheels.length) {                                        // no wheels in the scene: one tyre at the origin
    const f = TG.assign.FL || st.tgms[0];
    TG.wheels = [{ wheel: 'FL', center: [0, 0.36, 0], outSign: 1, virtual: true }];
    if (f) TG.assign.FL = f;
  }
  TG.wheel = TG.wheels[0].wheel;
  await Promise.all([...new Set(Object.values(TG.assign).filter(Boolean))].map(p => tgLoadFile(p).catch(err => toast(err.message, 'err'))));
}
function tgApplyCompound(front, rear) {
  const cs = TG.setup.compounds, cf = cs[front], cr = cs[rear != null ? Math.min(rear, cs.length - 1) : front] || cf;
  TG.compound = front;
  for (const w of ['FL', 'FR']) if (cf && cf.wheels[w] && cf.wheels[w].path) TG.assign[w] = cf.wheels[w].path;
  for (const w of ['RL', 'RR']) if (cr && cr.wheels[w] && cr.wheels[w].path) TG.assign[w] = cr.wheels[w].path;
}

async function openTgmPanel(on) {
  if (on && !S.project) return;
  if (on && typeof CAMS !== 'undefined' && CAMS.open) openCamPanel(false);
  if (on && typeof DASH !== 'undefined' && DASH.open) openDashPanel(false);
  if (!on && TG.full) tgFullscreen(false);
  if (on && typeof CLR !== 'undefined' && CLR.open) clrOpen(false);
  TG.open = on;
  $('#tgmPanel').classList.toggle('hidden', !on);
  $('#matPanel').classList.toggle('hidden', on || !S.project);
  $('#tbTgm').classList.toggle('on', on);
  if (on) {
    try { loading(true, 'Lade Reifenphysik …'); await tgEnsureSetup(); }
    catch (err) { toast(err.message, 'err'); }
    finally { loading(false); }
    tgRenderPanel();
  }
  tgApplyMesh();
  tgBuild();
}
function tgClose() { if (TG.open) openTgmPanel(false); }

function tgRenderPanel() {
  const st = TG.setup || { compounds: [], tgms: [], notes: [] };
  // compound (TBC)
  const cs = $('#tgmCompound'); cs.innerHTML = '';
  if (st.compounds.length) {
    st.compounds.forEach((c, i) => cs.append(el('option', { value: i, text: c.name + (i === st.front ? '  (HDV)' : ''), selected: i === TG.compound })));
    cs.append(el('option', { value: -1, text: 'Eigene Auswahl', selected: TG.compound == null }));
  }
  $('#tgmCompoundRow').classList.toggle('hidden', !st.compounds.length);
  $('#tgmSrc').textContent = [st.hdv && st.hdv.split(/[\\/]/).pop(), st.tbc && st.tbc.split(/[\\/]/).pop()].filter(Boolean).join(' → ')
    + (st.notes && st.notes.length ? ' · ' + st.notes.join(' · ') : '');
  // wheels
  const pills = $('#tgmWheels'); pills.innerHTML = '';
  TG.wheels.forEach(w => pills.append(el('button', { class: 'pill' + (w.wheel === TG.wheel ? ' on' : ''), text: w.virtual ? 'Reifen' : w.wheel,
    title: (TG_WHEEL_NAME[w.wheel] || w.wheel) + (w.tire ? ' · ' + w.tire.name : ''),
    onclick: () => { TG.wheel = w.wheel; TG.node = null; TG.sel = null; tgRenderPanel(); tgBuild(); },
    ondblclick: () => { if (w.tire) R.focus([w.tire.id]); } })));
  // file of the selected wheel (applies to its axle)
  const fs = $('#tgmFile'); fs.innerHTML = '';
  const cur = TG.assign[TG.wheel];
  const files = st.tgms.slice();
  if (cur && !files.some(p => normPath(p) === normPath(cur))) files.push(cur);
  if (!files.length) fs.append(el('option', { value: '', text: 'Keine TGM gefunden' }));
  files.forEach(p => fs.append(el('option', { value: p, text: p.split(/[\\/]/).pop(), selected: cur && normPath(p) === normPath(cur) })));
  $('#tgmFileLbl').textContent = TG.wheels.length > 1 ? (TG.wheel[0] === 'F' ? 'TGM Vorderachse' : 'TGM Hinterachse') : 'TGM';
  // options
  document.querySelectorAll('#tgmColor button').forEach(b => b.classList.toggle('on', b.dataset.c === TG.opts.color));
  if (!$('#tgmMeshRow')) $('#tgmInner').closest('label').parentElement.after(el('div', { class: 'axis tgm-prevmesh', id: 'tgmMeshRow' }, el('span', { class: 'an', text: 'Reifen-Mesh' }), tgMeshSelect()));
  $('#tgmInner').checked = TG.opts.inner; $('#tgmRefs').checked = TG.opts.refs;
  $('#tgmFlip').checked = TG.opts.flip; $('#tgmPreview').checked = TG.opts.preview; $('#tgmSpokes').value = TG.opts.spokes; $('#oTgmSpokes').textContent = TG.opts.spokes;
  $('#tgmPanel').classList.toggle('collapsed', TG.collapsed);
  tgRenderSection(); tgRenderFit(); tgRenderNodeInfo(); tgRenderEdit(); tgFooter();
}

// ----------------------------------------------------------- 2D section ---
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, a = {}) => { const e = document.createElementNS(SVGNS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
const tgCss = c => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
let tgDrag = null;
function tgRenderSection() {
  const box = $('#tgmSection'); box.innerHTML = '';
  const wh = TG.wheels.find(w => w.wheel === TG.wheel), f = tgFile(TG.assign[TG.wheel]);
  if (!f) { box.append(el('div', { class: 'note', text: 'Keine TGM für dieses Rad. Datei unten wählen.' })); return; }
  const sec = tgSection(f), cols = tgColors(f, sec, wh), tb = tgTbc(TG.wheel);
  const pts = sec.flatMap(s => [s.out, s.inn]);
  const tire = wh && wh.tire && wh.tire.section;
  if (tire) pts.push(...tire.pts);
  let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0]));
  let r0 = Math.min(...pts.map(p => p[1])), r1 = Math.max(...pts.map(p => p[1]));
  if (tb && tb.radius) r1 = Math.max(r1, tb.radius);
  if (tb && tb.rim) r0 = Math.min(r0, tb.rim);
  const W = Math.max(Math.abs(x0), Math.abs(x1)) + 0.012;
  r0 -= 0.015; r1 += 0.01;
  const base = [-W * 1000, -r1 * 1000, 2 * W * 1000, (r1 - r0) * 1000];
  TG.baseVb = base;
  let vb = base;
  const full = TG.full;
  if (full && TG.zoom) { const z = TG.zoom, w = base[2] / z.s, h = base[3] / z.s; vb = [z.cx - w / 2, z.cy - h / 2, w, h]; }
  const pxW = box.clientWidth || 322;
  const svgH = full ? Math.max(200, box.clientHeight - 40) : Math.min(320, Math.max(150, pxW * vb[3] / vb[2]));
  const k = Math.max(vb[2] / pxW, vb[3] / svgH);                        // mm per screen pixel (viewBox "meet")
  TG.k = k;
  // lines and grid reach far beyond the picture, so panning / zooming out never shows their ends
  const E = full ? [base[0] - base[2] * 4, base[1] - base[3] * 6, base[2] * 9, base[3] * 13] : vb;
  const svg = sv('svg', { viewBox: vb.join(' '), class: 'tgm-svg', role: 'img', 'aria-label': 'Querschnitt TGM gegen GMT' });
  // panel: height from the CSS width (aspect ratio) - not from a measured width, which changes when the scroll bar
  // of the panel appears after the first render (the drawing then jumped by a few pixels)
  if (full) svg.style.height = svgH + 'px';
  else { svg.style.aspectRatio = vb[2] + ' / ' + vb[3]; svg.style.height = 'auto'; }
  const X = v => v * 1000, Y = v => -v * 1000;
  // grid: radius every 25 mm, lateral every 50 mm
  const gr0 = full ? (-(E[1] + E[3]) / 1000) : r0, gr1 = full ? -E[1] / 1000 : r1, gW = full ? E[2] / 2000 : W;
  for (let r = Math.max(0, Math.ceil(gr0 * 40) / 40); r <= gr1; r += 0.025) {
    svg.append(sv('line', { x1: E[0], x2: E[0] + E[2], y1: Y(r), y2: Y(r), class: 'g' }));
    const t = sv('text', { x: vb[0] + 3 * k, y: Y(r) - 2 * k, 'font-size': 9 * k, class: 'gt' }); t.textContent = Math.round(r * 1000); svg.append(t);
  }
  for (let x = -Math.floor(gW * 20) / 20; x <= gW; x += 0.05) svg.append(sv('line', { x1: X(x), x2: X(x), y1: E[1], y2: E[1] + E[3], class: Math.abs(x) < 1e-6 ? 'g0' : 'g' }));
  const lab = sv('text', { x: vb[0] + vb[2] - 3 * k, y: vb[1] + vb[3] - 4 * k, 'font-size': 9 * k, class: 'gt', 'text-anchor': 'end' });
  lab.textContent = TG.opts.flip ? '← außen (TGM −x)' : 'außen (TGM +x) →'; svg.append(lab);
  const edges = (s, cls) => { if (!s) return; const g = sv('g', { class: cls });
    for (const [i, j] of s.edges) g.append(sv('line', { x1: X(s.pts[i][0]), y1: Y(s.pts[i][1]), x2: X(s.pts[j][0]), y2: Y(s.pts[j][1]) }));
    svg.append(g); };
  const rs = wh && wh.rim && wh.rim.section;            // rim: only barrel + flange (outer 25 %), spokes would clutter the view
  if (rs) {
    if (rs.cut) edges(rs, 'rim');                     // real cut between the spokes
    else { const rmx = Math.max(...rs.pts.map(p => p[1])), lim = rmx * 0.75;
      edges({ pts: rs.pts, edges: rs.edges.filter(([i, j]) => rs.pts[i][1] >= lim && rs.pts[j][1] >= lim) }, 'rim'); }
  }
  edges(tire, 'tire');
  if (!tire && wh && wh.tire && wh.tire.profile) {
    const pr = wh.tire.profile;
    svg.append(sv('polyline', { class: 'tire', points: pr.x.map((x, i) => X(x) + ',' + Y(pr.rmax[i])).join(' ') }));
  }
  if (TG.opts.refs && tb) {
    const ref = (r, txt) => { svg.append(sv('line', { x1: E[0], x2: E[0] + E[2], y1: Y(r), y2: Y(r), class: 'ref' }));
      const t = sv('text', { x: vb[0] + vb[2] - 3 * k, y: Y(r) - 2 * k, 'font-size': 9 * k, class: 'rt', 'text-anchor': 'end' }); t.textContent = txt; svg.append(t); };
    if (tb.radius) ref(tb.radius, 'TBC Radius ' + tgMm(tb.radius));
    if (tb.rim) ref(tb.rim, 'TBC Rim ' + tgMm(tb.rim));
  }
  const gT = sv('g');
  sec.forEach((s, i) => {
    gT.append(sv('line', { x1: X(s.out[0]), y1: Y(s.out[1]), x2: X(s.inn[0]), y2: Y(s.inn[1]), stroke: tgCss(cols[i]), class: 'tie' }));
    if (i + 1 < sec.length) {
      gT.append(sv('line', { x1: X(s.out[0]), y1: Y(s.out[1]), x2: X(sec[i + 1].out[0]), y2: Y(sec[i + 1].out[1]), stroke: tgCss(cols[i]), class: 'o' }));
      gT.append(sv('line', { x1: X(s.inn[0]), y1: Y(s.inn[1]), x2: X(sec[i + 1].inn[0]), y2: Y(sec[i + 1].inn[1]), stroke: tgCss(cols[i]), class: 'in' }));
    }
  });
  svg.append(gT);
  const selS = tgSelSet();
  sec.forEach((s, i) => {
    const on = selS.has(s.n.index), act = TG.node === s.n.index;
    const c = sv('circle', { cx: X(s.out[0]), cy: Y(s.out[1]), r: (act ? 4.8 : on ? 4 : 2.6) * k, fill: tgCss(cols[i]), class: 'nd' + (on ? ' on' : '') + (act ? ' act' : '') });
    c.dataset.n = s.n.index;
    const tt = sv('title'); tt.textContent = 'Node ' + s.n.label + ' · ' + tgZoneName(tgZone(s.n)); c.append(tt);
    svg.append(c);
  });
  if (tgDrag && tgDrag.snap) svg.append(sv('circle', { cx: X(tgDrag.snap[0]), cy: Y(tgDrag.snap[1]), r: 7 * k, class: 'snap' }));
  if (tgDrag && tgDrag.snaps) for (const h of tgDrag.snaps) svg.append(sv('circle', { cx: X(h[0]), cy: Y(h[1]), r: 5 * k, class: 'snap' }));
  if (tgBand) svg.append(sv('rect', { id: 'tgmBand', class: 'band', ...tgBandRect() }));
  box.append(svg);
  if (full) box.append(el('div', { class: 'tgm-full-hint small muted', text: 'Linke Maustaste: Punkt wählen, Rahmen ziehen = mehrere wählen (Shift = hinzufügen / abwählen), Punkte ziehen = verschieben · Alt beim Ziehen = Snap kurz umschalten · Mausrad oder Strg + linke Maustaste = zoomen · rechte oder mittlere Maustaste = Ansicht verschieben' }));
  else box.append(el('div', { class: 'tgm-full-hint small muted', text: 'Doppelklick = Vollbild' }));
  const leg = el('div', { class: 'tgm-legend small' });
  if (TG.opts.color === 'zone') for (const z of ['tread', 'shoulder', 'side', 'bead']) leg.append(el('span', {}, el('i', { style: 'background:' + tgCss(TG_ZONE[z]) }), tgZoneName(z)));
  else if (TG.opts.color === 'fit') leg.append(el('span', {}, el('i', { style: 'background:' + tgCss(tgFitColor(0)) }), '< 1,5 mm'),
    el('span', {}, el('i', { style: 'background:' + tgCss(tgFitColor(0.003)) }), '3 mm'), el('span', {}, el('i', { style: 'background:' + tgCss(tgFitColor(0.008)) }), '≥ 8 mm'));
  else leg.append(el('span', {}, el('i', { class: 'grad' }), { thick: 'Dicke: klein → groß', tread: 'Profiltiefe: klein → groß', plies: 'Lagen: wenige → viele' }[TG.opts.color]));
  leg.append(el('span', {}, el('i', { class: 'gmt' }), 'Reifen-GMT'), el('span', {}, el('i', { class: 'rimc' }), 'Felgen-GMT'));
  box.append(leg);
  if (full) tgFullHead();
}

// ------------------------------------------------- section: select / move / snap / zoom / pan
// left on a node: select it (Ctrl = toggle, Shift = add) and drag all selected nodes; left on the background:
// selection frame; Ctrl + left on the background or wheel: zoom (full screen); right / middle: pan (full screen)
let tgBand = null, tgPan = null, tgZoomRaf = 0;
function tgBandRect() {
  const b = tgBand;
  return { x: Math.min(b.x0, b.x1), y: Math.min(b.y0, b.y1), width: Math.abs(b.x1 - b.x0), height: Math.abs(b.y1 - b.y0), 'stroke-width': 1 };
}
function tgSvgPoint(ev) {
  const svg = $('#tgmSection svg'), m = svg && svg.getScreenCTM();
  if (!m) return null;
  return new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
}
// snap target (section coordinates, m) near p: vertices of the tyre GMT first, then its edges
function tgSnap(p, invert) {
  let mode = TG.opts.snap;
  if (invert) mode = mode === 'off' ? 'vert' : 'off';
  if (mode === 'off') return null;
  const wh = TG.wheels.find(w => w.wheel === TG.wheel);
  const secs = [wh && wh.tire && wh.tire.section, wh && wh.rim && wh.rim.section].filter(Boolean);   // tyre and rim
  if (!secs.length) return null;
  const rad = 12 * (TG.k || 1) / 1000;                 // 12 screen pixels; a mesh corner within 12 px wins, else the nearest line
  let best = null, bd = rad;
  for (const s of secs) for (const q of s.pts) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
  if (best || mode !== 'edge') return best ? best.slice() : null;
  bd = rad;
  for (const s of secs) for (const [i, j] of s.edges) {
    const a = s.pts[i], b = s.pts[j], dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy;
    const t = ll ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll)) : 0;
    const q = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
function tgStartDrag(ev, f, idx, p) {
  const sec = tgSection(f), s = sec.find(x => x.n.index === idx);
  if (!s) return;
  const start = new Map();
  for (const nd of f.t.nodes) if (nd.geometry) start.set(nd.index, nd.geometry.slice());
  tgDrag = { f, id: ev.pointerId, moved: false, grab: s.out.slice(), off: [s.out[0] - p.x / 1000, s.out[1] + p.y / 1000], start, sel: [...tgSelSet()], snap: null };
}
function tgMoveDrag(ev) {
  const p = tgSvgPoint(ev); if (!p) return;
  const d = tgDrag, f = d.f, nodes = f.t.nodes;
  if (!d.moved) tgPreviewStart();
  let q = [p.x / 1000 + d.off[0], -p.y / 1000 + d.off[1]];
  const alt = ev.altKey;                            // Alt held = snap toggled for the moment
  d.snap = tgSnap(q, alt); d.snaps = [];
  if (d.snap) q = d.snap;
  const [sx, sy] = tgSM(f), side = TG.opts.flip ? -1 : 1;
  const dLat = (q[0] - d.grab[0]) / sx * side, dY = -(q[1] - d.grab[1]) / sy;   // in TGM units (geometry y = -radius)
  const g0 = d.start.get(TG.node), grabSign = Math.sign(g0[0]) || 1, last = nodes.length - 1;
  const done = new Set();
  for (const i of d.sel) {
    let c = i, mi = last - i;
    // symmetric: move the node on the side of the grabbed one, mirror the other
    if (TG.opts.sym && mi !== i && (Math.sign(d.start.get(i)[0]) || 1) !== grabSign) { c = mi; mi = i; }
    if (done.has(c)) continue;
    done.add(c);
    const st = d.start.get(c); if (!st) continue;
    let g = [st[0] + dLat, st[1] + dY, st[2]];
    if (c !== TG.node && d.sel.length > 1) {          // every other selected point snaps to the line in front of it
      const o = [g[0] * sx * side, -g[1] * sy], h = tgSnap(o, alt);
      if (h) { g = [h[0] / (sx * side), -h[1] / sy, g[2]]; d.snaps.push(h); }
    }
    g = [+g[0].toFixed(5), +g[1].toFixed(5), g[2]];
    tgSetGeometry(f, nodes[c], g);
    if (TG.opts.sym && mi !== c && nodes[mi] && nodes[mi].geometry) { done.add(mi); tgSetGeometry(f, nodes[mi], [-g[0], g[1], nodes[mi].geometry[2]]); }
  }
  d.moved = true; tgRefresh();
}
function tgZoomAt(f, px, py) {                       // zoom by f around the point (px, py) in drawing units
  const b = TG.baseVb; if (!b) return;
  const z = TG.zoom || (TG.zoom = { cx: b[0] + b[2] / 2, cy: b[1] + b[3] / 2, s: 1 });
  const ns = Math.max(0.2, Math.min(80, z.s * f)), q = ns / z.s;
  z.cx = px + (z.cx - px) / q; z.cy = py + (z.cy - py) / q; z.s = ns;
  if (!tgZoomRaf) tgZoomRaf = requestAnimationFrame(() => { tgZoomRaf = 0; tgRenderSection(); });
}
// header of the full screen view: wheel, TGM file, snap, symmetry, fit, close
function tgFullHead() {
  const h = $('#tgmFullHead'); if (!h) return;
  h.innerHTML = '';
  const st = TG.setup || { tgms: [] }, cur = TG.assign[TG.wheel];
  const files = st.tgms.slice();
  if (cur && !files.some(p => normPath(p) === normPath(cur))) files.push(cur);
  const fs = el('select', { class: 'sel tgm-full-file', 'aria-label': 'TGM-Datei', title: cur || '' });
  if (!files.length) fs.append(el('option', { value: '', text: 'Keine TGM gefunden' }));
  files.forEach(p => fs.append(el('option', { value: p, text: p.split(/[\\/]/).pop(), selected: cur && normPath(p) === normPath(cur) })));
  fs.addEventListener('change', () => { if (fs.value) tgmPicked(fs.value); });
  const pills = el('div', { class: 'pills tgm-full-pills' });
  if (TG.wheels.length > 1) TG.wheels.forEach(w => pills.append(el('button', { class: 'pill' + (w.wheel === TG.wheel ? ' on' : ''), text: w.wheel, title: TG_WHEEL_NAME[w.wheel] || w.wheel,
    onclick: () => { TG.wheel = w.wheel; TG.node = null; TG.sel = null; tgRenderPanel(); tgBuild(); } })));
  const snap = el('select', { class: 'sel', 'aria-label': 'Snap' });
  for (const [v, t] of [['off', 'Snap aus'], ['edge', 'Snap: Reifen-Linien + Ecken'], ['vert', 'Snap: nur Mesh-Ecken']]) snap.append(el('option', { value: v, text: t, selected: TG.opts.snap === v }));
  snap.addEventListener('change', () => { TG.opts.snap = snap.value; });
  const sym = el('input', { type: 'checkbox', checked: TG.opts.sym });
  sym.addEventListener('change', () => { TG.opts.sym = sym.checked; const p = $('#tgmSym'); if (p) p.checked = sym.checked; });
  const n = tgSelSet().size;
  h.append(el('b', { text: 'Querschnitt' }), pills, fs,
    el('span', { class: 'small muted', text: n > 1 ? n + ' Punkte gewählt' : '' }),
    el('span', { class: 'grow' }),
    snap, el('label', { class: 'toggle small' }, sym, el('span', { text: 'Symmetrisch' })),
    el('button', { class: 'btn small-btn', text: 'Einpassen', onclick: () => { TG.zoom = null; tgRenderSection(); } }),
    el('button', { class: 'icon-btn small', 'aria-label': 'Vollbild schließen', title: 'Vollbild schließen (Esc)', onclick: () => tgFullscreen(false) }, icon('x', 14)));
}
function tgFullscreen(on) {
  const sec = $('#tgmSection');
  if (on === TG.full) return;
  TG.full = on; TG.zoom = null;
  if (on) {
    const wrap = el('div', { class: 'tgm-full-wrap', id: 'tgmFull' }, el('div', { class: 'tgm-full-head', id: 'tgmFullHead' }));
    sec.before(el('div', { id: 'tgmSectionHome' }));
    wrap.append(sec);
    document.body.append(wrap);
  } else {
    const home = $('#tgmSectionHome');
    if (home) home.replaceWith(sec);
    const w = $('#tgmFull'); if (w) w.remove();
  }
  tgRenderSection();
}
(() => {
  const sec = $('#tgmSection');
  sec.addEventListener('dblclick', ev => {                 // only opens; closing is the X or Esc
    if (TG.full || !ev.target.closest('svg') || ev.target.closest('circle.nd')) return;
    tgFullscreen(true);
  });
  sec.addEventListener('wheel', ev => {
    if (!TG.full) return;
    ev.preventDefault();
    const p = tgSvgPoint(ev); if (!p) return;
    tgZoomAt(Math.exp(-ev.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });
  sec.addEventListener('pointerdown', ev => {
    if (tgDrag || tgPan || tgBand || !ev.target.closest('svg')) return;
    const p = tgSvgPoint(ev); if (!p) return;
    const f = tgFile(TG.assign[TG.wheel]);
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ev.button === 1 || ev.button === 2) {              // pan
      if (!TG.full) return;
      ev.preventDefault();
      tgPan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
      sec.classList.add('panning');
      return;
    }
    if (ev.button !== 0 || !f) return;
    ev.preventDefault();
    if (ctrl) {                                            // Ctrl + left = zoom, the selection stays as it is
      if (TG.full) tgPan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, zoom: true, px: p.x, py: p.y };
      return;
    }
    let c = ev.target.closest('circle.nd');
    if (!c) {                                              // generous grab: nearest point within 14 px
      let bd = 14;
      for (const n of document.querySelectorAll('#tgmSection circle.nd')) {
        const r = n.getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - ev.clientX, r.top + r.height / 2 - ev.clientY);
        if (d < bd) { bd = d; c = n; }
      }
    }
    if (c) {
      const idx = +c.dataset.n, cur = new Set(tgSelSet());
      if (ev.shiftKey && cur.has(idx) && cur.size > 1) {   // Shift + click on a selected point: take it out
        cur.delete(idx); TG.sel = cur; TG.node = TG.node === idx ? [...cur][cur.size - 1] : TG.node; tgRefresh(); return;
      }
      if (ev.shiftKey) { cur.add(idx); TG.sel = cur; }
      else if (!cur.has(idx)) TG.sel = null;
      else TG.sel = cur;
      TG.node = idx;
      tgStartDrag(ev, f, idx, p);
      tgRefresh();
      return;
    }
    tgBand = { id: ev.pointerId, x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: ev.shiftKey, moved: false, cx: ev.clientX, cy: ev.clientY };
  });
  sec.addEventListener('contextmenu', ev => { if (TG.full || ev.target.closest('svg')) ev.preventDefault(); });
  sec.addEventListener('auxclick', ev => { if (ev.button === 1) ev.preventDefault(); });
  window.addEventListener('pointermove', ev => {
    if (tgDrag && tgDrag.id === ev.pointerId) { tgMoveDrag(ev); return; }
    if (tgBand && tgBand.id === ev.pointerId) {
      const p = tgSvgPoint(ev); if (!p) return;
      tgBand.x1 = p.x; tgBand.y1 = p.y;
      if (Math.hypot(ev.clientX - tgBand.cx, ev.clientY - tgBand.cy) > 3) tgBand.moved = true;
      let r = $('#tgmBand');
      if (!r) { const svg = $('#tgmSection svg'); if (!svg) return; r = sv('rect', { id: 'tgmBand', class: 'band' }); svg.append(r); }
      const a = tgBandRect(); for (const k in a) r.setAttribute(k, a[k]);
      return;
    }
    if (!tgPan || tgPan.id !== ev.pointerId) return;
    const dx = ev.clientX - tgPan.x, dy = ev.clientY - tgPan.y;
    tgPan.x = ev.clientX; tgPan.y = ev.clientY;
    if (tgPan.zoom) { tgZoomAt(Math.exp(-dy * 0.008), tgPan.px, tgPan.py); return; }   // like the 3D view: Ctrl + drag up = closer
    const b = TG.baseVb; if (!b) return;
    const z = TG.zoom || (TG.zoom = { cx: b[0] + b[2] / 2, cy: b[1] + b[3] / 2, s: 1 });
    z.cx -= dx * (TG.k || 1); z.cy -= dy * (TG.k || 1);
    const svg = $('#tgmSection svg');                // pan: only move the view box, no rebuild
    if (svg) { const w = b[2] / z.s, h = b[3] / z.s; svg.setAttribute('viewBox', [z.cx - w / 2, z.cy - h / 2, w, h].join(' ')); }
  });
  const end = ev => {
    if (tgDrag && tgDrag.id === ev.pointerId) { tgDrag = null; tgPreviewEnd(); tgRefresh(); }
    if (tgBand && tgBand.id === ev.pointerId) {
      const b = tgBand, f = tgFile(TG.assign[TG.wheel]);
      tgBand = null;
      const cur = b.add ? new Set(tgSelSet()) : new Set();
      if (b.moved && f) {
        const x0 = Math.min(b.x0, b.x1) / 1000, x1 = Math.max(b.x0, b.x1) / 1000, y0 = -Math.max(b.y0, b.y1) / 1000, y1 = -Math.min(b.y0, b.y1) / 1000;
        let lastIn = null;
        for (const s of tgSection(f)) if (s.out[0] >= x0 && s.out[0] <= x1 && s.out[1] >= y0 && s.out[1] <= y1) { cur.add(s.n.index); lastIn = s.n.index; }
        TG.node = cur.has(TG.node) ? TG.node : (lastIn ?? (cur.size ? [...cur][0] : null));
      } else if (!b.add) TG.node = null;                   // click on the background: deselect
      TG.sel = cur.size ? cur : null;
      tgRefresh();
    }
    if (tgPan && tgPan.id === ev.pointerId) { tgPan = null; sec.classList.remove('panning'); tgRenderSection(); }
  };
  window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  window.addEventListener('keydown', ev => {
    if (!TG.full) return;
    if (ev.key === 'Escape') { ev.stopImmediatePropagation(); tgFullscreen(false); return; }
    if (ev.key === 'Alt') { ev.preventDefault(); return; }    // Alt = snap toggle while dragging, no window menu
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      const f = tgFile(TG.assign[TG.wheel]); if (!f) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      TG.sel = new Set(f.t.nodes.filter(n => n.geometry).map(n => n.index)); TG.node = TG.node != null && TG.sel.has(TG.node) ? TG.node : [...TG.sel][0];
      tgRefresh();
    }
  }, true);
  window.addEventListener('resize', () => { if (TG.full) tgRenderSection(); });
})();
// RingAndRim=(ring, rim): ring = share in the rigid ring (belt) of the realtime model, rim = connection to the rim
const tgZoneName = z => ({ tread: 'Ring (Gürtel)', shoulder: 'Ring-Übergang', side: 'Seitenwand', bead: 'Wulst / Felge' }[z]);

// ------------------------------------------------------------ fit table ---
function tgRenderFit() {
  const box = $('#tgmFit'); box.innerHTML = '';
  const wh = TG.wheels.find(w => w.wheel === TG.wheel), f = tgFile(TG.assign[TG.wheel]);
  if (!f) return;
  const sec = tgSection(f), tb = tgTbc(TG.wheel) || {};
  const outR = sec.map(s => s.out[1]), outX = sec.map(s => s.out[0]);
  const beads = sec.filter(s => tgZone(s.n) === 'bead');
  const rTop = Math.max(...sec.map(s => s.out[1]));
  const tread = sec.filter(s => s.out[1] >= rTop - 0.01);       // running surface: outer nodes within 10 mm of the top
  const T = {
    radius: Math.max(...outR), width: Math.max(...outX) - Math.min(...outX),
    bead: beads.length ? Math.min(...beads.map(s => s.out[1])) : Math.min(...outR),
    tread: tread.length ? Math.max(...tread.map(s => s.out[0])) - Math.min(...tread.map(s => s.out[0])) : null,
  };
  const ts = wh && wh.tire && (wh.tire.section ? wh.tire.section.pts : null);
  const gTop = ts ? ts.filter(p => p[1] >= Math.max(...ts.map(q => q[1])) - 0.01) : null;
  const G = ts ? { radius: Math.max(...ts.map(p => p[1])), width: Math.max(...ts.map(p => p[0])) - Math.min(...ts.map(p => p[0])), bead: Math.min(...ts.map(p => p[1])),
    tread: Math.max(...gTop.map(p => p[0])) - Math.min(...gTop.map(p => p[0])) }
    : wh && wh.tire ? { radius: wh.tire.radius, width: wh.tire.width, bead: null } : {};
  const rimMax = wh && wh.rim && wh.rim.section ? Math.max(...wh.rim.section.pts.map(p => p[1])) : null;
  const d = sec.map(s => tgDist(wh, s.out)).filter(v => v != null);
  const dT = tread.map(s => tgDist(wh, s.out)).filter(v => v != null);
  const diff = (a, b) => (a == null || b == null ? '' : ((a - b) * 1000 >= 0 ? '+' : '') + ((a - b) * 1000).toFixed(1));
  const rows = [
    ['Außenradius', T.radius, G.radius, tb.radius],
    ['Breite', T.width, G.width, tb.width],
    ['Lauffläche (oben 10 mm)', T.tread, G.tread, null],
    ['Wulst-Radius', T.bead, G.bead, tb.rim, rimMax],
  ];
  const tbl = el('table', { class: 'tgm-tbl' }, el('thead', {}, el('tr', {}, el('th', { text: 'mm' }), el('th', { text: 'TGM' }), el('th', { text: 'GMT' }), el('th', { text: 'TBC' }), el('th', { text: 'TGM−GMT' }))));
  const tbody = el('tbody');
  for (const [name, a, b, c, rimv] of rows) {
    const dd = diff(a, b), bad = b != null && a != null && Math.abs(a - b) > 0.005;
    tbody.append(el('tr', {}, el('td', { text: name }), el('td', { text: tgMm(a) }),
      el('td', { text: tgMm(b), title: rimv != null ? 'Felgen-GMT außen: ' + tgMm(rimv) + ' mm' : '' }),
      el('td', { text: tgMm(c), title: name === 'Wulst-Radius' ? 'TBC Rim= (1. Wert)' : '' }), el('td', { class: bad ? 'bad' : dd ? 'ok' : '', text: dd })));
  }
  tbl.append(tbody); box.append(tbl);
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const sm = tgSM(f);
  box.append(el('div', { class: 'small muted tgm-fitline' },
    d.length ? `Abstand TGM-Außenkontur → Reifen-GMT: Ø ${tgMm(mean(d))} mm, max ${tgMm(Math.max(...d))} mm` + (dT.length ? ` · Lauffläche Ø ${tgMm(mean(dT))} mm` : '') : 'Kein Reifen-GMT zum Vergleich gefunden.',
    el('br'), `SizeMultiplier (${tgFmt(sm[0])}, ${tgFmt(sm[1])}) ist eingerechnet` + (wh && wh.tire ? ` · GMT: ${wh.tire.name}` + (wh.rim ? ', ' + wh.rim.name : '') : '')));
}

// ----------------------------------------------------- node + edit pages ---
function tgRenderNodeInfo() {
  const box = $('#tgmNode'); box.innerHTML = '';
  const f = tgFile(TG.assign[TG.wheel]);
  const nd = f && TG.node != null ? f.t.nodes[TG.node] : null;
  if (!nd) { box.append(el('div', { class: 'small muted', text: 'Punkt im Querschnitt oder in der Liste anklicken. Ziehen verschiebt ihn (Geometry).' })); return; }
  const head = el('div', { class: 'row between' }, el('b', { text: 'Node ' + nd.label + ' · ' + tgZoneName(tgZone(nd)) }),
    el('span', { class: 'small muted mono', text: 'Zeile ' + nd.line + ' · ' + nd.plies + ' Lagen · Lagen-Dicke ' + tgMm(nd.plyThickness) + ' mm' }));
  box.append(head);
  const grid = el('div', { class: 'tgm-kv' });
  nd.keys.forEach(it => {
    const inp = el('input', { class: 'num', value: it.value, spellcheck: 'false', 'aria-label': it.key });
    if (it.orig !== undefined && it.orig !== it.value) inp.classList.add('chg');
    inp.addEventListener('change', () => {
      tgSetValue(f, it, inp.value.trim());
      const n = tgNums(inp.value), kl = it.key.toLowerCase();
      if (kl === 'geometry' && n.length >= 2) nd.geometry = (n.concat([0])).slice(0, 3);
      if (kl === 'innergeometryoverride' && n.length >= 2) nd.inner = n.slice(0, 2);
      if (kl === 'ringandrim' && n.length) nd.ringAndRim = (n.concat([0])).slice(0, 2);
      if (kl === 'treaddepth' && n.length) nd.treadDepth = n[0];
      tgRefresh();
    });
    grid.append(el('span', { class: 'k', text: it.key, title: 'Zeile ' + it.line }), inp);
  });
  box.append(grid);
}
function tgRenderEdit() {
  const box = $('#tgmEdit'); box.innerHTML = '';
  const f = tgFile(TG.assign[TG.wheel]);
  if (!f) return;
  // SizeMultiplier
  const smIt = f.t.realtime.find(x => x.key.toLowerCase() === 'sizemultiplier');
  const smSec = el('section', { class: 'sec' }, el('div', { class: 'sec-h' }, el('span', { text: 'SizeMultiplier (Realtime)' }), el('span', { class: 'mono', text: f.t.name })));
  const sm = tgSM(f);
  ['seitlich', 'radial'].forEach((lbl, i) => {
    const out = el('input', { class: 'num', type: 'number', step: 0.001, value: sm[i], 'aria-label': 'SizeMultiplier ' + lbl });
    const rng = el('input', { type: 'range', min: 0.8, max: 1.4, step: 0.0005, value: sm[i], 'aria-label': 'SizeMultiplier ' + lbl });
    const apply = v => {
      const cur = tgSM(f); cur[i] = v;
      if (smIt) tgSetValue(f, smIt, '(' + cur.map(tgFmt).join(', ') + ')');
      else toast('Keine SizeMultiplier-Zeile in der TGM', 'warn');
      tgRefresh();
    };
    rng.addEventListener('input', () => { out.value = +(+rng.value).toFixed(4); apply(+rng.value); });
    rng.addEventListener('pointerdown', tgPreviewStart);
    rng.addEventListener('change', tgPreviewEnd);
    out.addEventListener('change', () => { if (isFinite(+out.value)) { rng.value = out.value; apply(+out.value); } });
    smSec.append(el('div', { class: 'axis' }, el('span', { class: 'an', text: lbl }), rng, out));
  });
  smSec.append(el('div', { class: 'axis tgm-prevmesh' }, el('span', { class: 'an', text: 'Reifen-Mesh' }), tgMeshSelect()));
  smSec.append(el('div', { class: 'small muted', text: 'Wird im Spiel zur Laufzeit angewendet – die Knoten in der Datei bleiben gleich.' }));
  box.append(smSec);
  // node table
  const det = el('details', { class: 'sec tgm-det', open: true }, el('summary', { class: 'sec-h', text: 'Knoten (' + f.t.nodes.length + ') – Geometry in m, ohne SizeMultiplier' }));
  const symL = el('label', { class: 'toggle small' }, el('input', { type: 'checkbox', id: 'tgmSym' }), el('span', { text: 'Symmetrisch bearbeiten (Node i ↔ N−1−i)' }));
  symL.querySelector('input').checked = TG.opts.sym;
  symL.querySelector('input').addEventListener('change', ev => { TG.opts.sym = ev.target.checked; });
  det.append(symL);
  const tbl = el('div', { class: 'tgm-nodes', id: 'tgmNodes' });
  tbl.append(el('span', { class: 'h', text: '#' }), el('span', { class: 'h', text: 'x' }), el('span', { class: 'h', text: 'y' }), el('span', { class: 'h', text: 'Dicke' }), el('span', { class: 'h', text: 'Δ mm' }));
  const wh = TG.wheels.find(w => w.wheel === TG.wheel);
  const sec = tgSection(f), dist = new Map(sec.map(s => [s.n.index, tgDist(wh, s.out)]));
  f.t.nodes.forEach(nd => {
    if (!nd.geometry) return;
    const z = tgZone(nd);
    const b = el('button', { class: 'nb' + (tgSelSet().has(nd.index) ? ' on' : ''), text: nd.label, title: tgZoneName(z), style: 'border-left:3px solid ' + tgCss(TG_ZONE[z]),
      onclick: () => { TG.sel = null; TG.node = TG.node === nd.index ? null : nd.index; tgRefresh(); } });
    b.dataset.i = nd.index;
    const ins = [0, 1, 2].map(j => {
      const inp = el('input', { class: 'num', type: 'number', step: j === 2 ? 0.0001 : 0.0005, value: nd.geometry[j], 'aria-label': 'Node ' + nd.label + ' ' + ['x', 'y', 'Dicke'][j] });
      inp.dataset.i = nd.index; inp.dataset.j = j;
      inp.addEventListener('change', () => {
        const v = +inp.value; if (!isFinite(v)) return;
        const g = nd.geometry.slice(); g[j] = v; tgSetGeometry(f, nd, g);
        if (TG.opts.sym) { const mi = f.t.nodes.length - 1 - nd.index, m = f.t.nodes[mi];
          if (mi !== nd.index && m.geometry) { const gm = m.geometry.slice(); gm[j] = j === 0 ? -v : v; tgSetGeometry(f, m, gm); } }
        TG.node = nd.index; tgRefresh();
      });
      return inp;
    });
    const dv = dist.get(nd.index);
    tbl.append(b, ...ins, el('span', { class: 'dv mono' + (dv != null && dv > 0.005 ? ' bad' : ''), text: dv == null ? '–' : (dv * 1000).toFixed(1) }));
  });
  det.append(tbl);
  box.append(det);
  // realtime + quasi static values
  const kvSec = (title, items, editable, note) => {
    const d = el('details', { class: 'sec tgm-det' }, el('summary', { class: 'sec-h', text: title + ' (' + items.length + ')' }));
    if (note) d.append(el('div', { class: 'small muted', text: note }));
    const g = el('div', { class: 'tgm-kv' });
    items.forEach(it => {
      const inp = el('input', { class: 'num', value: it.value, spellcheck: 'false', 'aria-label': it.key, readonly: !editable });
      if (it.orig !== undefined && it.orig !== it.value) inp.classList.add('chg');
      if (editable) inp.addEventListener('change', () => { tgSetValue(f, it, inp.value.trim()); inp.classList.toggle('chg', it.orig !== it.value); tgRefresh(); if (it === smIt) tgRenderEdit(); });
      g.append(el('span', { class: 'k', text: it.key, title: 'Zeile ' + it.line + (it.comment ? ' · ' + it.comment : '') }), inp);
    });
    d.append(g); return d;
  };
  box.append(kvSec('[Realtime]', f.t.realtime, true, 'Werte für das laufende Spiel (Reibung, Abrieb, Temperatur, Steifigkeit …).'));
  box.append(kvSec('[QuasiStaticAnalysis]', f.t.qsa, false, 'Ergebnis/Vorgaben der TTool-Analyse – hier nur zur Ansicht.'));
  const big = f.t.sections.filter(s => /^(lookupv2|patchv1)$/i.test(s.name));
  if (big.length) box.append(el('div', { class: 'small muted', text: big.map(s => '[' + s.name + '] ' + s.size + ' Zeilen').join(' · ') + ' – kodierte TTool-Tabellen, werden nicht verändert.' }));
}
// keep the table inputs in sync while dragging (without rebuilding the list)
function tgSyncTable() {
  const f = tgFile(TG.assign[TG.wheel]);
  const t = $('#tgmNodes'); if (!t || !f) return;
  const wh = TG.wheels.find(w => w.wheel === TG.wheel);
  const dist = new Map(tgSection(f).map(s => [s.n.index, tgDist(wh, s.out)]));
  t.querySelectorAll('input[data-i]').forEach(inp => {
    if (document.activeElement === inp) return;
    const g = f.t.nodes[+inp.dataset.i].geometry; if (g && +inp.value !== g[+inp.dataset.j]) inp.value = g[+inp.dataset.j];
  });
  const ss = tgSelSet(); t.querySelectorAll('button.nb').forEach(b => b.classList.toggle('on', ss.has(+b.dataset.i)));
  t.querySelectorAll('.dv').forEach((d, k) => {
    const b = d.parentElement.querySelectorAll('button.nb')[k]; if (!b) return;
    const v = dist.get(+b.dataset.i); d.textContent = v == null ? '–' : (v * 1000).toFixed(1); d.classList.toggle('bad', v != null && v > 0.005);
  });
}
function tgFooter() {
  const dirty = tgDirtyFiles();
  $('#btnTgmSave').disabled = !dirty.length;
  $('#tgmDot').className = 'dot ' + (dirty.length ? 'warn' : 'ok');
  const geo = dirty.some(tgGeoEdited);
  $('#tgmText').textContent = dirty.length ? 'Geändert: ' + dirty.map(f => f.t.name).join(', ') : 'Live – TGM wird überwacht';
  $('#tgmWarn').classList.toggle('hidden', !geo);
}

async function tgSave() {
  const dirty = tgDirtyFiles();
  if (!dirty.length) return;
  try {
    for (const f of dirty) {
      const d = await api.post('/api/tgm/save', { path: f.path, edits: [...f.edits.values()] });
      f.t = d.tgm; f.edits.clear();
      toast('Gespeichert: ' + f.t.name);
    }
  } catch (err) { toast(err.message, 'err'); }
  tgRenderPanel(); tgBuild();
}
function tgmOnEvent(m) {
  const f = tgFile(m.path);
  if (!f) return;
  const apply = () => { f.t = m.tgm; f.edits.clear(); if (TG.open) { tgRenderPanel(); tgBuild(); } };
  if (f.edits.size) toast('TGM wurde außerhalb geändert.', 'warn', [['Neu laden', apply]], 0);
  else { apply(); toast('TGM neu geladen: ' + m.tgm.name); }
}
function tgmOnProject(p) {
  if (TG.open) openTgmPanel(false);
  TG.loaded = false; TG.setup = null; TG.wheels = []; TG.files.clear(); TG.assign = {}; TG.compound = null; TG.node = null;
  $('#tbTgm').classList.toggle('hidden', !p);
  if (R.setTgm) R.setTgm(null, null, { visible: false });
}
// reload: setup (new / renamed files, changed GMT) and every TGM from disk; the current choice stays
async function tgReload(force) {
  const dirty = tgDirtyFiles();
  if (dirty.length && !force) {
    toast('Ungespeicherte Änderungen verwerfen? ' + dirty.map(f => f.t.name).join(', '), 'warn', [['Verwerfen und neu laden', () => tgReload(true)]], 0);
    return;
  }
  const prev = { assign: { ...TG.assign }, wheel: TG.wheel, compound: TG.compound, node: TG.node };
  TG.loaded = false; TG.files.clear(); TG.assign = {};
  try {
    loading(true, 'Lade Reifenphysik …');
    await tgEnsureSetup();
    for (const w in prev.assign) {
      if (!prev.assign[w]) continue;
      try { await tgLoadFile(prev.assign[w]); TG.assign[w] = prev.assign[w]; } catch (err) { /* file gone: compound default stays */ }
    }
    if (prev.compound == null || prev.compound < TG.setup.compounds.length) TG.compound = prev.compound;
    if (TG.wheels.some(w => w.wheel === prev.wheel)) TG.wheel = prev.wheel;
    const f = tgFile(TG.assign[TG.wheel]);
    TG.node = f && prev.node != null && prev.node < f.t.nodes.length ? prev.node : null;
    toast('TGM neu eingelesen');
  } catch (err) { toast(err.message, 'err'); }
  finally { loading(false); }
  tgRenderPanel(); tgBuild();
}
async function tgmPicked(path) {
  try {
    await tgLoadFile(path, true);
    const axle = TG.wheel && TG.wheel[0] === 'R' ? ['RL', 'RR'] : ['FL', 'FR'];
    for (const w of (TG.wheels.length > 1 ? axle : TG.wheels.map(x => x.wheel))) TG.assign[w] = path;
    TG.compound = null; TG.node = null;
    if (TG.setup && !TG.setup.tgms.some(p => normPath(p) === normPath(path))) TG.setup.tgms.push(path);
    tgRenderPanel(); tgBuild();
  } catch (err) { toast(err.message, 'err'); }
}

// ------------------------------------------------------------------ events ---
$('#tbTgm').addEventListener('click', () => openTgmPanel(!TG.open));
$('#btnTgmClose').addEventListener('click', () => openTgmPanel(false));
$('#btnTgmCollapse').addEventListener('click', () => { TG.collapsed = !TG.collapsed; $('#tgmPanel').classList.toggle('collapsed', TG.collapsed); });
$('#btnTgmSave').addEventListener('click', tgSave);
$('#btnTgmReload').addEventListener('click', () => tgReload(false));
$('#btnTgmBrowse').addEventListener('click', () => browse('tgm', TG.assign[TG.wheel] ? TG.assign[TG.wheel].replace(/[\\/][^\\/]*$/, '') : (S.project ? S.project.path : '')));
$('#btnTgmFocus').addEventListener('click', () => { const w = TG.wheels.find(x => x.wheel === TG.wheel); if (w && w.tire) R.focus([w.tire.id]); });
$('#tgmCompound').addEventListener('change', async ev => {
  const i = +ev.target.value;
  if (i < 0) { TG.compound = null; return; }
  tgApplyCompound(i, i); TG.node = null;
  await Promise.all([...new Set(Object.values(TG.assign))].map(p => tgLoadFile(p).catch(err => toast(err.message, 'err'))));
  tgRenderPanel(); tgBuild();
});
$('#tgmFile').addEventListener('change', ev => { if (ev.target.value) tgmPicked(ev.target.value); });
document.querySelectorAll('#tgmColor button').forEach(b => b.addEventListener('click', () => { TG.opts.color = b.dataset.c; tgRenderPanel(); tgBuild(); }));
$('#tgmPreview').addEventListener('change', ev => { TG.opts.preview = ev.target.checked; });
for (const [id, key] of [['#tgmInner', 'inner'], ['#tgmRefs', 'refs'], ['#tgmFlip', 'flip']]) {
  $(id).addEventListener('change', ev => { TG.opts[key] = ev.target.checked; tgRenderPanel(); tgBuild(); });
}
$('#tgmSpokes').addEventListener('input', ev => { TG.opts.spokes = +ev.target.value; $('#oTgmSpokes').textContent = TG.opts.spokes; tgBuild(); });
window.addEventListener('keydown', ev => {
  if (!TG.open) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && tgDirtyFiles().length) { ev.preventDefault(); ev.stopImmediatePropagation(); tgSave(); }
}, true);
window.addEventListener('resize', () => { if (TG.open) tgRenderSection(); });

if (typeof I18N !== 'undefined' && I18N.extend) I18N.extend({
  'TGM': 'TGM', 'Reifenphysik (TGM)': 'Tyre physics (TGM)', 'Reifenphysik (TGM) als farbiges Drahtgitter an den Rädern': 'Tyre physics (TGM) as a coloured wire frame at the wheels',
  'Mischung (TBC)': 'Compound (TBC)', 'Eigene Auswahl': 'Custom', 'TGM Vorderachse': 'TGM front axle', 'TGM Hinterachse': 'TGM rear axle',
  'Farbe': 'Colour', 'Zone': 'Zone', 'Dicke': 'Thickness', 'Profil': 'Tread', 'Lagen': 'Plies', 'Abweichung': 'Deviation',
  'Innenseite': 'Inner surface', 'Durch Reifen sehen': 'See through tyre', 'TBC-Referenzen': 'TBC references', '+x zeigt nach innen': '+x points inboard',
  'Speichen': 'Spokes', 'Lauffläche (oben 10 mm)': 'Tread (top 10 mm)', 'Ring (Gürtel)': 'Ring (belt)', 'Ring-Übergang': 'Ring transition', 'Seitenwand': 'Sidewall', 'Wulst / Felge': 'Bead / rim',
  'Reifen-GMT': 'Tyre GMT', 'Felgen-GMT': 'Rim GMT', 'Außenradius': 'Outer radius', 'Breite': 'Width', 'Wulst-Radius': 'Bead radius',
  'seitlich': 'lateral', 'radial': 'radial', 'Reifen': 'Tyre', 'Keine TGM gefunden': 'No TGM found',
  'Wird im Spiel zur Laufzeit angewendet – die Knoten in der Datei bleiben gleich.': 'Applied by the game at runtime – the nodes in the file stay the same.',
  'Symmetrisch bearbeiten (Node i ↔ N−1−i)': 'Edit symmetrically (node i ↔ N−1−i)',
  'Werte für das laufende Spiel (Reibung, Abrieb, Temperatur, Steifigkeit …).': 'Values for the running game (friction, wear, temperature, stiffness …).',
  'Ergebnis/Vorgaben der TTool-Analyse – hier nur zur Ansicht.': 'Results / inputs of the TTool analysis – view only.',
  'Punkt im Querschnitt oder in der Liste anklicken. Ziehen verschiebt ihn (Geometry).': 'Click a point in the section or in the list. Dragging moves it (Geometry).',
  'Live – TGM wird überwacht': 'Live – TGM is watched', 'TGM wurde außerhalb geändert.': 'TGM was changed outside.',
  'Keine TGM für dieses Rad. Datei unten wählen.': 'No TGM for this wheel. Choose a file below.',
  'Kein Reifen-GMT zum Vergleich gefunden.': 'No tyre GMT found for the comparison.',
  'Lade Reifenphysik …': 'Loading tyre physics …', 'TGM-Datei wählen': 'Choose TGM file', 'Fokus auf das Rad': 'Focus on the wheel',
  'Datei …': 'File …', 'Querschnitt TGM gegen GMT': 'Cross section TGM vs GMT', 'Einpassen': 'Fit', 'Vollbild schließen': 'Close full screen',
  'Querschnitt': 'Cross section', 'Reifen-Mesh': 'Tyre mesh', 'Sichtbar, TGM scheint durch': 'Visible, TGM shows through', 'Sichtbar, deckend': 'Visible, opaque', 'Unsichtbar (nur TGM)': 'Hidden (TGM only)', 'TGM-Datei': 'TGM file', 'Snap aus': 'Snap off', 'Snap: nur Mesh-Ecken': 'Snap: mesh corners only', 'Snap: Reifen-Linien + Ecken': 'Snap: tyre lines + corners',
  'Symmetrisch': 'Symmetric', 'Vollbild schließen (Esc)': 'Close full screen (Esc)', 'Doppelklick = Vollbild': 'Double click = full screen',
  'Linke Maustaste: Punkt wählen, Rahmen ziehen = mehrere wählen (Shift = hinzufügen / abwählen), Punkte ziehen = verschieben · Alt beim Ziehen = Snap kurz umschalten · Mausrad oder Strg + linke Maustaste = zoomen · rechte oder mittlere Maustaste = Ansicht verschieben':
    'Left mouse: pick a point, drag a frame = select several (Shift = add / remove), drag points = move · Alt while dragging = toggle snap · wheel or Ctrl + left drag = zoom · right or middle mouse = pan the view',
  'Mausrad oder Strg + linke Maustaste ziehen = zoomen · ziehen = verschieben · Doppelklick auf den Hintergrund oder Esc = zurück': 'Mouse wheel or Ctrl + left drag = zoom · drag = pan · double click on the background or Esc = back', 'Panel ein-/ausklappen': 'Expand / collapse panel',
  'TGM-Panel schließen': 'Close TGM panel', 'Verdeckte Linien schwach zeigen': 'Show hidden lines faintly', 'TBC Radius (weiß) und Rim (grau)': 'TBC Radius (white) and Rim (grey)',
  'Seite der TGM spiegeln, falls +x im Spiel zur Fahrzeugmitte zeigt': 'Mirror the TGM side in case +x points to the car centre in the game',
  'Ring (Gürtel) / Übergang / Seitenwand / Wulst (RingAndRim)': 'Ring (belt) / transition / sidewall / bead (RingAndRim)', 'Geometry: Dicke': 'Geometry: thickness',
  'Anzahl PlyParams': 'Number of PlyParams', 'Abstand zur Außenkontur des Reifen-GMT': 'Distance to the outer contour of the tyre GMT',
  'TGM anklicken – sie wird für die Achse des gewählten Rads gezeigt.': 'Click a TGM – it is shown for the axle of the selected wheel.',
  'Dicke: klein → groß': 'Thickness: small → large', 'Profiltiefe: klein → groß': 'Tread depth: small → large', 'Lagen: wenige → viele': 'Plies: few → many',
  'Profiltiefe': 'Tread depth', 'Verwerfen und neu laden': 'Discard and reload', 'TGM neu eingelesen': 'TGM reloaded',
  'TGM-Dateien neu einlesen (Änderungen verwerfen)': 'Reload TGM files (discards changes)',
  'Beim Ziehen nur dieses Rad': 'Only this wheel while dragging',
  'Beim Ziehen eines Reglers oder Punkts: nur Reifen + Felge dieses Rads (Linien im Mesh verschwinden) – beim Loslassen sind alle Teile wieder da':
    'While dragging a slider or point: only tyre + rim of this wheel (lines inside the mesh disappear) – released, all parts are back',
  'Keine SizeMultiplier-Zeile in der TGM': 'No SizeMultiplier line in the TGM', 'TBC Rim= (1. Wert)': 'TBC Rim= (1st value)',
  'außen (TGM +x) →': 'outboard (TGM +x) →', '← außen (TGM −x)': '← outboard (TGM −x)', '< 1,5 mm': '< 1.5 mm',
  'Vorne links': 'Front left', 'Vorne rechts': 'Front right', 'Hinten links': 'Rear left', 'Hinten rechts': 'Rear right',
  'Geometry geändert: Die [QuasiStaticAnalysis]- und [LookupV2]-Tabellen passen danach nicht mehr – die TGM muss im TTool neu berechnet werden.':
    'Geometry changed: the [QuasiStaticAnalysis] and [LookupV2] tables no longer match – the TGM has to be recalculated in the TTool.',
}, [
  [/^Node (\S+) · (.*)$/, (m, a, b) => 'Node ' + a + ' · ' + I18N.tr(b)],
  [/^Knoten \((\d+)\) – Geometry in m, ohne SizeMultiplier$/, 'Nodes ($1) – Geometry in m, without SizeMultiplier'],
  [/^Abstand TGM-Außenkontur → Reifen-GMT: Ø (.*?) mm, max (.*?) mm(.*)$/, (m, a, b, c) => `Distance TGM outer contour → tyre GMT: avg ${a} mm, max ${b} mm` + c.replace('Lauffläche Ø', 'tread avg')],
  [/^SizeMultiplier \((.*)\) ist eingerechnet(.*)$/, 'SizeMultiplier ($1) is applied$2'],
  [/^Zeile (\d+) · (\d+) Lagen · Lagen-Dicke (.*) mm$/, 'Line $1 · $2 plies · ply thickness $3 mm'],
  [/^Geändert: (.*)$/, 'Changed: $1'], [/^TGM neu geladen: (.*)$/, 'TGM reloaded: $1'],
  [/^(.*) Zeilen – kodierte TTool-Tabellen, werden nicht verändert\.$/, '$1 lines – encoded TTool tables, never changed.'],
  [/^Abstand: (.*)$/, 'Distance: $1'], [/^Querschnitt (.*)$/, 'Cross section $1'], [/^(\d+) Punkte gewählt$/, '$1 points selected'],
  [/^Zeile (\d+)( · .*)?$/, 'Line $1$2'],
  [/^Felgen-GMT außen: (.*) mm$/, 'Rim GMT outer: $1 mm'],
  [/^SizeMultiplier (seitlich|radial)$/, (m, a) => 'SizeMultiplier ' + (a === 'seitlich' ? 'lateral' : 'radial')],
  [/^Node (\S+) (x|y|Dicke)$/, (m, a, b) => 'Node ' + a + ' ' + (b === 'Dicke' ? 'thickness' : b)],
  [/^Ungespeicherte Änderungen verwerfen\? (.*)$/, 'Discard unsaved changes? $1'],
  [/^(.*) · Mehrere HDV im Mod - genommen: (.*)$/, '$1 · Several HDV in the mod - using: $2'],
  [/^(.*) · TireBrand="(.*)" aus der HDV nicht gefunden\.(.*)$/, '$1 · TireBrand="$2" from the HDV not found.$3'],
  [/^TGM nicht gefunden: (.*)$/, 'TGM not found: $1'], [/^TGM nicht gefunden$/, 'TGM not found'],
  [/^TGM nicht lesbar \((.*)\): (.*)$/, 'TGM not readable ($1): $2'],
  [/^Zeile (\d+) ist nicht mehr (.*)= \(Datei wurde geändert\?\)$/, 'Line $1 is no longer $2= (file changed?)'],
  [/^Zeile (\S+) gibt es nicht$/, 'Line $1 does not exist'], [/^Zeilenumbruch im Wert \(Zeile (\d+)\)$/, 'Line break in the value (line $1)'],
  [/^kein Projekt offen$/, 'no project open'],
]);
