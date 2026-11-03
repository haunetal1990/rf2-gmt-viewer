"""Own program window for the viewer - Python standard library only (ctypes + winreg), no pip packages,
no Edge browser window.

Windows 10/11 ship the "Microsoft Edge WebView2 Runtime" as a system component (it is also what Office,
Teams, the Windows widgets ... use). This script creates a normal Win32 window and puts the WebView2 control
into it, the same way WebView2Loader.dll does it: the runtime's EmbeddedBrowserWebView.dll exports
CreateWebViewEnvironmentWithOptionsInternal(unknown=1, runtimeType=0 installed, userDataFolder, options, handler).
The few COM interfaces needed are called through their vtables:

  ICoreWebView2Environment  3 CreateCoreWebView2Controller(HWND, handler)
  ICoreWebView2Controller   4 put_IsVisible   6 put_Bounds   12 MoveFocus   23 NotifyParentWindowPositionChanged
                            24 Close         25 get_CoreWebView2
  ICoreWebView2             5 Navigate

Talking to the viewer goes through its local HTTP server (no host objects): the window registers its HWND
(POST /api/host/hello), asks on close whether something is unsaved (GET /api/host/close - the page then shows its
own dialog), and the server sends WM_CLOSE / WM_APP messages back (quit, full screen).

Run:  python wv2host.py <url> [title]      exit code 0 = closed normally, 2 = no WebView2 runtime, 3 = WebView2 error
"""
import ctypes
import json
import os
import sys
import urllib.request
import winreg
from ctypes import wintypes as W

LOG = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'rf2_gmt_viewer', 'host.log')


def log(*a):
    try:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, 'a', encoding='utf-8') as f:
            f.write(' '.join(str(x) for x in a) + '\n')
    except OSError:
        pass


user32 = ctypes.WinDLL('user32', use_last_error=True)
kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
gdi32 = ctypes.WinDLL('gdi32')
ole32 = ctypes.WinDLL('ole32')

LRESULT = ctypes.c_ssize_t
HRESULT = ctypes.c_long
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, W.HWND, W.UINT, W.WPARAM, W.LPARAM)

WM_DESTROY, WM_SIZE, WM_CLOSE, WM_SETFOCUS, WM_MOVE, WM_GETMINMAXINFO = 0x0002, 0x0005, 0x0010, 0x0007, 0x0003, 0x0024
WM_APP = 0x8000
WM_APP_FULLSCREEN = WM_APP + 1
WS_OVERLAPPEDWINDOW, WS_POPUP, WS_VISIBLE = 0x00CF0000, 0x80000000, 0x10000000
GWL_STYLE = -16
SWP_NOZORDER, SWP_FRAMECHANGED, SWP_NOOWNERZORDER = 0x0004, 0x0020, 0x0200
SW_SHOW = 5
CW_USEDEFAULT = -0x80000000


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [('cbSize', W.UINT), ('style', W.UINT), ('lpfnWndProc', WNDPROC), ('cbClsExtra', ctypes.c_int),
                ('cbWndExtra', ctypes.c_int), ('hInstance', W.HINSTANCE), ('hIcon', W.HICON), ('hCursor', W.HANDLE),
                ('hbrBackground', W.HBRUSH), ('lpszMenuName', W.LPCWSTR), ('lpszClassName', W.LPCWSTR), ('hIconSm', W.HICON)]


class MONITORINFO(ctypes.Structure):
    _fields_ = [('cbSize', W.DWORD), ('rcMonitor', W.RECT), ('rcWork', W.RECT), ('dwFlags', W.DWORD)]


def _sig(dll, name, res, *args):
    f = getattr(dll, name)
    f.restype = res
    f.argtypes = list(args)
    return f


