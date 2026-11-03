"""rFactor 2 GMT reader (geometry + material records), no Blender needed.

Taken from the rFactor 2 Importer add-on by haunetal1990 (io_import_rFactor2,
v0.28): the exact numpy readers (stream / table layout, 16- and 32-bit index
buffers, billboard cards) plus the heuristic fallbacks for odd files.

Layout facts (as read by the rF2 tools):
  * accepted versions: GMOTOR_GMT_2.50 / 2.51 / 2.52 (string read at 0x1BC)
  * material lib first (u32 size at offset 0), mesh block size at 0x144
  * per material the engine opens "<material name>.json" - first in the
    material folder from the settings ("<dir>\\<name>.json"), then via the
    normal search paths.
"""
import struct
import time
import math
import os
import re

SEARCH_TIME_LIMIT = 20.0

def read_f32(data, off):
    return struct.unpack_from('<f', data, off)[0]


def parse_bbox(data):
    floats = [read_f32(data, o) for o in range(0x08, 0x100, 4)]
    triples = [tuple(floats[i:i + 3]) for i in range(0, len(floats) - 2, 3)]
    xs = [t[0] for t in triples]
    ys = [t[1] for t in triples]
    zs = [t[2] for t in triples]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def parse_object_position(data):
    if len(data) < 0x114 + 12:
        return (0.0, 0.0, 0.0)
    px, py, pz = struct.unpack_from('<3f', data, 0x114)
    return (px, pz, py)


def find_object_name(data, search_start=0x160, search_end=0x200):
    for m in re.finditer(rb'[A-Za-z][A-Za-z0-9_]{3,40}', data[search_start:search_end]):
        return m.group().decode('ascii', 'replace')
    return None


def find_texture_names(data):
    names = re.findall(rb'[A-Za-z0-9_\.]+\.(?:TGA|DDS)', data, re.IGNORECASE)
    seen = []
    for n in names:
        s = n.decode('ascii', 'replace')
        if s not in seen:
            seen.append(s)
    return seen


def triangle_area(a, b, c):
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    cx = uy * vz - uz * vy
    cy = uz * vx - ux * vz
    cz = ux * vy - uy * vx
    return 0.5 * math.sqrt(cx * cx + cy * cy + cz * cz)


def max_edge_length(a, b, c):
    def d(p, q):
        return math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2)
    return max(d(a, b), d(b, c), d(c, a))


def bbox_check(p, lo, hi):
    return (lo[0] <= p[0] <= hi[0] and
            lo[1] <= p[1] <= hi[1] and
            lo[2] <= p[2] <= hi[2])


def try_format_b_interleaved(data, bbox, start=0x400, stride=32):
    (xlo, xhi), (ylo, yhi), (zlo, zhi) = bbox
    span = max(xhi - xlo, yhi - ylo, zhi - zlo, 1.0)
    pad = 0.15 * span
    lo = (xlo - pad, ylo - pad, zlo - pad)
    hi = (xhi + pad, yhi + pad, zhi + pad)

    max_records = float('inf')
    if len(data) >= 0x158:
        header_tricount = struct.unpack_from('<I', data, 0x154)[0]
        if 0 < header_tricount < 2_000_000:
            max_records = header_tricount * 3

    verts = []
    tris = []
    p = start
    consecutive_zeros = 0
    MAX_CONSECUTIVE_ZEROS = 8
    while p + 32 <= len(data) and len(verts) < max_records:
        raw = struct.unpack_from('<3f', data, p + 4)
        tri = struct.unpack_from('<3H', data, p + 20)
        is_zero = raw == (0.0, 0.0, 0.0)
        in_bbox = bbox_check(raw, lo, hi) or is_zero
        if not in_bbox:
            break
        if is_zero:
            consecutive_zeros += 1
            if consecutive_zeros > MAX_CONSECUTIVE_ZEROS:
                break
        else:
            consecutive_zeros = 0
        verts.append((raw[0], raw[2], raw[1]))
        tris.append(tri)
        p += 32

    n = len(verts)
    valid_tris = [t for t in tris if max(t) < n]
    real_tris = [t for t in valid_tris if triangle_area(verts[t[0]], verts[t[1]], verts[t[2]]) > 1e-6]
    return {
        'name': 'B (interleaved)',
        'vertices': verts,
        'uvs': [(0.0, 0.0)] * len(verts),
        'triangles': valid_tris,
        'mesh_indices': [0] * len(valid_tris),
        'score': len(real_tris),
    }


def _format_a_search(data, bbox, start, vertex_stride, check_mode):
    (xlo, xhi), (ylo, yhi), (zlo, zhi) = bbox
    span = max(xhi - xlo, yhi - ylo, zhi - zlo, 1.0)
    pad_tight = 0.02 * span
    lo_t = (xlo - pad_tight, ylo - pad_tight, zlo - pad_tight)
    hi_t = (xhi + pad_tight, yhi + pad_tight, zhi + pad_tight)

    def is_valid(base):


        if check_mode == 'alpha':
            if data[base + 27] != 255 or data[base + 39] > 8:
                return False
        else:
            if data[base + 39] > 8:
                return False
        raw = struct.unpack_from('<3f', data, base)
        return bbox_check(raw, lo_t, hi_t)

    def quality_score(run_start, run_len):
        n_check = min(run_len, 30)
        near_zero = 0
        for k in range(n_check):
            x = struct.unpack_from('<f', data, run_start + k * vertex_stride)[0]
            if abs(x) < 0.001:
                near_zero += 1
        return -near_zero

    best_start = None
    best_run = 0


    deadline = time.perf_counter() + SEARCH_TIME_LIMIT
    for phase in range(0, vertex_stride, 4):
        if time.perf_counter() > deadline:
            break
        run = 0
        run_start = None
        pos = start + phase
        iter_count = 0
        while pos + 40 <= len(data):
            iter_count += 1
            if iter_count % 5000 == 0 and time.perf_counter() > deadline:
                break
            if is_valid(pos):
                if run == 0:
                    run_start = pos
                run += 1
                if run > best_run:
                    best_run = run
                    best_start = run_start
                elif run == best_run and run_start != best_start:
                    if quality_score(run_start, run) > quality_score(best_start, best_run):
                        best_start = run_start
            else:
                run = 0
            pos += vertex_stride

    return best_start, best_run


def _find_facedata_start(data, verts, best_run, header_tri_cap, bbox, search_from=0x400, search_to=None):
    if search_to is None:
        search_to = min(len(data), search_from + 0x4000)

    (xlo, xhi), (ylo, yhi), (zlo, zhi) = bbox
    span = max(xhi - xlo, yhi - ylo, zhi - zlo, 1.0)
    pad = 0.05 * span
    lo = (xlo - pad, ylo - pad, zlo - pad)
    hi = (xhi + pad, yhi + pad, zhi + pad)
    n_verts = len(verts)

    def is_valid(base):
        if base + 32 > len(data):
            return None
        tri = struct.unpack_from('<3H', data, base)
        if max(tri) >= best_run or max(tri) >= n_verts:
            return None
        if tri[0] == tri[1] or tri[1] == tri[2] or tri[0] == tri[2]:
            return None
        center = struct.unpack_from('<3f', data, base + 16)
        if not bbox_check(center, lo, hi):
            return None
        return tri

    def run_length(cand, cap):
        n = 0
        while n < cap:
            base = cand + n * 32
            if is_valid(base) is None:
                break
            n += 1
        return n

    target = header_tri_cap if header_tri_cap else 3


    quick_cap = min(60, target + 5)
    best_start = None
    best_len = 0
    deadline = time.perf_counter() + SEARCH_TIME_LIMIT
    for cand in range(search_from, search_to, 4):
        if cand % 2000 == 0 and time.perf_counter() > deadline:
            break
        n = run_length(cand, cap=quick_cap)
        if n > best_len:
            best_len = n
            best_start = cand
        if best_len >= quick_cap:
            break
    if best_start is not None and best_len >= quick_cap and quick_cap < target + 5:
        best_len = run_length(best_start, cap=target + 5)
    return best_start, best_len


