"""Local HTTP server: serves the viewer UI and the rF2 data (meshes, textures,
material JSON) and pushes file changes to the page (Server-Sent Events)."""
import io
import json
import os
import queue
import string
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from .scene import Project, pack_mesh, TEX_EXTS
from . import tgm as TGM
from . import allveh as AV
from . import clearance as CLR
from . import modcheck as MODCHECK


def os_lang():
    """UI language of the operating system ('de-DE', 'en-US' ...), '' if unknown."""
    try:
        if sys.platform == 'win32':
            import ctypes
            import locale
            lid = ctypes.windll.kernel32.GetUserDefaultUILanguage()
            return (locale.windows_locale.get(lid) or '').replace('_', '-')
        if sys.platform == 'darwin':
            import subprocess
            out = subprocess.run(['defaults', 'read', '-g', 'AppleLanguages'], capture_output=True, text=True, timeout=2).stdout
            for tok in out.replace('(', ' ').replace(')', ' ').replace(',', ' ').replace('"', ' ').split():
                return tok
        for k in ('LC_ALL', 'LC_MESSAGES', 'LANGUAGE', 'LANG'):
            v = os.environ.get(k)
            if v and v not in ('C', 'POSIX'):
                return v.split(':')[0].split('.')[0].replace('_', '-')
    except Exception:
        pass
    return ''
from . import cam as CAM
from . import mas as MAS

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web')
CONFIG = os.path.join(os.path.expanduser('~'), '.rf2_gmt_viewer.json')
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.ico': 'image/x-icon'}


def load_config():
    try:
        with open(CONFIG, 'r', encoding='utf-8') as f:
            c = json.load(f)
            return c if isinstance(c, dict) else {}
    except (OSError, ValueError):
        return {}


def save_config(c):
    try:
        with open(CONFIG, 'w', encoding='utf-8') as f:
            json.dump(c, f, indent=1)
    except OSError:
        pass


def dump_rf2_json(js):
    """rF2 style: 2 spaces, no space after the colon."""
    return json.dumps(js, indent=2, separators=(',', ':'), ensure_ascii=False) + '\n'


class State:
    def __init__(self):
        self.project = None
        self.lock = threading.Lock()
        self.clients = []
        self.client_lock = threading.Lock()
        self.watch = {}              # path -> (mtime, kind, extra)
        self.own_writes = {}         # path -> mtime written by us
        self.backed_up = set()
        self.config = load_config()
        self.last_client = time.time()
        self.had_client = False
        self.bye = 0.0
        self.host = 'browser'        # 'webview2' = own window (wv2host.py), 'browser'
        self.host_hwnd = None
        self.dirty = []              # unsaved changes reported by the page
        self.force_quit = False

    def broadcast(self, ev):
        data = ('data: %s\n\n' % json.dumps(ev)).encode('utf-8')
        with self.client_lock:
            for q in list(self.clients):
                q.put(data)

    def add_watch(self, path, kind, extra=None):
        try:
            self.watch[os.path.abspath(path)] = (os.path.getmtime(path), kind, extra)
        except OSError:
            pass

    def watcher(self):
        while True:
            time.sleep(0.6)
            for path, (mt, kind, extra) in list(self.watch.items()):
                try:
                    m = os.path.getmtime(path)
                except OSError:
                    continue
                if m == mt:
                    continue
                self.watch[path] = (m, kind, extra)
                if self.own_writes.get(path) == m:
                    continue
                if kind == 'json':
                    time.sleep(0.15)           # editor still writing
                    try:
                        with open(path, 'rb') as f:
                            js = json.loads(f.read().decode('utf-8', 'replace'))
                        self.broadcast({'type': 'json', 'path': path, 'json': js})
                    except (OSError, ValueError) as e:
                        self.broadcast({'type': 'warn', 'text': 'JSON fehlerhaft (%s): %s'
                                        % (os.path.basename(path), e)})
                elif kind == 'cockpit':
                    try:
                        disp, leds = CAM.parse_displays(path)
                        self.broadcast({'type': 'cockpit', 'path': path, 'values': CAM.parse_ini_values(path),
                                        'displays': disp, 'leds': leds})
                    except OSError:
                        pass
                elif kind == 'cam':
                    try:
                        self.broadcast({'type': 'cam', 'path': path, 'cams': CAM.parse_cam(path)})
                    except OSError:
                        pass
                elif kind == 'tex':
                    self.broadcast({'type': 'tex', 'path': path, 'name': extra})
                elif kind == 'tgm':
                    time.sleep(0.15)
                    try:
                        self.broadcast({'type': 'tgm', 'path': path, 'tgm': TGM.parse_tgm(path)})
                    except (OSError, ValueError) as e:
                        self.broadcast({'type': 'warn', 'text': 'TGM nicht lesbar (%s): %s' % (os.path.basename(path), e)})
                elif kind == 'gmt':
                    p = self.project
                    if p is not None and extra is not None and extra < len(p.parts):
                        p.mesh_cache.pop(extra, None)
                        self.broadcast({'type': 'gmt', 'partId': extra})


