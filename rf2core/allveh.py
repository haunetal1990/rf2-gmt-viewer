"""Player mirror settings of one vehicle in UserData\\player\\all_vehicles.ini (written by rF2 for every car):
  MirrorLeft / MirrorCenter / MirrorRight = (horizontal, vertical, size)   in-game "Left/Center/Right Mirror Params"
  MirrorPhysical = (x, y, z)                                             "Mirror Physical Pos" (center mirror)
rF2 pans/zooms the UVs of the MIRROR vertices of LMIRROR_IN / CMIRROR_IN / RMIRROR_IN with them:
  u' = (u - 0.5) * size + 0.5 + horizontal,  v' = (v - 0.5) * size + 0.5 - vertical     (DX v)
Saving only replaces these lines of the matching [VEHICLE] block; rF2 rewrites the file when it quits, so save
while the game is not running."""
import os
import re

from .scene import rf2_top_dir

KEYS = ('MirrorLeft', 'MirrorCenter', 'MirrorRight', 'MirrorPhysical')
DEFAULTS = {'MirrorLeft': [0.0, 0.0, 1.0], 'MirrorCenter': [0.0, 0.0, 1.0], 'MirrorRight': [0.0, 0.0, 1.0],
            'MirrorPhysical': [0.0, 0.0, 0.0]}
_NUM = re.compile(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')


def candidates(project_path):
    out = []
    top = rf2_top_dir(project_path)
    if top:
        for root in (top, os.path.dirname(top)):
            out.append(os.path.join(root, 'UserData', 'player', 'all_vehicles.ini'))
    return out


def find_file(project_path, extra=None):
    for c in ([extra] if extra else []) + candidates(project_path):
        if c and os.path.isfile(c):
            return c
    return None


def _read(path):
    with open(path, 'rb') as f:
        raw = f.read()
    return raw.decode('latin-1').splitlines(keepends=True)


def _veh_tail(p):
    """'...\\Vehicles\\DLMF1_2027\\teams\\X.veh' -> 'dlmf1_2027\\teams\\x.veh' (path after Vehicles)."""
    s = p.replace('/', '\\').lower()
    i = s.rfind('\\vehicles\\')
    return s[i + 10:] if i >= 0 else os.path.basename(s)


def _blocks(lines):
    """[{'start', 'end', 'file', 'keys': {key: line index}}] for every [VEHICLE] block."""
    out, cur = [], None
    for i, line in enumerate(lines):
        s = line.strip()
        if s.upper() == '[VEHICLE]':
            if cur:
                cur['end'] = i
            cur = {'start': i, 'end': len(lines), 'file': '', 'keys': {}}
            out.append(cur)
            continue
        if cur is None or '=' not in s:
            continue
        k, v = s.split('=', 1)
        k = k.strip()
        if k.lower() == 'file':
            cur['file'] = v.strip().strip('"')
        elif k in KEYS and k not in cur['keys']:
            cur['keys'][k] = i
    return out


def _match(blocks, veh_path):
    want_full = os.path.normcase(os.path.abspath(veh_path)).replace('/', '\\').lower()
    want_tail = _veh_tail(veh_path)
    for b in blocks:                                 # exact path first
        if b['file'].replace('/', '\\').lower() == want_full:
            return b
    for b in blocks:                                 # same car below another Vehicles folder (other drive / install)
        if b['file'] and _veh_tail(b['file']) == want_tail:
            return b
    return None


def read(path, veh_path):
    lines = _read(path)
    blk = _match(_blocks(lines), veh_path) if veh_path else None
    vals = {k: list(v) for k, v in DEFAULTS.items()}
    if blk:
        for k, i in blk['keys'].items():
            n = [float(x) for x in _NUM.findall(lines[i].split('=', 1)[1])]
            if len(n) >= 3:
                vals[k] = n[:3]
    return {'path': path, 'found': bool(blk), 'file': blk['file'] if blk else None,
            'values': vals, 'vehicles': sum(1 for _ in _blocks(lines))}


def save(path, veh_path, values):
    lines = _read(path)
    blk = _match(_blocks(lines), veh_path)
    if not blk:
        raise ValueError('Fahrzeug nicht in %s - einmal im Spiel fahren, dann legt rF2 den Eintrag an.' % os.path.basename(path))
    eol = '\r\n' if lines and lines[0].endswith('\r\n') else '\n'
    insert_at = blk['end']
    for k in KEYS:
        if k not in values:
            continue
        v = [float(x) for x in values[k]][:3]
        txt = '%s=(%s)' % (k, ','.join('%.3f' % x for x in v))
        if k in blk['keys']:
            i = blk['keys'][k]
            old = lines[i]
            lines[i] = txt + old[len(old.rstrip('\r\n')):]
        else:                                        # missing key: before the next block
            lines.insert(insert_at, txt + eol)
            insert_at += 1
    data = ''.join(lines).encode('latin-1')
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)
    return read(path, veh_path)
