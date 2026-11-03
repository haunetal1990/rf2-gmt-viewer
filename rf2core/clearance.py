"""Clearance check: front wheels steered, all wheels compressed / extended - where do tyre and rim touch the car?

Suspension from the physics:
  * UltraChassis (HDV [SUSPENSION] UltraChassis=...ini): [RigidBody] Position + [Constraint] Type=Bar_2 with
    LocalOffsetA / LocalOffsetB (bodies have no orientation at rest -> world = Position + LocalOffset).
  * otherwise the .pm: [BODY] name / pos and [BAR] posbody / negbody / pos / neg (world coordinates).
Every corner: the 5 links between car and spindle. Like rF2 with AlignWheels=1 the corner is moved so that the
physical wheel sits in the graphical wheel (centre of the tyre GMT).
Kinematics: spindle = rigid body (rotation vector + translation), 5 bar lengths + wheel centre height -> 6
equations, Gauss-Newton. Steering moves the inner end of the steering link sideways (rack); full lock from
[CONTROLS] SteeringInnerTable (rack ends) or SteerLockRange (wheel angle in degrees).
Collision: tyre + rim as solid of revolution (max radius per lateral slice of the GMTs); every vertex / triangle
centre of the other meshes is tested in the moved wheel frame.
All coordinates here in GL (x left, y up, z forward = -rF2 z).
"""
import os
import re

import numpy as np

from . import tgm as TGM

_CORNERS = ('FL', 'FR', 'RL', 'RR')
_SPINDLE_INST = {'FL': 'LFSPINDLE', 'FR': 'RFSPINDLE', 'RL': 'LRSPINDLE', 'RR': 'RRSPINDLE'}
_TIRE_INST = {'FL': 'LFTIRE', 'FR': 'RFTIRE', 'RL': 'LRTIRE', 'RR': 'RRTIRE'}


def _gl(v):
    return np.array([v[0], v[1], -v[2]], np.float64)


