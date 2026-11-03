"""rF2 tyre physics (TGM / TBC / HDV) for the TGM overlay of the viewer.

TGM ([Node] sections, made by the rF2 TTool):
  Geometry=(x, y, t)              cross section point of the carcass: x = lateral (m), y = -radius (m, below
                                  the axis), t = thickness, measured inwards (tyre cavity side)
  InnerGeometryOverride=(x, y)    explicit inner point (bead nodes)
  RingAndRim=(ring, rim)          ring = share of the tread ring (1 tread, 0..1 shoulder, 0 sidewall),
                                  rim  = stiffness of the connection to the rim (> 0 = bead / rim node)
  TreadDepth, PlyParams/PlyMaterial (one PlyParams per ply), BulkMaterial, TreadMaterial ...
  [Realtime] SizeMultiplier=(lateral, radial) scales the tyre in the running game.
  [QuasiStaticAnalysis] / [LookupV2] / [PatchV1] are the results of the TTool analysis.

Checked against the TBC: Radius of DLMF1_2027 (0.35617) = max(-y) 0.326495 * SizeMultiplier[1] 1.0909, i.e.
Geometry is the outer surface and the second multiplier is the radial one.
Editing keeps everything else of the file (comments, order, line endings) and only replaces values."""
import os
import re

import numpy as np

_NUM = re.compile(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')
_BIG_SECTIONS = ('lookupv2', 'patchv1')          # encoded TTool tables - only counted, never sent


def _nums(v):
    return [float(x) for x in _NUM.findall(v or '')]


def _read_lines(path):
    with open(path, 'rb') as f:
        raw = f.read()
    return raw.decode('latin-1').splitlines(keepends=True)


def _split(line):
    """'Key=Value // comment' -> (key, value, comment) or None."""
    body = line.rstrip('\r\n')
    s = body.lstrip()
    if not s or s.startswith('//') or s.startswith('[') or '=' not in s:
        return None
    k, v = s.split('=', 1)
    com = ''
    if '//' in v:
        v, com = v.split('//', 1)
        com = '//' + com
    return k.strip(), v.strip(), com.strip()


def parse_tgm(path):
    lines = _read_lines(path)
    out = {'path': path, 'name': os.path.basename(path), 'header': '', 'realtime': [], 'qsa': [], 'nodes': [],
           'sections': [], 'lineCount': len(lines)}
    if lines and lines[0].lstrip().startswith('//'):
        out['header'] = lines[0].strip()
    sec = None
    node = None
    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith('['):
            name = s[1:s.index(']')] if ']' in s else s[1:]
            sec = name.lower()
            out['sections'].append({'name': name, 'line': i + 1, 'size': 0})
            if sec == 'node':
                m = re.search(r'//\s*(\d+)', s)
                node = {'index': len(out['nodes']), 'label': int(m.group(1)) if m else len(out['nodes']),
                        'line': i + 1, 'keys': [], 'geometry': None, 'inner': None, 'ringAndRim': None,
                        'treadDepth': None, 'plies': 0, 'plyThickness': 0.0}
                out['nodes'].append(node)
            else:
                node = None
            continue
        if out['sections']:
            out['sections'][-1]['size'] += 1
        if sec in _BIG_SECTIONS:
            continue
        kv = _split(line)
        if kv is None:
            continue
        k, v, com = kv
        item = {'line': i + 1, 'key': k, 'value': v}
        if com:
            item['comment'] = com
        if sec == 'realtime':
            out['realtime'].append(item)
        elif sec == 'quasistaticanalysis':
            out['qsa'].append(item)
        elif sec == 'node' and node is not None:
            node['keys'].append(item)
            n = _nums(v)
            kl = k.lower()
            if kl == 'geometry' and len(n) >= 2:
                node['geometry'] = (n + [0.0])[:3]
            elif kl == 'innergeometryoverride' and len(n) >= 2:
                node['inner'] = n[:2]
            elif kl == 'ringandrim' and n:
                node['ringAndRim'] = (n + [0.0])[:2]
            elif kl == 'treaddepth' and n:
                node['treadDepth'] = n[0]
            elif kl == 'plyparams':
                node['plies'] += 1
                if len(n) >= 2:
                    node['plyThickness'] += n[1]
    rt = {x['key'].lower(): x for x in out['realtime']}
    sm = _nums(rt['sizemultiplier']['value']) if 'sizemultiplier' in rt else []
    out['sizeMultiplier'] = (sm + [1.0, 1.0])[:2] if sm else [1.0, 1.0]
    return out


def save_tgm(path, edits):
    """edits: [{'line': n (1-based), 'key': 'Geometry', 'value': '(0.1,-0.2,0.01)'}]. Only the value of that
    line changes (indentation, comment and line ending stay). The key must still be on that line."""
    lines = _read_lines(path)
    for e in edits or []:
        n = int(e.get('line') or 0)
        key = str(e.get('key') or '')
        val = str(e.get('value') if e.get('value') is not None else '').strip()
        if not (1 <= n <= len(lines)) or not key:
            raise ValueError('Zeile %s gibt es nicht' % n)
        if '\n' in val or '\r' in val:
            raise ValueError('Zeilenumbruch im Wert (Zeile %d)' % n)
        old = lines[n - 1]
        kv = _split(old)
        if kv is None or kv[0].lower() != key.lower():
            raise ValueError('Zeile %d ist nicht mehr %s= (Datei wurde geändert?)' % (n, key))
        body = old.rstrip('\r\n')
        eol = old[len(body):]
        indent = body[:len(body) - len(body.lstrip())]
        k0 = body.lstrip().split('=', 1)[0]
        com = (' ' + kv[2]) if kv[2] else ''
        lines[n - 1] = '%s%s=%s%s%s' % (indent, k0, val, com, eol)
    data = ''.join(lines).encode('latin-1')
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)


