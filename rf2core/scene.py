"""Projects for the viewer: a folder, a mod folder, a VEH (-> spinner / graphics
GEN) or a single GMT.  Builds the file indexes (GMT, textures, material JSON)
and packs meshes into a compact binary for the WebGL client."""
import json
import math
import os
import re
import struct
import threading
import hashlib
from concurrent.futures import ThreadPoolExecutor
from . import mas as MAS
from . import upgrades as UPG
from . import genwrite as GW

import numpy as np

from . import gmt_core as G

TEX_EXTS = ('.dds', '.png', '.jpg', '.jpeg', '.tga', '.bmp')
MAX_INDEX_FILES = 120_000
AUTO_SHOW_LIMIT = 80          # folder mode: parts shown automatically
FX_PATTERNS = ('heat_fx', 'backfire')     # in-game effects, marked FX in the list
HIDE_PATTERNS = ('backfire',)              # hidden at start (heat_fx is drawn as heat haze)

_KV_RE = re.compile(r'\{|\}|([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\([^)]*\)|"[^"]*"|[^\s{}]+)')
_LINE_TOKEN_RE = re.compile(r'^\s*<([A-Za-z0-9_]+)>')
_DETAIL_ORDER = ('MAX', 'HIGH', 'MED', 'LOW')


# ---------------------------------------------------------------- helpers ---

def norm(p):
    return os.path.normcase(os.path.normpath(os.path.abspath(p)))


def ci_join(base, rel):
    """Case-insensitive join (rF2 paths come from Windows) - dirs and file."""
    cur = base
    parts = [p for p in re.split(r'[\\/]+', rel.strip()) if p not in ('', '.')]
    for i, part in enumerate(parts):
        if part == '..':
            cur = os.path.dirname(cur)
            continue
        cand = os.path.join(cur, part)
        if os.path.exists(cand):
            cur = cand
            continue
        try:
            hit = next((e.path for e in os.scandir(cur) if e.name.lower() == part.lower()), None)
        except OSError:
            hit = None
        if hit is None:
            return None
        cur = hit
    return cur


def read_text(path):
    with open(path, 'rb') as f:
        return f.read().decode('latin-1', 'replace')


def walk_files(root, max_depth=8, limit=MAX_INDEX_FILES):
    """All files below root (depth limited), as paths."""
    out = []
    root = os.path.abspath(root)
    base_depth = root.rstrip('\\/').count(os.sep)
    for dirpath, dirnames, filenames in os.walk(root):
        if dirpath.count(os.sep) - base_depth >= max_depth:
            dirnames[:] = []
        dirnames[:] = [d for d in dirnames if not d.startswith('.') and d.lower() not in ('__pycache__',)]
        for fn in filenames:
            out.append(os.path.join(dirpath, fn))
            if len(out) >= limit:
                return out
    return out


def list_dir_files(d):
    try:
        return [e.path for e in os.scandir(d) if e.is_file()]
    except OSError:
        return []


# -------------------------------------------------------------- SCN / GEN ---

def _num(val, default=None):
    try:
        return float(val.strip('()').split(',')[0])
    except (ValueError, AttributeError, IndexError):
        return default


def parse_scene_file(path):
    """rF2 SCN/GEN -> {'search_paths', 'mas_files', 'instances': [{'name',
    'parent', 'entries': [{'file', 'lodin', 'lodout', 'render', 'token'}]}]}"""
    return parse_scene_text(read_text(path))


# keys rF2 / the ModDev viewer read on a MeshFile line (as in the game) + vehicle-only ones
MESH_KEYS = ('meshfile', 'lodin', 'lodout', 'render', 'deformable', 'damageable', 'hattarget', 'colltarget',
             'shadowcaster', 'shadowobject', 'ambientcaster', 'ambientobject', 'reflect', 'zbias', 'shadowgroups',
             'visible', 'separatesurface', 'billboard', 'shadowreceiver', 'nohdrlum', 'materialpath')


def parse_scene_text(text, line_src=None):
    """line_src: source line index per text line (pre-processed GEN) - stored as 'line' of meshes / instances."""
    search, mas = [], []
    instances = []
    stack = []
    pending = None
    issues = []
    depth_err = False
    for no, raw in enumerate(text.splitlines()):
        src = line_src[no] if line_src and no < len(line_src) else no
        line = raw.split('//', 1)[0]
        if not line.strip():
            continue
        tm = _LINE_TOKEN_RE.match(line)
        token = tm.group(1).upper() if tm else None
        if token in ('SPIN', 'DASHLOW', 'DASHHIGH'):
            continue
        mesh = None
        rest = _KV_RE.sub(' ', re.sub(r'^\s*<[A-Za-z0-9_]+>', ' ', line)).strip()
        for m in _KV_RE.finditer(line):
            tok = m.group(0)
            if tok == '{':
                stack.append(pending)
                pending = None
                continue
            if tok == '}':
                if stack:
                    stack.pop()
                elif not depth_err:
                    issues.append({'line': src, 'msg': 'schließende Klammer "}" ohne passende "{"'})
                    depth_err = True
                pending = None
                continue
            key = m.group(1).lower()
            val = m.group(2).strip().strip('"')
            cur = next((s for s in reversed(stack) if isinstance(s, dict)), None)
            top = stack[-1] if stack and isinstance(stack[-1], dict) else None
            if key == 'instance':
                inst = {'name': val, 'parent': cur['name'] if cur else None, 'entries': [], 'props': {}, 'line': src}
                instances.append(inst)
                pending = inst
                continue
            pending = ('block', key)
            if not stack:
                if key == 'searchpath':
                    search.append(val)
                elif key == 'masfile':
                    mas.append(val)
                continue
            if top is None:
                continue
            if key == 'animfile':
                mesh = None
                if '<' not in val:
                    top.setdefault('anims', []).append(os.path.basename(val.replace('\\', '/')))
                continue
            if key == 'meshfile':
                if '<' in val:
                    mesh = None
                    continue
                mesh = {'file': os.path.basename(val.replace('\\', '/')), 'lodin': None, 'lodout': None,
                        'render': True, 'token': token, 'line': src, 'kv': {}, 'bad': rest or None}
                top['entries'].append(mesh)
            if mesh is not None:
                mesh['kv'][m.group(1)] = m.group(2).strip()
            if mesh is not None and key not in MESH_KEYS:
                mesh.setdefault('unknown', []).append(m.group(1))
            if mesh is not None and key == 'lodin':
                mesh['lodin'] = _num(val)
            elif mesh is not None and key == 'lodout':
                mesh['lodout'] = _num(val)
            elif mesh is not None and key == 'render':
                mesh['render'] = val.strip().lower() not in ('false', '0')
            elif mesh is not None and key == 'shadowcaster':       # ShadowCaster=(True, Solid[, w, h])
                sv = [x.strip().lower() for x in val.strip('()').split(',')]
                mesh['shadow'] = {'on': sv[0] in ('true', '1'), 'solid': len(sv) < 2 or sv[1] != 'texture'}
            elif mesh is None:
                top['props'][key] = val
    if stack:
        issues.append({'line': None, 'msg': '%d Block(e) mit "{" werden nicht mit "}" geschlossen' % len(stack)})
    for inst in instances:
        inst['all_entries'] = list(inst['entries'])
        tokens = {e['token'] for e in inst['entries'] if e['token']}
        keep = next((t for t in _DETAIL_ORDER if t in tokens), None)
        inst['entries'] = [e for e in inst['entries']
                           if e['token'] is None or e['token'] not in _DETAIL_ORDER or e['token'] == keep]
    return {'search_paths': search, 'mas_files': mas, 'instances': instances, 'issues': issues}


def instance_meshes(inst, hidden_only=False):
    """Highest LOD only (smallest LODIn), no Render=False meshes (hidden_only: only those)."""
    entries = [e for e in inst['entries'] if (not e['render']) == hidden_only]
    if not entries:
        return []
    lods = [e['lodin'] or 0.0 for e in entries]
    lo = min(lods)
    out = []
    for e, l in zip(entries, lods):
        if l <= lo + 1e-6 and e['file'].lower() not in [o['file'].lower() for o in out]:
            out.append(e)
    return out


def clean_search_path(sp):
    sp = re.sub(r'<(VEHDIR|TEAMDIR)>', '', sp, flags=re.IGNORECASE).strip()
    if '<' in sp:
        return None
    return sp.lstrip('\\/') or '.'


def resolve_search_dirs(scene_path, search_paths, base_hint=None):
    """SCN/GEN folder first, then the SearchPath entries (relative to the
    Vehicles / Locations root - base_hint, or the parent level where most of
    them exist)."""
    scn_dir = os.path.dirname(os.path.abspath(scene_path))
    rels = [r for r in (clean_search_path(sp) for sp in search_paths) if r]
    real = [r for r in rels if r not in ('.', '')]
    bases = []
    if base_hint:
        bases.append(base_hint)
    b = scn_dir
    for _ in range(6):
        bases.append(b)
        p = os.path.dirname(b)
        if p == b:
            break
        b = p
    best = (0, [], None)
    for base in bases:
        found = [os.path.normpath(p) for p in (ci_join(base, r) for r in real) if p and os.path.isdir(p)]
        if len(found) > best[0]:
            best = (len(found), found, base)
    dirs = [scn_dir]
    if best[0]:
        if '.' in rels:
            dirs.append(os.path.normpath(best[2]))
        dirs += best[1]
    out = []
    for d in dirs:
        if norm(d) not in {norm(x) for x in out}:
            out.append(d)
    return out


# -------------------------------------------------------------------- VEH ---

def parse_veh(path):
    d = {}
    for raw in read_text(path).splitlines():
        line = raw.split('//', 1)[0].strip()
        if '=' not in line:
            continue
        k, v = line.split('=', 1)
        d[k.strip().lower()] = v.strip().strip('"').strip()
    return d


def vehicles_root(path):
    """'...\\ModDev\\Vehicles\\DLMF1_2027\\teams\\x.veh' -> ('...\\Vehicles',
    '...\\Vehicles\\DLMF1_2027')."""
    parts = os.path.abspath(path).split(os.sep)
    for i in range(len(parts) - 1, -1, -1):
        if parts[i].lower() == 'vehicles' and i + 1 < len(parts):
            root = os.sep.join(parts[:i + 1]) or os.sep
            mod = os.sep.join(parts[:i + 2])
            if parts[0].endswith(':'):
                root = root if root.endswith(os.sep) or len(parts[:i + 1]) > 1 else root + os.sep
            return root, mod if os.path.isdir(mod) else None
    return None, None


# ---------------------------------------------------------------- project ---

