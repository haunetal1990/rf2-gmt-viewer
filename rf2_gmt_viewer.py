"""rF2 GMT Viewer - 3D viewer for rFactor 2 GMT files with live material JSON.

Start:  python rf2_gmt_viewer.py  [Ordner | .veh | .gen | .gmt]

Needs Python 3.9+ and numpy.  Optional: pillow (TGA textures, DDS fallback).
Own window on Windows: rf2core/wv2host.py (WebView2 via ctypes), otherwise an Edge/Chrome app window.
"""
import argparse
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy  # noqa: F401
except ImportError:
    print('numpy fehlt / numpy is missing:  pip install numpy')
    sys.exit(1)

from rf2core import server as S   # noqa: E402


def _de():
    """German console texts if the viewer language (or else the system language) is German."""
    lang = S.load_config().get('lang') if hasattr(S, 'load_config') else None
    return (lang or S.os_lang() or 'en').lower().startswith('de')


def _centered(w, h):
    """Window size and position in the middle of the primary screen (work area without the task bar)."""
    sw, sh, ox, oy = 1920, 1080, 0, 0
    try:
        if os.name == 'nt':
            import ctypes
            from ctypes import wintypes
            # not DPI aware on purpose: the work area comes in logical pixels, like Edge's --window-position
            r = wintypes.RECT()
            if ctypes.windll.user32.SystemParametersInfoW(0x30, 0, ctypes.byref(r), 0):   # SPI_GETWORKAREA
                sw, sh, ox, oy = r.right - r.left, r.bottom - r.top, r.left, r.top
    except Exception:                                    # noqa - fall back to 1920 x 1080
        pass
    w, h = min(w, int(sw * 0.92)), min(h, int(sh * 0.92))
    return w, h, ox + (sw - w) // 2, oy + (sh - h) // 2


def _start_own_window(url):
    """Own program window: rf2core/wv2host.py hosts the Windows WebView2 component with ctypes only (no pip package,
    no Edge window). Runs as its own process, so a missing runtime or a crash can never take the server down: if the
    window does not come up, the caller falls back to the Edge/Chrome app window."""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'rf2core', 'wv2host.py')
    exe = sys.executable
    pyw = os.path.join(os.path.dirname(exe), 'pythonw.exe')      # no extra console window
    if os.path.isfile(pyw):
        exe = pyw
    try:
        p = subprocess.Popen([exe, script, url, 'rF2 GMT Viewer'])
    except OSError:
        return None
    # the window registers itself at the server (POST /api/host/hello) as soon as WebView2 runs
    t0 = time.time()
    while time.time() - t0 < 20:
        if S.STATE.host_hwnd:
            return p
        if p.poll() is not None:
            print(('Eigenes Fenster nicht möglich (Code %s, Details: %%LOCALAPPDATA%%\\rf2_gmt_viewer\\host.log) - nutze Edge/Chrome.'
                   if _de() else 'Own window not possible (code %s, see %%LOCALAPPDATA%%\\rf2_gmt_viewer\\host.log) - using Edge/Chrome.') % p.returncode)
            return None
        time.sleep(0.1)
    return p                                    # slow start: keep it


def find_app_browser():
    """Edge / Chrome for an app window (no tabs, no address bar)."""
    cands = []
    if os.name == 'nt':
        for env in ('PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'):
            base = os.environ.get(env)
            if base:
                cands += [os.path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                          os.path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')]
    for n in ('msedge', 'microsoft-edge', 'google-chrome', 'chromium', 'chromium-browser', 'chrome'):
        w = shutil.which(n)
        if w:
            cands.append(w)
    return next((c for c in cands if c and os.path.isfile(c)), None)


def main():
    ap = argparse.ArgumentParser(description='rF2 GMT Viewer')
    ap.add_argument('path', nargs='?', help='Ordner, .veh, .gen oder .gmt')
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--browser', action='store_true', help='im normalen Browser-Tab öffnen')
    ap.add_argument('--no-window', action='store_true', help='nur den Server starten')
    ap.add_argument('--keep-running', action='store_true', help='Server nicht beenden, wenn das Fenster zu ist')
    ap.add_argument('--app', action='store_true', help='Edge/Chrome-App-Fenster statt eigenem Fenster')
    ap.add_argument('--verbose', action='store_true')
    a = ap.parse_args()

    srv, port = S.make_server(a.port)
    url = 'http://127.0.0.1:%d/' % port
    if a.path:
        url += '?open=' + __import__('urllib.parse').parse.quote(os.path.abspath(a.path))
    threading.Thread(target=S.STATE.watcher, daemon=True).start()
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    print(('rF2 GMT Viewer läuft auf %s  (Strg+C beendet)' if _de() else 'rF2 GMT Viewer running at %s  (Ctrl+C quits)') % url.split('?')[0])

    host = None
    if not a.no_window and not a.browser and not a.app and os.name == 'nt':
        host = _start_own_window(url)
    if host is not None:
        pass
    elif not a.no_window and not a.browser:
        exe = find_app_browser()
        if exe:
            prof = os.path.join(os.path.expanduser('~'), '.rf2_gmt_viewer_profile')
            w, h, x, y = _centered(1600, 950)
            subprocess.Popen([exe, '--app=' + url, '--window-size=%d,%d' % (w, h), '--window-position=%d,%d' % (x, y),
                              '--user-data-dir=' + prof,
                              '--no-first-run', '--disable-features=Translate'])
        else:
            webbrowser.open(url)
    elif a.browser:
        webbrowser.open(url)

    try:
        while True:
            time.sleep(0.5)
            st = S.STATE
            if host is not None and host.poll() is not None:     # own window closed
                print('Fenster geschlossen - beende.' if _de() else 'Window closed - exiting.')
                break
            if a.keep_running or a.no_window:
                continue
            with st.client_lock:
                n = len(st.clients)
            gone = time.time() - st.last_client
            # window closed: page said goodbye (or the event stream dropped) and
            # no new page came back within a few seconds (a reload reconnects at once)
            if st.had_client and n == 0 and (gone > 4 or (st.bye and time.time() - st.bye > 2)):
                print('Fenster geschlossen - beende.' if _de() else 'Window closed - exiting.')
                break
    except KeyboardInterrupt:
        pass
    srv.shutdown()
    os._exit(0)


if __name__ == '__main__':
    main()
