"""BCn DDS decoder (numpy) - fallback when the browser GPU cannot take a format (e.g. BC7 without
EXT_texture_compression_bptc) and Pillow is missing or fails. Taken from the Blender importer (Import.py).
"""
import struct
import zlib

_DXGI_FORMATS = {
    71: 'BC1', 72: 'BC1', 74: 'BC2', 75: 'BC2', 77: 'BC3', 78: 'BC3',
    80: 'BC4', 81: 'BC4', 83: 'BC5', 84: 'BC5', 98: 'BC7', 99: 'BC7',
    95: 'BC6H', 96: 'BC6H',
}
_FOURCC_FORMATS = {
    b'DXT1': 'BC1', b'DXT2': 'BC2', b'DXT3': 'BC2', b'DXT4': 'BC3', b'DXT5': 'BC3',
    b'ATI1': 'BC4', b'BC4U': 'BC4', b'BC4S': 'BC4', b'ATI2': 'BC5', b'BC5U': 'BC5',
    b'BC5S': 'BC5',
}
_BLOCK_BYTES = {'BC1': 8, 'BC4': 8, 'BC2': 16, 'BC3': 16, 'BC5': 16, 'BC7': 16, 'BC6H': 16}
# uncompressed formats Pillow cannot open (e.g. D3DFMT 36 = A16B16G16R16): name -> (bytes/pixel, numpy type, channels, float?)
_RAW = {
    'RGBA16': (8, '<u2', 4, False), 'RGBA16F': (8, '<f2', 4, True), 'RGBA32F': (16, '<f4', 4, True),
    'RG16': (4, '<u2', 2, False), 'RG16F': (4, '<f2', 2, True), 'RG32F': (8, '<f4', 2, True),
    'R16F': (2, '<f2', 1, True), 'R32F': (4, '<f4', 1, True), 'R16': (2, '<u2', 1, False),
    'RGBA8': (4, 'u1', 4, False), 'BGRA8': (4, 'u1', 4, False), 'BGRX8': (4, 'u1', 4, False), 'RGB10A2': (4, '<u4', 4, False),
}
_D3DFMT = {36: 'RGBA16', 113: 'RGBA16F', 116: 'RGBA32F', 34: 'RG16', 112: 'RG16F', 115: 'RG32F', 111: 'R16F',
           114: 'R32F', 81: 'R16'}
_DXGI_RAW = {2: 'RGBA32F', 10: 'RGBA16F', 11: 'RGBA16', 16: 'RG32F', 34: 'RG16F', 35: 'RG16', 41: 'R32F', 54: 'R16F',
             56: 'R16', 24: 'RGB10A2', 28: 'RGBA8', 29: 'RGBA8', 87: 'BGRA8', 91: 'BGRA8', 88: 'BGRX8', 93: 'BGRX8'}


def dds_info(path):
    """(format, width, height, mip count, data offset) or None."""
    with open(path, 'rb') as f:
        head = f.read(148)
    if len(head) < 128 or head[:4] != b'DDS ':
        return None
    height, width = struct.unpack_from('<2I', head, 12)
    mips = max(1, struct.unpack_from('<I', head, 28)[0])
    fourcc = head[84:88]
    if fourcc == b'DX10':
        if len(head) < 148:
            return None
        dx = struct.unpack_from('<I', head, 128)[0]
        fmt = _DXGI_FORMATS.get(dx) or _DXGI_RAW.get(dx)
        offset = 148
    else:
        fmt = _FOURCC_FORMATS.get(fourcc) or _D3DFMT.get(struct.unpack_from('<I', head, 84)[0])
        offset = 128
    return fmt, width, height, mips, offset


# BC7 tables (DirectX / BPTC specification)
_BC7_P2 = (
    0xCCCC, 0x8888, 0xEEEE, 0xECC8, 0xC880, 0xFEEC, 0xFEC8, 0xEC80, 0xC800, 0xFFEC, 0xFE80,
    0xE800, 0xFFE8, 0xFF00, 0xFFF0, 0xF000, 0xF710, 0x008E, 0x7100, 0x08CE, 0x008C, 0x7310,
    0x3100, 0x8CCE, 0x088C, 0x3110, 0x6666, 0x366C, 0x17E8, 0x0FF0, 0x718E, 0x399C, 0xAAAA,
    0xF0F0, 0x5A5A, 0x33CC, 0x3C3C, 0x55AA, 0x9696, 0xA55A, 0x73CE, 0x13C8, 0x324C, 0x3BDC,
    0x6996, 0xC33C, 0x9966, 0x0660, 0x0272, 0x04E4, 0x4E40, 0x2720, 0xC936, 0x936C, 0x39C6,
    0x639C, 0x9336, 0x9CC6, 0x817E, 0xE718, 0xCCF0, 0x0FCC, 0x7744, 0xEE22)