class Project:
    def __init__(self, path, upgrades=None, gen_mode=None, reuse=None):
        self.path = os.path.abspath(path)
        self.upgrade_sel = dict(upgrades or {})      # upgrade type name -> level index
        self.gen_mode = gen_mode                     # 'spinner' | 'graphics' | None (spinner if the VEH has one)
        self.upgrades = None
        self._reuse = reuse or {}                    # GMT path -> cached mesh info of the previous project
        self.kind = None
        self.title = os.path.basename(self.path.rstrip('\\/')) or self.path
        self.subtitle = ''
        self.parts = []
        self.search_dirs = []          # priority folders (GEN search paths)
        self.index_roots = []          # recursive fallback roots
        self.warnings = []
        self.mas_files = []
        self.mas_virtual = {}          # cache path -> (mas path, entry)   files inside plain MAS archives
        self.mas_names = {}            # name lower -> cache path
        self.mas_loaded = []           # [{'path', 'files', 'error'}]
        self.livery = None
        self.veh_list = []
        self.file_index = {}           # name lower -> path
        self.stem_index = {}           # stem lower -> [paths]
        self.json_by_stem = {}
        self._json_names = None
        self._json_lock = threading.Lock()
        self.mesh_cache = {}
        self.parse_lock = threading.Lock()
        self._open()
        self._build_index()

    # -- opening ---------------------------------------------------------
    def _open(self):
        p = self.path
        ext = os.path.splitext(p)[1].lower()
        if os.path.isdir(p):
            self._open_folder(p)
        elif ext == '.veh':
            self._open_veh(p)
        elif ext in ('.gen', '.scn'):
            self._open_gen(p, None)
        elif ext == '.gmt':
            self.kind = 'gmt'
            self.subtitle = 'Einzelne GMT'
            d = os.path.dirname(p)
            self.search_dirs = [d]
            self.index_roots = [d, os.path.dirname(d)] if os.path.dirname(d) != d else [d]
            self._add_part(p, 'GMT', None)
        else:
            raise ValueError('Nicht unterstützt: %s (Ordner, .veh, .gen, .scn oder .gmt)' % p)

    def _add_part(self, path, group, token, missing=False, visible=True):
        pid = len(self.parts)
        name = os.path.splitext(os.path.basename(path))[0]
        fx = any(pat in name.lower() for pat in FX_PATTERNS)
        hide = any(pat in name.lower() for pat in HIDE_PATTERNS)
        self.parts.append({'id': pid, 'file': path, 'name': name, 'group': group, 'token': token,
                           'missing': missing, 'visible': visible and not hide, 'fx': fx})

    def _open_folder(self, d):
        self.kind = 'folder'
        files = walk_files(d)
        gmts = sorted((f for f in files if f.lower().endswith('.gmt')), key=lambda s: s.lower())
        vehs = sorted(f for f in files if f.lower().endswith('.veh'))
        self.veh_list = [{'path': v, 'name': os.path.relpath(v, d)} for v in vehs[:200]]
        self.search_dirs = [d]
        self.index_roots = [d]
        self._prefetched = files
        self._load_mas_list([os.path.basename(f) for f in list_dir_files(d) if f.lower().endswith('.mas')], [d])
        self.subtitle = '%d GMT · Ordner%s' % (len(gmts), ' + Unterordner' if any(
            os.path.dirname(g) != d for g in gmts) else '')
        show = len(gmts) <= AUTO_SHOW_LIMIT
        if not show:
            self.warnings.append('%d GMT-Dateien gefunden - nur die ersten %d werden automatisch angezeigt. '
                                 'Weitere in der Liste einblenden.' % (len(gmts), AUTO_SHOW_LIMIT))
        for k, g in enumerate(gmts):
            rel = os.path.relpath(os.path.dirname(g), d)
            self._add_part(g, '.' if rel == '.' else rel, None, visible=show or k < AUTO_SHOW_LIMIT)
        if not gmts:
            self.warnings.append('Keine GMT-Dateien in diesem Ordner.')

    def _open_veh(self, p):
        self.kind = 'veh'
        veh = parse_veh(p)
        vroot, mod = vehicles_root(p)
        self.title = os.path.basename(p)
        spin_rel, gfx_rel = veh.get('spinner') or '', veh.get('graphics') or ''
        spin = self._find_rel(spin_rel, p, vroot, mod) if spin_rel else None
        gfx = self._find_rel(gfx_rel, p, vroot, mod) if gfx_rel else None
        self.gen_choices = {'spinner': spin, 'graphics': gfx}
        which = 'Spinner'
        gen = spin
        if self.gen_mode == 'graphics' and gfx:
            which, gen = 'Graphics', gfx
        if gen is None:
            if spin_rel and self.gen_mode != 'graphics':
                self.warnings.append('Spinner-GEN "%s" nicht gefunden - nutze Graphics.' % spin_rel)
            which, gen = 'Graphics', gfx
        if gen is None:
            raise ValueError('GEN-Datei aus der VEH nicht gefunden (%s).' % (gfx_rel or 'kein Graphics= Eintrag'))
        self.gen_mode = which.lower()
        self.gen_path = gen
        self.subtitle = '%s-GEN · %s' % (which, os.path.basename(gen))
        if mod:
            self.index_roots.append(mod)
        self._load_upgrades(veh, p, vroot, mod)
        # rF2: the spinner GEN is pre-processed in spinner mode, unless it is the same file as the
        # Graphics GEN and has no <SPIN>/<NOTSPIN> - then like in-game at MAX detail
        text = read_text(gen)
        if which == 'Spinner':
            mode = UPG.MODE_SPIN
            if gfx_rel and spin_rel.strip().lower() == gfx_rel.strip().lower() and not UPG.gen_has_spin_tokens(text):
                mode = 4
        else:
            up = text.upper()
            mode = next((UPG.DETAIL[d] for d in ('MAX', 'HIGH', 'MED', 'LOW') if '<%s>' % d in up), 4)
        types = self.upgrades['types'] if self.upgrades else []
        sel = {}
        for ti, t in enumerate(types):
            v = self.upgrade_sel.get(t['name'])
            sel[ti] = v if isinstance(v, int) and 0 <= v < len(t['levels']) else 0
        pre, rep = UPG.preprocess_gen(text, mode, types, sel, genstring=veh.get('genstring') or '')
        # file replacement by upgrade level only in-game: in the menu (spinner) rF2 changes only what the GEN tokens
        # say - an upgrade whose token is missing in the spinner GEN has no effect there
        self._build_file_swap(types, sel if mode != UPG.MODE_SPIN else {})
        self.gen_mode_num = mode
        self._gen_report(rep, mode, types, sel, text, which)
        self._open_gen(gen, vroot, keep_kind=True, text=pre, upgrade_sel=sel if mode == UPG.MODE_SPIN else None,
                       line_src=rep.get('line_src'))
        # skins from the VEH header: DefaultLivery -> WCCARBODY, ExtraN -> WCEXTRAN, Helmet -> WCHELMET ...
        # values are next to the VEH, may name a sub folder ("test/X.dds") or only exist in some sub folder
        vdir = os.path.dirname(p)
        skin = {}
        for k, v in veh.items():
            if k.startswith('track'):
                continue
            val = v.split(',')[-1].strip().strip('"')
            if not val or os.path.splitext(val)[1].lower() not in TEX_EXTS + ('',):
                continue
            if k == 'defaultlivery':
                mat = 'WCCARBODY'
            elif k == 'pitcrewlivery':
                continue
            elif os.path.splitext(val)[1].lower() in TEX_EXTS:
                mat = 'WC' + k.upper()
            else:
                continue
            f = self._find_skin(val, vdir)
            skin[mat] = {'key': k, 'value': val, 'path': f}
            if f is None:
                self.warnings.append('VEH %s="%s" nicht gefunden.' % ({'defaultlivery': 'DefaultLivery'}.get(k, k.capitalize()), val))
        liv = veh.get('defaultlivery')
        self.mat_override = {}
        if liv:
            alb = (skin.get('WCCARBODY') or {}).get('path')
            self.livery = {'name': liv, 'albedo': alb, 'extra': [], 'map': {m: e['path'] for m, e in skin.items() if e['path']},
                           'keys': {m: e['key'] for m, e in skin.items()}}
            # per livery: <livery>_region.dds (IBL car body region map) and <livery>.json (WCCARBODY material)
            lstem = os.path.splitext(os.path.basename(liv.replace('\\', '/')))[0]
            base_dir = os.path.dirname(alb) if alb else vdir
            # rF2 "LOOSE SKIN DIRECTORY": UserData\player\Settings\<cmp name>\<livery>\ - files there replace the
            # ones of the vehicle (livery .dds, <livery>_region.dds, <livery>.json), shown in the showroom
            loose = self._loose_skin_dirs(vdir, lstem)
            if loose:
                self.livery['loose'] = loose[0]
                for d in loose:
                    la = self._find_skin(liv, d) if not os.path.isabs(liv) else None
                    if la and os.path.basename(la).lower().startswith(lstem.lower() + '.'):
                        alb = self.livery['albedo'] = la
                        self.livery['map']['WCCARBODY'] = la
                        break
            reg = None
            for d in loose + [base_dir, vdir]:
                reg = self._find_skin(lstem + '_region.dds', d)
                if reg and os.path.basename(reg).lower().startswith(lstem.lower() + '_region.'):
                    break
                reg = None
            if reg:
                self.livery['region'] = reg
                self.file_index.setdefault(os.path.basename(reg).lower(), reg)
            lj = self._find_file(lstem + '.json', loose + [base_dir, vdir])
            if lj:
                self.livery['json'] = lj
                self._register_override(lj, 'Livery')
        mo = veh.get('materialoverride')
        if mo:
            mp = self._find_file(os.path.basename(mo.replace('\\', '/')), [vdir, os.path.dirname(vdir)] + ([mod] if mod else []))
            if not mp:      # rF2 mounts every MAS of the vehicle component - look inside them as well
                mp = self._find_in_mas(os.path.basename(mo.replace('\\', '/')), [vdir, vroot or os.path.dirname(vdir)] + ([mod] if mod else []))
            if not mp:      # rF2 opens it with the global file locator: every mounted MAS /
                # search path of ModDev or Installed (Vehicles, Shared, Core ...), not only the vehicle folder
                top = rf2_top_dir(vdir)
                if top:
                    nm = os.path.basename(mo.replace('\\', '/'))
                    dirs = [d for d in (ci_join(top, x) for x in ('Vehicles', 'Shared', 'Core', 'Locations')) if d and os.path.isdir(d)]
                    mp = self._find_file(nm, dirs) or self._find_in_mas(nm, dirs)
            self.material_override = {'value': mo, 'path': mp}
            if mp:
                self._register_override(mp, 'MaterialOverride')
            else:
                self.warnings.append('VEH MaterialOverride="%s" nicht gefunden - Lackierung ohne IBL-Car-Body-Material (rF2 lädt sie).' % mo)
            for e in skin.values():
                if e['path']:
                    self.file_index.setdefault(os.path.basename(e['path']).lower(), e['path'])
        self.veh = veh

    def _find_file(self, name, dirs):
        """File by name: directly in one of the folders, else in any sub folder of them (case-insensitive)."""
        for d in dirs:
            if not d:
                continue
            c = ci_join(d, name)
            if c and os.path.isfile(c):
                return c
        for d in dirs:
            if not d or not os.path.isdir(d):
                continue
            for f in walk_files(d, 4, 20000):
                if os.path.basename(f).lower() == name.lower():
                    return f
        # like the engine: files are also found inside the mounted MAS archives (vehicle / shared MAS)
        cp = getattr(self, 'mas_names', {}).get(name.lower())
        if cp:
            try:
                return self.ensure(cp)
            except (MAS.MasUnsupported, OSError):
                pass
        return getattr(self, 'file_index', {}).get(name.lower())

    def _find_in_mas(self, name, dirs):
        """File packed in any (plain) MAS below the given folders; that MAS gets mounted."""
        seen = set()
        for d in dirs:
            if not d or not os.path.isdir(d):
                continue
            for f in walk_files(d, 4, 20000):
                if not f.lower().endswith('.mas') or norm(f) in seen:
                    continue
                seen.add(norm(f))
                try:
                    entries = MAS.read_index(f)
                except (MAS.MasUnsupported, OSError, struct.error):
                    continue
                if any(os.path.basename(e['name'].replace('\\', '/')).lower() == name.lower() for e in entries):
                    self.add_mas(f)
                    cp = self.mas_names.get(name.lower())
                    if cp:
                        try:
                            return self.ensure(cp)
                        except (MAS.MasUnsupported, OSError):
                            return None
        return None

    def _register_override(self, path, why):
        """Material JSON that wins over the normal lookup: a single material ("name") or a set of materials."""
        try:
            with open(path, 'rb') as f:
                js = json.loads(f.read().decode('utf-8', 'replace'))
        except (OSError, ValueError) as e:
            self.warnings.append('%s %s nicht lesbar: %s' % (why, os.path.basename(path), e))
            return
        names = []
        if isinstance(js, dict) and isinstance(js.get('name'), str) and 'shader' in js:
            names = [js['name']]
        elif isinstance(js, dict):                       # {"MATNAME": {...material...}, ...} or {"materials": [...]}
            items = js.get('materials') if isinstance(js.get('materials'), list) else list(js.values())
            names = [m['name'] for m in items if isinstance(m, dict) and isinstance(m.get('name'), str)]
        elif isinstance(js, list):
            names = [m['name'] for m in js if isinstance(m, dict) and isinstance(m.get('name'), str)]
        for n in names:
            self.mat_override.setdefault(n.lower(), (path, why))

    def _loose_skin_dirs(self, vdir, lstem):
        """<rF2>\\UserData\\player\\Settings\\<any cmp name>\\<livery>\\ (ModDev and the install folder)."""
        top = rf2_top_dir(vdir)
        if not top:
            return []
        out = []
        for root in (top, os.path.dirname(top)):
            st = ci_join(root, 'UserData/player/Settings')
            if not st or not os.path.isdir(st):
                continue
            try:
                cmps = sorted(os.listdir(st))
            except OSError:
                continue
            for c in cmps:
                d = ci_join(os.path.join(st, c), lstem)
                if d and os.path.isdir(d) and d not in out:
                    out.append(d)
        return out

    def _find_skin(self, val, vdir):
        """VEH texture value: relative to the VEH folder (also "sub/X.dds"); otherwise the file name
        in any sub folder of the VEH folder."""
        rel = val.replace('\\', '/')
        base = os.path.basename(rel)
        stem, ext = os.path.splitext(base)
        exts = [ext.lower()] + [e for e in TEX_EXTS if e != ext.lower()] if ext else list(TEX_EXTS)
        for e in exts:
            c = ci_join(vdir, os.path.splitext(rel)[0] + e)
            if c and os.path.isfile(c):
                return c
        want = {(stem + e).lower() for e in exts}
        hits = [f for f in walk_files(vdir, 4, 20000) if os.path.basename(f).lower() in want]
        if hits:
            hits.sort(key=lambda f: (exts.index(os.path.splitext(f)[1].lower()), f.count(os.sep)))
            return hits[0]
        return None

    def _find_rel(self, rel, veh_path, vroot, mod):
        cands = []
        if vroot:
            cands.append(ci_join(vroot, rel))
        base = os.path.dirname(veh_path)
        for _ in range(4):
            cands.append(ci_join(base, rel))
            cands.append(ci_join(base, os.path.basename(rel.replace('\\', '/'))))
            nb = os.path.dirname(base)
            if nb == base:
                break
            base = nb
        for c in cands:
            if c and os.path.isfile(c):
                return c
        root = mod or os.path.dirname(veh_path)
        want = os.path.basename(rel.replace('\\', '/')).lower()
        for f in walk_files(root, 4, 20000):
            if os.path.basename(f).lower() == want:
                return f
        return None

    def _open_gen(self, gen, vroot, keep_kind=False, text=None, upgrade_sel=None, line_src=None):
        if not keep_kind:
            self.kind = 'gen'
            self.subtitle = os.path.basename(gen)
            if vroot is None:
                vroot, mod = vehicles_root(gen)
                if mod:
                    self.index_roots.append(mod)
        sc = parse_scene_text(text, line_src) if text is not None else parse_scene_file(gen)
        self.gen_issues = list(sc.get('issues', []))
        try:
            self.car_lights = [l for l in parse_scn_extras(text if text is not None else read_text(gen))['lights']
                               if l.get('pos') is not None]
        except (OSError, ValueError):
            self.car_lights = []
        self.gen_shadow_flags = any('shadow' in e for inst in sc['instances'] for e in inst['entries'])
        self.mas_files = sc['mas_files']
        self.search_dirs = resolve_search_dirs(gen, sc['search_paths'], vroot)
        self.index_roots = [d for d in self.search_dirs] + self.index_roots
        quick = {}
        for d in self.search_dirs:
            for f in list_dir_files(d):
                quick.setdefault(os.path.basename(f).lower(), f)
        self._load_mas_list(sc['mas_files'], [os.path.dirname(gen)] + self.search_dirs, gen)
        for n, cp in self.mas_names.items():
            quick.setdefault(n, cp)
        seen = set()
        n_missing = 0
        up_inst = self._upgrade_instances(sc, upgrade_sel)
        parent = {i['name']: i['parent'] for i in sc['instances']}
        for inst in sc['instances']:
            ui = up_inst.get(inst['name'].lower())
            chain, n = [], inst['name']                     # instance + all parent instances (upper case)
            while n is not None and len(chain) < 32:
                chain.append(n.upper())
                n = parent.get(n)
            for e in instance_meshes(inst):                 # vehicle: Render=False meshes (collision etc.) are not loaded
                # upgrade = file replacement (in-game only): a GMT named by the first level is replaced everywhere by the
                # GMT of the selected level (also where it is written directly in the GEN, e.g. SFP22 CHASSIS: SFP22_HALO)
                fname = self._swap_file(e['file'])
                # same GMT in several instances is loaded once - except upgrade copies (spinner <Instance>_<n>)
                key = fname.lower() + ('|' + inst['name'].lower() if ui else '')
                if key in seen:
                    continue
                seen.add(key)
                path = quick.get(fname.lower())
                if path is None:
                    path = self._deep_find(fname)
                grp = re.sub(r'<[^>]*>', '', inst['name']).strip() or inst['name']
                if path is not None and self.is_mas_file(path):
                    try:
                        self.ensure(path)
                    except (MAS.MasUnsupported, OSError):
                        path = None
                if path is None:
                    n_missing += 1
                    self._add_part(fname, grp, e['token'], missing=True, visible=False)
                    self.parts[-1]['chain'] = chain
                    self.parts[-1]['gen'] = {'line': e.get('line'), 'kv': e.get('kv') or {}, 'inst': inst['name']}
                    if ui:
                        self.parts[-1]['upgrade'] = ui
                else:
                    self._add_part(path, grp, e['token'])
                    self.parts[-1]['chain'] = chain
                    self.parts[-1]['gen'] = {'line': e.get('line'), 'kv': e.get('kv') or {}, 'inst': inst['name']}
                    if ui:                                  # spinner copy <Instance>_<n> of an upgrade level
                        self.parts[-1]['upgrade'] = ui
                        self.parts[-1]['visible'] = ui['on']
                    if 'shadow' in e:
                        self.parts[-1]['shadow'] = e['shadow']
                    lk = CAR_LIGHT_INSTANCES.get(grp.upper())
                    if lk:                                  # glow mesh of a car light: only lit when that light is on
                        self.parts[-1]['light'] = lk
                    anims = inst.get('anims') or []
                    if anims:
                        self.parts[-1]['animName'] = anims[0]
        self._gen_lint(sc, gen, text)
        if n_missing:
            msg = '%d GMT aus der GEN nicht als Datei gefunden' % n_missing
            if self.mas_files:
                bad = [m['name'] for m in self.mas_loaded if m.get('error')]
                miss = [m for m in self.mas_files if os.path.basename(m.replace('\\', '/')).lower()
                        not in [x['name'].lower() for x in self.mas_loaded]]
                if bad or miss:
                    msg += ' (MAS: %s)' % ', '.join(['%s verschlüsselt/nicht lesbar' % b for b in bad] +
                                                     ['%s nicht gefunden' % m for m in miss])
            self.warnings.append(msg + '.')

    def _gen_lint(self, sc, gen, text):
        """Typical GEN errors - the checks of the rF2 scene loader (warnings of the game / ModDev viewer), plus
        line syntax. -> self.gen_issues [{'line', 'msg', 'level'}] (line = 0-based source line)."""
        iss = self.gen_issues
        warn = lambda line, msg, lvl='warn': iss.append({'line': line, 'msg': msg, 'level': lvl})
        is_vehicle = self.kind == 'veh' or os.path.splitext(gen)[1].lower() == '.gen'
        spin = getattr(self, 'gen_mode', None) == 'spinner'
        names = [i['name'] for i in sc['instances']]
        up = [n.upper() for n in names]
        if is_vehicle and not any(re.match(r'^SLOT(\d{3}|<ID>)?$', n, re.I) for n in up):
            warn(None, 'Keine Instanz SLOT<ID> - rF2: "Could not find instance SLOT000", das Auto lädt nicht.', 'err')
        if is_vehicle and not spin and self.kind == 'veh':
            miss = [n for n in ('COCKPIT', 'LFTIRE', 'RFTIRE', 'LRTIRE', 'RRTIRE') if n not in up]
            if miss:
                warn(None, 'Graphics-GEN ohne Instanz %s (laut Studio-397-Anleitung nötig, damit das Auto auf der '
                           'Strecke funktioniert).' % ', '.join(miss))
        seen = {}
        for inst in sc['instances']:
            n = inst['name'].upper()
            if n in seen and not n.startswith('SLOT'):
                warn(inst.get('line'), 'Instanz %s kommt mehrfach vor (auch Zeile %s).' % (inst['name'], (seen[n] or 0) + 1))
            seen.setdefault(n, inst.get('line'))
            ents = inst.get('all_entries', inst['entries'])
            kids = any(j['parent'] == inst['name'] for j in sc['instances'])
            if not ents and not kids:
                warn(inst.get('line'), 'Instanz %s hat keine Meshes (rF2: "Instance %s has no meshes").' % (inst['name'], inst['name']))
            vis = {k.lower(): v for k, v in inst.get('props', {}).items()}.get('visgroups')
            files = {}
            for e in ents:
                kv = {k.lower(): v for k, v in (e.get('kv') or {}).items()}
                lo = e.get('line')
                if e.get('bad'):
                    warn(lo, '%s: Text ohne "=" wird von rF2 ignoriert: "%s"' % (e['file'], e['bad']))
                for u in e.get('unknown', []):
                    warn(lo, '%s: unbekannter Schlüssel "%s" (Tippfehler?) - wird ignoriert.' % (e['file'], u))
                sc_ = kv.get('shadowcaster', '').lower()
                if sc_ and not sc_.startswith(('false', '(false')) and \
                        (kv.get('deformable', '').lower() == 'true' or kv.get('damageable', '').lower() == 'true'):
                    warn(lo, '%s ist SHADOWCASTER und DEFORMABLE/DAMAGEABLE - rF2 macht daraus nur einen '
                             'Schattenwerfer.' % e['file'], 'info')
                if vis and (kv.get('colltarget', '').lower() == 'true' or kv.get('hattarget', '').lower() == 'true'):
                    warn(lo, '%s ist CollTarget/HATTarget in Instanz %s mit VisGroups - kann Probleme in der '
                             'Simulation machen.' % (e['file'], inst['name']))
                if e.get('lodin') is not None and e.get('lodout') is not None and e['lodout'] <= e['lodin']:
                    warn(lo, '%s: LODOut (%g) ist nicht größer als LODIn (%g) - das Mesh ist nie sichtbar.'
                         % (e['file'], e['lodout'], e['lodin']))
                if e.get('lodout') is None and e['render']:
                    warn(lo, '%s hat kein LODOut - Standard 10.000 m.' % e['file'], 'info')
                k = (e['file'].lower(), e.get('token'))
                a0, a1 = e.get('lodin') or 0.0, e.get('lodout') if e.get('lodout') is not None else 10000.0
                for (b0, b1, bl) in files.get(k, []):         # same GMT twice with overlapping LOD range
                    if a0 < b1 and b0 < a1:
                        warn(lo, '%s steht in Instanz %s doppelt mit überlappendem LOD (auch Zeile %s) - wird '
                                 'zweimal gezeichnet.' % (e['file'], inst['name'], (bl or 0) + 1))
                        break
                files.setdefault(k, []).append((a0, a1, lo))
            if {k.lower(): v for k, v in inst.get('props', {}).items()}.get('objectlodding', '').lower() == 'true':
                prev = None
                for e in ents:
                    if prev is not None and e.get('lodin') is not None and prev.get('lodout') is not None \
                            and abs(e['lodin'] - prev['lodout']) > 1e-6:
                        warn(e.get('line'), '%s: LODIn (%g) passt nicht zum LODOut (%g) des vorherigen LOD %s.'
                             % (e['file'], e['lodin'], prev['lodout'], prev['file']))
                    prev = e
        src = read_text(gen).splitlines()
        for i, raw in enumerate(src):
            code = raw.split('//', 1)[0]
            if code.count('<') > code.count('>'):
                warn(i, '"<" ohne passendes ">" - rF2: "< does not have matching >".', 'err')
            if code.count('"') % 2:
                warn(i, 'ungerade Anzahl Anführungszeichen.')

    # -- upgrades (VEH Upgrades=) ---------------------------------------------
    def _load_upgrades(self, veh, veh_path, vroot, mod):
        rel = (veh.get('upgrades') or '').strip()
        self.upgrades = None
        if not rel:
            return
        f = self._find_rel(rel, veh_path, vroot, mod)
        if f is None:
            f = self._find_in_mas(os.path.basename(rel.replace('\\', '/')),
                                  [os.path.dirname(veh_path), vroot or os.path.dirname(veh_path)] + ([mod] if mod else []))
            if f:
                f = self.ensure(f)
        if f is None:
            self.warnings.append('VEH Upgrades="%s" nicht gefunden.' % rel)
            return
        try:
            up = UPG.parse_upgrades(read_text(f))
        except OSError as e:
            self.warnings.append('Upgrades "%s": %s' % (rel, e))
            return
        if not up['types']:
            return                                  # empty / only comments: no upgrade list
        up['path'] = f
        up['name'] = os.path.basename(f)
        self.upgrades = up

    def _swap_file(self, name):
        """GMT replaced by the selected upgrade level: GEN=<TOKEN> value of the first level -> value of the selected
        level (compared without extension, the extension of the GEN entry is kept)."""
        sw = getattr(self, 'file_swap', None)
        if not sw:
            return name
        stem, ext = os.path.splitext(name)
        new = sw.get(stem.lower())
        if not new:
            return name
        return new if os.path.splitext(new)[1] else new + ext

    def _build_file_swap(self, types, sel):
        sw = {}
        for ti, t in enumerate(types):
            n = sel.get(ti, 0)
            if n <= 0 or n >= len(t['levels']):
                continue
            first = {k.upper(): v for k, v in t['levels'][0]['gen']}
            for k, v in t['levels'][n]['gen']:
                v0 = first.get(k.upper())
                if not v0 or not v or '/' in v0 or '/' in v or v0.lower() == v.lower():
                    continue
                sw[os.path.splitext(v0)[0].lower()] = v
        self.file_swap = sw

    def _upgrade_instances(self, sc, sel):
        """Spinner mode, like rF2's showroom setup: for every Instance= of an upgrade type the
        copies '<INSTANCE>_<n>' (made by <UPNUMBER>) are shown only for n == selected level, the others hidden.
        n starts at 0 if the first level has a GEN= token containing the instance name with a value containing
        ".gmt", else at 1 (an existing '_0' copy is then left as it is); it stops at the first missing copy.
        The instances COCKPIT and MIRROR are always hidden in the showroom.
        -> {instance name lower: {'type', 'level', 'on'}}"""
        out = {}
        if sel is None:
            return out
        names = {inst['name'].lower() for inst in sc['instances']}
        for nm in ('cockpit', 'mirror'):
            if nm in names:
                out[nm] = {'type': None, 'level': None, 'on': False, 'why': 'Showroom: Instanz %s ist im Menü immer '
                           'ausgeblendet' % nm.upper()}
        if not self.upgrades:
            return out
        for ti, t in enumerate(self.upgrades['types']):
            first = t['levels'][0] if t['levels'] else {'gen': []}
            for inst in t['instances']:
                start = 0 if any(inst in tok and '.gmt' in val for tok, val in first['gen']) else 1
                n = start
                while '%s_%d' % (inst.lower(), n) in names:
                    out['%s_%d' % (inst.lower(), n)] = {'type': t['name'], 'level': n, 'on': n == sel.get(ti, 0)}
                    n += 1
        return out

    def _gen_report(self, rep, mode, types, sel, text, which):
        """Hints about the GEN <-> Upgrades combination, as rF2 would process it."""
        gname = os.path.basename(self.gen_path)
        notes = []
        for tok, n in sorted(rep['unknown'].items()):
            notes.append('%s: Token <%s> ist weder ein Upgrade-Token noch GenString - rF2 meldet "Vehicle gen token '
                         '\"%s\" unknown" und schreibt "unknown_token_%s".' % (gname, tok, tok, tok))
        for tok, owners in sorted(rep['used'].items()):
            if len(owners) > 1:
                notes.append('%s: <%s> wird von mehreren Upgrades definiert (%s) - rF2 hängt alle Werte '
                             'hintereinander.' % (gname, tok, ', '.join(owners)))
        if rep['start_count'] != rep['stop_count']:
            notes.append('%s: %d× <STARTUPGRADES>, aber %d× <STOPUPGRADES>.' % (gname, rep['start_count'], rep['stop_count']))
        if mode == UPG.MODE_SPIN:
            if rep['outside']:
                notes.append('%s (Spinner): Upgrade-Token außerhalb von <STARTUPGRADES>…<STOPUPGRADES>: %s - '
                             'dort gilt immer nur ein Level, im Menü ändert sich nichts.'
                             % (gname, ', '.join('<%s>' % t for t in rep['outside'])))
            if rep['stop_count'] and not rep['start_count']:
                notes.append('%s (Spinner): <STOPUPGRADES> ohne <STARTUPGRADES> - rF2 springt an den Dateianfang '
                             'zurück und wiederholt die ganze GEN.' % gname)
        if types:
            up_text = text.upper()
            for t in types:
                toks = {n.upper() for lv in t['levels'] for n, _ in lv['gen']}
                if toks and not any('<%s>' % k in up_text for k in toks):
                    notes.append('Upgrade "%s": Token %s kommt in %s nicht vor - keine sichtbare Wirkung.'
                                 % (t['name'], ', '.join('<%s>' % k for k in sorted(toks)), gname))
        for i in (self.upgrades or {}).get('issues', []):
            notes.append('%s: %s' % (self.upgrades['name'], i))
        self.upgrade_notes = notes
        self.upgrade_report = {'mode': mode, 'passes': rep['passes'], 'unknown': rep['unknown'], 'events': rep['events']}

    # -- plain MAS archives ------------------------------------------------
    def _load_mas_list(self, names, dirs, gen=None):
        """GEN MASFile= order: GEN folder / search paths, then anywhere inside the mod folder,
        then directly in ...\\Vehicles (shared archives like cmaps.mas), last a deep search."""
        vroot, mod = vehicles_root(gen) if gen else (None, None)
        mod_files = None
        for nm in names:
            base = os.path.basename(nm.replace('\\', '/'))
            path = None
            for d in dirs:
                c = ci_join(d, base) if d else None
                if c and os.path.isfile(c):
                    path = c
                    break
            if path is None and mod:
                if mod_files is None:
                    mod_files = {}
                    for f in walk_files(mod, 6, 60000):
                        mod_files.setdefault(os.path.basename(f).lower(), f)
                path = mod_files.get(base.lower())
            if path is None and vroot:
                c = ci_join(vroot, base)
                if c and os.path.isfile(c):
                    path = c
            if path is None:
                path = self._deep_find(base) if self.index_roots else None
            if path:
                self.add_mas(path)

    def add_mas(self, path, override=False):
        """Index a plain MAS (no keys for encrypted DLC / LMU archives). Returns the info dict."""
        path = os.path.abspath(path)
        for m in self.mas_loaded:
            if norm(m['path']) == norm(path):
                return m
        info = {'path': path, 'name': os.path.basename(path), 'files': 0, 'error': None}
        try:
            entries = MAS.read_index(path)
        except (MAS.MasUnsupported, OSError, struct.error) as e:
            info['error'] = str(e)
            self.warnings.append('%s: %s' % (info['name'], e))
            self.mas_loaded.append(info)
            return info
        st = os.stat(path)
        tag = hashlib.md5(('%s|%d|%d' % (norm(path), st.st_size, int(st.st_mtime))).encode()).hexdigest()[:12]
        cdir = os.path.join(os.path.expanduser('~'), '.rf2_gmt_viewer_cache', os.path.splitext(info['name'])[0] + '_' + tag)
        for e in entries:
            n = os.path.basename(e['name'].replace('\\', '/'))
            if not n:
                continue
            cp = os.path.join(cdir, n)
            self.mas_virtual[norm(cp)] = (path, e)
            if override:
                self.mas_names[n.lower()] = cp
            else:
                self.mas_names.setdefault(n.lower(), cp)
        info['files'] = len(entries)
        # probe one packed entry (zlib / gMotor LZ with the built-in file key)
        packed = [e for e in entries if e['csize'] != e['usize']]
        if packed:
            try:
                MAS.extract(path, min(packed, key=lambda e: e['csize']))
            except MAS.MasUnsupported:
                info['error'] = 'Einträge nicht entpackbar'
                self.warnings.append('%s: Dateiliste gelesen (%d Dateien), aber die Einträge lassen sich nicht entpacken - '
                                     'Texturen daraus fehlen.' % (info['name'], len(entries)))
                for e in entries:
                    n = os.path.basename(e['name'].replace('\\', '/'))
                    cp = os.path.join(cdir, n)
                    self.mas_virtual.pop(norm(cp), None)
                    if self.mas_names.get(n.lower()) == cp:
                        del self.mas_names[n.lower()]
        self.mas_loaded.append(info)
        return info

    def ensure(self, path):
        """Extract a file that lives in a MAS on first use (cache in ~/.rf2_gmt_viewer_cache)."""
        if not path:
            return path
        v = self.mas_virtual.get(norm(path))
        if v and not os.path.isfile(path):
            data = MAS.extract(v[0], v[1])
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + '.part'
            with open(tmp, 'wb') as f:
                f.write(data)
            os.replace(tmp, path)
        return path

    def is_mas_file(self, path):
        return norm(path) in self.mas_virtual if path else False

    def _deep_find(self, name):
        if not hasattr(self, '_deep'):
            self._deep = {}
            for r in self.index_roots:
                for f in walk_files(r, 6, 60000):
                    self._deep.setdefault(os.path.basename(f).lower(), f)
        return self._deep.get(name.lower())

    # -- indexes -----------------------------------------------------------
    def _build_index(self):
        ordered = []
        for d in self.search_dirs:
            ordered += list_dir_files(d)
        files = getattr(self, '_prefetched', None)
        if files is None:
            files = []
            seen_roots = set()
            for r in self.index_roots:
                if norm(r) in seen_roots or not os.path.isdir(r):
                    continue
                seen_roots.add(norm(r))
                files += walk_files(r, 6, MAX_INDEX_FILES)
        for f in ordered + files:
            n = os.path.basename(f).lower()
            self.file_index.setdefault(n, f)
            stem, ext = os.path.splitext(n)
            if ext in TEX_EXTS or ext == '.json':
                self.stem_index.setdefault(stem, [])
                if f not in self.stem_index[stem]:
                    self.stem_index[stem].append(f)
            if ext == '.json':
                self.json_by_stem.setdefault(stem, f)
        for n, cp in self.mas_names.items():           # disk files win over MAS content
            self.file_index.setdefault(n, cp)
            stem, ext = os.path.splitext(n)
            if ext in TEX_EXTS or ext == '.json':
                self.stem_index.setdefault(stem, [])
                if cp not in self.stem_index[stem] and not any(
                        os.path.splitext(c)[1].lower() == ext for c in self.stem_index[stem]):
                    self.stem_index[stem].append(cp)
            if ext == '.json':
                self.json_by_stem.setdefault(stem, cp)
        if self.livery and self.livery.get('albedo'):
            self.file_index.setdefault(os.path.basename(self.livery['albedo']).lower(), self.livery['albedo'])
        # camera files: the one named in the VEH first, then every *.cam of the mod
        cams = []
        want = (getattr(self, 'veh', None) or {}).get('cameras')
        if want:
            w = os.path.basename(want.split('//')[0].strip().replace('\\', '/')).lower()
            if w in self.file_index:
                cams.append(self.file_index[w])
        # only the mod itself (folder after "Vehicles"), never the .cam files of other mods
        mod_root = vehicles_root(self.path)[1]
        if not mod_root:
            mod_root = self.path if os.path.isdir(self.path) else os.path.dirname(self.path)
        mr = norm(mod_root) + os.sep
        for f in ordered + files:
            if (f.lower().endswith('.cam') and norm(f).startswith(mr)
                    and norm(f) not in {norm(c) for c in cams}):
                cams.append(f)
        self.cams = cams[:40]
        cp = None
        want = (getattr(self, 'veh', None) or {}).get('cockpit')
        if want:
            cp = self.file_index.get(os.path.basename(want.replace('\\', '/')).lower())
        if cp is None:
            cp = next((f for f in ordered + files if 'cockpitinfo' in os.path.basename(f).lower()
                       and f.lower().endswith('.ini')), None)
        self.cockpit = cp

    def find_texture(self, name):
        """Texture by name (with or without extension; DDS preferred).
        Animated textures: 'NAME.dds' may only exist as 'NAME_00.dds' / 'NAME00.dds',
        and frame 'NAME01' may be written 'NAME_01'."""
        if not name:
            return None
        n = name.strip().split(' ')[0].lower().replace('\\', '/').split('/')[-1]
        if n in self.file_index and os.path.splitext(n)[1] in TEX_EXTS:
            return self.ensure(self.file_index[n])
        stem = os.path.splitext(n)[0] if os.path.splitext(n)[1] in TEX_EXTS else n
        tries = [stem]
        m = re.match(r'^(.*?)_?(\d\d)$', stem)
        if m:
            # frame NAMExx of an animated stage; some mods only ship NAME.dds (e.g. tyre treads with
            # FrameCount 6) -> fall back to the plain name, then to frame 00
            tries += [m.group(1) + '_' + m.group(2), m.group(1) + m.group(2), m.group(1),
                      m.group(1) + '_00', m.group(1) + '00']
        else:
            tries += [stem + '_00', stem + '00']
        for st in tries:
            cands = [c for c in self.stem_index.get(st, []) if os.path.splitext(c)[1].lower() in TEX_EXTS]
            if cands:
                cands.sort(key=lambda c: TEX_EXTS.index(os.path.splitext(c)[1].lower()))
                return self.ensure(cands[0])
        return None

    def add_source(self, path):
        """Extra texture source chosen in the UI: a file, a folder or a plain MAS. Files win over the index."""
        path = os.path.abspath(path)
        added = []
        if os.path.isdir(path):
            files = walk_files(path, 4, 20000)
        elif path.lower().endswith('.mas'):
            info = self.add_mas(path, override=True)
            if info.get('error'):
                raise ValueError('%s: %s' % (info['name'], info['error']))
            files = []
            for n, cp in self.mas_names.items():
                if self.mas_virtual.get(norm(cp), (None,))[0] == path:
                    self.file_index[n] = cp
                    st, ext = os.path.splitext(n)
                    if ext in TEX_EXTS:
                        self.stem_index[st] = [cp] + [c for c in self.stem_index.get(st, []) if c != cp]
                    added.append(n)
            return added
        else:
            files = [path]
        for f in files:
            n = os.path.basename(f).lower()
            st, ext = os.path.splitext(n)
            if ext not in TEX_EXTS and ext != '.json':
                continue
            self.file_index[n] = f
            self.stem_index[st] = [f] + [c for c in self.stem_index.get(st, []) if c != f]
            if ext == '.json':
                self.json_by_stem[st] = f
                self._json_names = None
            added.append(n)
        return added

    def json_names(self):
        """{internal 'name' lower: path} of all material JSONs (lazy)."""
        with self._json_lock:
            if self._json_names is None:
                out = {}
                for stem, path in self.json_by_stem.items():
                    try:
                        self.ensure(path)
                        if os.path.getsize(path) > 400_000:
                            continue
                        with open(path, 'rb') as f:
                            js = json.loads(f.read().decode('utf-8', 'replace'))
                        if isinstance(js, dict) and 'shader' in js and isinstance(js.get('name'), str):
                            out.setdefault(js['name'].lower(), path)
                    except (OSError, ValueError):
                        continue
                self._json_names = out
            return self._json_names

    def find_material_json(self, mat_name):
        """Like the engine: livery JSON / VEH MaterialOverride first, then '<material>.json', then the 'name' field."""
        if not mat_name:
            return None
        ov = getattr(self, 'mat_override', {}).get(mat_name.lower())
        if ov:
            return ov[0]
        p = self.json_by_stem.get(mat_name.lower())
        if p:
            return p
        p = self.json_names().get(mat_name.lower())
        if p:
            return p
        return self._global_json(mat_name.lower() + '.json')

    def _global_json(self, fname):
        """rF2 opens '<material>.json' with its global file locator: every mounted MAS / search path of ModDev or
        Installed (Shared, Core, Vehicles ...). One index of all .json there (loose + in plain MAS), built once."""
        idx = getattr(self, '_gjson', None)
        if idx is None:
            idx = self._gjson = {}
            top = rf2_top_dir(self.path) if getattr(self, 'path', None) else None
            if top:
                for sub in ('Shared', 'Core', 'Vehicles'):
                    d = ci_join(top, sub)
                    if not d or not os.path.isdir(d):
                        continue
                    for f in walk_files(d, 6, 60000):
                        low = f.lower()
                        if low.endswith('.json'):
                            idx.setdefault(os.path.basename(low), ('file', f))
                        elif low.endswith('.mas'):
                            try:
                                entries = MAS.read_index(f)
                            except Exception:
                                continue
                            for e in entries:
                                n = os.path.basename(e['name'].replace('\\', '/')).lower()
                                if n.endswith('.json'):
                                    idx.setdefault(n, ('mas', f))
        hit = idx.get(fname)
        if not hit:
            return None
        self._gjson_hits = getattr(self, '_gjson_hits', set())
        if hit[0] == 'file':
            self._gjson_hits.add(hit[1])
            return hit[1]
        try:
            self.add_mas(hit[1])
            cp = self.mas_names.get(fname)
            cp = self.ensure(cp) if cp else None
            if cp:
                self._gjson_hits.add(cp)
            return cp
        except (MAS.MasUnsupported, OSError):
            return None

    def all_material_jsons(self):
        out = []
        for stem, path in sorted(self.json_by_stem.items()):
            out.append({'name': stem, 'path': path})
        return out

    # -- meshes --------------------------------------------------------------
    def part_info(self, pid, frame=None):
        part = self.parts[pid]
        if part['missing']:
            return None
        if frame is None and pid in self.mesh_cache:
            return self.mesh_cache[pid]
        if frame is None and part['file'] in self._reuse:
            self.mesh_cache[pid] = self._reuse[part['file']]
            return self.mesh_cache[pid]
        res = build_mesh(part['file'], lambda bones: self._anm_for(part, bones), frame)
        res['meta']['materials'] = [self._material_entry(m) for m in res['meta']['materials']]
        if frame is None:
            self.mesh_cache[pid] = res
        return res

    def _anm_for(self, part, bone_names):
        """ANM for a skinned GMT: AnimFile of its GEN instance, else the ANM in
        the mod/folder whose node names cover the bones best (>= 60 %)."""
        if 'anmPath' in part:
            return part['anmPath']
        path = None
        want = part.get('animName')
        if want:
            path = self.file_index.get(want.lower())
            if path is None:
                stem = os.path.splitext(want)[0].lower()
                path = next((f for n, f in self.file_index.items() if n.endswith('.anm') and n[:-4] == stem), None)
        if path is None and bone_names:
            bn = {b.strip().upper() for b in bone_names}
            gdir = norm(os.path.dirname(part['file']))
            best = (0.0, None)
            cands = [f for n, f in self.file_index.items() if n.endswith('.anm')]
            cands.sort(key=lambda f: (norm(os.path.dirname(f)) != gdir, f.lower()))
            for f in cands[:400]:
                try:
                    self.ensure(f)
                    names = G.anm_node_names(G.parse_anm(f, with_keys=False))
                except (OSError, ValueError, struct.error):
                    continue
                score = len(bn & names) / max(1, len(bn))
                if score > best[0] + 1e-9:
                    best = (score, f)
            if best[0] >= 0.6:
                path = best[1]
        if path:
            self.ensure(path)
        part['anmPath'] = path
        return path

    def _material_entry(self, m):
        jp = self.find_material_json(m['name'])
        js = None
        if jp:
            try:
                self.ensure(jp)
                with open(jp, 'rb') as f:
                    js = json.loads(f.read().decode('utf-8', 'replace'))
            except (OSError, ValueError) as e:
                self.warnings.append('JSON %s nicht lesbar: %s' % (jp, e))
            if js is not None and not (isinstance(js, dict) and 'shader' in js):     # material set (MaterialOverride)
                items = js.get('materials') if isinstance(js, dict) and isinstance(js.get('materials'), list) else (
                    list(js.values()) if isinstance(js, dict) else js if isinstance(js, list) else [])
                js = next((x for x in items if isinstance(x, dict) and str(x.get('name', '')).lower() == m['name'].lower()), None)
                m['json_from'] = jp                  # part of a material set - not saved back as a single material
            elif js is not None and jp in getattr(self, '_gjson_hits', ()):
                m['json_from'] = jp                  # found by the global locator (Shared/Core/...) - read only
        ov = getattr(self, 'mat_override', {}).get((m['name'] or '').lower())
        m['json_path'] = None if m.get('json_from') else jp
        m['json'] = js
        m['json_source'] = ov[1] if ov and ov[0] == jp else None
        return m

    def preload(self, workers=6):
        ids = [p['id'] for p in self.parts if not p['missing'] and p['visible']]
        with ThreadPoolExecutor(workers) as ex:
            list(ex.map(self._safe_info, ids))

    def _safe_info(self, pid):
        try:
            return self.part_info(pid)
        except Exception as e:      # noqa - shown in the UI
            self.parts[pid]['error'] = str(e)
            return None

    # -- showrooms (rF2 ...\ModDev\Showroom or ...\Installed\Showroom) ----------------
    def showroom_dir(self):
        return showroom_dir_for(self.path)

    def showrooms(self):
        d = self.showroom_dir()
        if not d:
            return None
        if getattr(self, '_showrooms', None) is None:
            self._showrooms = list_showrooms(d[0])
        return {'dir': d[0], 'kind': d[1], 'items': self._showrooms}

    def load_showroom(self, mas_path):
        """Add the showroom scene (SCN inside its MAS) as extra parts ('env'). Its INI is ignored."""
        mas_path = os.path.abspath(mas_path)
        for prt in self.parts:                       # drop the previous showroom
            if prt.get('env'):
                prt['missing'] = True
                prt['visible'] = False
        info = self.add_mas(mas_path)
        if info.get('error'):
            raise ValueError('%s: %s' % (info['name'], info['error']))
        mine = {}
        for n, cp in self.mas_names.items():
            if self.mas_virtual.get(norm(cp), (None,))[0] == mas_path:
                mine[n] = cp
                self.file_index.setdefault(n, cp)    # car files keep priority
                st, ext = os.path.splitext(n)
                if ext in TEX_EXTS or ext == '.json':
                    lst = self.stem_index.setdefault(st, [])
                    if cp not in lst:
                        lst.append(cp)
                if ext == '.json':
                    self.json_by_stem.setdefault(st, cp)
                    self._json_names = None
        # the showroom's own files win inside the showroom (same names in other MAS are possible)
        self._showroom_files = mine
        scn = next((cp for n, cp in mine.items() if n.endswith('.scn')), None)
        if not scn:
            raise ValueError('%s: keine SCN-Datei in der MAS' % os.path.basename(mas_path))
        self.ensure(scn)
        sc = parse_scene_file(scn)
        extra = parse_scn_extras(read_text(scn))
        added = []
        seen = set()
        for inst in sc['instances']:
            # Render=False instances (e.g. Light_Studio LIGHTS_HIDDEN) are not drawn in the main view, but rF2 renders
            # them into the reflection maps (measured: the captured showroom cube shows them) -> 'reflectOnly'
            hidden = {e['file'].lower() for e in inst['entries'] if not e['render']}
            for e in instance_meshes(inst) + instance_meshes(inst, hidden_only=True):
                key = e['file'].lower()
                if key in seen:
                    continue
                seen.add(key)
                path = mine.get(key) or self.mas_names.get(key) or self.file_index.get(key)
                if path and self.is_mas_file(path):
                    try:
                        self.ensure(path)
                    except (MAS.MasUnsupported, OSError):
                        path = None
                if not path:
                    continue
                self._add_part(path, 'Showroom', None)
                self.parts[-1]['env'] = True
                self.parts[-1]['fx'] = False
                self.parts[-1]['visible'] = True
                self.parts[-1]['reflectOnly'] = key in hidden and not e['render']
                added.append({k: self.parts[-1][k] for k in ('id', 'name', 'group', 'file', 'reflectOnly')})
        try:
            name = showroom_name(mas_path, [e['name'] for e in MAS.read_index(mas_path)])
        except (MAS.MasUnsupported, OSError, struct.error):
            name = showroom_name(mas_path, [])
        cube = None                                   # static reflection cube (e.g. TRACK_CUBE.DDS)
        for n, cp in sorted(mine.items()):
            if n.endswith('.dds') and 'cube' in n:
                try:
                    self.ensure(cp)
                    with open(cp, 'rb') as fh:
                        hd = fh.read(128)
                    if len(hd) == 128 and struct.unpack_from('<I', hd, 112)[0] & 0x200:
                        cube = os.path.basename(cp)
                        break
                except (MAS.MasUnsupported, OSError):
                    continue
        return {'name': name, 'mas': mas_path, 'scn': os.path.basename(scn), 'parts': added, 'cube': cube, **extra}

    def summary(self):
        return {
            'path': self.path, 'kind': self.kind, 'title': self.title, 'subtitle': self.subtitle,
            'parts': [{k: p[k] for k in ('id', 'name', 'group', 'token', 'missing', 'visible', 'fx')}
                      | {'file': p['file'], 'error': p.get('error'), 'shadow': p.get('shadow'), 'light': p.get('light'),
                         'upgrade': p.get('upgrade'), 'chain': p.get('chain'), 'added': p.get('added'),
                         'gen': p.get('gen') or ({'line': None, 'inst': 'SLOT<ID>', 'kv': {'MeshFile': os.path.basename(p['file']),
                                                 **dict(GW.DEFAULT_KV)}} if self.kind in ('gmt', 'folder') else None)}
                      for p in self.parts if not p.get('env') and not p.get('removed')],
            'carLights': getattr(self, 'car_lights', []), 'genShadowFlags': getattr(self, 'gen_shadow_flags', False),
            'materialOverride': getattr(self, 'material_override', None),
            'warnings': self.warnings, 'searchDirs': self.search_dirs, 'masFiles': self.mas_files,
            'gen': {'path': getattr(self, 'gen_path', None),
                    'issues': [dict(i, level=i.get('level', 'warn')) for i in getattr(self, 'gen_issues', [])]},
            'livery': self.livery, 'vehList': self.veh_list,
            'cams': [{'path': c, 'name': os.path.basename(c)} for c in self.cams],
            'cockpit': self.cockpit,
            'upgrades': self._upgrades_summary(),
        }

    def reconfigure(self, upgrades, gen_mode):
        """Other upgrade levels / GEN mode without rebuilding everything (like rF2, only what changes): the GEN is
        pre-processed again, parts that stay (same GMT in the same instance) keep their id and their already read
        mesh, parts that drop out are marked removed, new ones are appended. Showroom parts stay untouched.
        -> {'added': [ids], 'removed': [ids], 'changed': [ids]}"""
        reuse = {self.parts[pid]['file']: info for pid, info in self.mesh_cache.items() if not self.parts[pid].get('env')}
        new = Project(self.path, upgrades=upgrades, gen_mode=gen_mode, reuse=reuse)
        key = lambda q: (q['file'].lower(), (q.get('group') or '').lower())
        old_by_key = {key(q): q for q in self.parts if not q.get('env') and not q.get('removed') and not q.get('added')}
        diff = {'added': [], 'removed': [], 'changed': []}
        seen = set()
        for q in new.parts:
            k = key(q)
            o = old_by_key.get(k)
            if o is None:                                   # new GMT / new instance
                pid = len(self.parts)
                q = dict(q, id=pid)
                self.parts.append(q)
                if q['file'] in reuse:
                    self.mesh_cache[pid] = reuse[q['file']]
                diff['added'].append(pid)
                continue
            seen.add(k)
            ch = False
            for f in ('upgrade', 'token', 'missing'):
                if o.get(f) != q.get(f):
                    o[f] = q.get(f)
                    ch = True
            if q.get('upgrade') and o.get('visible') != q.get('visible'):
                o['visible'] = q['visible']
                ch = True
            if ch:
                diff['changed'].append(o['id'])
        for k, o in old_by_key.items():
            if k not in seen:
                o['removed'] = True
                o['missing'] = True
                o['visible'] = False
                self.mesh_cache.pop(o['id'], None)
                diff['removed'].append(o['id'])
        # project state of the new GEN (search paths, warnings, upgrades ...); indexes merged so showroom files stay
        keep = {'parts', 'mesh_cache', '_reuse', 'parse_lock', '_json_lock', 'path'}
        for name, val in new.__dict__.items():
            if name in keep:
                continue
            old = getattr(self, name, None)
            if isinstance(val, dict) and isinstance(old, dict) and name in (
                    'mas_virtual', 'mas_names', 'file_index', 'stem_index', 'json_by_stem'):
                merged = dict(old)
                merged.update(val)
                setattr(self, name, merged)
            elif name == 'mas_loaded':
                have = {norm(m['path']) for m in val}
                setattr(self, name, val + [m for m in (old or []) if norm(m['path']) not in have])
            else:
                setattr(self, name, val)
        self._reuse = {}
        return diff

    # -- editing: dropped GMTs, saving the GEN ---------------------------------
    def add_dropped(self, name, data, inst=None):
        """A file dragged into the window (bytes, no path - the browser does not give one): stored in the cache.
        GMT -> new part (instance SLOT<ID> unless given), DDS/TGA/... -> texture source."""
        name = os.path.basename((name or '').replace('\\', '/'))
        ext = os.path.splitext(name)[1].lower()
        if not name or not data:
            raise ValueError('leere Datei')
        d = os.path.join(os.path.expanduser('~'), '.rf2_gmt_viewer_cache', 'dropped')
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, name)
        with open(path, 'wb') as f:
            f.write(data)
        if ext in TEX_EXTS or ext == '.json':
            n = name.lower()
            self.file_index[n] = path
            st = os.path.splitext(n)[0]
            lst = self.stem_index.setdefault(st, [])
            lst[:] = [path] + [x for x in lst if norm(x) != norm(path)]
            if ext == '.json':
                self.json_by_stem[st] = path
            return {'kind': 'tex', 'name': name}
        if ext != '.gmt':
            raise ValueError('%s: nur GMT, Texturen (DDS/TGA/…) und JSON können hineingezogen werden' % name)
        slot = next((q['gen']['inst'] for q in self.parts if q.get('gen') and re.match(r'^SLOT', q['gen']['inst'], re.I)), 'SLOT<ID>')
        grp = inst or slot
        self._add_part(path, grp, None)
        q = self.parts[-1]
        q['added'] = True
        q['chain'] = [grp.upper()]
        q['gen'] = {'line': None, 'kv': {'MeshFile': name, **dict(GW.DEFAULT_KV)}, 'inst': grp}
        try:
            self.part_info(q['id'])
        except Exception as e:      # noqa - shown in the UI
            q['error'] = str(e)
        return {'kind': 'gmt', 'part': self._part_summary(q)}

    def _part_summary(self, p):
        return ({k: p[k] for k in ('id', 'name', 'group', 'token', 'missing', 'visible', 'fx')}
                | {'file': p['file'], 'error': p.get('error'), 'shadow': p.get('shadow'), 'light': p.get('light'),
                   'upgrade': p.get('upgrade'), 'chain': p.get('chain'), 'gen': p.get('gen'), 'added': p.get('added')})

    def save_gen(self, body):
        """body: {'target', 'overwrite', 'deleted': [ids], 'props': {id: {key: value|None}},
        'inst': {id: instance} (new parts), 'copyNew': bool}. Existing GEN: only touched lines change (genwrite);
        no GEN (GMT / folder): a new GEN with all parts that are not deleted."""
        deleted = {int(i) for i in body.get('deleted') or []}
        props = {int(k): v for k, v in (body.get('props') or {}).items()}
        insts = {int(k): v for k, v in (body.get('inst') or {}).items()}
        src = getattr(self, 'gen_path', None) if self.kind in ('veh', 'gen') else None
        target = (body.get('target') or '').strip().strip('"')
        if not target:
            raise ValueError('Kein Zielpfad')
        if not os.path.isabs(target):
            base = os.path.dirname(src) if src else (self.path if os.path.isdir(self.path) else os.path.dirname(self.path))
            target = os.path.join(base, target)
        if not target.lower().endswith('.gen'):
            target += '.gen'
        added = []
        for q in self.parts:
            if q.get('env') or q.get('removed') or q['id'] in deleted:
                continue
            if src is None or q.get('added'):
                kv = dict(GW.DEFAULT_KV) if not q.get('gen') else {k: v for k, v in q['gen']['kv'].items() if k.lower() != 'meshfile'}
                for k, v in (props.get(q['id']) or {}).items():
                    if v is None:
                        kv.pop(k, None)
                    elif k.lower() != 'meshfile':
                        kv[k] = v
                inst = insts.get(q['id']) or (q.get('gen') or {}).get('inst') or q.get('group') or 'SLOT<ID>'
                if src is None and (inst in ('GMT', '.') or not re.match(r'^[A-Za-z_][A-Za-z0-9_<>]*$', inst)):
                    inst = 'SLOT<ID>'
                added.append({'file': os.path.basename(q['file']), 'inst': inst, 'kv': list(kv.items()), 'src': q['file']})
        if src:
            text = read_text(src)
            edits, dl = {}, set()
            for pid, ch in props.items():
                q = self.parts[pid] if 0 <= pid < len(self.parts) else None
                if q and q.get('gen') and q['gen'].get('line') is not None and not q.get('added'):
                    edits.setdefault(q['gen']['line'], {}).update(ch)
            for pid in deleted:
                q = self.parts[pid] if 0 <= pid < len(self.parts) else None
                if q and q.get('gen') and q['gen'].get('line') is not None and not q.get('added'):
                    dl.add(q['gen']['line'])
            out = GW.write_gen(text, edits, dl, [a for a in added])
        else:
            out = GW.new_gen(added)
        if os.path.exists(target):
            if not body.get('overwrite'):
                raise ValueError('%s existiert schon' % os.path.basename(target))
            bak = target + '.bak'
            if not os.path.exists(bak):
                with open(target, 'rb') as f, open(bak, 'wb') as g:
                    g.write(f.read())
        with open(target, 'w', encoding='latin-1', errors='replace', newline='') as f:
            f.write(out)
        copied = []
        if body.get('copyNew'):
            dest = os.path.dirname(target)
            for a in added:
                if '.rf2_gmt_viewer_cache' in a['src'] and os.path.isfile(a['src']):
                    d = os.path.join(dest, a['file'])
                    if not os.path.exists(d):
                        with open(a['src'], 'rb') as f, open(d, 'wb') as g:
                            g.write(f.read())
                        copied.append(a['file'])
        return {'path': target, 'copied': copied, 'added': len(added) if src else 0}

    def _upgrades_summary(self):
        if not self.upgrades:
            return None
        types = []
        for ti, t in enumerate(self.upgrades['types']):
            v = self.upgrade_sel.get(t['name'])
            types.append({'name': t['name'], 'instances': t['instances'],
                          'selected': v if isinstance(v, int) and 0 <= v < len(t['levels']) else 0,
                          'visual': any(lv['gen'] for lv in t['levels']),
                          'levels': [{'name': lv['name'], 'description': lv['description'],
                                      'gen': [{'token': n, 'value': v2} for n, v2 in lv['gen']]} for lv in t['levels']]})
        ch = getattr(self, 'gen_choices', {}) or {}
        return {'file': self.upgrades['path'], 'name': self.upgrades['name'], 'types': types,
                'genMode': self.gen_mode, 'genModes': {k: os.path.basename(v) for k, v in ch.items() if v},
                'notes': getattr(self, 'upgrade_notes', []), 'report': getattr(self, 'upgrade_report', None)}