STATE = State()


def _post_host(msg, wp=0):
    """Message to the own viewer window (wv2host.py) - PostMessage works across processes."""
    if not STATE.host_hwnd or os.name != 'nt':
        return False
    try:
        import ctypes
        from ctypes import wintypes
        pm = ctypes.windll.user32.PostMessageW
        pm.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        pm.restype = wintypes.BOOL
        return bool(pm(STATE.host_hwnd, msg, wp, 0))
    except Exception:            # noqa
        return False


def _ensure(path):
    """Files inside a plain MAS are extracted to the cache on first use."""
    p = STATE.project
    if path and p is not None and p.is_mas_file(path):
        try:
            p.ensure(path)
        except Exception as e:          # noqa - encrypted entry etc.
            print('MAS:', e)


def list_drives():
    if os.name != 'nt':
        return ['/']
    if hasattr(os, 'listdrives'):
        try:
            return os.listdrives()
        except OSError:
            pass
    return ['%s:\\' % c for c in string.ascii_uppercase if os.path.exists('%s:\\' % c)]


class Handler(BaseHTTPRequestHandler):
    server_version = 'rF2GMTViewer/1.0'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        if '--verbose' in sys.argv:
            sys.stderr.write('%s\n' % (fmt % args))

    # -- responses ---------------------------------------------------------
    def send_bytes(self, data, ctype='application/octet-stream', code=200, headers=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, obj, code=200):
        self.send_bytes(json.dumps(obj).encode('utf-8'), 'application/json; charset=utf-8', code)

    def fail(self, msg, code=400):
        self.send_json({'error': msg}, code)

    def body_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n) if n else b'{}'
        return json.loads(raw.decode('utf-8'))

    # -- routing -------------------------------------------------------------
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == '/api/events':
                return self.events()
            if u.path == '/api/state':
                p = STATE.project
                return self.send_json({'project': p.summary() if p else None,
                                       'recent': STATE.config.get('recent', [])[:12],
                                       'home': os.path.expanduser('~'),
                                       'settings': STATE.config.get('settings', {}),
                                       'lang': STATE.config.get('lang'), 'osLang': os_lang(), 'host': STATE.host})
            if u.path == '/api/browse':
                return self.browse(q.get('path') or '')
            if u.path.startswith('/api/mesh/'):
                fr = q.get('frame')
                return self.mesh(int(u.path.rsplit('/', 1)[1]), int(fr) if fr not in (None, '') else None)
            if u.path == '/api/cockpit':
                path = q.get('path')
                if not path or not os.path.isfile(path):
                    return self.fail('cockpitinfo nicht gefunden', 404)
                STATE.add_watch(path, 'cockpit')
                disp, leds = CAM.parse_displays(path)
                return self.send_json({'path': path, 'values': CAM.parse_ini_values(path), 'displays': disp, 'leds': leds})
            if u.path == '/api/tex':
                return self.tex(q)
            if u.path == '/api/texpng':
                return self.texpng(q)
            if u.path == '/api/jsonlist':
                p = STATE.project
                return self.send_json({'items': p.all_material_jsons() if p else []})
            if u.path == '/api/json':
                return self.read_json(q.get('path'))
            if u.path == '/api/showrooms':
                p = STATE.project
                return self.send_json((p.showrooms() if p else None) or {'items': None})
            if u.path == '/api/gdb':
                return self.gdb(q.get('path') or '')
            if u.path == '/api/host/close':          # own window wants to close
                if STATE.dirty and not STATE.force_quit:
                    STATE.broadcast({'type': 'askquit', 'items': STATE.dirty})
                    return self.send_json({'ok': False})
                return self.send_json({'ok': True})
            if u.path == '/api/allveh':
                p = STATE.project
                if p is None:
                    return self.fail('kein Projekt offen', 400)
                want = q.get('path') or STATE.config.get('allVehicles')
                path = AV.find_file(p.path, want)
                veh = p.path if p.kind == 'veh' else None
                if not path:
                    return self.send_json({'path': None, 'found': False, 'veh': veh, 'candidates': AV.candidates(p.path),
                                           'values': AV.DEFAULTS})
                if q.get('path'):
                    STATE.config['allVehicles'] = path
                    save_config(STATE.config)
                res = AV.read(path, veh)
                res['veh'] = veh
                return self.send_json(res)
            if u.path == '/api/tgm/setup':
                p = STATE.project
                if p is None:
                    return self.fail('kein Projekt offen', 400)
                with STATE.lock:
                    setup = TGM.find_setup(p)
                    wh = TGM.wheels(p)
                return self.send_json({'setup': setup, 'wheels': wh})
            if u.path == '/api/modcheck':
                p = STATE.project
                if p is None:
                    return self.fail('kein Projekt offen', 400)
                with STATE.lock:
                    return self.send_json(MODCHECK.check(p))
            if u.path.startswith('/api/clear/'):
                p = STATE.project
                if p is None:
                    return self.fail('kein Projekt offen', 400)
                fl = lambda k, d=0.0: float(q.get(k) or d)        # noqa: E731
                opt = lambda k: float(q[k]) if q.get(k) not in (None, '') else None   # noqa: E731
                with STATE.lock:
                    if u.path == '/api/clear/info':
                        return self.send_json(CLR.info(p))
                    if u.path == '/api/clear/pose':
                        return self.send_json(CLR.pose(p, fl('steer'), fl('bf') / 1000, fl('br') / 1000, rack_mm=opt('rack'), lock_deg=opt('lock')))
                    if u.path == '/api/clear/sweep':
                        trv = {'F': (fl('fu', 40) / 1000, fl('fd', -40) / 1000), 'R': (fl('ru', 40) / 1000, fl('rd', -40) / 1000)}
                        return self.send_json(CLR.sweep(p, trv, rack_mm=opt('rack'), lock_deg=opt('lock')))
                    if u.path == '/api/clear/fit':
                        if q.get('what') == 'steer':
                            bumps = [float(x) / 1000 for x in (q.get('bumps') or '0').split(',') if x.strip()]
                            return self.send_json(CLR.fit_steer(p, fl('margin', 5), bumps))
                        return self.send_json(CLR.fit_bump(p, q.get('axle') or 'F', fl('margin', 5), rack_mm=opt('rack'), lock_deg=opt('lock')))
                return self.fail('unbekannt', 404)
            if u.path == '/api/tgm':
                path = q.get('path')
                if not path or not os.path.isfile(path):
                    return self.fail('TGM nicht gefunden: %s' % path, 404)
                STATE.add_watch(path, 'tgm')
                return self.send_json(TGM.parse_tgm(os.path.abspath(path)))
            if u.path == '/api/cam':
                path = q.get('path')
                if not path or not os.path.isfile(path):
                    return self.fail('CAM nicht gefunden', 404)
                STATE.add_watch(path, 'cam')
                return self.send_json({'path': path, 'cams': CAM.parse_cam(path)})
            return self.static(u.path)
        except Exception as e:          # noqa
            traceback.print_exc()
            try:
                self.fail('%s: %s' % (type(e).__name__, e), 500)
            except Exception:
                pass

    def do_POST(self):
        u = urlparse(self.path)
        try:
            if u.path == '/api/part/add':                  # drag & drop: raw file bytes, ?name=
                p = STATE.project
                if p is None:
                    return self.fail('kein Projekt offen', 400)
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                n = int(self.headers.get('Content-Length') or 0)
                data = self.rfile.read(n) if n else b''
                try:
                    res = p.add_dropped(q.get('name') or '', data, q.get('inst') or None)
                except ValueError as e:
                    return self.fail(str(e), 422)
                if res.get('part') and not res['part']['missing']:
                    STATE.add_watch(p.parts[res['part']['id']]['file'], 'gmt', res['part']['id'])
                return self.send_json(res)
            if u.path == '/api/screenshot':                # PNG bytes -> Pictures\rF2 GMT Viewer (no browser download)
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                n = int(self.headers.get('Content-Length') or 0)
                data = self.rfile.read(n) if n else b''
                if not data.startswith(b'\x89PNG'):
                    return self.fail('kein PNG', 400)
                pics = os.path.join(os.path.expanduser('~'), 'Pictures')
                folder = os.path.join(pics if os.path.isdir(pics) else os.path.expanduser('~'), 'rF2 GMT Viewer')
                os.makedirs(folder, exist_ok=True)
                name = ''.join(c if c.isalnum() or c in '._-' else '_' for c in (q.get('name') or 'rf2'))[:80]
                path = os.path.join(folder, '%s_%s.png' % (name, time.strftime('%Y-%m-%d_%H-%M-%S')))
                with open(path, 'wb') as f:
                    f.write(data)
                return self.send_json({'ok': True, 'path': path})
            body = self.body_json()
            if u.path == '/api/clear/save':                # edited full lock / travel limits -> HDV
                p = STATE.project
                if p is None:
                    return self.fail('kein Projekt offen', 400)
                with STATE.lock:
                    try:
                        return self.send_json(CLR.save_hdv(p, body))
                    except (ValueError, OSError) as e:
                        return self.fail(str(e), 400)
            if u.path == '/api/reveal':                    # show a file in the Explorer
                path = os.path.abspath(body.get('path') or '')
                if not os.path.exists(path):
                    return self.fail('nicht gefunden: %s' % path, 404)
                try:
                    if os.name == 'nt':
                        import subprocess
                        subprocess.Popen(['explorer', '/select,', path])
                    elif sys.platform == 'darwin':
                        import subprocess
                        subprocess.Popen(['open', '-R', path])
                    else:
                        import subprocess
                        subprocess.Popen(['xdg-open', os.path.dirname(path)])
                except OSError as e:
                    return self.fail(str(e), 500)
                return self.send_json({'ok': True})
            if u.path == '/api/gen/save':
                p = STATE.project
                if p is None:
                    return self.fail('kein Projekt offen', 400)
                try:
                    res = p.save_gen(body)
                except (ValueError, OSError) as e:
                    return self.fail(str(e), 422)
                STATE.own_writes[res['path']] = os.path.getmtime(res['path'])
                return self.send_json(res)
            if u.path == '/api/upgrades':
                p = STATE.project
                if p is None:
                    return self.fail('kein Projekt offen', 400)
                sel = {str(k): int(v) for k, v in (body.get('upgrades') or {}).items() if isinstance(v, (int, float))}
                gm = body.get('genMode') if body.get('genMode') in ('spinner', 'graphics') else None
                with STATE.lock:
                    diff = p.reconfigure(sel, gm)
                for pid in diff['added']:
                    q = p.parts[pid]
                    if not q['missing']:
                        STATE.add_watch(q['file'], 'gmt', pid)
                return self.send_json({'project': p.summary(), 'diff': diff})
            if u.path == '/api/open':
                return self.open_project(body.get('path', ''), body.get('upgrades'), body.get('genMode'))
            if u.path == '/api/json/save':
                return self.save_json(body)
            if u.path == '/api/addsource':
                p = STATE.project
                path = os.path.abspath(body.get('path') or '')
                if p is None or not os.path.exists(path):
                    return self.fail('nicht gefunden: %s' % path, 404)
                try:
                    added = p.add_source(path)
                except ValueError as e:
                    return self.fail(str(e), 422)
                if os.path.isfile(path) and not path.lower().endswith('.mas'):
                    STATE.add_watch(path, 'tex', os.path.basename(path))
                return self.send_json({'ok': True, 'path': path, 'added': len(added),
                                       'mas': [m for m in p.mas_loaded]})
            if u.path == '/api/showroom':
                p = STATE.project
                if p is None:
                    return self.fail('kein Projekt offen', 400)
                try:
                    res = p.load_showroom(body.get('mas') or '')
                except (ValueError, OSError, MAS.MasUnsupported) as e:
                    return self.fail(str(e), 422)
                return self.send_json(res)
            if u.path == '/api/bye':
                STATE.bye = time.time()
                return self.send_json({'ok': True})
            if u.path == '/api/cockpit/save':
                path = os.path.abspath(body.get('path') or '')
                if not os.path.isfile(path) or not path.lower().endswith('.ini'):
                    return self.fail('cockpitinfo nicht gefunden', 404)
                if path not in STATE.backed_up and not os.path.exists(path + '.bak'):
                    with open(path, 'rb') as f:
                        old = f.read()
                    with open(path + '.bak', 'wb') as f:
                        f.write(old)
                STATE.backed_up.add(path)
                CAM.save_ini_values(path, body.get('values') or {})
                m = os.path.getmtime(path)
                STATE.own_writes[path] = m
                STATE.watch[path] = (m, 'cockpit', None)
                disp, leds = CAM.parse_displays(path)
                return self.send_json({'ok': True, 'path': path, 'values': CAM.parse_ini_values(path),
                                       'displays': disp, 'leds': leds})
            if u.path == '/api/cam/save':
                path = os.path.abspath(body.get('path') or '')
                if not os.path.isfile(path) or not path.lower().endswith('.cam'):
                    return self.fail('CAM nicht gefunden', 404)
                if path not in STATE.backed_up and not os.path.exists(path + '.bak'):
                    with open(path, 'rb') as f:
                        old = f.read()
                    with open(path + '.bak', 'wb') as f:
                        f.write(old)
                STATE.backed_up.add(path)
                CAM.save_cam(path, body.get('edits') or {})
                m = os.path.getmtime(path)
                STATE.own_writes[path] = m
                STATE.watch[path] = (m, 'cam', None)
                return self.send_json({'ok': True, 'path': path, 'cams': CAM.parse_cam(path)})
            if u.path == '/api/dirty':
                STATE.dirty = [str(x) for x in (body.get('items') or [])][:30]
                return self.send_json({'ok': True})
            if u.path == '/api/host/hello':
                STATE.host_hwnd = int(body.get('hwnd') or 0) or None
                STATE.host = 'webview2'
                return self.send_json({'ok': True})
            if u.path == '/api/quit':                 # "Trotzdem beenden" in the page dialog
                STATE.force_quit = True
                _post_host(0x0010)                    # WM_CLOSE
                return self.send_json({'ok': True})
            if u.path == '/api/fullscreen':           # on: true / false = set, missing = toggle
                on = body.get('on')
                _post_host(0x8001, 0 if on is None else (1 if on else 2))   # WM_APP + 1
                return self.send_json({'ok': bool(STATE.host_hwnd)})
            if u.path == '/api/allveh/save':
                p = STATE.project
                path = os.path.abspath(body.get('path') or '')
                if p is None or p.kind != 'veh':
                    return self.fail('Nur mit einer geöffneten VEH möglich', 400)
                if not os.path.isfile(path) or not path.lower().endswith('.ini'):
                    return self.fail('all_vehicles.ini nicht gefunden', 404)
                if path not in STATE.backed_up and not os.path.exists(path + '.bak'):
                    with open(path, 'rb') as f:
                        old = f.read()
                    with open(path + '.bak', 'wb') as f:
                        f.write(old)
                STATE.backed_up.add(path)
                try:
                    res = AV.save(path, p.path, body.get('values') or {})
                except ValueError as e:
                    return self.fail(str(e), 422)
                res['veh'] = p.path
                return self.send_json(res)
            if u.path == '/api/tgm/save':
                path = os.path.abspath(body.get('path') or '')
                if not os.path.isfile(path) or not path.lower().endswith('.tgm'):
                    return self.fail('TGM nicht gefunden', 404)
                if path not in STATE.backed_up and not os.path.exists(path + '.bak'):
                    with open(path, 'rb') as f:
                        old = f.read()
                    with open(path + '.bak', 'wb') as f:
                        f.write(old)
                STATE.backed_up.add(path)
                try:
                    TGM.save_tgm(path, body.get('edits') or [])
                except ValueError as e:
                    return self.fail(str(e), 422)
                m = os.path.getmtime(path)
                STATE.own_writes[path] = m
                STATE.watch[path] = (m, 'tgm', None)
                return self.send_json({'ok': True, 'tgm': TGM.parse_tgm(path)})
            if u.path == '/api/lang':
                STATE.config['lang'] = body.get('lang') if body.get('lang') in ('de', 'en') else None
                save_config(STATE.config)
                return self.send_json({'ok': True})
            if u.path == '/api/settings':
                STATE.config['settings'] = body
                save_config(STATE.config)
                return self.send_json({'ok': True})
            if u.path == '/api/part/load':
                return self.load_part(int(body.get('id', -1)))
            return self.fail('unbekannt', 404)
        except Exception as e:          # noqa
            traceback.print_exc()
            self.fail('%s: %s' % (type(e).__name__, e), 500)

    # -- handlers --------------------------------------------------------------
    def static(self, path):
        if path in ('', '/'):
            path = '/index.html'
        full = os.path.normpath(os.path.join(WEB_DIR, unquote(path).lstrip('/')))
        if not full.startswith(WEB_DIR) or not os.path.isfile(full):
            return self.fail('nicht gefunden', 404)
        with open(full, 'rb') as f:
            data = f.read()
        self.send_bytes(data, MIME.get(os.path.splitext(full)[1].lower(), 'application/octet-stream'))

    def events(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        q = queue.Queue()
        with STATE.client_lock:
            STATE.clients.append(q)
            STATE.had_client = True
            STATE.bye = 0.0
        try:
            self.wfile.write(b': hi\n\n')
            self.wfile.flush()
            while True:
                try:
                    data = q.get(timeout=1.5)
                except queue.Empty:
                    data = b': ping\n\n'
                self.wfile.write(data)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            with STATE.client_lock:
                if q in STATE.clients:
                    STATE.clients.remove(q)
                STATE.last_client = time.time()

    def browse(self, path):
        if not path:
            path = STATE.config.get('lastDir') or os.path.expanduser('~')
        path = os.path.abspath(os.path.expanduser(path))
        if os.path.isfile(path):
            path = os.path.dirname(path)
        if not os.path.isdir(path):
            return self.fail('Ordner nicht gefunden: %s' % path, 404)
        dirs, files = [], []
        try:
            entries = sorted(os.scandir(path), key=lambda e: e.name.lower())
        except OSError as e:
            return self.fail(str(e), 403)
        for e in entries:
            try:
                if e.is_dir():
                    if not e.name.startswith('$'):
                        dirs.append({'name': e.name, 'path': e.path})
                else:
                    ext = os.path.splitext(e.name)[1].lower()
                    if ext in ('.veh', '.gen', '.scn', '.gmt', '.json', '.dds', '.tga', '.png', '.bmp', '.jpg', '.jpeg', '.mas', '.gdb'):
                        files.append({'name': e.name, 'path': e.path, 'ext': ext})
            except OSError:
                continue
        parent = os.path.dirname(path)
        self.send_json({'path': path, 'parent': parent if parent != path else None, 'dirs': dirs,
                        'files': files[:4000], 'drives': list_drives(), 'sep': os.sep})

    def gdb(self, path):
        """Track GDB (location / date / time zone for the sky): a .gdb file or all .gdb inside a MAS."""
        if not os.path.isfile(path):
            return self.fail('nicht gefunden: %s' % path, 404)
        out = []
        if path.lower().endswith('.mas'):
            try:
                for e in MAS.read_index(path):
                    if e['name'].lower().endswith('.gdb'):
                        out.append({'name': e['name'], 'text': MAS.extract(path, e).decode('latin-1')})
            except MAS.MasUnsupported as e:
                return self.fail('%s: %s' % (os.path.basename(path), e), 422)
        else:
            with open(path, 'rb') as f:
                out.append({'name': os.path.basename(path), 'text': f.read(2_000_000).decode('latin-1')})
        if not out:
            return self.fail('Keine GDB in %s' % os.path.basename(path), 404)
        self.send_json({'path': path, 'items': out})

    def open_project(self, path, upgrades=None, gen_mode=None):
        path = (path or '').strip().strip('"')
        if not path or not os.path.exists(path):
            return self.fail('Pfad nicht gefunden: %s' % path, 404)
        t0 = time.time()
        reuse = None
        old = STATE.project
        if old is not None and upgrades is not None and os.path.normcase(old.path) == os.path.normcase(os.path.abspath(path)):
            # same vehicle, other upgrade levels: the GMTs already read stay valid
            reuse = {old.parts[pid]['file']: info for pid, info in old.mesh_cache.items() if not old.parts[pid].get('env')}
        sel = {str(k): int(v) for k, v in (upgrades or {}).items() if isinstance(v, (int, float))}
        proj = Project(path, upgrades=sel, gen_mode=gen_mode if gen_mode in ('spinner', 'graphics') else None, reuse=reuse)
        proj.preload()
        with STATE.lock:
            STATE.project = proj
            STATE.watch.clear()
        for p in proj.parts:
            if not p['missing']:
                STATE.add_watch(p['file'], 'gmt', p['id'])
            info = proj.mesh_cache.get(p['id'])
            if info:
                for m in info['meta']['materials']:
                    if m.get('json_path'):
                        STATE.add_watch(m['json_path'], 'json')
        rec = [r for r in STATE.config.get('recent', []) if os.path.normcase(r) != os.path.normcase(path)]
        STATE.config['recent'] = [path] + rec[:15]
        STATE.config['lastDir'] = path if os.path.isdir(path) else os.path.dirname(path)
        save_config(STATE.config)
        s = proj.summary()
        s['loadSeconds'] = round(time.time() - t0, 2)
        self.send_json({'project': s})

    def load_part(self, pid):
        p = STATE.project
        if p is None or not (0 <= pid < len(p.parts)):
            return self.fail('kein Teil', 404)
        info = p._safe_info(pid)
        if info:
            for m in info['meta']['materials']:
                if m.get('json_path'):
                    STATE.add_watch(m['json_path'], 'json')
        self.send_json({'ok': info is not None, 'error': p.parts[pid].get('error')})

    def mesh(self, pid, frame=None):
        p = STATE.project
        if p is None or not (0 <= pid < len(p.parts)):
            return self.fail('kein Projekt', 404)
        info = p.part_info(pid, frame)
        if info is None:
            return self.fail('GMT fehlt: %s' % p.parts[pid]['file'], 404)
        for m in info['meta']['materials']:
            if m.get('json_path') and os.path.abspath(m['json_path']) not in STATE.watch:
                STATE.add_watch(m['json_path'], 'json')
        self.send_bytes(pack_mesh(info, pid))

    def tex(self, q):
        p = STATE.project
        path = q.get('path')
        if not path and p is not None:
            path = p.find_texture(q.get('name', ''))
        _ensure(path)
        if not path or not os.path.isfile(path):
            return self.fail('Textur nicht gefunden: %s' % q.get('name'), 404)
        ext = os.path.splitext(path)[1].lower()
        STATE.add_watch(path, 'tex', q.get('name'))
        hdr = {'X-Tex-Path': json.dumps(path), 'X-Tex-Kind': 'dds' if ext == '.dds' else 'img'}
        if ext == '.tga':
            return self.texpng({'path': path}, hdr)
        with open(path, 'rb') as f:
            data = f.read()
        self.send_bytes(data, MIME.get(ext, 'application/octet-stream'), headers=hdr)

    def texpng(self, q, hdr=None):
        path = q.get('path')
        if not path and q.get('name') and STATE.project is not None:
            path = STATE.project.find_texture(q.get('name'))
        _ensure(path)
        if not path or not os.path.isfile(path):
            return self.fail('Textur nicht gefunden', 404)
        mx = int(q.get('max') or 4096)
        h = dict(hdr or {})
        h.setdefault('X-Tex-Path', json.dumps(path))
        h['X-Tex-Kind'] = 'img'
        if path.lower().endswith('.dds'):
            # own BCn decoder (BC1-5, BC7) - works without Pillow, same result as Pillow
            try:
                from . import dds_decode
                r = dds_decode.decode_dds(path, mx)
            except Exception:
                r = None
            if r is not None:
                return self.send_bytes(dds_decode.png_bytes(r[2]), 'image/png', headers=h)
        try:
            from PIL import Image
        except ImportError:
            return self.fail('Pillow fehlt (pip install pillow) - wird für TGA und DDS-Formate gebraucht, '
                             'die die Grafikkarte im Browser nicht direkt kann.', 501)
        try:
            im = Image.open(path)
            im.load()
        except (NotImplementedError, OSError, ValueError) as e:
            return self.fail('%s: Format nicht unterstützt (%s)' % (os.path.basename(path), e), 415)
        if max(im.size) > mx:
            im.thumbnail((mx, mx))
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA')
        buf = io.BytesIO()
        im.save(buf, 'PNG', compress_level=1)
        self.send_bytes(buf.getvalue(), 'image/png', headers=h)

    def read_json(self, path):
        _ensure(path)
        if not path or not os.path.isfile(path):
            return self.fail('JSON nicht gefunden', 404)
        with open(path, 'rb') as f:
            js = json.loads(f.read().decode('utf-8', 'replace'))
        STATE.add_watch(path, 'json')
        self.send_json({'path': path, 'json': js})

    def save_json(self, body):
        js = body.get('json')
        path = body.get('path')
        if not isinstance(js, dict):
            return self.fail('kein JSON-Objekt')
        if not path:
            base = body.get('nextTo')
            name = (body.get('materialName') or js.get('name') or 'material').strip()
            if not base:
                return self.fail('Kein Zielordner')
            d = base if os.path.isdir(base) else os.path.dirname(base)
            path = os.path.join(d, name + '.json')
            if os.path.exists(path) and not body.get('overwrite'):
                return self.fail('Existiert bereits: %s' % path, 409)
        path = os.path.abspath(path)
        if os.path.isfile(path) and path not in STATE.backed_up and not os.path.exists(path + '.bak'):
            try:
                with open(path, 'rb') as f:
                    old = f.read()
                with open(path + '.bak', 'wb') as f:
                    f.write(old)
            except OSError:
                pass
        STATE.backed_up.add(path)
        text = dump_rf2_json(js)
        with open(path, 'w', encoding='utf-8', newline='\r\n' if os.name == 'nt' else '\n') as f:
            f.write(text)
        m = os.path.getmtime(path)
        STATE.own_writes[path] = m
        STATE.watch[path] = (m, 'json', None)
        p = STATE.project
        if p is not None:
            stem = os.path.splitext(os.path.basename(path))[0].lower()
            p.json_by_stem.setdefault(stem, path)
            if p._json_names is not None and isinstance(js.get('name'), str):
                p._json_names.setdefault(js['name'].lower(), path)
            for info in p.mesh_cache.values():
                for mm in info['meta']['materials']:
                    if mm.get('json_path') and os.path.abspath(mm['json_path']) == path:
                        mm['json'] = js
                    elif not mm.get('json_path') and mm['name'].lower() == (js.get('name') or '').lower():
                        mm['json_path'] = path
                        mm['json'] = js
        self.send_json({'ok': True, 'path': path})


def make_server(port):
    last = None
    for p in range(port, port + 20):
        try:
            srv = ThreadingHTTPServer(('127.0.0.1', p), Handler)
            srv.daemon_threads = True
            return srv, p
        except OSError as e:
            last = e
    raise last
