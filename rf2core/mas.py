"""Reader for rFactor 2 MAS archives (GMOTOR_MAS_2.90).

Supported: the standard rF2 container (scrambled header and file table) with stored, zlib or
gMotor-LZ packed entries, including the built-in file key that Studio 397 uses for normal game
content (e.g. Vehicles\\cmaps.mas). The decoding follows the author's mas_tool.py; only the parts needed for reading are taken over.

NOT supported on purpose - no keys are contained here: DLC archives with the XTEA wrapper
(account / content key IDs) and Le Mans Ultimate archives. They are reported as "encrypted".
"""
import hashlib
import os
import struct
import zlib

try:
    import numpy as _np
except ImportError:          # pragma: no cover
    _np = None

MAGIC = 'GMOTOR_MAS_2.90'
M64 = (1 << 64) - 1
M32 = (1 << 32) - 1
_WRAP_MAGIC = bytes.fromhex("cefef7cbcaca281f")      # DLC / LMU wrapper -> not supported


class MasUnsupported(Exception):
    pass


HDR_K = bytes.fromhex("42f89520de5fc110d9c8aed00f0d70ab")
T_ACF0 = struct.unpack("<256I", bytes.fromhex(
    "b8000000a80000008b000000070000008a0000000e000000f20000001100000068000000fb000000bc000000db000000"
    "12000000d0000000b6000000b30000009f00000069000000550000005f000000c7000000ca00000061000000ad000000"
    "3c00000056000000c1000000df0000004600000013000000280000001c0000004b000000200000003b00000075000000"
    "ac000000e70000003e0000009a000000b10000008d000000e10000006e0000006f00000014000000c000000088000000"
    "97000000950000006b000000b0000000d7000000640000001700000030000000a4000000ce000000660000009e000000"
    "70000000030000001e000000ec000000e9000000de0000005a000000b200000090000000a2000000ba0000004a000000"
    "2a000000f80000006d000000e600000023000000590000007a000000ee000000f6000000da0000003a00000060000000"
    "b5000000fe000000060000002b000000ea000000d4000000e3000000720000006200000027000000a10000004c000000"
    "0b0000003d0000008f00000034000000eb000000150000001800000039000000c5000000220000005800000094000000"
    "f500000042000000a3000000c2000000250000008700000081000000480000009300000002000000d6000000c9000000"
    "710000007d00000035000000bd000000d3000000090000009d0000007f00000053000000cd000000ae00000021000000"
    "4e00000077000000e800000043000000d1000000b9000000ff00000033000000bb000000f70000008c000000b4000000"
    "bf000000d9000000ab0000004f0000004d000000e00000006a000000d5000000f3000000d8000000c600000008000000"
    "830000001d000000fa0000000500000041000000cb000000d2000000f9000000c3000000840000006500000040000000"
    "4900000054000000cc000000ef0000000f000000a6000000a9000000af0000005c000000910000001a00000036000000"
    "be000000010000002f000000160000001f000000a5000000fd00000045000000960000005200000079000000e5000000"
    "100000001b00000067000000630000002400000032000000800000009c0000002e00000047000000570000002d000000"
    "8e0000007e000000e400000078000000a000000099000000dc000000b7000000fc00000076000000f400000019000000"
    "3f000000aa0000005d00000004000000260000007c000000f0000000f100000037000000a7000000ed00000086000000"
    "dd00000098000000c40000008200000089000000310000005b000000740000000c000000920000000d0000006c000000"
    "38000000cf000000510000002c0000007b00000044000000500000000a0000009b0000005e0000000000000073000000"
    "2900000085000000c8000000e2000000"))