# ------------------------------------------------------------- showrooms ---

def rf2_top_dir(path):
    r"""...\ModDev or ...\Installed above a path (the folder rF2 mounts its components from), else None."""
    parts = os.path.abspath(path).replace('/', os.sep).split(os.sep)
    for i in range(len(parts) - 1, -1, -1):
        if parts[i].lower() in ('moddev', 'installed'):
            return os.sep.join(parts[:i + 1]) or os.sep
    return None


def showroom_dir_for(path):
    r"""rF2 root from any path below ...\ModDev\ or ...\Installed\ -> (<root>\<that>\Showroom, 'ModDev'|'Installed')."""
    parts = os.path.abspath(path).replace('/', os.sep).split(os.sep)
    for i in range(len(parts) - 1, -1, -1):
        low = parts[i].lower()
        if low in ('moddev', 'installed'):
            base = os.sep.join(parts[:i + 1]) or os.sep
            d = ci_join(base, 'Showroom')
            if d and os.path.isdir(d):
                return d, parts[i]
            return None
    return None


def showroom_name(mas_path, entry_names):
    ini = next((n for n in entry_names if n.lower().endswith('.ini')), None)
    stem = os.path.splitext(os.path.basename(ini or mas_path))[0]
    return stem.replace('_', ' ').strip() or stem


