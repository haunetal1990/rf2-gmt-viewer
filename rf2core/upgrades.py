"""VEH upgrades (Upgrades=*.ini) and the rF2 GEN pre-processor.

The GEN pre-processor follows the game, which writes the
GEN line by line into a temporary file and replaces every <TOKEN>:

  <ID> -> slot number (%03d)            <VEHDIR> / <TEAMDIR> -> folders (kept as tokens here, resolved later)
  <SPIN> / <NOTSPIN>                    line kept or commented ("//") depending on spinner / in-game mode
  <LOW> <MED> <HIGH> <MAX>              kept only at that detail level (spinner mode: always commented!)
  <DASHLOW> / <DASHHIGH>                dash detail
  <STARTUPGRADES>                       in-game: "//"   spinner: remembers the position of the next line
  <STOPUPGRADES>                        in-game: "//"   spinner: while an upgrade level with the current number
                                        exists, jump back to <STARTUPGRADES> and repeat the block with
                                        UPNUMBER + 1; else "//"
  <UPNUMBER>                            spinner: "_<n>" (current pass), in-game: nothing
  anything else                         upgrade token: the GEN=<TOKEN>=value of every upgrade type whose level
                                        (in-game: the selected one, spinner: number <n>, else the next lower)
                                        defines it - all matches are written one after another. No match:
                                        digits = characters of the VEH GenString, otherwise the game logs
                                        'Vehicle gen token "X" unknown' and writes "unknown_token_X".

The "Instance=" of an upgrade type is not used by this step.
"""
import re

MODE_SPIN = 0          # rF2: r13 == 0
DETAIL = {'LOW': 1, 'MED': 2, 'HIGH': 3, 'MAX': 4}


# ------------------------------------------------------------------ INI ---


def _kv(line):
    """key=value of an INI line (rF2 key match is case-insensitive), value without quotes."""
    m = re.match(r'\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$', line)
    if not m:
        return None, None
    v = m.group(2).strip()
    if v.startswith('"'):
        e = v.find('"', 1)
        v = v[1:e] if e > 0 else v[1:]
    return m.group(1).lower(), v


def parse_upgrades(text):
    """Upgrades INI like the game reads it: line by line, braces are not used.
    UpgradeType=<name> selects/creates the type (same name = same type), UpgradeLevel=<name> selects/creates a level
    of the current type, Instance= adds an instance name to the type, Incremental / ResaleValue belong to the type.
    The current level is NOT reset by a new UpgradeType (lines before its first UpgradeLevel still go to the last
    level). Level lines: Picture, Description, MinimumClass, Price, ClassScore, IconLevel, then lines starting with
    "GEN=" / "SFX=" / "HDV=" / "CPIT=" (case-sensitive). GEN=: text between the first '<' and the next '>' is the
    token, after the following '=' the value (from the first '"' on, up to the next '"' / line end).
    Types without levels are removed.
    -> {'types': [{'name', 'instances', 'props', 'levels': [{'name', 'description', 'gen': [(token, value)],
    'other': n}]}], 'issues': [str]}"""
    types, issues = [], []
    cur_t = cur_l = None
    for no, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('//'):
            continue
        k, v = _kv(line)
        if k == 'upgradetype':
            cur_t = next((t for t in types if t['name'].lower() == v.lower()), None)
            if cur_t is None:
                cur_t = {'name': v, 'instances': [], 'props': {}, 'levels': [], 'line': no}
                types.append(cur_t)
            continue
        if k in ('upgradeclass', 'displayclassoverride', 'basevehicleprice', 'unlockexperience'):
            continue
        if cur_t is None:
            continue
        if k == 'upgradelevel':
            cur_l = next((x for x in cur_t['levels'] if x['name'].lower() == v.lower()), None)
            if cur_l is None:
                cur_l = {'name': v, 'description': '', 'gen': [], 'other': 0, 'line': no}
                cur_t['levels'].append(cur_l)
            continue
        if k == 'instance':
            if v.lower() not in [x.lower() for x in cur_t['instances']]:
                cur_t['instances'].append(v)
        elif k in ('incremental', 'resalevalue'):
            cur_t['props'][k] = v
        if cur_l is None:
            continue
        if k == 'description':
            cur_l['description'] = v
        elif k in ('picture', 'minimumclass', 'price', 'classscore', 'iconlevel'):
            cur_l['other'] += 1
        elif line.startswith('GEN='):
            body = line[4:]
            a = body.find('<')
            b = body.find('>', a + 1) if a >= 0 else -1
            e = body.find('=', b) if b >= 0 else -1
            if e < 0:
                issues.append('Zeile %d: GEN-Zeile ohne <TOKEN>=Wert - wird von rF2 ignoriert: %s' % (no, line))
                continue
            val = body[e + 1:]
            q = body.find('"', e)
            if q >= 0:
                val = body[q + 1:]
            val = re.split(r'["\r\n]', val, 1)[0]
            if q < 0:
                val = val.strip()
            cur_l['gen'].append((body[a + 1:b], val))
        elif line.startswith(('SFX=', 'HDV=', 'CPIT=')):
            cur_l['other'] += 1
        elif line[:4].upper() == 'GEN=':
            issues.append('Zeile %d: "%s" - rF2 erkennt nur "GEN=" in Großbuchstaben.' % (no, line[:4]))
    for t in [t for t in types if not t['levels']]:
        issues.append('UpgradeType "%s" hat keine UpgradeLevel - rF2 verwirft ihn.' % t['name'])
        types.remove(t)
    return {'types': types, 'issues': issues}


