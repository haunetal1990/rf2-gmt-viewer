// Editing the scene like a GEN: undo (Ctrl+Z), right-click menu (hide / properties / delete), GMTs dragged into the
// window, GEN properties of a mesh, saving the GEN. Uses the globals of app.js (S, R, el, api, toast ...).
'use strict';

// undo / redo: history.js (undoPush(label, undo, redo))

// visibility changed by the user (eye, menu): undoable
async function userSetVisible(ids, on) {
  const before = ids.map(id => [id, (S.parts.get(id) || {}).visible]);
  await setVisible(ids, on);
  undoPush(on ? 'Einblenden' : 'Ausblenden', async () => {
    for (const [id, v] of before) await setVisible([id], !!v);
  }, () => setVisible(ids, on));
}

// --------------------------------------------------------- GEN edit state ---
// S.gen: deleted part ids, property changes per part {key: value | null}, instance of new parts
function genReset() { S.gen = { deleted: new Set(), props: {}, inst: {}, dirty: false }; genFooter(); }
function genDirty() { S.gen.dirty = true; genFooter(); }
function genFooter() {
  const b = $('#btnGenSave');
  if (!b) return;
  const g = S.gen || {};
  const n = (g.deleted ? g.deleted.size : 0) + Object.keys(g.props || {}).length +
    [...S.parts.values()].filter(p => p.added && !(g.deleted && g.deleted.has(p.id))).length;
  b.classList.toggle('hidden', !S.project);
  const noGen = S.project && !(S.project.gen && S.project.gen.path);
  b.disabled = !n && !noGen;
  b.textContent = n ? 'GEN speichern (' + n + ')' : 'GEN speichern';
}

function deleteParts(ids, noUndo) {
  ids = ids.filter(id => S.parts.has(id) && !S.gen.deleted.has(id));
  if (!ids.length) return;
  const before = ids.map(id => [id, S.parts.get(id).visible]);
  for (const id of ids) {
    S.gen.deleted.add(id);
    const p = S.parts.get(id);
    p.deleted = true; p.visible = false; R.setVisible(id, false);
    if (S.sel === id) select(null);
  }
  genDirty(); renderPartList(); updateStats();
  if (noUndo) return;
  undoPush(ids.length > 1 ? ids.length + ' Teile löschen' : 'Löschen von ' + S.parts.get(ids[0]).name, async () => {
    for (const [id, v] of before) {
      S.gen.deleted.delete(id);
      const p = S.parts.get(id);
      if (p) { p.deleted = false; await setVisible([id], !!v); }
    }
    genDirty(); renderPartList();
  }, () => deleteParts(ids, true));
}

// ------------------------------------------------------------ right click ---
let CTX = null;
function closeCtx() { if (CTX) { CTX.remove(); CTX = null; } }
function openCtx(x, y, id) {
  closeCtx();
  const p = S.parts.get(id);
  if (!p) return;
  if (S.sel !== id && !p.missing) select(id);
  const item = (text, fn, cls) => el('button', { class: 'ctx-item' + (cls ? ' ' + cls : ''), text, onclick: () => { closeCtx(); fn(); } });
  CTX = el('div', { class: 'ctx', role: 'menu' },
    el('div', { class: 'ctx-h', text: p.name }),
    item(p.visible ? 'Ausblenden' : 'Einblenden', () => userSetVisible([id], !p.visible)),
    item('Eigenschaften …', () => openProps(id)),
    item('Löschen', () => deleteParts([id]), 'danger'));
  document.body.append(CTX);
  const r = CTX.getBoundingClientRect();
  CTX.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  CTX.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
window.addEventListener('pointerdown', ev => { if (CTX && !CTX.contains(ev.target)) closeCtx(); }, true);
window.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeCtx(); closeProps(); } });
R.onContext = (hit, ev) => {
  if (!hit) { closeCtx(); return; }
  // right click selects exactly like a left click (part + the material under the mouse), then opens the menu
  if (hit.side) S.mirrorSide = hit.side;
  const part = R.parts.get(hit.partId);
  select(hit.partId, part && part.groups[hit.group] ? hit.group : null);
  openCtx(ev.clientX, ev.clientY, hit.partId);
};