T_AAE0 = struct.unpack("<264H", bytes.fromhex(
    "362ac5701a1ba8d03633b8ce36c59fdc2a546f8ad918c23041debf3e9d6a9dfa314f7cf656d68222dcfa3d8ff7bac669"
    "130367930123e742a0af6aa5ffd3f1b87a6d34e7af389f7a6b1400c831ddda973b19f50f81e26585e0c23b79513fd2e2"
    "047e4c996d156504a6007a4da0099eb14f3f27a79c4a1ba4e04434e80e43fa9755c953693e9f3c6645d86215701bced7"
    "a725a0c6734f2d74056331494131db5840aacf80bcae35998f3e72fddcf8803ea57697b8195ffcf74a9f0bb31fdbb728"
    "a97011bdc206d2d82c9c31bd88a2baf1a28a15146fe582edaa6fafb64eb6df3c5d8d18a40e83ce477bc2ead4bb5e114e"
    "f743f14cbd8cd6a613b42f3460cf314eb7bf2e8e8ebc61e53e27f26c88b4af7096a1f7c31b4d95651bab7c07bb1e9277"
    "1efbab84a606fa97c0cee8bd296e721491c59c0028619ab5028eb82ec060fd7d1d4befa1d30a45a1f3c50f35e90b13b2"
    "1fcbd471a1446721a563045a6366ef32356c172d09500d53760dd3e8928214ec082cdeb1b412772fa953ad7541d22e97"
    "acf0cdd6c4e518a28d13c2d019ad88b922edff8cbd9802ee72bd09a422f84a6b120b0ebdc950763d44ea5d5946399483"
    "2737853273b45f29d638dda89975d4d89030195fbb13f271b56ffd6c57592807f97c4f51772f00c7d831ee29937abaaa"
    "8edbeea4dcfcb14847c1c5a66773d1d811dbd598a74524b71486f1b84a6b68d8000000ff000000000000ff0000000000"))
T_B0F0 = struct.unpack("<304H", bytes.fromhex(
    "d0cfdf3880e280c12d73f48c0561ccf5f34a76ab2837628f533f842df939741b265bb361828c83025eb8707d4eb20113"
    "827fa14ba03f4562304f3cf20d735ee9ca79d5e1d321f6ab1a9396bc37296931ad6fd2a80c53fd9cf08a9eea9e21ef92"
    "b34150ff1a6d5031633a7cfdea3b51b98242daf8fa95c320d1de005fb1c1cd10072797ea430916320f34b248f8b51b1e"
    "0793dbe8a4c956d6456000c4e14a7959d14f49c7cc6aed525fa906ce00cbe48e5ce68fc38c5d6e4bd898a8961565356a"
    "d95a2fc79c05e6adf72f38db6144fa9fd8d49af0701dd410ba65c9505079c30f0a25112d66f3fdcc928768aa9d4a5727"
    "93cc5c6527782d7d46176aa594e3a69600c4f30ce3000a9dcd395390bcfcc879ba4e7af5d0182be2de410143d1879fca"
    "e4e9a28714ab88fb29c14758a9c60b4aece2ffba8444527fdf081b15725b822d6b15a276c14f6e253a9c497153893567"
    "d8443bbf912a550ad281228c6a85aaffa669055586cd9c8ade4414eb307f455ed708da93fe7c629cb475d36aa5cf5be0"
    "6435ab70890217d8c40f15640f3da4e83d2f014bfabab0a05cc964faded26fc18522914afa1c3282e8f4021484e0fcd5"
    "62042cffc7e01e211846c149dd9188541ccb79589b5ad7e1d1215a2017238c92630d8d74f95b73072171cb1c81e4048d"
    "99ccd7b892a33756228fe5039b7af74fc7d0b6c14a0e66a5ad1608df9eb520c500ff000000000000ff00000000000000"
    "000000ff00000000000000000000ff000000ff0000000000000000002800000018000000080000002000000038000000"
    "10000000300000000000000000ff00000000000000ff000000000000ff000000"))