# ------------------------------------------------------------------ GEN ---

def gen_has_spin_tokens(text):
    up = text.upper()
    return '<SPIN>' in up or '<NOTSPIN>' in up


def preprocess_gen(text, mode, types, selection=None, genstring='', slot=0, dash_low=True, max_passes=64):
    """rF2 GEN pre-processor. mode: MODE_SPIN (0) or detail 1..4. types: parse_upgrades()['types'].
    selection: {type index: level index} (in-game; missing = level 0).
    -> (text, report) report = {'unknown': {token: count}, 'used': {token: [type names]}, 'passes': n,
    'blocks': [(start line, stop line)], 'outside': {token}, 'events': [str]}"""
    selection = selection or {}
    lines = text.splitlines()
    out = []
    src = []
    rep = {'unknown': {}, 'used': {}, 'passes': 0, 'outside': set(), 'events': [], 'start_seen': 0, 'stop_seen': 0}
    up_pos = 0               # var_a98: file position after <STARTUPGRADES> (0 = file start)
    up_num = 0               # var_ac0
    up_found = False         # var_ac8
    in_block = False
    i = 0
    steps = 0
    while i < len(lines):
        steps += 1
        if steps > 200000:
            rep['events'].append('Abbruch: GEN-Block wiederholt sich zu oft.')
            break
        buf = lines[i]
        cpos = buf.find('//')                            # tokens behind '//' are replaced too, but not reported
        consumed = 0
        nxt = i + 1
        o = []
        while True:
            a = buf.find('<')
            if a < 0:
                break
            o.append(buf[:a])
            b = buf.find('>', a + 1)
            if b < 0:                                    # "< does not have matching >" (logged by rF2)
                rep['events'].append('Zeile %d: "<" ohne ">"' % (i + 1))
                o.append(buf[a:])
                buf = ''
                break
            tok = buf[a + 1:b]
            T = tok.upper()
            in_comment = 0 <= cpos < consumed + a
            if T == 'ID':
                o.append('%03d' % slot)
            elif T in ('VEHDIR', 'TEAMDIR'):
                o.append('<%s>' % T)                    # resolved by the search path logic
            elif T == 'NOTSPIN':
                if mode == MODE_SPIN:
                    o.append('//')
            elif T == 'SPIN':
                if mode != MODE_SPIN:
                    o.append('//')
            elif T in DETAIL:
                if mode != DETAIL[T]:
                    o.append('//')
            elif T in ('DASHLOW', 'DASHHIGH'):
                if (T == 'DASHLOW') != bool(dash_low):
                    o.append('//')
            elif T == 'STARTUPGRADES':
                rep['start_seen'] += 1
                if mode != MODE_SPIN:
                    o.append('//')
                else:
                    up_pos = i + 1
                    in_block = True
            elif T == 'STOPUPGRADES':
                rep['stop_seen'] += 1
                if mode != MODE_SPIN or not up_found:
                    o.append('//')
                    if mode == MODE_SPIN:
                        rep['passes'] = max(rep['passes'], up_num + 1)
                        in_block = False
                else:
                    nxt = up_pos                         # fseek back to the line after <STARTUPGRADES>
                    up_num += 1
                    up_found = False
            elif T == 'UPNUMBER':
                if mode == MODE_SPIN:
                    o.append('_%d' % up_num)
            else:
                hit = False
                for ti, t in enumerate(types):
                    lv = None
                    if mode == MODE_SPIN:
                        n = up_num
                        if n < len(t['levels']):
                            lv = t['levels'][n]
                            up_found = True
                        else:
                            while n > 0:
                                n -= 1
                                if n < len(t['levels']):
                                    lv = t['levels'][n]
                                    break
                    else:
                        n = selection.get(ti, 0)
                        lv = t['levels'][n] if 0 <= n < len(t['levels']) else None
                    if lv is None:
                        continue
                    for name, val in lv['gen']:
                        if name.upper() == T:
                            o.append(val)
                            hit = True
                            rep['used'].setdefault(T, [])
                            if t['name'] not in rep['used'][T]:
                                rep['used'][T].append(t['name'])
                if hit:
                    if mode == MODE_SPIN and not in_block and not in_comment:
                        rep['outside'].add(tok)
                else:
                    ok = bool(tok) and all('1' <= c <= '9' and int(c) <= len(genstring) for c in tok)
                    if ok:
                        o.append(''.join(genstring[int(c) - 1] for c in tok))
                    else:
                        if not in_comment:
                            rep['unknown'][tok] = rep['unknown'].get(tok, 0) + 1
                        o.append('unknown_token_%s' % tok)
            consumed += b + 1
            buf = buf[b + 1:]
        o.append(buf)
        out.append(''.join(o))
        src.append(i)
        i = nxt
    rep['outside'] = sorted(rep['outside'])
    rep['line_src'] = src
    code = [ln.split('//', 1)[0].upper() for ln in lines]
    rep['start_count'] = sum(ln.count('<STARTUPGRADES>') for ln in code)
    rep['stop_count'] = sum(ln.count('<STOPUPGRADES>') for ln in code)
    return '\n'.join(out) + '\n', rep