// -------------------------------------------------------------- properties ---
// every key the rF2 scene loader reads on a MeshFile line (as in the game), plus the vehicle keys
const GEN_PROPS = [
  { k: 'LODIn', t: 'num', d: '0', h: 'Ab dieser Entfernung (m) sichtbar' },
  { k: 'LODOut', t: 'num', d: '500', h: 'Bis zu dieser Entfernung (m) sichtbar, Standard 10.000' },
  { k: 'Render', t: 'bool', d: 'True', h: 'False = nicht gezeichnet (z. B. Kollisions-Mesh)' },
  { k: 'CollTarget', t: 'bool', d: 'False', h: 'Kollisions-Ziel für die Physik' },
  { k: 'HATTarget', t: 'bool', d: 'False', h: 'Höhen-Ziel (HAT) für die Physik' },
  { k: 'ShadowCaster', t: 'shadow', d: '(True, Solid)', h: 'Wirft Schatten: (True|Dynamic|Static, Solid|Texture[, Breite, Höhe])' },
  { k: 'ShadowReceiver', t: 'bool', d: 'True', h: 'Empfängt Schatten (Fahrzeug)' },
  { k: 'ShadowObject', t: 'shadow', d: '(True, Solid)', h: 'Schattenobjekt' },
  { k: 'ShadowGroups', t: 'text', d: '(1)', h: 'Schattengruppen, z. B. (14)' },
  { k: 'AmbientCaster', t: 'text', d: 'True', h: 'Ambient-Occlusion-Werfer' },
  { k: 'AmbientObject', t: 'text', d: '(True, Texture)', h: 'Ambient-Objekt' },
  { k: 'Reflect', t: 'choice', d: 'True', o: ['True', 'False', 'NoLOD'], h: 'In Spiegelungen sichtbar (NoLOD = ohne LOD-Wechsel)' },
  { k: 'Deformable', t: 'bool', d: 'False', h: 'Verformbar' },
  { k: 'Damageable', t: 'bool', d: 'False', h: 'Beschädigbar' },
  { k: 'NoHDRLum', t: 'bool', d: 'True', h: 'Ohne HDR-Leuchtdichte (z. B. Innenspiegel)' },
  { k: 'ZBias', t: 'num', d: '0', h: 'Tiefen-Versatz gegen Z-Fighting' },
  { k: 'Visible', t: 'bool', d: 'True', h: 'Sichtbar' },
  { k: 'SeparateSurface', t: 'bool', d: 'True', h: 'Eigene Oberfläche' },
];
let PROPS = null;
function closeProps() { if (PROPS) { PROPS.remove(); PROPS = null; } }
function partKv(p) {
  const base = (p.gen && p.gen.kv) || {};
  const out = {};
  for (const k in base) if (k.toLowerCase() !== 'meshfile') out[k] = base[k];
  const ch = (S.gen.props || {})[p.id] || {};
  for (const k in ch) { const hk = Object.keys(out).find(x => x.toLowerCase() === k.toLowerCase()) || k;
    if (ch[k] === null) delete out[hk]; else { if (hk !== k) delete out[hk]; out[k] = ch[k]; } }
  return out;
}
function openProps(id) {
  closeProps();
  const p = S.parts.get(id);
  if (!p) return;
  const kv = partKv(p);
  const get = k => { const hk = Object.keys(kv).find(x => x.toLowerCase() === k.toLowerCase()); return hk ? kv[hk] : undefined; };
  const work = {};                                      // key -> value | null (removed)
  const rows = GEN_PROPS.map(def => {
    const cur = get(def.k);
    const on = el('input', { type: 'checkbox', 'aria-label': def.k + ' setzen' }); on.checked = cur !== undefined;
    let inp;
    const val = cur !== undefined ? cur : def.d;
    if (def.t === 'bool') {
      inp = el('select', { class: 'sel small' }, ['True', 'False'].map(o => el('option', { value: o, text: o, selected: String(val).toLowerCase() === o.toLowerCase() })));
    } else if (def.t === 'choice') {
      inp = el('select', { class: 'sel small' }, def.o.map(o => el('option', { value: o, text: o, selected: String(val).toLowerCase() === o.toLowerCase() })));
    } else if (def.t === 'num') {
      inp = el('input', { class: 'num', type: 'number', step: 'any', value: String(val).replace(/[()]/g, '') });
    } else {
      inp = el('input', { class: 'txt', type: 'text', value: val });
    }
    inp.disabled = !on.checked;
    const fmt = () => def.t === 'num' && ['LODIn', 'LODOut'].includes(def.k) ? '(' + (inp.value || 0) + ')' : inp.value;
    const upd = () => { inp.disabled = !on.checked; work[def.k] = on.checked ? fmt() : null; };
    on.addEventListener('change', upd); inp.addEventListener('change', upd); inp.addEventListener('input', upd);
    return el('label', { class: 'pp-row', title: def.h }, on, el('span', { class: 'pp-k', text: def.k }), inp);
  });
  const other = Object.keys(kv).filter(k => !GEN_PROPS.some(d => d.k.toLowerCase() === k.toLowerCase()));
  const instIn = el('input', { class: 'txt', type: 'text', value: S.gen.inst[id] || (p.gen && p.gen.inst) || p.group || '' });
  const free = p.added || !p.gen || p.gen.line == null;     // no GEN line yet: instance can be chosen
  instIn.disabled = !free;
  const g = p.gen || {};
  const info = [
    ['GMT', p.name + '.gmt'], ['Datei', p.file],
    ['Instanz', (p.chain || []).slice().reverse().join(' › ') || p.group || '–'],
    ['GEN-Zeile', g.line != null ? String(g.line + 1) + ' · ' + ((S.project.gen && S.project.gen.path) || '').split(/[\\/]/).pop() : (p.added ? 'neu (noch nicht in der GEN)' : '–')],
  ];
  PROPS = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'modal-card pp-card' },
      el('header', { class: 'pp-head' }, el('span', { class: 'title', text: 'Eigenschaften' }),
        el('button', { class: 'icon-btn small', 'aria-label': 'Schließen', onclick: closeProps }, icon('x', 14))),
      el('div', { class: 'pp-body' },
        el('div', { class: 'pp-info' }, info.map(([a, b]) => el('div', { class: 'pp-i' }, el('span', { class: 'muted', text: a }), el('span', { class: 'mono', text: b, title: b })))),
        free ? el('label', { class: 'pp-row' }, el('span'), el('span', { class: 'pp-k', text: 'Instance' }), instIn) : null,
        el('div', { class: 'sec-h', text: 'GEN-Eigenschaften (Kästchen = steht in der Zeile)' }),
        el('div', { class: 'pp-grid' }, rows),
        other.length ? el('div', { class: 'small muted', text: 'Weitere Einträge der Zeile: ' + other.map(k => k + '=' + kv[k]).join('  ') }) : null),
      el('footer', { class: 'pp-foot' },
        el('span', { class: 'small muted grow', text: S.project.gen && S.project.gen.path ? 'Wird beim Speichern der GEN geschrieben.' : 'Wird in eine neue GEN geschrieben.' }),
        el('button', { class: 'btn', text: 'Abbrechen', onclick: closeProps }),
        el('button', { class: 'btn primary', text: 'Übernehmen', onclick: () => {
          const prevP = S.gen.props[id] ? { ...S.gen.props[id] } : undefined, prevI = S.gen.inst[id];
          const ch = { ...(S.gen.props[id] || {}) };
          for (const k in work) {
            const orig = get(k);
            if (work[k] === null && orig === undefined) delete ch[k];
            else if (work[k] !== null && orig !== undefined && String(orig) === String(work[k])) delete ch[k];
            else ch[k] = work[k];
          }
          if (Object.keys(ch).length) S.gen.props[id] = ch; else delete S.gen.props[id];
          if (free && instIn.value.trim()) S.gen.inst[id] = instIn.value.trim();
          genDirty(); closeProps();
          const nextP = S.gen.props[id] ? { ...S.gen.props[id] } : undefined, nextI = S.gen.inst[id];
          const setP = (pp, ii) => {
            if (pp) S.gen.props[id] = { ...pp }; else delete S.gen.props[id];
            if (ii === undefined) delete S.gen.inst[id]; else S.gen.inst[id] = ii;
            genDirty();
          };
          undoPush('Eigenschaften von ' + p.name, () => setP(prevP, prevI), () => setP(nextP, nextI));
        } }))));
  document.body.append(PROPS);
  PROPS.addEventListener('pointerdown', ev => { if (ev.target === PROPS) closeProps(); });
}