def list_showrooms(d):
    out = []
    for f in walk_files(d, 5, 5000):
        if not f.lower().endswith('.mas'):
            continue
        try:
            names = [e['name'] for e in MAS.read_index(f)]
        except (MAS.MasUnsupported, OSError, struct.error) as e:
            out.append({'name': os.path.splitext(os.path.basename(f))[0].replace('_', ' '), 'mas': f,
                        'error': str(e)})
            continue
        if not any(n.lower().endswith('.scn') for n in names):
            continue
        out.append({'name': showroom_name(f, names), 'mas': f})
    out.sort(key=lambda x: x['name'].lower())
    return out


# rF2 car light glow instances (docs.studio-397.com "Car Lights")
CAR_LIGHT_INSTANCES = {'HLIGHTDS': 'head', 'HLIGHTPS': 'head', 'BLIGHTDS': 'brake', 'BLIGHTPS': 'brake',
                       'RAINLIGHT': 'rain', 'REVERSELIGHT': 'reverse', 'WARNINGLIGHT': 'warning'}

_VEC_RE = r'\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)'


def parse_scn_extras(text):
    """Lights, view clear colour and shadow range of an SCN (rF2 coordinates; converted to GL)."""
    lights = []
    body = '\n'.join(l.split('//', 1)[0] for l in text.splitlines())
    for m in re.finditer(r'Light\s*=\s*([^\s{]+)\s*\{([^}]*)\}', body, re.I):
        blk = m.group(2)
        tp = re.search(r'Type\s*=\s*(\w+)', blk, re.I)
        dr = re.search(r'Dir\s*=\s*' + _VEC_RE, blk, re.I)
        co = re.search(r'Color\s*=\s*' + _VEC_RE, blk, re.I)
        ps = re.search(r'Pos\s*=\s*' + _VEC_RE, blk, re.I)
        L = {'name': m.group(1), 'type': (tp.group(1) if tp else 'Directional').lower()}
        if dr:
            x, y, z = (float(v) for v in dr.groups())
            L['dir'] = [x, y, -z]
        if ps:
            x, y, z = (float(v) for v in ps.groups())
            L['pos'] = [x, y, -z]
        L['color'] = [float(v) for v in co.groups()] if co else [255.0, 255.0, 255.0]
        for key in ('Range', 'Hotspots', 'Falloff', 'Intensity', 'Attenuate'):
            mm = re.search(key + r'\s*=\s*\(([^)]*)\)', blk, re.I)
            if mm:
                try:
                    L[key.lower()] = [float(x) for x in mm.group(1).split(',') if x.strip()]
                except ValueError:
                    pass
        ac = re.search(r'Active\s*=\s*(\w+)', blk, re.I)
        if ac:
            L['active'] = ac.group(1).lower() in ('true', '1')
        lights.append(L)
    view = re.search(r'View\s*=\s*mainview\s*\{([^}]*)\}', body, re.I)
    vc = None
    if view:
        c = re.search(r'Color\s*=\s*' + _VEC_RE, view.group(1), re.I)
        if c:
            vc = [float(v) for v in c.groups()]
    msr = re.search(r'MaxShadowRange\s*=\s*\(\s*([-+\d.eE]+)', body, re.I)
    pr = re.search(r'PROBE_POSITION\s*=\s*' + _VEC_RE, body, re.I)     # IRRADIANCE_PROBE (rF2 coordinates)
    return {'lights': lights, 'viewColor': vc, 'maxShadowRange': float(msr.group(1)) if msr else None,
            'probe': [float(v) for v in pr.groups()] if pr else None}