_BC7_P3 = (
    0xAA685050, 0x6A5A5040, 0x5A5A4200, 0x5450A0A8, 0xA5A50000, 0xA0A05050, 0x5555A0A0,
    0x5A5A5050, 0xAA550000, 0xAA555500, 0xAAAA5500, 0x90909090, 0x94949494, 0xA4A4A4A4,
    0xA9A59450, 0x2A0A4250, 0xA5945040, 0x0A425054, 0xA5A5A500, 0x55A0A0A0, 0xA8A85454,
    0x6A6A4040, 0xA4A45000, 0x1A1A0500, 0x0050A4A4, 0xAAA59090, 0x14696914, 0x69691400,
    0xA08585A0, 0xAA821414, 0x50A4A450, 0x6A5A0200, 0xA9A58000, 0x5090A0A8, 0xA8A09050,
    0x24242424, 0x00AA5500, 0x24924924, 0x24499224, 0x50A50A50, 0x500AA550, 0xAAAA4444,
    0x66660000, 0xA5A0A5A0, 0x50A050A0, 0x69286928, 0x44AAAA44, 0x66666600, 0xAA444444,
    0x54A854A8, 0x95809580, 0x96969600, 0xA85454A8, 0x80959580, 0xAA141414, 0x96960000,
    0xAAAA1414, 0xA05050A0, 0xA0A5A5A0, 0x96000000, 0x40804080, 0xA9A8A9A8, 0xAAAAAA44,
    0x2A4A5254)
_BC7_A2 = (
    15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15,
    2, 8, 2, 2, 8, 8, 2, 2, 15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8,
    15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15)
_BC7_A3 = (
    (3, 15), (3, 8), (15, 8), (15, 3), (8, 15), (3, 15), (15, 3), (15, 8), (8, 15), (8, 15),
    (6, 15), (6, 15), (6, 15), (5, 15), (3, 15), (3, 8), (3, 15), (3, 8), (8, 15), (15, 3),
    (3, 15), (3, 8), (6, 15), (10, 8), (5, 3), (8, 15), (8, 6), (6, 10), (8, 15), (5, 15),
    (15, 10), (15, 8), (8, 15), (15, 3), (3, 15), (5, 10), (6, 10), (10, 8), (8, 9), (15, 10),
    (15, 6), (3, 15), (15, 8), (5, 15), (15, 3), (15, 6), (15, 6), (15, 8), (3, 15), (15, 3),
    (5, 15), (5, 15), (5, 15), (8, 15), (5, 15), (10, 15), (5, 15), (10, 15), (8, 15), (13, 15),
    (15, 3), (12, 15), (3, 15), (3, 8))
_BC7_W = {
    2: (0, 21, 43, 64),
    3: (0, 9, 18, 27, 37, 46, 55, 64),
    4: (0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64),
}
# mode: subsets, partition bits, rotation bits, index-sel bits, colour bits, alpha bits,
#       endpoint p-bits, shared p-bits, index bits, secondary index bits
_BC7_MODES = (
    (3, 4, 0, 0, 4, 0, 1, 0, 3, 0),
    (2, 6, 0, 0, 6, 0, 0, 1, 3, 0),
    (3, 6, 0, 0, 5, 0, 0, 0, 2, 0),
    (2, 6, 0, 0, 7, 0, 1, 0, 2, 0),
    (1, 0, 2, 1, 5, 6, 0, 0, 2, 3),
    (1, 0, 2, 0, 7, 8, 0, 0, 2, 2),
    (1, 0, 0, 0, 7, 7, 1, 0, 4, 0),
    (2, 6, 0, 0, 5, 5, 1, 0, 2, 0),
)
_BC7_TABLES = {}


