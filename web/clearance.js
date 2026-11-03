// Clearance check: steer the front wheels and compress / extend the suspension like in the game (kinematics of
// the UltraChassis / .pm links, see rf2core/clearance.py), the wheel meshes move along, contacts with the car are
// marked red (inside tyre / rim), orange (closer than 5 mm).
'use strict';

const CLR = { open: false, info: null, steer: 0, bf: 0, br: 0, marks: true, res: null, busy: false, again: false, sweep: null, moved: new Set(),
  edit: null, orig: null, margin: 5, lockAngles: null, ground: true, k: 1, anim: 0 };

function clrPop() {
  let p = $('#clrPop');
  if (!p) {
    p = el('aside', { id: 'clrPop', class: 'panel mat clr-pop hidden', role: 'dialog', 'aria-label': 'Freigang' });
    document.body.append(p);
  }
  return p;
}
function clrSlider(label, min, max, step, val, unit, onInput, ticks, snap) {
  const out = el('input', { class: 'num', type: 'number', step, value: val, 'aria-label': label });
  const rng = el('input', { type: 'range', min, max, step, value: val, 'aria-label': label, title: 'Doppelklick = 0' });
  // snap: values within ±snap jump to 0, so the centre is easy to hit with the mouse
  rng.addEventListener('input', () => { if (snap && Math.abs(+rng.value) <= snap) rng.value = 0; out.value = rng.value; onInput(+rng.value); });
  rng.addEventListener('dblclick', () => { if (min <= 0 && max >= 0) { rng.value = 0; out.value = 0; onInput(0); } });
  out.addEventListener('change', () => { const v = Math.max(min, Math.min(max, +out.value)); if (isFinite(v)) { rng.value = v; out.value = v; onInput(v); } });
  const row = el('div', { class: 'axis clr-axis' }, el('span', { class: 'an', text: label }), rng, el('span', { class: 'row gap4' }, out, el('span', { class: 'small muted', text: unit })));
  return { row, set: v => { rng.value = v; out.value = v; } };
}
// ------------------------------------------------------------- edit state ---
// CLR.edit: full lock (rack mm or lock degrees) and per axle wheel travel to the stops (mm, both positive):
// up / down = corner bump / rebound stop, up3 / down3 = third (heave) spring. CLR.orig = values of the HDV.
function clrEditFromInfo(inf) {
  const e = inf && inf.edit;
  if (!e) return null;
  const ax = a => {
    const c = e.corners[a + 'L'] || e.corners[a + 'R'], t = e.third[a];
    return { up: c ? c.up : null, down: c ? -c.down : null, up3: t ? t.up : null, down3: t ? -t.down : null };
  };
  return { mode: e.steer.mode, rack: e.steer.mode === 'table' ? e.steer.rack : null, lock: e.steer.mode === 'range' ? e.steer.lock : null,
    variants: false, travel: { F: ax('F'), R: ax('R') } };
}
function clrDirty() { return !!(CLR.edit && CLR.orig && JSON.stringify(CLR.edit) !== JSON.stringify(CLR.orig)); }
window.clrDirty = clrDirty;
// travel limits used by the sliders' stop buttons and "check all extremes": corner stop and heave stop, the tighter
// only stops with a spring (BumpStopSpring > 0) stop the wheel in the game; without spring they are ignored here too
function clrLimits(a) {
  const t = CLR.edit && CLR.edit.travel[a];
  if (!t) return { up: 40, down: 40 };
  const sp = clrSprings(a);
  const m = (x, y) => (x == null ? y : y == null ? x : Math.min(x, y));
  const up = m(sp.corner || !sp.third ? t.up : null, sp.third ? t.up3 : null);
  return { up: Math.max(0, up ?? 40), down: Math.max(0, m(t.down, t.down3) ?? 40) };
}
function clrSprings(a) {
  const e = CLR.info && CLR.info.edit;
  const c = e && (e.corners[a + 'L'] || e.corners[a + 'R']), t = e && e.third[a];
  return { corner: !!(c && c.spring), third: !!(t && t.spring) };
}
function clrOffsets(a) {
  const e = CLR.info && CLR.info.edit;
  if (!e) return null;
  const l = e.corners[a + 'L'], r = e.corners[a + 'R'], t = e.third[a];
  if (!l || l.offset == null) return null;
  const f = v => (v == null ? '–' : v.toFixed(1) + 'mm');
  return `${a}: ${f(l.offset)}  ${f(t && t.offset)}  ${f(r && r.offset)}`;
}
function clrQuery() {
  const e = CLR.edit;
  if (!e) return '';
  return e.mode === 'table' && e.rack != null ? '&rack=' + e.rack : e.mode === 'range' && e.lock != null ? '&lock=' + e.lock : '';
}
function clrNum(val, step, label, onChange, w = 64) {
  const inp = el('input', { class: 'num', type: 'number', step, value: val ?? '', 'aria-label': label, style: 'width:' + w + 'px' });
  inp.addEventListener('change', () => { const v = +inp.value; if (isFinite(v) && inp.value !== '') onChange(v); });
  return inp;
}
function clrEditChanged(rerender = true) {
  if (rerender) clrRender();
  else clrFooter();
  clrPose();
}