# ------------------------------------------------------------ mesh packing ---

def _to_gl(a):
    """Blender-ordered (x, z_game, y_game) -> GL (x, y, -z): game LH -> GL RH."""
    a = np.asarray(a, np.float64).reshape(-1, 3)
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], axis=1)


def _smooth_normals(V, T):
    n = np.zeros_like(V)
    if len(T):
        fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
        for k in range(3):
            np.add.at(n, T[:, k], fn)
    ln = np.linalg.norm(n, axis=1)
    ln[ln == 0] = 1.0
    return n / ln[:, None]


_CUBEAB = ('CUBEAB_ZERO', 'CUBEAB_ONE', 'CUBEAB_SRCCOLOR', 'CUBEAB_INVSRCCOLOR', 'CUBEAB_SRCALPHA', 'CUBEAB_INVSRCALPHA',
           'CUBEAB_DSTALPHA', 'CUBEAB_INVDSTALPHA', 'CUBEAB_DSTCOLOR', 'CUBEAB_INVDSTCOLOR', 'CUBEAB_SRCALPHASAT')


# CUBEMAT flag bits (flag name -> bit), stored at GMT material +0x40
CUBEMAT_BITS = (('CUBEMAT_NOSHADE', 0x4), ('CUBEMAT_FLATSHADE', 0x8), ('CUBEMAT_GOURAUDSHADE', 0x10),
                ('CUBEMAT_ALPHACHANNEL', 0x20), ('CUBEMAT_SPECULAR', 0x40), ('CUBEMAT_NOZBUFFER', 0x100),
                ('CUBEMAT_UNIQUEMAT', 0x200), ('CUBEMAT_FRESNELREFLECT', 0x400), ('CUBEMAT_TWOSIDED', 0x800),
                ('CUBEMAT_FRESNELSPECULAR', 0x1000), ('CUBEMAT_RELIGHT', 0x2000), ('CUBEMAT_DRAWWIREFRAME', 0x8000),
                ('CUBEMAT_DRAWPOSTSHADOW', 0x10000), ('CUBEMAT_SORTEDALPHA', 0x40000),
                ('CUBEMAT_LOCALINTENSITY', 0x80000), ('CUBEMAT_AMBIENTMAT', 0x100000),
                ('CUBEMAT_AMBIENTDIR', 0x200000), ('CUBEMAT_AMBIENTSPC', 0x400000), ('CUBEMAT_DIFFUSEMAT', 0x800000),
                ('CUBEMAT_DIFFUSEDIR', 0x1000000), ('CUBEMAT_DIFFUSESPC', 0x2000000),
                ('CUBEMAT_SPECLARMAT', 0x4000000), ('CUBEMAT_SPECLARDIR', 0x8000000),
                ('CUBEMAT_SPECLARSPC', 0x10000000), ('CUBEMAT_EMISSIVMAT', 0x20000000),
                ('CUBEMAT_EMISSIVDIR', 0x40000000), ('CUBEMAT_EMISSIVSPC', 0x80000000))


