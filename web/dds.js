// DDS reader: header (legacy + DX10), BC1-BC7 and plain 32-bit textures.
// The blocks go straight to the GPU (like the rF2 engine), no decoding.
'use strict';
const DDS = (() => {
  const fourcc = s => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24);
  const DXGI = {
    71: ['BC1', false], 72: ['BC1', true], 70: ['BC1', false], 73: ['BC2', false], 74: ['BC2', false], 75: ['BC2', true],
    76: ['BC3', false], 77: ['BC3', false], 78: ['BC3', true], 79: ['BC4', false], 80: ['BC4', false], 81: ['BC4S', false],
    82: ['BC5', false], 83: ['BC5', false], 84: ['BC5S', false], 94: ['BC6H', false], 95: ['BC6H', false], 96: ['BC6HS', false],
    97: ['BC7', false], 98: ['BC7', false], 99: ['BC7', true], 28: ['RGBA8', false], 29: ['RGBA8', true],
    87: ['BGRA8', false], 91: ['BGRA8', true], 88: ['BGRX8', false], 93: ['BGRX8', true],
  };
  const BLOCK = { BC1: 8, BC4: 8, BC4S: 8, BC2: 16, BC3: 16, BC5: 16, BC5S: 16, BC6H: 16, BC6HS: 16, BC7: 16 };

  function parse(buf) {
    const dv = new DataView(buf);
    if (buf.byteLength < 128 || dv.getUint32(0, true) !== 0x20534444) throw new Error('keine DDS-Datei');
    let height = dv.getUint32(12, true), width = dv.getUint32(16, true);
    let mipCount = Math.max(1, dv.getUint32(28, true));
    const pfFlags = dv.getUint32(80, true), four = dv.getUint32(84, true);
    const bits = dv.getUint32(88, true);
    const rMask = dv.getUint32(92, true), aMask = dv.getUint32(104, true);
    const caps2 = dv.getUint32(112, true);
    let off = 128, format = null, srgb = false;
    if ((pfFlags & 4) && four === fourcc('DX10')) {
      const dxgi = dv.getUint32(128, true);
      const arr = dv.getUint32(140, true);
      off = 148;
      const f = DXGI[dxgi];
      if (!f) throw new Error('DXGI-Format ' + dxgi + ' nicht unterstützt');
      [format, srgb] = f;
      if (arr > 1) { /* texture array: first slice only */ }
    } else if (pfFlags & 4) {
      const m = { [fourcc('DXT1')]: 'BC1', [fourcc('DXT2')]: 'BC2', [fourcc('DXT3')]: 'BC2', [fourcc('DXT4')]: 'BC3',
        [fourcc('DXT5')]: 'BC3', [fourcc('ATI1')]: 'BC4', [fourcc('BC4U')]: 'BC4', [fourcc('BC4S')]: 'BC4S',
        [fourcc('ATI2')]: 'BC5', [fourcc('BC5U')]: 'BC5', [fourcc('BC5S')]: 'BC5S' };
      format = m[four];
      if (!format) throw new Error('FourCC ' + String.fromCharCode(four & 255, (four >> 8) & 255, (four >> 16) & 255, four >>> 24) + ' nicht unterstützt');
    } else if ((pfFlags & 0x40) && bits === 32) {
      format = rMask === 0x000000ff ? 'RGBA8' : 'BGRA8';
      if (!aMask && !(pfFlags & 1)) format = format === 'RGBA8' ? 'RGBX8' : 'BGRX8';
    } else {
      throw new Error('DDS-Pixelformat nicht unterstützt (' + bits + ' bit)');
    }
    if (caps2 & 0x200) { /* cube map: first face only */ }
    const mips = [];
    let w = width, h = height;
    for (let i = 0; i < mipCount; i++) {
      let size;
      if (BLOCK[format]) size = Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * BLOCK[format];
      else size = w * h * 4;
      if (off + size > buf.byteLength) break;
      mips.push({ w, h, data: new Uint8Array(buf, off, size) });
      off += size;
      if (w === 1 && h === 1) break;
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    if (!mips.length) throw new Error('DDS ohne Daten');
    return { width, height, format, srgb, mips, compressed: !!BLOCK[format] };
  }
  // cube map (caps2 0x200): 6 faces +X -X +Y -Y +Z -Z, each with its mip chain -> [{w,h,data}] per face (level 0)
  function parseCube(buf) {
    const dv = new DataView(buf);
    if (!(dv.getUint32(112, true) & 0x200)) return null;
    const d = parse(buf);
    const per = d.mips.reduce((a, m) => a + m.data.byteLength, 0);
    let off = d.mips[0].data.byteOffset;
    const mipsTotal = (() => {               // a face holds the whole chain even if parse() stopped early
      let w = d.width, h = d.height, n = Math.max(1, dv.getUint32(28, true)), sz = 0;
      for (let i = 0; i < n; i++) {
        sz += d.compressed ? Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * BLOCK[d.format] : w * h * 4;
        w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      }
      return sz;
    })();
    const faces = [];
    for (let f = 0; f < 6; f++) {
      const size = d.mips[0].data.byteLength;
      if (off + size > buf.byteLength) return null;
      faces.push({ w: d.width, h: d.height, data: new Uint8Array(buf, off, size) });
      off += Math.max(per, mipsTotal);
    }
    return { ...d, faces };
  }
  return { parse, parseCube, BLOCK };
})();
