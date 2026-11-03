"""rF2 vehicle camera file (*.cam): LocalCam=NAME { Key=(a, b, c) ... }.
Values are edited in place - comments, order and spacing of the file stay."""
import re

_CAM_RE = re.compile(r'^\s*LocalCam\s*=\s*([^\s/]+)\s*(?://\s*(.*))?$', re.IGNORECASE)
_KV_RE = re.compile(r'^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*?)(\s*(?://.*)?)$')


def _parse_value(raw):
    v = raw.strip()
    if v.startswith('(') and v.endswith(')'):
        parts = [p.strip() for p in v[1:-1].split(',') if p.strip()]
        try:
            return [float(p) for p in parts]
        except ValueError:
            return v
    up = v.upper()
    if up in ('TRUE', 'FALSE'):
        return up == 'TRUE'
    try:
        return [float(v)]
    except ValueError:
        return v


def _read_lines(path):
    with open(path, 'rb') as f:
        text = f.read().decode('latin-1')
    nl = '\r\n' if '\r\n' in text else '\n'
    return text.split(nl), nl


def parse_cam(path):
    lines, _nl = _read_lines(path)
    cams = []
    cur = None
    depth = 0
    for i, line in enumerate(lines):
        code = line.split('//', 1)[0]
        m = _CAM_RE.match(line)
        if m and depth == 0:
            cur = {'name': m.group(1), 'comment': (m.group(2) or '').strip(), 'params': {}, 'order': [], 'line': i}
            cams.append(cur)
            continue
        if '{' in code:
            depth += code.count('{')
        if '}' in code:
            depth -= code.count('}')
            if depth <= 0:
                depth = 0
                cur = None
            continue
        if cur is not None and depth > 0:
            kv = _KV_RE.match(line)
            if kv:
                key = kv.group(2)
                cur['params'][key] = _parse_value(kv.group(4))
                cur['order'].append(key)
    return cams


def _fmt_num(x):
    s = ('%.6f' % x).rstrip('0').rstrip('.')
    return s if s not in ('-0', '') else '0'


def save_cam(path, edits):
    """edits: {camName: {key: value}} - value list of numbers or bool."""
    lines, nl = _read_lines(path)
    cur = None
    depth = 0
    want = {k.lower(): v for k, v in edits.items()}
    seen = {}
    for i, line in enumerate(lines):
        code = line.split('//', 1)[0]
        m = _CAM_RE.match(line)
        if m and depth == 0:
            cur = m.group(1).lower()
            continue
        if '{' in code:
            depth += code.count('{')
        if '}' in code:
            depth -= code.count('}')
            if depth <= 0:
                depth = 0
                # keys that did not exist in this block yet: insert before '}'
                if cur in want:
                    missing = [k for k in want[cur] if k.lower() not in seen.get(cur, set())]
                    if missing:
                        ins = ['  %s=%s' % (k, _fmt_val(want[cur][k], None)) for k in missing]
                        lines[i:i] = ins
                        seen.setdefault(cur, set()).update(k.lower() for k in missing)
                cur = None
            continue
        if cur in want and depth > 0:
            kv = _KV_RE.match(line)
            if not kv:
                continue
            key = kv.group(2)
            seen.setdefault(cur, set()).add(key.lower())
            for k, v in want[cur].items():
                if k.lower() == key.lower():
                    lines[i] = kv.group(1) + key + kv.group(3) + _fmt_val(v, kv.group(4)) + kv.group(5)
    with open(path, 'wb') as f:
        f.write(nl.join(lines).encode('latin-1', 'replace'))


def _fmt_val(v, old):
    if isinstance(v, bool):
        return 'TRUE' if v else 'FALSE'
    if isinstance(v, (int, float)):
        v = [v]
    if isinstance(v, list):
        old_s = (old or '').strip()
        sep = ', ' if (', ' in old_s or not old_s) else ','
        if old_s and not old_s.startswith('(') and len(v) == 1:
            return _fmt_num(float(v[0]))
        return '(' + sep.join(_fmt_num(float(x)) for x in v) + ')'
    return str(v)


# ---- cockpitinfo.ini (Eyepoint, CameraTarget, TVOffset ...) -----------------
COCKPIT_KEYS = ('Eyepoint', 'CameraTarget', 'TVOffset', 'MirrorPos', 'MirrorNorm')


def parse_ini_values(path, keys=COCKPIT_KEYS):
    lines, _nl = _read_lines(path)
    want = {k.lower(): k for k in keys}
    out = {}
    for line in lines:
        kv = _KV_RE.match(line)
        if kv and kv.group(2).lower() in want and want[kv.group(2).lower()] not in out:
            out[want[kv.group(2).lower()]] = _parse_value(kv.group(4))
    return out


def save_ini_values(path, values):
    lines, nl = _read_lines(path)
    want = {k.lower(): v for k, v in values.items()}
    done = set()
    for i, line in enumerate(lines):
        kv = _KV_RE.match(line)
        if kv and kv.group(2).lower() in want and kv.group(2).lower() not in done:
            # keep "( 0.0, 0.66, 0.17)" style spacing roughly: value + original comment
            lines[i] = kv.group(1) + kv.group(2) + kv.group(3) + _fmt_val(want[kv.group(2).lower()], kv.group(4)) + kv.group(5)
            done.add(kv.group(2).lower())
    for k, v in values.items():
        if k.lower() not in done:
            lines.append('%s=%s' % (k, _fmt_val(v, None)))
    with open(path, 'wb') as f:
        f.write(nl.join(lines).encode('latin-1', 'replace'))


# ---- digital displays in cockpitinfo (<Name>Font / Background / Scale / Offset / AlphaColor) ----
_DISP_RE = re.compile(r'^(.+?)(Font|Background|Scale|Offset|AlphaColor)$', re.IGNORECASE)


def parse_displays(path):
    lines, _nl = _read_lines(path)
    disp = {}
    leds = {}
    for line in lines:
        kv = _KV_RE.match(line)
        if not kv:
            continue
        key, raw = kv.group(2), kv.group(4).strip()
        if key.upper().endswith('LED') and '(' not in raw:
            leds[key] = raw.strip('"')
            continue
        m = _DISP_RE.match(key)
        if not m:
            continue
        name, part = m.group(1), m.group(2).lower()
        d = disp.setdefault(name, {'name': name})
        if part in ('font', 'background'):
            d[part] = raw.strip('"')
        else:
            v = _parse_value(raw)
            if isinstance(v, list):
                d[{'scale': 'scale', 'offset': 'offset', 'alphacolor': 'color'}[part]] = v
    out = [d for d in disp.values() if d.get('background') and d.get('font')]
    return out, leds