T_B350 = struct.unpack("<264H", bytes.fromhex(
    "5a69f24cd30155fad26863456185195b908c98d021f72e4f80c8a2e84d419b7fd89861474394805a02880a9c97b82d72"
    "71ad9d191f37d0e7cb76beee35bf329fb8915846a3032ebe5f367fc29f3aa6abb399149268bf2c27ee323f36f8bb06a5"
    "df087ea26f3050c1acf8dc06b34ea7d26b25f568b1119939faf540a143069d5adc18c2836e2ff6abcfb9cf19d9cf6b45"
    "645511d8a746cb187bbd588026a0eb84e278ce7034eb24e3720dca9993ca017c29c03bff32597ecbfcec0f57b4f87c67"
    "3302fa612a9c0cf05eb9f30ddf78643a38d6db13149bae48885db143b4f1d0a29523821a4b18a48e4c6a3276829215fe"
    "e2940c9bfd13b13e5eb33279c2b0bf986b145ff97ca440b85cd9e9c7802b314df04a2c90ebe0d6503fe9751bceffc1e6"
    "533621459cf9ede6330a8892db1b6a6af0432c000957dcf0d286d036ef35e3b4ffac545f0ae367d5130714e777da8958"
    "4671cd7cc0c0da98c9bf2538d038f71c31487bdd948aae28d2a88f92b4f79568afd920c8f6ae78d0330fb30d2d7018ab"
    "87b3356a105b40a92e2c5c800f3be44d56997faf035c9b78b1db3f5f92167fcd574f47977c07651a91ba1be831b8a6ac"
    "d14d10563539ec9981c4593a9b7d2ed7ceb046a00f937a05da9370ce7a9943008059e6b401ac0fc187b265f3d48459b9"
    "569fed3b172893ca05963b8031705c29ddf896baba9bd14eccb00e7307b2c1e0ff0000000000000000ff000000000000"))
T_B560 = struct.unpack("<304H", bytes.fromhex(
    "710dbc03d8d8ef44e8d450495eb4a589bd1bb2975129c5f4621b950b648d9b8bcfc288dbdac88f5374db3b147dcd863c"
    "1edcca9608aa51deffba8366b0a5de917d220b2503ec48b8a7d52eba6829a740e5a2e9f4f0544701dc1863fc97bacbd0"
    "62ea5159650014744b8760f3eb24cc6b8762eb3b137b92054ae11ec495ca50bf25f71728395e095c3acf545948d55bc5"
    "efa4114bd0c9856d16fb82426f318a62eaff20be43099c61ec5278b5727bf0d5271849a3f61c428f79c2e8248a529fea"
    "bdea228647231cfa4cf299cbd6ae7ebd4fc4609506c864ec84e9fef317b40f2319ce0f233d4f630468daceb4b477c890"
    "2fc720cfc569ab7648873f89f7df084f712da8dbceb487621ebea7b18262d588b8dc6595b2ce0d7d4fb1bcbeb99ebb01"
    "a5636f2a1964a8792418a95753496d450183633ab14d1a24395954b9ee948d7c201862f34fc1ab1cc2afb45ea0c9aa06"
    "330f3beada96896257264c0e40c0d678890d5169eb1108dc2a0ef72bfd1f42b1d4f712db3c89948d808df3a305bcd848"
    "ceb4c200e286bd7e2db716a4893bf41c0c4589540de3b959efd23ee9a389b217bf395b1d03900a230de5956cedf20a91"
    "ae28a5f6eb3d8722ce274957c310a979b408121231f6339a9f3d8b1ab2dedf3cdcf06925641baea9cf30e2242565d7dc"
    "20117924b286b844be98d36f325fab80edf43a664a6ce93be30468d5c0c2e2b400000000000000ff0302010000000000"
    "d0cfdf3880e280c12d73f48c0561ccf5f34a76ab2837628f533f842df939741b265bb361828c83025eb8707d4eb20113"
    "827fa14ba03f4562304f3cf20d735ee9ca79d5e1d321f6ab1a9396bc37296931"))


def _hdr(b16):
    return bytes(((HDR_K[i] >> 1) ^ b16[i]) & 0xFF for i in range(16))


def _dir_cipher(buf, S):
    out = bytearray(buf)
    for i in range(len(out)):
        cl = i & 0x3F
        v = ((((T_ACF0[(i + (i >> 8)) & 0xFF] << cl) & S) | i) & M64) >> cl
        out[i] ^= v & 0xFF
    return out