# ----------------------------------------------------------------------------------- TBC / HDV
_AXLES = ('front', 'rear', 'all', 'frontleft', 'frontright', 'rearleft', 'rearright', 'left', 'right')


def parse_tbc(path):
    """-> [{'name', 'index', 'axles': {'front': {'tgm', 'radius', 'width', 'rim', 'line'}, ...}}]"""
    comps = []
    cur = None
    axle = None
    for i, line in enumerate(_read_lines(path)):
        s = line.split('//', 1)[0].strip()
        if not s:
            continue
        if s.startswith('['):
            if s.lower().startswith('[compound'):
                cur = {'name': 'Compound %d' % len(comps), 'index': len(comps), 'line': i + 1, 'axles': {}}
                comps.append(cur)
            else:
                cur = None
            axle = None
            continue
        if cur is None:
            continue
        if s.endswith(':') and s[:-1].strip().lower() in _AXLES:
            axle = s[:-1].strip().lower()
            cur['axles'][axle] = {'line': i + 1}
            continue
        if '=' not in s:
            continue
        k, v = [x.strip() for x in s.split('=', 1)]
        kl = k.lower()
        if kl == 'name' and axle is None:
            cur['name'] = v.strip('"')
            continue
        if axle is None:
            continue
        a = cur['axles'][axle]
        if kl == 'tgm':
            a['tgm'] = v.strip().strip('"')
        elif kl in ('radius', 'width'):
            n = _nums(v)
            if n:
                a[kl] = n[0]
        elif kl == 'rim':
            n = _nums(v)
            if n:
                a['rim'] = n[0]
    return comps


def _hdv_values(path):
    out = {}
    for line in _read_lines(path):
        s = line.split('//', 1)[0].strip()
        if '=' in s and not s.startswith('['):
            k, v = s.split('=', 1)
            out.setdefault(k.strip().lower(), v.strip().strip('"'))
    return out


def _axle_for(comp, wheel):
    """TBC entry for a wheel ('FL', 'FR', 'RL', 'RR')."""
    ax = comp['axles']
    front = wheel[0] == 'F'
    left = wheel[1] == 'L'
    order = (['frontleft' if left else 'frontright', 'front'] if front else ['rearleft' if left else 'rearright', 'rear'])
    order += ['left' if left else 'right', 'all']
    for k in order:
        if k in ax and ax[k].get('tgm'):
            return ax[k]
    return None