def _gmt_flags(raw):
    if not raw or len(raw) < 0x44:
        return []
    v = struct.unpack_from('<I', raw, 0x40)[0]
    return [n for n, b in CUBEMAT_BITS if v & b]


def _gmt_std(raw):
    """GMT material record -> rF2 "StandardInfo" (CUBEMATERIAL): +0x44 diffuse, +0x54 ambient, +0x64 specular,
    +0x74 emissive (RGBA), +0x8c specular power, +0xd4 Fresnel (Exp, Min, Max)."""
    if not raw or len(raw) < 0xe0:
        return None
    f = struct.unpack_from('<16f', raw, 0x44)
    ok = lambda v: v == v and abs(v) < 1e5
    if not all(ok(v) for v in f):
        return None
    sp = struct.unpack_from('<f', raw, 0x8c)[0]
    fe, fmin, fmax = struct.unpack_from('<3f', raw, 0xd4)
    fr = {'Exp': fe, 'Min': fmin, 'Max': fmax} if all(ok(v) for v in (fe, fmin, fmax)) else None
    return {'diffuseColour': list(f[0:4]), 'ambientColour': list(f[4:8]), 'specularColour': list(f[8:12]),
            'emissiveColour': list(f[12:16]), 'specPower': sp if ok(sp) else 1.0,
            'specFresnel': fr, 'cubeMapFresnel': fr}