# -- built-in file key (MSVC rand() sequence -> 64 bit candidates, checked against SHA-256 in the header)
def _prng_candidates():
    s = 0x9F731BC7

    def rnd():
        nonlocal s
        s = (s * 214013 + 2531011) & M32
        return (s >> 16) & 0x7FFF

    def key():
        r1 = rnd(); r2 = rnd()
        b0a, b1a, b0b, b1b = r1 & 0xFF, (r1 >> 8) & 0xFF, r2 & 0xFF, (r2 >> 8) & 0xFF
        T = T_ACF0
        if (b0b & 1) == 0:
            h = (T_AAE0[T[b0b]], T_B0F0[T[b0a]], T_B350[T[b1b]], T_B560[T[b1a]])
        else:
            h = (T_AAE0[T[b0a]], T_B0F0[T[b1a]], T_B350[T[b0b]], T_B560[T[b1b]])
        return (h[0] << 48) | (h[1] << 32) | (h[2] << 16) | h[3]
    return [key() for _ in range(0x419)]


_CANDS = None


def _file_key(S, B):
    global _CANDS
    if _CANDS is None:
        _CANDS = _prng_candidates()
    for k in _CANDS:
        if hashlib.sha256(struct.pack('<Q', (S ^ k) & M64)).digest() == B:
            return k
    return 0


def _derive(F):
    r = 0
    r |= (F ^ (F >> 56)) & 0xFF
    r |= ((r >> 24) ^ F) & 0xFF0000
    r |= ((r << 8) ^ F) & 0xFF00000000
    r |= ((r << 40) ^ F) & 0xFF000000000000
    r |= ((r << 56) ^ F) & 0xFF00000000000000
    r |= ((r << 24) ^ F) & 0xFF0000000000
    r |= ((r >> 8) ^ F) & 0xFF000000
    r |= ((r >> 40) ^ F) & 0xFF00
    return r & M64


_POS = (0, 5, 3, 1, 4, 7, 2, 6)


def _rotl(buf, k):
    n = len(buf)
    bits = 8 * n
    if n == 0 or k % bits == 0:
        return bytes(buf)
    k %= bits
    v = int.from_bytes(buf, 'little')
    return (((v << k) | (v >> (bits - k))) & ((1 << bits) - 1)).to_bytes(n, 'little')