def make_finder(project):
    """file name -> path: mod folder, files of the project, MAS archives (like find_setup)"""
    from .scene import vehicles_root, walk_files
    mod = vehicles_root(project.path)[1]
    if not mod:
        mod = project.path if os.path.isdir(project.path) else os.path.dirname(project.path)
    files = [f for f in walk_files(mod, 6, 60000)] if mod and os.path.isdir(mod) else []
    by_name = {}
    for f in files:
        by_name.setdefault(os.path.basename(f).lower(), f)

    def find(name):
        if not name:
            return None
        n = os.path.basename(name.replace('\\', '/')).lower()
        p = by_name.get(n) or project.file_index.get(n)
        if not p:
            cp = getattr(project, 'mas_names', {}).get(n)
            if cp:
                try:
                    p = project.ensure(cp)
                except Exception:       # noqa - encrypted MAS etc.
                    p = None
        return p
    return find


def find_setup(project):
    """HDV -> TBC -> compounds with the TGM per wheel; plus every TGM of the mod."""
    from .scene import vehicles_root, walk_files, norm
    res = {'hdv': None, 'tbc': None, 'compounds': [], 'front': 0, 'rear': 0, 'tgms': [], 'notes': []}
    mod = vehicles_root(project.path)[1]
    if not mod:
        mod = project.path if os.path.isdir(project.path) else os.path.dirname(project.path)
    files = [f for f in walk_files(mod, 6, 60000)] if mod and os.path.isdir(mod) else []
    by_name = {}
    for f in files:
        by_name.setdefault(os.path.basename(f).lower(), f)

    def find(name):
        if not name:
            return None
        n = os.path.basename(name.replace('\\', '/')).lower()
        p = by_name.get(n) or project.file_index.get(n)
        if not p:
            cp = getattr(project, 'mas_names', {}).get(n)
            if cp:
                try:
                    p = project.ensure(cp)
                except Exception:       # noqa - encrypted MAS etc.
                    p = None
        return p

    veh = getattr(project, 'veh', None) or {}
    hdv = find(veh.get('hdvehicle')) if veh.get('hdvehicle') else None
    if not hdv:
        hdvs = sorted((f for f in files if f.lower().endswith('.hdv')), key=lambda f: (f.count(os.sep), f))
        hdv = hdvs[0] if hdvs else None
        if len(hdvs) > 1:
            res['notes'].append('Mehrere HDV im Mod - genommen: %s' % os.path.basename(hdv))
    res['hdv'] = hdv
    tbc = None
    if hdv:
        hv = _hdv_values(hdv)
        tb = hv.get('tirebrand')
        if tb:
            tbc = find(tb if tb.lower().endswith('.tbc') else tb + '.tbc')
            if not tbc:
                res['notes'].append('TireBrand="%s" aus der HDV nicht gefunden.' % tb)
        for key, dst in (('fronttirecompoundsetting', 'front'), ('reartirecompoundsetting', 'rear')):
            n = _nums(hv.get(key, ''))
            if n:
                res[dst] = int(n[0])
    if not tbc:
        tbcs = sorted((f for f in files if f.lower().endswith('.tbc')), key=lambda f: (f.count(os.sep), f))
        tbc = tbcs[0] if tbcs else None
    res['tbc'] = tbc
    if tbc:
        for c in parse_tbc(tbc):
            wheels = {}
            for w in ('FL', 'FR', 'RL', 'RR'):
                a = _axle_for(c, w)
                if a:
                    nm = a['tgm'] if a['tgm'].lower().endswith('.tgm') else a['tgm'] + '.tgm'
                    wheels[w] = {'tgm': a['tgm'], 'path': find(nm), 'radius': a.get('radius'),
                                 'width': a.get('width'), 'rim': a.get('rim'), 'line': a.get('line')}
            res['compounds'].append({'name': c['name'], 'index': c['index'], 'wheels': wheels})
    seen = set()
    for f in files:
        if f.lower().endswith('.tgm') and norm(f) not in seen:
            seen.add(norm(f))
            res['tgms'].append(f)
    for c in res['compounds']:
        for w in c['wheels'].values():
            if w['path'] and norm(w['path']) not in seen:
                seen.add(norm(w['path']))
                res['tgms'].append(w['path'])
    res['tgms'].sort(key=lambda f: os.path.basename(f).lower())
    return res


