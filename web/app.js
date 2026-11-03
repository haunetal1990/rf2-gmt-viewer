// UI: sources (folder / VEH / GEN / GMT), part list, material editor with live
// JSON round trip, toolbar, file browser.
'use strict';
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(c));
  return e;
};
const ICONS = {
  folder: '<path d="M3 7h6l2 2h10v10H3z"/>',
  car: '<circle cx="7" cy="17" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M3 17v-4l3-5h10l4 5v4M9.5 17h5"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  chev: '<path d="M6 9l6 6 6-6"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>', up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  focus: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1"/>',
  cursor: '<path d="M5 3l14 8-6 2-2 6z"/>', play: '<path d="M7 5l12 7-12 7z"/>', file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  check: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  drive: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="17" cy="12" r="1"/>',
};
const icon = (n, s = 15) => {
  const sp = document.createElement('span');
  sp.innerHTML = `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  sp.style.display = 'inline-flex';
  return sp;
};
document.querySelectorAll('[data-icon]').forEach(n => n.replaceWith(icon(n.dataset.icon, n.closest('.big-btn') ? 20 : 15)));

const api = {
  async get(u) { const r = await fetch(u); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; },
  async post(u, body) {
    const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  },
};

function toast(text, kind = 'ok', actions = [], ms = 4500) {
  const box = el('div', { class: 'toast' }, el('span', { class: 'dot ' + kind }),
    el('div', { class: 'grow' }, el('div', { text }), actions.length ? el('div', { class: 't-actions' },
      actions.map(([label, fn]) => el('button', { class: 'btn', text: label, onclick: () => { fn(); box.remove(); } }))) : null));
  $('#toasts').append(box);
  if (ms) setTimeout(() => box.remove(), ms);
  return box;
}
const loading = (on, text) => { $('#loading').classList.toggle('hidden', !on); if (text) $('#loadingText').textContent = text; };

// ------------------------------------------------------------------ state ---
let R;
try { R = new Renderer($('#gl')); R.timeFn = () => animTime(); }
catch (err) { document.body.innerHTML = '<p style="padding:24px">' + err.message + '</p>'; throw err; }

const S = {
  project: null, parts: new Map(), mats: new Map(), sel: null, selMat: null, tab: 'params',
  view: { blendConst: 0, night: false, livery: true, backfireSpeed: 30 }, isolated: null, autoSave: false,
};
const normPath = p => (p || '').replace(/\//g, '\\').toLowerCase();
const stem = n => (n || '').split(/[\\/]/).pop().split(' ')[0].replace(/\.[^.]*$/, '');
const fmtN = n => n.toLocaleString('de-DE');

// -------------------------------------------------------------- projects ---
async function openPath(path) {
  if (!path) return;
  loading(true, 'Öffne ' + path.split(/[\\/]/).pop() + ' …');
  try {
    const { project } = await api.post('/api/open', { path });
    await showProject(project);
  } catch (err) {
    toast(err.message, 'err', [], 8000);
  } finally { loading(false); }
}

async function showProject(p, keepView = false) {
  S.project = p; S.parts.clear(); S.mats.clear(); S.sel = null; S.selMat = null; S.isolated = null;
  if (typeof histReset === 'function') histReset();
  if (typeof genReset === 'function') genReset(); else S.gen = { deleted: new Set(), props: {}, inst: {} };
  R.clear();
  $('#start').classList.add('hidden');
  ['#srcPanel', '#matPanel', '#toolbar', '#stats'].forEach(s => $(s).classList.remove('hidden'));
  $('#srcTitle').textContent = p.title; $('#srcTitle').title = p.path;
  $('#srcSub').textContent = p.subtitle;
  for (const part of p.parts) S.parts.set(part.id, { ...part, visible: part.light ? !!R.lightsOn[part.light] : part.visible, loaded: false, loading: false });
  R.carLights = p.carLights || [];
  $('#carLightBox').classList.toggle('hidden', !(R.carLights.length || p.parts.some(x => x.light)));
  if (!keepView) camOnProject(p);
  initShowrooms();
  renderLivery(); renderPartList(); renderUpgrades(); renderWarnings(); renderVehList(); renderMat();
  history.replaceState(null, '', '?open=' + encodeURIComponent(p.path));
  const ids = p.parts.filter(x => x.visible && !x.missing).map(x => x.id);
  await loadParts(ids, true);
  if (p.cockpit && !CAMS.cockpit) loadCockpit(p.cockpit);
  if (typeof mirrorSync === 'function') mirrorSync();
  if (!keepView) R.focus(null, false);
  updateStats();
  if (p.parts.length === 1 && !p.parts[0].missing) select(p.parts[0].id);
}

async function loadParts(ids, progress) {
  let done = 0;
  const queue = ids.slice();
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      await loadPart(id);
      done++;
      if (progress) loading(true, `Lade Teile ${done} / ${ids.length}`);
    }
  };
  if (progress && ids.length) loading(true, `Lade Teile 0 / ${ids.length}`);
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (progress) loading(false);
  R._updateScene();
  renderPartList();
}

async function loadPart(id) {
  const ps = S.parts.get(id);
  if (!ps || ps.missing || ps.loading) return;
  ps.loading = true;
  try {
    const r = await fetch('/api/mesh/' + id);
    if (!r.ok) throw new Error((await r.json()).error);
    const buf = await r.arrayBuffer();
    if (S.parts.get(id) !== ps) return;                  // removed meanwhile (upgrade change / other project)
    const part = R.addPart(buf);
    // GEN "ShadowCaster=(True, Solid)": only meshes flagged in the GEN cast shadows (GEN projects)
    part.noCast = !!(S.project && S.project.genShadowFlags && !(ps.shadow && ps.shadow.on));
    ps.loaded = true; ps.error = null; ps.meta = part.meta;
    part.visible = ps.visible;
    part.groups.forEach(g => { g.mat = materialFor(part.meta.materials[g.material] || part.meta.materials[0], id); });
    if (typeof mirrorApplyPart === 'function') mirrorApplyPart(id);
  } catch (err) {
    ps.error = err.message;
  } finally { ps.loading = false; }
}

// ------------------------------------------------------------- materials ---
function materialFor(m, partId) {
  if (!m) return null;
  const key = m.json_path ? 'j:' + normPath(m.json_path) : 'g:' + m.name.toLowerCase() + '|' + (m.shader || '').toLowerCase();
  let ms = S.mats.get(key);
  if (!ms) {
    ms = { key, name: m.name, gmtShader: m.shader, stages: m.stages, json: m.json || null, path: m.json_path || null,
      jsonSource: m.json_source || null, jsonFrom: m.json_from || null,
      saved: m.json ? JSON.stringify(m.json) : null, users: new Set(), nextTo: null, dirty: false, livery: null,
      srcBlend: m.srcBlend || null, dstBlend: m.dstBlend || null, gmtFlags: m.flags || [], gmtStd: m.std || null };
    S.mats.set(key, ms);
    if (typeof dashAttach === 'function' && DASH.displays.length) dashAttach(ms);
    refreshMaterial(ms);
  }
  ms.users.add(partId);
  if (!ms.nextTo) ms.nextTo = (S.parts.get(partId) || {}).file;
  return ms;
}

// VEH skins: DefaultLivery -> WCCARBODY, ExtraN -> WCEXTRAN, Helmet -> WCHELMET ... (albedo of that material)
function liverySkin(ms) {
  const lv = S.project && S.project.livery;
  if (!lv || !lv.map) return null;
  const n = (ms.name || '').toUpperCase();
  if (lv.map[n]) return lv.map[n];
  const k = Object.keys(lv.map).find(key => n.startsWith(key) && !/[A-Z0-9]/.test(n[key.length] || ''));
  return k ? lv.map[k] : null;
}
function liveryApplies(ms, r) {
  const lv = S.project && S.project.livery;
  if (!lv || !S.view.livery) return false;
  if (ms.livery === false) return false;
  if (liverySkin(ms)) return true;
  if (!lv.albedo) return false;
  if (ms.livery !== null) return ms.livery;
  const a = r.slots.find(s => s.role === 'albedoMap' && !s.off);
  return !!(a && /skin|livery/i.test(a.tex));
}
function refreshMaterial(ms) {
  const r = RF2.resolve({ name: ms.name, shader: ms.gmtShader, stages: ms.stages, json: ms.json, gmtStd: ms.gmtStd });
  ms.resolved = r;
  const units = new Array(12).fill(null);
  const heat = /^L2BUMPT\d*PROJ/i.test(r.shader || ms.gmtShader || '');   // rF2 "Heat Effect" (projected frame buffer)
  for (const s of r.slots) {
    if (s.off || !s.role) continue;
    if (/^FRAMEBUFFER(\.|$)/i.test(s.tex)) continue;                       // the screen itself, not a file
    const unit = RF2.UNIT[s.role];
    if (unit === undefined || units[unit]) continue;
    if (/^_deftex/i.test(s.tex)) continue;
    let entry, frames = null;
    if (unit === 0 && ms.dashEntry) entry = ms.dashEntry;                 // cockpit display (text on background)
    else if (unit === 0 && liveryApplies(ms, r)) entry = R.texture(null, s.srgb, liverySkin(ms) || S.project.livery.albedo);
    else if (s.role === 'regionMap' && S.project.livery && S.project.livery.region && liveryApplies(ms, r))
      entry = R.texture(null, false, S.project.livery.region);           // <livery>_region.dds (IBL car body)
    else if (ms.texPick && ms.texPick[s.jsonIndex ?? s.role]) entry = R.texture(null, s.srgb, ms.texPick[s.jsonIndex ?? s.role]);
    else {
      const srgb = heat ? false : s.srgb;                                    // heat: normal map (linear)
      entry = R.texture(s.tex.split(' ')[0], srgb);
      if (s.anim && (s.anim.method !== 0 || ms.ledIndex != null)) {        // NAME.dds -> NAME00.dds, NAME01.dds ...
        frames = [];
        for (let i = 0; i < s.anim.frames; i++) frames.push(R.texture(RF2.frameName(s.tex, i), srgb));
      }
    }
    // rF2 plays backfire flames with the player setting "Backfire Anim Speed" (PLR, default 30 frames/s),
    // not with the GMT stage rate (1.0) - the method stays the stage's one (CUBETAM_RANDOM)
    const bf = frames && /backfire/i.test(ms.name + ' ' + s.tex);
    units[unit] = { entry, base: entry, frames, anim: frames ? (bf ? { ...s.anim, rate: S.view.backfireSpeed } : s.anim) : null, frame: -1,
      uv: Math.max(0, RF2.UVS.indexOf(s.uv)), scale: s.scale || [1, 1], slot: s };
  }
  const u = RF2.uniforms(r, ms.json || { srcBlend: ms.srcBlend, dstBlend: ms.dstBlend, flags: ms.gmtFlags || [] }, S.view);
  const mflags = (ms.json && ms.json.flags) || ms.gmtFlags || [];
  ms.gpu = { u, units, noShadow: /NOSHADOW/i.test(r.shader || ms.gmtShader || ''), normalBC5: ['LEGACY', 'UNLIT', 'CARPAINT', 'DASH'].includes(r.family) ? 0 : 1,
    twoSided: mflags.includes('CUBEMAT_TWOSIDED') || r.family === 'VEGETATION' || r.family === 'GLASS',
    gmtTwoSided: mflags.includes('CUBEMAT_TWOSIDED'), heat, heatUnit: heat ? units.findIndex(x => x) : -1 };
  ms.animated = units.some(x => x && x.anim);
  stepAnimations(true);
  updateAnimButton();
  R.requestRender();
}

// ------------------------------------------------------ texture animation ---
const ANIM = { playing: true, t0: performance.now(), paused: 0, speed: 1, events: true };
const animTime = () => (ANIM.playing ? (performance.now() - ANIM.t0) : ANIM.paused) / 1000 * ANIM.speed;
function stepAnimations(force) {
  const t = animTime();
  let changed = false;
  for (const ms of S.mats.values()) {
    if (!ms.animated || !ms.gpu) continue;
    for (const u of ms.gpu.units) {
      if (!u || !u.anim) continue;
      const f = ms.ledIndex != null ? (DASH.ledOn(ms.ledIndex) ? Math.min(1, u.anim.frames - 1) : 0)
        : RF2.animFrame(u.anim, t, ANIM.events);
      if (f === u.frame && !force) continue;
      u.frame = f;
      const e = u.frames[f];
      u.entry = e && e.status !== 'missing' && e.status !== 'error' ? e : u.base;
      changed = true;
    }
  }
  if (changed) {
    R.requestRender();
    if (S.tab === 'tex' && S.selMat && S.selMat.animated) document.querySelectorAll('.frames .fr').forEach(b => {
      const u = S.selMat.gpu.units[+b.dataset.unit]; b.classList.toggle('on', u && u.frame === +b.dataset.i); });
  }
}
(function animLoop() { if (ANIM.playing) stepAnimations(false); requestAnimationFrame(animLoop); })();
function restartAnim() { ANIM.t0 = performance.now(); ANIM.paused = 0; stepAnimations(true); }
function updateAnimButton() {
  const any = [...S.mats.values()].some(m => m.animated);
  const b = $('#tbAnim'); if (!b) return;
  b.classList.toggle('hidden', !any);
  b.classList.toggle('on', ANIM.playing);
  b.lastChild.textContent = ANIM.playing ? 'Animation' : 'Animation (Pause)';
}

R.onTexture = e => {
  if (S.selMat && S.tab === 'tex') updateThumbs();
};

function markDirty(ms, rebuild = false) {
  ms.dirty = ms.json ? JSON.stringify(ms.json) !== ms.saved : false;
  refreshMaterial(ms);
  if (rebuild) renderMatTabs(); else syncJsonText();
  updateMatFooter();
  if (S.autoSave && ms.path && ms.dirty) {
    clearTimeout(ms._t); ms._t = setTimeout(() => saveMaterial(ms, true), 450);
  }
}

async function saveMaterial(ms, quiet = false) {
  if (!ms || !ms.json) return;
  try {
    const res = await api.post('/api/json/save', { path: ms.path, json: ms.json, nextTo: ms.nextTo, materialName: ms.name });
    const isNew = !ms.path;
    ms.path = res.path; ms.saved = JSON.stringify(ms.json); ms.dirty = false;
    updateMatFooter(); renderMatHead();
    if (!quiet || isNew) toast((isNew ? 'JSON angelegt: ' : 'Gespeichert: ') + res.path.split(/[\\/]/).pop());
    flashLive();
  } catch (err) { toast(err.message, 'err', [], 8000); }
}

function setByPath(obj, path, val) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) { if (o[path[i]] == null || typeof o[path[i]] !== 'object') o[path[i]] = {}; o = o[path[i]]; }
  o[path[path.length - 1]] = val;
}

// ------------------------------------------------------------ part list ---
function renderPartList() {
  const list = $('#partList'); list.innerHTML = '';
  const f = $('#partFilter').value.trim().toLowerCase();
  const groups = new Map();
  const nMiss = [...S.parts.values()].filter(p => p.missing).length;
  for (const p of S.parts.values()) {
    if (p.deleted) continue;
    if (p.missing && !S.showMissing) continue;
    if (f && !p.name.toLowerCase().includes(f) && !(p.group || '').toLowerCase().includes(f)) continue;
    const g = p.group || '–';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  const single = groups.size === 1;
  for (const [g, items] of groups) {
    const allOn = items.every(p => p.visible || p.missing);
    const grp = el('div', { class: 'grp' + (items.length > 30 && !f && groups.size > 1 ? ' closed' : '') });
    const head = el('div', { class: 'grp-head' },
      el('span', { class: 'caret' }, icon('chev', 13)),
      el('span', { class: 'grow ellipsis', text: g === '.' ? 'Ordner' : g }),
      el('span', { class: 'cnt', text: String(items.length) }),
      el('button', { class: 'eye' + (allOn ? ' on' : ''), 'aria-label': 'Gruppe ein-/ausblenden',
        onclick: ev => { ev.stopPropagation(); userSetVisible(items.map(p => p.id), !allOn); } }, icon(allOn ? 'eye' : 'eyeoff', 14)));
    head.addEventListener('click', () => grp.classList.toggle('closed'));
    if (!single) grp.append(head);
    const box = el('div', { class: 'grp-items' });
    if (single) box.style.paddingLeft = '0';
    for (const p of items) {
      const row = el('div', { class: 'part' + (S.sel === p.id ? ' sel' : '') + (p.missing ? ' missing' : ''), title: p.file,
        onclick: () => !p.missing && select(p.id), ondblclick: () => !p.missing && focusPart(p.id),
        oncontextmenu: ev => { ev.preventDefault(); openCtx(ev.clientX, ev.clientY, p.id); } },
        el('button', { class: 'eye' + (p.visible ? ' on' : ''), 'aria-label': 'ein-/ausblenden', disabled: p.missing,
          onclick: ev => { ev.stopPropagation(); userSetVisible([p.id], !p.visible); } }, icon(p.visible ? 'eye' : 'eyeoff', 14)),
        el('span', { class: 'pname', text: p.name }),
        p.added ? el('span', { class: 'state', text: 'neu', title: 'Hineingezogen – noch nicht in der GEN' }) : null,
        p.fx ? el('span', { class: 'state', text: 'FX', title: 'Spiel-Effekt (heat_fx = Hitzeflimmern, backfire = Fehlzündung)' }) : null,
        p.missing ? el('span', { class: 'state', text: 'fehlt' }) : p.error ? el('span', { class: 'state err', text: 'Fehler', title: p.error })
          : p.loading ? el('span', { class: 'state', text: '…' }) : null);
      box.append(row);
    }
    grp.append(box);
    list.append(grp);
  }
  if (nMiss) list.append(el('button', { class: 'link-btn missing-toggle', text: S.showMissing ? 'Fehlende Dateien ausblenden' : nMiss + ' fehlende GMT anzeigen',
    onclick: () => { S.showMissing = !S.showMissing; renderPartList(); } }));
  if (!S.parts.size) list.append(el('div', { class: 'sub', style: 'padding:8px', text: 'Keine Teile.' }));
}

async function setVisible(ids, on) {
  const toLoad = [];
  for (const id of ids) {
    const p = S.parts.get(id);
    if (!p || p.missing) continue;
    p.visible = on;
    R.setVisible(id, on);
    if (on && !p.loaded) toLoad.push(id);
  }
  renderPartList();
  if (toLoad.length) { await loadParts(toLoad, toLoad.length > 3); renderPartList(); }
  updateStats();
}

function renderLivery() {
  const box = $('#livery'); const lv = S.project.livery;
  box.classList.toggle('hidden', !lv);
  if (!lv) return;
  box.innerHTML = '';
  const cb = el('input', { type: 'checkbox', id: 'livOn' }); cb.checked = S.view.livery;
  cb.disabled = !lv.albedo && !Object.keys(lv.map || {}).length;
  cb.addEventListener('change', () => { S.view.livery = cb.checked; S.mats.forEach(refreshMaterial); renderMat(); });
  const n = Object.keys(lv.map || {}).length;
  box.append(el('label', { class: 'toggle grow' }, cb, el('span', {}, 'Livery ', el('span', { class: 'mono small muted', text: lv.name }))),
    el('span', { class: 'tag ' + (lv.albedo ? 'ok' : 'miss'), text: lv.albedo ? (n > 1 ? n + ' Skins' : 'gefunden') : 'fehlt',
      title: Object.entries(lv.map || {}).map(([m, p]) => m + ' ← ' + p.split(/[\\/]/).pop()).join('\n') }));
}
// ------------------------------------------------------------- upgrades ---
// VEH Upgrades=*.ini: every UpgradeType with its levels. A click re-reads the GEN like rF2 does:
// in-game (Graphics GEN) the <TOKEN>s get the GEN= values of the selected level; in the menu (Spinner GEN) the
// <STARTUPGRADES> block exists once per level number (<UPNUMBER>) and only the copy of the selected level is shown.
function renderUpgrades() {
  const u = S.project && S.project.upgrades, box = $('#upgrades');
  box.classList.toggle('hidden', !u); box.innerHTML = '';
  if (!u) return;
  box.append(el('div', { class: 'h' }, [el('span', { text: 'Upgrades' }), el('span', { class: 'file', text: u.name, title: u.file })]));
  const modes = u.genModes || {};
  if (modes.spinner && modes.graphics) {
    box.append(el('div', { class: 'upg-mode' }, [['spinner', 'Menü (Spinner)'], ['graphics', 'Ingame (Graphics)']].map(([k, t]) =>
      el('button', { class: u.genMode === k ? 'on' : '', text: t, title: modes[k], onclick: () => applyUpgrades(null, k) }))));
  }
  for (const t of u.types) {
    const lv = t.levels[t.selected] || {};
    const tags = [el('span', { class: 'tag' + (t.visual ? ' vis' : ''), text: t.visual ? 'Grafik' : 'keine Grafik',
      title: t.visual ? 'Hat GEN=-Einträge' : 'Keine GEN=-Einträge (z. B. Physik/Sound) - ändert im Viewer nichts' })];
    if (t.instances.length) tags.push(el('span', { class: 'tag', text: t.instances.join(', '), title: 'Instance=' }));
    const row = el('div', { class: 'upg' }, [
      el('div', { class: 't' }, [el('span', { class: 'nm', text: t.name, title: t.name }), ...tags]),
      el('div', { class: 'lv' }, t.levels.map((l, i) => el('button', { class: i === t.selected ? 'on' : '', text: l.name,
        title: l.description || l.name, onclick: () => { if (i !== t.selected) applyUpgrades({ [t.name]: i }); } }))),
    ]);
    if (lv.gen && lv.gen.length) row.append(el('div', { class: 'gen', text: lv.gen.map(g => '<' + g.token + '> = ' + (g.value === '' ? '""' : g.value)).join('   ') }));
    box.append(row);
  }
  for (const n of u.notes || []) box.append(el('div', { class: 'w', text: n }));
}
async function applyUpgrades(change, genMode) {
  const u = S.project && S.project.upgrades;
  if (!u || S.upgBusy) return;                              // one change at a time
  S.upgBusy = true;
  const sel = {};
  for (const t of u.types) sel[t.name] = t.selected;
  Object.assign(sel, change || {});
  loading(true, 'Upgrades …');
  try {
    // only what changes (like rF2): the server re-reads the GEN, parts that stay keep their id and mesh
    const { project: p, diff } = await api.post('/api/upgrades', { upgrades: sel, genMode: genMode || u.genMode });
    const keepVis = new Map([...S.parts].map(([id, q]) => [id, q.visible]));
    S.project = p;
    for (const id of diff.removed) {
      R.removePart(id); S.parts.delete(id);
      for (const ms of S.mats.values()) ms.users.delete(id);
      if (S.sel === id) select(null);
    }
    const changed = new Set(diff.changed), toLoad = [];
    for (const part of p.parts) {
      const old = S.parts.get(part.id);
      if (!old) {                                            // new part
        const vis = part.light ? !!R.lightsOn[part.light] : part.visible;
        S.parts.set(part.id, { ...part, visible: vis, loaded: false, loading: false });
        if (vis && !part.missing) toLoad.push(part.id);
        continue;
      }
      Object.assign(old, { upgrade: part.upgrade, token: part.token, missing: part.missing });
      // upgrade copies (spinner <Instance>_<n>) follow the level, every other part keeps what the user set
      const vis = changed.has(part.id) && part.upgrade ? part.visible : keepVis.get(part.id);
      old.visible = vis;
      R.setVisible(part.id, vis);
      if (vis && !old.loaded && !old.missing) toLoad.push(part.id);
    }
    renderPartList(); renderUpgrades(); renderWarnings();
    $('#srcSub').textContent = p.subtitle;
    if (toLoad.length) await loadParts(toLoad, toLoad.length > 3);
    R._updateScene(); R.requestRender(); updateStats();
  } catch (err) {
    toast(err.message, 'err', [], 8000);
  } finally { loading(false); S.upgBusy = false; }
}

function renderWarnings() {
  const w = S.project.warnings || [], box = $('#warnings');
  const gi = (S.project.gen && S.project.gen.issues) || [];
  const gname = ((S.project.gen && S.project.gen.path) || '').split(/[\\/]/).pop();
  box.classList.toggle('hidden', !w.length && !gi.length); box.innerHTML = '';
  if (w.length) box.append(el('div', { class: 'h', text: 'Hinweise' }), ...w.map(t => el('div', { class: 'w', text: t })));
  if (gi.length) box.append(el('div', { class: 'h', text: 'GEN-Prüfung · ' + gname }),
    ...gi.map(i => el('div', { class: 'w gi ' + i.level, text: (i.line != null ? 'Zeile ' + (i.line + 1) + ': ' : '') + i.msg })));
}
function renderVehList() {
  const v = S.project.vehList || [], box = $('#vehList');
  box.classList.toggle('hidden', !v.length); box.innerHTML = '';
  if (v.length) box.append(el('div', { class: 'h', text: 'Fahrzeuge in diesem Ordner' }),
    ...v.slice(0, 40).map(x => el('button', { text: x.name, title: x.path, onclick: () => openPath(x.path) })));
}

function select(id, matIndex = null) {
  S.sel = id; R.selected = id ?? -1; R.requestRender();
  const part = id != null ? R.parts.get(id) : null;
  if (part) {
    let gi = matIndex;
    if (gi == null) {   // biggest group
      let best = 0; part.groups.forEach((g, i) => { if (g.count > part.groups[best].count) best = i; }); gi = best;
    }
    const g = part.groups[gi] || part.groups[0];
    S.selMat = g ? g.mat : null;
  } else S.selMat = null;
  renderPartList(); renderMat(); updateStats();
  const row = $('#partList .part.sel'); if (row) row.scrollIntoView({ block: 'nearest' });
}
function focusPart(id) { R.focus([id]); }

// ------------------------------------------------------------- mat panel ---
function partMaterials(part) {
  const seen = new Set(), out = [];
  part.groups.forEach((g, i) => { if (g.mat && !seen.has(g.mat.key)) { seen.add(g.mat.key); out.push({ ms: g.mat, gi: i }); } });
  return out;
}

function renderMat() {
  const ms = S.selMat;
  $('#matEmpty').classList.toggle('hidden', !!ms);
  $('#matBody').classList.toggle('hidden', !ms);
  if (!ms) return;
  renderMatHead(); renderMatTabs(); updateMatFooter();
  if (typeof renderMatMirror === 'function') renderMatMirror();
}

function renderMatHead() {
  const ms = S.selMat; if (!ms) return;
  const part = R.parts.get(S.sel), ps = S.parts.get(S.sel);
  $('#matPart').textContent = ps ? ps.name + '.gmt' + (part ? ` · ${fmtN(part.meta.vertexCount)} V · ${fmtN(part.meta.indexCount / 3)} T` : '') : '';
  $('#matPart').title = ps ? ps.file : '';
  const pills = $('#matPills'); pills.innerHTML = '';
  if (part) {
    const mats = partMaterials(part);
    if (mats.length > 1) mats.forEach(({ ms: m }) => pills.append(el('button', { class: 'pill' + (m === ms ? ' on' : ''), text: m.name, title: m.name,
      onclick: () => { S.selMat = m; renderMat(); } })));
  }
  renderAnimRow(part);
  $('#matName').textContent = ms.name; $('#matName').title = ms.name;
  const r = ms.resolved;
  $('#matShader').textContent = r.shader || '–';
  $('#matFamily').textContent = { STANDARD: 'IBL Standard', BLEND: 'IBL Blend', VEGETATION: 'Vegetation', ROAD: 'Straße', TERRAIN: 'Terrain',
    GLASS: 'Glas', WATER: 'Wasser', LEGACY: 'Legacy', UNLIT: 'Unbeleuchtet', CARBODY: 'IBL Car Body' }[r.family] || r.family;
  const fr = $('#matFile'); fr.innerHTML = '';
  const srcTag = ms.jsonSource ? el('span', { class: 'tag', text: ms.jsonSource === 'Livery' ? 'Livery-JSON' : 'MaterialOverride',
    title: ms.jsonSource === 'Livery' ? 'JSON der Lackierung (<Livery>.json neben der DDS) - gewinnt vor allen anderen' : 'VEH MaterialOverride="…"' }) : null;
  if (ms.path) {
    fr.append(...[icon('file', 13), el('span', { class: 'path', text: ms.path.split(/[\\/]/).pop(), title: ms.path }), srcTag,
      el('button', { class: 'link-btn', text: 'Andere JSON…', onclick: () => browse('json') })].filter(Boolean));
  } else if (ms.json && ms.jsonFrom) {
    fr.append(...[icon('file', 13), el('span', { class: 'path', text: ms.jsonFrom.split(/[\\/]/).pop() + ' (Material-Satz)', title: ms.jsonFrom }), srcTag].filter(Boolean));
  } else if (ms.json) {
    fr.append(el('span', { class: 'path', text: 'Neue JSON (noch nicht gespeichert)' }));
  } else {
    fr.append(...[el('span', { class: 'path', text: 'Keine JSON – Werte aus der GMT' }),
      /^L2IBL/i.test(ms.gmtShader || '') ? el('button', { class: 'link-btn', text: 'Anlegen', title: 'JSON aus den GMT-Daten erzeugen',
        onclick: () => { ms.json = RF2.synthesize({ name: ms.name, shader: ms.gmtShader, stages: ms.stages, gmtStd: ms.gmtStd, srcBlend: ms.srcBlend, dstBlend: ms.dstBlend, flags: ms.gmtFlags }); ms.saved = null; markDirty(ms, true); renderMatHead(); } }) : null,
      el('button', { class: 'link-btn', text: 'Zuweisen…', onclick: () => browse('json') })].filter(Boolean));
  }
}

// skinned GMT + ANM: frame slider (server poses the mesh)
function renderAnimRow(part) {
  const box = $('#matAnim'); box.innerHTML = '';
  const a = part && part.meta.anim;
  box.classList.toggle('hidden', !a);
  if (!a) return;
  if (a.error) { box.append(el('span', { class: 'err', text: 'ANM-Fehler: ' + a.error })); return; }
  if (!a.file) { box.append(el('span', { class: 'muted', text: 'Skelett mit ' + a.bones + ' Bones – keine passende ANM gefunden (Ruhepose).' })); return; }
  const out = el('input', { class: 'num', type: 'number', min: 0, max: a.frames - 1, step: 1, value: a.frame, 'aria-label': 'ANM-Bild' });
  const rng = el('input', { type: 'range', min: 0, max: a.frames - 1, step: 1, value: a.frame, 'aria-label': 'ANM-Bild' });
  const pid = part.id;
  const go = v => { clearTimeout(renderAnimRow._t); renderAnimRow._t = setTimeout(() => setPartFrame(pid, v), 90); };
  rng.addEventListener('input', () => { out.value = rng.value; go(+rng.value); });
  out.addEventListener('change', () => { rng.value = out.value; go(+out.value); });
  box.append(el('div', { class: 'row between' }, el('span', { class: 'anim-h', text: 'ANM' }),
      el('span', { class: 'mono small muted', text: a.file + ' · ' + a.bones + ' Bones', title: a.path })),
    el('div', { class: 'axis' }, el('span', { class: 'an', text: 'Bild' }), rng, out),
    el('div', { class: 'row between small muted' }, el('span', { text: a.frames + ' Bilder · ' + a.fps + ' fps' }),
      el('button', { class: 'link-btn', text: 'Standard (' + a.default + ')', onclick: () => { rng.value = out.value = a.default; setPartFrame(pid, a.default); } })));
}
async function setPartFrame(pid, frame) {
  const ps = S.parts.get(pid);
  try {
    const r = await fetch('/api/mesh/' + pid + '?frame=' + frame);
    if (!r.ok) throw new Error((await r.json()).error);
    const part = R.addPart(await r.arrayBuffer());
    part.visible = ps.visible;
    part.groups.forEach(g => { g.mat = materialFor(part.meta.materials[g.material] || part.meta.materials[0], pid); });
    ps.meta = part.meta;
  } catch (err) { toast(err.message, 'err'); }
}

function renderMatTabs() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  $('#tabParams').classList.toggle('hidden', S.tab !== 'params');
  $('#tabTex').classList.toggle('hidden', S.tab !== 'tex');
  $('#tabFlags').classList.toggle('hidden', S.tab !== 'flags');
  $('#tabJson').classList.toggle('hidden', S.tab !== 'json');
  if (S.tab === 'params') renderParams();
  if (S.tab === 'tex') renderTextures();
  if (S.tab === 'flags') renderFlags();
  if (S.tab === 'json') syncJsonText(true);
}
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; renderMatTabs(); }));

function colorHex(v) { const c = x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0'); return '#' + c(v[0]) + c(v[1]) + c(v[2]); }
function hexColor(h) { return [1, 3, 5].map(i => +(parseInt(h.substr(i, 2), 16) / 255).toFixed(4)); }

function paramEditor(ms, path, key, val) {
  const label = key;
  const set = v => { setByPath(ms.json, path, v); markDirty(ms); };
  if (typeof val === 'number') {
    const [mn, mx, st] = RF2.rangeFor(path.join('.'), val);
    const out = el('span', { class: 'val', text: String(+val.toFixed(4)) });
    const rng = el('input', { type: 'range', min: mn, max: mx, step: st, value: val, 'aria-label': label });
    const nb = el('input', { type: 'number', step: st, value: val, 'aria-label': label + ' Wert' });
    rng.addEventListener('input', () => { const v = +rng.value; nb.value = v; out.textContent = String(+v.toFixed(4)); set(v); });
    nb.addEventListener('change', () => { const v = +nb.value; if (isFinite(v)) { rng.value = v; out.textContent = String(v); set(v); } });
    return el('div', { class: 'prm' }, el('div', { class: 'lbl' }, el('span', { text: label }), out), rng, nb);
  }
  if (Array.isArray(val) && val.every(x => typeof x === 'number')) {
    const isCol = /colou?r|tint|albedo/i.test(key) && (val.length === 3 || val.length === 4);
    const box = el('div', { class: 'field' }, el('div', { class: 'row between' }, el('span', { text: label }),
      el('span', { class: 'val', text: '[' + val.map(v => +v.toFixed(3)).join(', ') + ']' })));
    const valTxt = box.querySelector('.val');
    const upd = () => { valTxt.textContent = '[' + cur.map(v => +(+v).toFixed(3)).join(', ') + ']'; set(cur.slice()); };
    const cur = val.slice();
    if (isCol) {
      const pick = el('input', { type: 'color', value: colorHex(cur), 'aria-label': label });
      pick.addEventListener('input', () => { const c = hexColor(pick.value); cur[0] = c[0]; cur[1] = c[1]; cur[2] = c[2]; nums.forEach((n, i) => { n.value = cur[i]; }); upd(); });
      const nums = cur.map((v, i) => { const n = el('input', { class: 'num', type: 'number', step: 0.01, value: v, 'aria-label': label + ' ' + 'RGBA'[i] });
        n.addEventListener('change', () => { cur[i] = +n.value; pick.value = colorHex(cur); upd(); }); return n; });
      box.append(el('div', { class: 'color-row' }, pick, el('div', { class: 'vec grow' }, nums)));
    } else {
      const nums = cur.map((v, i) => { const n = el('input', { class: 'num', type: 'number', step: 0.01, value: v, 'aria-label': label + ' ' + i });
        n.addEventListener('change', () => { cur[i] = +n.value; upd(); }); return n; });
      box.append(el('div', { class: 'vec' }, nums));
    }
    return box;
  }
  if (typeof val === 'boolean') {
    const cb = el('input', { type: 'checkbox' }); cb.checked = val;
    cb.addEventListener('change', () => set(cb.checked));
    return el('label', { class: 'toggle' }, cb, el('span', { text: label }));
  }
  if (val === null) return el('div', { class: 'row between small' }, el('span', { text: label }), el('span', { class: 'muted mono', text: 'null' }));
  if (typeof val === 'string') {
    const t = el('input', { class: 'num', value: val, 'aria-label': label });
    t.addEventListener('change', () => set(t.value));
    return el('div', { class: 'field' }, el('span', { text: label }), t);
  }
  return null;
}

function paramSection(ms, title, obj, path) {
  const sec = el('section', { class: 'sec' }, el('div', { class: 'sec-h', text: title }));
  const nested = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) nested.push([k, v]);
    else { const ed = paramEditor(ms, path.concat(k), k, v); if (ed) sec.append(ed); }
  }
  const out = [sec];
  if (sec.children.length === 1) out.pop();
  for (const [k, v] of nested) out.push(...paramSection(ms, (title ? title + ' · ' : '') + k, v, path.concat(k)));
  return out;
}

function renderParams() {
  const page = $('#tabParams'); page.innerHTML = '';
  const ms = S.selMat; if (!ms) return;
  if (!ms.json) {
    page.append(el('div', { class: 'note', text: 'Für dieses Material wurde keine JSON gefunden (die Engine sucht "' + ms.name + '.json" in den Suchpfaden). ' +
      'Angezeigt werden die Texturen aus der GMT mit Standardwerten.' }));
    if (/^L2IBL/i.test(ms.gmtShader || '')) page.append(el('button', { class: 'btn', text: 'JSON aus GMT anlegen', onclick: () => {
      ms.json = RF2.synthesize({ name: ms.name, shader: ms.gmtShader, stages: ms.stages, gmtStd: ms.gmtStd, srcBlend: ms.srcBlend, dstBlend: ms.dstBlend, flags: ms.gmtFlags }); ms.saved = null; markDirty(ms, true); renderMatHead(); } }));
    return;
  }
  const params = (ms.json.parameters || {});
  const cb = params.cbParameters || {};
  page.append(...paramSection(ms, '', cb, ['parameters', 'cbParameters']));
  if (params.cbMaterialExt) page.append(...paramSection(ms, 'Car Body', params.cbMaterialExt, ['parameters', 'cbMaterialExt']));
  if (ms.resolved.family === 'BLEND' && !['VertexAlpha', 'AlbedoA_A', 'BlendMap_R'].includes(ms.resolved.flags.BLENDMASK)) {
    const v = S.view.blendConst;
    const rng = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: v });
    const out = el('span', { class: 'val', text: v.toFixed(2) });
    rng.addEventListener('input', () => { S.view.blendConst = +rng.value; out.textContent = (+rng.value).toFixed(2); S.mats.forEach(refreshMaterial); });
    page.append(el('section', { class: 'sec' }, el('div', { class: 'sec-h', text: 'Vorschau (nur Viewer)' }),
      el('div', { class: 'prm' }, el('div', { class: 'lbl' }, el('span', { text: 'Blend-Faktor ohne BLENDMASK' }), out), rng),
      el('div', { class: 'small muted', text: '0 = wie rF2 (ohne BLENDMASK ist blendData 0, ALBEDOFUNCTION voll angewendet), 1 = nur Albedo. Wird nicht in die JSON geschrieben.' })));
  }
  if (params.StandardInfo) {
    const det = el('details', { class: 'sec' }, el('summary', { class: 'sec-h', text: 'StandardInfo (Legacy)' }));
    det.append(...paramSection(ms, '', params.StandardInfo, ['parameters', 'StandardInfo']));
    page.append(det);
  }
  const so = paramEditor(ms, ['sortOffset'], 'sortOffset', ms.json.sortOffset ?? 0);
  page.append(el('section', { class: 'sec' }, el('div', { class: 'sec-h', text: 'Sortierung' }), so));
}

function renderTextures() {
  const page = $('#tabTex'); page.innerHTML = '';
  const ms = S.selMat; if (!ms) return;
  const r = ms.resolved;
  const lv = S.project.livery;
  if (lv && (lv.albedo || liverySkin(ms))) {
    const cb = el('input', { type: 'checkbox' }); cb.checked = liveryApplies(ms, r);
    cb.addEventListener('change', () => { ms.livery = cb.checked; refreshMaterial(ms); renderTextures(); });
    const sk = liverySkin(ms);
    page.append(el('label', { class: 'toggle note' }, cb, el('span', { text: sk ? 'VEH-Skin als Albedo: ' + sk.split(/[\\/]/).pop() : 'Livery (' + lv.name + ') als Albedo verwenden' })));
  }
  const unitOf = {};
  (ms.gpu.units || []).forEach((u, i) => { if (u) unitOf[u.slot.jsonIndex ?? u.slot.role] = u; });
  r.slots.forEach((s, si) => {
    const u = unitOf[s.jsonIndex ?? s.role];
    const e = u && u.entry;
    const cv = el('canvas', { width: 48, height: 48, 'data-key': e ? e.key : '' });
    const status = s.off ? el('span', { class: 'tag', text: s.off })
      : /^_deftex/i.test(s.tex) ? el('span', { class: 'tag', text: 'Standard' })
        : !e ? el('span', { class: 'tag', text: 'nicht genutzt' })
          : e.status === 'ok' ? el('span', { class: 'tag ok', text: 'ok', title: e.path || '' })
            : e.status === 'loading' ? el('span', { class: 'tag', text: 'lädt' })
              : el('span', { class: 'tag miss', text: 'fehlt', title: e.info });
    const row = el('div', { class: 'tex' + (s.off ? ' inactive' : '') });
    const nameIn = el('input', { class: 'tfile', value: s.tex, 'aria-label': 'Textur für ' + (s.name || s.role), disabled: !ms.json || s.jsonIndex == null });
    nameIn.addEventListener('change', () => {
      if (!ms.json || s.jsonIndex == null) return;
      ms.json.textures[s.jsonIndex].Texture = nameIn.value.trim();
      markDirty(ms, true);
    });
    const meta = el('div', { class: 'tmeta' });
    if (!s.off && s.role) {
      if (s.uvMacro && ms.json) {
        const sel = el('select', { class: 'sel', 'aria-label': 'UV-Set ' + s.uvMacro });
        RF2.flagOptions(s.uvMacro, s.uv).forEach(o => sel.append(el('option', { value: o, text: o, selected: o === s.uv })));
        sel.addEventListener('change', () => { ms.json.preprocessorFlags = ms.json.preprocessorFlags || {}; ms.json.preprocessorFlags[s.uvMacro] = sel.value; markDirty(ms, true); });
        meta.append(el('span', { text: 'UV' }), sel);
      } else meta.append(el('span', { class: 'tag', text: s.uv }));
      if (s.scaleKey && ms.json) {
        const cur = (s.scale || [1, 1]).slice();
        const mk = i => { const n = el('input', { class: 'num', type: 'number', step: 0.1, value: cur[i], style: 'width:58px', 'aria-label': 'UV-Skalierung ' + 'UV'[i] });
          n.addEventListener('change', () => { cur[i] = +n.value; setByPath(ms.json, ['parameters', 'cbParameters', 'UV_Scale', s.scaleKey], cur.slice()); markDirty(ms); });
          return n; };
        meta.append(el('span', { text: 'Skala' }), mk(0), mk(1));
      }
      if (e && e.info) meta.append(el('span', { class: 'mono', text: e.info }));
    }
    if (ms.json && s.jsonIndex != null) {
      const t = ms.json.textures[s.jsonIndex];
      const cb = el('input', { type: 'checkbox' }); cb.checked = !t.inactive;
      cb.addEventListener('change', () => { t.inactive = !cb.checked; markDirty(ms, true); });
      meta.append(el('label', { class: 'toggle', style: 'margin-left:auto' }, cb, el('span', { text: 'aktiv' })));
    }
    const pick = el('button', { class: 'icon-btn small', title: 'Andere Textur hinzuladen (Datei, Ordner oder unverschlüsselte MAS)', 'aria-label': 'Textur hinzuladen für ' + (s.name || s.role),
      onclick: () => { texPickSlot = { key: s.jsonIndex ?? s.role, jsonIndex: s.jsonIndex, label: s.name || s.role };
        browse('tex', (e && e.path) ? e.path.replace(/[\\/][^\\/]*$/, '') : (ms.nextTo || '').replace(/[\\/][^\\/]*$/, '')); } }, icon('folder', 14));
    const nameRow = el('div', { class: 'tfrow' }, nameIn, pick);
    if (ms.texPick && ms.texPick[s.jsonIndex ?? s.role]) nameRow.append(el('button', { class: 'icon-btn small', title: 'Hinzugeladene Textur entfernen', 'aria-label': 'Hinzugeladene Textur entfernen',
      onclick: () => { delete ms.texPick[s.jsonIndex ?? s.role]; refreshMaterial(ms); renderTextures(); } }, icon('x', 14)));
    row.append(cv, el('div', { class: 'min0' }, el('div', { class: 'tname' }, el('span', { class: 'ellipsis', text: s.name || s.role }), status), nameRow), meta);
    if (s.anim) row.append(animEditor(ms, s, u));
    page.append(row);
  });
  if (!r.slots.length) page.append(el('div', { class: 'note', text: 'Keine Texturen.' }));
  updateThumbs();
}

// animated texture: method, rate, frame strip
function animEditor(ms, s, u) {
  const a = s.anim;
  const box = el('div', { class: 'anim' });
  const write = (method, rate) => {
    if (ms.json && s.jsonIndex != null) {           // JSON keys the engine reads
      const t = ms.json.textures[s.jsonIndex];
      t.FrameCount = a.frames; t.Rate = rate; t.Method = 'CUBETAM_' + RF2.METHODS[method];
      markDirty(ms, true);
    } else {                                        // GMT only: preview change
      const st = (ms.stages || []).find(x => RF2.frameName(x.tex, 0) === RF2.frameName(s.tex, 0));
      if (st) { st.method = method; st.rate = rate; }
      refreshMaterial(ms); renderTextures();
    }
    restartAnim();
  };
  const sel = el('select', { class: 'sel', 'aria-label': 'Animationsart' });
  RF2.METHOD_LABEL.forEach((n, i) => sel.append(el('option', { value: i, text: n, selected: i === a.method })));
  sel.addEventListener('change', () => write(+sel.value, a.rate));
  const rate = el('input', { class: 'num', type: 'number', min: 0.01, step: 0.1, value: a.rate, style: 'width:64px', 'aria-label': 'Rate (Bilder pro Sekunde)' });
  rate.addEventListener('change', () => { const v = +rate.value; if (v > 0) write(a.method, v); });
  box.append(el('div', { class: 'row between' }, el('span', { class: 'anim-h', text: 'Animation' }),
      el('span', { class: 'tag', text: a.frames + ' Bilder · aus ' + a.from })),
    el('div', { class: 'row gap8' }, sel, rate, el('span', { class: 'small muted', text: 'Bilder/s' })));
  const strip = el('div', { class: 'frames' });
  const unitIdx = ms.gpu.units.indexOf(u);
  (u && u.frames ? u.frames : []).forEach((fe, i) => {
    const b = el('button', { class: 'fr' + (u.frame === i ? ' on' : '') + (fe.status === 'missing' ? ' miss' : ''),
      'data-unit': unitIdx, 'data-i': i, title: fe.name + (fe.status === 'missing' ? ' – fehlt' : ''),
      onclick: () => { ANIM.playing = false; ANIM.paused = (i / a.rate + 0.0001) * 1000 / ANIM.speed;
        u.frame = -1; stepAnimations(true); u.entry = fe.status === 'ok' ? fe : u.base; u.frame = i; R.requestRender(); updateAnimButton();
        document.querySelectorAll('.frames .fr').forEach(x => x.classList.toggle('on', x === b)); } },
      String(i).padStart(2, '0'));
    strip.append(b);
  });
  strip.append(el('button', { class: 'chip-btn', text: 'Neustart', onclick: () => { ANIM.playing = true; restartAnim(); updateAnimButton(); } }));
  box.append(strip);
  if (a.method === 6) box.append(el('div', { class: 'small muted', text: 'Event: wird im Spiel ausgelöst (z. B. Regenlicht). In der Vorschau läuft es durch.' }));
  if (a.from === 'GMT' && ms.json) box.append(el('div', { class: 'small muted', text: 'Werte aus der GMT – Ändern schreibt FrameCount/Rate/Method in die JSON.' }));
  if (a.from === 'GMT' && !ms.json) box.append(el('div', { class: 'small muted', text: 'Werte aus der GMT – Änderungen nur als Vorschau.' }));
  return box;
}

function updateThumbs() {
  document.querySelectorAll('#tabTex canvas[data-key]').forEach(cv => {
    const e = R.textures.get(cv.dataset.key);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 48, 48);
    const img = R.thumbnail(e, 48);
    if (img) ctx.putImageData(img, 0, 0);
  });
  if (S.tab === 'tex' && S.selMat) {           // refresh status tags once loads settle
    clearTimeout(updateThumbs._t);
    updateThumbs._t = setTimeout(() => { if (S.tab === 'tex') { const y = $('#matScroll').scrollTop; renderTexturesQuiet(); $('#matScroll').scrollTop = y; } }, 250);
  }
}
function renderTexturesQuiet() {
  const fn = updateThumbs; updateThumbs = () => { document.querySelectorAll('#tabTex canvas[data-key]').forEach(cv => {
    const img = R.thumbnail(R.textures.get(cv.dataset.key), 48); if (img) cv.getContext('2d').putImageData(img, 0, 0); }); };
  try { renderTextures(); } finally { updateThumbs = fn; }
}

function renderFlags() {
  const page = $('#tabFlags'); page.innerHTML = '';
  const ms = S.selMat; if (!ms) return;
  if (!ms.json) { page.append(el('div', { class: 'note', text: 'Flags gibt es nur mit einer Material-JSON.' })); return; }
  const js = ms.json;
  const pf = js.preprocessorFlags || {};
  const sec = el('section', { class: 'sec' }, el('div', { class: 'sec-h', text: 'preprocessorFlags' }));
  Object.keys(pf).sort().forEach(k => {
    const sel = el('select', { class: 'sel', 'aria-label': k });
    RF2.flagOptions(k, pf[k]).forEach(o => sel.append(el('option', { value: o, text: o, selected: o === pf[k] })));
    sel.addEventListener('change', () => { js.preprocessorFlags[k] = sel.value; markDirty(ms); });
    sec.append(el('div', { class: 'flag' }, el('span', { text: k, title: k }), sel));
  });
  page.append(sec);
  const bl = el('section', { class: 'sec' }, el('div', { class: 'sec-h', text: 'Blending' }));
  for (const key of ['srcBlend', 'dstBlend']) {
    const sel = el('select', { class: 'sel', 'aria-label': key });
    const opts = RF2.BLENDS.includes(js[key]) || js[key] == null ? RF2.BLENDS : RF2.BLENDS.concat(js[key]);
    opts.forEach(o => sel.append(el('option', { value: o, text: o, selected: o === js[key] })));
    sel.addEventListener('change', () => { js[key] = sel.value; markDirty(ms); });
    bl.append(el('div', { class: 'flag' }, el('span', { text: key }), sel));
  }
  page.append(bl);
  const mf = el('section', { class: 'sec' }, el('div', { class: 'sec-h', text: 'Material-Flags' }));
  const grid = el('div', { class: 'chkgrid' });
  const cur = new Set(js.flags || []);
  const all = RF2.MATFLAGS.concat([...cur].filter(f => !RF2.MATFLAGS.includes(f)));
  all.forEach(f => {
    const cb = el('input', { type: 'checkbox' }); cb.checked = cur.has(f);
    cb.addEventListener('change', () => {
      const s = new Set(js.flags || []); cb.checked ? s.add(f) : s.delete(f);
      js.flags = all.filter(x => s.has(x)); markDirty(ms);
    });
    grid.append(el('label', { class: 'toggle', title: f }, cb, el('span', { class: 'ellipsis', text: f.replace('CUBEMAT_', '') })));
  });
  mf.append(grid); page.append(mf);
}

// rF2 style: 2 spaces, no space after the colon
const rf2Stringify = o => JSON.stringify(o, null, 2).replace(/^(\s*"(?:[^"\\]|\\.)*"): /gm, '$1:');
function syncJsonText(force) {
  const ta = $('#jsonText');
  if (!S.selMat || (!force && S.tab !== 'json')) return;
  if (document.activeElement === ta && !force) return;
  ta.value = S.selMat.json ? rf2Stringify(S.selMat.json) : '// Keine JSON vorhanden.';
  $('#jsonErr').textContent = '';
}
$('#btnJsonApply').addEventListener('click', () => {
  const ms = S.selMat; if (!ms) return;
  try {
    const js = JSON.parse($('#jsonText').value);
    if (!js || typeof js !== 'object') throw new Error('kein Objekt');
    ms.json = js; $('#jsonErr').textContent = ''; markDirty(ms, true); renderMatHead();
  } catch (err) { $('#jsonErr').textContent = err.message; }
});

function updateMatFooter() {
  const ms = S.selMat; if (!ms) return;
  $('#btnSave').disabled = !ms.json || (!ms.dirty && !!ms.path);
  $('#btnSave').textContent = ms.path ? 'Speichern' : 'JSON anlegen';
  const dot = $('#liveDot'), t = $('#liveText');
  if (ms.dirty) { dot.className = 'dot warn'; t.textContent = 'Geändert – Vorschau live, noch nicht gespeichert'; }
  else if (ms.path) { dot.className = 'dot ok'; t.textContent = 'Live – Datei wird überwacht'; }
  else { dot.className = 'dot'; t.textContent = ms.json ? 'Neue JSON – noch nicht gespeichert' : 'Nur GMT-Daten'; }
}
function flashLive() { const d = $('#liveDot'); d.className = 'dot ok'; d.animate([{ transform: 'scale(2.2)' }, { transform: 'scale(1)' }], 500); }
$('#btnSave').addEventListener('click', () => saveMaterial(S.selMat));
$('#autoSave').addEventListener('change', ev => { S.autoSave = ev.target.checked; saveSettings(); });
$('#btnMatClose').addEventListener('click', () => select(null));

// ------------------------------------------------------------------ SSE ---
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type === 'json') {
      for (const ms of S.mats.values()) {
        if (!ms.path || normPath(ms.path) !== normPath(m.path)) continue;
        const apply = () => { ms.json = m.json; ms.saved = JSON.stringify(m.json); ms.dirty = false; refreshMaterial(ms);
          if (ms === S.selMat) { renderMat(); flashLive(); } };
        if (ms.dirty) toast(ms.name + '.json wurde außerhalb geändert.', 'warn', [['Neu laden', apply]], 0);
        else { apply(); toast('JSON neu geladen: ' + m.path.split(/[\\/]/).pop()); }
      }
    } else if (m.type === 'tex') {
      R.reloadPath(m.path); toast('Textur neu geladen: ' + m.path.split(/[\\/]/).pop());
    } else if (m.type === 'gmt') {
      const ps = S.parts.get(m.partId);
      if (ps && ps.loaded) { ps.loaded = false; loadPart(m.partId).then(() => { R._updateScene(); toast('GMT neu geladen: ' + ps.name); }); }
    } else if (m.type === 'cam') camOnEvent(m);
    else if (m.type === 'cockpit') cockpitOnEvent(m);
    else if (m.type === 'tgm' && typeof tgmOnEvent === 'function') tgmOnEvent(m);
    else if (m.type === 'askquit') { window.RF2_HOST = 'webview2'; rf2AskQuit(); }
    else if (m.type === 'warn') toast(m.text, 'warn');
  };
}

// --------------------------------------------------------------- browse ---
let texPickSlot = null;
let browseMode = 'folder';
async function browse(mode, path) {
  browseMode = mode;
  $('#browse').classList.remove('hidden');
  $('#browseTitle').textContent = { folder: 'Ordner öffnen', veh: 'VEH-Datei öffnen', gmt: 'GMT-Datei öffnen', json: 'Material-JSON zuweisen', tex: 'Textur hinzuladen', gdb: 'Strecken-GDB wählen', tgm: 'TGM-Datei wählen', ini: 'all_vehicles.ini wählen' }[mode] || 'Öffnen';
  $('#btnOpenHere').classList.toggle('hidden', mode === 'json' || mode === 'gdb' || mode === 'tgm' || mode === 'ini');
  $('#btnOpenHere').textContent = mode === 'tex' ? 'Ganzen Ordner als Texturquelle' : 'Diesen Ordner öffnen';
  $('#browseHint').textContent = mode === 'ini' ? 'all_vehicles.ini anklicken (…\\UserData\\player\\).' : mode === 'tgm' ? 'TGM anklicken – sie wird für die Achse des gewählten Rads gezeigt.' : mode === 'gdb' ? 'GDB der Strecke anklicken – oder die MAS der Strecke (nur unverschlüsselte).'
    : mode === 'json' ? 'JSON anklicken, um sie diesem Material zuzuweisen.'
    : mode === 'tex' ? 'Textur anklicken = für diesen Slot verwenden. MAS anklicken = Texturen daraus laden (nur unverschlüsselte MAS).'
      : 'Datei anklicken öffnet sie direkt. Ordner werden mit Unterordnern gelesen.';
  await browseTo(path || (mode === 'json' && S.selMat && S.selMat.nextTo) || '');
}
async function browseTo(path) {
  let d;
  try { d = await api.get('/api/browse?path=' + encodeURIComponent(path)); }
  catch (err) { toast(err.message, 'err'); return; }
  $('#browsePath').value = d.path; $('#browse').dataset.path = d.path; $('#browse').dataset.parent = d.parent || '';
  const dr = $('#drives'); dr.innerHTML = '';
  if (d.drives.length > 1) d.drives.forEach(x => dr.append(el('button', { class: 'chip-btn', onclick: () => browseTo(x) }, x)));
  const list = $('#browseList'); list.innerHTML = '';
  const want = { folder: ['.veh', '.gen', '.scn', '.gmt'], veh: ['.veh', '.gen', '.scn'], gmt: ['.gmt'], json: ['.json'],
    tex: ['.dds', '.tga', '.png', '.bmp', '.jpg', '.jpeg', '.mas'], gdb: ['.gdb', '.mas'], tgm: ['.tgm'], ini: ['.ini'] }[browseMode];
  d.dirs.forEach(x => list.append(el('button', { class: 'bi', onclick: () => browseTo(x.path) }, el('span', { class: 'i' }, icon('folder', 15)), x.name)));
  d.files.filter(f => want.includes(f.ext)).forEach(f => list.append(el('button', { class: 'bi file', onclick: () => pickFile(f.path) },
    el('span', { class: 'i' }, icon(f.ext === '.veh' ? 'car' : f.ext === '.json' || browseMode === 'tex' ? 'file' : 'cube', 15)), f.name, el('span', { class: 'ext', text: f.ext }))));
  if (!list.children.length) list.append(el('div', { class: 'sub', style: 'padding:10px', text: 'Leer.' }));
}
async function addTexSource(path) {
  const d = await api.post('/api/addsource', { path });
  for (const e of R.textures.values()) if (e.key.startsWith('n:') && e.status !== 'ok') { e.status = 'loading'; R._load(e); }
  return d;
}
async function pickFile(path) {
  if (browseMode === 'gdb') { closeBrowse(); return loadGdb(path); }
  if (browseMode === 'tgm') { closeBrowse(); return tgmPicked(path); }
  if (browseMode === 'ini') { closeBrowse(); return mirrorLoadPlayer(path); }
  if (browseMode === 'tex') {
    const ms = S.selMat, slot = texPickSlot;
    closeBrowse();
    try {
      if (/\.mas$/i.test(path)) {
        const d = await addTexSource(path);
        toast(d.added + ' Dateien aus ' + path.split(/[\\/]/).pop() + ' verfügbar');
      } else {
        await addTexSource(path);
        if (ms && slot) {
          ms.texPick = ms.texPick || {};
          ms.texPick[slot.key] = path;
          const stem = path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
          if (ms.json && slot.jsonIndex != null) { ms.json.textures[slot.jsonIndex].Texture = stem; markDirty(ms, true); }
          else { refreshMaterial(ms); renderTextures(); }
          toast('Textur für ' + slot.label + ': ' + path.split(/[\\/]/).pop() + (ms.json ? ' (JSON geändert – Speichern nicht vergessen)' : ' (nur Vorschau)'));
        }
      }
      S.mats.forEach(refreshMaterial);
    } catch (err) { toast(err.message, 'err'); }
    return;
  }
  if (browseMode === 'json') {
    const ms = S.selMat;
    try {
      const d = await api.get('/api/json?path=' + encodeURIComponent(path));
      ms.json = d.json; ms.path = d.path; ms.saved = JSON.stringify(d.json); ms.dirty = false;
      refreshMaterial(ms); renderMat();
      toast('JSON zugewiesen (nur in dieser Sitzung): ' + path.split(/[\\/]/).pop());
    } catch (err) { toast(err.message, 'err'); }
    closeBrowse(); return;
  }
  closeBrowse(); openPath(path);
}
const closeBrowse = () => $('#browse').classList.add('hidden');
$('#btnBrowseClose').addEventListener('click', closeBrowse);
$('#browse').addEventListener('click', ev => { if (ev.target.id === 'browse') closeBrowse(); });
$('#btnUp').addEventListener('click', () => { const p = $('#browse').dataset.parent; if (p) browseTo(p); });
$('#browseForm').addEventListener('submit', ev => { ev.preventDefault(); browseTo($('#browsePath').value.trim()); });
$('#btnOpenHere').addEventListener('click', async () => {
  const p = $('#browse').dataset.path; closeBrowse();
  if (browseMode !== 'tex') return openPath(p);
  try { const d = await addTexSource(p); S.mats.forEach(refreshMaterial); toast(d.added + ' Texturen aus ' + p.split(/[\\/]/).pop() + ' hinzugeladen'); }
  catch (err) { toast(err.message, 'err'); }
});
document.querySelectorAll('[data-browse]').forEach(b => b.addEventListener('click', () => browse(b.dataset.browse)));
$('#btnOpen').addEventListener('click', () => browse('folder', S.project ? S.project.path : ''));
$('#startForm').addEventListener('submit', ev => { ev.preventDefault(); openPath($('#startPath').value.trim().replace(/^"|"$/g, '')); });

// ------------------------------------------------------- toolbar & keys ---
const setMode = m => { R.cam.mode = m; $('#tbOrbit').classList.toggle('on', m === 'orbit'); $('#tbFly').classList.toggle('on', m === 'fly'); };
$('#tbOrbit').addEventListener('click', () => setMode('orbit'));
$('#tbFly').addEventListener('click', () => setMode('fly'));
$('#tbFocus').addEventListener('click', () => R.focus(S.sel != null ? [S.sel] : null));
$('#tbAnim').addEventListener('click', () => {
  if (ANIM.playing) { ANIM.paused = performance.now() - ANIM.t0; ANIM.playing = false; }
  else { ANIM.t0 = performance.now() - ANIM.paused; ANIM.playing = true; }
  updateAnimButton();
});
$('#tbWire').addEventListener('click', () => { R.settings.wire = !R.settings.wire; $('#tbWire').classList.toggle('on', R.settings.wire); R.requestRender(); });
$('#tbFaces').addEventListener('click', () => {
  R.settings.faceOrient = !R.settings.faceOrient; $('#tbFaces').classList.toggle('on', R.settings.faceOrient); R.requestRender();
  toast(R.settings.faceOrient ? 'Face Orientation an: nur gebaute Faces, Rückseiten durchsichtig' : 'Face Orientation aus');
});
document.addEventListener('pointerdown', ev => {
  if (!$('#lightPop').classList.contains('hidden') && !ev.target.closest('#lightPop,#tbLight')) {
    $('#lightPop').classList.add('hidden'); $('#tbLight').classList.remove('on');
  }
});
$('#tbLight').addEventListener('click', () => { $('#lightPop').classList.toggle('hidden'); $('#tbLight').classList.toggle('on', !$('#lightPop').classList.contains('hidden')); });
// screenshot: the server saves it (Pictures\\rF2 GMT Viewer) - no browser download
$('#tbShot').addEventListener('click', () => {
  R.draw();
  $('#gl').toBlob(async b => {
    try {
      const r = await fetch('/api/screenshot?name=' + encodeURIComponent((S.project ? S.project.title : 'rf2').replace(/\.[^.]*$/, '')), { method: 'POST', body: b });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || r.statusText);
      toast('Screenshot gespeichert: ' + d.path.split(/[\\/]/).pop(), 'ok', [['Im Ordner zeigen', () => api.post('/api/reveal', { path: d.path }).catch(err => toast(err.message, 'err'))]], 6000);
    } catch (err) { toast(err.message, 'err'); }
  }, 'image/png');
});
$('#btnSrcCollapse').addEventListener('click', () => $('#srcPanel').classList.toggle('collapsed'));
$('#partFilter').addEventListener('input', renderPartList);
$('#btnAll').addEventListener('click', () => setVisible([...S.parts.keys()], true));
$('#btnNone').addEventListener('click', () => setVisible([...S.parts.keys()], false));
$('#btnIsolate').addEventListener('click', () => {
  if (S.isolated) { const prev = S.isolated; S.isolated = null; [...S.parts.values()].forEach(p => { p.visible = prev.has(p.id); R.setVisible(p.id, p.visible); }); renderPartList(); updateStats(); $('#btnIsolate').textContent = 'Isolieren'; return; }
  if (S.sel == null) return toast('Erst ein Teil auswählen.', 'warn');
  S.isolated = new Set([...S.parts.values()].filter(p => p.visible).map(p => p.id));
  setVisible([...S.parts.keys()].filter(id => id !== S.sel), false);
  $('#btnIsolate').textContent = 'Alle zurück';
});

// light popover
const bindRange = (id, out, key, fmt) => {
  const r = $(id);
  r.addEventListener('input', () => { R.settings[key] = +r.value; $(out).textContent = fmt(+r.value); R.requestRender(); saveSettings(); });
};
bindRange('#sunAz', '#oAz', 'sunAz', v => v + '°');
bindRange('#sunEl', '#oEl', 'sunEl', v => v + '°');
bindRange('#expo', '#oEx', 'exposure', v => v.toFixed(2));
bindRange('#amb', '#oAmb', 'ambient', v => v.toFixed(2));
document.querySelectorAll('#envSeg button').forEach(b => b.addEventListener('click', () => {
  R.settings.env = +b.dataset.env; document.querySelectorAll('#envSeg button').forEach(x => x.classList.toggle('on', x === b));
  if (R.settings.env === 4 && !ROOM.loaded && $('#roomSel').value) loadShowroom($('#roomSel').value);
  if (R.settings.env !== 3 && !S.view.nightManual && S.view.night) { S.view.night = false; const c = $('#optNight'); if (c) c.checked = false; S.mats.forEach(refreshMaterial); }
  syncSkyUi(); R.requestRender(); saveSettings();
}));
$('#optShadow').addEventListener('change', ev => { R.settings.shadows = ev.target.checked; R.requestRender(); saveSettings(); });
$('#optGrid').addEventListener('change', ev => { R.settings.grid = ev.target.checked; R.requestRender(); saveSettings(); });
$('#optCull').addEventListener('change', ev => { R.settings.cull = ev.target.checked; R.requestRender(); saveSettings(); });
(() => {   // debug channel + night switch
  const sel = el('select', { class: 'sel', id: 'dbgSel', 'aria-label': 'Kanal' });
  ['Final', 'Albedo', 'Normalen', 'Roughness', 'Metallic', 'AO', 'Specular', 'UV-Raster'].forEach((n, i) => sel.append(el('option', { value: i, text: n })));
  sel.addEventListener('change', () => { R.settings.debug = +sel.value; R.requestRender(); });
  const night = el('input', { type: 'checkbox', id: 'optNight' });
  night.addEventListener('change', () => { S.view.night = night.checked; S.view.nightManual = true; S.mats.forEach(refreshMaterial); });
  const bfOut = el('output', { text: '30' });
  const bfR = el('input', { type: 'range', min: 1, max: 128, step: 1, value: 30, id: 'bfSpeed' });
  bfR.addEventListener('input', () => { S.view.backfireSpeed = +bfR.value; bfOut.textContent = bfR.value; S.mats.forEach(m => { if (/backfire/i.test(m.name) || (m.stages || []).some(x => /backfire/i.test(x.tex))) refreshMaterial(m); }); });
  $('#lightPop').append(el('label', { class: 'field', title: 'Wie im Spiel (PLR „Backfire Anim Speed“, Standard 30 Bilder/s)' },
    el('span', { class: 'row between' }, el('span', { text: 'Backfire Anim Speed' }), bfOut), bfR));
  $('#lightPop').append(el('label', { class: 'field' }, el('span', { text: 'Kanal anzeigen' }), sel),
    el('label', { class: 'toggle' }, night, el('span', { text: 'Nacht (EMISSIVEMODE Night an)' })));
})();

// ----------------------------------------------------------- car lights ---
// GEN Light=Headlight/Taillight/Brakelight (spots) + glow instances HLIGHTDS/PS, BLIGHTDS/PS, RAINLIGHT, REVERSELIGHT, WARNINGLIGHT
document.querySelectorAll('#carLightBox input[data-light]').forEach(cb => cb.addEventListener('change', () => {
  const k = cb.dataset.light; R.lightsOn[k] = cb.checked;
  setVisible([...S.parts.values()].filter(p => p.light === k).map(p => p.id), cb.checked);
  R.requestRender();
}));
$('#rainAmt').addEventListener('input', ev => { R.rain = +ev.target.value; $('#oRain').textContent = Math.round(R.rain * 100) + ' %'; R.requestRender(); });

// ------------------------------------------------------------ showrooms ---
// rF2 root from the opened path: ...\ModDev\Showroom or ...\Installed\Showroom; every MAS there with an SCN.
// The INI inside is ignored, only its name is shown ("_" = space); the SCN is the showroom scene.
const ROOM = { list: [], loaded: null, ids: [], gen: 0 };
async function initShowrooms() {
  ROOM.gen++; ROOM.loaded = null; ROOM.ids = []; R.showroom = null;
  let d = null;
  try { d = await api.get('/api/showrooms'); } catch (err) { d = null; }
  const items = (d && d.items) || null;
  ROOM.list = items || [];
  $('#envRoom').classList.toggle('hidden', !items);
  $('#lightPop').classList.toggle('wide', !!items);       // room for the extra "Showroom" button
  const sel = $('#roomSel'); sel.innerHTML = '';
  sel.append(el('option', { value: '', text: 'Keins' }));
  ROOM.list.forEach(it => sel.append(el('option', { value: it.mas, text: it.name + (it.error ? ' (nicht lesbar)' : ''), disabled: !!it.error })));
  $('#roomInfo').textContent = items ? (items.length ? d.kind + '\\Showroom · ' + items.length + ' Showroom(s)' : 'Keine Showroom-MAS in ' + d.dir) : '';
  if (!items) {
    if (R.settings.env === 4) { R.settings.env = 0; document.querySelectorAll('#envSeg button').forEach(b => b.classList.toggle('on', +b.dataset.env === 0)); }
    syncSkyUi(); return;
  }
  const want = R.settings.room === '' ? null : (ROOM.list.find(it => it.name === R.settings.room && !it.error) || ROOM.list.find(it => !it.error));
  sel.value = want ? want.mas : '';
  syncSkyUi();
  if (R.settings.env === 4 && want) loadShowroom(want.mas);
}
async function loadShowroom(mas) {
  const gen = ++ROOM.gen;                 // a newer load / another project makes this one obsolete
  loading(true, 'Lade Showroom …');
  try {
    const d = await api.post('/api/showroom', { mas });
    if (gen !== ROOM.gen) return;
    ROOM.ids.forEach(id => R.removePart(id));
    ROOM.ids = [];
    for (const pt of d.parts) {
      const r = await fetch('/api/mesh/' + pt.id);
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      if (gen !== ROOM.gen) { ROOM.ids.forEach(id => R.removePart(id)); ROOM.ids = []; return; }
      const part = R.addPart(buf);
      part.env = true; part.reflectOnly = !!pt.reflectOnly;   // SCN Render=False: only in reflection maps
      part.groups.forEach(g => { g.mat = materialFor(part.meta.materials[g.material] || part.meta.materials[0], pt.id); });
      ROOM.ids.push(pt.id);
    }
    // rF2 showroom scene, HDR mode (always on):
    //   first SCN light: Dir = (-0.5615, -0.5783, 0.7157), colour = (230.89, 238.5, 234.3) raw HDR
    //   (replaces Color/255 * Intensity), scene ambient = (11.23, 13.84, 16.23)
    //   (replaces AmbientColor/255). The SCN light values themselves are therefore not used in the showroom.
    const K = Math.pow(2, -4.125) / 1.5;            // = RF2_HDRK in renderer.js (PostProcess Exposure -4.125)
    const dirG = [-0.5615, -0.5783, -0.7157];       // rF2 -> GL: (x, y, -z)
    const n = Math.hypot(...dirG);
    const toL = dirG.map(x => -x / n);
    const col = [230.89, 238.5, 234.3].map(c => c * K);
    const amb = [11.23, 13.84, 16.23].map(c => c * K);
    const vc = d.viewColor ? d.viewColor.map(c => c / 255) : [0.3, 0.3, 0.3];
    const u2 = x => ((x * (0.44 * x + 0.05) + 0.005) / (x * (0.44 * x + 0.5) + 0.08)) - 0.0625;
    const clearT = vc.map(v => Math.pow(Math.min(1, Math.max(0, u2(0.497 * v * Math.pow(2, -4.125)) / u2(0.65))), 1 / 2.2));
    const probePos = d.probe ? [d.probe[0], d.probe[1], -d.probe[2]] : [0, 2, 0];
    R.showroom = { name: d.name, sunDir: toL, sunCol: col, amb, clear: vc, clearT, probePos, cube: null };
    if (d.cube) R.showroom.cube = await R.loadCube(d.cube);
    if (gen !== ROOM.gen) return;
    ROOM.loaded = mas; R.settings.room = d.name;
    $('#roomInfo').textContent = d.name + ' · ' + d.parts.length + ' Objekte · ' + d.scn + (d.cube ? ' · Reflexion ' + d.cube : '');
    if (R.settings.env !== 4) { R.settings.env = 4; document.querySelectorAll('#envSeg button').forEach(b => b.classList.toggle('on', +b.dataset.env === 4)); }
    syncSkyUi(); saveSettings(); R.requestRender(); updateStats();
  } catch (err) { toast(err.message, 'err'); }
  finally { loading(false); }
}
function unloadShowroom() {
  ROOM.gen++;
  ROOM.ids.forEach(id => R.removePart(id));
  ROOM.ids = []; ROOM.loaded = null; R.showroom = null; R.settings.room = '';
  $('#roomInfo').textContent = 'Kein Showroom – Studio-Licht';
  saveSettings(); R.requestRender(); updateStats();
}
$('#roomSel').addEventListener('change', ev => ev.target.value ? loadShowroom(ev.target.value) : unloadShowroom());

// ------------------------------------------------------------- rF2 sky ---
const SKY_DEFAULT = { loc: { lat: 29.014, lon: -81.07, tz: -5, dst: [], alt: 0 }, date: [2026, 6, 21], hours: 14, weather: 0, north: 0, track: '',
  timeScale: 1, useOvercast: false, overcastBlend: 1, overcastTAmbient: 4, overcastTDirect: 0 };
R.settings.sky = JSON.parse(JSON.stringify(SKY_DEFAULT));
SKY.WEATHER.forEach((w, i) => $('#skyWeather').append(el('option', { value: i, text: w.name })));
const pad2 = n => String(n).padStart(2, '0');
const hhmm = h => { const m = Math.round(h * 60) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); };
function skyChanged(save = true) { R.requestRender(); if (save) saveSettings(); }
// "Time / Location / Fog" - the same fields as the AntTweakBar of the gMotor 2.5 viewer (ModDev viewer).
// na = shown like in the viewer, not simulated here.
const TW = (() => {
  const L = () => R.settings.sky.loc, K = () => R.settings.sky;
  const hms = h => { const t = Math.round(((h % 24) + 24) % 24 * 3600); return pad2(Math.floor(t / 3600)) + ':' + pad2(Math.floor(t / 60) % 60) + ':' + pad2(t % 60); };
  const num = (label, get, set, o = {}) => ({ label, kind: 'num', get, set, ...o });
  const rows = [
    { label: 'Use SL', kind: 'ro', get: () => '✓', na: true, title: 'SilverLining – immer an' },
    num('Time Scale', () => K().timeScale ?? 1, v => { K().timeScale = v; }, { dec: 1, step: 0.1, title: 'Zeitraffer: Spielsekunden pro Sekunde (1.0 = Echtzeit)' }),
    num('Month', () => K().date[1], v => { K().date[1] = Math.max(1, Math.min(12, Math.round(v))); }, { step: 1 }),
    num('Day', () => K().date[2], v => { K().date[2] = Math.max(1, Math.min(31, Math.round(v))); }, { step: 1 }),
    num('Year', () => K().date[0], v => { K().date[0] = Math.round(v); }, { step: 1 }),
    { label: 'Time', kind: 'text', get: () => hms(K().hours), set: v => { const m = String(v).match(/^(\d+)(?::(\d+))?(?::(\d+(?:\.\d*)?))?$/); if (m) K().hours = ((+m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600) % 24); } },
    { label: 'DST', kind: 'ro', id: 'twDst', get: () => '–', title: 'aus DSTRange der GDB berechnet' },
    num('Altitude', () => L().alt ?? 0, v => { L().alt = v; }, { step: 1, na: true }),
    num('Latitude', () => L().lat, v => { L().lat = v; }, { step: 0.1 }),
    num('Longitude', () => L().lon, v => { L().lon = v; }, { step: 0.1 }),
    num('Time Zone', () => L().tz, v => { L().tz = v; }, { step: 0.5, title: 'Stunden relativ zu GMT (GDB TimezoneRelativeGMT)' }),
    { group: 'Atmosphere' },
    num('Night Light Pollution', () => L().nightLightPollution ?? 1, v => { L().nightLightPollution = v; }, { dec: 2, step: 0.01, na: true }),
    num('Air Pollution', () => L().airPollution ?? 0.25, v => { L().airPollution = Math.max(0, Math.min(1, v)); }, { dec: 2, step: 0.01, title: 'GDB AirPollution → Trübung (SkyTurbidityPollution 1.25)' }),
    num('Haze Base Scale', () => L().hazeBaseScale ?? 1, v => { L().hazeBaseScale = v; }, { dec: 2, step: 0.01, na: true }),
    num('Haze Cloudy Scale', () => L().hazeCloudyScale ?? 1, v => { L().hazeCloudyScale = v; }, { dec: 2, step: 0.01, na: true }),
    num('Haze Storm Scale', () => L().hazeStormScale ?? 1, v => { L().hazeStormScale = v; }, { dec: 2, step: 0.01, na: true }),
    num('Haze Dawn Scale', () => L().hazeDawnScale ?? 1, v => { L().hazeDawnScale = v; }, { dec: 2, step: 0.01, na: true }),
    { label: 'Use Overcast', kind: 'check', get: () => !!K().useOvercast, set: v => { K().useOvercast = v; } },
    num('Overcast Blend', () => K().overcastBlend ?? 1, v => { K().overcastBlend = Math.max(0, Math.min(1, v)); }, { dec: 2, step: 0.01 }),
    { group: 'Sky' },
    num('Overcast T Ambient', () => K().overcastTAmbient ?? 4, v => { K().overcastTAmbient = v; }, { dec: 2, step: 0.01, na: true }),
    num('Overcast T Direct', () => K().overcastTDirect ?? 0, v => { K().overcastTDirect = v; }, { dec: 2, step: 0.01, title: 'Sonnenanteil bei voller Bewölkung (Use Overcast)' }),
    { label: 'Ambient Colour', kind: 'swatch', id: 'twAmbC' },
    { label: 'Ambient Intensity', kind: 'ro', id: 'twAmbI', get: () => '–' },
    { label: 'Direct Colour', kind: 'swatch', id: 'twDirC' },
    { label: 'Direct Intensity', kind: 'ro', id: 'twDirI', get: () => '–' },
  ];
  const box = $('#twRows'), inputs = [];
  let grp = null;
  for (const r of rows) {
    if (r.group) {
      const h = el('div', { class: 'tw-grp', text: r.group }); box.append(h);
      grp = el('div'); box.append(grp);
      const g = grp; h.addEventListener('click', () => { h.classList.toggle('closed'); g.classList.toggle('hidden'); });
      continue;
    }
    const row = el('div', { class: 'tw-row' + (r.na ? ' na' : ''), title: r.na ? (r.title ? r.title + ' – ' : '') + 'wird im Viewer (noch) nicht nachgebildet' : (r.title || '') });
    row.append(el('span', { text: r.label }));
    let inp;
    if (r.kind === 'num' || r.kind === 'text') {
      inp = el('input', { type: r.kind === 'num' ? 'number' : 'text', step: r.step || 'any' });
      inp.addEventListener('change', () => { const v = r.kind === 'num' ? parseFloat(inp.value) : inp.value; if (r.kind === 'text' || isFinite(v)) { r.set(v); syncSkyUi(); skyChanged(); } });
    } else if (r.kind === 'check') {
      inp = el('input', { type: 'checkbox' });
      inp.addEventListener('change', () => { r.set(inp.checked); skyChanged(); });
    } else if (r.kind === 'swatch') inp = el('div', { class: 'tw-sw', id: r.id });
    else inp = el('div', { class: 'tw-ro', id: r.id || '', text: r.get ? r.get() : '' });
    row.append(inp); (grp || box).append(row);
    if (r.kind !== 'swatch' && r.kind !== 'ro') inputs.push([r, inp]);
  }
  return {
    sync() { for (const [r, inp] of inputs) { if (document.activeElement === inp) continue; if (r.kind === 'check') inp.checked = r.get(); else inp.value = r.kind === 'num' ? (r.dec !== undefined ? (+r.get()).toFixed(r.dec) : +(+r.get()).toFixed(4)) : r.get(); } },
    live(k) {   // read-only values like the viewer: Intensity = max(r, g, b, 1), Colour = rgb / Intensity
      const show = (rgb, ci, ii) => { const m = Math.max(rgb[0], rgb[1], rgb[2], 1);
        $(ii).textContent = m.toFixed(m < 100 ? 4 : 3);
        const c = rgb.map(v => Math.round(Math.max(0, Math.min(1, v / m)) * 255));
        $(ci).style.background = 'rgb(' + c.join(',') + ')'; $(ci).title = rgb.map(v => (v / m).toFixed(3)).join(', '); };
      show(k.rf2Amb, '#twAmbC', '#twAmbI'); show(k.rf2Sun, '#twDirC', '#twDirI');
      $('#twDst').textContent = k.pos.dst ? '✓' : '–';
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#twRows')) return;
      const t = inputs.find(([r]) => r.label === 'Time'); if (t) t[1].value = hms(K().hours);
    },
  };
})();
function syncSkyUi() {
  const k = R.settings.sky, e3 = R.settings.env === 3;
  const e4 = R.settings.env === 4;
  $('#skyBox').classList.toggle('hidden', !e3); $('#sunBox').classList.toggle('hidden', e3 || e4);
  $('#roomBox').classList.toggle('hidden', !e4);
  $('#skyTime').value = k.hours; $('#oTime').textContent = hhmm(k.hours);
  $('#skyDate').value = k.date[0] + '-' + pad2(k.date[1]) + '-' + pad2(k.date[2]);
  $('#skyWeather').value = k.weather;
  TW.sync();
  $('#skyNorth').value = k.north || 0; $('#oNorth').textContent = (k.north || 0) + '°';
}
$('#skyTime').addEventListener('input', ev => { R.settings.sky.hours = +ev.target.value; $('#oTime').textContent = hhmm(+ev.target.value); skyChanged(); });
$('#skyDate').addEventListener('change', ev => { const m = ev.target.value.split('-').map(Number); if (m.length === 3 && m[0]) { R.settings.sky.date = m; skyChanged(); } });
$('#skyWeather').addEventListener('change', ev => { R.settings.sky.weather = +ev.target.value; skyChanged(); });
$('#skyNorth').addEventListener('input', ev => { R.settings.sky.north = +ev.target.value; $('#oNorth').textContent = ev.target.value + '°'; skyChanged(); });
syncSkyUi();
$('#skyGdb').addEventListener('click', () => browse('gdb', S.project ? S.project.path : ''));
let skyTimer = null;
$('#skyPlay').addEventListener('click', () => {
  if (skyTimer) { clearInterval(skyTimer); skyTimer = null; $('#skyPlay').classList.remove('on'); saveSettings(); return; }
  $('#skyPlay').classList.add('on');
  let last = performance.now();
  skyTimer = setInterval(() => {
    const now = performance.now(), k = R.settings.sky;
    k.hours = (k.hours + (now - last) / 1000 * (k.timeScale ?? 1) / 3600) % 24; last = now;
    $('#skyTime').value = k.hours; $('#oTime').textContent = hhmm(k.hours); R.requestRender();
  }, 50);
});
async function loadGdb(path) {
  try {
    const d = await api.get('/api/gdb?path=' + encodeURIComponent(path));
    let it = d.items[0];
    if (d.items.length > 1) {   // a track MAS can hold several layouts - take the first that has a location
      it = d.items.find(x => SKY.parseGdb(x.text).lat !== undefined) || it;
    }
    const g = SKY.parseGdb(it.text);
    if (g.lat === undefined || g.lon === undefined) return toast(it.name + ': keine Latitude/Longitude gefunden', 'warn');
    const k = R.settings.sky;
    k.loc = { lat: g.lat, lon: g.lon, tz: g.tz !== undefined ? g.tz : +(g.lon / 15).toFixed(3), dst: g.dst || [], alt: g.alt || 0 };   // rF2: no TimezoneRelativeGMT -> Longitude / 15
    for (const key of ['airPollution', 'nightLightThreshold', 'nightLightPollution', 'hazeBaseScale', 'hazeCloudyScale', 'hazeStormScale', 'hazeDawnScale']) if (g[key] !== undefined) k.loc[key] = g[key];
    const rd = SKY.parseRaceDate(g.raceDate); if (rd) k.date = rd;
    k.track = (g.name || it.name.replace(/\.gdb$/i, ''));
    if (R.settings.env !== 3) { R.settings.env = 3; document.querySelectorAll('#envSeg button').forEach(b => b.classList.toggle('on', b.dataset.env === '3')); }
    syncSkyUi(); skyChanged();
    toast('Ort übernommen: ' + k.track + (d.items.length > 1 ? ' (' + d.items.length + ' GDB in der MAS, erste mit Ort)' : ''));
  } catch (err) { toast(err.message, 'err'); }
}
R.onSky = k => {
  const p = k.pos, st = R.settings.sky;
  TW.live(k);
  $('#skyInfo').textContent = (st.track ? st.track + ' · ' : '') + 'Sonne ' + p.el.toFixed(1) + '° hoch, ' + ((p.az % 360 + 360) % 360).toFixed(0) + '° Azimut' + (k.night > 0.5 ? ' · Nacht' : k.dayK < 1 ? ' · Dämmerung' : '');
  if (!S.view.nightManual) {
    const thr = st.loc.nightLightThreshold;        // GDB NightLightThreshold: rF2 switches the NIGHT_ lights when sun height (sin) <= value
    const n = thr !== undefined && isFinite(thr) ? Math.sin(k.pos.el * Math.PI / 180) <= thr : k.night > 0.5;
    if (n !== !!S.view.night) { S.view.night = n; const c = $('#optNight'); if (c) c.checked = n; S.mats.forEach(refreshMaterial); }
  }
};

R.onPick = (hit, ev) => {
  if (!hit) { if (!ev.shiftKey) select(null); return; }
  if (hit.side) S.mirrorSide = hit.side;
  const part = R.parts.get(hit.partId);
  select(hit.partId, part && part.groups[hit.group] ? hit.group : null);
};
R.onDoublePick = hit => { if (hit) { select(hit.partId, hit.group); focusPart(hit.partId); } else R.focus(); };

// F11: full screen (no button). Own window -> server toggles it, browser / app window -> Fullscreen API
function toggleFullscreen() {
  if (window.RF2_HOST === 'webview2') { fetch('/api/fullscreen', { method: 'POST', body: '{}' }); return; }   // own window: real full screen
  const d = document, fs = d.fullscreenElement || d.webkitFullscreenElement;
  try {
    if (fs) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else { const e = d.documentElement; const p = (e.requestFullscreen || e.webkitRequestFullscreen).call(e); if (p && p.catch) p.catch(() => {}); }
  } catch (err) { /* not allowed here */ }
}
window.addEventListener('keydown', ev => {
  if (ev.key === 'F11' || ev.code === 'F11') { ev.preventDefault(); ev.stopPropagation(); if (!ev.repeat) toggleFullscreen(); return; }
}, true);
window.addEventListener('keydown', ev => {
  const inField = ev.target.closest && ev.target.closest('input,textarea,select');
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); if (S.selMat) saveMaterial(S.selMat); return; }
  if (inField) return;
  if (ev.key === 'Escape') { if (!$('#browse').classList.contains('hidden')) closeBrowse(); else select(null); }
  if (R.cam.mode === 'fly' && /^(KeyW|KeyA|KeyS|KeyD|KeyQ|KeyE)$/.test(ev.code)) return;
  if (ev.key === 'f' || ev.key === 'F' || ev.code === 'NumpadDecimal' || ev.code === 'NumpadComma') { ev.preventDefault(); R.focus(S.sel != null ? [S.sel] : null); }
  if (ev.code === 'NumpadAdd' || ((ev.key === '+') && !ev.ctrlKey)) { ev.preventDefault(); R.zoomBy(0.85); }
  if (ev.code === 'NumpadSubtract' || ((ev.key === '-') && !ev.ctrlKey)) { ev.preventDefault(); R.zoomBy(1 / 0.85); }
  if (ev.key === 'b' || ev.key === 'B') $('#tbFaces').click();
  if (ev.key === 'z' || ev.key === 'Z') $('#tbWire').click();
  if (ev.code === 'Space' && !$('#tbAnim').classList.contains('hidden')) { ev.preventDefault(); $('#tbAnim').click(); }
  if (ev.key === '1') setMode('orbit');
  if (ev.key === '2') setMode('fly');
});

function updateStats() {
  const s = R.stats();
  const lines = [`${fmtN(s.v)} V · ${fmtN(Math.round(s.t))} T`, `${s.n} / ${S.parts.size} Teile · ${S.mats.size} Materialien`];
  const f = R.formats();
  lines.push('WebGL2 · GPU-DDS: ' + (f.length ? f.join(', ') : 'keine (Pillow-Fallback)'));
  $('#stats').innerHTML = lines.map(l => '<div>' + l + '</div>').join('');
}

// ------------------------------------------------------------- settings ---
function saveSettings() {
  clearTimeout(saveSettings._t);
  saveSettings._t = setTimeout(() => api.post('/api/settings', { ...R.settings, wire: false, debug: 0, autoSave: S.autoSave }).catch(() => {}), 400);
}
function applySettings(s) {
  if (!s) return;
  for (const k of ['env', 'sunAz', 'sunEl', 'exposure', 'ambient', 'grid', 'cull', 'shadows', 'room']) if (s[k] !== undefined) R.settings[k] = s[k];
  $('#optShadow').checked = R.settings.shadows !== false;
  $('#sunAz').value = R.settings.sunAz; $('#oAz').textContent = R.settings.sunAz + '°';
  $('#sunEl').value = R.settings.sunEl; $('#oEl').textContent = R.settings.sunEl + '°';
  $('#expo').value = R.settings.exposure; $('#oEx').textContent = (+R.settings.exposure).toFixed(2);
  $('#amb').value = R.settings.ambient; $('#oAmb').textContent = (+R.settings.ambient).toFixed(2);
  $('#optGrid').checked = R.settings.grid; $('#optCull').checked = R.settings.cull;
  document.querySelectorAll('#envSeg button').forEach(b => b.classList.toggle('on', +b.dataset.env === R.settings.env));
  if (s.sky && s.sky.loc) R.settings.sky = { ...JSON.parse(JSON.stringify(SKY_DEFAULT)), ...s.sky, loc: { ...SKY_DEFAULT.loc, ...s.sky.loc } };
  syncSkyUi();
  S.autoSave = !!s.autoSave; $('#autoSave').checked = S.autoSave;
}

// ----------------------------------------------------------------- start ---
(async () => {
  connectEvents();
  let st;
  try { st = await api.get('/api/state'); } catch (err) { toast('Server nicht erreichbar: ' + err.message, 'err', [], 0); return; }
  window.RF2_HOST = st.host || 'browser';
  I18N.start(I18N.detect(st.lang, st.osLang));
  document.querySelectorAll('.lang-seg button').forEach(b => {
    b.classList.toggle('on', b.dataset.lang === I18N.lang);
    b.addEventListener('click', async () => {
      if (b.dataset.lang === I18N.lang) return;
      try { await api.post('/api/lang', { lang: b.dataset.lang }); } catch (err) { /* still switch */ }
      location.reload();
    });
  });
  applySettings(st.settings);
  const rec = $('#recent'); rec.innerHTML = '';
  if (st.recent.length) {
    rec.append(el('div', { class: 'r-title', text: 'Zuletzt geöffnet' }));
    st.recent.forEach(p => {
      const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
      const ext = (name.match(/\.(\w+)$/) || [])[1];
      const kind = !ext ? 'Ordner' : ext.toUpperCase();
      rec.append(el('button', { title: p, onclick: () => openPath(p) }, el('span', { text: name }), el('span', { class: 'r-kind', text: kind })));
    });
  }
  const want = new URLSearchParams(location.search).get('open');
  if (st.project && (!want || normPath(want) === normPath(st.project.path))) await showProject(st.project);
  else if (want) await openPath(want);
  setInterval(updateStats, 1500);
})();

// ------------------------------------------------------------ cameras (.cam) ---
const CAMS = { path: null, list: [], sel: 0, edits: {}, open: false, look: false, badge: null,
  cockpit: null, cpEdits: {}, useRef: true };
// reference point of a LocalCam (game coords): COCKPIT -> Eyepoint, TVCOCKPIT -> CameraTarget + TVOffset,
// all others -> CameraTarget (cockpitinfo.ini); without cockpitinfo: vehicle origin
function camRef(name) {
  const v = CAMS.cockpit && CAMS.useRef ? CAMS.cockpit.values : null;
  if (!v) return [0, 0, 0];
  // rF2: CameraTarget defaults to the Eyepoint when it is not set
  const g = k => (Array.isArray(v[k]) && v[k].length >= 3 ? v[k]
    : (k === 'CameraTarget' && Array.isArray(v.Eyepoint) ? v.Eyepoint : [0, 0, 0]));
  const n = (name || '').toUpperCase();
  if (n === 'COCKPIT') return g('Eyepoint');
  if (n === 'TVCOCKPIT') return add3(g('CameraTarget'), g('TVOffset'));
  return g('CameraTarget');
}

function camPose(c) {
  const p = c.params, po = p.PositionOffset || [0, 0, 0], oo = p.OrientationOffset || [0, 0, 0];
  const fov = p.Fov || [60, 45], clip = p.ClipPlanes || [0.1, 1000];
  const pitch = oo[0] || 0, yaw = oo[1] || 0, roll = oo[2] || 0;
  // rF2: +y up, forward = -z; GL here: z mirrored (forward = +z)
  const dg = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const dir = norm3([dg[0], dg[1], -dg[2]]);
  const ref = camRef(c.name);
  const pos = [(po[0] || 0) + ref[0], (po[1] || 0) + ref[1], -((po[2] || 0) + ref[2])];
  let eye = pos, target = null;
  const rad = Array.isArray(p.Radius) ? p.Radius[0] : null;
  if (rad) { target = pos; eye = sub3(pos, scl3(dir, rad)); }      // swingman: orbit around the offset point
  let right = cross3(dir, [0, 1, 0]);
  right = Math.hypot(...right) < 1e-6 ? [1, 0, 0] : norm3(right);
  let up = cross3(right, dir);
  up = norm3(add3(scl3(up, Math.cos(roll)), scl3(right, Math.sin(roll))));
  return { eye, dir, up, target, fovY: (fov.length > 1 ? fov[1] : fov[0] * 0.6) * Math.PI / 180,
    near: clip[0] || 0.05, far: clip[1] || 1000 };
}

// ---- rF2 mirrors: one picture from the mirror camera is rendered into the texture "MIRROR";
// every material whose texture is MIRROR (or MIRROR_TONEMAPPED) shows its part of it through its UVs.
// Camera: cockpitinfo MirrorPos (vehicle coordinates, like the Eyepoint), view to the rear (MirrorNorm if set),
// field of view "Mirror Size" = 64 x 14 degrees by default (hor. x vert.).
// Player adjustments (all_vehicles.ini): MirrorLeft/Center/Right=(horiz, vert, size) pan/zoom the UVs of the
// MIRROR vertices in the instances LMIRROR_IN / CMIRROR_IN / RMIRROR_IN:
//   u' = (u - 0.5) * size + 0.5 + horiz,  v' = (v - 0.5) * size + 0.5 - vert      (DX v)
// MirrorPhysical=(x, y, z) moves CMIRROR_IN itself (center mirror only).
const MIRROR_INST = { LMIRROR_IN: 'L', CMIRROR_IN: 'C', RMIRROR_IN: 'R' };
CAMS.mp = { mode: 'live', bySide: true, fov: [64, 14], L: [0, 0, 1], C: [0, 0, 1], R: [0, 0, 1], phys: [0, 0, 0] };
function mirrorPose() {
  const v = CAMS.cockpit && CAMS.cockpit.values;
  if (!v || !Array.isArray(v.MirrorPos)) return null;
  const m = v.MirrorPos, n = Array.isArray(v.MirrorNorm) && Math.hypot(...v.MirrorNorm) > 1e-6 ? v.MirrorNorm : [0, 0, 1];
  const dir = norm3([n[0], n[1], -n[2]]);
  const [fh, fv] = CAMS.mp.fov.map(x => Math.max(1, Math.min(179, x)) * Math.PI / 180);
  return { eye: [m[0], m[1], -m[2]], dir, up: Math.abs(dir[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0], target: null,
    fovY: fv, aspect: Math.tan(fh / 2) / Math.tan(fv / 2), near: 0.02, far: 1500 };
}
function mirrorApplyPart(id) {
  const rp = R.parts.get(id), ps = S.parts.get(id);
  if (!rp || !ps) return;
  const k = MIRROR_INST[(ps.group || '').toUpperCase()];
  rp.mirrorUv = k ? CAMS.mp[k].slice() : null;
  rp.mirrorOffset = k === 'C' ? [CAMS.mp.phys[0], CAMS.mp.phys[1], -CAMS.mp.phys[2]] : null;
}
// test card 1024 x 256 = whole MIRROR texture: grid every 1/16 u, labels, L / C / R thirds
function mirrorTestCanvas() {
  const W = 1024, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const cols = ['#2b5d8a', '#3a7a4a', '#8a3b3b'];
  for (let i = 0; i < 3; i++) { g.fillStyle = cols[i]; g.fillRect(i * W / 3, 0, W / 3 + 1, H); }
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
  for (let i = 1; i < 16; i++) { g.beginPath(); g.moveTo(i * W / 16 + 0.5, 0); g.lineTo(i * W / 16 + 0.5, H); g.stroke(); }
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, i * H / 4 + 0.5); g.lineTo(W, i * H / 4 + 0.5); g.stroke(); }
  g.strokeStyle = '#ffd34a'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(2, 2, W - 4, H - 4);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 110px sans-serif';
  ['L', 'C', 'R'].forEach((t, i) => g.fillText(t, (i + 0.5) * W / 3, H / 2));
  g.font = '18px monospace'; g.textBaseline = 'top';
  for (let i = 0; i <= 8; i++) g.fillText('u ' + (i / 8).toFixed(3), Math.min(W - 45, Math.max(45, i * W / 8)), 8);
  g.textAlign = 'left'; g.fillText('v 0', 8, 30); g.textBaseline = 'bottom'; g.fillText('v 1', 8, H - 6);
  return c;
}
function mirrorSync() {
  // mode: live = picture of the mirror camera, test = test card, off = mirrors black
  const mode = CAMS.mp.mode || 'live', was = CAMS.mirrorMode;
  CAMS.mirrorMode = mode;
  R.mirror = { enabled: true, pose: mirrorPose(), showCar: false, test: mode !== 'live', overlay: CAMS.mp.overlay };
  mirrorHudUpdate();
  if (mode !== was) {
    if (mode === 'live') R._mirrorSig = null;                // render again
    else {
      const c = mode === 'test' ? mirrorTestCanvas() : Object.assign(document.createElement('canvas'), { width: 1024, height: 256 });
      if (mode === 'off') { const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); }
      R.mirrorTestCard(c);
    }
  }
  R.mirrorSides = CAMS.mp.bySide ? { L: CAMS.mp.L, C: CAMS.mp.C, R: CAMS.mp.R } : null;
  for (const id of S.parts.keys()) mirrorApplyPart(id);
  R.requestRender();
}
R.onMirror = (px, w, h) => {                       // live picture -> screen rear-view mirror on top
  const hud = $('#mirrorHud');
  if (!hud || !CAMS.mp.overlay) return;
  hud.width = w; hud.height = h;
  hud.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer.slice(0)), w, h), 0, 0);   // FBO row 0 = top (v = 0)
};
function mirrorHudUpdate() {
  const hud = $('#mirrorHud'), mp = CAMS.mp, pose = mirrorPose();
  const on = !!(mp.overlay && pose && S.project);
  hud.classList.toggle('hidden', !on);
  if (on) hud.style.aspectRatio = (pose.aspect || 4).toFixed(4);
}
function camUpdateScene() {
  mirrorSync();
  if (!CAMS.open) { R.gizmos = []; R.camView = null; R.requestRender(); return; }
  R.gizmos = CAMS.list.map((c, i) => ({ pose: camPose(c), color: i === CAMS.sel ? [0.31, 0.70, 0.85, 1] : [1, 1, 1, 0.35] }));
  R.camView = CAMS.look && CAMS.list[CAMS.sel] ? R.gizmos[CAMS.sel].pose : null;
  if (CAMS.cockpit && CAMS.useRef) {
    const v = CAMS.cockpit.values, gl3 = a => [a[0], a[1], -a[2]];
    if (Array.isArray(v.Eyepoint)) R.gizmos.push({ point: gl3(v.Eyepoint), color: [0.89, 0.65, 0.21, 1] });
    if (Array.isArray(v.CameraTarget)) R.gizmos.push({ point: gl3(v.CameraTarget), color: [0.47, 0.8, 0.5, 1] });
    const mp = mirrorPose();
    if (mp) R.gizmos.push({ point: mp.eye, color: [0.85, 0.45, 0.95, 1] }, { pose: mp, color: [0.85, 0.45, 0.95, 0.9] });
  }
  $('#btnCamLook').classList.toggle('on', CAMS.look);
  $('#btnCamGrab').disabled = CAMS.look || !CAMS.list[CAMS.sel];
  $('#btnCamLook').textContent = CAMS.look ? 'Freie Ansicht' : 'Durch Kamera sehen';
  $('#btnCamLook').title = CAMS.look ? 'Zurück zur freien Ansicht' : 'Durch diese Kamera sehen';
  const viewing = CAMS.look;
  if (viewing && !CAMS.badge) {
    CAMS.badge = el('div', { class: 'camview-badge' }, el('span', { class: 'dot ok' }), el('span', { class: 'cv-name' }),
      el('button', { class: 'link-btn', text: 'Beenden (Esc)', onclick: () => setCamLook(false) }));
    document.body.append(CAMS.badge);
  }
  if (!viewing && CAMS.badge) { CAMS.badge.remove(); CAMS.badge = null; }
  if (CAMS.badge) CAMS.badge.querySelector('.cv-name').textContent = 'Kamera: ' + (CAMS.list[CAMS.sel] || {}).name;
  R.requestRender();
}
function setCamLook(on) { CAMS.look = on; camUpdateScene(); }
// "Ansicht übernehmen": the free view (eye + view direction) becomes PositionOffset / OrientationOffset of the
// selected camera - the inverse of camPose(): rF2 = GL with z mirrored, offset relative to its reference point.
function camGrab() {
  const c = CAMS.list[CAMS.sel];
  if (!c || CAMS.look) return;
  const eye = R.eye(), dirGl = norm3(sub3(R.cam.target, eye));
  const dg = [dirGl[0], dirGl[1], -dirGl[2]];
  const pitch = Math.asin(Math.max(-1, Math.min(1, dg[1])));
  const yaw = Math.atan2(-dg[0], -dg[2]);
  const oo = (c.params.OrientationOffset || [0, 0, 0]).slice();
  const rad = Array.isArray(c.params.Radius) ? c.params.Radius[0] : null;
  let pGl = eye;
  if (rad) pGl = add3(eye, scl3(dirGl, rad));               // swingman: the offset is the orbit point
  const ref = camRef(c.name);
  const before = { PositionOffset: c.params.PositionOffset, OrientationOffset: c.params.OrientationOffset };
  const po = [pGl[0] - ref[0], pGl[1] - ref[1], -pGl[2] - ref[2]].map(v => +v.toFixed(6));
  oo[0] = +pitch.toFixed(6); oo[1] = +yaw.toFixed(6);
  camSet(c, 'PositionOffset', po); camSet(c, 'OrientationOffset', oo);
  if (!c.order.includes('PositionOffset')) c.order.push('PositionOffset');
  if (!c.order.includes('OrientationOffset')) c.order.push('OrientationOffset');
  renderCamPanel(); camUpdateScene();
  toast('Ansicht in Kamera ' + c.name + ' übernommen (noch nicht gespeichert)');
}
R.onCamViewInput = () => setCamLook(false);

async function loadCockpit(path) {
  try {
    const d = await api.get('/api/cockpit?path=' + encodeURIComponent(path));
    CAMS.cockpit = { path: d.path, values: d.values }; CAMS.cpEdits = {};
    if (!CAMS.av) mirrorLoadPlayer();
    renderCamPanel(); camUpdateScene();
    dashSetup(d);
  } catch (err) { toast(err.message, 'err'); }
}

async function loadCamFile(path) {
  try {
    const d = await api.get('/api/cam?path=' + encodeURIComponent(path));
    CAMS.path = d.path; CAMS.list = d.cams; CAMS.edits = {};
    CAMS.sel = Math.min(CAMS.sel, Math.max(0, CAMS.list.length - 1));
    renderCamPanel(); camUpdateScene();
  } catch (err) { toast(err.message, 'err'); }
}

function openCamPanel(on) {
  if (on && DASH.open) openDashPanel(false);
  if (on && typeof tgClose === 'function') tgClose();
  if (on && typeof CLR !== 'undefined' && CLR.open) clrOpen(false);
  CAMS.open = on;
  $('#camPanel').classList.toggle('hidden', !on);
  $('#matPanel').classList.toggle('hidden', on || !S.project);
  $('#tbCam').classList.toggle('on', on);
  if (!on) CAMS.look = false;
  if (on && !CAMS.list.length && S.project.cams.length) loadCamFile(S.project.cams[0].path);
  if (on && !CAMS.cockpit && S.project.cockpit) loadCockpit(S.project.cockpit);
  camUpdateScene();
}

function camSet(c, key, val) {
  c.params[key] = val;
  (CAMS.edits[c.name] = CAMS.edits[c.name] || {})[key] = val;
  updateCamFooter(); camUpdateScene();
}
function updateCamFooter() {
  const dirty = Object.keys(CAMS.edits).length > 0 || Object.keys(CAMS.cpEdits).length > 0;
  $('#btnCamSave').disabled = !dirty;
  $('#camDot').className = 'dot ' + (dirty ? 'warn' : 'ok');
  $('#camText').textContent = dirty ? 'Geändert – Vorschau live, noch nicht gespeichert' : 'Live – Datei wird überwacht';
}

const CAM_AXES = {
  PositionOffset: { labels: ['X seitl.', 'Y Höhe', 'Z vor/zur.'], min: -4, max: 4, step: 0.001, unit: 'm' },
  OrientationOffset: { labels: ['Pitch', 'Yaw', 'Roll'], min: -Math.PI, max: Math.PI, step: 0.001, unit: 'rad' },
  Fov: { labels: ['Fov 1', 'Fov 2'], min: 5, max: 150, step: 0.5, unit: '°' },
  Radius: { labels: ['Radius'], min: 0.5, max: 40, step: 0.05, unit: 'm' },
};

function cockpitSection() {
  const cp = CAMS.cockpit;
  const det = el('details', { class: 'sec cp-sec' }, el('summary', { class: 'sec-h', text: 'cockpitinfo · ' + cp.path.split(/[\\/]/).pop() }));
  if (CAMS.cpOpen) det.open = true;
  det.addEventListener('toggle', () => { CAMS.cpOpen = det.open; });
  const cb = el('input', { type: 'checkbox' }); cb.checked = CAMS.useRef;
  cb.addEventListener('change', () => { CAMS.useRef = cb.checked; renderCamPanel(); camUpdateScene(); });
  det.append(el('label', { class: 'toggle small' }, cb, el('span', { text: 'Kameras auf Eyepoint / CameraTarget beziehen (wie im Spiel)' })));
  const info = { Eyepoint: 'nur COCKPIT · Kreuz orange', CameraTarget: 'alle anderen Kameras · Kreuz grün', TVOffset: 'zusätzlich für TVCOCKPIT' };
  for (const key of ['CameraTarget', 'TVOffset']) {
    const val = cp.values[key];
    if (!Array.isArray(val)) continue;
    const sec = el('div', { class: 'sec' }, el('div', { class: 'sec-h', text: key }), el('div', { class: 'small muted', text: info[key] }));
    ['X', 'Y', 'Z'].forEach((lab, i) => {
      const out = el('input', { class: 'num', type: 'number', step: 0.001, value: val[i], 'aria-label': key + ' ' + lab });
      const rng = el('input', { type: 'range', min: Math.min(-3, val[i]), max: Math.max(3, val[i]), step: 0.001, value: val[i], 'aria-label': key + ' ' + lab });
      const apply = nv => { const arr = cp.values[key].slice(); arr[i] = nv; cp.values[key] = arr; CAMS.cpEdits[key] = arr; updateCamFooter(); camUpdateScene(); };
      rng.addEventListener('input', () => { out.value = +(+rng.value).toFixed(4); apply(+rng.value); });
      out.addEventListener('change', () => { const nv = +out.value; if (isFinite(nv)) { rng.value = nv; apply(nv); } });
      sec.append(el('div', { class: 'axis' }, el('span', { class: 'an', text: lab }), rng, out));
    });
    det.append(sec);
  }
  return det;
}

// Sitz / Spiegel / FOV: always on top of the camera panel, whichever camera is selected.
// Sitz = cockpitinfo Eyepoint (zero point of the in-game seat adjustment), Spiegel = cockpitinfo MirrorPos,
// FOV = Fov of the COCKPIT camera in the .cam (2nd value = vertical, used by rF2)
function camNumInput(val, step, label, onSet) {
  const n = el('input', { class: 'num', type: 'number', step, value: +(+val).toFixed(4), 'aria-label': label, title: 'Mausrad über dem Feld = ± ' + step + ' (Shift ×10)' });
  const set = v => { n.value = +v.toFixed(4); onSet(+n.value); };
  n.addEventListener('change', () => { if (isFinite(+n.value)) onSet(+n.value); });
  n.addEventListener('wheel', ev => { ev.preventDefault(); const k = (ev.shiftKey ? 10 : 1) * step * (ev.deltaY < 0 ? 1 : -1); set((+n.value || 0) + k); }, { passive: false });
  return n;
}
// mirror block: live picture of the mirror camera (the "TV") + the player settings from all_vehicles.ini that move
// the picture on each mirror (UV pan / zoom) - read from and saved to the player file
const MIRROR_KEYS = { L: 'MirrorLeft', C: 'MirrorCenter', R: 'MirrorRight', phys: 'MirrorPhysical' };
async function mirrorLoadPlayer(path) {
  try {
    const d = await api.get('/api/allveh' + (path ? '?path=' + encodeURIComponent(path) : ''));
    CAMS.av = d; CAMS.avDirty = false;
    for (const [k, key] of Object.entries(MIRROR_KEYS)) CAMS.mp[k] = (d.values[key] || CAMS.mp[k]).slice();
    if (path && !d.found) toast(d.veh ? 'Dieses Fahrzeug steht nicht in ' + path.split(/[\\/]/).pop() : 'Nur mit einer geöffneten VEH zuordenbar', 'warn');
    mirrorRenderAll(); mirrorSync();
  } catch (err) { toast(err.message, 'err'); }
}
async function mirrorSavePlayer() {
  const av = CAMS.av;
  if (!av || !av.path) return;
  const values = {};
  for (const [k, key] of Object.entries(MIRROR_KEYS)) values[key] = CAMS.mp[k];
  try {
    const d = await api.post('/api/allveh/save', { path: av.path, values });
    CAMS.av = d; CAMS.avDirty = false;
    toast('Gespeichert: ' + d.path.split(/[\\/]/).pop() + ' (rF2 vorher beenden – es schreibt die Datei beim Beenden neu)');
    mirrorRenderAll();
  } catch (err) { toast(err.message, 'err'); }
}
// picture: mode, field of view, preview, own car, screen mirror
function mirrorCommonBlock(rerender) {
  const mp = CAMS.mp, box = el('div', { class: 'mirror-box' });
  const live = el('select', { class: 'sel', 'aria-label': 'Spiegelbild' },
    el('option', { value: 'live', text: 'Live', selected: mp.mode === 'live' }), el('option', { value: 'test', text: 'Testbild', selected: mp.mode === 'test' }),
    el('option', { value: 'off', text: 'Aus (schwarz)', selected: mp.mode === 'off' }));
  live.title = 'Live: Bild der Spiegel-Kamera (ohne eigenes Auto). Testbild: Raster mit L / C / R – zeigt genau, welcher Ausschnitt der Textur MIRROR zu sehen ist';
  live.addEventListener('change', () => { mp.mode = live.value; mirrorSync(); document.querySelectorAll('.mirror-box select.sel').forEach(x => { x.value = mp.mode; }); });
  const fov = mp.fov.map((v, i) => camNumInput(v, 1, 'Spiegel-FOV ' + (i ? 'vertikal' : 'horizontal'), nv => { mp.fov[i] = Math.max(1, Math.min(179, nv)); camUpdateScene(); }));
  box.append(el('div', { class: 'cq-row', title: 'rF2 „Mirror Size“: Blickwinkel der Spiegel-Kamera, Standard 64° × 14°' },
    live, el('div', { class: 'vec' }, fov[0], el('span', { class: 'small muted cq-u', text: '×' }), fov[1], el('span', { class: 'small muted cq-u', text: '°' }))));
  box.append(el('button', { class: 'btn small-btn' + (mp.overlay ? ' on' : ''), text: mp.overlay ? 'Rückspiegel oben ausblenden' : 'Rückspiegel oben anzeigen',
    title: 'Bildschirm-Rückspiegel wie im Spiel: das Live-Bild der Spiegel-Kamera oben in der Mitte (ohne das eigene Auto)',
    onclick: () => { mp.overlay = !mp.overlay; mirrorSync(); mirrorRenderAll(); } }));
  return box;
}
const MIRROR_SIDE_NAME = { L: 'Links', C: 'Mitte', R: 'Rechts' };
function mirrorChanged() {
  const av = CAMS.av || {};
  CAMS.avDirty = true;
  document.querySelectorAll('.btn-mirsave').forEach(b => { b.disabled = !(av.path && av.found); });
  mirrorSync();
}
// sliders of one mirror (horizontal / vertical / size) - kept in sync wherever they are shown
function mirrorSideBlock(k) {
  const mp = CAMS.mp, box = el('div', { class: 'mirror-side' });
  box.append(el('div', { class: 'sec-h', text: MIRROR_SIDE_NAME[k] + ' (' + MIRROR_KEYS[k] + ')' }));
  const AX = [['horizontal', -0.5, 0.5, 0.001], ['vertikal', -0.5, 0.5, 0.001], ['Größe', 0.2, 3, 0.005]];
  AX.forEach(([an, lo, hi, st], i) => {
    const arr = mp[k];
    const out = el('input', { class: 'num', type: 'number', step: st, value: arr[i], 'aria-label': MIRROR_SIDE_NAME[k] + ' ' + an });
    const rng = el('input', { type: 'range', min: Math.min(lo, arr[i]), max: Math.max(hi, arr[i]), step: st, value: arr[i], 'aria-label': MIRROR_SIDE_NAME[k] + ' ' + an });
    out.dataset.mir = rng.dataset.mir = k + i;
    const sync = () => document.querySelectorAll('[data-mir="' + k + i + '"]').forEach(x => { if (x !== document.activeElement) x.value = x.type === 'range' ? arr[i] : +arr[i].toFixed(4); });
    rng.addEventListener('input', () => { arr[i] = +rng.value; sync(); mirrorChanged(); });
    out.addEventListener('change', () => { if (isFinite(+out.value)) { arr[i] = +out.value; sync(); mirrorChanged(); } });
    box.append(el('div', { class: 'axis' }, el('span', { class: 'an', text: an }), rng, out));
  });
  return box;
}
function mirrorFileBlock() {
  const mp = CAMS.mp, av = CAMS.av || {}, box = el('div', { class: 'mirror-box' });
  box.append(el('div', { class: 'small muted mono ellipsis', title: av.path || '', text: av.path
    ? av.path.split(/[\\/]/).slice(-3).join('\\') + (av.found ? '' : ' – Fahrzeug nicht gefunden') : 'all_vehicles.ini nicht gefunden' }));
  const inst = new Set([...S.parts.values()].map(p => (p.group || '').toUpperCase()).filter(g => MIRROR_INST[g]));
  box.append(el('div', { class: 'small muted', text: inst.size ? 'Im Spiel wirksam für: ' + [...inst].join(', ')
    : 'Achtung: keine Instanz LMIRROR_IN / CMIRROR_IN / RMIRROR_IN in der GEN – im Spiel verschieben diese Werte das Bild bei diesem Auto nicht. Die Vorschau ordnet nach Lage zu.' }));
  box.append(el('div', { class: 'row gap8 wrap' },
    el('button', { class: 'btn small-btn btn-mirsave', text: 'Speichern', disabled: !(av.path && av.found && CAMS.avDirty), onclick: mirrorSavePlayer,
      title: 'Nur die Spiegel-Zeilen dieses Fahrzeugs in all_vehicles.ini ändern (mit .bak)' }),
    el('button', { class: 'btn small-btn', text: 'Neu laden', onclick: () => mirrorLoadPlayer(av.path) }),
    el('button', { class: 'btn small-btn', text: 'Datei …', onclick: () => browse('ini', av.path ? av.path.replace(/[\\/][^\\/]*$/, '') : '') }),
    el('button', { class: 'link-btn', text: 'Standard', title: 'horizontal 0, vertikal 0, Größe 1', onclick: () => {
      Object.assign(mp, { L: [0, 0, 1], C: [0, 0, 1], R: [0, 0, 1], phys: [0, 0, 0] }); mirrorChanged(); mirrorRenderAll(); } })));
  return box;
}
function mirrorSection() {
  const mp = CAMS.mp, box = mirrorCommonBlock();
  const det = el('details', { class: 'mirror-det', open: CAMS.mpOpen !== false },
    el('summary', { class: 'small', text: 'Spiegel links / mitte / rechts (all_vehicles.ini)' }));
  det.addEventListener('toggle', () => { CAMS.mpOpen = det.open; });
  ['L', 'C', 'R'].forEach(k => det.append(mirrorSideBlock(k)));
  const phys = mp.phys.map((v, i) => camNumInput(v, 0.005, 'Phys. Mitte ' + 'XYZ'[i], nv => { mp.phys[i] = nv; mirrorChanged(); }));
  det.append(el('div', { class: 'cq-row', title: 'MirrorPhysical = (x, y, z) – verschiebt den Innenspiegel CMIRROR_IN selbst' },
    el('span', { class: 'cq-l', text: 'Phys. Mitte' }), el('div', { class: 'vec' }, phys)));
  const side = el('input', { type: 'checkbox' }); side.checked = mp.bySide;
  side.addEventListener('change', () => { mp.bySide = side.checked; mirrorSync(); });
  det.append(el('label', { class: 'toggle small', title: 'Spiegelflächen ohne Instanz LMIRROR_IN / CMIRROR_IN / RMIRROR_IN nach ihrer Lage zuordnen (x > 0,15 m links, x < −0,15 m rechts, sonst Mitte)' },
    side, el('span', { text: 'Flächen ohne Instanz nach Lage zuordnen' })));
  det.append(mirrorFileBlock());
  box.append(det);
  return el('div', { class: 'cq-row' }, el('span', {}), box);
}
// material panel: a clicked mirror surface shows the settings of its mirror (left / center / right)
function renderMatMirror() {
  const box = $('#matMirror');
  if (!box) return;
  box.innerHTML = '';
  const ms = S.selMat;
  const isMirror = !!(ms && ms.gpu && ms.gpu.units && ms.gpu.units[0] && ms.gpu.units[0].entry && ms.gpu.units[0].entry.isMirror);
  box.classList.toggle('hidden', !isMirror);
  if (!isMirror) return;
  const ps = S.parts.get(S.sel);
  const k = (ps && MIRROR_INST[(ps.group || '').toUpperCase()]) || S.mirrorSide || 'C';
  box.append(el('div', { class: 'mirror-mat-h' }, el('b', { text: 'Spiegel ' + MIRROR_SIDE_NAME[k].toLowerCase() }),
    el('span', { class: 'small muted', text: 'Klick auf einen anderen Spiegel wechselt' })));
  if (!CAMS.cockpit) box.append(el('div', { class: 'small muted', text: 'Keine cockpitinfo (MirrorPos) – Live-Bild nicht möglich.' }));
  box.append(mirrorCommonBlock(), mirrorSideBlock(k), mirrorFileBlock());
}
function mirrorRenderAll() { renderCamQuick(); renderMatMirror(); }
function renderCamQuick() {
  const box = $('#camQuick'); box.innerHTML = '';
  const cp = CAMS.cockpit, rows = [];
  const vecRow = (label, key, hint, dot) => {
    const val = cp && cp.values[key];
    if (!Array.isArray(val)) return;
    const ins = ['X', 'Y', 'Z'].map((ax, i) => camNumInput(val[i], 0.005, label + ' ' + ax, nv => {
      const arr = cp.values[key].slice(); arr[i] = nv; cp.values[key] = arr; CAMS.cpEdits[key] = arr; updateCamFooter(); camUpdateScene(); }));
    rows.push(el('div', { class: 'cq-row', title: hint }, el('span', { class: 'cq-l' }, el('i', { class: 'cq-dot', style: 'background:' + dot }), label), el('div', { class: 'vec' }, ins)));
  };
  vecRow('Sitz', 'Eyepoint', 'cockpitinfo Eyepoint – Nullpunkt der Sitzverstellung im Spiel (links/rechts, hoch/runter, vor/zurück; vorne = −Z)', '#e3a535');
  vecRow('Spiegel', 'MirrorPos', 'cockpitinfo MirrorPos – Position der Spiegel-Kamera', '#d973f2');
  if (cp && Array.isArray(cp.values.MirrorPos)) rows.push(mirrorSection());
  const ck = CAMS.list.find(c => c.name.toUpperCase() === 'COCKPIT');
  if (ck && Array.isArray(ck.params.Fov)) {
    const vi = ck.params.Fov.length > 1 ? 1 : 0;                // rF2 uses the 2nd (vertical) value, the 1st is ignored
    const fin = camNumInput(ck.params.Fov[vi], 0.5, 'FOV', nv => {
      const arr = ck.params.Fov.slice(); arr[vi] = nv; camSet(ck, 'Fov', arr);
      if (CAMS.list[CAMS.sel] === ck) document.querySelectorAll('#camEdit input[aria-label="Fov Fov ' + (vi + 1) + '"]').forEach(x => { x.value = nv; });
    });
    rows.push(el('div', { class: 'cq-row', title: 'Fov der COCKPIT-Kamera (.cam), vertikal – der erste Wert in der Datei wird vom Spiel nicht benutzt' },
      el('span', { class: 'cq-l' }, el('i', { class: 'cq-dot', style: 'background:var(--accent)' }), 'FOV'), el('div', { class: 'vec' }, fin, el('span', { class: 'small muted cq-u', text: '° vertikal' }))));
  }
  box.classList.toggle('hidden', !rows.length);
  if (rows.length) box.append(el('div', { class: 'sec-h', text: 'Sitz · Spiegel · FOV' }), ...rows);
}

function renderCamPanel() {
  renderCamQuick();
  const sel = $('#camFile'); sel.innerHTML = '';
  (S.project.cams || []).forEach(c => sel.append(el('option', { value: c.path, text: c.name, selected: c.path === CAMS.path })));
  sel.classList.toggle('hidden', (S.project.cams || []).length < 2);   // only a choice when the mod has several
  const pills = $('#camPills'); pills.innerHTML = '';
  CAMS.list.forEach((c, i) => pills.append(el('button', { class: 'pill' + (i === CAMS.sel ? ' on' : ''), text: c.name, title: c.comment || c.name,
    onclick: () => { CAMS.sel = i; renderCamPanel(); camUpdateScene(); }, ondblclick: () => setCamLook(true) })));
  const c = CAMS.list[CAMS.sel];
  const refTxt = !CAMS.cockpit || !CAMS.useRef ? 'relativ zum Fahrzeug-Ursprung'
    : (c && c.name.toUpperCase() === 'COCKPIT' ? 'relativ zum Eyepoint' : c && c.name.toUpperCase() === 'TVCOCKPIT' ? 'relativ zu CameraTarget + TVOffset' : 'relativ zu CameraTarget');
  $('#camNote').textContent = c ? (c.comment ? c.comment + ' · ' : '') + 'Position ' + refTxt + ', vorne = −Z' : 'Keine Kameras in der Datei.';
  const box = $('#camEdit'); box.innerHTML = '';
  if (CAMS.cockpit) box.append(cockpitSection());
  if (!c) return;
  const first = ['PositionOffset', 'OrientationOffset', 'Fov', 'Radius', 'ClipPlanes'];
  const keys = first.filter(k => c.order.includes(k));
  const more = el('details', { class: 'sec' }, el('summary', { class: 'sec-h', text: 'Weitere Werte' }));
  for (const key of keys.concat(c.order.filter(k => !first.includes(k)))) {
    const target = first.includes(key) ? box : more;
    const val = c.params[key];
    const ax = CAM_AXES[key];
    if (Array.isArray(val) && ax) {
      const sec = el('section', { class: 'sec' }, el('div', { class: 'sec-h', text: key }));
      val.forEach((v, i) => {
        const deg = key === 'OrientationOffset';
        const out = el('input', { class: 'num', type: 'number', step: ax.step, value: +v.toFixed(4), 'aria-label': key + ' ' + (ax.labels[i] || i) });
        const rng = el('input', { type: 'range', min: Math.min(ax.min, v), max: Math.max(ax.max, v), step: ax.step, value: v, 'aria-label': key + ' ' + (ax.labels[i] || i) });
        const hint = el('span', { class: 'small muted', text: deg ? (v * 180 / Math.PI).toFixed(1) + '°' : '' });
        const apply = nv => { const arr = c.params[key].slice(); arr[i] = nv; camSet(c, key, arr); if (deg) hint.textContent = (nv * 180 / Math.PI).toFixed(1) + '°';
          if (key === 'Fov' && c.name.toUpperCase() === 'COCKPIT') renderCamQuick(); };
        rng.addEventListener('input', () => { out.value = +(+rng.value).toFixed(4); apply(+rng.value); });
        out.addEventListener('change', () => { const nv = +out.value; if (isFinite(nv)) { rng.value = nv; apply(nv); } });
        sec.append(el('div', { class: 'axis' }, el('span', { class: 'an', text: ax.labels[i] || String(i) }), rng, out));
        if (deg) sec.append(hint);
      });
      target.append(sec);
    } else if (Array.isArray(val)) {
      const nums = val.map((v, i) => { const n = el('input', { class: 'num', type: 'number', step: 0.01, value: v, 'aria-label': key + ' ' + i });
        n.addEventListener('change', () => { const arr = c.params[key].slice(); arr[i] = +n.value; camSet(c, key, arr); }); return n; });
      target.append(el('div', { class: 'field' }, el('span', { text: key }), el('div', { class: 'vec' }, nums)));
    } else if (typeof val === 'boolean') {
      const cb = el('input', { type: 'checkbox' }); cb.checked = val;
      cb.addEventListener('change', () => camSet(c, key, cb.checked));
      target.append(el('label', { class: 'toggle' }, cb, el('span', { text: key })));
    } else {
      target.append(el('div', { class: 'row between small' }, el('span', { text: key }), el('span', { class: 'mono muted', text: String(val) })));
    }
  }
  box.append(more);
  updateCamFooter();
}

$('#tbCam').addEventListener('click', () => openCamPanel(!CAMS.open));
$('#btnCamClose').addEventListener('click', () => openCamPanel(false));
$('#btnCamLook').addEventListener('click', () => setCamLook(!CAMS.look));
$('#btnCamGrab').addEventListener('click', camGrab);
$('#camFile').addEventListener('change', ev => loadCamFile(ev.target.value));
$('#btnCamSave').addEventListener('click', async () => {
  try {
    const names = [];
    if (Object.keys(CAMS.edits).length) {
      const d = await api.post('/api/cam/save', { path: CAMS.path, edits: CAMS.edits });
      CAMS.list = d.cams; CAMS.edits = {}; names.push(d.path.split(/[\\/]/).pop());
    }
    if (CAMS.cockpit && Object.keys(CAMS.cpEdits).length) {
      const d = await api.post('/api/cockpit/save', { path: CAMS.cockpit.path, values: CAMS.cpEdits });
      CAMS.cockpit.values = d.values; CAMS.cpEdits = {}; names.push(d.path.split(/[\\/]/).pop());
    }
    renderCamPanel(); camUpdateScene();
    toast('Gespeichert: ' + names.join(', '));
  } catch (err) { toast(err.message, 'err'); }
});
window.addEventListener('keydown', ev => { if (ev.key === 'Escape' && CAMS.look) { setCamLook(false); ev.stopImmediatePropagation(); } }, true);

function camOnProject(p) {
  CAMS.path = null; CAMS.list = []; CAMS.edits = {}; CAMS.sel = 0; CAMS.look = false; CAMS.cockpit = null; CAMS.cpEdits = {};
  CAMS.av = null; CAMS.avDirty = false; CAMS.mirrorImg = null;
  $('#tbCam').classList.toggle('hidden', !(p.cams && p.cams.length));
  if (CAMS.open) openCamPanel(false);
  dashReset();
  if (typeof tgmOnProject === 'function') tgmOnProject(p); if (typeof clrOnProject === 'function') clrOnProject(p);
}
function cockpitOnEvent(m) {
  if (!CAMS.cockpit || normPath(m.path) !== normPath(CAMS.cockpit.path)) return;
  const apply = () => { CAMS.cockpit.values = m.values; CAMS.cpEdits = {}; renderCamPanel(); camUpdateScene();
    if (!Object.keys(DASH.edits).length) dashSetup(m); };
  if (Object.keys(CAMS.cpEdits).length) toast('cockpitinfo wurde außerhalb geändert.', 'warn', [['Neu laden', apply]], 0);
  else { apply(); toast('cockpitinfo neu geladen'); }
}
function camOnEvent(m) {
  if (!CAMS.path || normPath(m.path) !== normPath(CAMS.path)) return;
  const apply = () => { CAMS.list = m.cams; CAMS.edits = {}; renderCamPanel(); camUpdateScene(); };
  if (Object.keys(CAMS.edits).length) toast('CAM-Datei wurde außerhalb geändert.', 'warn', [['Neu laden', apply]], 0);
  else { apply(); toast('CAM neu geladen: ' + m.path.split(/[\\/]/).pop()); }
}

const sayBye = () => { try { navigator.sendBeacon('/api/bye', '{}'); } catch (e) { /* ignore */ } };
window.addEventListener('pagehide', sayBye);               // only when the page really goes (not on a cancelled close)

// unsaved changes: list for the close warning (browser / app window: beforeunload, own window: own dialog)
function rf2DirtyList() {
  const out = [];
  const fn = p => (p || '').split(/[\\/]/).pop();
  for (const ms of S.mats.values()) if (ms.dirty) out.push('Material: ' + ms.name + (ms.path ? ' (' + fn(ms.path) + ')' : ''));
  if (Object.keys(CAMS.edits).length) out.push('Kamera: ' + Object.keys(CAMS.edits).join(', ') + ' (' + fn(CAMS.path || '.cam') + ')');
  if (Object.keys(CAMS.cpEdits).length) out.push('Kamera – Sitz/Spiegel/Bezugspunkte: ' + Object.keys(CAMS.cpEdits).join(', ') + ' (' + fn(CAMS.cockpit && CAMS.cockpit.path) + ')');
  if (typeof DASH !== 'undefined' && Object.keys(DASH.edits).length) out.push('Display: ' + Object.keys(DASH.edits).join(', ') + ' (' + fn(DASH.path || 'cockpitinfo') + ')');
  if (S.gen && S.gen.dirty) out.push('Teile: GEN (' + fn(S.project && S.project.gen && S.project.gen.path) + ')');
  if (CAMS.avDirty) out.push('Spiegel: ' + ['L', 'C', 'R'].filter(k => CAMS.mp[k].some((v, i) => v !== [0, 0, 1][i])).map(k => MIRROR_KEYS[k]).join(', ') + ' (all_vehicles.ini)');
  if (typeof tgDirtyFiles === 'function') tgDirtyFiles().forEach(f => out.push('TGM: ' + f.t.name));
  if (typeof clrDirty === 'function' && clrDirty()) out.push('Freigang: Volleinschlag / Federweg (' + ((CLR.info && CLR.info.hdv) || 'HDV') + ')');
  return out;
}
window.rf2DirtyList = rf2DirtyList;
// own dialog, centred in the window (the own window asks via rf2AskQuit instead of closing)
function rf2AskQuit() {
  const items = rf2DirtyList();
  if (!items.length) { rf2Quit(); return; }
  if ($('#quitAsk')) return;
  const close = () => box.remove();
  const box = el('div', { class: 'modal', id: 'quitAsk', role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'quit-card' },
      el('div', { class: 'title', text: 'Nicht gespeicherte Änderungen' }),
      el('p', { class: 'muted', text: 'Diese Änderungen gehen beim Beenden verloren:' }),
      el('ul', { class: 'quit-list' }, items.map(t => el('li', { text: t }))),
      el('div', { class: 'row gap8 quit-btns' },
        el('button', { class: 'btn', text: 'Abbrechen', onclick: close }),
        el('button', { class: 'btn danger', text: 'Trotzdem beenden', onclick: () => { close(); rf2Quit(); } }))));
  box.addEventListener('click', ev => { if (ev.target === box) close(); });
  document.body.append(box);
  box.querySelector('.btn').focus();
}
window.rf2AskQuit = rf2AskQuit;
function rf2Quit() {
  if (window.RF2_HOST === 'webview2') fetch('/api/quit', { method: 'POST', body: '{}' });
  else window.close();
}
window.addEventListener('keydown', ev => { if (ev.key === 'Escape' && $('#quitAsk')) { $('#quitAsk').remove(); ev.stopImmediatePropagation(); } }, true);
window.addEventListener('beforeunload', ev => {
  if (window.RF2_HOST === 'webview2' || !rf2DirtyList().length) return;   // the own window asks with the own dialog
  ev.preventDefault(); ev.returnValue = '';                // the browser asks "Leave / Cancel"
});
let lastDirty = '[]';
setInterval(() => {                                        // tell the window / server which changes are unsaved
  const d = JSON.stringify(rf2DirtyList());
  if (d === lastDirty) return;
  lastDirty = d;
  fetch('/api/dirty', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: JSON.parse(d) }) }).catch(() => {});
}, 700);


// ------------------------------------------------- cockpit displays (cockpitinfo) ---
// <Name>Font / <Name>Background (= material name) / <Name>Scale / <Name>Offset / <Name>AlphaColor.
// Font bitmap: 10 columns, character = ASCII - 32 (space first).  Text is drawn onto the
// background texture of that material; RPMLED=<prefix> switches <prefix>01..31 (frame 1 = on).
const DASH_SAMPLES = { Gears: '3', Speed: '287', RPM: '11850', Place: '3', Laps: '12/57', BestLap: '1:23.456', LastLap: '1:24.012',
  LCD: 'MIX 2', DeltaPositive: '+0.234', DeltaNegative: '-0.118', BatteryLevelDigit: '87', FuelLevelDigit: '42', BrakeBias: '56',
  BrakeMap: '3', OilTempDigit: '105', WaterTempDigit: '98', BoostMotorTempDigit: '64', BoostDigit: '1.2', TCMap: '4', ABSMap: '2',
  EngineMixture: '2', BoostMap: '3', P2PMap: '1', Aids: 'TC', TTempLF: '92', TTempRF: '94', TTempLR: '96', TTempRR: '95',
  TPressLF: '1.8', TPressRF: '1.8', TPressLR: '1.7', TPressRR: '1.7', P2PActivationsThisLap: '2', P2PActiveTimeThisLap: '4.5' };
const DASH = { path: null, displays: [], leds: {}, values: {}, edits: {}, rpm: 0.7, open: false, pick: {}, fonts: new Map(), info: {},
  bgs: new Map(), rows: {},
  ledOn(i) { return i <= Math.round(this.rpm * 31); } };

function dashReset() {
  DASH.path = null; DASH.displays = []; DASH.leds = {}; DASH.edits = {}; DASH.pick = {};
  $('#tbDash').classList.add('hidden');
  if (DASH.open) openDashPanel(false);
}
function dashSetup(d) {
  DASH.path = d.path; DASH.displays = d.displays || []; DASH.leds = d.leds || {};
  for (const ms of S.mats.values()) { dashAttach(ms); refreshMaterial(ms); }
  const any = [...S.mats.values()].some(ms => ms.dash || ms.ledIndex != null);
  $('#tbDash').classList.toggle('hidden', !any);
  if (DASH.open) renderDashPanel();
}
function dashAttach(ms) {
  const n = (ms.name || '').toUpperCase();
  const list = DASH.displays.filter(x => x.background.toUpperCase() === n);
  // all readouts with this Background are drawn into the same texture (rF2);
  // DeltaPositive / DeltaNegative exclude each other (sign of the delta) -> show the picked one
  const delta = list.filter(x => /^Delta(Positive|Negative)$/i.test(x.name));
  const dPick = delta.find(x => x.name === DASH.pick[n]) || delta[0];
  ms.dashList = list.filter(x => !delta.includes(x) || x === dPick);
  ms.dash = ms.dashList[0] || null;
  ms.dashAlt = list;
  ms.ledIndex = null;
  const pre = (DASH.leds.RPMLED || '').toUpperCase();
  if (pre && n.startsWith(pre) && /^\d+$/.test(n.slice(pre.length))) ms.ledIndex = parseInt(n.slice(pre.length), 10);
  if (ms.dash) dashRender(ms);
  else ms.dashEntry = null;
}

const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('nicht gefunden: ' + src)); im.src = src; });
// gMotor font scanner (rFactor 2 / ModDev viewer): the bitmap carries its own grid.
//   grid colour = pixel (W-1,H-2), background = (W-2,H-2), cell tick = (W-3,H-2)
//   cell width/height = distance to the next grid pixel along row 1 / column 1
//   glyph width = position of the tick pixel in the top interior row of the cell
//   glyphs start at ' ' (0x20), at most 255; grid, tick and background become transparent
function dashScanFont(px, W, H) {
  const at = (x, y) => { const i = (y * W + x) * 4; return (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]; };
  if (W < 8 || H < 8) return null;
  const grid = at(W - 1, H - 2), back = at(W - 2, H - 2), tick = at(W - 3, H - 2);
  if (grid === back || grid === tick || tick === back) return null;
  let cw = 0, ch = 0;
  for (let x = 1; x < W; x++) if (at(x, 1) === grid) { cw = x; break; }
  for (let y = 1; y < H; y++) if (at(1, y) === grid) { ch = y; break; }
  if (cw < 3 || ch < 3) return null;
  const cols = Math.floor(W / cw), rows = Math.floor(H / ch);
  const glyphs = [];
  let found = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (glyphs.length >= 255) break;
    const x0 = c * cw + 1, y0 = r * ch + 1;
    let w = 0;
    while (w < cw && at(x0 + w, y0) !== tick) w++;
    if (w < cw) found++; else w = cw - 1;
    glyphs.push({ sx: x0, sy: y0, adv: Math.max(1, w) });
  }
  if (found < glyphs.length * 0.5) return null;
  for (let i = 0; i < W * H; i++) {
    const v = (px[i * 4] << 16) | (px[i * 4 + 1] << 8) | px[i * 4 + 2];
    if (v === grid || v === tick || v === back) px[i * 4 + 3] = 0;
  }
  return { cols, rows, cw: cw - 1, ch: ch - 1, glyphs, scanned: true };
}
// lossy copies (JPG, screenshots): find the grid lines by colour, no exact ticks
function dashGridFallback(px, W, H) {
  const col = (i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // background = most common colour, grid = colour of the left edge (if different)
  const hist = new Map();
  for (let i = 0; i < W * H; i += 7) { const c = col(i), k = (c[0] >> 4) << 8 | (c[1] >> 4) << 4 | (c[2] >> 4); hist.set(k, (hist.get(k) || 0) + 1); }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const back = [((top >> 8) & 15) * 16 + 8, ((top >> 4) & 15) * 16 + 8, (top & 15) * 16 + 8];
  let grid = null;
  { const cnt = new Map(); for (let y = 0; y < H; y++) { const c = col(y * W), k = c.join(','); cnt.set(k, (cnt.get(k) || 0) + 1); }
    const g = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    if (dist(g, back) > 60) grid = g; }
  const isGrid = (i) => grid && dist(col(i), grid) < 70;
  const lines = (n, m, idx) => {           // indices whose line is mostly grid colour
    const out = [];
    for (let a = 0; a < n; a++) { let k = 0; for (let b = 0; b < m; b++) if (isGrid(idx(a, b))) k++; if (k > m * 0.5) out.push(a); }
    const starts = out.filter((v, i) => i === 0 || out[i - 1] !== v - 1);
    starts.all = out;
    return starts;
  };
  let cols = 0, rows = 0, xs = [], ys = [];
  if (grid) {
    xs = lines(W, H, (x, y) => y * W + x); ys = lines(H, W, (y, x) => y * W + x);
    if (xs.length > 2) cols = Math.round(W / ((xs[xs.length - 1] - xs[0]) / (xs.length - 1)));
    if (ys.length > 2) rows = Math.round(H / ((ys[ys.length - 1] - ys[0]) / (ys.length - 1)));
  }
  const ink = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const c = col(i);
    let d = dist(c, back);
    if (grid) d = Math.min(d, dist(c, grid) * 1.4);
    ink[i] = Math.min(1, Math.max(0, d - 25) / 70) * (px[i * 4 + 3] / 255);
  }
  // blurred grid line edges: clear 3 px around every grid line
  const kill = (n, all, f) => { const m = new Uint8Array(n); for (const v of all || []) for (let d = -3; d <= 3; d++) if (v + d >= 0 && v + d < n) m[v + d] = 1; m.forEach((on, v) => { if (on) f(v); }); };
  kill(W, xs.all, x => { for (let y = 0; y < H; y++) ink[y * W + x] = 0; });
  kill(H, ys.all, y => ink.fill(0, y * W, y * W + W));
  return { ink, cols, rows };
}
// cockpitinfo <Name>AlphaColor=(a, r, g, b): rF2 packs it as 0xAARRGGBB into the vertex colour,
// which multiplies the font texels
function dashTint(px, color) {
  const [a, r, g, b] = color.length >= 4 ? color : [255, ...color];
  for (let i = 0; i < px.length; i += 4) {
    px[i] = px[i] * r / 255; px[i + 1] = px[i + 1] * g / 255; px[i + 2] = px[i + 2] * b / 255; px[i + 3] = px[i + 3] * a / 255;
  }
}
async function dashFont(name, color) {
  const key = (name + '|' + (color || '')).toLowerCase();
  if (DASH.fonts.has(key)) return DASH.fonts.get(key);
  const pr = (async () => {
    const im = await loadImg('/api/texpng?name=' + encodeURIComponent(name));
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
    const id = x.getImageData(0, 0, c.width, c.height), px = id.data;
    const scan = dashScanFont(px, c.width, c.height);
    if (scan) {
      if (color) dashTint(px, color);
      x.putImageData(id, 0, 0);
      return { canvas: c, ...scan };
    }
    // fallback (lossy copy without exact grid colours): grid lines by colour, else 10 columns
    const fb = dashGridFallback(px, c.width, c.height), ink = fb.ink;
    for (let i = 0; i < ink.length; i++) px[i * 4 + 3] = Math.round(ink[i] * 255);
    if (color) dashTint(px, color);
    x.putImageData(id, 0, 0);
    const ncol = fb.cols || 10;
    const rows = DASH.rows[name.toLowerCase()] || fb.rows || dashDetectRows(ink, c.width, c.height);
    const cw = c.width / ncol, ch = c.height / rows, glyphs = [];
    const ix = fb.cols ? Math.ceil(cw * 0.05) : 0, iy = fb.rows ? Math.ceil(ch * 0.04) : 0;   // skip blurred grid lines
    for (let i = 0; i < rows * ncol; i++) glyphs.push({ sx: (i % ncol) * cw + ix, sy: Math.floor(i / ncol) * ch + iy, adv: cw - 2 * ix });
    return { canvas: c, cols: ncol, rows, cw: cw - 2 * ix, ch: ch - 2 * iy, glyphs, scanned: false };
  })();
  DASH.fonts.set(key, pr);
  return pr;
}
// rows of the 10-column font grid: the row count whose cell borders cut the least ink
function dashDetectRows(ink, W, H) {
  const cw = W / 10;
  let best = { score: Infinity, r: Math.round(H / cw) || 1 };
  for (let r = 1; r <= 64; r++) {
    const ch = H / r;
    if (ch < cw * 0.6 || ch > cw * 3) continue;
    let s = 0, n = 0;
    for (let k = 1; k < r; k++) {
      const y = Math.round(k * ch);
      for (let yy = y - 1; yy <= y; yy++) { if (yy < 0 || yy >= H) continue; for (let xx = 0; xx < W; xx++) s += ink[yy * W + xx]; n += W; }
    }
    // the digit row must contain ink ('0' = cell 16)
    const y0 = Math.floor(Math.floor(16 / 10) * ch), x0 = Math.floor(6 * cw);
    let dig = 0;
    for (let yy = y0; yy < Math.min(H, y0 + ch); yy++) for (let xx = x0; xx < Math.min(W, x0 + cw); xx++) dig += ink[yy * W + xx];
    if (dig < cw * ch * 0.02) continue;
    const score = (n ? s / n : 0) + Math.abs(Math.log(ch / cw)) * 0.002;
    if (score < best.score) best = { score, r };
  }
  return best.r;
}
async function dashBg(ms) {
  const slot = ms.resolved.slots.find(x => x.role === 'albedoMap' && !x.off);
  const name = slot ? slot.tex.split(' ')[0] : ms.name;
  const key = name.toLowerCase();
  if (!DASH.bgs.has(key)) DASH.bgs.set(key, loadImg('/api/texpng?name=' + encodeURIComponent(name)).catch(() => null));
  return DASH.bgs.get(key);
}
// Exactly as rFactor 2 draws a readout:
//   target   = the Background texture itself (its pixel size W x H)
//   start    = (int(W * OffsetX), int(H * OffsetY))   left / top, no centring
//   font scale (font+0x680/0x684) = Scale
//   glyph i  : x = (start.x + sum of previous glyph widths + 0.5) * ScaleX
//              y = (start.y + 0.5) * ScaleY
//              w = glyph width (tick position) * ScaleX, h = (cellH - 1) * ScaleY
//              source = the whole cell (cellW-1 x cellH-1)
async function dashRender(ms) {
  const list = ms.dashList || (ms.dash ? [ms.dash] : []);
  if (!list.length) return;
  if (!ms.resolved) ms.resolved = RF2.resolve({ name: ms.name, shader: ms.gmtShader, stages: ms.stages, json: ms.json, gmtStd: ms.gmtStd });
  const token = (ms._dashTok = (ms._dashTok || 0) + 1);
  const bg = await dashBg(ms);
  const fonts = await Promise.all(list.map(d => dashFont(d.font, d.color).catch(() => null)));
  if (token !== ms._dashTok) return;
  const missing = list.filter((d, i) => !fonts[i]).map(d => d.font);
  ms.dashErr = missing.length ? 'Schrift fehlt: ' + missing.join(', ') : null;
  const BW = bg ? bg.width : 128, BH = bg ? bg.height : 128;   // rF2 pixel space = background texture
  const k = Math.max(1, Math.ceil(512 / Math.max(BW, BH)));  // canvas supersampling only
  const c = ms._dashCanvas || (ms._dashCanvas = document.createElement('canvas'));
  c.width = BW * k; c.height = BH * k;
  const x = c.getContext('2d');
  x.clearRect(0, 0, c.width, c.height);
  x.imageSmoothingEnabled = true;
  if (bg) x.drawImage(bg, 0, 0, c.width, c.height); else { x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); }
  const texts = [];
  list.forEach((d, n) => {
    const font = fonts[n];
    const text = String(DASH.values[d.name] ?? DASH_SAMPLES[d.name] ?? '88');
    texts.push(text);
    if (!font) return;
    const sc = d.scale || [1, 1], of = d.offset || [0, 0];
    let cx = Math.trunc(BW * of[0]);
    const cy = Math.trunc(BH * of[1]);
    const x0 = (cx + 0.5) * sc[0], y0 = (cy + 0.5) * sc[1];
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      const g = code >= 32 ? font.glyphs[code - 32] : null;
      if (!g) continue;
      const px = (cx + 0.5) * sc[0], py = (cy + 0.5) * sc[1];
      x.drawImage(font.canvas, g.sx, g.sy, font.cw, font.ch, px * k, py * k, g.adv * sc[0] * k, font.ch * sc[1] * k);
      cx += g.adv;
    }
    // where the text lands (rF2 pixels of the background) - shown in the Display panel
    const x1 = (cx + 0.5) * sc[0], y1 = y0 + font.ch * sc[1];
    const out = x0 >= BW || y0 >= BH || x1 <= 0 || y1 <= 0, part = !out && (x1 > BW + 0.5 || y1 > BH + 0.5);
    DASH.info[d.name] = { bw: BW, bh: BH, bgMissing: !bg, cw: font.cw, ch: font.ch, scanned: font.scanned, fontW: font.canvas.width,
      fontH: font.canvas.height, box: [x0, y0, x1, y1].map(v => Math.round(v)), out, part };
  });
  ms.dashEntry = R.canvasTexture('dash:' + ms.key, c);
  ms.dashText = texts.join(' | ');
  if (ms.gpu && ms.gpu.units[0] && ms.gpu.units[0].entry !== ms.dashEntry) refreshMaterial(ms);
  R.requestRender();
}
function dashRerender(name) {
  for (const ms of S.mats.values()) if (ms.dashList && ms.dashList.length && (!name || ms.dashList.some(d => d.name === name))) dashRender(ms);
}

function openDashPanel(on) {
  if (on && CAMS.open) openCamPanel(false);
  if (on && typeof tgClose === 'function') tgClose();
  if (on && typeof CLR !== 'undefined' && CLR.open) clrOpen(false);
  DASH.open = on;
  $('#dashPanel').classList.toggle('hidden', !on);
  $('#matPanel').classList.toggle('hidden', on || !S.project);
  $('#tbDash').classList.toggle('on', on);
  if (on) renderDashPanel();
}
function updateDashFooter() {
  const dirty = Object.keys(DASH.edits).length > 0;
  $('#btnDashSave').disabled = !dirty;
  $('#dashDot').className = 'dot ' + (dirty ? 'warn' : 'ok');
  $('#dashText').textContent = dirty ? 'Geändert – noch nicht in die cockpitinfo geschrieben' : 'Live – cockpitinfo wird überwacht';
}
function renderDashPanel() {
  const box = $('#dashEdit'); box.innerHTML = '';
  $('#dashFile').textContent = DASH.path ? DASH.path.split(/[\\/]/).pop() : '';
  // RPM LEDs
  const ledMats = [...S.mats.values()].filter(m => m.ledIndex != null).length;
  if (ledMats) {
    const out = el('span', { class: 'val', text: Math.round(DASH.rpm * 100) + ' %' });
    const rng = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: DASH.rpm, 'aria-label': 'Drehzahl für RPMLED' });
    rng.addEventListener('input', () => { DASH.rpm = +rng.value; out.textContent = Math.round(DASH.rpm * 100) + ' %'; stepAnimations(true); });
    box.append(el('section', { class: 'sec' }, el('div', { class: 'sec-h', text: 'RPMLED · ' + DASH.leds.RPMLED + ' (' + ledMats + ' LEDs)' }),
      el('div', { class: 'prm' }, el('div', { class: 'lbl' }, el('span', { text: 'Drehzahl' }), out), rng)));
  }
  const usedBg = new Set([...S.mats.values()].filter(m => m.dashList && m.dashList.length).map(m => m.name.toUpperCase()));
  for (const d of DASH.displays) {
    const bgU = d.background.toUpperCase();
    const ms = [...S.mats.values()].find(m => m.name.toUpperCase() === bgU);
    const active = !!(ms && ms.dashList && ms.dashList.includes(d));
    const card = el('section', { class: 'dash-card' + (usedBg.has(bgU) ? '' : ' off') });
    const head = el('div', { class: 'row between gap8' }, el('span', { class: 'title small-title', text: d.name }),
      el('span', { class: 'tag' + (ms ? ' ok' : ''), text: ms ? (active ? 'auf ' + d.background : 'verdeckt') : 'kein Mesh', title: d.font }));
    card.append(head);
    if (ms && !active) {
      card.append(el('button', { class: 'link-btn', text: 'Diese Anzeige auf ' + d.background + ' zeigen',
        onclick: () => { DASH.pick[bgU] = d.name; dashAttach(ms); refreshMaterial(ms); renderDashPanel(); } }));
    }
    if (ms && ms.dashErr && active) card.append(el('div', { class: 'err small', text: ms.dashErr }));
    const inf = DASH.info[d.name];
    if (ms && active && inf) {
      card.append(el('div', { class: 'small muted mono', text: `Hintergrund ${inf.bw}×${inf.bh}${inf.bgMissing ? ' (fehlt)' : ''} · Schrift ${inf.fontW}×${inf.fontH}, Zelle ${Math.round(inf.cw)}×${Math.round(inf.ch)}${inf.scanned ? '' : ' (ohne rF2-Raster)'} · Text x ${inf.box[0]}–${inf.box[2]}, y ${inf.box[1]}–${inf.box[3]}` }));
      if (inf.out) card.append(el('div', { class: 'err small', text: 'Text liegt komplett außerhalb des Hintergrunds' }));
      else if (inf.part) card.append(el('div', { class: 'warn small', text: 'Text ragt über den Hintergrund hinaus' }));
    }
    const val = el('input', { class: 'num', value: DASH.values[d.name] ?? DASH_SAMPLES[d.name] ?? '88', 'aria-label': d.name + ' Wert' });
    val.addEventListener('input', () => { DASH.values[d.name] = val.value; dashRerender(d.name); });
    card.append(el('div', { class: 'axis' }, el('span', { class: 'an', text: 'Text' }), val, el('span', { class: 'small muted mono', text: d.font.replace(/\.[^.]*$/, '') })));
    for (const [prop, labels, mn, mx] of [['scale', ['Scale X', 'Scale Y'], 0, 5], ['offset', ['Offset X', 'Offset Y'], -0.5, 1.5]]) {
      const cur = (d[prop] || (prop === 'scale' ? [1, 1] : [0, 0])).slice();
      labels.forEach((lab, i) => {
        const out = el('input', { class: 'num', type: 'number', step: 0.01, value: cur[i], 'aria-label': d.name + ' ' + lab });
        const rng = el('input', { type: 'range', min: Math.min(mn, cur[i]), max: Math.max(mx, cur[i]), step: 0.005, value: cur[i], 'aria-label': d.name + ' ' + lab });
        const apply = v => { const a = (d[prop] || cur).slice(); a[i] = v; d[prop] = a;
          DASH.edits[d.name + (prop === 'scale' ? 'Scale' : 'Offset')] = a; updateDashFooter(); dashRerender(d.name); };
        rng.addEventListener('input', () => { out.value = +(+rng.value).toFixed(3); apply(+rng.value); });
        out.addEventListener('change', () => { const v = +out.value; if (isFinite(v)) { rng.value = v; apply(v); } });
        card.append(el('div', { class: 'axis' }, el('span', { class: 'an', text: lab }), rng, out));
      });
    }
    box.append(card);
  }
  // font grid rows (auto detected) - override
  const fonts = [...new Set(DASH.displays.map(d => d.font))];
  const fs = el('details', { class: 'sec' }, el('summary', { class: 'sec-h', text: 'Schrift-Raster (nur ohne rF2-Raster, z. B. JPG)' }));
  fonts.forEach(f => {
    const inp = el('input', { class: 'num', type: 'number', min: 1, max: 64, step: 1, value: '', placeholder: 'auto', 'aria-label': 'Zeilen ' + f });
    dashFont(f).then(ft => { inp.value = ft.rows; }).catch(() => { inp.placeholder = 'fehlt'; });
    inp.addEventListener('change', () => { DASH.rows[f.toLowerCase()] = +inp.value || undefined;
      for (const k of [...DASH.fonts.keys()]) if (k.startsWith(f.toLowerCase() + '|')) DASH.fonts.delete(k); dashRerender(); });
    fs.append(el('div', { class: 'axis' }, el('span', { class: 'an mono', text: 'Zeilen' }), el('span', { class: 'mono small ellipsis', text: f }), inp));
  });
  box.append(fs);
  updateDashFooter();
}
$('#tbDash').addEventListener('click', () => openDashPanel(!DASH.open));
$('#btnDashClose').addEventListener('click', () => openDashPanel(false));
$('#btnDashSave').addEventListener('click', async () => {
  try {
    const d = await api.post('/api/cockpit/save', { path: DASH.path, values: DASH.edits });
    DASH.edits = {}; updateDashFooter(); toast('Gespeichert: ' + d.path.split(/[\\/]/).pop());
  } catch (err) { toast(err.message, 'err'); }
});