def _bc7_tables():
    if not _BC7_TABLES:
        import numpy as np
        p = np.zeros((4, 64, 16), np.int64)      # [subsets][partition][pixel] -> subset
        anchor = np.zeros((4, 64, 16), bool)
        for part in range(64):
            for i in range(16):
                p[2, part, i] = (_BC7_P2[part] >> i) & 1
                p[3, part, i] = (_BC7_P3[part] >> (2 * i)) & 3
            anchor[1, part, 0] = True
            anchor[2, part, 0] = True
            anchor[2, part, _BC7_A2[part]] = True
            anchor[3, part, 0] = True
            anchor[3, part, _BC7_A3[part][0]] = True
            anchor[3, part, _BC7_A3[part][1]] = True
        _BC7_TABLES['p'] = p
        _BC7_TABLES['anchor'] = anchor
    return _BC7_TABLES


def _bits_fixed(bits, pos, n):
    """Value of n bits starting at bit `pos` (same for all blocks)."""
    import numpy as np
    v = np.zeros(bits.shape[0], np.int64)
    for k in range(n):
        v |= bits[:, pos + k].astype(np.int64) << k
    return v


def _bits_var(bits, pos, n):
    """pos, n: per-block/per-pixel int arrays of shape (blocks, 16)."""
    import numpy as np
    rows = np.arange(bits.shape[0])[:, None]
    v = np.zeros(pos.shape, np.int64)
    for k in range(int(n.max()) if n.size else 0):
        take = k < n
        idx = np.where(take, pos + k, 0)
        v |= np.where(take, bits[rows, idx].astype(np.int64) << k, 0)
    return v


def _expand(v, n):
    v = v << (8 - n)
    return v | (v >> n)


def _decode_bc7(blocks):
    import numpy as np
    nb = blocks.shape[0]
    out = np.zeros((nb, 16, 4), np.uint8)
    bits = np.unpackbits(blocks, axis=1, bitorder='little')     # (nb, 128)
    first = blocks[:, 0]
    mode = np.full(nb, 8, np.int64)
    for m in range(7, -1, -1):
        mode[(first & ((1 << (m + 1)) - 1)) == (1 << m)] = m
    tabs = _bc7_tables()
    for m in range(8):
        sel = np.nonzero(mode == m)[0]
        if not sel.size:
            continue
        NS, PB, RB, ISB, CB, AB, EPB, SPB, IB, IB2 = _BC7_MODES[m]
        b = bits[sel]
        pos = m + 1
        part = _bits_fixed(b, pos, PB) if PB else np.zeros(len(sel), np.int64)
        pos += PB
        rot = _bits_fixed(b, pos, RB) if RB else np.zeros(len(sel), np.int64)
        pos += RB
        isb = _bits_fixed(b, pos, ISB) if ISB else np.zeros(len(sel), np.int64)
        pos += ISB
        ne = 2 * NS
        ep = np.zeros((len(sel), ne, 4), np.int64)
        for c in range(3):
            for e in range(ne):
                ep[:, e, c] = _bits_fixed(b, pos, CB)
                pos += CB
        if AB:
            for e in range(ne):
                ep[:, e, 3] = _bits_fixed(b, pos, AB)
                pos += AB
        cbits, abits = CB, AB
        if EPB:
            for e in range(ne):
                pb = _bits_fixed(b, pos, 1)
                pos += 1
                ep[:, e, :3] = (ep[:, e, :3] << 1) | pb[:, None]
                if AB:
                    ep[:, e, 3] = (ep[:, e, 3] << 1) | pb
            cbits += 1
            abits += 1 if AB else 0
        elif SPB:
            for s in range(NS):
                pb = _bits_fixed(b, pos, 1)
                pos += 1
                for e in (2 * s, 2 * s + 1):
                    ep[:, e, :3] = (ep[:, e, :3] << 1) | pb[:, None]
            cbits += 1
        ep[:, :, :3] = _expand(ep[:, :, :3], cbits)
        if AB:
            ep[:, :, 3] = _expand(ep[:, :, 3], abits)
        else:
            ep[:, :, 3] = 255

        subset = tabs['p'][NS, part] if NS > 1 else np.zeros((len(sel), 16), np.int64)
        anchor = tabs['anchor'][NS, part]                      # (n, 16)
        nbits = IB - anchor.astype(np.int64)
        offs = pos + np.cumsum(nbits, axis=1) - nbits
        idx1 = _bits_var(b, offs, nbits)
        pos2 = pos + 16 * IB - NS
        if IB2:
            nb2 = np.full((len(sel), 16), IB2, np.int64)
            nb2[:, 0] -= 1
            offs2 = pos2 + np.cumsum(nb2, axis=1) - nb2
            idx2 = _bits_var(b, offs2, nb2)

        rows = np.arange(len(sel))[:, None]
        e0 = ep[rows, 2 * subset]                              # (n, 16, 4)
        e1 = ep[rows, 2 * subset + 1]
        if IB2:
            w1 = np.array(_BC7_W[IB], np.int64)[idx1]
            w2 = np.array(_BC7_W[IB2], np.int64)[idx2]
            swap = (isb == 1)[:, None]
            wc = np.where(swap, w2, w1)
            wa = np.where(swap, w1, w2)
        else:
            wc = wa = np.array(_BC7_W[IB], np.int64)[idx1]
        col = ((64 - wc[..., None]) * e0[..., :3] + wc[..., None] * e1[..., :3] + 32) >> 6
        alp = ((64 - wa) * e0[..., 3] + wa * e1[..., 3] + 32) >> 6
        px = np.concatenate([col, alp[..., None]], axis=2)
        if RB:
            for r, ch in ((1, 0), (2, 1), (3, 2)):
                rs = rot == r
                if rs.any():
                    tmp = px[rs, :, ch].copy()
                    px[rs, :, ch] = px[rs, :, 3]
                    px[rs, :, 3] = tmp
        out[sel] = px.astype(np.uint8)
    return out