function clrRender() {
  const p = clrPop(); p.innerHTML = '';
  const inf = CLR.info;
  p.append(el('div', { class: 'row between' }, el('span', { class: 'pop-title', text: 'Freigang: Lenkung + Federweg' }),
    el('button', { class: 'icon-btn small', 'aria-label': 'Schließen', onclick: () => clrOpen(false) }, icon('x', 14))));
  if (!inf) { p.append(el('div', { class: 'small muted', text: 'Lade Radaufhängung …' })); return; }
  if (!inf.ok) { p.append(el('div', { class: 'err small', text: (inf.notes || []).join(' ') || 'Keine Daten' })); return; }
  const E = CLR.edit;
  p.append(el('div', { class: 'small muted', text: [inf.source || 'keine Aufhängung', inf.hdv].filter(Boolean).join(' · ') }));
  for (const n of inf.notes || []) p.append(el('div', { class: 'warn small', text: n }));
  // ---- car on its wheels (the static pose of the HDV lifts the body instead of sinking the wheels into the floor)
  const gr = el('input', { type: 'checkbox', checked: CLR.ground });
  gr.addEventListener('change', () => { CLR.ground = gr.checked; clrApply(); clrLiftText(); });
  p.append(el('label', { class: 'toggle small', title: 'An: die Räder bleiben am Boden, die Karosserie hebt / senkt / neigt sich (wie im Spiel). Aus: die Karosserie bleibt in der GMT-Lage, die Räder bewegen sich.' },
    gr, el('span', { text: 'Auto steht auf den Rädern (Karosserie bewegt sich)' })));
  p.append(el('div', { class: 'small muted', id: 'clrLift' }));
  clrLiftText();
  // ---- steering
  const st = clrSlider('Lenkung', -100, 100, 1, Math.round(CLR.steer * 100), '%', v => { CLR.steer = v / 100; clrPose(); }, null, 3);
  p.append(st.row);
  const go = v => { CLR.steer = v; st.set(Math.round(v * 100)); clrPose(); };
  p.append(el('div', { class: 'row gap8 clr-btns' },
    el('button', { class: 'btn small-btn', text: '◀ voll links', onclick: () => go(1) }),
    el('button', { class: 'btn small-btn', text: 'gerade', onclick: () => go(0) }),
    el('button', { class: 'btn small-btn', text: 'voll rechts ▶', onclick: () => go(-1) })));
  // ---- full lock (editable)
  if (E && E.mode) {
    const sec = el('section', { class: 'clr-sec' }, el('div', { class: 'sec-h', text: 'Volleinschlag (HDV)' }));
    const ang = el('span', { class: 'mono small', id: 'clrLockAng', text: clrAngText(CLR.lockAngles || inf.lockAngles) });
    if (E.mode === 'table') {
      // upper end = what the steering links reach (further the tie rod goes over centre)
      const max = inf.rackMax ? Math.max(inf.rackMax, E.rack || 0) : Math.max(40, Math.ceil((CLR.orig.rack || 20) * 2.5));
      const sl = clrSlider('Zahnstange ±', 0, max, 0.1, E.rack, 'mm', v => { E.rack = +v; clrEditChanged(false); });
      sec.append(sl.row);
      if (inf.rackMax) sec.append(el('div', { class: 'small muted', text: `Lenkgeometrie: höchstens ±${inf.rackMax} mm (weiter geht die Spurstange über den Totpunkt)` }));
    } else {
      const sl = clrSlider('Radwinkel', 0, 60, 0.1, E.lock, '°', v => { E.lock = +v; clrEditChanged(false); });
      sec.append(sl.row);
    }
    sec.append(el('div', { class: 'row gap8 small' }, el('span', { class: 'muted', text: 'ergibt' }), ang));
    const margin = clrNum(CLR.margin, 0.5, 'Abstand', v => { CLR.margin = Math.max(0, v); }, 52);
    sec.append(el('div', { class: 'row gap8 clr-fit' },
      el('button', { class: 'btn small-btn', text: 'Bis zur Berührung', title: 'Größter Einschlag, bei dem beide Vorderräder in beide Richtungen den Abstand halten – geprüft ausgefedert, statisch und eingefedert bis zu den Anschlägen unten', onclick: clrFitSteer }),
      el('span', { class: 'small muted', text: 'Abstand' }), margin, el('span', { class: 'small muted', text: 'mm' })));
    if (E.mode === 'table' && inf.edit.steer.variants) {
      const cb = el('input', { type: 'checkbox', checked: E.variants });
      cb.addEventListener('change', () => { E.variants = cb.checked; clrFooter(); });
      sec.append(el('label', { class: 'toggle small' }, cb, el('span', { text: `Setup-Varianten mit eigener Tabelle (SteerLockSpecial, ${inf.edit.steer.variants}×) im gleichen Verhältnis mitändern` })));
    } else if (E.mode === 'range') {
      sec.append(el('div', { class: 'small muted', text: 'Ohne SteeringInnerTable: Radwinkel aus SteerLockRange (für die aktuelle SteerLockSetting).' }));
    }
    p.append(sec);
  }
  // ---- travel
  const tsec = el('section', { class: 'clr-sec' }, el('div', { class: 'sec-h', text: 'Federweg' }),
    el('div', { class: 'small muted', text: '+ = einfedern (Rad nach oben), − = ausfedern' }));
  for (const [a, name, key] of [['F', 'Vorne', 'bf'], ['R', 'Hinten', 'br']]) {
    const sl = clrSlider(name, -80, 80, 1, Math.round(CLR[key]), 'mm', v => { CLR[key] = v; clrPose(); });
    tsec.append(sl.row);
    const t = E && E.travel[a];
    if (!t || t.up == null) continue;
    const lim = clrLimits(a);
    const upBtn = el('button', { class: 'chip-btn', title: 'Zum Anschlag einfedern', text: '⤒ ' + lim.up + ' mm', onclick: () => { CLR[key] = lim.up; sl.set(lim.up); clrPose(); } });
    const dnBtn = el('button', { class: 'chip-btn', title: 'Zum Anschlag ausfedern', text: '⤓ ' + lim.down + ' mm', onclick: () => { CLR[key] = -lim.down; sl.set(-lim.down); clrPose(); } });
    const grid = el('div', { class: 'clr-trv' },
      el('span', { class: 'small muted', text: 'Anschlag Rad' }),
      el('span', { class: 'small', text: 'ein' }), clrNum(t.up, 0.5, name + ' einfedern bis Anschlag', v => { t.up = v; clrEditChanged(); }),
      el('span', { class: 'small', text: 'aus' }), clrNum(t.down, 0.5, name + ' ausfedern bis Anschlag', v => { t.down = v; clrEditChanged(); }));
    if (t.up3 != null) grid.append(
      el('span', { class: 'small muted', text: '3. Feder (Heave)' }),
      el('span', { class: 'small', text: 'ein' }), clrNum(t.up3, 0.5, name + ' 3. Feder einfedern', v => { t.up3 = v; clrEditChanged(); }),
      el('span', { class: 'small', text: 'aus' }), clrNum(t.down3, 0.5, name + ' 3. Feder ausfedern', v => { t.down3 = v; clrEditChanged(); }));
    const spr = clrSprings(a);
    if (!spr.corner) grid.append(el('span', { class: 'small warn clr-span', text: 'Rad-Anschlag ohne Federkraft (BumpStopSpring = 0) – hält im Spiel nichts auf, zählt hier nicht.' }));
    tsec.append(grid, el('div', { class: 'row gap8 clr-fit' }, upBtn, dnBtn, el('span', { class: 'grow' }),
      el('button', { class: 'btn small-btn', text: 'Bis zur Berührung', title: 'Größter Federweg nach oben ohne Berührung (vorne gerade und bei Volleinschlag), mit dem Abstand oben – setzt den Rad-Anschlag', onclick: () => clrFitBump(a) })));
  }
  if (E && E.travel.F.up != null) {
    tsec.append(el('div', { class: 'small muted', text: 'Wege am Rad ab der statischen Lage (0 = Auto steht, Standard-Abstimmung: RideHeight, Packer, Sturz). Die Anschläge wirken im Spiel auf die Pushrod; umgerechnet über die Kinematik.' }));
    const of = [clrOffsets('F'), clrOffsets('R')].filter(Boolean);
    if (of.length) tsec.append(el('div', { class: 'small muted mono', title: 'Zum Vergleich mit ModDev: Strg+K (zweite Seite) „Bumpstop Offsets“ – links, 3. Feder, rechts', text: 'Bumpstop Offsets (Strg+K): ' + of.join(' · ') }));
  }
  p.append(tsec);
  const mk = el('input', { type: 'checkbox', checked: CLR.marks });
  mk.addEventListener('change', () => { CLR.marks = mk.checked; clrMarks(); });
  p.append(el('label', { class: 'toggle small' }, mk, el('span', { text: 'Berührungen markieren (rot = im Reifen / in der Felge, orange = unter 5 mm)' })));
  // ---- results per wheel
  const box = el('div', { class: 'clr-res', id: 'clrRes' });
  p.append(box);
  clrRenderRes();
  p.append(el('div', { class: 'row gap8' },
    el('button', { class: 'btn small-btn', text: 'Alle Extreme prüfen', title: 'Lenkung von voll links bis voll rechts, jeweils bis zum Anschlag ausgefedert / statisch / bis zum Anschlag eingefedert', onclick: clrSweep }),
    el('span', { class: 'grow' }),
    el('button', { class: 'btn small-btn', text: 'Zurücksetzen', title: 'Stellung zurück: gerade, statisch', onclick: () => { CLR.steer = 0; CLR.bf = 0; CLR.br = 0; CLR.sweep = null; clrRender(); clrPose(); } })));
  const sw = el('div', { id: 'clrSweep', class: 'clr-res' });
  p.append(sw);
  clrRenderSweep();
  p.append(el('div', { class: 'small muted', text: 'Hindernisse: alle sichtbaren Teile außer den Rädern selbst. Die Anlenkpunkte am Radträger (6 cm) zählen nicht.' }));
  // ---- save
  if (E && E.mode) {
    p.append(el('div', { class: 'small muted', text: 'Weniger Einschlag = größerer Wendekreis (enge Kurven, Haarnadeln). Andere Anschläge ändern das Fahrverhalten über die Federwege.' }));
    p.append(el('footer', { class: 'row gap8 clr-foot' }, el('span', { id: 'clrState', class: 'small muted grow' }),
      el('button', { class: 'btn small-btn', id: 'btnClrRevert', text: 'Verwerfen', onclick: () => { CLR.edit = JSON.parse(JSON.stringify(CLR.orig)); CLR.lockAngles = null; clrEditChanged(); } }),
      el('button', { class: 'btn primary small-btn', id: 'btnClrSave', text: 'In HDV speichern', onclick: clrSave })));
    clrFooter();
  }
}
function clrAngText(a) {
  return a && a.FL != null ? `FL ${Math.abs(a.FL).toFixed(1)}° · FR ${Math.abs(a.FR).toFixed(1)}°` : '–';
}
function clrFooter() {
  const d = clrDirty();
  const sv = $('#btnClrSave'), rv = $('#btnClrRevert'), stt = $('#clrState');
  if (sv) sv.disabled = !d;
  if (rv) rv.disabled = !d;
  if (stt) stt.textContent = d ? 'Geändert – noch nicht in der HDV' : (CLR.info && CLR.info.hdv ? CLR.info.hdv : '');
}
async function clrFitSteer() {
  const lf = clrLimits('F');
  try {
    loading(true, 'Suche den größten Einschlag …');
    const r = await api.get(`/api/clear/fit?what=steer&margin=${CLR.margin}&bumps=${-lf.down},0,${lf.up}`);
    const E = CLR.edit;
    if (r.blocked) { toast('Schon in Mittelstellung zu eng – kein Einschlag ohne Berührung möglich', 'warn'); return; }
    if (E.mode === 'table') E.rack = r.rack;
    else E.lock = Math.max(Math.abs(r.lockAngles.FL || 0), Math.abs(r.lockAngles.FR || 0));
    CLR.lockAngles = r.lockAngles;
    if (!r.limit) toast('Bis zum Ende des Suchbereichs keine Berührung', 'warn');
    else toast(r.reason === 'links' ? 'Begrenzt durch die Lenkgeometrie: weiter geht die Spurstange über den Totpunkt' : 'Begrenzt durch: ' + (r.parts || []).join(', '), r.reason === 'links' ? 'warn' : 'ok', [], 7000);
    clrEditChanged();
  } catch (err) { toast(err.message, 'err'); }
  finally { loading(false); }
}
async function clrFitBump(a) {
  try {
    loading(true, 'Suche den größten Federweg …');
    const r = await api.get(`/api/clear/fit?what=bump&axle=${a}&margin=${CLR.margin}${clrQuery()}`);
    if (r.blocked) { toast('Schon in statischer Lage zu eng', 'warn'); return; }
    CLR.edit.travel[a].up = r.up;
    if (!r.limit) toast('Bis 150 mm keine Berührung', 'warn');
    else toast(r.reason === 'links' ? 'Begrenzt durch die Radaufhängung (Lenker am Ende)' : 'Begrenzt durch: ' + (r.parts || []).join(', '), r.reason === 'links' ? 'warn' : 'ok', [], 7000);
    clrEditChanged();
  } catch (err) { toast(err.message, 'err'); }
  finally { loading(false); }
}
async function clrSave() {
  const E = CLR.edit, O = CLR.orig;
  const body = { variants: E.variants, travel: {} };
  if (E.mode === 'table' && E.rack !== O.rack) body.rack = E.rack;
  if (E.mode === 'range' && E.lock !== O.lock) body.lock = E.lock;
  for (const a of ['F', 'R']) {
    const t = {}, e = E.travel[a], o = O.travel[a];
    for (const k of ['up', 'down', 'up3', 'down3']) if (e[k] != null && e[k] !== o[k]) t[k] = e[k];
    if (Object.keys(t).length) body.travel[a] = t;
  }
  try {
    loading(true, 'Schreibe die HDV …');
    const r = await api.post('/api/clear/save', body);
    CLR.info = r.info;
    CLR.edit = clrEditFromInfo(r.info); CLR.orig = JSON.parse(JSON.stringify(CLR.edit)); CLR.lockAngles = null;
    if (typeof histRebase === 'function') histRebase();
    clrRender(); clrPose();
    toast(r.changed.length ? `Gespeichert: ${r.path.split(/[\\/]/).pop()} (${r.changed.length} Zeilen${r.bak ? ', Sicherung .bak' : ''})` : 'Nichts geändert');
  } catch (err) { toast(err.message, 'err'); }
  finally { loading(false); }
}
const clrWheelName = { FL: 'VL', FR: 'VR', RL: 'HL', RR: 'HR' };
function clrGapCls(w) {
  if (!w || w.free || w.gap == null) return 'ok';
  if (w.gap < 0 || (w.hits && w.hits.length)) return 'bad';
  if (w.gap < 5) return 'warn';
  return w.gap < 15 ? 'mid' : 'ok';
}
function clrRenderRes() {
  const box = $('#clrRes'); if (!box) return;
  box.innerHTML = '';
  const res = CLR.res;
  if (!res || !res.wheels) return;
  for (const c of ['FL', 'FR', 'RL', 'RR']) {
    const w = res.wheels[c]; if (!w) continue;
    const cls = w.invalid ? 'bad' : clrGapCls(w);
    const gap = w.invalid ? 'Lenker am Ende' : w.free || w.gap == null ? 'frei (> 5 cm)' : w.hits && w.hits.length ? 'Berührung' : w.gap.toFixed(1) + ' mm';
    const row = el('div', { class: 'clr-row ' + cls },
      el('b', { text: c }), el('span', { class: 'mono small', text: `Lenkw. ${w.angle >= 0 ? '+' : ''}${w.angle.toFixed(1)}° · Sturz ${w.camber.toFixed(1)}°` }),
      el('span', { class: 'grow' }), el('span', { class: 'clr-gap mono', text: gap }));
    box.append(row);
    if (w.invalid) box.append(el('div', { class: 'small err clr-parts', text: 'Die Radaufhängung erreicht diese Stellung nicht (Spurstange / Lenker über den Totpunkt).' }));
    else if (!w.free && w.gap != null && !(w.parts && w.parts.length) && w.nearest) box.append(el('div', { class: 'small muted clr-parts', text: 'nächstes Teil: ' + w.nearest }));
    if (w.parts && w.parts.length) box.append(el('div', { class: 'small err clr-parts', text: w.parts.map(x => `${x.name}: ${x.n} Punkte, bis ${x.depth} mm tief`).join(' · ') }));
  }
}
function clrRenderSweep() {
  const box = $('#clrSweep'); if (!box) return;
  box.innerHTML = '';
  const s = CLR.sweep;
  if (!s) return;
  if (s === 'busy') { box.append(el('div', { class: 'small muted', text: 'Prüfe alle Stellungen …' })); return; }
  box.append(el('div', { class: 'small', text: 'Engste Stelle je Rad (Lenkung × Federweg):' }));
  for (const c of ['FL', 'FR', 'RL', 'RR']) {
    const w = s.worst[c];
    if (!w) { box.append(el('div', { class: 'clr-row ok' }, el('b', { text: c }), el('span', { class: 'grow' }), el('span', { class: 'clr-gap mono', text: 'frei' }))); continue; }
    const bad = w.gap < 0 || (w.parts && w.parts.length);
    const row = el('button', { class: 'clr-row link ' + (bad ? 'bad' : w.gap < 5 ? 'warn' : w.gap < 15 ? 'mid' : 'ok'), title: 'Diese Stellung zeigen',
      onclick: () => { CLR.steer = w.steer; if (c[0] === 'F') CLR.bf = w.bump; else CLR.br = w.bump; clrRender(); clrPose(); } },
      el('b', { text: c }), el('span', { class: 'mono small', text: `Lenkung ${Math.round(w.steer * 100)} % · Federweg ${w.bump > 0 ? '+' : ''}${w.bump} mm` }),
      el('span', { class: 'grow' }), el('span', { class: 'clr-gap mono', text: bad ? 'Berührung' : w.gap.toFixed(1) + ' mm' }));
    box.append(row);
  }
}
async function clrSweep() {
  CLR.sweep = 'busy'; clrRenderSweep();
  try {
    const lf = clrLimits('F'), lr = clrLimits('R');
    CLR.sweep = await api.get(`/api/clear/sweep?fu=${lf.up}&fd=${-lf.down}&ru=${lr.up}&rd=${-lr.down}${clrQuery()}`);
  } catch (err) { CLR.sweep = null; toast(err.message, 'err'); }
  clrRenderSweep();
}
// one request at a time; while it runs the newest slider value waits
async function clrPose() {
  if (!CLR.open) return;
  if (CLR.busy) { CLR.again = true; return; }
  CLR.busy = true;
  try {
    const r = await api.get(`/api/clear/pose?steer=${CLR.steer}&bf=${CLR.bf}&br=${CLR.br}${clrQuery()}`);
    if (CLR.open) { CLR.res = r; if (r.lockAngles) { CLR.lockAngles = r.lockAngles; const a = $('#clrLockAng'); if (a) a.textContent = clrAngText(r.lockAngles); } if (CLR.first) { CLR.first = false; CLR.k = 0; clrAnimate(1); clrFirstToast(r); } else clrApply();
      clrRenderRes(); clrLiftText(); }
  } catch (err) { toast(err.message, 'err'); }
  finally {
    CLR.busy = false;
    if (CLR.again) { CLR.again = false; clrPose(); }
  }
}
// k = 0..1 blends from the GMT pose to the computed pose (smooth transition when opening / closing / toggling)
const clrI = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const clrLerp = (m, k) => (k >= 1 ? m : m.map((v, i) => clrI[i] + (v - clrI[i]) * k));
function clrBody() { const r = CLR.res; return CLR.ground && r && r.body ? r.body : null; }
function clrApply() {
  const res = CLR.res, k = CLR.k;
  const now = new Set();
  // always applied: slider 0 = the static car (ride height of the HDV)
  if (res && res.wheels) for (const w of Object.values(res.wheels)) {
    for (const id of w.moving || []) { R.setPartXf(id, clrLerp(w.xf, k)); now.add(id); }
    if (w.def) for (const id of w.susp || []) { R.setPartXf(id, clrLerp(w.xfSusp || w.xf, k), w.def); now.add(id); }   // wishbones: deformed like in rF2
  }
  for (const id of CLR.moved) if (!now.has(id)) R.setPartXf(id, null);
  CLR.moved = now;
  const b = clrBody();
  R.setBodyXf(b && k > 0 ? clrLerp(b, k) : null);
  clrMarks();
}
// animate CLR.k towards the target (open: 1, closing: 0); body toggle: blend the body only
function clrAnimate(to = 1, done) {
  const from = to ? 0 : 1, t0 = performance.now(), dur = 450, id = ++CLR.anim;
  const step = now => {
    if (id !== CLR.anim) return;
    const x = Math.min(1, (now - t0) / dur), e = x * x * (3 - 2 * x);
    CLR.k = from + (to - from) * e; clrApply();
    if (x < 1) setTimeout(() => step(performance.now()), 16); else if (done) done();
  };
  setTimeout(() => step(performance.now()), 0);
}
function clrLiftText() {
  const d = $('#clrLift'); if (!d) return;
  const r = CLR.res, l = r && r.lift;
  if (!l) { d.textContent = ''; return; }
  const ax = a => { const v = [l[a + 'L'], l[a + 'R']].filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const f = ax('F'), b = ax('R'), fmt = v => (v > 0 ? '+' : '') + v.toFixed(1) + ' mm';
  d.textContent = CLR.ground
    ? `Karosserie gegenüber der GMT-Lage: vorn ${fmt(f)}, hinten ${fmt(b)} (Fahrhöhe der HDV + Federweg) – die Räder bleiben am Boden.`
    : `Räder gegenüber der GMT-Lage: vorn ${fmt(-f)}, hinten ${fmt(-b)} – die Karosserie bleibt stehen.`;
}
function clrMarks() {
  const res = CLR.res;
  if (!CLR.open || !CLR.marks || !res || !res.wheels) { R.setMarks(null, null); return; }
  const pos = [], col = [];
  const s = 0.006;
  const B = clrBody();
  const add = (p0, c) => {
    const p = B ? [B[0] * p0[0] + B[4] * p0[1] + B[8] * p0[2] + B[12], B[1] * p0[0] + B[5] * p0[1] + B[9] * p0[2] + B[13], B[2] * p0[0] + B[6] * p0[1] + B[10] * p0[2] + B[14]] : p0;
    for (const ax of [[s, 0, 0], [0, s, 0], [0, 0, s]]) {
      pos.push(p[0] - ax[0], p[1] - ax[1], p[2] - ax[2], p[0] + ax[0], p[1] + ax[1], p[2] + ax[2]);
      col.push(...c, ...c);
    }
  };
  for (const w of Object.values(res.wheels)) {
    for (const p of w.near || []) add(p, [1, 0.6, 0.1, 1]);
    for (const p of w.hits || []) add(p, [1, 0.15, 0.15, 1]);
  }
  R.setMarks(new Float32Array(pos), new Float32Array(col));
}
async function clrOpen(on) {
  CLR.open = on;
  const p = clrPop();
  p.classList.toggle('hidden', !on);
  $('#tbClr').classList.toggle('on', on);
  if (!on) {
    R.setMarks(null, null);
    // back to the GMT pose smoothly, then drop the transforms
    clrAnimate(0, () => { if (CLR.open) return; for (const id of CLR.moved) R.setPartXf(id, null); CLR.moved = new Set(); R.setBodyXf(null); });
    if (S.project && !(typeof TG !== 'undefined' && TG.open) && !CAMS.open && !DASH.open) $('#matPanel').classList.remove('hidden');
    return;
  }
  if (typeof tgClose === 'function') tgClose();
  if (CAMS.open) openCamPanel(false);
  if (DASH.open) openDashPanel(false);
  $('#matPanel').classList.add('hidden');
  clrRender();
  if (!CLR.info) {
    try {
      loading(true, 'Lese Radaufhängung …'); CLR.info = await api.get('/api/clear/info');
      CLR.edit = clrEditFromInfo(CLR.info); CLR.orig = CLR.edit && JSON.parse(JSON.stringify(CLR.edit));
      if (typeof histRebase === 'function') histRebase();
    }
    catch (err) { CLR.info = { ok: false, notes: [err.message] }; }
    finally { loading(false); }
    clrRender();
  }
  CLR.first = true;
  clrPose();
}
// say once per project what happens, so the moving car is no surprise
function clrFirstToast(r) {
  if (CLR.told || !r || !r.lift) return;
  CLR.told = true;
  const l = r.lift, f = ((l.FL || 0) + (l.FR || 0)) / 2, b = ((l.RL || 0) + (l.RR || 0)) / 2;
  if (Math.abs(f) < 0.5 && Math.abs(b) < 0.5) return;
  toast(CLR.ground ? `Freigang zeigt das Auto in der statischen Lage der HDV: Karosserie vorn ${f.toFixed(1)} mm, hinten ${b.toFixed(1)} mm höher als im GMT. Abschaltbar oben im Panel.`
    : `Freigang zeigt die Räder in der statischen Lage der HDV (vorn ${(-f).toFixed(1)} mm, hinten ${(-b).toFixed(1)} mm).`, 'ok', [], 9000);
}
function clrOnProject(p) {
  if (CLR.open) clrOpen(false);
  Object.assign(CLR, { info: null, res: null, sweep: null, steer: 0, bf: 0, br: 0, moved: new Set(), edit: null, orig: null, lockAngles: null, told: false, k: 1 });
  CLR.anim++; R.setBodyXf(null);
  $('#tbClr').classList.toggle('hidden', !p);
}
(() => {
  const b = el('button', { class: 'tb hidden', id: 'tbClr', title: 'Freigang: Vorderräder einlenken, Räder ein- / ausfedern – wo berühren Reifen und Felge das Auto?', text: 'Freigang' });
  $('#tbTgm').after(b);
  b.addEventListener('click', () => clrOpen(!CLR.open));
  window.addEventListener('keydown', ev => { if (ev.key === 'Escape' && CLR.open && !document.querySelector('.modal')) { clrOpen(false); } });
})();

if (typeof I18N !== 'undefined' && I18N.extend) I18N.extend({
  'Freigang': 'Clearance', 'Doppelklick = 0': 'Double-click = 0',
  'Auto steht auf den Rädern (Karosserie bewegt sich)': 'Car stands on its wheels (body moves)',
  'An: die Räder bleiben am Boden, die Karosserie hebt / senkt / neigt sich (wie im Spiel). Aus: die Karosserie bleibt in der GMT-Lage, die Räder bewegen sich.': 'On: the wheels stay on the ground, the body rises / lowers / tilts (as in the game). Off: the body stays in the GMT position, the wheels move.', 'Freigang: Lenkung + Federweg': 'Clearance: steering + suspension travel', 'Lenkung': 'Steering', 'Vorne': 'Front', 'Hinten': 'Rear',
  '◀ voll links': '◀ full left', 'gerade': 'straight', 'voll rechts ▶': 'full right ▶', 'Lade Radaufhängung …': 'Loading suspension …', 'Lese Radaufhängung …': 'Reading suspension …',
  'Federweg: + = einfedern (Rad nach oben), − = ausfedern': 'Travel: + = bump (wheel up), − = droop',
  'Berührungen markieren (rot = im Reifen / in der Felge, orange = unter 5 mm)': 'Mark contacts (red = inside tyre / rim, orange = closer than 5 mm)',
  'Alle Extreme prüfen': 'Check all extremes',
  'Volleinschlag (HDV)': 'Full lock (HDV)', 'Zahnstange ±': 'Rack ±', 'Radwinkel': 'Wheel angle', 'ergibt': 'gives', 'Abstand': 'Gap',
  'Bis zur Berührung': 'Up to contact', 'Federweg': 'Suspension travel', '+ = einfedern (Rad nach oben), − = ausfedern': '+ = bump (wheel up), − = droop',
  'Anschlag Rad': 'Wheel stop',
  'Rad-Anschlag ohne Federkraft (BumpStopSpring = 0) – hält im Spiel nichts auf, zählt hier nicht.': 'Wheel stop without spring (BumpStopSpring = 0) – stops nothing in the game, ignored here.',
  'Wege am Rad ab der statischen Lage (0 = Auto steht, Standard-Abstimmung: RideHeight, Packer, Sturz). Die Anschläge wirken im Spiel auf die Pushrod; umgerechnet über die Kinematik.': 'Wheel travel from the static position (0 = car standing, default setup: ride height, packers, camber). In the game the stops act on the pushrod; converted through the kinematics.',
  'Zum Vergleich mit ModDev: Strg+K (zweite Seite) „Bumpstop Offsets“ – links, 3. Feder, rechts': 'Compare with ModDev: Ctrl+K (second page) "Bumpstop Offsets" – left, 3rd spring, right', 'ein': 'bump', 'aus': 'droop', '3. Feder (Heave)': '3rd spring (heave)', 'Zum Anschlag einfedern': 'Compress to the stop', 'Zum Anschlag ausfedern': 'Extend to the stop',
  'Verwerfen': 'Discard', 'Schreibe die HDV …': 'Writing the HDV …', 'In HDV speichern': 'Save to HDV', 'Geändert – noch nicht in der HDV': 'Changed – not yet in the HDV', 'Nichts geändert': 'Nothing changed',
  'Suche den größten Einschlag …': 'Searching the largest lock …', 'Suche den größten Federweg …': 'Searching the largest travel …',
  'Schon in Mittelstellung zu eng – kein Einschlag ohne Berührung möglich': 'Already too tight when straight – no lock without contact possible',
  'Bis zum Ende des Suchbereichs keine Berührung': 'No contact up to the end of the search range', 'Schon in statischer Lage zu eng': 'Already too tight at static ride height',
  'Bis 150 mm keine Berührung': 'No contact up to 150 mm', 'Lenker am Ende': 'Links at their end',
  'Die Radaufhängung erreicht diese Stellung nicht (Spurstange / Lenker über den Totpunkt).': 'The suspension cannot reach this position (tie rod / link over centre).',
  'Begrenzt durch die Lenkgeometrie: weiter geht die Spurstange über den Totpunkt': 'Limited by the steering geometry: further the tie rod goes over centre',
  'Begrenzt durch die Radaufhängung (Lenker am Ende)': 'Limited by the suspension (links at their end)', 'Stellung zurück: gerade, statisch': 'Position back: straight, static',
  'Ohne SteeringInnerTable: Radwinkel aus SteerLockRange (für die aktuelle SteerLockSetting).': 'Without SteeringInnerTable: wheel angle from SteerLockRange (for the current SteerLockSetting).',
  'Größter Einschlag, bei dem beide Vorderräder in beide Richtungen den Abstand halten – geprüft ausgefedert, statisch und eingefedert bis zu den Anschlägen unten': 'Largest lock at which both front wheels keep the gap in both directions – checked extended, static and compressed up to the stops below',
  'Größter Federweg nach oben ohne Berührung (vorne gerade und bei Volleinschlag), mit dem Abstand oben – setzt den Rad-Anschlag': 'Largest bump travel without contact (front: straight and at full lock), with the gap above – sets the wheel stop',
  'Lenkung von voll links bis voll rechts, jeweils bis zum Anschlag ausgefedert / statisch / bis zum Anschlag eingefedert': 'Steering from full left to full right, each extended to the stop / static / compressed to the stop',
  'Wege ab statischer Lage, mit RideHeight und Packern der Standard-Abstimmung (RideHeightSetting / PackerSetting der HDV). Mit den Spurstangen und Lenkern bleiben Sturz und Spur echt.': 'Travel from the static position, with ride height and packers of the default setup (RideHeightSetting / PackerSetting of the HDV). Links and tie rods keep camber and toe real.',
  'Weniger Einschlag = größerer Wendekreis (enge Kurven, Haarnadeln). Andere Anschläge ändern das Fahrverhalten über die Federwege.': 'Less lock = larger turning circle (tight corners, hairpins). Other stops change the handling through the travel.',
  'Prüfe alle Stellungen …': 'Checking all positions …', 'Engste Stelle je Rad (Lenkung × Federweg):': 'Tightest spot per wheel (steering × travel):',
  'Diese Stellung zeigen': 'Show this position', 'Keine Daten': 'No data', 'keine Aufhängung': 'no suspension',
  'Hindernisse: alle sichtbaren Teile außer den Rädern selbst. Die Anlenkpunkte am Radträger (6 cm) zählen nicht.': 'Obstacles: every visible part except the wheels themselves. The link mounts at the upright (6 cm) do not count.',
  'Freigang: Vorderräder einlenken, Räder ein- / ausfedern – wo berühren Reifen und Felge das Auto?': 'Clearance: steer the front wheels, compress / extend the suspension – where do tyre and rim touch the car?',
  'Lenkung von voll links bis voll rechts, jeweils ausgefedert / statisch / eingefedert mit den Federwegen oben (mindestens ±40 mm)': 'Steering from full left to full right, each extended / static / compressed with the travel above (at least ±40 mm)',
}, [
  [/^Volleinschlag: FL (.*) · FR (.*)$/, 'Full lock: FL $1 · FR $2'], [/^Lenkw\. (.*) · Sturz (.*)$/, 'Steer $1 · camber $2'],
  [/^Lenkung (.*) % · Federweg (.*)$/, 'Steering $1 % · travel $2'],
  [/^Karosserie gegenüber der GMT-Lage: vorn (.*), hinten (.*) \(Fahrhöhe der HDV \+ Federweg\) – die Räder bleiben am Boden\.$/, 'Body relative to the GMT position: front $1, rear $2 (ride height of the HDV + travel) – the wheels stay on the ground.'],
  [/^Räder gegenüber der GMT-Lage: vorn (.*), hinten (.*) – die Karosserie bleibt stehen\.$/, 'Wheels relative to the GMT position: front $1, rear $2 – the body stays put.'],
  [/^Freigang zeigt das Auto in der statischen Lage der HDV: Karosserie vorn (.*) mm, hinten (.*) mm höher als im GMT\. Abschaltbar oben im Panel\.$/, 'Clearance shows the car in the static position of the HDV: body $1 mm (front) and $2 mm (rear) higher than in the GMT. Can be switched off at the top of the panel.'],
  [/^Freigang zeigt die Räder in der statischen Lage der HDV \(vorn (.*) mm, hinten (.*) mm\)\.$/, 'Clearance shows the wheels in the static position of the HDV (front $1 mm, rear $2 mm).'], [/^nächstes Teil: (.*)$/, 'nearest part: $1'], [/^Bumpstop Offsets \(Strg\+K\): (.*)$/, 'Bumpstop Offsets (Ctrl+K): $1'], [/^Begrenzt durch: (.*)$/, 'Limited by: $1'],
  [/^Setup-Varianten mit eigener Tabelle \(SteerLockSpecial, (\d+)×\) im gleichen Verhältnis mitändern$/, 'Also change the setup variants with their own table (SteerLockSpecial, $1×) in the same ratio'],
  [/^Gespeichert: (.*) \((\d+) Zeilen(, Sicherung \.bak)?\)$/, (m, a, b, c) => `Saved: ${a} (${b} lines${c ? ', backup .bak' : ''})`],
  [/^(Vorne|Hinten) (einfedern bis Anschlag|ausfedern bis Anschlag|3\. Feder einfedern|3\. Feder ausfedern)$/, (m, a, b) => (a === 'Vorne' ? 'Front ' : 'Rear ') + ({ 'einfedern bis Anschlag': 'bump to stop', 'ausfedern bis Anschlag': 'droop to stop', '3. Feder einfedern': '3rd spring bump', '3. Feder ausfedern': '3rd spring droop' })[b]], [/^(.*): (\d+) Punkte, bis (.*) mm tief$/, '$1: $2 points, up to $3 mm deep'],
]);