def _gmt_blend(raw):
    """GMT material record: +0x84 src blend, +0x88 dst blend (D3D enum, 1 = ZERO)."""
    if not raw or len(raw) < 0x8c:
        return None, None
    a, b = struct.unpack_from('<2I', raw, 0x84)
    if 1 <= a <= 11 and 1 <= b <= 11:
        return _CUBEAB[a - 1], _CUBEAB[b - 1]
    return None, None


def _key_matrix(k):
    """ANM key (t, px, py, pz, -, -, -, qx, qy, qz, qw) -> 4x4 row-vector matrix (game space)."""
    qx, qy, qz, qw = k[7:11]
    n = math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
    if n < 1e-8:
        qx, qy, qz, qw = 0.0, 0.0, 0.0, 1.0
    else:
        qx, qy, qz, qw = qx / n, qy / n, qz / n, qw / n
    x, y, z, w = qx, qy, qz, qw
    m = np.eye(4)
    m[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                 [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                 [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    m[3, :3] = k[1:4]
    return m


def pose_skin(data, best, info, anm, frame):
    """CPU skinning of one ANM frame.  Key = bone transform relative to its own
    bind pose in the bind frame: world = Key * Bind (row vectors), so a vertex
    moves by  Bind^-1 * Key * Bind.  Returns game-space (pos, nrm, tan, bit)."""
    vstart, vstride = best['vstart'], best['vstride']
    vc = len(best['vertices'])
    vrec = np.frombuffer(data, np.uint8, count=vc * vstride, offset=vstart).reshape(vc, vstride)
    f3 = lambda o: vrec[:, o:o + 12].copy().view('<f4').reshape(vc, 3).astype(np.float64)
    pos, nrm, tan, bit = f3(0), f3(12), f3(40), f3(52)
    nodes = {}
    for nd in anm['nodes']:
        if nd['keys'] is not None and len(nd['keys']):
            nodes.setdefault(nd['name'].strip().upper(), nd)
    D = np.repeat(np.eye(4)[None], len(info['bones']), 0)
    for b in info['bones']:
        nd = nodes.get(b['name'].strip().upper())
        if nd is None:
            continue
        k = nd['keys'][min(frame, len(nd['keys']) - 1)]
        B = np.asarray(b['bind'], np.float64).reshape(4, 4)
        D[b['index']] = np.linalg.inv(B) @ _key_matrix(k) @ B
    skin = info['skin']
    bi, w = np.asarray(skin.bone), np.asarray(skin.weight)
    M = np.einsum('vk,vkij->vij', w, D[bi])                  # blended matrix per vertex
    p4 = np.concatenate([pos, np.ones((vc, 1))], 1)
    pos2 = np.einsum('vi,vij->vj', p4, M)[:, :3]
    R = M[:, :3, :3]
    rot = lambda v: np.einsum('vi,vij->vj', v, R)
    return pos2, rot(nrm), rot(tan), rot(bit)


def anm_default_frame(anm_path, anm):
    """Steering ANMs (frame = steering angle): middle frame = straight ahead."""
    n = max((len(nd['keys']) for nd in anm['nodes'] if nd['keys'] is not None), default=1)
    name = (os.path.basename(anm_path) + ' ' + (anm.get('title') or '')).lower()
    return (n // 2 if 'steer' in name else 0), n


def build_mesh(path, anm_resolver=None, frame=None):
    with open(path, 'rb') as f:
        data = f.read()
    best, info = G.parse_gmt(path, want_skeleton=True)
    anim_meta = None
    if info.get('bones') and info.get('skin') is not None and best.get('vstart') is not None and anm_resolver:
        anm_path = anm_resolver([b['name'] for b in info['bones']])
        if anm_path:
            try:
                anm = G.parse_anm(anm_path)
                f0, nframes = anm_default_frame(anm_path, anm)
                fr = f0 if frame is None else max(0, min(int(frame), nframes - 1))
                gp, gn, gt, gb = pose_skin(data, best, info, anm, fr)
                best = dict(best)
                best['vertices'] = gp[:, [0, 2, 1]]
                best['normals'] = gn[:, [0, 2, 1]]
                best['_posed_tb'] = (gt, gb)
                anim_meta = {'file': os.path.basename(anm_path), 'path': anm_path, 'frame': fr, 'frames': nframes,
                             'default': f0, 'fps': anm['fps'], 'bones': len(info['bones'])}
            except (OSError, ValueError, struct.error, IndexError) as e:
                anim_meta = {'error': str(e)}
        else:
            anim_meta = {'file': None, 'bones': len(info['bones'])}
    V = _to_gl(best['vertices']) if len(best['vertices']) else np.zeros((0, 3))
    T = np.asarray(best['triangles'], np.int64).reshape(-1, 3) if len(best['triangles']) else np.zeros((0, 3), np.int64)
    vc = len(V)
    if vc == 0 or len(T) == 0:
        raise ValueError('keine Geometrie erkannt')
    pos = _to_gl([info['position']])[0] if info.get('position') else np.zeros(3)

    N = None
    if best.get('normals') is not None and len(best['normals']) == vc:
        N = _to_gl(best['normals'])
        ln = np.linalg.norm(N, axis=1)
        if (ln < 0.5).mean() > 0.2:
            N = None
        else:
            ln[ln == 0] = 1.0
            N = N / ln[:, None]
    if N is None:
        N = _smooth_normals(V, T)

    tan = np.zeros((vc, 3))
    bit = np.zeros((vc, 3))
    vstart, vstride = best.get('vstart'), best.get('vstride')
    if vstart is not None and vstride and vstride >= 64:
        vrec = np.frombuffer(data, np.uint8, count=vc * vstride, offset=vstart).reshape(vc, vstride)
        t = vrec[:, 40:52].copy().view('<f4').reshape(vc, 3).astype(np.float64)
        b = vrec[:, 52:64].copy().view('<f4').reshape(vc, 3).astype(np.float64)
        if best.get('_posed_tb') is not None:
            t, b = best['_posed_tb']
        if np.isfinite(t).all() and np.isfinite(b).all():
            tan = np.stack([t[:, 0], t[:, 1], -t[:, 2]], 1)
            bit = np.stack([b[:, 0], b[:, 1], -b[:, 2]], 1)
            if 'billboard' in best.get('name', ''):
                tan[:] = 0.0
                bit[:] = 0.0

    uv = np.zeros((vc, 4, 2))
    if best.get('uvs_all') is not None and len(best['uvs_all']) == vc:
        uv = np.asarray(best['uvs_all'], np.float64).copy()
    elif best.get('uvs') is not None and len(best['uvs']) == vc:
        uv[:, 0] = np.asarray(best['uvs'], np.float64)
        uv[:, 1:] = uv[:, :1]
    uv[:, :, 1] = -uv[:, :, 1]               # back to DirectX v (first row = top)
    uv[~np.isfinite(uv)] = 0.0

    col = np.full((vc, 4), 255, np.uint8)
    if best.get('colors') is not None and len(best['colors']) == vc:
        col = np.asarray(best['colors'], np.uint8)
    has_vcol = bool((col[:, :3] != 255).any() or (col[:, 3] != 255).any())

    # triangle -> material
    mats = info.get('materials_ex') or []
    if not mats and info.get('materials'):
        mats = [{'name': n, 'shader': s, 'stages': [{'tex': t, 'type': 0, 'index': k}
                                                    for k, t in enumerate(tx)]}
                for (n, s, _d, tx) in info['materials']]
    mi = np.asarray(best.get('mesh_indices') if best.get('mesh_indices') is not None else [], np.int64)
    if len(mi) != len(T):
        mi = np.zeros(len(T), np.int64)
    sub = info.get('submesh_materials')
    if len(mi) and sub and int(mi.max()) < len(sub) and mats and max(sub) < len(mats):
        mi = np.asarray(sub, np.int64)[mi]
    nm = max(1, len(mats))
    if len(mi) and int(mi.max()) >= nm:
        mi = np.clip(mi, 0, nm - 1) if len(mats) > 1 else np.zeros_like(mi)
    order = np.argsort(mi, kind='stable')
    T = T[order]
    mi = mi[order]
    groups = []
    if len(mi):
        bounds = np.flatnonzero(np.diff(mi)) + 1
        starts = np.concatenate([[0], bounds])
        ends = np.concatenate([bounds, [len(mi)]])
        for s, e in zip(starts, ends):
            groups.append({'material': int(mi[s]), 'start': int(s * 3), 'count': int((e - s) * 3)})

    lo = (V + pos).min(axis=0)
    hi = (V + pos).max(axis=0)
    materials = []
    for k, m in enumerate(mats or [{'name': 'GMT_Material', 'shader': '', 'stages': []}]):
        blend = _gmt_blend(m.get('raw'))
        materials.append({'index': k, 'name': m.get('name') or 'GMT_Material', 'shader': m.get('shader') or '',
                          'srcBlend': blend[0], 'dstBlend': blend[1], 'flags': _gmt_flags(m.get('raw')),
                          'std': _gmt_std(m.get('raw')),
                          'stages': [{'tex': s.get('tex', ''), 'type': s.get('type', 0), 'index': s.get('index', 0),
                                      'frames': s.get('frames', 1), 'rate': s.get('rate'), 'method': s.get('method'),
                                      'animRaw': s.get('anim_raw')}
                                     for s in m.get('stages', [])]})
    meta = {
        'name': info.get('name'), 'format': info.get('format_used'), 'vertexCount': vc, 'indexCount': int(len(T) * 3),
        'position': [float(x) for x in pos], 'bboxMin': [float(x) for x in lo], 'bboxMax': [float(x) for x in hi],
        'groups': groups, 'materials': materials, 'hasVertexColor': has_vcol,
        'hasTangents': bool(np.abs(tan).sum() > 0), 'fileSize': len(data), 'anim': anim_meta,
    }
    arrays = [V.astype('<f4'), N.astype('<f4'), tan.astype('<f4'), bit.astype('<f4'),
              uv.reshape(vc, 8).astype('<f4'), col.astype(np.uint8), T.astype('<u4').ravel()]
    return {'meta': meta, 'arrays': arrays}


def pack_mesh(res, part_id):
    meta = dict(res['meta'])
    meta['partId'] = part_id
    js = json.dumps(meta).encode('utf-8')
    pad = (4 - (8 + len(js)) % 4) % 4
    js += b' ' * pad
    chunks = [b'RF2M', struct.pack('<I', len(js)), js]
    for a in res['arrays']:
        b = np.ascontiguousarray(a).tobytes()
        chunks.append(b)
        if len(b) % 4:
            chunks.append(b'\0' * (4 - len(b) % 4))
    return b''.join(chunks)