def _decode_bc1_color(blocks, four_color_only):
    import numpy as np
    c0 = blocks[:, 0].astype(np.int64) | (blocks[:, 1].astype(np.int64) << 8)
    c1 = blocks[:, 2].astype(np.int64) | (blocks[:, 3].astype(np.int64) << 8)

    def rgb(c):
        r = (c >> 11) & 31
        g = (c >> 5) & 63
        b = c & 31
        return np.stack([(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)], axis=1)
    p0, p1 = rgb(c0), rgb(c1)
    four = (c0 > c1)[:, None] | four_color_only
    p2 = np.where(four, (2 * p0 + p1) // 3, (p0 + p1) // 2)
    p3 = np.where(four, (p0 + 2 * p1) // 3, 0)
    pal = np.stack([p0, p1, p2, p3], axis=1)                   # (n, 4, 3)
    alpha = np.full((blocks.shape[0], 4), 255, np.int64)
    if not four_color_only:
        alpha[:, 3] = np.where(c0 > c1, 255, 0)
    idx = blocks[:, 4:8].astype(np.int64)
    idx = idx[:, 0] | (idx[:, 1] << 8) | (idx[:, 2] << 16) | (idx[:, 3] << 24)
    sh = np.arange(16) * 2
    sel = (idx[:, None] >> sh) & 3                             # (n, 16)
    rows = np.arange(blocks.shape[0])[:, None]
    return pal[rows, sel], alpha[rows, sel]


def _decode_alpha_block(blocks):
    import numpy as np
    a0 = blocks[:, 0].astype(np.int64)
    a1 = blocks[:, 1].astype(np.int64)
    i = np.arange(1, 7)
    eight = (a0 > a1)[:, None]
    p8 = ((7 - i) * a0[:, None] + i * a1[:, None]) // 7
    i5 = np.arange(1, 5)
    p6 = ((5 - i5) * a0[:, None] + i5 * a1[:, None]) // 5
    p6 = np.concatenate([p6, np.zeros((len(a0), 1), np.int64),
                         np.full((len(a0), 1), 255, np.int64)], axis=1)
    pal = np.concatenate([a0[:, None], a1[:, None], np.where(eight, p8, p6)], axis=1)
    bitsv = np.zeros(len(a0), np.int64)
    for k in range(6):
        bitsv |= blocks[:, 2 + k].astype(np.int64) << (8 * k)
    sel = (bitsv[:, None] >> (np.arange(16) * 3)) & 7
    rows = np.arange(len(a0))[:, None]
    return pal[rows, sel]


def decode_dds(path, max_size=1024):
    """Decodes a BCn DDS (mip level with longest side <= max_size; 0 = full
    size).  Returns (width, height, RGBA uint8 array (h, w, 4), top row first)
    or None if the format is not supported."""
    import numpy as np
    info = dds_info(path)
    if info is not None and info[0] in _RAW:
        return _decode_raw(path, info, max_size)
    if info is None or info[0] not in ('BC1', 'BC2', 'BC3', 'BC4', 'BC5', 'BC7'):
        return None
    fmt, w, h, mips, offset = info
    bsize = _BLOCK_BYTES[fmt]
    level = 0
    while max_size and level < mips - 1 and max(w, h) > max_size:
        offset += max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * bsize
        w, h = max(1, w // 2), max(1, h // 2)
        level += 1
    bw, bh = max(1, (w + 3) // 4), max(1, (h + 3) // 4)
    with open(path, 'rb') as f:
        f.seek(offset)
        raw = f.read(bw * bh * bsize)
    if len(raw) < bw * bh * bsize:
        return None
    blocks = np.frombuffer(raw, np.uint8).reshape(bw * bh, bsize)
    px = np.empty((bw * bh, 16, 4), np.uint8)
    if fmt == 'BC7':
        px[:] = _decode_bc7(blocks.copy())
    elif fmt == 'BC1':
        c, a = _decode_bc1_color(blocks, False)
        px[..., :3] = c
        px[..., 3] = a
    elif fmt == 'BC2':
        c, _a = _decode_bc1_color(blocks[:, 8:], True)
        px[..., :3] = c
        a4 = np.zeros((len(blocks), 16), np.int64)
        for k in range(8):
            byte = blocks[:, k].astype(np.int64)
            a4[:, 2 * k] = (byte & 15) * 17
            a4[:, 2 * k + 1] = (byte >> 4) * 17
        px[..., 3] = a4
    elif fmt == 'BC3':
        c, _a = _decode_bc1_color(blocks[:, 8:], True)
        px[..., :3] = c
        px[..., 3] = _decode_alpha_block(blocks[:, :8])
    elif fmt == 'BC4':
        r = _decode_alpha_block(blocks)
        px[..., 0] = r
        px[..., 1] = r
        px[..., 2] = r
        px[..., 3] = 255
    elif fmt == 'BC5':
        px[..., 0] = _decode_alpha_block(blocks[:, :8])
        px[..., 1] = _decode_alpha_block(blocks[:, 8:])
        px[..., 2] = 255
        px[..., 3] = 255
    img = px.reshape(bh, bw, 4, 4, 4).transpose(0, 2, 1, 3, 4).reshape(bh * 4, bw * 4, 4)
    return w, h, img[:h, :w]


def _decode_raw(path, info, max_size):
    """Uncompressed 8/16/32-bit integer and half/float DDS -> RGBA8 (float = linear HDR, shown clamped in sRGB)."""
    import numpy as np
    fmt, w, h, mips, offset = info
    bpp, dt, ch, flt = _RAW[fmt]
    level = 0
    while max_size and level < mips - 1 and max(w, h) > max_size:
        offset += w * h * bpp
        w, h = max(1, w // 2), max(1, h // 2)
        level += 1
    with open(path, 'rb') as f:
        f.seek(offset)
        raw = f.read(w * h * bpp)
    if len(raw) < w * h * bpp:
        return None
    if fmt == 'RGB10A2':
        v = np.frombuffer(raw, '<u4').reshape(h, w)
        a = np.stack([(v & 1023) / 1023.0, ((v >> 10) & 1023) / 1023.0, ((v >> 20) & 1023) / 1023.0, (v >> 30) / 3.0], -1)
    else:
        a = np.frombuffer(raw, dt).reshape(h, w, ch).astype(np.float64)
        if not flt:
            a = a / (255.0 if dt == 'u1' else 65535.0)
        if fmt in ('BGRA8', 'BGRX8'):
            a = a[..., [2, 1, 0, 3]]
            if fmt == 'BGRX8':
                a[..., 3] = 1.0
    out = np.ones((h, w, 4))
    out[..., :min(ch, 3) if fmt != 'RGB10A2' else 3] = a[..., :min(ch, 3) if fmt != 'RGB10A2' else 3]
    if ch == 1:
        out[..., 1] = out[..., 2] = out[..., 0]
    elif ch == 2:
        out[..., 2] = 0.0
    if ch == 4 or fmt == 'RGB10A2':
        out[..., 3] = a[..., 3]
    if flt:
        out[..., :3] = np.power(np.clip(np.nan_to_num(out[..., :3]), 0, 1), 1 / 2.2)
    return w, h, (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


def png_bytes(img):
    """RGBA uint8 array (h, w, 4) -> PNG file bytes (stdlib only)."""
    import numpy as np
    h, w = img.shape[:2]
    raw = np.zeros((h, w * 4 + 1), np.uint8)
    raw[:, 1:] = np.ascontiguousarray(img, np.uint8).reshape(h, w * 4)

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw.tobytes(), 1)) + chunk(b'IEND', b''))
