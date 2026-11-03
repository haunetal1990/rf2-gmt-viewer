// Mod check: missing files named in VEH / HDV / TBC / GEN and missing textures (rf2core/modcheck.py) as a report.
'use strict';

const MC = { res: null, onlyIssues: true };

function mcText(res) {
  const lines = ['Mod-Prüfung – ' + (S.project ? S.project.path : ''), `${res.errors} Fehler · ${res.warnings} Warnungen`, ''];
  for (const s of res.sections) {
    lines.push('## ' + s.title);
    for (const i of s.items) if (i.level !== 'ok' || !MC.onlyIssues) lines.push(`[${{ err: 'FEHLER', warn: 'WARNUNG', info: 'INFO', ok: 'OK' }[i.level]}] ${i.msg}${i.detail ? ' (' + i.detail + ')' : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}
function mcRender() {
  const box = $('#mcBody'); if (!box) return;
  box.innerHTML = '';
  const res = MC.res;
  if (!res) { box.append(el('div', { class: 'small muted', text: 'Prüfe …' })); return; }
  $('#mcSum').textContent = res.errors || res.warnings ? `${res.errors} Fehler · ${res.warnings} Warnungen` : 'Alles gefunden';
  $('#mcSum').className = 'mc-sum ' + (res.errors ? 'bad' : res.warnings ? 'warn' : 'ok');
  for (const s of res.sections) {
    const nErr = s.items.filter(i => i.level === 'err').length, nWarn = s.items.filter(i => i.level === 'warn').length;
    const nOk = s.items.filter(i => i.level === 'ok').length;
    const det = el('details', { class: 'mc-sec', open: !!(nErr || nWarn) },
      el('summary', {}, el('span', { class: 'mc-dot ' + (nErr ? 'err' : nWarn ? 'warn' : 'ok') }), el('b', { text: s.title }),
        el('span', { class: 'grow' }), el('span', { class: 'small muted', text: [nErr && nErr + ' Fehler', nWarn && nWarn + ' Warnungen', nOk && nOk + ' OK'].filter(Boolean).join(' · ') })));
    const list = el('div', { class: 'mc-list' });
    for (const i of s.items) {
      if (MC.onlyIssues && i.level === 'ok') continue;
      list.append(el('div', { class: 'mc-item ' + i.level, title: i.path || '' },
        el('span', { class: 'mc-dot ' + i.level }),
        el('div', { class: 'min0' }, el('div', { class: 'mono mc-msg', text: i.msg }), i.detail ? el('div', { class: 'small muted', text: i.detail }) : null)));
    }
    if (!list.children.length) list.append(el('div', { class: 'small muted', text: 'Keine Probleme' }));
    det.append(list);
    box.append(det);
  }
}
async function mcRun() {
  MC.res = null; mcRender();
  try { MC.res = await api.get('/api/modcheck'); }
  catch (err) { MC.res = { errors: 1, warnings: 0, sections: [{ title: 'Fehler', items: [{ level: 'err', msg: err.message }] }] }; }
  mcRender();
}
function mcOpen() {
  if (!S.project) return;
  if ($('#mcModal')) return;
  const close = () => box.remove();
  const only = el('input', { type: 'checkbox', checked: MC.onlyIssues });
  only.addEventListener('change', () => { MC.onlyIssues = only.checked; mcRender(); });
  const box = el('div', { class: 'modal', id: 'mcModal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Mod-Prüfung' },
    el('div', { class: 'quit-card mc-card' },
      el('div', { class: 'row between gap8' }, el('div', { class: 'title', text: 'Mod-Prüfung' }), el('span', { id: 'mcSum', class: 'mc-sum' }),
        el('button', { class: 'icon-btn small', 'aria-label': 'Schließen', onclick: close }, icon('x', 14))),
      el('div', { class: 'small muted', text: 'Dateien aus VEH, HDV (und den INI darin), TBC → TGM, GEN → GMT und die Texturen aller Teile. Gesucht wird wie im Viewer: Mod-Ordner, Projekt, MAS-Archive.' }),
      el('label', { class: 'toggle small' }, only, el('span', { text: 'Nur Probleme zeigen' })),
      el('div', { id: 'mcBody', class: 'mc-body' }),
      el('div', { class: 'row gap8 quit-btns' },
        el('button', { class: 'btn', text: 'Bericht kopieren', onclick: async () => {
          if (!MC.res) return;
          try { await navigator.clipboard.writeText(mcText(MC.res)); toast('Bericht in der Zwischenablage'); }
          catch (e) { toast('Kopieren nicht möglich', 'err'); }
        } }),
        el('span', { class: 'grow' }),
        el('button', { class: 'btn', text: 'Erneut prüfen', onclick: mcRun }),
        el('button', { class: 'btn primary', text: 'Schließen', onclick: close }))));
  box.addEventListener('click', ev => { if (ev.target === box) close(); });
  box.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } });
  document.body.append(box);
  box.querySelector('.btn.primary').focus();
  mcRun();
}
$('#btnCheck').addEventListener('click', mcOpen);

if (typeof I18N !== 'undefined' && I18N.extend) I18N.extend({
  'Mod prüfen': 'Check mod', 'Mod-Prüfung': 'Mod check', 'Prüfe …': 'Checking …', 'Alles gefunden': 'Everything found', 'Keine Probleme': 'No problems',
  'Nur Probleme zeigen': 'Show problems only', 'Bericht kopieren': 'Copy report', 'Erneut prüfen': 'Check again', 'Bericht in der Zwischenablage': 'Report copied',
  'Kopieren nicht möglich': 'Copy failed', 'Texturen': 'Textures',
  'Mod prüfen: fehlende Dateien aus VEH, HDV, TBC, GEN und fehlende Texturen': 'Check mod: missing files from VEH, HDV, TBC, GEN and missing textures',
  'Dateien aus VEH, HDV (und den INI darin), TBC → TGM, GEN → GMT und die Texturen aller Teile. Gesucht wird wie im Viewer: Mod-Ordner, Projekt, MAS-Archive.':
    'Files from VEH, HDV (and the INI named there), TBC → TGM, GEN → GMT and the textures of all parts. Searched like the viewer does: mod folder, project, MAS archives.',
  'Materialien mit JSON-Texturliste: nur die JSON zählt (sie ersetzt die GMT-Stages im Spiel).': 'Materials with a JSON texture list: only the JSON counts (it replaces the GMT stages in the game).',
}, [
  [/^(\d+) Fehler · (\d+) Warnungen$/, '$1 errors · $2 warnings'], [/^(\d+) Fehler$/, '$1 errors'], [/^(\d+) Warnungen$/, '$1 warnings'],
  [/^(.*) - nicht gefunden$/, '$1 - not found'], [/^(.*) - nicht gefunden \(Instance (.*)\)$/, '$1 - not found (instance $2)'],
  [/^(\d+) GMT gefunden(.*)$/, (m, a, b) => a + ' GMT found' + b.replace(/(\d+) fehlen/, '$1 missing')],
  [/^(\d+) Textur-Verweise geprüft(.*)$/, (m, a, b) => a + ' texture references checked' + b.replace(/(\d+) Texturen fehlen/, '$1 textures missing')],
  [/^(.*) fehlt - (.*), Material (.*)$/, '$1 missing - $2, material $3'],
  [/^Fahrzeug \(VEH\)(.*)$/, 'Vehicle (VEH)$1'], [/^Physik \(HDV\)(.*)$/, 'Physics (HDV)$1'], [/^Reifen \(TBC → TGM\)(.*)$/, 'Tyres (TBC → TGM)$1'], [/^Grafik \(GEN → GMT\)(.*)$/, 'Graphics (GEN → GMT)$1'],
]);
