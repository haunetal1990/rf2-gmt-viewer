"""Mod check: what is referenced but missing?

  * VEH: every value that names a file (HDVehicle, Graphics, Spinner, Cameras, Cockpit, HeadPhysics, Upgrades,
    Sounds, DefaultLivery / ExtraN, MaterialOverride ...)
  * HDV: every value that names a file (TireBrand -> .tbc, UltraChassis, engine / gear / damage .ini ...),
    the INI files named there one level deeper
  * TBC: TGM of every compound
  * GEN: GMT files of the instances
  * textures: a material with a JSON that lists textures is checked only against the JSON (the JSON replaces the
    stages of the GMT in rF2), otherwise the stages of the GMT; runtime targets (MIRROR, RAINDROPMAP, @...) and
    textures replaced by the livery do not count.
Files are searched like the viewer does: mod folder, files of the project, MAS archives.
"""
import json
import os
import re

from . import tgm as TGM
from .scene import TEX_EXTS, parse_veh

FILE_EXT = ('.hdv', '.gen', '.ini', '.tbc', '.tgm', '.pm', '.cam', '.json', '.sfx', '.gmt', '.mas', '.wav', '.csv',
            '.veh', '.scn') + tuple(TEX_EXTS)
_RUNTIME = re.compile(r'^(MIRROR|MIRROR_TONEMAPPED|RAINDROPMAP|REFMAP\d*|IRRADIANCE_PROBE|SCREEN|_DEFTEX)', re.I)
# rF2 ships these with the game (Shared / Core): not in a car mod, no error
_CORE_HINT = re.compile(r'^(CAR_CUBE|SKYBOXI?|32X32|DEFAULT|WHITE|BLACK|GREY|GRAY|FLAT|NORMAL_FLAT|NOISE)', re.I)


def _item(level, msg, path=None, detail=None):
    d = {'level': level, 'msg': msg}
    if path:
        d['path'] = path
    if detail:
        d['detail'] = detail
    return d


def _values(path):
    """(section, key, value, line) of an INI-like file (HDV, TBC, VEH ...)"""
    out, sec = [], ''
    for i, raw in enumerate(TGM._read_lines(path)):
        s = raw.split('//', 1)[0].strip()
        m = re.match(r'^\[([^\]]+)\]', s)
        if m:
            sec = m.group(1).strip().upper()
            continue
        if '=' not in s:
            continue
        k, v = s.split('=', 1)
        out.append((sec, k.strip(), v.strip(), i + 1))
    return out


def _file_names(v):
    """file names in a value: quoted or plain, also inside lists"""
    names = []
    for tok in re.split(r'[,()"\s]+', v):
        t = tok.strip().strip("'")
        if not t:
            continue
        if os.path.splitext(t)[1].lower() in FILE_EXT:
            names.append(t)
    return names


def _refs(path, find, title, skip_keys=(), extra=None, deep=1):
    """check every file named in an INI-like file"""
    items, found = [], []
    seen = set()
    for sec, k, v, line in _values(path):
        kl = k.lower()
        if kl in skip_keys or kl.endswith('caption') or kl.endswith('special'):
            continue
        names = _file_names(v)
        if extra:
            names += extra(sec, kl, v)
        for n in names:
            key = (kl, n.lower())
            if key in seen:
                continue
            seen.add(key)
            p = find(n)
            where = '%s Zeile %d: %s=%s' % (os.path.basename(path), line, k, n)
            if p:
                items.append(_item('ok', where, p))
                found.append(p)
            else:
                lvl = 'warn' if os.path.splitext(n)[1].lower() in ('.sfx', '.wav', '.json') and kl == 'sounds' else 'err'
                items.append(_item(lvl, where + ' - nicht gefunden'))
    # INI named in the HDV may name further files (engine.ini -> sound etc. are rare; one level is enough)
    if deep > 0:
        for p in found:
            if p.lower().endswith('.ini') and os.path.isfile(p):
                sub, _ = _refs(p, find, title, skip_keys, None, deep - 1)
                items += sub
    return items, found