_sig(user32, 'DefWindowProcW', LRESULT, W.HWND, W.UINT, W.WPARAM, W.LPARAM)
_sig(user32, 'RegisterClassExW', W.ATOM, ctypes.POINTER(WNDCLASSEXW))
_sig(user32, 'CreateWindowExW', W.HWND, W.DWORD, W.LPCWSTR, W.LPCWSTR, W.DWORD, ctypes.c_int, ctypes.c_int,
     ctypes.c_int, ctypes.c_int, W.HWND, W.HMENU, W.HINSTANCE, W.LPVOID)
_sig(user32, 'ShowWindow', W.BOOL, W.HWND, ctypes.c_int)
_sig(user32, 'UpdateWindow', W.BOOL, W.HWND)
_sig(user32, 'GetMessageW', W.BOOL, ctypes.POINTER(W.MSG), W.HWND, W.UINT, W.UINT)
_sig(user32, 'TranslateMessage', W.BOOL, ctypes.POINTER(W.MSG))
_sig(user32, 'DispatchMessageW', LRESULT, ctypes.POINTER(W.MSG))
_sig(user32, 'PostQuitMessage', None, ctypes.c_int)
_sig(user32, 'DestroyWindow', W.BOOL, W.HWND)
_sig(user32, 'GetClientRect', W.BOOL, W.HWND, ctypes.POINTER(W.RECT))
_sig(user32, 'GetWindowRect', W.BOOL, W.HWND, ctypes.POINTER(W.RECT))
_sig(user32, 'LoadCursorW', W.HANDLE, W.HINSTANCE, W.LPVOID)
_sig(user32, 'LoadIconW', W.HICON, W.HINSTANCE, W.LPVOID)
_sig(user32, 'LoadImageW', W.HANDLE, W.HINSTANCE, W.LPCWSTR, W.UINT, ctypes.c_int, ctypes.c_int, W.UINT)
_sig(user32, 'MessageBoxW', ctypes.c_int, W.HWND, W.LPCWSTR, W.LPCWSTR, W.UINT)
_sig(user32, 'GetWindowLongPtrW', ctypes.c_ssize_t, W.HWND, ctypes.c_int)
_sig(user32, 'SetWindowLongPtrW', ctypes.c_ssize_t, W.HWND, ctypes.c_int, ctypes.c_ssize_t)
_sig(user32, 'SetWindowPos', W.BOOL, W.HWND, W.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.UINT)
_sig(user32, 'MonitorFromWindow', W.HANDLE, W.HWND, W.DWORD)
_sig(user32, 'MonitorFromPoint', W.HANDLE, W.POINT, W.DWORD)
_sig(user32, 'GetMonitorInfoW', W.BOOL, W.HANDLE, ctypes.POINTER(MONITORINFO))
_sig(user32, 'SetForegroundWindow', W.BOOL, W.HWND)
_sig(kernel32, 'GetModuleHandleW', W.HMODULE, W.LPCWSTR)
_sig(gdi32, 'CreateSolidBrush', W.HBRUSH, W.COLORREF)
_sig(ole32, 'CoInitializeEx', HRESULT, W.LPVOID, W.DWORD)

# ----------------------------------------------------------------------------- tiny COM helpers
QIFN = ctypes.WINFUNCTYPE(HRESULT, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))
REFFN = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)
INVFN = ctypes.WINFUNCTYPE(HRESULT, ctypes.c_void_p, HRESULT, ctypes.c_void_p)


class _HVtbl(ctypes.Structure):
    _fields_ = [('QueryInterface', QIFN), ('AddRef', REFFN), ('Release', REFFN), ('Invoke', INVFN)]


class _HObj(ctypes.Structure):
    _fields_ = [('lpVtbl', ctypes.POINTER(_HVtbl))]


_keep = []                      # Python objects that native code points to - must stay alive


def make_handler(cb):
    """COM object with Invoke(HRESULT, IUnknown*) - the shape of every WebView2 'completed' handler."""
    def qi(this, riid, ppv):
        ppv[0] = this
        return 0

    def addref(this):
        return 1

    def release(this):
        return 1

    def invoke(this, hr, obj):
        try:
            cb(hr, obj)
        except Exception as e:     # noqa - never let an exception cross into native code
            log('handler error:', repr(e))
            fail(3)
        return 0
    vt = _HVtbl(QIFN(qi), REFFN(addref), REFFN(release), INVFN(invoke))
    obj = _HObj(ctypes.pointer(vt))
    _keep.extend([vt, obj])
    return ctypes.addressof(obj)


