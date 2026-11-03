'use strict';
// Free camera: settings popup (speed, mouse, soft movement, exit key) and a clean full screen view - only the car,
// no menus - e.g. to record a video with an external tool.
const FC = { speed: 1, look: 1, smooth: 0, exitCode: 'Escape', exitName: 'Esc', hideGrid: false, cursor: 'auto', on: false, waitKey: false };
const FC_MOVE = /^(KeyW|KeyA|KeyS|KeyD|KeyQ|KeyE|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|ShiftLeft|ShiftRight|ControlLeft|ControlRight)$/;

function fcLoad() {
  try { Object.assign(FC, JSON.parse(localStorage.getItem('rf2FreeCam') || '{}'), { on: false, waitKey: false }); } catch (e) { /* no storage */ }
  fcPush();
}
function fcSave() {
  try { localStorage.setItem('rf2FreeCam', JSON.stringify({ speed: FC.speed, look: FC.look, smooth: FC.smooth, exitCode: FC.exitCode, exitName: FC.exitName, hideGrid: FC.hideGrid, cursor: FC.cursor })); } catch (e) { /* no storage */ }
}
function fcPush() { R.fly.speed = FC.speed; R.fly.look = FC.look; R.fly.smooth = FC.smooth; }
function fcKeyName(ev) {
  if (ev.key === 'Escape') return 'Esc';
  if (ev.key === ' ') return 'Leertaste';
  if (/^F\d+$/.test(ev.key)) return ev.key;
  if (ev.key && ev.key.length === 1) return ev.key.toUpperCase();
  return ev.key || ev.code;
}

function fcPop() {
  let p = $('#fcPop');
  if (p) return p;
  p = el('div', { id: 'fcPop', class: 'panel pop hidden', role: 'dialog', 'aria-label': 'Freie Kamera' });
  document.body.append(p);
  return p;
}
// slider on a log scale: value = 2^x
function fcSlider(label, val, min, max, on) {
  const out = el('span', { class: 'mono small', text: '×' + val.toFixed(2) });
  const rng = el('input', { type: 'range', min: Math.log2(min), max: Math.log2(max), step: 0.01, value: Math.log2(val), 'aria-label': label, title: 'Doppelklick = ×1' });
  const set = v => { out.textContent = '×' + v.toFixed(2); on(v); };
  rng.addEventListener('input', () => { let v = Math.pow(2, +rng.value); if (Math.abs(Math.log2(v)) < 0.06) { v = 1; rng.value = 0; } set(v); });
  rng.addEventListener('dblclick', () => { rng.value = 0; set(1); });
  return el('label', { class: 'field' }, el('span', { class: 'row between' }, el('span', { text: label }), out), rng);
}
function fcRender() {
  const p = fcPop(); p.innerHTML = '';
  p.append(el('div', { class: 'pop-title', text: 'Freie Kamera' }));
  p.append(el('div', { class: 'small muted', text: 'Rechte (oder linke) Maustaste halten und ziehen = umsehen · WASD bewegen, Q/E runter/hoch · Shift schnell, Strg langsam · Mausrad vor/zurück' }));
  p.append(fcSlider('Geschwindigkeit', FC.speed, 0.05, 8, v => { FC.speed = v; fcPush(); fcSave(); }));
  p.append(fcSlider('Maus-Empfindlichkeit', FC.look, 0.1, 4, v => { FC.look = v; fcPush(); fcSave(); }));
  const sm = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: FC.smooth, 'aria-label': 'Weiche Bewegung' });
  const smOut = el('span', { class: 'mono small', text: FC.smooth ? Math.round(FC.smooth * 100) + ' %' : 'aus' });
  sm.addEventListener('input', () => { FC.smooth = +sm.value; smOut.textContent = FC.smooth ? Math.round(FC.smooth * 100) + ' %' : 'aus'; fcPush(); fcSave(); });
  p.append(el('label', { class: 'field', title: 'Anfahren und Abbremsen weich statt sofort – ruhigere Kamerafahrten für Videos' },
    el('span', { class: 'row between' }, el('span', { text: 'Weiche Bewegung' }), smOut), sm));
  // exit key
  const kb = el('button', { class: 'btn small-btn', id: 'fcKeyBtn', text: FC.waitKey ? 'Taste drücken …' : FC.exitName });
  kb.addEventListener('click', () => { FC.waitKey = true; kb.textContent = 'Taste drücken …'; });
  p.append(el('div', { class: 'row between' }, el('span', { class: 'small', text: 'Vollbild verlassen mit' }), kb));
  const gr = el('input', { type: 'checkbox', checked: FC.hideGrid });
  gr.addEventListener('change', () => { FC.hideGrid = gr.checked; fcSave(); });
  p.append(el('label', { class: 'toggle small' }, gr, el('span', { text: 'Bodengitter im Vollbild ausblenden' })));
  const cs = el('select', { 'aria-label': 'Mauszeiger im Vollbild' },
    ...[['auto', 'nach 1,5 s ausblenden'], ['show', 'immer anzeigen'], ['hide', 'nie anzeigen']].map(([v, t]) => el('option', { value: v, text: t, selected: FC.cursor === v })));
  cs.addEventListener('change', () => { FC.cursor = cs.value; fcSave(); });
  p.append(el('label', { class: 'row between small' }, el('span', { text: 'Mauszeiger im Vollbild' }), cs));
  p.append(el('button', { class: 'btn primary', text: 'Vollbild ohne Menüs', onclick: () => fcEnter() }));
  p.append(el('div', { class: 'small muted', text: 'Nur das Auto ist zu sehen – zum Aufnehmen mit einem externen Programm (z. B. OBS).' }));
}
function fcShow(show) {
  const p = fcPop();
  if (show) fcRender();
  p.classList.toggle('hidden', !show);
  if (!show) FC.waitKey = false;
}