def _build_format_a_result(data, best_start, best_run, vertex_stride, bbox):
    verts = []
    uvs = []
    for i in range(best_run):
        base = best_start + i * vertex_stride
        x, y, z = struct.unpack_from('<3f', data, base)
        verts.append((x, z, y))
        if base + 64 + 8 <= len(data):
            u, v = struct.unpack_from('<2f', data, base + 64)
            uvs.append((u, -v))
        else:
            uvs.append((0.0, 0.0))

    header_tri_cap = None
    if len(data) >= 0x158:
        h = struct.unpack_from('<I', data, 0x154)[0]
        if 0 < h < 2_000_000:
            header_tri_cap = h

    fd_start, fd_len = _find_facedata_start(data, verts, best_run, header_tri_cap, bbox)

    tri_list = []
    mesh_indices = []
    if fd_start is not None:
        n_records = header_tri_cap if header_tri_cap else fd_len
        for i in range(n_records):
            base = fd_start + i * 32
            if base + 6 > len(data):
                break
            tri = struct.unpack_from('<3H', data, base)
            if max(tri) >= best_run:
                break
            tri_list.append(tri)
            mesh_indices.append(struct.unpack_from('<I', data, base + 8)[0])


    if len(tri_list) > 50:
        def edge_of(t):
            a, b, c = verts[t[0]], verts[t[1]], verts[t[2]]
            return max_edge_length(a, b, c)

        sample = tri_list if len(tri_list) <= 3000 else tri_list[::max(1, len(tri_list) // 3000)]
        edge_samples = sorted(edge_of(t) for t in sample)
        p95 = edge_samples[int(len(edge_samples) * 0.95)]
        threshold = max(p95 * 25, p95 + 20.0)
        filtered = [(t, mi) for t, mi in zip(tri_list, mesh_indices) if edge_of(t) <= threshold]
        tri_list = [t for t, mi in filtered]
        mesh_indices = [mi for t, mi in filtered]

    real_tris = [t for t in tri_list if triangle_area(verts[t[0]], verts[t[1]], verts[t[2]]) > 1e-6]

    return {
        'name': 'A (separate)',
        'mesh_indices': mesh_indices,
        'vertices': verts,
        'uvs': uvs,
        'triangles': tri_list,
        'score': len(real_tris),
    }


def try_format_a_separate(data, bbox, start=0x400, face_stride=32, vertex_stride=96):
    best_start, best_run = _format_a_search(data, bbox, start, vertex_stride, 'alpha')

    def trim_leading_suspects(b_start, b_run):
        if b_start is None or b_run < 10:
            return b_start, b_run
        (xlo, xhi), (ylo, yhi), (zlo, zhi) = bbox
        diag = math.sqrt((xhi - xlo) ** 2 + (yhi - ylo) ** 2 + (zhi - zlo) ** 2)
        if diag <= 20:
            return b_start, b_run
        trimmed = 0
        while b_run > 10 and trimmed < 5:
            x, y, z = struct.unpack_from('<3f', data, b_start)
            mag = math.sqrt(x * x + y * y + z * z)
            if 0.95 <= mag <= 1.05:
                b_start += vertex_stride
                b_run -= 1
                trimmed += 1
            else:
                break
        return b_start, b_run

    best_start, best_run = trim_leading_suspects(best_start, best_run)


    if best_run and len(data) >= 0x140:
        h_vcount = struct.unpack_from('<I', data, 0x13c)[0]
        if 0 < h_vcount < best_run <= h_vcount + 50:
            best_run = h_vcount

    result = None
    if best_start is not None and best_run >= 3:
        result = _build_format_a_result(data, best_start, best_run, vertex_stride, bbox)

    needs_fallback = (result is None or result['score'] == 0
                      or result['score'] < len(result['triangles']) * 0.3)


    if not needs_fallback and len(data) >= 0x140:
        h_vcount_check = struct.unpack_from('<I', data, 0x13c)[0]
        if 0 < h_vcount_check < 500_000 and abs(len(result['vertices']) - h_vcount_check) > max(5, h_vcount_check * 0.02):
            needs_fallback = True

    if needs_fallback:
        m_start, m_run = _format_a_search(data, bbox, start, vertex_stride, 'marker')
        m_start, m_run = trim_leading_suspects(m_start, m_run)


        if m_run and len(data) >= 0x140:
            h_vcount = struct.unpack_from('<I', data, 0x13c)[0]
            if 0 < h_vcount < m_run <= h_vcount + 500:
                m_run = h_vcount
        if m_start is not None and m_run >= 3:
            m_result = _build_format_a_result(data, m_start, m_run, vertex_stride, bbox)
            if result is None or m_result['score'] > result['score']:
                result = m_result

    if result is None:
        return {'name': 'A (separate)', 'vertices': [], 'uvs': [], 'triangles': [], 'mesh_indices': [], 'score': -1}
    return result


def try_format_c_billboard(data, bbox, start=None, stride=96):
    def normalize(v):
        l = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
        if l < 1e-9:
            return (0.0, 0.0, 1.0)
        return (v[0] / l, v[1] / l, v[2] / l)

    def cross(a, b):
        return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

    world_up = (0.0, 0.0, 1.0)

    if start is None:
        def normalize_local(v):
            l = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
            return (0.0, 0.0, 1.0) if l < 1e-9 else (v[0] / l, v[1] / l, v[2] / l)

        def cross_local(a, b):
            return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

        (xlo_b, xhi_b), (ylo_b, yhi_b), (zlo_b, zhi_b) = bbox
        span_b = max(xhi_b - xlo_b, yhi_b - ylo_b, zhi_b - zlo_b, 1.0)
        pad_b = 0.1 * span_b
        lo_b = (xlo_b - pad_b, ylo_b - pad_b, zlo_b - pad_b)
        hi_b = (xhi_b + pad_b, yhi_b + pad_b, zhi_b + pad_b)

        def score_phase(test_start, max_groups=20):
            score = 0
            k = 0
            n_test = min(400, (len(data) - test_start) // stride)
            while k < n_test and max_groups > 0:
                b0 = test_start + k * stride
                if b0 + 12 > len(data):
                    break
                xa, ya, za = struct.unpack_from('<3f', data, b0)


                if not (lo_b[0] <= xa <= hi_b[0] and lo_b[1] <= ya <= hi_b[1] and lo_b[2] <= za <= hi_b[2]):
                    k += 1
                    continue
                group = [k]
                m = k + 1
                while m < n_test:
                    bm = test_start + m * stride
                    xm, ym, zm = struct.unpack_from('<3f', data, bm)
                    if abs(xm - xa) < 1e-4 and abs(ym - ya) < 1e-4 and abs(zm - za) < 1e-4:
                        group.append(m)
                        m += 1
                    else:
                        break
                if len(group) == 4:
                    pos0 = (xa, za, ya)
                    nf0, nf1, nf2 = struct.unpack_from('<3f', data, b0 + 12)
                    normal = normalize_local((nf0, nf2, nf1))
                    right = normalize_local(cross_local(normal, (0.0, 1.0, 0.0)))
                    up = normalize_local(cross_local(right, normal))
                    corners = []
                    for gi in group:
                        bg = test_start + gi * stride
                        u = struct.unpack_from('<f', data, bg + 88)[0]
                        v = struct.unpack_from('<f', data, bg + 92)[0]
                        corners.append((pos0[0] + u * right[0] + v * up[0],
                                         pos0[1] + u * right[1] + v * up[1],
                                         pos0[2] + u * right[2] + v * up[2]))
                    a = triangle_area(corners[0], corners[1], corners[2])
                    if a > 1e-6:
                        score += a
                    max_groups -= 1
                k = m if len(group) > 1 else k + 1
            return score

        result_b = try_format_b_interleaved(data, bbox)
        approx_start = 0x400 + len(result_b['vertices']) * 32

        best_start = approx_start
        best_count = -1
        for cand in range(max(0x400, approx_start - 100), approx_start + 100, 4):
            c = score_phase(cand)
            if c > best_count:
                best_count = c
                best_start = cand


        looks_like_billboard = False
        if len(data) >= 0x158:
            h_v = struct.unpack_from('<I', data, 0x13c)[0]
            h_t = struct.unpack_from('<I', data, 0x154)[0]
            if h_t > 0 and h_v == 2 * h_t:
                looks_like_billboard = True

        if best_count < 2.0 and looks_like_billboard:
            full_best_start = None
            full_best_count = -1
            scan_step = 4 if len(data) < 300_000 else 16
            deadline = time.perf_counter() + SEARCH_TIME_LIMIT
            for cand in range(0x400, len(data) - stride, scan_step):
                if cand % 4000 == 0 and time.perf_counter() > deadline:
                    break
                c = score_phase(cand, max_groups=8)
                if c > full_best_count:
                    full_best_count = c
                    full_best_start = cand
                if full_best_count > 0.5:
                    break
            if full_best_start is not None and full_best_count > best_count:
                best_count = full_best_count
                best_start = full_best_start

        start = best_start

    verts = []
    all_uvs = []
    tris = []
    n_records = (len(data) - start) // stride

    i = 0
    while i < n_records:
        base0 = start + i * stride
        x0, y0, z0 = struct.unpack_from('<3f', data, base0)
        pos0 = (x0, z0, y0)

        group = [i]
        j = i + 1
        while j < n_records:
            basej = start + j * stride
            xj, yj, zj = struct.unpack_from('<3f', data, basej)
            if abs(xj - x0) < 1e-4 and abs(yj - y0) < 1e-4 and abs(zj - z0) < 1e-4:
                group.append(j)
                j += 1
            else:
                break

        if len(group) == 4:
            nf0, nf1, nf2 = struct.unpack_from('<3f', data, base0 + 12)
            normal = normalize((nf0, nf2, nf1))
            right = normalize(cross(normal, world_up))
            if right == (0.0, 0.0, 1.0):
                right = (1.0, 0.0, 0.0)
            up = normalize(cross(right, normal))

            corners = []
            uvs = []
            for gi in group:
                baseg = start + gi * stride
                u = struct.unpack_from('<f', data, baseg + 88)[0]
                v = struct.unpack_from('<f', data, baseg + 92)[0]
                corner = (
                    pos0[0] + u * right[0] + v * up[0],
                    pos0[1] + u * right[1] + v * up[1],
                    pos0[2] + u * right[2] + v * up[2],
                )
                corners.append(corner)
                tex_u = struct.unpack_from('<f', data, baseg + 64)[0]
                tex_v = struct.unpack_from('<f', data, baseg + 68)[0]
                uvs.append((tex_u, -tex_v))

            base_idx = len(verts)
            verts.extend(corners)
            all_uvs.extend(uvs)
            tris.append((base_idx, base_idx + 1, base_idx + 2))
            tris.append((base_idx, base_idx + 2, base_idx + 3))

        i = j if len(group) > 1 else i + 1

    real_tris = [t for t in tris if triangle_area(verts[t[0]], verts[t[1]], verts[t[2]]) > 1e-6]
    return {
        'name': 'C (billboard cards)',
        'vertices': verts,
        'uvs': all_uvs,
        'triangles': tris,
        'mesh_indices': [0] * len(tris),
        'score': len(real_tris),
    }


STREAM_HEADER_END = 0x378
STREAM_MESH_SIZE = 156
FACE_SIZE = 32
K16_SIZE = 16
MATERIAL_SIZE = 240


def _u32(data, off):
    return struct.unpack_from('<I', data, off)[0]


def _index_buffer_tris(data, vstart, vstride, vc, fc):
    """Triangles from the index buffer behind the vertex buffer, for meshes
    with more than 65535 vertices (the face table's 16-bit indices overflow).
    Either 32-bit indices, or 16-bit indices relative to the first vertex of
    each sub-mesh (mesh record: [1] vertex count, [3] index count,
    [6] first vertex, [8] first index).  Returns (tris, sub-mesh per tri or
    None) as numpy arrays, or None."""
    import numpy as np
    n = len(data)
    istart = vstart + vc * vstride
    ic = fc * 3
    if istart + ic * 2 > n:
        return None
    if istart + ic * 4 <= n:
        t32 = np.frombuffer(data, '<u4', count=ic, offset=istart).astype(np.int64)
        if t32.max() < vc:
            return t32.reshape(-1, 3), None
    mc = _u32(data, 0x14c) if len(data) >= 0x150 else 0
    recs = None
    for mt in (STREAM_HEADER_END, STREAM_HEADER_END + 10, 0x374):
        if mt + mc * 156 > n or not (0 < mc < 10_000):
            continue
        r = [struct.unpack_from('<39I', data, mt + k * 156) for k in range(mc)]
        if sum(x[1] for x in r) == vc and sum(x[3] for x in r) == ic:
            recs = r
            break
    if recs is None:
        return None
    idx = np.frombuffer(data, '<u2', count=ic, offset=istart).astype(np.int64)
    parts = []
    mesh_of = []
    for m, r in enumerate(recs):
        base, first_i, count_i = r[6], r[8], r[3]
        seg = idx[first_i:first_i + count_i - count_i % 3] + base
        parts.append(seg.reshape(-1, 3))
        mesh_of.append(np.full(len(seg) // 3, m, np.int64))
    tris = np.concatenate(parts) if parts else np.zeros((0, 3), np.int64)
    if len(tris) != fc or (len(tris) and tris.max() >= vc):
        return None
    # the face table's centroids are useless here (the exporter computed them
    # from overflowed 16-bit indices) - order follows the sub-meshes
    return tris, np.concatenate(mesh_of)


def _build_exact(data, bbox, vstart, vstride, vc, fstart, fc, label):
    """Exact GMT reader (numpy, whole buffers at once)."""
    import numpy as np
    n = len(data)
    if not (3 <= vc <= 2_000_000 and 1 <= fc <= 4_000_000):
        return None
    if vstart < 0x100 or fstart < 0x100:
        return None
    if vstart + vc * vstride > n or fstart + fc * FACE_SIZE > n:
        return None

    (xlo, xhi), (ylo, yhi), (zlo, zhi) = bbox
    span = max(xhi - xlo, yhi - ylo, zhi - zlo, 1.0)
    pad = 0.10 * span
    lo = np.array((xlo - pad, ylo - pad, zlo - pad))
    hi = np.array((xhi + pad, yhi + pad, zhi + pad))

    vrec = np.frombuffer(data, np.uint8, count=vc * vstride, offset=vstart).reshape(vc, vstride)
    raw = vrec[:, 0:12].copy().view('<f4').reshape(vc, 3).astype(np.float64)
    if not np.isfinite(raw).all():
        raw = np.nan_to_num(raw, nan=1e30, posinf=1e30, neginf=-1e30)
    inside = int(((raw >= lo) & (raw <= hi)).all(axis=1).sum())
    if inside < vc * 0.90:
        return None

    frec = np.frombuffer(data, np.uint8, count=fc * FACE_SIZE, offset=fstart).reshape(fc, FACE_SIZE)
    tris16 = frec[:, 0:6].copy().view('<u2').reshape(fc, 3).astype(np.int64)
    face_mesh = frec[:, 8:12].copy().view('<u4').ravel().astype(np.int64)
    cent = frec[:, 16:28].copy().view('<f4').reshape(fc, 3).astype(np.float64)

    # Meshes with more than 65535 vertices: the 16-bit indices of the face
    # table overflow; the real triangles are in the index buffer that
    # follows the vertex buffer (stadiums, grandstands, tyre walls).
    ib_mesh = None
    if vc > 65535:
        ib = _index_buffer_tris(data, vstart, vstride, vc, fc)
        if ib is None:
            return None
        tris = np.asarray(ib[0], np.int64).reshape(-1, 3)
        if ib[1] is not None:
            ib_mesh = np.asarray(ib[1], np.int64)
    else:
        tris = tris16

    valid = (tris < vc).all(axis=1)
    bad = int((~valid).sum())
    if bad > fc * 0.01:
        return None
    tv = tris[valid]
    degenerate = int(((tv[:, 0] == tv[:, 1]) | (tv[:, 1] == tv[:, 2]) | (tv[:, 0] == tv[:, 2])).sum())
    mesh_indices = (ib_mesh if ib_mesh is not None else face_mesh)[valid]

    if ib_mesh is not None:
        # sub-mesh index buffer: validate by geometry instead of centroids
        sample = tv[::max(1, len(tv) // 2000)]
        if not len(sample):
            return None
        a, b, c = raw[sample[:, 0]], raw[sample[:, 1]], raw[sample[:, 2]]
        e = np.maximum(np.maximum(np.linalg.norm(a - b, axis=1), np.linalg.norm(b - c, axis=1)),
                       np.linalg.norm(c - a, axis=1))
        if np.sort(e)[len(e) // 2] > 0.05 * span:
            return None
    else:
        tol = 0.25 + 1e-4 * span
        cc = (raw[tv[:, 0]] + raw[tv[:, 1]] + raw[tv[:, 2]]) / 3.0
        centroid_ok = int((np.abs(cc - cent[valid]) <= tol).all(axis=1).sum())
        if centroid_ok < fc * 0.98:
            return None

    uv = vrec[:, 64:72].copy().view('<f4').reshape(vc, 2).astype(np.float64)
    uv[:, 1] = -uv[:, 1]
    uv_all = None
    colors = None
    normals = vrec[:, 12:24].copy().view('<f4').reshape(vc, 3).astype(np.float64)[:, [0, 2, 1]]
    if vstride >= 96:
        # 96-byte vertex: pos 0, normal 12, colour 24 (BGRA), skin 32,
        # tangent 40, binormal 52, UV sets A..D at 64 / 72 / 80 / 88
        uv_all = vrec[:, 64:96].copy().view('<f4').reshape(vc, 4, 2).astype(np.float64)
        uv_all[:, :, 1] = -uv_all[:, :, 1]
        uv_all[~np.isfinite(uv_all)] = 0.0
        colors = vrec[:, 24:28][:, [2, 1, 0, 3]].copy()

    result = {
        'name': label,
        'vertices': raw[:, [0, 2, 1]],
        'uvs': uv,
        'uvs_all': uv_all,
        'colors': colors,
        'normals': normals,
        'triangles': tv,
        'mesh_indices': mesh_indices,
        'score': len(tv) - degenerate,
        'vstart': vstart,
        'vstride': vstride,
    }
    _apply_billboard_cards(data, vstart, vstride, result)
    return result


def _apply_billboard_cards(data, vstart, vstride, res):
    """Crowd / tree cards: 4 identical positions per card, expanded by the
    per-vertex offsets along tangent / binormal (numpy)."""
    import numpy as np
    if vstride < 96:
        return False
    vc = len(res['vertices'])
    if vc < 4 or vc % 4:
        return False
    vrec = np.frombuffer(data, np.uint8, count=vc * vstride, offset=vstart).reshape(vc, vstride)

    def f3(off):
        return vrec[:, off:off + 12].copy().view('<f4').reshape(vc, 3).astype(np.float64)
    p = f3(0)
    groups = vc // 4
    pg = p.reshape(groups, 4, 3)
    same_g = (np.abs(pg[:, 1:, :] - pg[:, :1, :]) <= 1e-4).all(axis=(1, 2))
    same = int(same_g.sum())
    off = vrec[:, 88:96].copy().view('<f4').reshape(vc, 2).astype(np.float64)
    offsets_seen = bool((np.abs(off.reshape(groups, 4, 2)[same_g]) > 1e-6).any())
    if same < groups * 0.9 or not offsets_seen:
        return False

    nrm = f3(12)
    t = f3(40)
    bi = f3(52)
    weak = ((t * t).sum(1) < 1e-6) | ((bi * bi).sum(1) < 1e-6)
    if weak.any():
        tx = -nrm[weak, 2]
        tz = nrm[weak, 0]
        ln = np.sqrt(tx * tx + tz * tz)
        ln[ln == 0] = 1.0
        t[weak] = np.stack([tx / ln, np.zeros_like(tx), tz / ln], axis=1)
        bi[weak] = (0.0, 1.0, 0.0)
    c = p + off[:, :1] * t + off[:, 1:2] * bi
    res['vertices'] = c[:, [0, 2, 1]]
    res['name'] = res['name'] + ' + billboard cards'
    return True


def try_format_table(data, bbox):
    if len(data) < 0x170:
        return None
    vc, voff, ic, ioff, mc, moff, fc, foff, kc, koff, matc, matoff = struct.unpack_from('<12I', data, 0x13c)
    vstart = voff + 4
    fstart = foff + 4
    istart = ioff + 4
    if not (0 < vc < 2_000_000 and 0 < fc < 4_000_000):
        return None

    strides = [96, 128]


    if istart > vstart:
        gap = istart - vstart
        if gap == vc * 128:
            strides = [128, 96]
    for stride in strides:
        res = _build_exact(data, bbox, vstart, stride, vc, fstart, fc,
                           'T (table, stride %d)' % stride)
        if res is not None:
            return res
    return None


def try_format_stream(data, bbox):
    if len(data) < 0x400:
        return None
    vc = _u32(data, 0x13c)
    mc = _u32(data, 0x14c)
    fc = _u32(data, 0x154)
    kc = _u32(data, 0x15c)
    matc = _u32(data, 0x164)
    if mc > 100_000 or kc > 4_000_000 or matc > 10_000:
        return None

    skip_first = 10 if _u32(data, 0x158) > _u32(data, 0x140) else 0
    for skip in (skip_first, 10 - skip_first):
        fstart = STREAM_HEADER_END + skip + mc * STREAM_MESH_SIZE
        vstart = fstart + fc * FACE_SIZE + kc * K16_SIZE + matc * MATERIAL_SIZE
        res = _build_exact(data, bbox, vstart, 96, vc, fstart, fc, 'S (stream)')
        if res is not None:
            return res
    return None


def _is_plausible_shader_name(s):
    if len(s) > 20:
        return False
    digit_ratio = sum(c.isdigit() for c in s) / len(s)
    if digit_ratio > 0.3:
        return False
    if re.search(r'(?:[A-Z]\d){4,}', s):
        return False
    return True


def find_material_info(data):
    TAIL_SIZE = 20_000
    tail = data[-TAIL_SIZE:] if len(data) > TAIL_SIZE else data

    search_data = tail
    matches = [m for m in re.finditer(rb'L2[A-Z0-9_]+', search_data)
               if _is_plausible_shader_name(m.group().decode('ascii', 'replace'))]
    if not matches and len(tail) < len(data):
        search_data = data
        matches = [m for m in re.finditer(rb'L2[A-Z0-9_]+', search_data)
                   if _is_plausible_shader_name(m.group().decode('ascii', 'replace'))]

    def material_name_before(pos):
        pre = search_data[max(0, pos - 200):pos]
        candidates = re.findall(rb'[A-Za-z][A-Za-z0-9_]{2,23}', pre)
        for cand in reversed(candidates):
            s = cand.decode('ascii', 'replace')
            digit_ratio = sum(c.isdigit() for c in s) / len(s)
            if digit_ratio <= 0.25:
                return s
        return None

    def pick_diffuse(textures):
        for t in textures:
            tu = t.upper()
            if 'ALB' in tu or 'DIFF' in tu or 'BASECOLOR' in tu:
                return t
        return textures[0] if textures else None

    if not matches:
        return None, None, None, [], []

    all_materials = []
    for idx, m in enumerate(matches):
        shader = m.group().decode('ascii', 'replace')
        material_name = material_name_before(m.start())
        chunk_end = matches[idx + 1].start() if idx + 1 < len(matches) else len(search_data)
        chunk_textures = find_texture_names(search_data[m.start():chunk_end])
        all_materials.append((material_name, shader, pick_diffuse(chunk_textures), chunk_textures))


    primary_name, primary_shader, primary_diffuse, primary_textures = all_materials[-1]
    return primary_name, primary_shader, primary_diffuse, primary_textures, all_materials


def read_submesh_materials(data):
    """Material index of every sub-mesh (mesh record u32[9]) or None."""
    if len(data) < 0x400:
        return None
    vc = struct.unpack_from('<I', data, 0x13c)[0]
    mc = struct.unpack_from('<I', data, 0x14c)[0]
    if not (0 < mc < 10000):
        return None
    for mt in (STREAM_HEADER_END, STREAM_HEADER_END + 10, 0x374):
        if mt + mc * STREAM_MESH_SIZE > len(data):
            continue
        recs = [struct.unpack_from('<39I', data, mt + k * STREAM_MESH_SIZE) for k in range(mc)]
        if sum(r[1] for r in recs) == vc:
            return [r[9] for r in recs]
    return None


def parse_gmt(filepath, want_skeleton=True, lazy_skin=False):
    with open(filepath, 'rb') as f:
        data = f.read()

    name = find_object_name(data) or os.path.splitext(os.path.basename(filepath))[0]
    material_name, shader_name, diffuse_texture, textures, all_materials = find_material_info(data)
    materials_ex = parse_gmt_materials(data)
    if materials_ex:
        def _pick(texs):
            for tx in texs:
                tu = tx.upper()
                if 'ALB' in tu or 'DIFF' in tu or 'BASECOLOR' in tu:
                    return tx
            return texs[0] if texs else None
        all_materials = []
        for m in materials_ex:
            texs = [s['tex'] for s in m['stages'] if s['tex']]
            all_materials.append((m['name'], m['shader'], _pick(texs), texs))
        material_name, shader_name, diffuse_texture, textures = all_materials[-1]
    submesh_materials = read_submesh_materials(data)
    object_position = parse_object_position(data)
    bbox = parse_bbox(data)

    header_vcount = None
    header_tricount = None
    if len(data) >= 0x158:
        header_vcount = struct.unpack_from('<I', data, 0x13c)[0]
        header_tricount = struct.unpack_from('<I', data, 0x154)[0]

    def make_info(best, format_label, candidates):
        info = {
            'name': name,
            'material_name': material_name,
            'shader_name': shader_name,
            'diffuse_texture': diffuse_texture,
            'textures': textures,
            'materials': all_materials,
            'materials_ex': materials_ex,
            'submesh_materials': submesh_materials,
            'position': object_position,
            'format_used': format_label,
            'candidates': candidates,
        }
        if want_skeleton:
            info['_path'] = filepath
            _attach_skeleton_info(data, best, info, lazy_skin)
        else:
            info['bones'] = []
            info['skin'] = None
        return info

    def matches_header(result, vtol=0.02, ttol=0.05, score_ratio=0.5):
        v, t = len(result['vertices']), len(result['triangles'])
        if not (header_vcount and 0 < header_vcount < 500_000 and result['score'] > 0):
            return False
        if abs(v - header_vcount) > max(5, header_vcount * vtol):
            return False
        if header_tricount and 0 < header_tricount < 500_000:
            if abs(t - header_tricount) > max(5, header_tricount * ttol):
                return False
        if result['score'] < t * score_ratio:
            return False
        return True

    def looks_like_billboard_shape(result):
        v, t = len(result['vertices']), len(result['triangles'])
        return t > 0 and v == 2 * t

    header_is_billboard_shaped = bool(
        header_vcount and header_tricount and header_tricount > 0
        and header_vcount == 2 * header_tricount
    )


    for exact_fn in (try_format_stream, try_format_table):
        exact = exact_fn(data, bbox)
        if exact is not None:
            candidates = [(exact['name'], len(exact['vertices']), len(exact['triangles']), exact['score'])]
            return exact, make_info(exact, exact['name'] + ' [exact]', candidates)

    result_a = try_format_a_separate(data, bbox)


    result_b = None
    result_c = None

    def get_result_b():
        nonlocal result_b
        if result_b is None:
            result_b = try_format_b_interleaved(data, bbox)
        return result_b

    def get_result_c():
        nonlocal result_c
        if result_c is None:
            result_c = try_format_c_billboard(data, bbox)
        return result_c

    a_matches = matches_header(result_a)
    a_is_billboard_shaped = looks_like_billboard_shape(result_a)


    if a_matches and not a_is_billboard_shaped and not header_is_billboard_shaped:
        candidates = [(result_a['name'], len(result_a['vertices']), len(result_a['triangles']), result_a['score'])]
        return result_a, make_info(result_a, result_a['name'] + ' [header match]', candidates)


    if a_is_billboard_shaped or header_is_billboard_shaped:
        rc = get_result_c()
        if rc['triangles']:
            c_ratio = rc['score'] / len(rc['triangles'])
            c_vcount_ok = not header_vcount or abs(len(rc['vertices']) - header_vcount) <= max(20, header_vcount * 0.05)
            if c_ratio >= 0.8 and c_vcount_ok:
                candidates = [(result_a['name'], len(result_a['vertices']), len(result_a['triangles']), result_a['score']),
                              (rc['name'], len(rc['vertices']), len(rc['triangles']), rc['score'])]
                return rc, make_info(rc, rc['name'] + ' [billboard signature]', candidates)

    if a_matches:
        candidates = [(result_a['name'], len(result_a['vertices']), len(result_a['triangles']), result_a['score'])]
        return result_a, make_info(result_a, result_a['name'] + ' [header match]', candidates)


    rb = get_result_b()
    rc = get_result_c()
    candidates_full = [result_a, rb, rc]
    best = max(candidates_full, key=lambda r: r['score'])
    candidates = [(r['name'], len(r['vertices']), len(r['triangles']), r['score']) for r in candidates_full]
    return best, make_info(best, best['name'], candidates)


def _attach_skeleton_info(data, result, info, lazy_skin=False):
    info['bones'] = []
    info['skin'] = None


def _cstr(data, off, maxlen):
    raw = bytes(data[off:off + maxlen])
    z = raw.find(b'\x00')
    if z >= 0:
        raw = raw[:z]
    return raw.decode('latin-1', 'replace')


# ---------------------------------------------------------------------------
#
# GMT material section (header u32 @0 + 4 = material count, then the records):
#   +0     char[64]  material name
#   +148   char[16]  shader name (L2IBLSTANDARD, L2DIFFUSET0, ...)
#   +256   u32       number of texture stages
#   +260   stages, 180 bytes each:
#            +0  char[64] texture file name    +76 u32 stage type
#            +88 u32 stage index (= gfxStage of the shader)
# A few records carry extra bytes (animated textures); the parser re-syncs
# on the next shader name.
#
# Texture roles, their UV set (UV_A..UV_D = the 4 UV sets of a vertex,
# WorldPlanar = world XZ) and UV_Scale come from the material JSON
# (preprocessorFlags / cbParameters).  Without JSON the defaults of the rF2
# core shaders are used (table generated from the CoreShaders sources).

_RF2_SHADER_TEXTURES = {
    # name: (gfxStage, sRGB, guard macro, UV macro, default UV, UV_Scale key)
    'L2IBLCURB': {
        'albedoMap': (0, True, None, 'ALBEDOROUGHUV', 'UV_A', 'Albedo'),
        'marbleDustMaskMap': (1, False, 'MARBLEDUSTMASK', 'MARBLEDUSTMASKUV', 'WorldPlanar', 'MarbleDust'),
        'grooveMap': (2, False, 'GROOVEMASK', 'GROOVEUV', 'UV_C', 'Groove'),
        'roadDetailsMap': (3, False, 'ROADDETAILSMAP', 'ROADDETAILSUV', 'UV_D', 'RoadDetails'),
        'albedoAltMap': (4, True, 'ALBEDOALTMAP', 'ALBEDOALTUV', 'UV_A', 'AlbedoAlt'),
        'aoSpecularMap': (5, False, 'AOSPECMAP', 'AOSPECUV', 'UV_A', 'aoSpec'),
        'normalMap': (6, False, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'),
        'blendWetMaskMap': (None, False, 'BLENDWETMASK', 'BLENDWETUV', 'UV_A', 'BlendWet'),
        'normalAltMap': (None, False, 'NORMALALTMAP', 'NORMALALTUV', 'UV_A', 'NormalAlt'),
    },
    'L2IBLGLASS': {
        'albedoMap': (0, True, 'ALBEDOMAP', 'ALBEDOUV', 'UV_A', 'Albedo'),
        'normalMap': (1, False, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'),
        'occlRoughMap': (None, False, 'OCCLUSIONROUGHNESSMAP', 'OCCLROUGHUV', 'UV_A', 'OcclusionRoughness'),
    },
    'L2IBLROAD': {
        'albedoMap': (0, True, None, 'ALBEDOROUGHUV', 'UV_A', 'Albedo'),
        'overlayMap': (1, False, 'OVERLAYMAP', 'OVERLAYUV', 'WorldPlanar', 'Overlay'),
        'grooveMap': (2, False, 'GROOVEMASK', 'GROOVEUV', 'UV_C', 'Groove'),
        'roadDetailsMap': (3, False, 'ROADDETAILSMAP', 'ROADDETAILSUV', 'UV_D', 'RoadDetails'),
        'aoSpecularMap': (5, False, 'AOSPECMAP', 'AOSPECUV', 'WorldPlanar', 'aoSpec'),
        'normalMap': (6, False, 'NORMALMAP', 'NORMALUV', 'WorldPlanar', 'Normal'),
        'marbleDustMaskMap': (4, False, 'MARBLEDUSTMASK', 'MARBLEDUSTMASKUV', 'WorldPlanar', 'MarbleDust'),
        'blendWetMaskMap': (None, False, 'BLENDWETMASK', 'BLENDWETUV', 'UV_A', 'BlendWet'),
        'decalMap': (None, False, 'DECALMAP', 'DECALUV', 'UV_B', 'Decal'),
        'normalAltMap': (None, False, 'NORMALALTMAP', 'NORMALALTUV', 'UV_A', 'NormalAlt'),
    },
    'L2IBLSTANDARD': {
        'albedoMap': (0, True, 'ALBEDOMAP', 'ALBEDOUV', 'UV_A', 'Albedo'),
        'detailMap': (1, True, 'DETAILMAP', 'DETAILUV', 'UV_B', 'Detail'),
        'aoSpecularMap': (2, False, 'AOSPECMAP', 'AOSPECUV', 'UV_C', 'aoSpec'),
        'metalRoughMap': (3, False, 'METALLICROUGHNESSMAP', 'METALROUGHUV', 'UV_A', 'MetalRough'),
        'normalMap': (4, False, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'),
        'emissiveMap': (5, False, 'EMISSIVEMAP', 'EMISSIVEUV', 'UV_C', 'Emissive'),
        'aoSpecularAltMap': (6, False, 'AOSPECALTMAP', 'AOSPECALTUV', 'UV_A', 'aoSpecAlt'),
    },
    'L2IBLSTANDARDBLEND': {
        'albedoMap': (0, True, 'ALBEDOMAP', 'ALBEDOUV', 'UV_A', 'Albedo'),
        'albedoAltMap': (1, True, 'ALBEDOALTMAP', 'ALBEDOALTUV', 'UV_B', 'AlbedoAlt'),
        'aoSpecularMap': (2, False, 'AOSPECMAP', 'AOSPECUV', 'UV_C', 'aoSpec'),
        'metalRoughMap': (3, False, 'METALLICROUGHNESSMAP', 'METALROUGHUV', 'UV_A', 'MetalRough'),
        'metalRoughAltMap': (4, False, 'METALLICROUGHNESSALTMAP', 'METALROUGHALTUV', 'UV_A', 'MetalRoughAlt'),
        'normalMap': (5, False, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'),
        'normalAltMap': (6, False, 'NORMALALTMAP', 'NORMALALTUV', 'UV_B', 'NormalAlt'),
        'emissiveMap': (7, False, 'EMISSIVEMAP', 'EMISSIVEUV', 'UV_C', 'Emissive'),
        'blendMap': (None, False, None, 'BLENDMAPUV', 'UV_C', 'Blend'),
        'detailMap': (None, False, 'DETAILMAP', 'DETAILUV', 'UV_B', 'Detail'),
        'aoSpecularAltMap': (None, False, 'AOSPECALTMAP', 'AOSPECALTUV', 'UV_A', 'aoSpecAlt'),
    },
    'L2IBLTERRAIN': {
        'albedoRoughAMap': (0, True, None, 'ALBEDOAUV', 'WorldPlanar', 'AlbedoA'),
        'albedoRoughBMap': (1, True, None, 'ALBEDOBUV', 'WorldPlanar', 'AlbedoB'),
        'patternMap': (2, False, None, 'PATTERNUV', 'WorldPlanar', 'Pattern'),
        'mixSpecularMap': (3, False, None, 'MIXSPECUV', 'WorldPlanar', 'MixSpecularA'),
        'albedoRoughCMap': (4, True, None, 'ALBEDOCUV', 'WorldPlanar', 'AlbedoC'),
        'normalAMap': (5, False, None, 'NORMALAUV', 'WorldPlanar', 'NormalA'),
        'normalBMap': (6, False, None, 'NORMALBUV', 'WorldPlanar', 'NormalB'),
        'splatterMap': (7, False, None, 'SPLATTERUV', 'UV_A', 'Splatter'),
        'albedoRoughDMap': (None, True, None, 'ALBEDODUV', 'WorldPlanar', 'AlbedoD'),
        'splatterOverlayMap': (None, False, None, 'SPLATTEROVERLAYUV', 'UV_B', 'SplatterOverlay'),
        'emissiveMap': (None, False, None, 'EMISSIVEUV', 'UV_A', 'Emissive'),
    },
    'L2IBLTERRAINLEGACY': {
        'albedoRoughAMap': (0, True, None, 'ALBEDOAUV', 'UV_A', None),
        'albedoRoughBMap': (1, True, None, 'ALBEDOBUV', 'UV_A', None),
        'patternMap': (2, False, None, 'PATTERNUV', 'UV_A', None),
        'mixSpecularMap': (3, False, None, 'MIXSPECUV', 'UV_A', None),
        'albedoRoughCMap': (4, True, None, 'ALBEDOCUV', 'UV_A', None),
        'normalAMap': (5, False, None, 'NORMALAUV', 'UV_A', None),
        'normalBMap': (6, False, None, 'NORMALBUV', 'UV_A', None),
        'shadowMap': (7, False, 'SHADOWMAP', 'SHADOWUV', 'UV_D', None),
    },
    'L2IBLVEGETATION': {
        'albedoMap': (0, True, 'ALBEDOMAP', 'ALBEDOUV', 'UV_A', 'Albedo'),
        'aoSpecularMap': (1, False, 'AOSPECMAP', 'AOSPECUV', 'UV_C', 'aoSpec'),
        'leafMaskRoughMap': (2, False, 'LEAFMASKROUGHNESSMAP', 'LEAFMASKROUGHUV', 'UV_A', 'LeafMaskRough'),
        'normalMap': (3, False, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'),
        'detailMap': (None, False, 'DETAILMAP', 'DETAILUV', 'UV_B', 'Detail'),
    },
    'L2IBLWATER': {
        'albedoMap': (0, True, None, 'ALBEDOUV', 'UV_A', 'Albedo'),
        'noiseMap': (1, False, None, 'NOISEUV', 'WorldPlanar', 'Noise'),
        'normalAMap': (2, False, None, 'NORMALAUV', 'WorldPlanar', 'NormalA'),
        'normalBMap': (3, False, None, 'NORMALBUV', 'WorldPlanar', 'NormalB'),
    },
}

_SHADER_NODES_VERSION = 3

# texture file name suffix -> role (materials without JSON)
_SUFFIX_ROLES = (
    (('_albr', '_alba', '_alb', '_albedo', '_diffuse', '_diff', '_d', '_col', '_color'), 'albedoMap'),
    (('_aos', '_ao_spec', '_aospec'), 'aoSpecularMap'),
    (('_mr', '_metalrough', '_metrough'), 'metalRoughMap'),
    (('_nm', '_normal', '_nrm', '_norm', '_n', '_bump', '_bmp'), 'normalMap'),
    (('_em', '_emissive', '_emis', '_glow'), 'emissiveMap'),
    (('_lr', '_leafrough'), 'leafMaskRoughMap'),
    (('_spl',), 'splatterMap'), (('_pt',), 'patternMap'), (('_mx',), 'mixSpecularMap'),
    (('_ova', '_ov'), 'overlayMap'), (('_mu',), 'albedoAltMap'),
    (('_spec', '_specular', '_sp', '_s'), 'specularMap'),
)

_SHADER_NAME_RE = re.compile(rb'L2[A-Z0-9_]{2,40}\x00')


# Texture stage (180 bytes, +0x48 = FrameCount).  Animated stages (FrameCount
# > 1, e.g. D27_RAINLIGHT -> D27_RAINLIGHT00/01.dds) carry an extra block
# right after the stage index: f32 rate, u32 method (CUBETAM_*: 0 none,
# 1 cycle, 2 oneshot, 3 pendulum, 4 transient, 5 random, 6 manual, 7 video),
# then further values.
CUBETAM = ('NOANIM', 'CYCLE', 'ONESHOT', 'PENDULUM', 'TRANSIENT', 'RANDOM', 'MANUAL', 'VIDEO')


def _plausible_stage(data, q):
    if q + 180 > len(data):
        return q == len(data)
    name = bytes(data[q:q + 64]).split(b'\x00')[0]
    if name and not all(32 <= c < 127 for c in name):
        return False
    fc = struct.unpack_from('<I', data, q + 72)[0]
    return 0 < fc < 1000 and struct.unpack_from('<i', data, q + 68)[0] in (-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13)


def _stage_size(data, q, st):
    frames = struct.unpack_from('<I', data, q + 72)[0]
    st['frames'] = frames if 0 < frames < 1000 else 1
    if st['frames'] <= 1:
        return 180
    # animated stage: +80 frame sequence (one u32 per frame), then u32 method (CUBETAM_*) and
    # f32 rate (checked: heat_fx 18 frames Cycle 25/s, rain light 2 frames)
    n = st['frames']
    seq_end = q + 80 + 4 * n
    if seq_end + 8 <= len(data):
        st['sequence'] = list(struct.unpack_from('<%dI' % n, data, q + 80))
        st['method'] = struct.unpack_from('<I', data, seq_end)[0]
        st['rate'] = struct.unpack_from('<f', data, seq_end + 4)[0]
        st['anim_raw'] = [struct.unpack_from('<I', data, seq_end + k)[0] for k in range(0, 20, 4)
                          if seq_end + k + 4 <= len(data)]
        if not (0 <= st['method'] < 8):
            st['method'] = 1
        if not (0 < st['rate'] < 1000):
            st['rate'] = 1.0
        if any(v >= n for v in st['sequence']):
            st.pop('sequence')
    # extra block: 12 + 4 * frames bytes (2 frames -> 20), otherwise resync
    for size in (192 + 4 * st['frames'], 200, 180 + 4 * st['frames'], 196, 204, 180):
        nxt = q + size
        if _plausible_stage(data, nxt) or nxt >= len(data) - 4:
            return size
    return 192 + 4 * st['frames']


def parse_gmt_materials(data):
    """Binary material records of a GMT -> [{'name', 'shader', 'stages': [{'tex',
    'type', 'index'}], 'raw' (bytes)}] or None."""
    if len(data) < 16:
        return None
    try:
        p = struct.unpack_from('<I', data, 0)[0] + 4
        n = struct.unpack_from('<I', data, p)[0]
    except struct.error:
        return None
    if not (0 < n < 1000) or p + 4 + n * 260 > len(data):
        return None
    p += 4
    mats = []
    for _i in range(n):
        sp = p + 148
        if not _SHADER_NAME_RE.match(data, sp):
            m = _SHADER_NAME_RE.search(data, p + 100, min(len(data), p + 800))
            if not m:
                return mats or None
            sp = m.start()
            p = sp - 148
        try:
            ns = struct.unpack_from('<I', data, sp + 108)[0]
        except struct.error:
            return mats or None
        if ns > 32 or sp + 112 + ns * 180 > len(data):
            return mats or None
        stages = []
        q = sp + 112
        for _k in range(ns):
            if q + 180 > len(data):
                break
            st = {'tex': _cstr(data, q, 64), 'type': struct.unpack_from('<I', data, q + 76)[0],
                  'index': struct.unpack_from('<I', data, q + 88)[0]}
            size = _stage_size(data, q, st)
            stages.append(st)
            q += size
        mats.append({'name': _cstr(data, p, 64), 'shader': _cstr(data, sp, 40), 'stages': stages,
                     'start': p})
        p = q
    # raw record = up to the next record (special stages carry extra bytes)
    for k, mm in enumerate(mats):
        e = mats[k + 1]['start'] if k + 1 < len(mats) else len(data)
        mm['raw'] = bytes(data[mm['start']:e])
    return mats


def _flatten_params(d, prefix=''):
    out = {}
    if isinstance(d, dict):
        for k, v in d.items():
            if isinstance(v, dict):
                out.update(_flatten_params(v, prefix + k + '.'))
            else:
                out[prefix + k] = v
    return out


# ---- skeleton / skin / ANM (from the Blender importer) ----

# ---------------------------------------------------------------------------
# Skeleton (bone table) and skin weights stored inside a GMT
# ---------------------------------------------------------------------------
#
# Bone record (240 bytes), as found in skinned GMTs (drivers, animated track
# objects).  In the stream layout the table sits directly in front of the
# vertex buffer (3DSimEd3 simply skips "bone count * 0xF0" bytes there):
#
#   -4   int32    parent index (-1 = none)          (belongs to this record)
#   +0   char[48] bone name
#   +48  uint32   0, uint32 1
#   +56  float[16] bind matrix  (row-major, row vectors, game space, Y up)
#   +120 uint32   1
#   +124 float[16] inverse bind matrix
#   +188 uint32   2, followed by 10 floats (pos/rot/scale defaults)
#
# Vertex record (96 bytes): byte 32..35 = 4 bone indices, byte 36..38 = three
# weights (0..255, the 4th weight is 255 - sum), byte 39 = influence count.

BONE_RECORD_SIZE = 240
_BONE_SIG = b'\x00\x00\x00\x00\x01\x00\x00\x00'
MAX_BONES = 5000


def _mat4_mul_rows(a, b):
    return [sum(a[r * 4 + k] * b[k * 4 + c] for k in range(4))
            for r in range(4) for c in range(4)]


def _valid_bone_record(data, n):
    if n < 4 or n + 192 > len(data):
        return False
    c0 = data[n]
    if not (65 <= c0 <= 90 or 97 <= c0 <= 122 or 48 <= c0 <= 57 or c0 == 95):
        return False
    name = bytes(data[n:n + 48])
    z = name.find(b'\x00')
    if z <= 0 or any(ch < 32 or ch > 126 for ch in name[:z]):
        return False
    if _u32(data, n + 120) != 1 or _u32(data, n + 188) != 2:
        return False
    m1 = struct.unpack_from('<16f', data, n + 56)
    m2 = struct.unpack_from('<16f', data, n + 124)
    if not all(math.isfinite(x) for x in m1 + m2):
        return False
    if abs(m1[15] - 1.0) > 1e-3 or abs(m2[15] - 1.0) > 1e-3:
        return False
    if abs(m1[3]) + abs(m1[7]) + abs(m1[11]) > 1e-3:
        return False
    prod = _mat4_mul_rows(m1, m2)
    for i in range(16):
        if abs(prod[i] - (1.0 if i % 5 == 0 else 0.0)) > 2e-2:
            return False
    return True


def gmt_bone_count_hint(data):
    if len(data) < 0x168:
        return 0
    n = _u32(data, 0x164)
    return n if 0 < n < MAX_BONES else 0


# fixed-length signature of one bone record (relative to the name start + 48),
# matched in C by the regex engine -> no Python loop over the file
_BONE_RE = re.compile(re.escape(_BONE_SIG) + rb'.{64}\x01\x00\x00\x00.{64}\x02\x00\x00\x00', re.DOTALL)


def _quick_bone_sig(data, n):
    return (n >= 4 and n + 192 <= len(data)
            and data[n + 48:n + 56] == _BONE_SIG
            and data[n + 120:n + 124] == b'\x01\x00\x00\x00'
            and data[n + 188:n + 192] == b'\x02\x00\x00\x00'
            and 32 < data[n] < 127)


def _bone_run_at(data, n, count):
    for k in range(count):
        if not _quick_bone_sig(data, n + k * BONE_RECORD_SIZE):
            return False
    return _valid_bone_record(data, n)


def _bone_table_candidates(data, count, vstart=None):
    """Name offsets where the bone table should start (no file scan)."""
    cands = []
    if vstart is not None:
        base = vstart - count * BONE_RECORD_SIZE
        cands += [base + d for d in range(-24, 26, 2)]
    if len(data) >= 0x168:
        mc = _u32(data, 0x14c)
        fc = _u32(data, 0x154)
        kc = _u32(data, 0x15c)
        if mc < 100_000 and fc < 4_000_000 and kc < 4_000_000:
            for skip in (0, 10):
                bstart = STREAM_HEADER_END + skip + mc * STREAM_MESH_SIZE + fc * FACE_SIZE + kc * K16_SIZE
                cands += [bstart + d for d in range(0, 26, 2)]
        boff = _u32(data, 0x168) if len(data) >= 0x16c else 0
        if boff:
            cands += [boff + d for d in range(-16, 34, 2)]
            if vstart is not None:
                delta = _u32(data, 0x140) - vstart
                cands += [boff - delta + d for d in range(-16, 34, 2)]
    return list(dict.fromkeys(c for c in cands if c >= 4))


def find_bone_table(data, expected=None, vstart=None, allow_scan=True):
    if expected is None:
        expected = gmt_bone_count_hint(data)
    if not expected:
        return []
    start = None
    for n in _bone_table_candidates(data, expected, vstart):
        if _bone_run_at(data, n, expected):
            start = n
            break
    if start is None and allow_scan:
        # fallback: regex search in C, validate only real candidates
        for m in _BONE_RE.finditer(data):
            n = m.start() - 48
            if _bone_run_at(data, n, expected):
                start = n
                break
    if start is None:
        return []
    count = expected
    run = [start + k * BONE_RECORD_SIZE for k in range(count)]
    bones = []
    for idx, n in enumerate(run):
        parent = struct.unpack_from('<i', data, n - 4)[0]
        if not (-1 <= parent < count) or parent == idx:
            parent = -1
        bones.append({
            'index': idx,
            'name': _cstr(data, n, 48),
            'parent': parent,
            'bind': struct.unpack_from('<16f', data, n + 56),
        })

    for b in bones:
        seen = {b['index']}
        p = b['parent']
        while p >= 0:
            if p in seen:
                b['parent'] = -1
                break
            seen.add(p)
            p = bones[p]['parent']
    return bones


def read_mesh_palettes(data, vstart, vstride, vc, nbones):
    """Per sub-mesh bone palettes.  The vertex bone indices are local to the
    sub-mesh: global bone = palette[local].  Mesh record (156 bytes):
    u32[1] vertex count, u32[3] index count, u32[6] first vertex,
    u32[8] first index, u32[23] palette size, u32[24] palette offset.
    The palettes (uint8) follow the index buffer.  Offsets in the header are
    file offsets shifted by a constant (header vertex offset - real start)."""
    if len(data) < 0x16c:
        return None
    h = struct.unpack_from('<12I', data, 0x13c)
    mc = h[4]
    if not (0 < mc < 10_000):
        return None
    delta = h[1] - vstart
    cands = []
    for mt in (0x378, 0x378 + 10, h[5] - delta, h[5] + 4):
        if mt not in cands:
            cands.append(mt)
    for mt in cands:
        if mt < 0x100 or mt + mc * 156 > len(data):
            continue
        recs = [struct.unpack_from('<39I', data, mt + k * 156) for k in range(mc)]
        if sum(r[1] for r in recs) != vc:
            continue
        if any(r[6] + r[1] > vc for r in recs):
            continue
        if any(not (0 < r[23] <= 256) for r in recs):
            continue
        off0 = recs[0][24]
        bases = []
        for base in (off0 - delta, vstart + vc * vstride + h[2] * 2):
            if base not in bases:
                bases.append(base)
        for base in bases:
            out = []
            ok = True
            for r in recs:
                p = base + (r[24] - off0)
                if p < 0 or p + r[23] > len(data):
                    ok = False
                    break
                pal = list(data[p:p + r[23]])
                if max(pal) >= nbones:
                    ok = False
                    break
                out.append((r[6], r[1], pal))
            if ok:
                return out
    return None


class SkinWeights:
    """Per-vertex bone influences as arrays: bone (vc,4) int, weight (vc,4)
    float (unused slots weight 0).  Behaves like the old list of
    ((bone, weight), ...) tuples (len, indexing, iteration)."""
    __slots__ = ('bone', 'weight')

    def __init__(self, bone, weight):
        self.bone = bone
        self.weight = weight

    def __len__(self):
        return len(self.bone)

    def __getitem__(self, i):
        if isinstance(i, slice):
            return [self[k] for k in range(*i.indices(len(self)))]
        b = self.bone[i]
        w = self.weight[i]
        return tuple((int(b[k]), float(w[k])) for k in range(4) if w[k] > 0.0)

    def __iter__(self):
        for i in range(len(self.bone)):
            yield self[i]


def extract_skin(data, vstart, vstride, vc, nbones, palettes=None):
    """Skin weights from the vertex records: bytes 32-35 bone indices
    (sub-mesh palette local), 36-38 weights, 39 influence count.
    Vectorised (numpy)."""
    import numpy as np
    if not nbones or vstride < 40 or vstart + vc * vstride > len(data) or vc <= 0:
        return None
    rec = np.frombuffer(data, dtype=np.uint8, count=vc * vstride, offset=vstart)
    rec = rec.reshape(vc, vstride)[:, 32:40].astype(np.int64)
    idx = rec[:, 0:4].copy()
    c = rec[:, 7].copy()
    # influence count 0 (FeatherFlagA): rigid on the first index
    c[c == 0] = 1
    bad = c > 4
    c[bad] = 1
    slot = np.arange(4)[None, :]
    used = slot < c[:, None]
    if palettes:
        pal_id = np.full(vc, -1, dtype=np.int64)
        table = np.zeros((len(palettes), 256), dtype=np.int64)
        plen = np.zeros(len(palettes), dtype=np.int64)
        for k, (first, count, pal) in enumerate(palettes):
            pal_id[first:min(vc, first + count)] = k
            table[k, :len(pal)] = pal
            plen[k] = len(pal)
        nopal = pal_id < 0
        pid = np.where(nopal, 0, pal_id)
        over = (idx >= plen[pid][:, None]) & used
        bad |= nopal | over.any(1)
        idx = table[pid[:, None], np.clip(idx, 0, 255)]
    if (np.where(used & ~bad[:, None], idx, 0) >= nbones).any():
        return None
    # D3D blend-weight convention: only the first c-1 weights are stored,
    # the last one is implicit (255 - sum).  Some exporters leave junk in
    # the unused slot (Seagull002: 5,0 with c=2 -> 5, 250).
    w = np.zeros((vc, 4), dtype=np.float64)
    stored = np.where(slot[:, :3] < (c[:, None] - 1), rec[:, 4:7], 0)
    w[:, :3] = stored
    last = np.maximum(0, 255 - stored.sum(1))
    w[np.arange(vc), c - 1] = last
    w[~used] = 0.0
    # merge duplicate bone slots of one vertex
    for a_ in range(4):
        for b_ in range(a_ + 1, 4):
            dup = (idx[:, a_] == idx[:, b_]) & (w[:, b_] > 0) & (w[:, a_] > 0)
            if dup.any():
                w[dup, a_] += w[dup, b_]
                w[dup, b_] = 0.0
    s = w.sum(1)
    zero = s <= 0
    w[zero, 0] = 1.0
    s[zero] = 1.0
    w /= s[:, None]
    if bad.sum() > vc * 0.01:
        return None
    w[bad] = 0.0
    idx = np.where(w > 0, idx, 0)
    return SkinWeights(idx.astype(np.int32), w)


def _attach_skeleton_info(data, result, info, lazy_skin=False):
    info['bones'] = []
    info['skin'] = None
    expected = gmt_bone_count_hint(data)
    if not expected:
        return
    bones = find_bone_table(data, expected, result.get('vstart'))
    if not bones:
        return
    info['bones'] = bones
    if 'vstart' in result and lazy_skin:
        info['_skin_args'] = (info.get('_path'), result['vstart'], result['vstride'],
                              len(result['vertices']), len(bones))
        return
    if 'vstart' in result:
        vc = len(result['vertices'])
        palettes = read_mesh_palettes(data, result['vstart'], result['vstride'], vc, len(bones))
        info['bone_palettes'] = palettes
        skin = extract_skin(data, result['vstart'], result['vstride'], vc, len(bones), palettes)
        if skin is not None and len(skin) == len(result['vertices']):
            info['skin'] = skin


# ---------------------------------------------------------------------------
# ANM files
# ---------------------------------------------------------------------------
#
#   0x00 16 bytes signature, 0x10 char[64] name
#   0x50 uint32 version (1), float fps (30), float duration (s), uint32 nodes
#   0x60 nodes:  char[32] name, char[32] parent name, uint32 index,
#                uint32 key count, key count * 44 bytes:
#                float time, float pos[3], float unused[3], float quat[4] (xyzw)
#
# Each key is the bone transform RELATIVE TO ITS OWN BIND POSE, expressed in
# the bone's bind frame (game space):  World(t) = Key(t) * Bind  (row vectors).
# At t=0 this is the identity for objects animated from their rest position
# (Ferris wheel) and the seated pose for the driver (bind = standing).

ANM_HEADER_SIZE = 0x60
ANM_NODE_HEADER = 72
ANM_KEY_SIZE = 44


def _norm_name(n):
    return n.strip().upper()


def parse_anm(filepath, with_keys=True):
    with open(filepath, 'rb') as f:
        head = f.read(ANM_HEADER_SIZE)
        if len(head) < ANM_HEADER_SIZE:
            raise ValueError("file too small for an ANM")
        version, fps, duration, count = struct.unpack_from('<IffI', head, 0x50)
        if not (0 < count < 100_000):
            raise ValueError("not an rFactor 2 ANM (node count %d)" % count)
        if not (math.isfinite(fps) and 1.0 <= fps <= 1000.0):
            fps = 30.0
        size = os.fstat(f.fileno()).st_size
        nodes = []
        truncated = None
        pos = ANM_HEADER_SIZE
        for _i in range(count):
            f.seek(pos)
            nh = f.read(ANM_NODE_HEADER)
            if len(nh) < ANM_NODE_HEADER:
                raise ValueError("ANM truncated (node %d)" % _i)
            name = _cstr(nh, 0, 32)
            parent = _cstr(nh, 32, 32)
            nf = struct.unpack_from('<I', nh, 68)[0]
            end = pos + ANM_NODE_HEADER + nf * ANM_KEY_SIZE
            if end > size:
                if not nodes:
                    raise ValueError("ANM truncated or unknown layout (node '%s')" % name)
                truncated = _i
                print(f"[GMT Import] {os.path.basename(filepath)}: truncated after node "
                      f"{_i} of {count} - using the first {_i} nodes")
                break
            keys = None
            if with_keys:
                import numpy as np
                keys = np.frombuffer(f.read(nf * ANM_KEY_SIZE), dtype='<f4').reshape(nf, 11) \
                    .astype(np.float64)
            nodes.append({'name': name, 'parent': parent, 'count': nf, 'keys': keys})
            pos = end
    return {
        'path': filepath,
        'title': _cstr(head, 0x10, 64),
        'version': version,
        'fps': fps,
        'duration': duration,
        'nodes': nodes,
        'truncated': truncated,
    }


def anm_node_names(anm):
    return {_norm_name(n['name']) for n in anm['nodes']}