def vcall(p, idx, argtypes, *args):
    """Method idx of the COM interface pointer p."""
    obj = ctypes.cast(ctypes.c_void_p(p), ctypes.POINTER(ctypes.c_void_p))
    vt = ctypes.cast(ctypes.c_void_p(obj[0]), ctypes.POINTER(ctypes.c_void_p))
    fn = ctypes.WINFUNCTYPE(HRESULT, ctypes.c_void_p, *argtypes)(vt[idx])
    return fn(p, *args)


def addref(p):
    obj = ctypes.cast(ctypes.c_void_p(p), ctypes.POINTER(ctypes.c_void_p))
    vt = ctypes.cast(ctypes.c_void_p(obj[0]), ctypes.POINTER(ctypes.c_void_p))
    REFFN(vt[1])(p)


# ----------------------------------------------------------------------------- runtime location
CHANNELS = ('{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',      # WebView2 Runtime (stable, part of Windows)
            '{2CD8A007-E189-409D-A2C8-9AF4EF3C72AA}',      # beta
            '{0D50BFEC-CD6A-4F9A-964C-C7416E3ACB10}',      # dev
            '{65C35B14-6C1D-4122-AC46-7148CC9D6497}')      # canary
ARCH = {'AMD64': 'x64', 'x86': 'x86', 'ARM64': 'arm64'}.get(os.environ.get('PROCESSOR_ARCHITECTURE', 'AMD64'), 'x64')
if sys.maxsize <= 2 ** 32:
    ARCH = 'x86'


def _ver(s):
    try:
        return tuple(int(x) for x in s.split('.'))
    except ValueError:
        return ()


def find_runtime_dll():
    cands = []
    for ch in CHANNELS:
        for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                with winreg.OpenKey(root, r'Software\Microsoft\EdgeUpdate\ClientState\%s' % ch, 0,
                                    winreg.KEY_READ | winreg.KEY_WOW64_32KEY) as k:
                    folder = winreg.QueryValueEx(k, 'EBWebView')[0]
                    cands.append(os.path.join(folder, 'EBWebView', ARCH, 'EmbeddedBrowserWebView.dll'))
            except OSError:
                pass
    # registry value missing: newest version folder of the runtime
    for base in (os.environ.get('ProgramFiles(x86)'), os.environ.get('ProgramFiles'), os.environ.get('LOCALAPPDATA')):
        app = os.path.join(base or '', 'Microsoft', 'EdgeWebView', 'Application')
        if base and os.path.isdir(app):
            for v in sorted((d for d in os.listdir(app) if _ver(d)), key=_ver, reverse=True):
                cands.append(os.path.join(app, v, 'EBWebView', ARCH, 'EmbeddedBrowserWebView.dll'))
    for c in cands:
        if os.path.isfile(c):
            return c
    return None


# ----------------------------------------------------------------------------- the window
class Host:
    hwnd = None
    ctrl = None
    url = ''
    base = ''
    full = None                 # saved (style, rect) while full screen
    exit_code = 0


H = Host()


def fail(code):
    H.exit_code = code
    user32.PostQuitMessage(code)