def _decrypt(buf, S, F):
    """Data cipher of the file key."""
    D = _derive(F)
    if D == 0:
        return bytes(buf)
    N = (S & 0xFF) + 0x40 if (S & 0xFF) < 0x40 else (S & 0xFF)
    sel = [8 * _POS[(T_ACF0[a & 0xFF] ^ (S & M32)) & 7] for a in range(N)]
    buf = bytearray(buf)
    q, rem = divmod(len(buf), N)
    if rem:
        buf[0:rem] = _rotl(buf[0:rem], D & 0x3F)
    bits = 0
    for i in range(rem):
        c = buf[i]
        bits |= (c & 1) << (i & 63)
        buf[i] = c ^ ((D >> sel[i]) & 0xFF)
    D1 = (D ^ bits) & M64
    mask = 2
    pos = rem
    if _np is not None:
        selb = _np.array([s // 8 for s in sel], _np.intp)
        sh = _np.array([j & 63 for j in range(N)], _np.uint64)
    for _ in range(q):
        blk = _rotl(buf[pos:pos + N], D1 & 0x3F)
        if _np is not None:
            a = _np.frombuffer(blk, _np.uint8)
            ks = _np.frombuffer(D1.to_bytes(8, 'little'), _np.uint8)[selb]
            acc = int(_np.bitwise_or.reduce((a & mask).astype(_np.uint64) << sh))
            buf[pos:pos + N] = (a ^ ks).tobytes()
        else:
            out = bytearray(blk)
            acc = 0
            for j in range(N):
                c = out[j]
                acc |= ((c & mask) << (j & 63)) & M64
                out[j] = c ^ ((D1 >> sel[j]) & 0xFF)
            buf[pos:pos + N] = out
        D1 = (D1 ^ acc) & M64
        mask = ((mask << 1) | (mask >> 7)) & 0xFF
        pos += N
    return bytes(buf)


# -- gMotor LZ (entry flag 0x10000): token < 0x20 = literal run, else (length, distance) from a table
def _lz_table():
    t2 = bytearray(0x200)
    rdx = 0x10000
    for col in range(16):
        rdx = (rdx * 0x107D1) >> 16
        rcx = 0xFFFF
        while True:
            t2[((rcx >> 16) << 4) + col] = 1
            rcx = (rcx * rdx) >> 16
            if rcx >= 0x1D0000:
                break
    tab = [0] * 256
    n = 0
    for row in range(0x1D):
        r8 = row + 4
        for col in range(16):
            i = row * 16 + col
            if t2[i] == 0:
                t2[i] = t2[i - 16]
            else:
                tab[0x20 + n] = r8
                t2[i] = (0x20 + n) & 0xFF
                n += 1
            r8 += 0x100
    return tab


_LZ = _lz_table()


def _lz(src, expect):
    out = bytearray()
    i, n = 0, len(src)
    while i < n:
        t = src[i]
        if t < 0x20:
            out += src[i + 1:i + 2 + t]
            i += 2 + t
        else:
            ent = _LZ[t]
            ln, dist = ent & 0xFF, src[i + 1] + (ent & 0xFF00)
            if dist == 0 or dist > len(out):
                raise MasUnsupported('LZ-Daten fehlerhaft')
            st = len(out) - dist
            if dist >= ln:
                out += out[st:st + ln]
            else:
                for k in range(ln):
                    out.append(out[st + k])
            i += 2
    if len(out) != expect:
        raise MasUnsupported('LZ: %d statt %d Bytes' % (len(out), expect))
    return bytes(out)


def read_index(path):
    """-> list of {'name', 'path', 'offset', 'csize', 'usize', 'flags', 'S', 'F'}; raises MasUnsupported."""
    size = os.path.getsize(path)
    with open(path, 'rb') as f:
        head = f.read(124)
        if len(head) < 124:
            raise MasUnsupported('zu kurz')
        if head[:8] == _WRAP_MAGIC:
            raise MasUnsupported('verschlüsselt (DLC / LMU mit Schlüssel-ID) - wird nicht entpackt')
        ver = _hdr(head[:16]).split(b'\0', 1)[0].decode('latin-1')
        if ver != MAGIC:
            raise MasUnsupported('verschlüsselt oder anderes Format (%s) - wird nicht entpackt'
                                 % ('LMU' if ver.startswith('LMU') else 'DLC / LMU'))
        S = struct.unpack_from('<Q', head, 16)[0]
        B = head[56:88]
        dsize = struct.unpack_from('<I', head, 120)[0]
        if dsize < 12 or 124 + dsize > size:
            raise MasUnsupported('Dateitabelle unlesbar')
        blob = _dir_cipher(f.read(dsize), S)
    dflags, count = struct.unpack_from('<IQ', blob, 0)
    if count > 0x40000 or 12 + count * 0x100 > len(blob):
        raise MasUnsupported('Dateitabelle unlesbar')
    if dflags & 0x2000:
        raise MasUnsupported('Datenschutz-Variante (Bit 13) wird nicht unterstützt')
    F = _file_key(S, B)
    base = 124 + dsize
    out = []
    for i in range(count):
        o = 12 + i * 0x100
        fl = struct.unpack_from('<I', blob, o)[0]
        name = bytes(blob[o + 4:o + 0xE8]).split(b'\0', 1)[0].decode('latin-1')
        off, usize, csize = struct.unpack_from('<QQQ', blob, o + 0xE8)
        packed = bool(fl & 0x10010)
        out.append({'name': os.path.basename(name.replace('\\', '/')), 'path': name, 'offset': base + off,
                    'csize': csize if packed else usize, 'usize': usize, 'flags': fl, 'S': S, 'F': F})
    return out


def extract(path, e):
    """Bytes of one entry; raises MasUnsupported for data that cannot be decoded."""
    with open(path, 'rb') as f:
        f.seek(e['offset'])
        raw = f.read(e['csize'])
    if len(raw) != e['csize']:
        raise MasUnsupported('Eintrag abgeschnitten: %s' % e['name'])
    data = _decrypt(raw, e['S'], e['F'])
    fl = e['flags']
    try:
        if fl & 0x10:
            data = zlib.decompress(data)
        elif fl & 0x10000:
            data = _lz(data, e['usize'])
    except zlib.error:
        raise MasUnsupported('Eintrag nicht entpackbar: %s' % e['name'])
    if len(data) != e['usize']:
        raise MasUnsupported('Eintrag nicht entpackbar: %s' % e['name'])
    return data


