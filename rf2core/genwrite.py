"""Write a GEN back: changed MeshFile properties, deleted meshes, new GMTs - or a new GEN from loose GMTs.

The original text stays as it is (comments, tokens like <MAX> / <HALO>, line endings); only the touched lines change:
  - property change: on the source line of the mesh only the edited keys are replaced / added / removed,
    MeshFile itself (it may contain upgrade tokens) is never rewritten
  - delete: the source line of the mesh is removed (only if it holds just this one MeshFile)
  - new GMT: a MeshFile line at the end of its instance block; a new instance becomes a child block of SLOT<ID>
"""
import re

KV_ONE = r'(\([^)]*\)|"[^"]*"|[^\s{}]+)'
DEFAULT_KV = [('CollTarget', 'False'), ('HATTarget', 'False'), ('LODIn', '(0)'), ('LODOut', '(500)'),
              ('ShadowCaster', '(True, Solid)'), ('Reflect', 'True')]


def _split_comment(line):
    i = line.find('//')
    return (line, '') if i < 0 else (line[:i], line[i:])


def edit_line(line, changes):
    """changes: {key: value or None (= remove)}; keys matched case-insensitively."""
    code, comment = _split_comment(line)
    for key, val in changes.items():
        if key.lower() == 'meshfile':
            continue
        rx = re.compile(r'(\s*)\b' + re.escape(key) + r'\s*=\s*' + KV_ONE, re.I)
        m = rx.search(code)
        if val is None:
            if m:
                code = code[:m.start()] + code[m.end():]
            continue
        if m:
            code = code[:m.start()] + m.group(1) + key + '=' + val + code[m.end():]
        else:
            code = code.rstrip() + ' ' + key + '=' + val
    if comment and not code.endswith((' ', '\t')):
        code += ' '
    return code + comment


def mesh_line(file, kv, indent='  '):
    parts = ['MeshFile=' + file] + ['%s=%s' % (k, v) for k, v in kv if k.lower() != 'meshfile']
    return indent + ' '.join(parts)


def _block_range(lines, start):
    """Line of '{' after an Instance= line and its matching '}' (None if not closed)."""
    depth, open_line = 0, None
    for i in range(start, len(lines)):
        code = _split_comment(lines[i])[0]
        for ch in code:
            if ch == '{':
                depth += 1
                if open_line is None:
                    open_line = i
            elif ch == '}':
                depth -= 1
                if open_line is not None and depth == 0:
                    return open_line, i
    return open_line, None


def _find_instance(lines, name):
    rx = re.compile(r'^\s*(<[^>]*>\s*)?Instance\s*=\s*"?' + re.escape(name) + r'"?\s*(\{.*)?$', re.I)
    for i, ln in enumerate(lines):
        if rx.match(_split_comment(ln)[0].rstrip()):
            return i
    return None


def _slot_line(lines):
    rx = re.compile(r'^\s*Instance\s*=\s*SLOT', re.I)
    return next((i for i, ln in enumerate(lines) if rx.match(ln)), None)


def write_gen(text, edits, deleted_lines, added):
    """text: original GEN. edits: {line: {key: value|None}}. deleted_lines: set of line indexes.
    added: [{'file', 'inst', 'kv': [(k, v)]}]. -> new text"""
    nl = '\r\n' if '\r\n' in text else '\n'
    lines = text.split(nl)
    for ln, ch in edits.items():
        if 0 <= ln < len(lines) and ln not in deleted_lines:
            lines[ln] = edit_line(lines[ln], ch)
    # inserts (by instance), computed on the original line numbers, applied bottom-up together with deletes
    inserts = {}                                   # line index -> [text lines] inserted before that line
    appends = []
    by_inst = {}
    for a in added:
        by_inst.setdefault(a['inst'] or 'SLOT<ID>', []).append(a)
    slot = _slot_line(lines)
    for inst, items in by_inst.items():
        i = _find_instance(lines, inst)
        if i is None and re.match(r'^SLOT(\d{3}|<ID>)$', inst, re.I) and slot is not None:
            i = slot
        if i is not None:
            o, c = _block_range(lines, i)
            ind = '  '
            for j in range((o or i) + 1, c if c is not None else len(lines)):
                m = re.match(r'^(\s*)(<[^>]*>\s*)?MeshFile', lines[j], re.I)
                if m:
                    ind = m.group(1)
                    break
            new = [mesh_line(a['file'], a['kv'], ind) for a in items]
            if c is None:
                appends += new
            else:
                inserts.setdefault(c, []).extend(new)
            continue
        block = ['', '  Instance=' + inst, '  {', '    Moveable=True'] + [mesh_line(a['file'], a['kv'], '    ') for a in items] + ['  }']
        if slot is not None:
            o, c = _block_range(lines, slot)
            if c is not None:
                inserts.setdefault(c, []).extend(block)
                continue
        appends += block
    out = []
    for i, ln in enumerate(lines):
        if i in inserts:
            out += inserts[i]
        if i in deleted_lines:
            continue
        out.append(ln)
    if appends:
        while out and out[-1] == '':
            out.pop()
        out += appends + ['']
    return nl.join(out)


def new_gen(added, name='Viewer'):
    """New GEN from loose GMTs: Instance=SLOT<ID> with the GMTs, other instances as child blocks."""
    lines = ['// GEN erstellt mit dem rF2 GMT Viewer', '//----------------------------------------',
             'SearchPath=<VEHDIR>', 'SearchPath=.', '', '//----------------------------------------', '',
             'Instance=SLOT<ID>', '{', '  Moveable=True']
    by_inst = {}
    for a in added:
        by_inst.setdefault(a['inst'] or 'SLOT<ID>', []).append(a)
    for inst, items in by_inst.items():
        if re.match(r'^SLOT(\d{3}|<ID>)$', inst, re.I):
            lines += [mesh_line(a['file'], a['kv'], '  ') for a in items]
    for inst, items in by_inst.items():
        if re.match(r'^SLOT(\d{3}|<ID>)$', inst, re.I):
            continue
        lines += ['', '  Instance=' + inst, '  {', '    Moveable=True'] + \
                 [mesh_line(a['file'], a['kv'], '    ') for a in items] + ['  }']
    lines += ['}', '']
    return '\r\n'.join(lines)