def _vec(s):
    n = re.findall(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?', s or '')
    return [float(x) for x in n]


def _lines(path):
    with open(path, 'rb') as fh:
        raw = fh.read()
    for enc in ('utf-8', 'cp1252', 'latin-1'):
        try:
            return raw.decode(enc).splitlines()
        except UnicodeDecodeError:
            continue
    return raw.decode('latin-1', 'replace').splitlines()


def _sections(path):
    """[Name] blocks as list of (name, {key lower: [values...]})."""
    out, cur = [], None
    for line in _lines(path):
        s = line.split('//', 1)[0].strip()
        if not s:
            continue
        m = re.match(r'^\[(\w[^\]]*)\]', s)
        if m:
            cur = (m.group(1).strip().upper(), {})
            out.append(cur)
            continue
        if cur is None:
            continue
        # .pm: several key=value on one line
        for k, v in re.findall(r'(\w+)\s*=\s*("[^"]*"|\([^)]*\)|[^\s]+)', s):
            cur[1].setdefault(k.lower(), []).append(v.strip('"'))
    return out


# ------------------------------------------------------------------ physics files ---
_ULTRA_NOTES = []


def _ultra(path, instr=()):
    """corners from an UltraChassis file; instr = chassis adjustment instructions of the active HDV settings
    (CamberSpecial etc.: 'C(FL_Fore_Lower);LocalOffsetB-=(x,y,z);...'), applied like rF2 before the geometry is built"""
    _ULTRA_NOTES.clear()
    secs = _sections(path)
    bodies = {}
    for name, kv in secs:
        if name == 'RIGIDBODY' and 'name' in kv:
            bodies[kv['name'][0].lower()] = np.array(_vec(kv.get('position', ['0,0,0'])[0])[:3])
            if any(abs(v) > 1e-6 for v in _vec((kv.get('orientation') or ['0,0,0'])[0])):
                _ULTRA_NOTES.append('Körper %s hat eine Orientation - Offsets werden ohne Drehung gelesen.' % kv['name'][0])
    cons = {}
    for name, kv in secs:
        if name != 'CONSTRAINT' or not kv.get('type') or not kv['type'][0].lower().startswith('bar'):
            continue
        a, b = (kv.get('bodya') or [''])[0].lower(), (kv.get('bodyb') or [''])[0].lower()
        oa, ob = _vec((kv.get('localoffseta') or ['0,0,0'])[0]), _vec((kv.get('localoffsetb') or ['0,0,0'])[0])
        if a not in bodies or b not in bodies or len(oa) < 3 or len(ob) < 3:
            continue
        # Bar_2: rest length = Min/MaxError0 (rF2 constraint help: "the default length is one meter, which is
        # achieved by setting both the Min and Max Error to 1.0")
        mn, mx = _vec((kv.get('minerror0') or [''])[0]), _vec((kv.get('maxerror0') or [''])[0])
        nm = (kv.get('name') or ['?'])[0]
        cons[nm.lower()] = {'name': nm, 'a': a, 'b': b, 'oa': np.array(oa[:3]), 'ob': np.array(ob[:3]),
                            'len': (mn[0] + mx[0]) / 2 if mn and mx else None}
    # chassis adjustments of the HDV settings
    applied = 0
    for ins in instr:
        cur = None
        for tok in ins.split(';'):
            tok = tok.strip()
            m = re.match(r'^C\(([^)]+)\)$', tok)
            if m:
                cur = cons.get(m.group(1).strip().lower())
                continue
            m = re.match(r'^LocalOffset([AB])\s*(\+=|-=|=)\s*\(([^)]*)\)$', tok, re.I)
            if m and cur is not None:
                v = np.array((_vec(m.group(3)) + [0, 0, 0])[:3])
                # right side: the vectors are written mirrored (x) - read like that, both sides get the same camber,
                # as the ModDev display shows (FL -3.38 / FR -3.22 deg); read literally FR would get +2.5 deg
                if 'fr_spindle' in (cur['a'], cur['b']) or 'rr_spindle' in (cur['a'], cur['b']):
                    v[0] = -v[0]
                k = 'oa' if m.group(1).upper() == 'A' else 'ob'
                cur[k] = cur[k] + v if m.group(2) == '+=' else cur[k] - v if m.group(2) == '-=' else v
                applied += 1
    corners = {}
    for c in _CORNERS:
        sp, wh = bodies.get(c.lower() + '_spindle'), bodies.get(c.lower() + '_wheel')
        if sp is None:
            continue
        corners[c] = {'wheel': (wh if wh is not None else sp), 'bars': [], 'spindle': sp}
    for k in cons.values():
        for c in corners:
            sp = c.lower() + '_spindle'
            if sp not in (k['a'], k['b']):
                continue
            other, o_other, o_sp = (k['a'], k['oa'], k['ob']) if k['b'] == sp else (k['b'], k['ob'], k['oa'])
            if 'body' not in other and other != 'body':
                continue                               # rockers etc. move themselves - not a fixed link
            corners[c]['bars'].append({'name': k['name'], 'car': bodies[other] + o_other, 'sp': bodies[sp] + o_sp,
                                       'body': other, 'local': o_other.copy(), 'len': k['len']})
    corners['_bodies'] = bodies
    corners['_applied'] = applied
    return corners


def _pm(path):
    secs = _sections(path)
    bodies = {}
    for name, kv in secs:
        if name == 'BODY' and 'name' in kv:
            bodies[kv['name'][0].lower()] = np.array(_vec(kv.get('pos', ['(0,0,0)'])[0])[:3])
    corners = {}
    for c in _CORNERS:
        sp, wh = bodies.get(c.lower() + '_spindle'), bodies.get(c.lower() + '_wheel')
        if sp is None:
            continue
        corners[c] = {'wheel': (wh if wh is not None else sp), 'bars': []}
    for name, kv in secs:
        if name != 'BAR':
            continue
        pb, nb = (kv.get('posbody') or [''])[0].lower(), (kv.get('negbody') or [''])[0].lower()
        p, n = _vec((kv.get('pos') or [''])[0]), _vec((kv.get('neg') or [''])[0])
        if len(p) < 3 or len(n) < 3:
            continue
        for c in corners:
            sp = c.lower() + '_spindle'
            if nb == sp and pb == 'body':
                corners[c]['bars'].append({'name': (kv.get('name') or ['?'])[0], 'car': np.array(p[:3]), 'sp': np.array(n[:3]), 'body': 'body'})
            elif pb == sp and nb == 'body':
                corners[c]['bars'].append({'name': (kv.get('name') or ['?'])[0], 'car': np.array(n[:3]), 'sp': np.array(p[:3]), 'body': 'body'})
    return corners


def _split_fields(v):
    """top-level comma split of '(n,"a","b","c")' respecting quotes"""
    v = v.strip()
    if v.startswith('('):
        v = v[1:]
    if v.endswith(')'):
        v = v[:-1]
    out, cur, q = [], '', False
    for ch in v:
        if ch == '"':
            q = not q
            cur += ch
        elif ch == ',' and not q:
            out.append(cur)
            cur = ''
        else:
            cur += ch
    out.append(cur)
    return [x.strip() for x in out]


def _hdv_adjust(hdv):
    """active chassis adjustments of the HDV (the default setup = *Setting values): instructions of the matching
    *Special lines, pushrod mount points (PushrodOutboard / PushrodInboard, overridable by FLPushrodOutboard=...),
    ride heights and packers - per corner and for the third springs"""
    settings, specials, values = {}, {}, {}
    sec, last = '', None
    for raw in _lines(hdv):
        st = raw.split('//', 1)[0].strip()
        m = re.match(r'^\[(\w+)\]', st)
        if m:
            sec = m.group(1).upper()
            continue
        if '=' not in st:
            continue
        k, v = [x.strip() for x in st.split('=', 1)]
        kl = k.lower()
        values.setdefault(sec, {}).setdefault(kl, v)
        if kl.endswith('setting'):
            n = _vec(v)
            if n:
                settings[(sec, kl[:-7])] = int(n[0])
        elif kl.endswith('special'):
            f = _split_fields(v)
            n = _vec(f[0]) if f else []
            if not n:
                continue
            key = (sec, kl[:-7], int(n[0]))
            ins = f[3] if len(f) > 3 else ''
            if ins.startswith('\\+'):
                ins = ins[2:]
                specials[key] = specials.get(key, '') + ins.strip('"')
            else:
                specials[key] = ins.strip('"')
    instr = [ins for (sc, pre, n), ins in specials.items() if ins and settings.get((sc, pre)) == n]
    pushrod = {}
    for sc, c in _CORNER_SEC.items():
        d = values.get(sc, {})
        for side in ('outboard', 'inboard'):
            if 'pushrod' + side in d:
                pushrod.setdefault(c, {})[side] = d['pushrod' + side]
    for ins in instr:                                   # FLPushrodOutboard=(1:FL_Spindle:(...)) in an instruction
        for m in re.finditer(r'(FL|FR|RL|RR)Pushrod(Outboard|Inboard)\s*=\s*(\((?:[^()]|\([^()]*\))*\))', ins, re.I):
            pushrod.setdefault(m.group(1).upper(), {})[m.group(2).lower()] = m.group(3)
    steer_tab = None
    for ins in instr:
        if 'steeringinnertable' in ins.lower():
            steer_tab = [[[float(m.group(i)) for i in (1, 2, 3)], [float(m.group(i)) for i in (4, 5, 6)]]
                         for m in re.finditer(r'\((%s),(%s),(%s)\):\((%s),(%s),(%s)\)' % ((r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?',) * 6), ins)]
    return {'instr': instr, 'pushrod': pushrod, 'values': values, 'settings': settings, 'steerTable': steer_tab}


def _mounts(spec, bodies):
    """'(1:FL_Spindle:(x,y,z))' -> [(weight, body lower, offset)]"""
    out = []
    for m in re.finditer(r'([-+]?[\d.eE+-]+)\s*:\s*(\w+)\s*:\s*\(([^)]*)\)', spec or ''):
        out.append((float(m.group(1)), m.group(2).lower(), np.array((_vec(m.group(3)) + [0, 0, 0])[:3])))
    return out


def _hdv_values_any(hdv):
    out = {}
    for raw in _lines(hdv):
        st = raw.split('//', 1)[0].strip()
        if '=' in st and not st.startswith('['):
            k, v = st.split('=', 1)
            out.setdefault(k.strip().lower(), v.strip().strip('"'))
    return out


def _hdv_info(hdv):
    """Physics file, steering lock and rack ends from the HDV."""
    info = {'ultra': None, 'pm': None, 'lock': None, 'inner': [], 'align': True}
    sec = None
    for line in _lines(hdv):
        s = line.split('//', 1)[0].strip()
        m = re.match(r'^\[(\w+)\]', s)
        if m:
            sec = m.group(1).upper()
            continue
        if '=' not in s:
            continue
        k, v = [x.strip() for x in s.split('=', 1)]
        kl = k.lower()
        if kl == 'ultrachassis':
            info['ultra'] = v.strip('"')
        elif kl in ('physicalmodelfile', 'pmfile') or (v.lower().endswith('.pm') and not info['pm']):
            info['pm'] = v.strip('"')
        elif kl == 'steerlockrange':
            info['lockRange'] = _vec(v)
        elif kl == 'steerlocksetting':
            info['lockSetting'] = int(_vec(v)[0]) if _vec(v) else 0
        elif kl == 'steeringinnertable' and sec == 'CONTROLS':
            pts = [_vec(x) for x in v.split(':')]
            if len(pts) == 2 and all(len(p) >= 3 for p in pts):
                info['inner'].append(pts)
        elif kl == 'alignwheels':
            info['align'] = v.strip() not in ('0', 'false')
    lr = info.get('lockRange')
    if lr and len(lr) >= 1:
        st = info.get('lockSetting', 0)
        info['lock'] = lr[0] + (lr[1] if len(lr) > 1 else 0) * st
    return info


# ------------------------------------------------------------------------- setup ---
_CACHE = {}


def _part_points(project, pid):
    info = project._safe_info(pid)
    if not info:
        return None
    V, T = TGM._mesh_world(info)
    pts = [V]
    if T is not None and len(T):
        T = np.asarray(T, np.int64).reshape(-1, 3)
        pts.append(V[T].mean(1))                             # triangle centres (big faces without vertices inside)
    return np.concatenate(pts).astype(np.float32)


def setup(project):
    """Corners (GL), steering, which parts move with which wheel, the wheel envelopes, the obstacle points."""
    key = (id(project), getattr(project, 'path', None))
    if key in _CACHE:
        c = _CACHE[key]
        hp = c.get('hdvPath')
        try:
            if not hp or os.path.getmtime(hp) == c.get('hdvTime'):
                return c
        except OSError:
            return c
        _CACHE.clear()                                   # HDV changed outside: read again
    res = {'ok': False, 'notes': [], 'corners': {}, 'source': None}
    st = TGM.find_setup(project)
    hdv = st.get('hdv')
    if not hdv:
        res['notes'].append('Keine HDV gefunden - Lenkung und Radaufhängung unbekannt.')
        return res
    hi = _hdv_info(hdv)
    finder = TGM.make_finder(project)
    corners = {}
    if hi['ultra']:
        p = finder(hi['ultra'])
        if p:
            adj = _hdv_adjust(hdv)
            corners = _ultra(p, adj['instr'])
            res['source'] = os.path.basename(p)
            res['notes'] += _ULTRA_NOTES
            res['adjust'] = adj
            res['bodies'] = corners.pop('_bodies', {})
            res['adjusted'] = corners.pop('_applied', 0)
            if adj['steerTable']:
                hi['inner'] = adj['steerTable']           # active setup variant brings its own steering table
        else:
            res['notes'].append('UltraChassis %s nicht gefunden.' % hi['ultra'])
    if not corners:
        pm = finder(hi['pm']) if hi['pm'] else finder(os.path.splitext(os.path.basename(hdv))[0] + '.pm')
        if pm:
            corners = _pm(pm)
            res['source'] = os.path.basename(pm)
    wheels = TGM.wheels(project)
    gfx = {w['wheel']: w for w in wheels}
    if not wheels:
        res['notes'].append('Keine Reifen-GMT gefunden.')
        return res
    # parts that move with a wheel: tyre + spindle instance, else tyre / rim of the folder
    moving = {}
    for w in wheels:
        ids = set()
        for p in project.parts:
            g = (p.get('group') or '').upper()
            if g in (_TIRE_INST.get(w['wheel']), _SPINDLE_INST.get(w['wheel'])):
                ids.add(p['id'])
        ids.add(w['tire']['id'])
        if w.get('rim'):
            ids.add(w['rim']['id'])
        moving[w['wheel']] = sorted(ids)
    all_moving = set(i for v in moving.values() for i in v)
    # suspension meshes (wishbones, pushrods ...): rF2 deforms them with the wheel ("suspension deformation" - the inner
    # ends stay at the car, the outer ends follow the upright). Not an obstacle; drawn deformed the same way here.
    # suspension meshes: rF2 deforms them per corner, configured in the damage file of the HDV
    # (DamageFile=...): FLSuspIns=<instance>, FLSuspConn=(a,b). For every vertex of that instance it takes |x| in the
    # car frame, lo = min|x| + a * (max|x| - min|x|), hi = min|x| + b * (max|x| - min|x|), weight = clamp((|x|-lo)/(hi-lo))
    # and blends between the car (0) and the spindle (1). Without damage file entries: meshes named like suspension
    # parts, ramp between the inner and outer link mounts.
    susp, susp_def = {}, {}
    wc = {w['wheel']: np.array(w['center']) for w in wheels}
    dmg = {}
    hvals = _hdv_values_any(hdv)
    dfile = finder(hvals.get('damagefile')) if hvals.get('damagefile') else None
    if dfile:
        for _sec, kv in _sections(dfile):
            for k in ('fl', 'fr', 'rl', 'rr'):
                if k + 'suspins' in kv:
                    dmg.setdefault(k.upper(), {})['ins'] = kv[k + 'suspins'][0].strip().upper()
                if k + 'suspconn' in kv:
                    dmg.setdefault(k.upper(), {})['conn'] = (_vec(kv[k + 'suspconn'][0]) + [0.0, 1.0])[:2]
    by_inst = {}
    for p in project.parts:
        by_inst.setdefault((p.get('group') or '').upper(), []).append(p)
    # parts of the SuspIns instances, each given to the wheel it actually sits at (a Spinner GEN may put another
    # mesh into the same DEBRIS instance than the graphics GEN does)
    got = {}
    for c0, dd in dmg.items():
        for p in by_inst.get(dd.get('ins') or '#', []):
            if p['id'] in all_moving or p.get('missing') or p.get('removed'):
                continue
            info = project._safe_info(p['id'])
            if not info:
                continue
            V, _T = TGM._mesh_world(info)
            cen = (V.min(0) + V.max(0)) / 2
            c = min(wc, key=lambda k: (np.sign(cen[0]) != np.sign(wc[k][0]), abs(cen[2] - wc[k][2])))
            got.setdefault(c, []).append((p['id'], np.abs(V[:, 0])))
    for c, items in got.items():
        ax = np.concatenate([x for _i, x in items])
        mn, mx = float(ax.min()), float(ax.max())
        a0, a1 = (dmg.get(c) or {}).get('conn', [0.0, 1.0])
        susp[c] = [i for i, _x in items]
        susp_def[c] = [round(mn + (mx - mn) * a0, 5), round(mn + (mx - mn) * a1, 5), float(np.sign(wc[c][0]) or 1.0)]
    if dmg:
        res['damage'] = os.path.basename(dfile)
        if got:
            res['notes'].append('Querlenker verformen sich wie im Spiel (%s: %s).' % (os.path.basename(dfile), ', '.join(
                '%sSuspIns=%s' % (k, v.get('ins', '?')) for k, v in sorted(dmg.items()))))
    for p in project.parts:
        if dmg or p['id'] in all_moving or p.get('env') or p.get('removed') or p.get('missing'):
            continue
        nm = os.path.basename(p['file']).lower() + ' ' + (p.get('group') or '').lower()
        if not re.search(r'susp|wishbone|pushrod|pullrod|tie_?rod|track_?rod|a_?arm|upright', nm):
            continue
        info = project._safe_info(p['id'])
        if not info:
            continue
        V, _T = TGM._mesh_world(info)
        cen = (V.min(0) + V.max(0)) / 2
        best = min(wc, key=lambda c: (np.sign(cen[0]) != np.sign(wc[c][0]), abs(cen[2] - wc[c][2])), default=None)
        if best:
            susp.setdefault(best, []).append(p['id'])
    susp_ids = set(i for v in susp.values() for i in v)
    # obstacles: every other visible mesh
    obst, owner = [], []
    for p in project.parts:
        if p['id'] in all_moving or p['id'] in susp_ids or p.get('env') or p.get('removed') or p.get('missing') or not p.get('visible', True):
            continue
        g = (p.get('group') or '').upper()
        if re.search(r'(TIRE|SPINDLE)$', g) or re.search(r'HEAT|BACKFIRE|LIGHT|SHADOW|_FX|FX_', g + ' ' + os.path.basename(p['file']).upper()):
            continue
        pts = _part_points(project, p['id'])
        if pts is None or not len(pts):
            continue
        obst.append(pts)
        owner.append(np.full(len(pts), p['id'], np.int32))
    O = np.concatenate(obst) if obst else np.zeros((0, 3), np.float32)
    Oid = np.concatenate(owner) if owner else np.zeros(0, np.int32)
    names = {p['id']: os.path.basename(p['file']) for p in project.parts}
    out = {}
    for c, w in gfx.items():
        env = _envelope(w)
        ent = {'wheel': c, 'center': np.array(w['center']), 'outSign': w['outSign'], 'env': env, 'moving': moving.get(c, []),
               'bars': [], 'steer': None, 'susp': susp.get(c, [])}
        k = corners.get(c)
        if k and len(k['bars']) >= 5:
            delta = np.array(w['center']) - _gl(k['wheel']) if hi['align'] else np.zeros(3)
            for b in k['bars']:
                ent['bars'].append({'name': b['name'], 'car': _gl(b['car']) + delta, 'sp': _gl(b['sp']) + delta,
                                    'local': b.get('local'), 'body': b.get('body'), 'len': b.get('len')})
            ent['L'] = np.array([b['len'] if b.get('len') else np.linalg.norm(b['car'] - b['sp']) for b in ent['bars']])
            xi = float(np.median([abs(b['car'][0]) for b in ent['bars']]))
            xo = float(np.median([abs(b['sp'][0]) for b in ent['bars']]))
            ent['def'] = susp_def.get(c) or [round(xi, 4), round(max(xo, xi + 0.01), 4), float(np.sign(w['center'][0]) or 1.0)]
            si = [i for i, b in enumerate(ent['bars']) if re.search(r'steer|tie', b['name'], re.I)]
            ent['steer'] = si[0] if si and c[0] == 'F' else None
            # pushrod (spring / damper / bump stop act along it): mount points on the spindle and the car
            prs = (res.get('adjust') or {}).get('pushrod', {}).get(c) or {}
            bods = res.get('bodies') or {}
            ob, ib = _mounts(prs.get('outboard'), bods), _mounts(prs.get('inboard'), bods)
            if ob and ib and all(m[1] == c.lower() + '_spindle' and m[1] in bods for m in ob) and all(m[1] in bods for m in ib):
                pt = lambda ms: sum(m[0] * (bods[m[1]] + m[2]) for m in ms) / (sum(m[0] for m in ms) or 1.0)   # noqa: E731
                ent['push'] = (_gl(pt(ob)) + delta, _gl(pt(ib)) + delta)
        out[c] = ent
    if res.get('adjusted'):
        res['notes'].append('%d Fahrwerks-Anpassungen der Standard-Abstimmung angewendet (z. B. CamberSpecial).' % res['adjusted'])
    res.update({'ok': True, 'corners': out, 'O': O, 'Oid': Oid, 'names': names, 'lock': hi['lock'],
                'inner': hi['inner'], 'hdv': os.path.basename(hdv), 'hdvPath': hdv, 'hdvTime': os.path.getmtime(hdv)})
    kin = [c for c in out if out[c]['bars']]
    if not kin:
        res['notes'].append('Keine Radaufhängung (UltraChassis / .pm) gefunden - Räder werden nur gerade verschoben und um eine senkrechte Achse gedreht.')
    _CACHE.clear()
    _CACHE[key] = res
    return res


def _envelope(w):
    """max radius of tyre + rim per lateral slice (outboard +), 1 mm grid. Each profile is interpolated onto the
    common grid inside its own lateral range (re-binning both onto one grid left holes where only rim samples fell)"""
    prs = [w[k]['profile'] for k in ('tire', 'rim') if w.get(k) and w[k].get('profile') and w[k]['profile'].get('x')]
    if not prs:
        return None
    lo = min(pr['x'][0] for pr in prs) - 0.001
    hi = max(pr['x'][-1] for pr in prs) + 0.001
    step = 0.001
    g = np.arange(lo, hi + step, step)
    r = np.zeros(len(g))
    for pr in prs:
        x, rm = np.array(pr['x']), np.array(pr['rmax'])
        inside = (g >= x[0] - 0.0015) & (g <= x[-1] + 0.0015)
        # each profile value is the max of a 2 mm slice: take the max over the slice width (conservative)
        v = np.max([np.interp(g + o, x, rm) for o in (-0.001, -0.0005, 0.0, 0.0005, 0.001)], axis=0)
        r = np.where(inside, np.maximum(r, v), r)
    return {'lo': float(lo), 'step': step, 'r': r}


# -------------------------------------------------------------------- kinematics ---
def _rot(w):
    th = float(np.linalg.norm(w))
    if th < 1e-12:
        return np.eye(3)
    k = w / th
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(th) * K + (1 - np.cos(th)) * K @ K


def _solve(ent, bump, rack, x0=None):
    """spindle pose (R, t) for wheel position bump (m, relative to the graphics) and rack shift (m, +x).
    Solved step by step from the rest position (continuation) so the links stay on the real branch. A step that does
    not converge, or turns the spindle by more than 6 degrees at once (the links went over centre), ends the path:
    the last reachable pose is returned and ent['_res'] > 0.1 mm marks it as not reachable - the wheel then stays at
    the end of its travel instead of jumping somewhere."""
    C0 = ent['center']
    bars = ent['bars']
    ent['_res'] = 0.0
    if not bars:
        return np.eye(3), np.array([0, bump, 0.0])
    car0 = np.array([b['car'] for b in bars])
    sp = np.array([b['sp'] for b in bars]) - C0
    L = ent['L']
    x = np.zeros(6)
    n = int(max(1, np.ceil(abs(rack) / 0.001), np.ceil(abs(bump) / 0.0025)))
    good = x.copy()
    bad = 0.0
    for k in range(1, n + 1):
        bk, rk = bump * k / n, rack * k / n
        car = car0.copy()
        if ent['steer'] is not None:
            car[ent['steer']] = car[ent['steer']] + np.array([rk, 0, 0])

        def f(x):
            R = _rot(x[:3])
            q = sp @ R.T + C0 + x[3:]
            r = np.linalg.norm(q - car, axis=1) - L
            return np.concatenate([r, [x[4] - bk]])
        x = good.copy()
        for _ in range(25):
            r = f(x)
            if float(np.max(np.abs(r))) < 1e-10:
                break
            J = np.zeros((6, 6))
            h = 1e-7
            for i in range(6):
                dx = np.zeros(6)
                dx[i] = h
                J[:, i] = (f(x + dx) - r) / h
            try:
                step = np.linalg.lstsq(J, r, rcond=None)[0]
            except np.linalg.LinAlgError:
                break
            x = x - step
        res = float(np.max(np.abs(f(x))))
        turn = float(np.degrees(np.linalg.norm(x[:3] - good[:3])))
        if res > 1e-4 or turn > 6.0 or not np.all(np.isfinite(x)):
            bad = max(res, 1e-3)
            break
        good = x
    ent['_res'] = bad
    return _rot(good[:3]), good[3:].copy()


def _defl(ent, b):
    """pushrod compression (m) at wheel position b (m, relative to the graphics = ride height 0) - 0 at b = 0.
    Without pushrod data: wheel travel itself (motion ratio 1)."""
    if not ent.get('push') or not ent['bars']:
        return b
    O, I = ent['push']
    key = round(b, 7)
    cache = ent.setdefault('_dc', {})
    if key not in cache:
        def ln(bb):
            R, t = _solve(ent, bb, 0.0)
            return float(np.linalg.norm((O - ent['center']) @ R.T + ent['center'] + t - I))
        if '_l0' not in ent:
            ent['_l0'] = ln(0.0)
        cache[key] = ent['_l0'] - ln(b)
    return cache[key]


def _b_for(ent, d):
    """wheel position b at which the pushrod compression equals d"""
    lo, hi = -0.3, 0.3
    for _ in range(40):
        mid = (lo + hi) / 2
        if _defl(ent, mid) < d:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _stops(S):
    """rF2 bump stops in wheel travel: static wheel position = -RideHeight (the GMT car sits at ride height 0,
    the body is lifted by the ride height); bump stop where the pushrod compression = bump travel - packer, rebound
    stop where it = rebound travel (both relative to ride height 0, in pushrod / spring units). The third spring
    uses the same compression with both wheels moving together. Checked against the ModDev display
    'Bumpstop Offsets' (Ctrl+K) = compression at static minus the stop."""
    adj = S.get('adjust') or {}
    vals = adj.get('values') or {}
    sets = adj.get('settings') or {}
    rng = lambda sec, key: _range_val(vals.get(sec, {}).get(key + 'range'), sets.get((sec, key), 0))   # noqa: E731
    out = {}
    for sec, c in _CORNER_SEC.items():
        e = S['corners'].get(c)
        d = vals.get(sec)
        if not e or not d:
            continue
        if 'bumpstoptravels' in d:
            n = _vec(d['bumpstoptravels']) + [0, 0]
            bump, reb = n[0], n[1]
        else:
            bump, reb = (_vec(d.get('bumptravel', '0')) or [0])[0], (_vec(d.get('reboundtravel', '-0.1')) or [-0.1])[0]
        rh, pk = rng(sec, 'rideheight'), rng(sec, 'packer')
        bs = -rh
        out[c] = {'static': bs, 'rh': rh, 'packer': pk, 'bump': bump, 'rebound': reb,
                  'bUp': _b_for(e, bump - pk), 'bDown': _b_for(e, reb), 'mr': (_defl(e, 0.001) - _defl(e, -0.001)) / 0.002,
                  'offset': round((_defl(e, bs) - (bump - pk)) * 1000, 2)}
    su = vals.get('SUSPENSION', {})
    for ax, pre in (('F', 'front3rd'), ('R', 'rear3rd')):
        c = ax + 'L'
        e = S['corners'].get(c)
        if not e or c not in out:
            continue
        if pre + 'bumpstoptravels' in su:
            n = _vec(su[pre + 'bumpstoptravels']) + [0, 0]
            bump, reb = n[0], n[1]
        elif pre + 'bumptravel' in su:
            bump, reb = (_vec(su[pre + 'bumptravel']) or [0])[0], (_vec(su.get(pre + 'reboundtravel', '-0.1')) or [-0.1])[0]
        else:
            continue
        pk = rng('SUSPENSION', pre + 'packer')
        bs = out[c]['static']
        out[ax + '3'] = {'static': bs, 'packer': pk, 'bump': bump, 'rebound': reb, 'bUp': _b_for(e, bump - pk), 'bDown': _b_for(e, reb),
                         'offset': round((_defl(e, bs) - (bump - pk)) * 1000, 2),
                         'spring': bool(_vec(su.get(pre + 'bumpstopspring', '0')) and _vec(su.get(pre + 'bumpstopspring', '0'))[0] > 0)}
    for sec, c in _CORNER_SEC.items():
        if c in out:
            sp = _vec(vals.get(sec, {}).get('bumpstopspring', '0'))
            out[c]['spring'] = bool(sp and sp[0] > 0)
    return out


def _get_stops(S):
    if 'stops' not in S:
        try:
            S['stops'] = _stops(S)
        except Exception:            # noqa - no ride height data: graphics = static
            S['stops'] = {}
    return S['stops']


def _static(S, c):
    """wheel position of the static car relative to the graphics (= -ride height)"""
    st = _get_stops(S).get(c)
    return st['static'] if st else 0.0


def _yaw(R, out_sign):
    """steer angle of the wheel in degrees, + = front of the wheel to the left (+x)"""
    a = R @ np.array([1.0, 0, 0])                      # wheel axis
    return float(np.degrees(np.arctan2(-a[2], a[0])))  # rotation about +y of the x axis


def _lock_rack(S):
    """rack shift for full lock: from SteeringInnerTable (exact rack ends) or SteerLock (wheel angle)"""
    fl, fr = S['corners'].get('FL'), S['corners'].get('FR')
    if not fl or fl['steer'] is None:
        return None
    if S['inner']:
        b = fl['bars'][fl['steer']]
        loc = b.get('local')
        xs = [p[0][0] for p in S['inner']]
        if loc is not None:
            d = [x - loc[0] for x in xs]
            m = max(d, key=abs)
            if abs(m) > 1e-4:
                return abs(m)
    return _rack_for_lock(S, S.get('lock'))


def _rack_for_lock(S, lock):
    """rack shift at which the mean steer angle of both front wheels = lock (degrees)"""
    fl, fr = S['corners'].get('FL'), S['corners'].get('FR')
    if not fl or fl['steer'] is None:
        return None
    if not lock:
        return 0.02
    lo, hi = 0.0, 0.15
    for _ in range(40):
        mid = (lo + hi) / 2
        y = abs(_yaw(_solve(fl, _static(S, 'FL'), mid)[0], 1)) + (abs(_yaw(_solve(fr, _static(S, 'FR'), mid)[0], 1)) if fr and fr['bars'] else 0)
        y /= (2 if fr and fr['bars'] else 1)
        if y < lock:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _rack_sign(S, d):
    """sign so that +steer turns the wheels to the left"""
    fl = S['corners'].get('FL')
    if not fl or fl['steer'] is None:
        return 1.0
    return 1.0 if _yaw(_solve(fl, _static(S, 'FL'), d)[0], 1) > 0 else -1.0


# --------------------------------------------------------------------- collision ---
def _check(S, ent, R, t, margin=0.005, limit=1500):
    env = ent['env']
    if env is None or not len(S['O']):
        return {'gap': None, 'hits': [], 'near': [], 'parts': []}
    C0 = ent['center']
    Cn = C0 + t
    rmax_all = float(env['r'].max())
    halfw = max(abs(env['lo']), abs(env['lo'] + env['step'] * (len(env['r']) - 1))) + 0.05
    O = S['O']
    d = O - Cn
    pre = (np.abs(d[:, 0]) < halfw + rmax_all) & (np.abs(d[:, 1]) < rmax_all + 0.05) & (np.abs(d[:, 2]) < rmax_all + 0.05)
    idx = np.nonzero(pre)[0]
    # attachments of the links at the spindle (ball joints of the modelled arms) are no collision
    if ent['bars'] and len(idx):
        J = np.array([b['sp'] for b in ent['bars']]) - C0
        Jn = J @ R.T + Cn
        dj = np.min(np.linalg.norm(O[idx][:, None, :] - Jn[None, :, :], axis=2), axis=1)
        idx = idx[dj > 0.06]
    if not len(idx):
        return {'gap': None, 'free': True, 'hits': [], 'near': [], 'parts': []}
    q = d[idx] @ R                                        # into the wheel frame (R^T d)
    u = q[:, 0] * ent['outSign']
    r = np.hypot(q[:, 1], q[:, 2])
    lo, st, er = env['lo'], env['step'], env['r']
    hi = lo + st * (len(er) - 1)
    k = np.clip(np.round((u - lo) / st).astype(int), 0, len(er) - 1)
    rm = er[k]
    rad = r - rm
    lat = np.maximum(0, np.maximum(lo - u, u - hi))
    inside = (lat == 0) & (rad < 0)
    gap = np.where(inside, rad, np.hypot(np.maximum(rad, 0), lat))
    gmin = float(gap.min())
    hit = idx[inside]
    near = idx[(~inside) & (gap < margin)]
    parts = []
    if len(hit):
        ids, cnt = np.unique(S['Oid'][hit], return_counts=True)
        for i, n in sorted(zip(ids.tolist(), cnt.tolist()), key=lambda x: -x[1]):
            dep = float(-gap[inside][S['Oid'][hit] == i].min())
            parts.append({'id': i, 'name': S['names'].get(i, str(i)), 'n': n, 'depth': round(dep * 1000, 1)})
    pick = lambda a: O[a[:limit]].round(4).tolist()      # noqa: E731
    nearest = S['names'].get(int(S['Oid'][idx[int(np.argmin(gap))]]), '?')
    return {'gap': round(gmin * 1000, 1), 'free': False, 'nearest': nearest, 'hits': pick(hit), 'near': pick(near), 'parts': parts}


def _mat(C0, R, t):
    """column-major 4x4 for WebGL: p' = R (p - C0) + C0 + t"""
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = C0 + t - R @ C0
    return [round(float(v), 7) for v in M.T.reshape(-1)]


def _rack(S, rack_mm=None, lock_deg=None):
    """rack shift (m, signed so that + = left) for full lock - from the edited value or the HDV"""
    if 'rackLock' not in S:
        d0 = _lock_rack(S)
        S['rackLock'] = d0
        S['rackSign'] = _rack_sign(S, d0) if d0 else 1.0
    if rack_mm is not None:
        d = rack_mm / 1000.0
    elif lock_deg is not None:
        key = ('lock', round(lock_deg, 3))
        if key not in S:
            S[key] = _rack_for_lock(S, lock_deg) or 0.0
        d = S[key]
    else:
        d = S.get('rackLock') or 0.0
    return d * S.get('rackSign', 1.0)


def _lock_angles(S, d):
    angles = {}
    for c in ('FL', 'FR'):
        e = S['corners'].get(c)
        if e and e['bars'] and d:
            angles[c] = round(_yaw(_solve(e, _static(S, c), d)[0], e['outSign']), 2)
    return angles


def _rack_max(S):
    """largest rack shift (mm) the steering links reach in both directions at the static ride height"""
    if 'rackMax' in S:
        return S['rackMax']
    fl, fr = S['corners'].get('FL'), S['corners'].get('FR')
    if not fl or fl['steer'] is None:
        S['rackMax'] = None
        return None
    sg = S.get('rackSign', 1.0)

    def ok(d):
        for c, e in (('FL', fl), ('FR', fr)):
            if not e or not e['bars']:
                continue
            for s_ in (-1.0, 1.0):
                _solve(e, _static(S, c), d * s_ * sg)
                if e.get('_res', 0) > 1e-4:
                    return False
        return True
    lo, hi = 0.0, 0.15
    if ok(hi):
        S['rackMax'] = 150.0
        return 150.0
    for _ in range(14):
        mid = (lo + hi) / 2
        if ok(mid):
            lo = mid
        else:
            hi = mid
    S['rackMax'] = round(lo * 1000 - 0.05, 1)
    return S['rackMax']


def info(project):
    S = setup(project)
    if not S['ok']:
        return {'ok': False, 'notes': S['notes']}
    d = _rack(S)
    ed = hdv_edit_info(S['hdvPath'])
    if ed['steer']['mode'] == 'range' and d:
        ed['steer']['rack'] = round(abs(d) * 1000, 3)
    # travel to the stops from the static car, through the pushrod kinematics (checked against ModDev Ctrl+K)
    st = _get_stops(S)
    for c, v in st.items():
        rec = {'up': round((v['bUp'] - v['static']) * 1000, 2), 'down': round(-(v['bDown'] - v['static']) * 1000, 2) * -1,
               'offset': v['offset'], 'spring': v.get('spring'), 'kin': True}
        if c in ed['corners']:
            ed['corners'][c].update(rec)
            ed['corners'][c]['mr'] = round(v.get('mr', 1.0), 4)
        elif c[1] == '3' and c[0] in ed['third']:
            ed['third'][c[0]].update(rec)
    return {'ok': True, 'notes': S['notes'], 'source': S['source'], 'hdv': S['hdv'], 'lock': S['lock'], 'rackMax': _rack_max(S),
            'rackLock': round(abs(float(d)) * 1000, 2) if d else None, 'lockAngles': _lock_angles(S, d),
            'wheels': {c: {'kin': bool(e['bars']), 'moving': e['moving'], 'links': [b['name'] for b in e['bars']]} for c, e in S['corners'].items()},
            'obstacles': int(len(S['O'])), 'edit': ed}


def pose(project, steer=0.0, bump_f=0.0, bump_r=0.0, check=True, rack_mm=None, lock_deg=None, margin=0.005):
    """steer -1..1 (of full lock, + = left), bump in m (+ = up / compressed); rack_mm / lock_deg = edited full lock"""
    S = setup(project)
    if not S['ok']:
        return {'ok': False, 'notes': S['notes']}
    full = _rack(S, rack_mm, lock_deg)
    d = full * steer
    out = {}
    for c, e in S['corners'].items():
        bump = (bump_f if c[0] == 'F' else bump_r) + _static(S, c)      # slider 0 = static car
        if e['bars']:
            R, t = _solve(e, bump, d if c[0] == 'F' else 0.0)
        else:                                            # no physics: turn about a vertical axis through the centre
            a = np.radians((lock_deg or S.get('lock') or 20) * steer) if c[0] == 'F' else 0.0
            R = _rot(np.array([0, a, 0]))
            t = np.array([0, bump, 0.0])
        inv = e.get('_res', 0) > 1e-4
        xs = None                                        # suspension arms: follow the upright without the steer rotation -
        if e['bars'] and c[0] == 'F' and abs(d) > 1e-9 and e.get('susp'):   # ball joints sit on the steering axis
            Rs, ts = _solve(e, bump, 0.0)
            xs = _mat(e['center'], Rs, ts)
        w = {'xf': _mat(e['center'], R, t), 'xfSusp': xs, 'angle': round(_yaw(R, e['outSign']), 2), 'invalid': inv,
             'susp': e.get('susp', []), 'def': e.get('def'),
             'camber': round(-float(np.degrees(np.arcsin(np.clip((R @ np.array([1.0, 0, 0]))[1] * e['outSign'], -1, 1)))), 2),
             'moving': e['moving']}
        if check:
            w.update(_check(S, e, R, t, margin))
        out[c] = w
    body, lift = _body(S, {c: np.array(w['xf']).reshape(4, 4).T for c, w in out.items()})
    return {'ok': True, 'wheels': out, 'body': body, 'lift': lift,
            'lockAngles': _lock_angles(S, full) if (rack_mm is not None or lock_deg is not None) else None}


def _body(S, M):
    """The car stands on its wheels: rF2 draws the wheels relative to the body (wheel graphics = physics wheel
    position - body offset) and the body sits where the physics puts it - on the tyres. So instead
    of letting the wheels sink into the floor, the whole car is lifted / pitched / rolled until every wheel centre is
    back at the height of its GMT (least squares plane through the 4 wheels).
    M = wheel transforms (row-major 4x4, body frame). Returns (column-major body matrix, lift per corner in mm)."""
    P, D = [], []
    for c, e in S['corners'].items():
        if c not in M:
            continue
        c0 = np.array(e['center'], float)
        p = M[c][:3, :3] @ c0 + M[c][:3, 3]
        P.append(c0); D.append(p[1] - c0[1])
    if len(P) < 3:
        return None, {}
    P, D = np.array(P), np.array(D)
    A = np.c_[np.ones(len(P)), P[:, 0], P[:, 2]]
    a, b, cz = np.linalg.lstsq(A, D, rcond=None)[0]       # wheel height change = a + b x + c z (body frame)
    # body: y' = y - (a + b x + c z) for small angles -> rotation about z by -b, about x by +c, then lift
    rz, rx = np.arctan(-b), np.arctan(cz)
    Rz = np.array([[np.cos(rz), -np.sin(rz), 0], [np.sin(rz), np.cos(rz), 0], [0, 0, 1]])
    Rx = np.array([[1, 0, 0], [0, np.cos(rx), -np.sin(rx)], [0, np.sin(rx), np.cos(rx)]])
    R = Rx @ Rz
    B = np.eye(4); B[:3, :3] = R
    # translation: least squares so the wheel centres end at their GMT heights again
    q = np.array([(R @ (p0 + np.array([0, d, 0])))[1] for p0, d in zip(P, D)])
    B[1, 3] = float(np.mean(P[:, 1] - q))
    lift = {}
    for c, e in S['corners'].items():
        if c in M:
            c0 = np.array(e['center'], float)
            lift[c] = round(float((B[:3, :3] @ c0 + B[:3, 3])[1] - c0[1]) * 1000, 1)   # body above the wheel, at it
    return [float(x) for x in B.T.reshape(-1)], lift


def sweep(project, travel, steps=5, rack_mm=None, lock_deg=None):
    """full lock left .. right x (droop limit, static, bump limit) - travel {'F': (up_m, down_m), 'R': ...};
    worst gap per wheel"""
    worst = {}
    tf, tr = travel.get('F', (0.04, -0.04)), travel.get('R', (0.04, -0.04))
    for s in np.linspace(-1, 1, steps):
        for k in range(3):
            bf, br = (tf[1], tr[1]) if k == 0 else (0.0, 0.0) if k == 1 else (tf[0], tr[0])
            p = pose(project, float(s), bf, br, rack_mm=rack_mm, lock_deg=lock_deg)
            for c, w in p.get('wheels', {}).items():
                if w.get('gap') is None:
                    continue
                cur = worst.get(c)
                if cur is None or w['gap'] < cur['gap']:
                    worst[c] = {'gap': w['gap'], 'steer': round(float(s), 2), 'bump': round((bf if c[0] == 'F' else br) * 1000, 1),
                                'parts': w['parts']}
    return {'ok': True, 'worst': worst}


def _clear(w, margin_mm):
    if w.get('invalid'):
        return False                                     # links cannot reach this position
    if w.get('free') or w.get('gap') is None:
        return True
    return not w.get('hits') and w['gap'] >= margin_mm


def _why(project, cs, poses, margin_mm, rack_mm=None, lock_deg=None):
    """what stops it just beyond the found limit: 'links' (geometry runs out) or 'contact' with part names"""
    parts, links = {}, False
    for s, bf, br in poses:
        p = pose(project, s, bf, br, rack_mm=rack_mm, lock_deg=lock_deg, margin=margin_mm / 1000)
        for c in cs:
            w = p['wheels'].get(c)
            if not w:
                continue
            if w.get('invalid'):
                links = True
            elif not _clear(w, margin_mm):
                for x in w.get('parts') or []:
                    parts[x['name']] = max(parts.get(x['name'], 0), x['depth'])
                if not w.get('parts') and w.get('nearest'):
                    parts.setdefault(w['nearest'], 0)
    if parts:
        return {'reason': 'contact', 'parts': sorted(parts, key=lambda k: -parts[k])}
    return {'reason': 'links' if links else None}


def fit_steer(project, margin_mm, bumps_m):
    """largest full lock (rack mm) at which both front wheels keep margin_mm at every given front travel"""
    S = setup(project)
    if not S['ok']:
        return {'ok': False, 'notes': S['notes']}
    _rack(S)
    d0 = abs(S.get('rackLock') or 0.02)

    def ok(d_mm):
        for s in (-1.0, 1.0):
            for b in bumps_m:
                p = pose(project, s, b, 0.0, rack_mm=d_mm, margin=margin_mm / 1000)
                for c in ('FL', 'FR'):
                    w = p['wheels'].get(c)
                    if w and not _clear(w, margin_mm):
                        return False
        return True
    hi = max(d0 * 2.5, 0.05) * 1000
    if ok(hi):
        return {'ok': True, 'rack': round(hi, 2), 'limit': False, 'lockAngles': _lock_angles(S, _rack(S, hi))}
    lo = 0.0
    if not ok(lo):
        return {'ok': True, 'rack': 0.0, 'limit': True, 'blocked': True, 'lockAngles': {}}
    for _ in range(18):
        mid = (lo + hi) / 2
        if ok(mid):
            lo = mid
        else:
            hi = mid
    why = _why(project, ('FL', 'FR'), [(sg, b, 0.0) for sg in (-1.0, 1.0) for b in bumps_m], margin_mm, rack_mm=hi)
    return dict({'ok': True, 'rack': round(lo, 2), 'limit': True, 'lockAngles': _lock_angles(S, _rack(S, lo))}, **why)


def fit_bump(project, axle, margin_mm, rack_mm=None, lock_deg=None):
    """largest bump travel (m, wheel up) of an axle without contact; front: straight and at full lock"""
    S = setup(project)
    if not S['ok']:
        return {'ok': False, 'notes': S['notes']}
    steers = (-1.0, 0.0, 1.0) if axle == 'F' else (0.0,)
    cs = ('FL', 'FR') if axle == 'F' else ('RL', 'RR')

    def ok(b):
        for s in steers:
            p = pose(project, s, b if axle == 'F' else 0.0, b if axle == 'R' else 0.0, rack_mm=rack_mm, lock_deg=lock_deg, margin=margin_mm / 1000)
            for c in cs:
                w = p['wheels'].get(c)
                if w and not _clear(w, margin_mm):
                    return False
        return True
    lo, hi = 0.0, 0.15
    if ok(hi):
        return {'ok': True, 'up': round(hi * 1000, 1), 'limit': False}
    if not ok(lo):
        return {'ok': True, 'up': 0.0, 'limit': True, 'blocked': True}
    for _ in range(16):
        mid = (lo + hi) / 2
        if ok(mid):
            lo = mid
        else:
            hi = mid
    why = _why(project, cs, [(sg, hi if axle == 'F' else 0.0, hi if axle == 'R' else 0.0) for sg in steers], margin_mm, rack_mm, lock_deg)
    return dict({'ok': True, 'up': round(lo * 1000, 1), 'limit': True}, **why)


# ------------------------------------------------------------------ HDV editing ---
# Full lock:   [CONTROLS] SteeringInnerTable=(L inner x,y,z):(R inner x,y,z), one line per lock direction (rack ends in
#              the front subbody); SteerLockSpecial=(n,"..","..","...SteeringInnerTable=(..):(..)") = setup variants
#              with their own table. Without a table: SteerLockRange=(min, step, count) + SteerLockSetting (degrees).
# Travel:      [FRONTLEFT] ... BumpStopTravels=(bump, rebound) or BumpTravel= / ReboundTravel=; wheel travel up to the
#              bump stop = RideHeight + bump - packer, down to the rebound stop = RideHeight + rebound (rF2 convention,
#              ride height and packer of the default setup: RideHeightRange/Setting, PackerRange/Setting).
#              Front3rd... / Rear3rd...: the same for the third (heave) spring - limits both wheels moving together.
_NUM = r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?'
_PAIR = re.compile(r'\((%s),(%s),(%s)\):\((%s),(%s),(%s)\)' % ((_NUM,) * 6))
_CORNER_SEC = {'FRONTLEFT': 'FL', 'FRONTRIGHT': 'FR', 'REARLEFT': 'RL', 'REARRIGHT': 'RR'}


def _fmt(v):
    s = ('%.6f' % v).rstrip('0').rstrip('.')
    return '0' if s in ('-0', '', '-') else s


def _range_val(rng, setting):
    n = _vec(rng or '')
    if not n:
        return 0.0
    return n[0] + (n[1] if len(n) > 1 else 0.0) * (setting or 0)


def _hdv_lines(hdv):
    """[(lineno, section, key lower, value, raw)]"""
    out, sec = [], ''
    for i, raw in enumerate(_lines(hdv)):
        s = raw.split('//', 1)[0].strip()
        m = re.match(r'^\[(\w+)\]', s)
        if m:
            sec = m.group(1).upper()
            continue
        if '=' in s:
            k, v = s.split('=', 1)
            out.append((i, sec, k.strip().lower(), v.strip(), raw))
    return out


def hdv_edit_info(hdv):
    L = _hdv_lines(hdv)
    st = {'mode': None, 'rack': None, 'lock': None, 'variants': 0, 'tableLines': []}
    tab = [(i, _PAIR.search(v)) for i, sec, k, v, raw in L if sec == 'CONTROLS' and k == 'steeringinnertable']
    tab = [(i, m) for i, m in tab if m]
    if tab:
        xs = [float(m.group(1)) for _, m in tab]
        base = sum(xs) / len(xs)
        st.update(mode='table', rack=round(max(abs(x - base) for x in xs) * 1000, 3), tableLines=[i for i, _ in tab])
        st['variants'] = len(set(_vec(v)[0] for i, sec, k, v, raw in L if sec == 'CONTROLS' and k == 'steerlockspecial' and _PAIR.search(v) and _vec(v)))
    rng = next((v for i, sec, k, v, raw in L if sec == 'CONTROLS' and k == 'steerlockrange'), None)
    sset = next((int(_vec(v)[0]) for i, sec, k, v, raw in L if sec == 'CONTROLS' and k == 'steerlocksetting' and _vec(v)), 0)
    if rng:
        st['lock'] = round(_range_val(rng, sset), 3)
        st['lockRange'] = rng
        if not st['mode']:
            st['mode'] = 'range'
    vals = {}
    for i, sec, k, v, raw in L:
        vals.setdefault(sec, {}).setdefault(k, v)
    corners = {}
    for sec, c in _CORNER_SEC.items():
        d = vals.get(sec)
        if not d:
            continue
        if 'bumpstoptravels' in d:
            n = _vec(d['bumpstoptravels'])
            bump, reb, key = (n + [0, 0])[0], (n + [0, 0])[1], 'BumpStopTravels'
        elif 'bumptravel' in d or 'reboundtravel' in d:
            bump, reb, key = (_vec(d.get('bumptravel', '0')) or [0])[0], (_vec(d.get('reboundtravel', '0')) or [0])[0], 'BumpTravel'
        else:
            continue
        rh = _range_val(d.get('rideheightrange'), int((_vec(d.get('rideheightsetting', '0')) or [0])[0]))
        pk = _range_val(d.get('packerrange'), int((_vec(d.get('packersetting', '0')) or [0])[0]))
        corners[c] = {'bump': bump, 'rebound': reb, 'key': key, 'rh': rh, 'packer': pk,
                      'up': round((rh + bump - pk) * 1000, 2), 'down': round((rh + reb) * 1000, 2)}
    third = {}
    susp = vals.get('SUSPENSION', {})
    for ax, pre in (('F', 'front3rd'), ('R', 'rear3rd')):
        rh = corners.get(ax + 'L', {}).get('rh', 0.0)
        if pre + 'bumpstoptravels' in susp:
            n = _vec(susp[pre + 'bumpstoptravels']) + [0, 0]
            bump, reb, key = n[0], n[1], pre.capitalize().replace('3rd', '3rd') + 'BumpStopTravels'
        elif pre + 'bumptravel' in susp:
            bump, reb, key = (_vec(susp[pre + 'bumptravel']) or [0])[0], (_vec(susp.get(pre + 'reboundtravel', '0')) or [0])[0], pre + 'BumpTravel'
        else:
            continue
        pk = _range_val(susp.get(pre + 'packerrange'), int((_vec(susp.get(pre + 'packersetting', '0')) or [0])[0]))
        third[ax] = {'bump': bump, 'rebound': reb, 'rh': rh, 'packer': pk,
                     'up': round((rh + bump - pk) * 1000, 2), 'down': round((rh + reb) * 1000, 2)}
    return {'path': hdv, 'steer': st, 'corners': corners, 'third': third}


def save_hdv(project, body):
    """write edited full lock / travel limits into the HDV (only these lines, .bak once)"""
    S = setup(project)
    hdv = S.get('hdvPath') if S.get('ok') else None
    if not hdv:
        raise ValueError('HDV nicht gefunden')
    info0 = hdv_edit_info(hdv)
    with open(hdv, 'rb') as fh:
        raw = fh.read()
    enc = 'utf-8'
    for e in ('utf-8', 'cp1252', 'latin-1'):
        try:
            text = raw.decode(e)
            enc = e
            break
        except UnicodeDecodeError:
            continue
    nl = '\r\n' if '\r\n' in text else '\n'
    lines = text.split(nl)
    changed = []

    def set_line(i, fn):
        code, sep, com = lines[i].partition('//')
        new = fn(code)
        if new != code:
            lines[i] = new + sep + com
            changed.append(i + 1)
    # ---- full lock
    rack = body.get('rack')
    lock = body.get('lock')
    st = info0['steer']
    if rack is not None and st['mode'] == 'table' and st['rack']:
        ratio = float(rack) / st['rack']
        groups = {'main': []}
        for i, line in enumerate(lines):
            code = line.split('//', 1)[0]
            m = re.match(r'^\s*(\w+)\s*=', code)
            if not m:
                continue
            k = m.group(1).lower()
            if k == 'steeringinnertable' and i in st['tableLines']:
                groups['main'].append(i)
            elif k == 'steerlockspecial' and body.get('variants') and _PAIR.search(code):
                n = _vec(code.split('=', 1)[1])
                groups.setdefault('v%s' % (n[0] if n else i), []).append(i)
        for g, idx in groups.items():
            pts = [m for i in idx for m in _PAIR.finditer(lines[i].split('//', 1)[0])]
            if not pts:
                continue
            bl = sum(float(m.group(1)) for m in pts) / len(pts)
            br = sum(float(m.group(4)) for m in pts) / len(pts)

            def tr(m):
                v = [float(x) for x in m.groups()]
                v[0] = bl + (v[0] - bl) * ratio
                v[3] = br + (v[3] - br) * ratio
                return '(%s,%s,%s):(%s,%s,%s)' % (_fmt(v[0]), m.group(2), m.group(3), _fmt(v[3]), m.group(5), m.group(6))
            for i in idx:
                set_line(i, lambda code: _PAIR.sub(tr, code))
    elif lock is not None and st.get('lockRange'):
        n = _vec(st['lockRange'])
        sset = 0
        for i, line in enumerate(lines):
            m = re.match(r'^\s*SteerLockSetting\s*=\s*(\d+)', line, re.I)
            if m:
                sset = int(m.group(1))
        step = n[1] if len(n) > 1 else 0.0
        new_min = float(lock) - step * sset
        for i, line in enumerate(lines):
            if re.match(r'^\s*SteerLockRange\s*=', line, re.I):
                set_line(i, lambda code: re.sub(r'\(\s*(%s)' % _NUM, '(' + _fmt(new_min), code, count=1))
                break
    # ---- travel limits (wheel travel mm from the static car -> HDV values in pushrod units, inverse of _stops)
    trv = body.get('travel') or {}
    stops = _get_stops(S)

    def conv(c, key3, t, e_hdv, upk, dnk):
        e = S['corners'].get(c)
        st = stops.get(key3 or c)
        if e is None or st is None:                    # no kinematics: rF2 formula with motion ratio 1
            bump = (t[upk] / 1000.0) - e_hdv['rh'] + e_hdv['packer'] if t.get(upk) is not None else e_hdv['bump']
            reb = (-t[dnk] / 1000.0) - e_hdv['rh'] if t.get(dnk) is not None else e_hdv['rebound']
            return bump, reb
        # the panel edits one value per axle (shown for the left wheel): move every corner by the same change
        ref = stops.get(key3 or (c[0] + 'L')) or st
        bump, reb = st['bump'], st['rebound']
        if t.get(upk) is not None:
            dlt = t[upk] / 1000.0 - (ref['bUp'] - ref['static'])
            if abs(dlt) > 1e-5:
                bump = _defl(e, st['bUp'] + dlt) + st['packer']
        if t.get(dnk) is not None:
            dlt = t[dnk] / 1000.0 - (ref['static'] - ref['bDown'])
            if abs(dlt) > 1e-5:
                reb = _defl(e, st['bDown'] - dlt)
        return bump, reb
    sec = ''
    for i, line in enumerate(lines):
        code = line.split('//', 1)[0].strip()
        m = re.match(r'^\[(\w+)\]', code)
        if m:
            sec = m.group(1).upper()
            continue
        c = _CORNER_SEC.get(sec)
        k = code.split('=', 1)[0].strip().lower() if '=' in code else ''
        if c and c[0] in trv and c in info0['corners']:
            bump, reb = conv(c, None, trv[c[0]], info0['corners'][c], 'up', 'down')
            if k == 'bumpstoptravels':
                set_line(i, lambda code: re.sub(r'=\s*\([^)]*\)', '=(%s,%s)' % (_fmt(bump), _fmt(reb)), code, count=1))
            elif k == 'bumptravel':
                set_line(i, lambda code: re.sub(r'=\s*' + _NUM, '=' + _fmt(bump), code, count=1))
            elif k == 'reboundtravel':
                set_line(i, lambda code: re.sub(r'=\s*' + _NUM, '=' + _fmt(reb), code, count=1))
        if sec == 'SUSPENSION':
            for ax, pre in (('F', 'front3rd'), ('R', 'rear3rd')):
                t = (trv.get(ax) or {})
                e = info0['third'].get(ax)
                if not e or (t.get('up3') is None and t.get('down3') is None):
                    continue
                bump, reb = conv(ax + 'L', ax + '3', t, e, 'up3', 'down3')
                if k == pre + 'bumpstoptravels':
                    set_line(i, lambda code: re.sub(r'=\s*\([^)]*\)', '=(%s,%s)' % (_fmt(bump), _fmt(reb)), code, count=1))
                elif k == pre + 'bumptravel':
                    set_line(i, lambda code: re.sub(r'=\s*' + _NUM, '=' + _fmt(bump), code, count=1))
                elif k == pre + 'reboundtravel':
                    set_line(i, lambda code: re.sub(r'=\s*' + _NUM, '=' + _fmt(reb), code, count=1))
    if not changed:
        return {'ok': True, 'path': hdv, 'changed': [], 'info': info(project)}
    bak = hdv + '.bak'
    if not os.path.exists(bak):
        with open(bak, 'wb') as fh:
            fh.write(raw)
    with open(hdv, 'wb') as fh:
        fh.write(nl.join(lines).encode(enc))
    _CACHE.clear()
    return {'ok': True, 'path': hdv, 'changed': changed, 'bak': bak, 'info': info(project)}