def http(method, path, body=None, timeout=1.5):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(H.base + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8') or '{}')


def resize():
    if H.ctrl and H.hwnd:
        rc = W.RECT()
        user32.GetClientRect(H.hwnd, ctypes.byref(rc))
        vcall(H.ctrl, 6, [W.RECT], rc)                    # put_Bounds


def toggle_fullscreen(want=0):
    """want: 0 = toggle, 1 = full screen, 2 = window"""
    hwnd = H.hwnd
    if (want == 1 and H.full is not None) or (want == 2 and H.full is None):
        return
    if H.full is None:
        style = user32.GetWindowLongPtrW(hwnd, GWL_STYLE)
        rc = W.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rc))
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        user32.GetMonitorInfoW(user32.MonitorFromWindow(hwnd, 2), ctypes.byref(mi))
        H.full = (style, (rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top))
        user32.SetWindowLongPtrW(hwnd, GWL_STYLE, (style & ~WS_OVERLAPPEDWINDOW) | WS_POPUP | WS_VISIBLE)
        m = mi.rcMonitor
        user32.SetWindowPos(hwnd, None, m.left, m.top, m.right - m.left, m.bottom - m.top,
                            SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED)
    else:
        style, (x, y, w, h) = H.full
        H.full = None
        user32.SetWindowLongPtrW(hwnd, GWL_STYLE, style)
        user32.SetWindowPos(hwnd, None, x, y, w, h, SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED)
    resize()


@WNDPROC
def wndproc(hwnd, msg, wp, lp):
    try:
        if msg == WM_SIZE:
            resize()
            return 0
        if msg == WM_MOVE:
            if H.ctrl:
                vcall(H.ctrl, 23, [])                      # NotifyParentWindowPositionChanged
            return 0
        if msg == WM_SETFOCUS:
            if H.ctrl:
                vcall(H.ctrl, 12, [ctypes.c_int], 0)       # MoveFocus(PROGRAMMATIC)
            return 0
        if msg == WM_APP_FULLSCREEN:
            toggle_fullscreen(int(wp or 0))
            return 0
        if msg == WM_CLOSE:
            ok = True
            try:                                           # unsaved changes? the page asks with its own dialog
                ok = bool(http('GET', '/api/host/close').get('ok', True))
            except Exception as e:                         # noqa - server gone: just close
                log('close check:', repr(e))
            if ok:
                user32.DestroyWindow(hwnd)
            return 0
        if msg == WM_DESTROY:
            if H.ctrl:
                try:
                    vcall(H.ctrl, 24, [])                  # Close
                except Exception:                          # noqa
                    pass
            user32.PostQuitMessage(H.exit_code)
            return 0
    except Exception as e:                                 # noqa
        log('wndproc error:', repr(e))
    return user32.DefWindowProcW(hwnd, msg, wp, lp)


def on_controller(hr, ctrl):
    if hr != 0 or not ctrl:
        log('controller failed: 0x%08x' % (hr & 0xffffffff))
        return fail(3)
    addref(ctrl)
    H.ctrl = ctrl
    vcall(ctrl, 4, [W.BOOL], 1)                            # put_IsVisible(TRUE)
    resize()
    wv = ctypes.c_void_p()
    hr = vcall(ctrl, 25, [ctypes.POINTER(ctypes.c_void_p)], ctypes.byref(wv))   # get_CoreWebView2
    if hr != 0 or not wv.value:
        log('get_CoreWebView2 failed: 0x%08x' % (hr & 0xffffffff))
        return fail(3)
    hr = vcall(wv.value, 5, [W.LPCWSTR], H.url)            # Navigate
    if hr != 0:
        log('Navigate failed: 0x%08x' % (hr & 0xffffffff))
    vcall(ctrl, 12, [ctypes.c_int], 0)                     # MoveFocus
    try:
        http('POST', '/api/host/hello', {'hwnd': int(H.hwnd), 'pid': os.getpid()})
    except Exception as e:                                 # noqa
        log('hello:', repr(e))


def on_environment(hr, env):
    if hr != 0 or not env:
        log('environment failed: 0x%08x' % (hr & 0xffffffff))
        return fail(3)
    addref(env)
    _keep.append(env)
    hr = vcall(env, 3, [W.HWND, ctypes.c_void_p], H.hwnd, make_handler(on_controller))  # CreateCoreWebView2Controller
    if hr != 0:
        log('CreateCoreWebView2Controller: 0x%08x' % (hr & 0xffffffff))
        fail(3)


