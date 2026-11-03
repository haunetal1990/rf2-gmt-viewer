// rF2 material model: shader families, texture roles, UV sets and the
// JSON (cbParameters / preprocessorFlags / textures) -> shader uniforms.
// Tables follow the rF2 CoreShaders sources (same as the Blender importer).
'use strict';
const RF2 = (() => {
  // role: [gfxStage, sRGB, guard macro, UV macro, default UV, UV_Scale key]
  const SHADER_TEXTURES = {
    L2IBLCURB: {
      albedoMap: [0, true, null, 'ALBEDOROUGHUV', 'UV_A', 'Albedo'],
      marbleDustMaskMap: [1, false, 'MARBLEDUSTMASK', 'MARBLEDUSTMASKUV', 'WorldPlanar', 'MarbleDust'],
      grooveMap: [2, false, 'GROOVEMASK', 'GROOVEUV', 'UV_C', 'Groove'],
      roadDetailsMap: [3, false, 'ROADDETAILSMAP', 'ROADDETAILSUV', 'UV_D', 'RoadDetails'],
      albedoAltMap: [4, true, 'ALBEDOALTMAP', 'ALBEDOALTUV', 'UV_A', 'AlbedoAlt'],
      aoSpecularMap: [5, false, 'AOSPECMAP', 'AOSPECUV', 'UV_A', 'aoSpec'],
      normalMap: [6, false, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'],
      blendWetMaskMap: [null, false, 'BLENDWETMASK', 'BLENDWETUV', 'UV_A', 'BlendWet'],
      normalAltMap: [null, false, 'NORMALALTMAP', 'NORMALALTUV', 'UV_A', 'NormalAlt'],
    },
    L2IBLGLASS: {
      albedoMap: [0, true, 'ALBEDOMAP', 'ALBEDOUV', 'UV_A', 'Albedo'],
      normalMap: [1, false, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'],
      occlRoughMap: [null, false, 'OCCLUSIONROUGHNESSMAP', 'OCCLROUGHUV', 'UV_A', 'OcclusionRoughness'],
    },
    L2IBLROAD: {
      albedoMap: [0, true, null, 'ALBEDOROUGHUV', 'UV_A', 'Albedo'],
      overlayMap: [1, false, 'OVERLAYMAP', 'OVERLAYUV', 'WorldPlanar', 'Overlay'],
      grooveMap: [2, false, 'GROOVEMASK', 'GROOVEUV', 'UV_C', 'Groove'],
      roadDetailsMap: [3, false, 'ROADDETAILSMAP', 'ROADDETAILSUV', 'UV_D', 'RoadDetails'],
      aoSpecularMap: [5, false, 'AOSPECMAP', 'AOSPECUV', 'WorldPlanar', 'aoSpec'],
      normalMap: [6, false, 'NORMALMAP', 'NORMALUV', 'WorldPlanar', 'Normal'],
      marbleDustMaskMap: [4, false, 'MARBLEDUSTMASK', 'MARBLEDUSTMASKUV', 'WorldPlanar', 'MarbleDust'],
      blendWetMaskMap: [null, false, 'BLENDWETMASK', 'BLENDWETUV', 'UV_A', 'BlendWet'],
      decalMap: [null, false, 'DECALMAP', 'DECALUV', 'UV_B', 'Decal'],
      normalAltMap: [null, false, 'NORMALALTMAP', 'NORMALALTUV', 'UV_A', 'NormalAlt'],
    },
    L2IBLSTANDARD: {
      albedoMap: [0, true, 'ALBEDOMAP', 'ALBEDOUV', 'UV_A', 'Albedo'],
      detailMap: [1, true, 'DETAILMAP', 'DETAILUV', 'UV_B', 'Detail'],
      aoSpecularMap: [2, false, 'AOSPECMAP', 'AOSPECUV', 'UV_C', 'aoSpec'],
      metalRoughMap: [3, false, 'METALLICROUGHNESSMAP', 'METALROUGHUV', 'UV_A', 'MetalRough'],
      normalMap: [4, false, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'],
      emissiveMap: [5, false, 'EMISSIVEMAP', 'EMISSIVEUV', 'UV_C', 'Emissive'],
      aoSpecularAltMap: [6, false, 'AOSPECALTMAP', 'AOSPECALTUV', 'UV_A', 'aoSpecAlt'],
    },
    L2IBLSTANDARDBLEND: {
      albedoMap: [0, true, 'ALBEDOMAP', 'ALBEDOUV', 'UV_A', 'Albedo'],
      albedoAltMap: [1, true, 'ALBEDOALTMAP', 'ALBEDOALTUV', 'UV_B', 'AlbedoAlt'],
      aoSpecularMap: [2, false, 'AOSPECMAP', 'AOSPECUV', 'UV_C', 'aoSpec'],
      metalRoughMap: [3, false, 'METALLICROUGHNESSMAP', 'METALROUGHUV', 'UV_A', 'MetalRough'],
      metalRoughAltMap: [4, false, 'METALLICROUGHNESSALTMAP', 'METALROUGHALTUV', 'UV_A', 'MetalRoughAlt'],
      normalMap: [5, false, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'],
      normalAltMap: [6, false, 'NORMALALTMAP', 'NORMALALTUV', 'UV_B', 'NormalAlt'],
      emissiveMap: [7, false, 'EMISSIVEMAP', 'EMISSIVEUV', 'UV_C', 'Emissive'],
      blendMap: [null, false, null, 'BLENDMAPUV', 'UV_C', 'Blend'],
      detailMap: [null, false, 'DETAILMAP', 'DETAILUV', 'UV_B', 'Detail'],
      aoSpecularAltMap: [null, false, 'AOSPECALTMAP', 'AOSPECALTUV', 'UV_A', 'aoSpecAlt'],
    },
    L2IBLTERRAIN: {
      albedoRoughAMap: [0, true, null, 'ALBEDOAUV', 'WorldPlanar', 'AlbedoA'],
      albedoRoughBMap: [1, true, null, 'ALBEDOBUV', 'WorldPlanar', 'AlbedoB'],
      patternMap: [2, false, null, 'PATTERNUV', 'WorldPlanar', 'Pattern'],
      mixSpecularMap: [3, false, null, 'MIXSPECUV', 'WorldPlanar', 'MixSpecularA'],
      albedoRoughCMap: [4, true, null, 'ALBEDOCUV', 'WorldPlanar', 'AlbedoC'],
      normalAMap: [5, false, null, 'NORMALAUV', 'WorldPlanar', 'NormalA'],
      normalBMap: [6, false, null, 'NORMALBUV', 'WorldPlanar', 'NormalB'],
      splatterMap: [7, false, null, 'SPLATTERUV', 'UV_A', 'Splatter'],
      albedoRoughDMap: [null, true, null, 'ALBEDODUV', 'WorldPlanar', 'AlbedoD'],
      splatterOverlayMap: [null, false, null, 'SPLATTEROVERLAYUV', 'UV_B', 'SplatterOverlay'],
      emissiveMap: [null, false, null, 'EMISSIVEUV', 'UV_A', 'Emissive'],
    },
    L2IBLTERRAINLEGACY: {
      albedoRoughAMap: [0, true, null, 'ALBEDOAUV', 'UV_A', null],
      albedoRoughBMap: [1, true, null, 'ALBEDOBUV', 'UV_A', null],
      patternMap: [2, false, null, 'PATTERNUV', 'UV_A', null],
      mixSpecularMap: [3, false, null, 'MIXSPECUV', 'UV_A', null],
      albedoRoughCMap: [4, true, null, 'ALBEDOCUV', 'UV_A', null],
      normalAMap: [5, false, null, 'NORMALAUV', 'UV_A', null],
      normalBMap: [6, false, null, 'NORMALBUV', 'UV_A', null],
      shadowMap: [7, false, 'SHADOWMAP', 'SHADOWUV', 'UV_D', null],
    },
    L2IBLVEGETATION: {
      albedoMap: [0, true, 'ALBEDOMAP', 'ALBEDOUV', 'UV_A', 'Albedo'],
      aoSpecularMap: [1, false, 'AOSPECMAP', 'AOSPECUV', 'UV_C', 'aoSpec'],
      leafMaskRoughMap: [2, false, 'LEAFMASKROUGHNESSMAP', 'LEAFMASKROUGHUV', 'UV_A', 'LeafMaskRough'],
      normalMap: [3, false, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'],
      detailMap: [null, false, 'DETAILMAP', 'DETAILUV', 'UV_B', 'Detail'],
    },
    // IBL car body (ps30_IBLCarPaint): s0 albedo + spec in A (livery), s1 damage, s2 region map, s3 AO (G) + edge spec
    // mask (A), s4 cube, s5 damage normal, s6 raindrops (runtime), s7 metal flakes (Base.xy * 8)
    L2IBLCARBODY: {
      albedoMap: [0, true, null, null, 'UV_A', null],
      damageMap: [1, true, null, null, 'UV_B', null],
      regionMap: [2, false, null, null, 'UV_A', null],
      aoSpecularMap: [3, false, null, null, 'UV_A', null],
      damageNormalMap: [5, false, null, null, 'UV_D', null],
      metalFlakesMap: [7, false, null, null, 'UV_A', null],
    },
    // windscreen (ps30_windscreenOutside / Inside): IBL glass + runtime raindrops on UV_D
    L2WINDSCREENOUTSIDE: {
      albedoMap: [0, true, 'ALBEDOMAP', 'ALBEDOUV', 'UV_A', 'Albedo'],
      normalMap: [1, false, 'NORMALMAP', 'NORMALUV', 'UV_A', 'Normal'],
      occlRoughMap: [null, false, 'OCCLUSIONROUGHNESSMAP', 'OCCLROUGHUV', 'UV_A', 'OcclusionRoughness'],
    },
    L2WINDSCREENINSIDE: {
      albedoMap: [0, true, null, null, 'UV_A', null],
      specularMap: [1, false, null, null, 'UV_B', null],
    },
    // car tyres (L2IBLCARTYRE*): albedo RGB + roughness in A; damage maps blend in with DAMAGEBLEND
    L2IBLCARTYRE: {
      albedoRoughMap: [0, true, null, 'ALBEDOROUGHUV', 'UV_A', 'Albedo'],
      aoSpecularMap: [2, false, null, 'AOSPECUV', 'UV_A', 'aoSpec'],
      normalMap: [5, false, null, 'NORMALUV', 'UV_A', 'Normal'],
      damageAlbedoRoughMap: [null, true, 'DAMAGEBLEND', null, 'UV_A', null],
      damageAoSpecularMap: [null, false, 'DAMAGEBLEND', null, 'UV_A', null],
      damageNormalMap: [null, false, 'DAMAGEBLEND', null, 'UV_A', null],
    },
    L2IBLWATER: {
      albedoMap: [0, true, null, 'ALBEDOUV', 'UV_A', 'Albedo'],
      noiseMap: [1, false, null, 'NOISEUV', 'WorldPlanar', 'Noise'],
      normalAMap: [2, false, null, 'NORMALAUV', 'WorldPlanar', 'NormalA'],
      normalBMap: [3, false, null, 'NORMALBUV', 'WorldPlanar', 'NormalB'],
    },
  };

  const SAMPLER_ALIAS = { albedoSpec: 'albedoMap', damage: 'damageMap', region: 'regionMap', aoSpecMask: 'aoSpecularMap',
    metalFlakes: 'metalFlakesMap' };
  const SUFFIX_ROLES = [
    [['_albr', '_alba', '_alb', '_albedo', '_diffuse', '_diff', '_d', '_col', '_color'], 'albedoMap'],
    [['_aos', '_ao_spec', '_aospec'], 'aoSpecularMap'],
    [['_mr', '_metalrough', '_metrough'], 'metalRoughMap'],
    [['_nm', '_normal', '_nrm', '_norm', '_n', '_bump', '_bmp'], 'normalMap'],
    [['_em', '_emissive', '_emis', '_glow'], 'emissiveMap'],
    [['_lr', '_leafrough'], 'leafMaskRoughMap'],
    [['_spl'], 'splatterMap'], [['_pt'], 'patternMap'], [['_mx'], 'mixSpecularMap'],
    [['_ova', '_ov'], 'overlayMap'], [['_mu'], 'albedoAltMap'],
    [['_spec', '_specular', '_sp', '_s'], 'specularMap'],
  ];

  // .gfx Define=(NOALBEDOCORRECT, 1) / (NOSHADOW, 1) of the legacy shaders
  const LEG_NOALB = new Set(['L2DIFFUSENOSHADOWT0']);
  const LEG_NOSHADOW = new Set(['L2BUMPT0NOSHADOW', 'L2BUMPSPECMAPFACESTAMPT0', 'L2BUMPSPECMAPAMBOCCFACESTAMPT0', 'L2BUMPSPECMAPFACESTAMPT0ALPHATEST', 'L2BUMPSPECMAPNORMALSTAMPT0', 'L2BUMPSPECMAPNORMALBILLBOARDT0']);
  const FAMILIES = ['STANDARD', 'BLEND', 'VEGETATION', 'ROAD', 'TERRAIN', 'GLASS', 'WATER', 'LEGACY', 'UNLIT', 'CARBODY', 'CARPAINT', 'DASH'];

  function family(shader) {
    const s = (shader || '').toUpperCase();
    if (s.startsWith('L2IBLCARBODY')) return 'CARBODY';
    if (s === 'L2CARBODYPAINTWITHDAMAGE') return 'CARPAINT';      // ps30_carPaint (old car paint, cube reflection)
    if (s.startsWith('L2WINDSCREEN')) return 'GLASS';
    if (s.startsWith('L2IBLTERRAIN')) return 'TERRAIN';
    if (s.startsWith('L2IBLSTANDARDBLE')) return 'BLEND';
    if (s.startsWith('L2IBLVEGETATION')) return 'VEGETATION';
    if (s.startsWith('L2IBLROAD') || s.startsWith('L2IBLCURB')) return 'ROAD';
    if (s.startsWith('L2IBLGLASS') || s.startsWith('L2GLASS')) return 'GLASS';
    if (s.startsWith('L2IBLWATER')) return 'WATER';
    if (s.startsWith('L2IBL')) return 'STANDARD';
    if (s.startsWith('L2DASHBOARD')) return 'DASH';                // ps30_dashboard: doIBLLighting + emissive constant light
    if (['L2HIGHLUM', 'L2NOLIGHTING', 'L2DIGITALFLAG', 'L2DISKGLOW', 'L2LIGHTFLARE', 'L2LIGHTS'].some(p => s.startsWith(p))) return 'UNLIT';
    return 'LEGACY';
  }

  function table(shader) {
    const s = (shader || '').toUpperCase();
    if (SHADER_TEXTURES[s]) return SHADER_TEXTURES[s];
    let best = null;
    for (const k in SHADER_TEXTURES) if ((s.startsWith(k) || k.startsWith(s)) && s && (!best || k.length > best.length)) best = k;
    if (best) return SHADER_TEXTURES[best];
    const fam = family(s);
    return SHADER_TEXTURES[{ BLEND: 'L2IBLSTANDARDBLEND', STANDARD: 'L2IBLSTANDARD', TERRAIN: 'L2IBLTERRAIN', ROAD: 'L2IBLROAD',
      VEGETATION: 'L2IBLVEGETATION', GLASS: 'L2IBLGLASS', WATER: 'L2IBLWATER' }[fam]] || {};
  }

  function flatten(d, prefix = '', out = {}) {
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      for (const k in d) {
        const v = d[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, prefix + k + '.', out);
        else out[prefix + k] = v;
      }
    }
    return out;
  }

  function roleFromName(stem) {
    const s = stem.toLowerCase();
    for (const [sufs, role] of SUFFIX_ROLES) for (const suf of sufs) if (s.endsWith(suf)) return role;
    return null;
  }

  const UVS = ['UV_A', 'UV_B', 'UV_C', 'UV_D', 'WorldPlanar'];

  // texture animation (CUBETAM_* modes)
  const METHODS = ['NOANIM', 'CYCLE', 'ONESHOT', 'PENDULUM', 'TRANSIENT', 'RANDOM', 'MANUAL', 'VIDEO'];
  const METHOD_LABEL = ['Keine', 'Cycle', 'OneShot', 'Pendulum', 'Transient', 'Random', 'Event (manuell)', 'Video'];
  const texStem = n => String(n || '').split(' ')[0].replace(/\.[^.]*$/, '').toLowerCase();
  function animOf(src, from) {
    if (!src) return null;
    const n = +(src.FrameCount ?? src.frames ?? 1);
    if (!(n > 1)) return null;
    let m = src.Method ?? src.method;
    if (typeof m === 'string') m = METHODS.indexOf(m.replace(/^CUBETAM_/i, '').toUpperCase());
    if (!(m >= 0 && m < METHODS.length)) m = 1;
    let rate = +(src.Rate ?? src.rate ?? 1);
    if (!(rate > 0) || !isFinite(rate)) rate = 1;
    return { frames: Math.min(n, 256), rate, method: m, skip0: !!src.SkipFrame0, from };
  }

  // Legacy (non-IBL) shaders: stage kinds + texture formula from the .gfx tables (RF2_GFX, shaders_gfx.js).
  // ShaderDesc spells the formula, e.g. "T1 lerp T2 mul T3 add T4 Vertex Alpha" (ps30_blinnDiffuse:
  // lerp(T2, T1, vertexAlpha) * T3 + T4 - normal operator precedence, lerp first).
  function legacyRecipe(shader) {
    const g = typeof RF2_GFX !== 'undefined' ? RF2_GFX[String(shader || '').toUpperCase()] : null;
    if (!g) return null;
    const [kinds, desc] = g;
    const nD = [...kinds].filter(k => k === 'D').length;
    const r = { kinds, desc, groups: [0, -1, -1, -1], lerp: 0, spec: 0, refl: 0, reflLayer: 0, alphaTest: false };
    const m = desc.match(/\bT(\d)((?:\s+(?:lerp|mul|add)\s+T\d)*)/i);
    if (m) {
      const toks = (m[0].match(/T\d|lerp|mul|add/gi) || []).map(t => t.toLowerCase());
      const base = /\bT0\b/i.test(desc) ? 0 : 1;
      const layers = [], ops = [];
      toks.forEach((t, i) => (i % 2 === 0 ? layers.push(+t.slice(1) - base) : ops.push(t)));
      const groups = [-1, -1, -1, -1];
      let term = 0, start = 0;
      if (ops[0] === 'lerp') { r.lerp = /vertex alpha/i.test(desc) ? 1 : 2; start = 1; }
      if (layers[0] >= 0 && layers[0] < 4) groups[layers[0]] = 0;
      for (let i = start; i < ops.length; i++) {
        const L = layers[i + 1];
        if (ops[i] === 'add') term++;
        if (L >= 0 && L < 4 && L < nD) groups[L] = (ops[i] === 'lerp') ? 0 : term;
      }
      if (r.lerp && layers[1] >= 0 && layers[1] < 4) groups[layers[1]] = 0;   // second lerp operand
      r.groups = groups;
    }
    const d = desc.toLowerCase(), n = String(shader).toUpperCase();
    r.spec = (/specular/.test(d) || /SPEC/.test(n) || kinds.includes('S')) ? 1 : 0;
    if (/add alpha reflect/.test(d)) r.refl = 1; else if (/add color reflect/.test(d)) r.refl = 2;
    else if (/add grayscale reflect/.test(d)) r.refl = 3; else if (/add specular reflect/.test(d)) r.refl = 4;
    else if (/lerp alpha reflect/.test(d)) r.refl = 5; else if (kinds.includes('C')) r.refl = 6;
    r.reflLayer = /T1 T2|T0T1/.test(desc) || /T0T1|T0XT1/.test(n) ? 1 : 0;
    r.alphaTest = /ALPHATEST/.test(n) || /alpha test/.test(d);
    return r;
  }

  // JSON "shader" is normally the ShaderName; some (e.g. showroom BKG.json: "High luminance sun") carry a
  // description instead -> ShaderDesc lookup, otherwise the GMT's shader name
  function jsonShaderName(js, gmt) {
    const v = String(js || '').trim();
    if (!v) return String(gmt || '');
    if (typeof RF2_GFX === 'undefined' || RF2_GFX[v.toUpperCase()]) return v;
    const lc = v.toLowerCase();
    for (const k in RF2_GFX) if (String(RF2_GFX[k][1] || '').toLowerCase() === lc) return k;
    return gmt ? String(gmt) : v;
  }
  // mat = {name, shader (GMT), stages [{tex,type,index}], json}
  function resolve(mat) {
    const js = mat.json;
    let shader = mat.shader || '';
    let params = {}, flags = {}, ext = {}, std = {};
    if (js) {
      shader = jsonShaderName(js.shader, shader);
      for (const k in (js.preprocessorFlags || {})) flags[k] = String(js.preprocessorFlags[k]);
      params = flatten(((js.parameters || {}).cbParameters) || {});
      ext = flatten(((js.parameters || {}).cbMaterialExt) || {});      // IBL car body regions
      std = flatten(((js.parameters || {}).StandardInfo) || {});       // legacy material (specPower, specFresnel, ...)
    }
    // without JSON StandardInfo: the values stored in the GMT material record (CUBEMATERIAL)
    if (!Object.keys(std).length && mat.gmtStd) std = flatten(mat.gmtStd);
    const tab = table(shader);
    const fam = family(shader);
    const uvFor = (role, e) => {
      const [uvm, uvd] = e ? [e[3], e[4]] : [null, 'UV_A'];
      let uv = uvm ? (flags[uvm] || uvd) : uvd;
      if (!UVS.includes(uv)) uv = 'UV_A';
      return uv;
    };
    const scaleFor = e => {
      const key = e ? e[5] : null;
      const v = key ? params['UV_Scale.' + key] : null;
      return Array.isArray(v) && v.length >= 2 ? [+v[0], +v[1]] : [1, 1];
    };
    const slots = [];
    // "textures": {} / [] in a JSON (e.g. livery JSON of the car body) = the stages of the GMT are used
    const jsTex = js && Array.isArray(js.textures) && js.textures.length ? js.textures : null;
    if (jsTex) {
      jsTex.forEach((t, ti) => {
        if (!t || typeof t !== 'object') return;
        let role = String(t.Name || '');
        const tex = String(t.Texture || '');
        const base = { jsonIndex: ti, name: role, tex };
        if (!role || role.startsWith(':') || t.inactive || !tex || tex.startsWith('@')) { slots.push({ ...base, off: 'inaktiv' }); return; }
        // rF2 binds JSON stages by the shader's sampler names. ps30_IBLCarPaint declares albedoSpec (s0), damage (s1),
        // region (s2), aoSpecMask (s3), damageNormalMap (s5), metalFlakes (s7) - map them to the roles used here
        if (!tab[role] && SAMPLER_ALIAS[role] && tab[SAMPLER_ALIAS[role]]) role = SAMPLER_ALIAS[role];
        const e = tab[role];
        const guard = e ? e[2] : null;
        if (guard && flags[guard] === '@Undef') { slots.push({ ...base, role, off: guard + ' = @Undef' }); return; }
        let srgb = e ? e[1] : ['CUBETST_SRGB', 'CUBETST_DIFFUSEMAP'].includes(t.StageType);
        if (role === 'albedoAltMap' && fam === 'BLEND') srgb = flags.ALBEDOFUNCTION === 'Switch';   // ps30_IBLStandardBlend: srgb only for Switch
        if (role === 'sBase' || role === 'sTex0') role = 'albedoMap';
        else if (role === 'sBump') role = 'normalMap';
        else if (role === 'sSpec') role = 'specularMap';
        let roughA = false;
        if (role === 'albedoRoughMap') { role = 'albedoMap'; roughA = true; }   // RGB albedo, A roughness
        const gst = (mat.stages || []).find(st => texStem(st.tex) === texStem(tex));
        slots.push({ ...base, role, uv: uvFor(role, e), scale: scaleFor(e), srgb: !!srgb, stage: t.TexChannel, roughA,
          uvMacro: e ? e[3] : null, scaleKey: e ? e[5] : null, anim: animOf(t, 'JSON') || animOf(gst, 'GMT') });
      });
    } else {
      const byStage = {};
      for (const k in tab) if (tab[k][0] !== null) byStage[tab[k][0]] = k;
      const rec = (fam === 'LEGACY' || fam === 'UNLIT' || fam === 'CARPAINT' || fam === 'DASH') ? legacyRecipe(shader) : null;
      const used = new Set();
      (mat.stages || []).forEach((st, k) => {
        const tex = st.tex || '';
        const stem = tex.split(' ')[0].replace(/\.[^.]*$/, '');
        if (!stem || stem.toLowerCase().startsWith('_deftex')) return;
        let role = null;
        if (rec && k < rec.kinds.length) {
          const kd = rec.kinds[k];
          if (kd === 'D') { const n = [...rec.kinds.slice(0, k)].filter(x => x === 'D').length;
            role = ['albedoMap', 'multiply1Map', 'multiply2Map', 'multiply3Map'][n] || ('extra' + n + 'Map'); }
          else if (kd === 'S') role = used.has('specularMap') ? null : 'specularMap';
          else if (kd === 'B') role = used.has('normalMap') ? null : 'normalMap';
          else {
            slots.push({ name: 'stage' + k, role: null, tex: tex.split(' ')[0], stage: st.index, fromGmt: true,
              off: { C: 'Cube-Map (Umgebung)', R: 'Spiegelung (Laufzeit)', W: 'Regentropfen (Laufzeit)', F: 'Bildschirm (Laufzeit)', Z: 'Tiefe (Laufzeit)' }[kd] });
            return;
          }
        } else if (fam === 'LEGACY' || fam === 'UNLIT' || fam === 'DASH') {
          role = roleFromName(stem);
          if (!['normalMap', 'specularMap'].includes(role) || k === 0)
            role = (k === 0 || !used.has('albedoMap')) ? 'albedoMap' : 'multiply' + k + 'Map';
        } else {
          // like the engine: GMT stage k is bound to sampler register k (gfx StageState order) - no guessing by file
          // name. A GMT with the textures in another order (e.g. *_AOS in stage 1) is shaded like that in rF2 too.
          role = byStage[st.index] || null;
        }
        if (!role || used.has(role)) role = 'stage' + k + 'Map';
        used.add(role);
        const e = tab[role];
        let uv = uvFor(role, e);
        if (fam === 'LEGACY' && role.startsWith('multiply')) {               // ps30 legacy: tex1 = UV_B, tex2 = UV_C, tex3 = UV_D
          const n = { multiply1Map: 1, multiply2Map: 2, multiply3Map: 3 }[role] || Math.min(k, 3); uv = UVS[n]; }
        slots.push({ name: role, role, tex: tex.split(' ')[0], uv, scale: [1, 1],
          srgb: role === 'albedoAltMap' && fam === 'BLEND' ? flags.ALBEDOFUNCTION === 'Switch' : (e ? e[1] : (role === 'albedoMap' || role.startsWith('multiply'))), stage: st.index, fromGmt: true,
          anim: animOf(st, 'GMT') });
      });
    }
    return { shader, family: fam, slots, params, flags, ext, std, table: tab, legacy: (fam === 'LEGACY' || fam === 'UNLIT') ? legacyRecipe(shader) : null,
      windscreen: /^L2WINDSCREEN(?!.*NORAIN)/i.test(shader) };
  }

  // texture role -> shader unit (see renderer.js)
  const UNIT = {
    albedoMap: 0, albedoRoughAMap: 0, albedoAltMap: 1, albedoRoughBMap: 1, multiply1Map: 1,
    aoSpecularMap: 2, mixSpecularMap: 2, metalRoughMap: 3, splatterMap: 3, leafMaskRoughMap: 3,
    metalRoughAltMap: 4, albedoRoughCMap: 4, multiply2Map: 4, normalMap: 5, normalAMap: 5,
    normalAltMap: 6, normalBMap: 6, emissiveMap: 7, detailMap: 8, blendMap: 9, albedoRoughDMap: 9,
    multiply3Map: 9, aoSpecularAltMap: 10, specularMap: 10, patternMap: 10, overlayMap: 11, noiseMap: 11,
    regionMap: 9, metalFlakesMap: 11,
  };
  // ps30_IBLCarPaint RegionInfo defaults ("//@" annotations) and cbMaterialExt order Black, Red, Green, Blue, White, Alpha
  const CB_REGIONS = ['Black', 'Red', 'Green', 'Blue', 'White', 'Alpha'];
  const CB_DEF = { baseCoatRoughness: 0.5, baseCoatSpecStrength: 1, clearCoatSpecStrength: 1, clearCoatRoughness: 0,
    clearCoatRefractiveIndex: 1.34, baseCoatRefractiveIndex: 1.66, lacquerColour: [1, 1, 1, 1], metallicFlakeColour: [1, 1, 1, 1],
    metallicPaintStrength: 0, metallicFlakeStrength: 0 };
  function carbodyUniforms(ext) {
    const g = (rg, k) => { const v = ext[rg + '.' + k]; return v === undefined ? CB_DEF[k] : v; };
    const out = new Float32Array(24 * 4);
    CB_REGIONS.forEach((rg, i) => {
      const o = i * 16, lc = vec4(g(rg, 'lacquerColour'), [1, 1, 1, 1]), fc = vec4(g(rg, 'metallicFlakeColour'), [1, 1, 1, 1]);
      out.set([num(+g(rg, 'baseCoatRoughness'), 0.5), num(+g(rg, 'baseCoatSpecStrength'), 1), num(+g(rg, 'clearCoatSpecStrength'), 1), num(+g(rg, 'clearCoatRoughness'), 0),
        num(+g(rg, 'clearCoatRefractiveIndex'), 1.34), num(+g(rg, 'baseCoatRefractiveIndex'), 1.66), num(+g(rg, 'metallicPaintStrength'), 0), num(+g(rg, 'metallicFlakeStrength'), 0),
        ...lc, ...fc], o);
    });
    const ec = vec4(ext['GreenEmissive.emissiveColour'], [0, 0, 0, 1]);
    return { cb: out, cbX: [num(ext.clearCoatStrength, 1), num(ext.lacquerThickness, 0.1), num(ext['GreenEmissive.emissiveStrength'], 15), 0],
      cbEmis: ec };
  }
  const ALBEDO_FN = { '@Undef': 0, Disabled: 0, Switch: 1, Overlay: 2, Multiply: 3, MultiplySquare: 4, Add: 5, Additive: 5, Subtract: 6 };
  const BLEND_MODE = { VertexAlpha: 1, AlbedoA_A: 2, BlendMap_R: 3, VertexColor_R: 4, AlbedoB_A: 5 };
  const FN5 = { Switch: 1, Overlay: 2, Multiply: 3, Add: 4, Subtract: 5 };

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const vec4 = (v, d) => (Array.isArray(v) && v.length >= 3 ? [num(+v[0], d[0]), num(+v[1], d[1]), num(+v[2], d[2]), v.length > 3 ? num(+v[3], d[3]) : 1] : d);

  // resolved + loaded textures -> uniform values
  function uniforms(r, js, view) {
    const p = r.params, f = r.flags, fam = r.family;
    const roles = new Set(r.slots.filter(s => s.role && !s.off).map(s => s.role));
    const u = {
      family: FAMILIES.indexOf(fam),
      tint: vec4(p['Material_Adjust.AlbedoTint'], [1, 1, 1, 1]),
      specAdj: num(p['Material_Adjust.Specular'], 1), metalAdj: num(p['Material_Adjust.Metallic'], 0.5),
      roughAdj: num(p['Material_Adjust.Roughness'], 0.5), ior: num(p['Material_Adjust.IOR'], 1.5),
      normalIntensity: num(p['Material_Adjust.NormalIntensity'], 1),
      baseAlbedo: vec4(p['Base_Material.Albedo'], [1, 1, 1, 1]), baseAO: num(p['Base_Material.AO'], 1),
      baseSpec: num(p['Base_Material.Specular'], 1), baseMetal: num(p['Base_Material.Metallic'], 0),
      baseRough: num(p['Base_Material.Roughness'], 0.5),
      roughFromAlbedoA: ((f.ROUGHNESSALBEDOALPHA === '@Null' || r.slots.some(s => s.roughA && !s.off)) && !roles.has('metalRoughMap')) ? 1 : 0,
      detailAlbedo: (roles.has('detailMap') && f.DETAILALBEDO !== '@Undef' && f.DETAILALBEDOBLEND !== '@Null') ? num(p['Detail.Albedo'], 1) : 0,
      vcolMul: f.VERTEXCOLOR === 'AlbedoMultiply' ? 1 : 0,
      emissiveOn: (f.EMISSIVEMODE === 'Enabled' || (f.EMISSIVEMODE === 'Night' && view.night)) ? 1 : 0,
      emissiveColour: vec4(p['Emissive.Colour'], [1, 1, 1, 1]), emissiveScalar: num(p['Emissive.Scalar'], 25),
      albedoFn: fam === 'BLEND' ? (f.ALBEDOFUNCTION === undefined ? 4 : (ALBEDO_FN[f.ALBEDOFUNCTION] ?? 0)) : 0,   // macro default MultiplySquare
      blendMode: fam === 'BLEND' ? (BLEND_MODE[f.BLENDMASK] || 0) : 0,
      blendConst: num(view.blendConst, 0),
      blendFns: [FN5[f.METALLICFUNCTION] || 0, FN5[f.ROUGHNESSFUNCTION] || 0, ({ Switch: 1, Overlay: 2 })[f.NORMALFUNCTION] || 0],
      baseAlbedoAlt: vec4(p['Base_Material.AlbedoAlt'], [1, 1, 1, 1]),
      baseMRAlt: [num(p['Base_Material.MetallicAlt'], 0), num(p['Base_Material.RoughnessAlt'], 0.5)],
      terrainBias: num(p['Terrain.MixMapBias'], 0.2),
      alphaMode: 0, twoSided: 1,
      legGroups: [0, -1, -1, -1], legLerp: 0, legSpec: 0.5, reflMode: 0, reflLayer: 0,
    };
    if (fam === 'CARBODY') Object.assign(u, carbodyUniforms(r.ext || {}));
    if (fam === 'DASH') {                 // ps30_dashboard cbParameters, emissive = lerp(Day, Night, saturate(exposure.x))
      const day = num(p.EmissiveDayIntensity, 40), night = num(p.EmissiveNightIntensity, 3);
      u.dashP = [num(p.BaseRoughness, 0.3), view.night ? night : day + (night - day) * 0.06];
    }
    if (fam === 'CARPAINT') {             // ps30_carPaint: StandardInfo + CUBEFRESNEL / NOALBEDOCORRECT
      const sd = r.std || {};
      const cf = String(f.CUBEFRESNEL || 'Default');
      u.ocp = [num(sd.specPower, 350), num(sd['specFresnel.Min'], 0.045), num(sd['specFresnel.Max'], 3.5), num(sd['specFresnel.Exp'], 5)];
      const cube = cf === 'Custom' ? [num(sd['cubeMapFresnel.Min'], 0.1), num(sd['cubeMapFresnel.Max'], 1), num(sd['cubeMapFresnel.Exp'], 5)]
        : cf === 'Chrome' ? [1, 1, 5] : [-1, 1, 5];   // -1 = Default: (0.1, 1, 5), hard-coded in the compiled game shader
      u.occ = [...cube, f.NOALBEDOCORRECT === '@Null' ? 0 : 1];
      const sc = vec4(sd.specularColour, [1, 1, 1, 1]); u.ocs = [sc[0], sc[1], sc[2]];
    }
    u.windscreen = r.windscreen ? 1 : 0;
    // Emissive.gfx luminance shaders (rF2 HDR): L2HighLumSun / L2LowLumEmissive, cbParameters BaseScale/GlareScale/GlareFactor
    const shU = String(r.shader || '').toUpperCase();
    u.lum = shU.startsWith('L2HIGHLUM') ? 1 : (shU.startsWith('L2LOWLUM') || shU.startsWith('L2NOLIGHTING')) ? 2 : 0;   // ps30_noShade = 8 * ambient * tex
    const pk = (k, d) => { const key = Object.keys(p).find(x => x.toLowerCase().split('.').pop() === k); return key ? num(p[key], d) : d; };
    u.lumP = [pk('basescale', 1), pk('glarescale', 4), Math.max(1, pk('glarefactor', 128))];
    const lg = r.legacy;
    if (fam === 'LEGACY') {                // ps30_blinn*: CUBEMATERIAL values (JSON StandardInfo, else GMT record)
      const sd = r.std || {};
      const c4 = (k, d) => { const v = vec4(sd[k], d); return [v[0], v[1], v[2], v[3]]; };
      u.legDif = c4('diffuseColour', [1, 1, 1, 1]); u.legSpc = c4('specularColour', [1, 1, 1, 1]);
      u.legSP = [num(sd.specPower, 20), num(sd['specFresnel.Min'], 0.1), num(sd['specFresnel.Max'], 0.9), num(sd['specFresnel.Exp'], 5)];
      u.legCF = [num(sd['cubeMapFresnel.Min'], 0.1), num(sd['cubeMapFresnel.Max'], 0.9), num(sd['cubeMapFresnel.Exp'], 5),
        (LEG_NOALB.has(shU) || f.NOALBEDOCORRECT === '@Null') ? 0 : 1];
      u.legNoShadow = LEG_NOSHADOW.has(shU) ? 1 : 0;
      if (lg) {
        const unitOf = ['albedoMap', 'multiply1Map', 'multiply2Map', 'multiply3Map'];
        u.legGroups = lg.groups.map((g, i) => (g >= 0 && (i === 0 || roles.has(unitOf[i])) ? g : -1));
        if (lg.lerp && u.legGroups[1] < 0) u.legLerp = 0; else u.legLerp = lg.lerp;
        u.legSpec = lg.spec ? 1 : 0; u.reflMode = lg.refl; u.reflLayer = lg.reflLayer && roles.has('multiply1Map') ? 1 : 0;
      } else u.legGroups = [0, roles.has('multiply1Map') ? 0 : -1, roles.has('multiply2Map') ? 0 : -1, roles.has('multiply3Map') ? 0 : -1];
    }
    const src = js && js.srcBlend, mflags = (js && js.flags) || [];
    const alphaBlend = src === 'CUBEAB_SRCALPHA';
    const alphaClip = fam === 'VEGETATION' || mflags.includes('CUBEMAT_ALPHACHANNEL') || !!(lg && lg.alphaTest);
    if (fam === 'GLASS' || (alphaBlend && fam !== 'VEGETATION')) u.alphaMode = 2;
    else if (alphaClip) u.alphaMode = 1;
    if (src === 'CUBEAB_ONE' && js && js.dstBlend === 'CUBEAB_ONE') u.alphaMode = 3;   // additive
    return u;
  }

  // ---- UI helpers -------------------------------------------------------
  const FLAG_OPTIONS = {
    CUBEFRESNEL: ['Default', 'Chrome', 'Custom'], NOALBEDOCORRECT: ['@Undef', '@Null'],
    ALBEDOFUNCTION: ['@Undef', 'Switch', 'Overlay', 'Multiply', 'MultiplySquare', 'Add', 'Subtract'],
    BLENDMASK: ['@Undef', 'VertexAlpha', 'AlbedoA_A', 'BlendMap_R'],
    VERTEXCOLOR: ['@Undef', 'AlbedoMultiply'], VERTEXALPHA: ['@Undef', '@Null'],
    EMISSIVEMODE: ['@Undef', 'Enabled', 'Night'],
  };
  function flagOptions(key, cur) {
    let o;
    if (FLAG_OPTIONS[key]) o = FLAG_OPTIONS[key].slice();
    else if (/UV$/.test(key)) o = ['UV_A', 'UV_B', 'UV_C', 'UV_D', 'WorldPlanar'];
    else o = ['@Null', '@Undef'];
    if (cur !== undefined && !o.includes(cur)) o.push(cur);
    return o;
  }
  const BLENDS = ['CUBEAB_ZERO', 'CUBEAB_ONE', 'CUBEAB_SRCCOLOR', 'CUBEAB_INVSRCCOLOR', 'CUBEAB_SRCALPHA', 'CUBEAB_INVSRCALPHA',
    'CUBEAB_DSTALPHA', 'CUBEAB_INVDSTALPHA', 'CUBEAB_DSTCOLOR', 'CUBEAB_INVDSTCOLOR', 'CUBEAB_SRCALPHASAT'];
  const MATFLAGS = ['CUBEMAT_ALPHACHANNEL', 'CUBEMAT_SPECULAR', 'CUBEMAT_TWOSIDED', 'CUBEMAT_NOZBUFFER', 'CUBEMAT_SORTEDALPHA',
    'CUBEMAT_FRESNELREFLECT', 'CUBEMAT_FRESNELSPECULAR', 'CUBEMAT_AMBIENTMAT', 'CUBEMAT_DIFFUSEMAT', 'CUBEMAT_SPECLARMAT',
    'CUBEMAT_SPECLARDIR', 'CUBEMAT_EMISSIVMAT', 'CUBEMAT_EMISSIVDIR', 'CUBEMAT_LOCALINTENSITY', 'CUBEMAT_RELIGHT', 'CUBEMAT_DRAWWIREFRAME'];

  function rangeFor(key, v) {
    const k = key.toLowerCase();
    if (k.endsWith('refractiveindex')) return [1, 5, 0.01];
    if (k.endsWith('emissivestrength')) return [0, 100, 0.1];
    if (k.endsWith('ior')) return [1, 3, 0.01];
    if (k.includes('scalar') || k.includes('exposure')) return [0, Math.max(100, v * 2), 0.1];
    if (k.includes('normalintensity') || k.includes('bumpscale')) return [0, 2, 0.01];
    if (k.includes('specpower')) return [0, Math.max(128, v * 2), 0.5];
    if (k.includes('exp')) return [0, Math.max(10, v * 2), 0.05];
    if (k.includes('bias')) return [0.001, 1, 0.001];
    if (v >= 0 && v <= 1) return [0, 1, 0.01];
    return [Math.min(0, v * 2), Math.max(10, Math.abs(v) * 2), 0.01];
  }

  // JSON for a GMT-only material (preview + "JSON anlegen")
  function synthesize(mat) {
    const r = resolve({ ...mat, json: null });
    const tab = table(mat.shader);
    const flags = {};
    const uvScale = {};
    const textures = r.slots.map((s, i) => {
      const e = tab[s.role];
      if (e && e[3]) flags[e[3]] = s.uv;
      if (e && e[2]) flags[e[2]] = '@Null';
      if (e && e[5]) uvScale[e[5]] = [1, 1];
      return { Flags: ['CUBETF_AUTOMIPMAP', 'CUBETF_TRILINEAR', 'CUBETF_OWNEDBYMATERIAL', 'CUBETF_NOZBUFFERREQUIRED'],
        FrameCount: 1, MipBias: 0, MipLevels: -1, Name: s.role, ShaderPass: 0, StageType: s.srgb ? 'CUBETST_DIFFUSEMAP' : 'CUBETST_BUMPMAP',
        TexChannel: s.stage ?? i, Texture: s.tex.replace(/\.dds$/i, ''), hasDefault: true, inactive: false, runtime: false,
        AnisoLevel: 0, ChromaColor: 0, ShadowMipBias: 0,
        ...(s.anim ? { FrameCount: s.anim.frames, Rate: s.anim.rate, Method: 'CUBETAM_' + METHODS[s.anim.method], SkipFrame0: s.anim.skip0 } : {}) };
    });
    return {
      dstBlend: mat.dstBlend || 'CUBEAB_ZERO', flags: (mat.flags && mat.flags.length) ? mat.flags.slice() : ['CUBEMAT_SPECULAR', 'CUBEMAT_AMBIENTMAT', 'CUBEMAT_DIFFUSEMAT', 'CUBEMAT_SPECLARDIR'],
      name: mat.name,
      parameters: { ...(mat.gmtStd ? { StandardInfo: JSON.parse(JSON.stringify(mat.gmtStd)) } : {}), cbParameters: { Material_Adjust: { AlbedoTint: [1, 1, 1, 1], IOR: 1.5, Metallic: 0.5, NormalIntensity: 1,
        NormalShadowInfluence: 0.5, Roughness: 0.5, Specular: 1 }, UV_Scale: uvScale } },
      preprocessorFlags: flags, refName: '', shader: mat.shader, sortOffset: 0, srcBlend: mat.srcBlend || 'CUBEAB_ONE', textures,
    };
  }

  // frame of an animated texture at time t (seconds)
  function animFrame(a, t, events = true) {
    const n = a.frames, start = a.skip0 && n > 1 ? 1 : 0, m = n - start;
    if (m <= 1) return start;
    const k = Math.max(0, Math.floor(t * a.rate));
    switch (a.method) {
      case 1: return start + k % m;                                    // CYCLE
      case 2: return Math.min(start + k, n - 1);                       // ONESHOT
      case 3: { const p = 2 * m - 2, j = k % p; return start + (j < m ? j : p - j); }   // PENDULUM
      case 4: return k < m ? start + k : 0;                            // TRANSIENT
      case 5: { const h = Math.sin(k * 12.9898) * 43758.5453; return start + Math.floor((h - Math.floor(h)) * m); }
      case 6: return events ? start + k % m : 0;                       // MANUAL (game event)
      default: return 0;
    }
  }
  const frameName = (tex, i) => String(tex).split(' ')[0].replace(/\.[^.]*$/, '') + String(i).padStart(2, '0');

  return { legacyRecipe, animFrame, frameName, METHODS, METHOD_LABEL, resolve, uniforms, family, table, flatten, UNIT, FAMILIES, flagOptions, BLENDS, MATFLAGS, rangeFor, synthesize, UVS };
})();