# --------------------------------------------------------------------------------- wheels (GMT)
_WHEEL_INST = {'LFTIRE': 'FL', 'RFTIRE': 'FR', 'LRTIRE': 'RL', 'RRTIRE': 'RR'}


def _profile(V, center, out_sign, step=0.002):
    """Silhouette of a rotationally symmetric mesh around the X axis through center:
    per lateral bin (outboard = +) the max and min radius."""
    u = (V[:, 0] - center[0]) * out_sign
    r = np.hypot(V[:, 1] - center[1], V[:, 2] - center[2])
    if not len(u):
        return None
    lo = np.floor(u.min() / step) * step
    idx = np.floor((u - lo) / step).astype(np.int64)
    nb = int(idx.max()) + 1
    rmax = np.full(nb, -1.0)
    rmin = np.full(nb, 1e9)
    np.maximum.at(rmax, idx, r)
    np.minimum.at(rmin, idx, r)
    ok = rmax >= 0
    xs = lo + (np.arange(nb) + 0.5) * step
    return {'x': [round(float(x), 5) for x in xs[ok]], 'rmax': [round(float(x), 5) for x in rmax[ok]],
            'rmin': [round(float(x), 5) for x in rmin[ok]]}


def _section(V, T, center, out_sign, limit=4000):
    """Cross section of a revolved mesh: every vertex as (lateral, radius) rounded to 0.25 mm, every triangle
    edge that connects two different section points = segment of the profile line. None if the mesh is not
    rotationally built (too many different points)."""
    if T is None or not len(T):
        return None
    u = (V[:, 0] - center[0]) * out_sign
    r = np.hypot(V[:, 1] - center[1], V[:, 2] - center[2])
    key = np.stack([np.round(u * 4000), np.round(r * 4000)], 1).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    if len(uniq) > limit:
        return None
    T = np.asarray(T, np.int64).reshape(-1, 3)
    e = np.concatenate([inv[T[:, [0, 1]]], inv[T[:, [1, 2]]], inv[T[:, [2, 0]]]])
    e = e[e[:, 0] != e[:, 1]]
    e.sort(axis=1)
    e = np.unique(e, axis=0)
    if len(e) > limit * 4:
        return None
    pts = uniq.astype(np.float64) / 4000.0
    return {'pts': [[round(float(a), 5), round(float(b), 5)] for a, b in pts], 'edges': e.tolist()}


def _slice_section(V, T, center, out_sign, angles=90):
    """Real cross section of a mesh: cut with the half plane through the wheel axis. Of all tried angles the one
    with the shortest cut wins, i.e. between the spokes - only barrel, flanges and the hub remain (a projection of
    all vertices would draw every spoke as well). Result like _section: points (lateral, radius) + edges."""
    if T is None or not len(T):
        return None
    T = np.asarray(T, np.int64).reshape(-1, 3)
    u = (V[:, 0] - center[0]) * out_sign
    dy, dz = V[:, 1] - center[1], V[:, 2] - center[2]
    best = None
    for th in np.linspace(0, 2 * np.pi, angles, endpoint=False):
        c, s = np.cos(th), np.sin(th)
        S = (-s * dy + c * dz)[T]
        t = c * dy + s * dz
        P = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            sa, sb = S[:, a], S[:, b]
            cross = (sa > 0) != (sb > 0)
            k = np.where(cross, sa / np.where(cross, sa - sb, 1), np.nan)
            ia, ib = T[:, a], T[:, b]
            P.append(np.stack([u[ia] + (u[ib] - u[ia]) * k, t[ia] + (t[ib] - t[ia]) * k], 1))
        P = np.stack(P, 1)
        ok = ~np.isnan(P[:, :, 0])
        m = ok.sum(1) == 2
        Q = P[m][ok[m]].reshape(-1, 2, 2)
        Q = Q[(Q[:, :, 1] > 0).all(1)]
        if not len(Q):
            continue
        L = float(np.linalg.norm(Q[:, 0] - Q[:, 1], axis=1).sum())
        if best is None or L < best[0]:
            best = (L, Q)
    if best is None:
        return None
    Q = best[1].reshape(-1, 2)
    key = np.round(Q * 10000).astype(np.int64)                 # merge the cut points to 0.1 mm
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    e = inv.reshape(-1, 2)
    e = e[e[:, 0] != e[:, 1]]
    e.sort(axis=1)
    e = np.unique(e, axis=0)
    pts = uniq.astype(np.float64) / 10000.0
    return {'pts': [[round(float(a), 5), round(float(b), 5)] for a, b in pts], 'edges': e.tolist(), 'cut': True}