def check(project):
    find = TGM.make_finder(project)
    out = []
    veh = getattr(project, 'veh', None)
    vpath = getattr(project, 'veh_path', None) or (project.path if str(project.path).lower().endswith('.veh') else None)
    hdv_path = None
    # ---- VEH
    if vpath and os.path.isfile(vpath):
        def veh_extra(sec, kl, v):
            if kl in ('defaultlivery', 'pitcrewlivery') or re.match(r'^extra\d+$', kl):
                val = v.strip().strip('"')
                return [val] if val and not os.path.splitext(val)[1] else []
            return []
        items, found = _refs(vpath, find, 'VEH', skip_keys=('classes',), extra=veh_extra, deep=0)
        out.append({'title': 'Fahrzeug (VEH) · ' + os.path.basename(vpath), 'items': items})
        hdv_rel = (veh or parse_veh(vpath)).get('hdvehicle')
        hdv_path = find(hdv_rel) if hdv_rel else None
    if not hdv_path:
        hdv_path = TGM.find_setup(project).get('hdv')
    # ---- HDV
    tbc_path = None
    if hdv_path and os.path.isfile(hdv_path):
        def hdv_extra(sec, kl, v):
            val = v.strip().strip('"')
            if kl == 'tirebrand' and val and not os.path.splitext(val)[1]:
                return [val + '.tbc']
            return []
        items, found = _refs(hdv_path, find, 'HDV', extra=hdv_extra)
        out.append({'title': 'Physik (HDV) · ' + os.path.basename(hdv_path), 'items': items})
        tbc_path = next((p for p in found if p.lower().endswith('.tbc')), None)
    elif vpath:
        out.append({'title': 'Physik (HDV)', 'items': [_item('err', 'HDV nicht gefunden')]})
    # ---- TBC -> TGM
    if tbc_path and os.path.isfile(tbc_path):
        items, _ = _refs(tbc_path, find, 'TBC', deep=0)
        if not any('.tgm' in i['msg'].lower() for i in items):
            items.append(_item('warn', 'Keine TGM-Einträge in der TBC'))
        out.append({'title': 'Reifen (TBC → TGM) · ' + os.path.basename(tbc_path), 'items': items})
    # ---- GEN -> GMT
    gen = getattr(project, 'gen_path', None)
    items = []
    seen = set()
    for p in project.parts:
        if p.get('added'):
            continue
        n = os.path.basename(p['file'])
        if n.lower() in seen:
            continue
        seen.add(n.lower())
        if p['missing']:
            items.append(_item('err', '%s - nicht gefunden (Instance %s)' % (n, p.get('group') or '?')))
    ok = len(seen) - len(items)
    items.insert(0, _item('ok' if not items else 'info', '%d GMT gefunden%s' % (ok, ', %d fehlen' % len(items) if items else '')))
    for i in getattr(project, 'gen_issues', []) or []:
        items.append(_item(i.get('level', 'warn') if i.get('level') in ('err', 'warn') else 'warn',
                           ('Zeile %d: ' % (i['line'] + 1) if i.get('line') is not None else '') + i['msg']))
    out.append({'title': 'Grafik (GEN → GMT)' + (' · ' + os.path.basename(gen) if gen else ''), 'items': items})
    # ---- textures
    out.append(_textures(project))
    # summary
    n_err = sum(1 for s in out for i in s['items'] if i['level'] == 'err')
    n_warn = sum(1 for s in out for i in s['items'] if i['level'] == 'warn')
    return {'ok': True, 'sections': out, 'errors': n_err, 'warnings': n_warn}


def _textures(project):
    liv = getattr(project, 'livery', None) or {}
    liv_mats = set(k.upper() for k in (liv.get('map') or {}))
    missing = {}                       # tex -> {mats, parts, via}
    checked = 0
    for p in project.parts:
        if p['missing']:
            continue
        info = project._safe_info(p['id'])
        if not info:
            continue
        for m in info['meta'].get('materials', []):
            js = m.get('json')
            tex_list = js.get('textures') if isinstance(js, dict) else None
            names = []
            if isinstance(tex_list, list) and len(tex_list):
                via = 'JSON'
                for t in tex_list:
                    if not isinstance(t, dict) or t.get('inactive') or t.get('runtime'):
                        continue
                    tx = str(t.get('Texture') or '')
                    role = str(t.get('Name') or '')
                    if not tx or tx.startswith('@') or role.startswith(':'):
                        continue
                    names.append(tx)
            else:
                via = 'GMT'
                for st in m.get('stages') or []:
                    tx = (st.get('tex') or '').split(' ')[0]
                    if tx:
                        names.append(tx)
            for tx in names:
                stem = os.path.splitext(os.path.basename(tx.replace('\\', '/')))[0]
                if not stem or _RUNTIME.match(stem):
                    continue
                if stem.upper() in liv_mats or (m.get('name') or '').upper() in liv_mats and stem.upper() == (m.get('name') or '').upper():
                    continue                       # replaced by the livery of the VEH
                checked += 1
                if project.find_texture(tx):
                    continue
                if not os.path.splitext(tx)[1] and not project.find_texture(tx + '.dds'):
                    # names without extension that the engine creates (render targets)
                    if stem.isupper() and '_' not in stem and len(stem) > 10:
                        continue
                e = missing.setdefault(tx.lower(), {'tex': tx, 'mats': set(), 'parts': set(), 'via': set(),
                                                     'json': set()})
                e['mats'].add(m.get('name') or '?')
                e['parts'].add(os.path.basename(p['file']))
                e['via'].add(via)
                if via == 'JSON' and (m.get('json_path') or m.get('json_from')):
                    e['json'].add(os.path.basename(m.get('json_path') or m.get('json_from')))
    items = []
    for e in sorted(missing.values(), key=lambda x: x['tex'].lower()):
        core = bool(_CORE_HINT.match(os.path.basename(e['tex'])))
        src = ('JSON ' + ', '.join(sorted(e['json']))) if e['json'] else ('JSON' if 'JSON' in e['via'] else 'GMT-Stage')
        parts = sorted(e['parts'])
        items.append(_item('warn' if core else 'err', '%s fehlt - %s, Material %s' % (e['tex'], src, ', '.join(sorted(e['mats']))),
                           detail='in ' + ', '.join(parts[:6]) + (' + %d' % (len(parts) - 6) if len(parts) > 6 else '') +
                           (' · gehört meist zu rF2 (Shared/Core), dann kein Fehler' if core else '')))
    items.insert(0, _item('ok' if not items else 'info', '%d Textur-Verweise geprüft%s' % (checked, ', %d Texturen fehlen' % len(items) if items else '')))
    items.insert(1, _item('info', 'Materialien mit JSON-Texturliste: nur die JSON zählt (sie ersetzt die GMT-Stages im Spiel).'))
    return {'title': 'Texturen', 'items': items}