// ------------------------------------------------------------ clean full screen ---
let fcIdle = null;
function fcCursor() {
  clearTimeout(fcIdle);
  if (FC.on && FC.cursor === 'hide') { document.body.classList.add('fc-nocursor'); return; }
  document.body.classList.remove('fc-nocursor');
  if (FC.on && FC.cursor !== 'show') fcIdle = setTimeout(() => { if (FC.on) document.body.classList.add('fc-nocursor'); }, 1500);
}
function fcEnter() {
  if (FC.on) return;
  fcShow(false);
  FC.on = true;
  setMode('fly');
  select(null);
  FC.grid = R.settings.grid;
  if (FC.hideGrid) R.settings.grid = false;
  R.clean = true;
  document.body.classList.add('fc-clean');
  if (window.RF2_HOST === 'webview2') api.post('/api/fullscreen', { on: true }).catch(() => {});
  else {
    try { const e = document.documentElement; const pr = (e.requestFullscreen || e.webkitRequestFullscreen).call(e); if (pr && pr.catch) pr.catch(() => {}); } catch (err) { /* not allowed */ }
  }
  const hint = el('div', { class: 'fc-hint', text: `Vollbild verlassen: ${FC.exitName}` });
  document.body.append(hint);
  setTimeout(() => hint.classList.add('gone'), 1800);
  setTimeout(() => hint.remove(), 2600);
  $('#gl').focus();
  fcCursor();
  R.requestRender();
}
function fcExit() {
  if (!FC.on) return;
  FC.on = false;
  R.clean = false;
  if (FC.grid !== undefined) R.settings.grid = FC.grid;
  document.body.classList.remove('fc-clean', 'fc-nocursor');
  clearTimeout(fcIdle);
  document.querySelectorAll('.fc-hint').forEach(h => h.remove());
  if (window.RF2_HOST === 'webview2') api.post('/api/fullscreen', { on: false }).catch(() => {});
  else if (document.fullscreenElement || document.webkitFullscreenElement) {
    try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (err) { /* ignore */ }
  }
  R.requestRender();
}

(() => {
  fcLoad();
  // the toolbar button: free mode + its settings
  $('#tbFly').addEventListener('click', () => fcShow(fcPop().classList.contains('hidden')));
  document.addEventListener('pointerdown', ev => {
    const p = $('#fcPop');
    if (p && !p.classList.contains('hidden') && !ev.target.closest('#fcPop,#tbFly')) fcShow(false);
  });
  // capture: exit key choice, and in the clean view only movement keys reach the viewer
  window.addEventListener('keydown', ev => {
    if (FC.waitKey) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (FC_MOVE.test(ev.code)) { toast('Diese Taste steuert die Kamera – bitte eine andere wählen.', 'err'); return; }
      FC.exitCode = ev.code; FC.exitName = fcKeyName(ev); FC.waitKey = false; fcSave();
      const b = $('#fcKeyBtn'); if (b) b.textContent = FC.exitName;
      return;
    }
    if (!FC.on) return;
    if (ev.code === FC.exitCode || ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); fcExit(); return; }
    if (FC_MOVE.test(ev.code)) return;                      // camera keys go on to the renderer
    ev.preventDefault(); ev.stopImmediatePropagation();     // no tool shortcuts while recording
  }, true);
  // browser full screen left by the browser itself (Esc) -> leave the clean view too
  const fsOff = () => { if (FC.on && window.RF2_HOST !== 'webview2' && !(document.fullscreenElement || document.webkitFullscreenElement)) fcExit(); };
  document.addEventListener('fullscreenchange', fsOff);
  document.addEventListener('webkitfullscreenchange', fsOff);
  window.addEventListener('pointermove', () => { if (FC.on) fcCursor(); });
})();

if (typeof I18N !== 'undefined' && I18N.extend) I18N.extend({
  'Freie Kamera': 'Free camera',
  'Rechte (oder linke) Maustaste halten und ziehen = umsehen · WASD bewegen, Q/E runter/hoch · Shift schnell, Strg langsam · Mausrad vor/zurück': 'Hold the right (or left) mouse button and drag = look around · WASD move, Q/E down/up · Shift fast, Ctrl slow · mouse wheel forward/back',
  'Geschwindigkeit': 'Speed', 'Maus-Empfindlichkeit': 'Mouse sensitivity', 'Weiche Bewegung': 'Smooth movement', 'aus': 'off',
  'Anfahren und Abbremsen weich statt sofort – ruhigere Kamerafahrten für Videos': 'Soft start and stop instead of instant – calmer camera moves for videos',
  'Vollbild verlassen mit': 'Leave full screen with', 'Taste drücken …': 'Press a key …', 'Leertaste': 'Space',
  'Bodengitter im Vollbild ausblenden': 'Hide the floor grid in full screen', 'Vollbild ohne Menüs': 'Full screen without menus',
  'Nur das Auto ist zu sehen – zum Aufnehmen mit einem externen Programm (z. B. OBS).': 'Only the car is visible – for recording with an external tool (e.g. OBS).',
  'Diese Taste steuert die Kamera – bitte eine andere wählen.': 'This key moves the camera – please choose another one.',
  'Doppelklick = ×1': 'Double-click = ×1', 'Mauszeiger im Vollbild': 'Mouse pointer in full screen',
  'nach 1,5 s ausblenden': 'hide after 1.5 s', 'immer anzeigen': 'always show', 'nie anzeigen': 'never show',
}, [[/^Vollbild verlassen: (.*)$/, 'Leave full screen: $1']]);