def _mesh_world(info):
    V = np.asarray(info['arrays'][0], np.float64).reshape(-1, 3) + np.asarray(info['meta']['position'])
    T = np.asarray(info['arrays'][6], np.int64) if len(info['arrays']) > 6 else None
    return V, T


def wheels(project):
    """Wheel centres (GL coordinates, axis = X) from the tyre GMT of the instances LFTIRE ... RRTIRE,
    with the side profile of tyre and rim GMT for the comparison with the TGM."""
    groups = {}
    for p in project.parts:
        if p.get('env') or p.get('removed') or p['missing'] or not p.get('visible', True):
            continue
        w = _WHEEL_INST.get((p.get('group') or '').upper())
        if w is None:
            nm = os.path.basename(p['file']).lower()
            if project.kind not in ('gmt', 'folder'):
                continue
            if 'tire' in nm or 'tyre' in nm:
                w = '?'
            elif re.search(r'rim|felge', nm):
                w = '?rim'
            else:
                continue
        groups.setdefault(w, []).append(p)
    loose_rims = groups.pop('?rim', [])
    out = []
    for w, parts in groups.items():
        tires = [p for p in parts if re.search(r'ti(re|yre)', os.path.basename(p['file']).lower())]
        rims = [p for p in parts if re.search(r'rim|wheel|felge', os.path.basename(p['file']).lower())]
        tires = tires[:1] or parts[:1]                 # highest LOD = first visible one of the instance
        if w == '?':
            tires = [p for p in parts]
        for tp in tires:
            info = project._safe_info(tp['id'])
            if not info:
                continue
            V, T = _mesh_world(info)
            lo, hi = V.min(0), V.max(0)
            c = (lo + hi) / 2
            ww = w
            if ww == '?':
                ww = ('F' if c[2] >= 0 else 'R') + ('L' if c[0] >= 0 else 'R')
            out_sign = 1.0 if c[0] >= 0 else -1.0          # rF2 +x = left: outboard is away from the centre line
            ent = {'wheel': ww, 'center': [float(x) for x in c], 'outSign': out_sign,
                   'tire': {'id': tp['id'], 'name': os.path.basename(tp['file']), 'profile': _profile(V, c, out_sign),
                            'section': _section(V, T, c, out_sign),
                            'radius': float((hi[1] - lo[1]) / 2), 'width': float(hi[0] - lo[0])}}
            if w == '?' and loose_rims:            # single GMT / folder: the rim whose centre is next to this tyre
                best = None
                for rp in loose_rims:
                    ri = project._safe_info(rp['id'])
                    if ri:
                        RV, _ = _mesh_world(ri)
                        d = float(np.linalg.norm((RV.min(0) + RV.max(0)) / 2 - c))
                        if d < 0.15 and (best is None or d < best[0]):
                            best = (d, rp)
                rims = [best[1]] if best else []
            for rp in rims[:1]:
                ri = project._safe_info(rp['id'])
                if ri:
                    RV, RT = _mesh_world(ri)
                    ent['rim'] = {'id': rp['id'], 'name': os.path.basename(rp['file']), 'profile': _profile(RV, c, out_sign),
                                  'section': _slice_section(RV, RT, c, out_sign) or _section(RV, RT, c, out_sign)}
            out.append(ent)
    order = {'FL': 0, 'FR': 1, 'RL': 2, 'RR': 3}
    out.sort(key=lambda e: order.get(e['wheel'], 9))
    return out