// ------------------------------------------------------------- drag & drop ---
// files from the Explorer: textures / JSON first (so new GMTs find them), then GMTs -> new parts
function dropOverlay(on) {
  let o = $('#dropHint');
  if (on && !o) { o = el('div', { id: 'dropHint', class: 'drop-hint', text: 'GMT, DDS oder JSON hier ablegen' }); document.body.append(o); }
  if (!on && o) o.remove();
}
let dragDepth = 0;
window.addEventListener('dragenter', ev => { if (S.project && [...(ev.dataTransfer.types || [])].includes('Files')) { dragDepth++; dropOverlay(true); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropOverlay(false); } });
window.addEventListener('dragover', ev => { if ([...(ev.dataTransfer.types || [])].includes('Files')) ev.preventDefault(); });
window.addEventListener('drop', async ev => {
  ev.preventDefault(); dragDepth = 0; dropOverlay(false);
  if (!S.project) { toast('Erst ein Auto, eine GEN oder eine GMT öffnen', 'err'); return; }
  const files = [...(ev.dataTransfer.files || [])];
  files.sort((a, b) => (/\.gmt$/i.test(a.name) ? 1 : 0) - (/\.gmt$/i.test(b.name) ? 1 : 0));
  const newIds = [];
  let tex = 0;
  for (const f of files) {
    try {
      loading(true, 'Lade ' + f.name + ' …');
      const r = await fetch('/api/part/add?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      if (j.kind === 'tex') { tex++; continue; }
      const part = j.part;
      S.parts.set(part.id, { ...part, loaded: false, loading: false });
      newIds.push(part.id);
    } catch (err) { toast(f.name + ': ' + err.message, 'err', [], 8000); }
  }
  loading(false);
  if (newIds.length) {
    await loadParts(newIds, newIds.length > 3);
    genDirty(); renderPartList(); updateStats();
    undoPush(newIds.length + ' GMT hinzufügen', () => {
      for (const id of newIds) { R.removePart(id); S.parts.delete(id); if (S.sel === id) select(null); }
      genDirty(); renderPartList(); updateStats();
    });
    toast(newIds.length + ' GMT hinzugefügt' + (tex ? ', ' + tex + ' Textur(en)' : '') + ' – mit „GEN speichern“ übernehmen');
  } else if (tex) toast(tex + ' Textur(en) übernommen – gilt für Teile, die danach geladen werden');
});

// --------------------------------------------------------------- save GEN ---
function openGenSave() {
  closeProps();
  const gp = S.project.gen && S.project.gen.path;
  const hasGen = !!gp && (S.project.kind === 'veh' || S.project.kind === 'gen');
  const name = hasGen ? gp.split(/[\\/]/).pop() : 'neu.gen';
  const target = el('input', { class: 'txt grow', type: 'text', value: hasGen ? name.replace(/\.gen$/i, '_neu.gen') : name });
  const over = el('input', { type: 'checkbox' });
  const copy = el('input', { type: 'checkbox' }); copy.checked = true;
  over.addEventListener('change', () => { if (over.checked && hasGen) target.value = name; });
  const added = [...S.parts.values()].filter(p => p.added && !S.gen.deleted.has(p.id));
  PROPS = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'modal-card pp-card' },
      el('header', { class: 'pp-head' }, el('span', { class: 'title', text: hasGen ? 'GEN speichern' : 'Neue GEN erstellen' }),
        el('button', { class: 'icon-btn small', 'aria-label': 'Schließen', onclick: closeProps }, icon('x', 14))),
      el('div', { class: 'pp-body' },
        el('div', { class: 'small muted', text: hasGen ? 'Quelle: ' + gp + ' – nur die geänderten Zeilen werden angepasst, Kommentare und Tokens bleiben.'
          : 'Alle Teile, die nicht gelöscht sind, kommen in Instance=SLOT<ID> (oder in die Instanz aus den Eigenschaften).' }),
        el('label', { class: 'pp-row' }, el('span'), el('span', { class: 'pp-k', text: 'Datei' }), target),
        el('div', { class: 'small muted', text: 'Ohne Pfad: im Ordner ' + (hasGen ? 'der GEN' : 'der GMT') + '.' }),
        hasGen ? el('label', { class: 'toggle small' }, over, el('span', { text: 'Original überschreiben (Sicherung als .bak)' })) : null,
        added.length ? el('label', { class: 'toggle small' }, copy, el('span', { text: added.length + ' hineingezogene GMT in den Ordner der GEN kopieren' })) : null,
        el('div', { class: 'small muted', text: S.gen.deleted.size + ' gelöscht · ' + Object.keys(S.gen.props).length + ' geändert · ' + added.length + ' neu' })),
      el('footer', { class: 'pp-foot' }, el('span', { class: 'grow' }),
        el('button', { class: 'btn', text: 'Abbrechen', onclick: closeProps }),
        el('button', { class: 'btn primary', text: 'Speichern', onclick: async () => {
          try {
            const r = await api.post('/api/gen/save', { target: target.value, overwrite: over.checked || !hasGen,
              deleted: [...S.gen.deleted], props: S.gen.props, inst: S.gen.inst, copyNew: copy.checked });
            closeProps();
            toast('Gespeichert: ' + r.path.split(/[\\/]/).pop() + (r.copied.length ? ' · kopiert: ' + r.copied.join(', ') : ''), 'ok', [], 7000);
            if (hasGen && over.checked) await reopenAfterSave();
          } catch (err) { toast(err.message, 'err', [], 8000); }
        } }))));
  document.body.append(PROPS);
}
// the original was overwritten: read it again (line numbers changed), keep the view and the upgrade levels
async function reopenAfterSave() {
  const u = S.project.upgrades;
  const sel = {};
  if (u) for (const t of u.types) sel[t.name] = t.selected;
  const { project } = await api.post('/api/open', { path: S.project.path, upgrades: u ? sel : {}, genMode: u ? u.genMode : null });
  await showProject(project, true);
}

$('#btnGenSave').addEventListener('click', openGenSave);