def centered(w, h):
    pt = W.POINT(0, 0)
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    user32.GetMonitorInfoW(user32.MonitorFromPoint(pt, 1), ctypes.byref(mi))   # primary monitor, work area
    r = mi.rcWork
    sw, sh = r.right - r.left, r.bottom - r.top
    w, h = min(w, int(sw * 0.92)), min(h, int(sh * 0.92))
    return r.left + (sw - w) // 2, r.top + (sh - h) // 2, w, h


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    H.url = sys.argv[1]
    title = sys.argv[2] if len(sys.argv) > 2 else 'rF2 GMT Viewer'
    H.base = H.url.split('?', 1)[0].rstrip('/')
    dll_path = find_runtime_dll()
    if not dll_path:
        log('no WebView2 runtime found')
        return 2
    try:                                                   # own taskbar entry with our icon, not grouped under Python
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID('rF2.GMTViewer')
    except (AttributeError, OSError):
        pass
    try:                                                   # sharp text on scaled screens (per monitor v2)
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except (AttributeError, OSError):
        pass
    ole32.CoInitializeEx(None, 2)                         # COINIT_APARTMENTTHREADED (WebView2 needs an STA)
    hinst = kernel32.GetModuleHandleW(None)
    wc = WNDCLASSEXW()
    wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
    wc.lpfnWndProc = wndproc
    wc.hInstance = hinst
    wc.hCursor = user32.LoadCursorW(None, ctypes.c_void_p(32512))      # IDC_ARROW
    # own icon (web/icon.ico, big + small size), Windows default icon as fallback
    ico = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web', 'icon.ico')
    big = small = None
    if os.path.isfile(ico):                                # IMAGE_ICON = 1, LR_LOADFROMFILE = 0x10
        big = user32.LoadImageW(None, ico, 1, user32.GetSystemMetrics(11), user32.GetSystemMetrics(12), 0x10)
        small = user32.LoadImageW(None, ico, 1, user32.GetSystemMetrics(49), user32.GetSystemMetrics(50), 0x10)
    wc.hIcon = big or user32.LoadIconW(None, ctypes.c_void_p(32512))
    wc.hIconSm = small or big or wc.hIcon
    wc.hbrBackground = gdi32.CreateSolidBrush(0x001A1714)             # #14171A
    wc.lpszClassName = 'rF2GmtViewerWindow'
    if not user32.RegisterClassExW(ctypes.byref(wc)):
        log('RegisterClassExW failed', ctypes.get_last_error())
        return 3
    x, y, w, h = centered(1600, 950)
    H.hwnd = user32.CreateWindowExW(0, wc.lpszClassName, title, WS_OVERLAPPEDWINDOW, x, y, w, h, None, None, hinst, None)
    if not H.hwnd:
        log('CreateWindowExW failed', ctypes.get_last_error())
        return 3
    user32.ShowWindow(H.hwnd, SW_SHOW)
    user32.UpdateWindow(H.hwnd)
    user32.SetForegroundWindow(H.hwnd)
    try:
        dll = ctypes.WinDLL(dll_path)
        create = dll.CreateWebViewEnvironmentWithOptionsInternal
    except (OSError, AttributeError) as e:
        log('runtime dll:', dll_path, repr(e))
        return 3
    create.restype = HRESULT
    create.argtypes = [W.BOOL, ctypes.c_int, W.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p]
    data_dir = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'rf2_gmt_viewer', 'WebView2')
    os.makedirs(data_dir, exist_ok=True)
    hr = create(1, 0, data_dir, None, make_handler(on_environment))
    if hr != 0:
        log('CreateWebViewEnvironmentWithOptionsInternal: 0x%08x' % (hr & 0xffffffff), dll_path)
        return 3
    log('runtime:', dll_path)
    msg = W.MSG()
    while True:
        r = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
        if r == 0 or r == -1:
            break
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))
    return H.exit_code


if __name__ == '__main__':
    sys.exit(main())
