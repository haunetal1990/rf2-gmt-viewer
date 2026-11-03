// rF2-style sky: the analytic Preetham model that rF2's SilverLining sky uses (Weather.mas: sky.fx
// evaluates Perez(A..E) for x, y, Y, normalises against zenith/sun, blends to an overcast sky),
// plus the sun position from the track location (GDB: Latitude, Longitude, Altitude, RaceDate,
// TimezoneRelativeGMT, DSTRange) and the time of day.
'use strict';
const SKY = (() => {
  const D2R = Math.PI / 180;

  // ---------------------------------------------------------- sun position (NOAA)
  function dayOfYear(y, m, d) {
    const t = Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0);
    return Math.round(t / 86400000);
  }
  // rF2 (GDB reader): DSTRange = ( startDay , endDay , firstYear , lastYear ) - lastYear defaults to
  // 100000, firstYear to -1; of all ranges that contain the year the shortest one wins; the day is the
  // integer day of the year; start > end = southern hemisphere (DST across New Year). No range -> no DST.
  function isDST(loc, y, doy) {
    let best = null;
    for (const r of loc.dst || []) {
      if (r.length < 2 || !isFinite(r[0]) || !isFinite(r[1])) continue;
      const y0 = r[2] !== undefined && isFinite(r[2]) ? r[2] : -1, y1 = r[3] !== undefined && isFinite(r[3]) ? r[3] : 100000;
      if (y < y0 || y > y1) continue;
      if (!best || y1 - y0 <= best[3] - best[2]) best = [r[0], r[1], y0, y1];
    }
    if (!best) return false;
    const [a, b] = best;
    return a <= b ? (doy >= a && doy < b) : (doy >= a || doy < b);
  }
  // -> {az (deg from north, clockwise), el (deg), dst}
  function sunPosition(loc, date, hours) {
    const [y, m, d] = date;
    const doy = dayOfYear(y, m, d);
    const dst = isDST(loc, y, doy) ? 1 : 0;
    const tz = (loc.tz !== undefined && isFinite(loc.tz) ? loc.tz : (loc.lon || 0) / 15) + dst;   // rF2: missing TimezoneRelativeGMT = Longitude / 15
    const g = 2 * Math.PI / (y % 4 === 0 ? 366 : 365) * (doy - 1 + (hours - 12) / 24);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
      - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const tst = hours * 60 + eqt + 4 * (loc.lon || 0) - 60 * tz;          // true solar time (min)
    const ha = (tst / 4 - 180) * D2R;
    const lat = (loc.lat || 0) * D2R;
    const cz = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
    const zen = Math.acos(Math.max(-1, Math.min(1, cz)));
    let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / D2R + 180;
    return { az: (az + 360) % 360, el: 90 - zen / D2R, dst };
  }

  // ---------------------------------------------------------- Preetham
  function perez(T) {
    return {
      Y: [0.1787 * T - 1.4630, -0.3554 * T + 0.4275, -0.0227 * T + 5.3251, 0.1206 * T - 2.5771, -0.0670 * T + 0.3703],
      x: [-0.0193 * T - 0.2592, -0.0665 * T + 0.0008, -0.0004 * T + 0.2125, -0.0641 * T - 0.8989, -0.0033 * T + 0.0452],
      y: [-0.0167 * T - 0.2608, -0.0950 * T + 0.0092, -0.0079 * T + 0.2102, -0.0441 * T - 1.6537, -0.0109 * T + 0.0529],
    };
  }
  function zenith(T, ts) {
    const chi = (4 / 9 - T / 120) * (Math.PI - 2 * ts);
    const Y = Math.max(0.02, (4.0453 * T - 4.9710) * Math.tan(chi) - 0.2155 * T + 2.4192);
    const t2 = ts * ts, t3 = t2 * ts;
    const x = T * T * (0.00166 * t3 - 0.00375 * t2 + 0.00209 * ts) + T * (-0.02903 * t3 + 0.06377 * t2 - 0.03202 * ts + 0.00394)
      + (0.11693 * t3 - 0.21196 * t2 + 0.06052 * ts + 0.25886);
    const y = T * T * (0.00275 * t3 - 0.00610 * t2 + 0.00317 * ts) + T * (-0.04214 * t3 + 0.08970 * t2 - 0.04153 * ts + 0.00516)
      + (0.15346 * t3 - 0.26756 * t2 + 0.06670 * ts + 0.26688);
    return [x, y, Y];
  }
  const F = (c, ct, g, cg) => (1 + c[0] * Math.exp(c[1] / Math.max(ct, 0.01))) * (1 + c[2] * Math.exp(c[3] * g) + c[4] * cg * cg);
  function xyYtoRGB(x, y, Y) {
    if (y <= 1e-6) return [0, 0, 0];
    const X = x * Y / y, Z = (1 - x - y) * Y / y;
    return [Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z), Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z),
      Math.max(0, 0.0557 * X - 0.2040 * Y + 1.0570 * Z)];
  }

  // sun transmittance (Preetham appendix: Rayleigh + aerosol, ozone ignored) at R, G, B wavelengths
  function sunTransmittance(T, elDeg, airK = 1) {
    if (elDeg <= -1) return [0, 0, 0];
    const th = (90 - Math.max(elDeg, 0)) ;
    const m = airK / (Math.cos(th * D2R) + 0.15 * Math.pow(93.885 - th, -1.253));
    const beta = 0.04608 * T - 0.04586;
    return [0.68, 0.55, 0.45].map(l => Math.exp(-m * 0.008735 * Math.pow(l, -4.08)) * Math.exp(-m * beta * Math.pow(l, -1.3)));
  }

  // Weather.mas HDRParamTable.ini, first table ("Modified Reinhard" - rF2 reads it into the ReinhardEx slot).
  // Row = int(sun elevation) 0..90: SLum, TLum, WhtP, AirM, PrzA, PrzB, PrzC, PrzD, CldI
  const HDR = [
    [5, 3, 2.2, 3, 1, 1, 1, 1, 0.15], [5, 3, 2.2, 3, 0.99, 0.99, 0.99, 1, 0.15], [5, 3, 2.2, 2.9, 0.95, 0.95, 0.95, 1, 0.15],
    [5, 3, 2.2, 2.6, 0.9, 0.9, 0.9, 1, 0.15], [5, 3, 2.2, 2.2, 0.85, 0.85, 0.85, 1, 0.15], [5, 3, 2.2, 1.8, 0.8, 0.8, 0.8, 1, 0.15],
    [5, 3, 2.2, 1.4, 0.76, 0.76, 0.75, 1, 0.15], [5, 3, 2.2, 1.1, 0.77, 0.77, 0.7, 1, 0.15], [5, 3, 2.2, 1, 0.78, 0.78, 0.65, 1, 0.15],
    [5, 3, 2.2, 1, 0.79, 0.79, 0.6, 1, 0.15], [5, 3.5, 2.2, 1, 0.8, 0.8, 0.55, 1, 0.15], [5, 4.5, 2.2, 1, 0.81, 0.81, 0.5, 1, 0.15],
    [5, 5, 2.2, 1, 0.82, 0.82, 0.45, 1, 0.15], [5, 5, 2.2, 1, 0.83, 0.83, 0.4, 1, 0.15], [5, 5, 2.2, 1, 0.84, 0.84, 0.35, 1, 0.15],
    [5, 5, 2.2, 1, 0.85, 0.85, 0.3, 1, 0.15], [5, 5, 2.2, 1, 0.86, 0.86, 0.25, 1, 0.15], [5, 5, 2.2, 1, 0.87, 0.87, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.88, 0.88, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.89, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.9, 0.9, 0.2, 1, 0.15],
    [5, 5, 2.2, 1, 0.91, 0.91, 0.2, 1, 0.15], [5, 5, 2.2, 1, 0.92, 0.92, 0.2, 1, 0.15], [5.5, 5, 2.2, 1, 0.93, 0.93, 0.2, 1, 0.15],
    [6, 5, 2.2, 1, 0.94, 0.94, 0.2, 1, 0.15], [6.5, 5, 2.2, 1, 0.95, 0.95, 0.2, 1, 0.15], [7, 5, 2.2, 1, 0.96, 0.96, 0.2, 1, 0.15],
    [7.5, 5, 2.2, 1, 0.97, 0.97, 0.2, 1, 0.15], [8, 5, 2.2, 1, 0.98, 0.98, 0.2, 1, 0.15], [8.5, 5, 2.2, 1, 0.99, 0.99, 0.2, 1, 0.15],
    [9, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15], [9.5, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15], [10, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15],
    [10.5, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15], [11, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15], [11.05, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15],
    [12, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15], [12, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15], [12, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15],
    [12, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15], [12, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15], [12, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15],
    [12, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15], [12, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15], [12, 5, 2.2, 1, 1, 1, 0.2, 1, 0.15],
    [12, 5, 2.2, 3, 1, 1, 1, 1, 0.15],
  ];
  function hdrRow(el) {
    const e = Math.max(0, Math.min(90, el)), i = Math.floor(e), j = Math.min(90, i + 1), f = e - i;
    return HDR[i].map((v, k) => v + (HDR[j][k] - v) * f);
  }

  // weather presets (rF2 names) -> overcast blend, turbidity, sun visibility
  // oc = overcast 0..1, storm = 0..1. Turbidity like rF2 - values from ModDev\Core\Shared\ae.mas ->
  // advancedEffects.json "Atmospherics": SkyTurbidityBase 2.25 + Overcast 0.5 + Storm 0.75 + Pollution 1.25
  // (x GDB AirPollution, default 0.25), AirMassClear 1.0 / AirMassPollution 1.25
  const ATMO = { tBase: 2.25, tOvercast: 0.5, tStorm: 0.75, tPollution: 1.25, airMassClear: 1.0, airMassPollution: 1.25 };
  // ae.mas -> pplib_base_0.json "TimeOfDayProfile0..5": fTonemapSunElevation -> fTonemapTargetExposure
  const TOD = [[-5, 0.2], [2, 0.175], [5, 0.125], [10, 0.08], [30, 0.07], [55, 0.055]];
  function todExposure(el) {
    if (el <= TOD[0][0]) return TOD[0][1];
    for (let i = 1; i < TOD.length; i++) if (el <= TOD[i][0]) {
      const [e0, v0] = TOD[i - 1], [e1, v1] = TOD[i];
      return v0 + (v1 - v0) * (el - e0) / (e1 - e0);
    }
    return TOD[TOD.length - 1][1];
  }
  const WEATHER = [
    { name: 'Klar', oc: 0.0, storm: 0, sun: 1.0 },
    { name: 'Leicht bewölkt', oc: 0.15, storm: 0, sun: 0.95 },
    { name: 'Teilweise bewölkt', oc: 0.35, storm: 0, sun: 0.8 },
    { name: 'Überwiegend bewölkt', oc: 0.6, storm: 0, sun: 0.5 },
    { name: 'Bedeckt', oc: 0.9, storm: 0, sun: 0.15 },
    { name: 'Leichter Regen', oc: 0.95, storm: 0.3, sun: 0.08 },
    { name: 'Regen', oc: 1.0, storm: 0.6, sun: 0.04 },
    { name: 'Gewitter', oc: 1.0, storm: 1.0, sun: 0.02 },
  ];
  const REF_Y = zenith(2.5, 30 * D2R)[2];               // display normalisation: clear sky, sun 60° high

  // model before calibration (viewer units)
  function raw(st) {
    let w = WEATHER[Math.max(0, Math.min(WEATHER.length - 1, st.weather | 0))];
    if (st.useOvercast) { const b = Math.max(0, Math.min(1, +st.overcastBlend || 0)); w = { ...w, oc: Math.max(w.oc, b) }; }
    const pol = Math.max(0, Math.min(1, st.loc.airPollution !== undefined ? st.loc.airPollution : 0.25));
    const T = ATMO.tBase + ATMO.tOvercast * w.oc + ATMO.tStorm * w.storm + ATMO.tPollution * pol;
    const pos = sunPosition(st.loc, st.date, st.hours);
    const hdr = hdrRow(pos.el);            // SLum, TLum, WhtP, AirM, PrzA..D, CldI
    const airK = hdr[3] * (ATMO.airMassClear + (ATMO.airMassPollution - ATMO.airMassClear) * pol);
    const az = (pos.az + (st.north || 0)) * D2R, el = pos.el * D2R;
    const sunDir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const ts = Math.min(Math.PI / 2 - 0.02, Math.PI / 2 - Math.max(el, 0.02));
    const P = perez(T), Z = zenith(T, ts);
    for (let k = 0; k < 4; k++) P.Y[k] *= hdr[4 + k];      // HDRParamTable PrzA..PrzD scale the Perez luminance terms
    const F0 = [F(P.x, 1, ts, Math.cos(ts)), F(P.y, 1, ts, Math.cos(ts)), F(P.Y, 1, ts, Math.cos(ts))];
    // twilight: below the horizon the sky fades out over ~12° (civil + nautical twilight)
    const day = Math.max(0, Math.min(1, (pos.el + 12) / 14));
    const dayK = day * day * (3 - 2 * day);
    const norm = 0.32 / REF_Y * dayK;
    const ocBlend = w.oc;
    // sample the sky for the ambient (diffuse) light
    const sky = d => {
      const ct = Math.max(d[1], 0.02), cg = Math.max(-1, Math.min(1, d[0] * sunDir[0] + d[1] * sunDir[1] + d[2] * sunDir[2]));
      const g = Math.acos(cg);
      let x = Z[0] * F(P.x, ct, g, cg) / F0[0], y = Z[1] * F(P.y, ct, g, cg) / F0[1], Y = Z[2] * F(P.Y, ct, g, cg) / F0[2];
      const Yo = Z[2] * (1 + 2 * ct) / 3;
      x += (0.31 - x) * ocBlend; y += (0.316 - y) * ocBlend; Y += (Yo - Y) * ocBlend;
      return xyYtoRGB(x, y, Math.max(0, Y) * norm);
    };
    const avg = dirs => { const s = [0, 0, 0]; dirs.forEach(d => { const c = sky(d); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; });
      return s.map(v => v / dirs.length); };
    const up = avg([[0, 1, 0], [0.5, 0.7, 0.5], [-0.5, 0.7, 0.5], [0.5, 0.7, -0.5], [-0.5, 0.7, -0.5]]);
    const hor = avg([[1, 0.05, 0], [-1, 0.05, 0], [0, 0.05, 1], [0, 0.05, -1], [0.7, 0.2, 0.7], [-0.7, 0.2, -0.7]]);
    const night = 1 - dayK;
    const moon = [0.035, 0.045, 0.07];                   // moon + star light, a little blue
    const ambUp = up.map((v, i) => v * 1.7 + moon[i] * night), ambHor = hor.map((v, i) => v * 1.7 + moon[i] * 0.7 * night);
    const ground = [0.26, 0.25, 0.23];
    const ambDown = ambHor.map((v, i) => v * ground[i] * 1.2);
    // direct sun (moon at night: opposite direction, very weak)
    const tr = sunTransmittance(T, pos.el, airK);
    const hz = Math.max(0, Math.min(1, (pos.el + 0.8) / 3));
    const sunI = 3.0 * w.sun * hz;
    let sunCol = tr.map(v => v * sunI), lightDir = sunDir;
    if (sunI < 0.02) {
      const ma = az + Math.PI, me = Math.max(25 * D2R, Math.min(60 * D2R, -el));
      lightDir = [Math.cos(me) * Math.sin(ma), Math.sin(me), Math.cos(me) * Math.cos(ma)];
      sunCol = [0.10, 0.12, 0.16].map(v => v * night * w.sun ** 0.3);
    }
    // eye adaptation (rF2 uses an HDR table per sun elevation; here: limited auto exposure)
    const lum = 0.3 * (sunCol[0] + sunCol[1] + sunCol[2]) / 3 + (ambUp[0] + ambUp[1] + ambUp[2]) / 3;
    // exposure like rF2's PPLib time-of-day profiles (target exposure per sun elevation, relative to full day)
    // ...limited by the metered scene light like the PPLib auto exposure (fLightDarkExposureBorder)
    const meter = Math.max(1, Math.min(3.64, Math.pow(1.2 / Math.max(lum, 1e-3), 0.5)));
    const adapt = Math.min(todExposure(pos.el) / TOD[TOD.length - 1][1], meter);
    return { pos, sunDir, lightDir, sunCol, ambUp, ambHor, ambDown, adapt, night, dayK, moon: sunI < 0.02,
      perez: P, zenith: Z, F0, norm, overcast: ocBlend, sunDisk: w.sun * hz, T, weather: w.name, white: hdr[2], hdr };
  }

  // ---------------------------------------------------------- SilverLining sun / sky light (as used by rF2)
  // sun colour = SPCTRAL2 (Bird & Riordan 1986) on 81 wavelengths 380..780 nm -> CIE XYZ -> RGB:
  // rgb = M * XYZ * sun-transmission-scale (advancedEffects SilverliningSunTransmissionScale 6.0) * sun-luminance-scale (1.4) * 0.001 (HDR).
  // Tables: SolarSpectrum (published SPCTRAL2 extraterrestrial spectrum, resampled),
  // CIE 1931 x/y/z, ozone / mixed gas / water vapour absorption. SilverLining.config: air-mass-model SPECTRL2 (Kasten-Young),
  // atmosphere-ozone-mass 0.35, atmosphere-water-vapor-mass 2.5, ground-albedo 0.25, atmosphere-scale-height-meters 8435.
  const SL_H0 = [1097.81,1054.8,1122.86,1345.51,1523.54,1634.64,1709.12,1728.67,1709.76,1633.16,1637.16,1762.06,1870.6,1954.6,2012.6,2031.6,2031.8,2003.8,1995,2015,2000.8,1935.3,1898.6,1905.1,1912.6,1921.6,1907.8,1859.8,1843,1873,1892.4,1895.9,1896.8,1893.8,1886.8,1873.8,1860.8,1847.8,1833.74,1818.09,1802.43,1786.78,1771.29,1758.59,1746.82,1735.06,1721,1703.5,1686,1668.5,1647.69,1621.92,1596.15,1570.38,1544.62,1525.75,1527.62,1527.52,1506.22,1481.45,1456.67,1434.37,1417.9,1412.65,1407.4,1402.15,1392.75,1377.72,1373.36,1358.58,1334.54,1312.9,1293.36,1281.76,1267.98,1245.24,1223.48,1206.1,1196.2,1188.28,1179.5];
  const SL_CIE = [0.0014,0,0.0065,0.0022,0.0001,0.0105,0.0042,0.0001,0.0201,0.0076,0.0002,0.0362,0.0143,0.0004,0.0679,0.0232,0.0006,0.1102,0.0435,0.0012,0.2074,0.0776,0.0022,0.3713,0.1344,0.004,0.6456,0.2148,0.0073,1.0391,0.2839,0.0116,1.3856,0.3285,0.0168,1.623,0.3483,0.023,1.7471,0.3481,0.0298,1.7826,0.3362,0.038,1.7721,0.3187,0.048,1.7441,0.2908,0.06,1.6692,0.2511,0.0739,1.5281,0.1954,0.091,1.2876,0.1421,0.1126,1.0419,0.0956,0.139,0.813,0.058,0.1693,0.6162,0.032,0.208,0.4652,0.0147,0.2586,0.3533,0.0049,0.323,0.272,0.0024,0.4073,0.2123,0.0093,0.503,0.1582,0.0291,0.6082,0.1117,0.0633,0.71,0.0782,0.1096,0.7932,0.0573,0.1655,0.862,0.0422,0.2257,0.9149,0.0298,0.2904,0.954,0.0203,0.3597,0.9803,0.0134,0.4334,0.995,0.0087,0.5121,1,0.0057,0.5945,0.995,0.0039,0.6784,0.9786,0.0027,0.7621,0.952,0.0021,0.8425,0.9154,0.0018,0.9163,0.87,0.0017,0.9786,0.8163,0.0014,1.0263,0.757,0.0011,1.0567,0.6949,0.001,1.0622,0.631,0.0008,1.0456,0.5668,0.0006,1.0026,0.503,0.0003,0.9384,0.4412,0.0002,0.8544,0.381,0.0002,0.7514,0.321,0.0001,0.6424,0.265,0,0.5419,0.217,0,0.4479,0.175,0,0.3608,0.1382,0,0.2835,0.107,0,0.2187,0.0816,0,0.1649,0.061,0,0.1212,0.0446,0,0.0874,0.032,0,0.0636,0.0232,0,0.0468,0.017,0,0.0329,0.0119,0,0.0227,0.0082,0,0.0158,0.0057,0,0.0114,0.0041,0,0.0081,0.0029,0,0.0058,0.0021,0,0.0041,0.0015,0,0.0029,0.001,0,0.002,0.0007,0,0.0014,0.0005,0,0.001,0.0004,0,0.0007,0.0002,0,0.0005,0.0002,0,0.0003,0.0001,0,0.0002,0.0001,0,0.0002,0.0001,0,0.0001,0,0,0.0001,0,0,0.0001,0,0,0,0,0];
  const SL_KO = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.003,0.004,0.006,0.007,0.009,0.011,0.014,0.017,0.021,0.025,0.03,0.035,0.04,0.044,0.048,0.055,0.063,0.071,0.075,0.08,0.085,0.091,0.12,0.12,0.12,0.12,0.12,0.12,0.12,0.119,0.12,0.12,0.12,0.1,0.09,0.09,0.085,0.08,0.075,0.07,0.07,0.065,0.06,0.055,0.05,0.045,0.04,0.035,0.028,0.25,0.023,0.02,0.018,0.016,0.012,0.012,0.012,0.012,0.01,0.01,0.01,0.008,0.007,0.006,0.005,0.003,0];
  const SL_KG = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.15,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0];
  const SL_KW = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.075,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.016,0.015,0.014,0.013,0.0125,1.8,2.3,2.5,2.3,1.8,0.061,0.003,0.0008,0.0001,1e-05,1e-05,0.0001,0.0003,0.0006];
  const SL_M = [2.37067,-0.513885,0.00529818,-0.90004,1.4253,-0.0146949,-0.470634,0.0885814,1.0094];
  // elevation (deg), turbidity, altitude (m) -> { direct, scat } in rF2 HDR units (scat = SilverLining sky ambient)
  function slLight(elDeg, T, alt = 0) {
    const thd = 90 - elDeg;
    if (thd >= 90) return { direct: [0, 0, 0], scat: [0, 0, 0] };
    const c = Math.cos(thd * D2R);
    const m = 1 / (c + 0.50572 * Math.pow(96.07995 - thd, -1.6364)) * Math.exp(-(alt || 0) / 8435);   // air-mass-multiplier 1
    const mo = 1.003454 / Math.sqrt(c * c + 0.006908);
    const beta = 0.04608 * T - 0.04586, W = 2.5, O3 = 0.35, rg = 0.25;
    const ALG = Math.log(1 - 0.65);
    const AFS = ALG * (1.459 + ALG * (0.1595 + ALG * 0.4129)), BFS = ALG * (0.0783 + ALG * (-0.3824 - ALG * 0.5874));
    const Fs = 1 - 0.5 * Math.exp((AFS + BFS * c) * c), Fsp = 1 - 0.5 * Math.exp((AFS + BFS / 1.8) / 1.8);
    const D = [0, 0, 0], S = [0, 0, 0];
    for (let i = 0; i < 81; i++) {
      const l = 0.38 + 0.005 * i, R = Math.pow(l, 4) * (115.6406 - 1.3366 / (l * l));
      const Tr = Math.exp(-m / R), Trp = Math.exp(-1.8 / R);
      const ta = beta * Math.pow(2 * l, -(l >= 0.5 ? 1.206 : 1.0274));
      const kw = SL_KW[i], kg = SL_KG[i];
      const Tw = Math.exp(-0.2385 * kw * W * m / Math.pow(1 + 20.07 * kw * W * m, 0.45));
      const Twp = Math.exp(-0.2385 * kw * W * 1.8 / Math.pow(1 + 20.07 * kw * W * 1.8, 0.45));
      const To = Math.exp(-SL_KO[i] * O3 * mo);
      const Tu = Math.exp(-1.41 * kg * m / Math.pow(1 + 118.3 * kg * m, 0.45));
      const Tup = Math.exp(-1.41 * kg * 1.8 / Math.pow(1 + 118.3 * kg * 1.8, 0.45));
      const w = 0.945 * Math.exp(-0.095 * Math.pow(Math.log(l / 0.4), 2));
      const Ta = Math.exp(-ta * m), Tas = Math.exp(-w * ta * m), Taa = Math.exp(-(1 - w) * ta * m);
      const Tasp = Math.exp(-w * ta * 1.8), Taap = Math.exp(-(1 - w) * ta * 1.8);
      const Id = SL_H0[i] * Tr * Ta * Tw * To * Tu;
      const base = SL_H0[i] * c * To * Tu * Tw * Taa;
      const Ir = base * (1 - Math.pow(Tr, 0.95)) * 0.5, Ia = base * Math.pow(Tr, 1.5) * (1 - Tas) * Fs;
      const rs = Tup * Twp * Taap * (0.5 * (1 - Trp) + (1 - Fsp) * Trp * (1 - Tasp));
      const Ig = (Id * c + Ir + Ia) * rs * rg / (1 - rs * rg);
      const Is = (Ir + Ia + Ig) * (l <= 0.45 ? Math.pow(l + 0.55, 1.8) : 1);
      for (let k = 0; k < 3; k++) { D[k] += Id * SL_CIE[3 * i + k]; S[k] += Is * SL_CIE[3 * i + k]; }
    }
    const zb = Math.pow(thd * D2R * 0.63662, 3);                    // sunset-X/Y/Z-boost 0.10 / 0 / 0, exponent 3 (scattered)
    S[0] *= 1 + zb * 0.10;
    const rgb = (v, k) => [0, 1, 2].map(j => Math.max(0, (v[0] * SL_M[j] + v[1] * SL_M[3 + j] + v[2] * SL_M[6 + j]) * k));
    return { direct: rgb(D, 6.0 * 1.4 * 0.001), scat: rgb(S, 1.5 * 1.4 * 0.001) };   // transmission 6.0 / scattered 1.5
  }
  // ambient light mapping (advancedEffects: LightColorToAmbient 0.8, UseIntensityAsDefault true):
  // ambient = c * a + (1 - c) * |a|
  const rf2Ambient = a => { const L = Math.hypot(a[0], a[1], a[2]); return a.map(v => 0.8 * v + 0.2 * L); };

  // ---------------------------------------------------------- measured point (real gMotor 2.5 viewer, "Time / Location / Fog")
  // 2020-03-04 13:24:13 ZULU, Lat 56.8, Lon -5.1, Alt 22, AirPollution 0.10, no overcast (sun ~25.9 deg high):
  //   Direct Intensity 217.777, Direct Colour (1.000, 0.988, 0.800)   -> slLight() gives 218.6 (1, 0.988, 0.806)
  //   Ambient Intensity 13.7571, Ambient Colour (0.710, 0.824, 1.000) -> the SPCTRAL2 sky part is still bluer/darker; until
  //   that is solved the ambient gets a fixed per-channel correction that reproduces this point (AMB_FIX).
  // (ModDev viewer: Intensity = max(r, g, b, 1), Colour = rgb / Intensity.)
  const RF2_K = Math.pow(2, -4.125) / 1.5;            // rF2 HDR -> viewer units (= RF2_HDRK in renderer.js)
  const CAL = { st: { weather: 0, loc: { lat: 56.8, lon: -5.1, tz: 0, airPollution: 0.10, dst: [], alt: 22 }, date: [2020, 3, 4], hours: 13 + 24 / 60 + 13.55 / 3600 },
    amb: [13.7571 * 0.71, 13.7571 * 0.824, 13.7571] };
  let calK = null;
  function calib() {
    if (calK) return calK;
    const r = raw(CAL.st);
    const sl = slLight(r.pos.el, r.T, 22), a = rf2Ambient(sl.scat);
    // exposure compensation: the image keeps the brightness it had before the rF2 units (provisional, see compute)
    const old = [0, 1, 2].map(i => (r.ambUp[i] + r.ambHor[i]) / 2 / RF2_K);
    calK = { fix: [0, 1, 2].map(i => CAL.amb[i] / a[i]), comp: r.sunCol[1] / (sl.direct[1] * RF2_K),
      night: [0, 1, 2].map(i => CAL.amb[i] / old[i]) };
    return calK;
  }
  // everything the renderer needs for one moment (sun / ambient in viewer units, rf2Sun / rf2Amb in rF2 units)
  function compute(st) {
    const k = raw(st), c = calib();
    const el = k.pos.el, sl = slLight(el, k.T, st.loc && st.loc.alt);
    // Use Overcast: SilverLining overcast-transmission-direct (Overcast T Direct, rF2 default 0) scales the sun
    const b = st.useOvercast ? Math.max(0, Math.min(1, +st.overcastBlend || 0)) : 0;
    const tD = 1 + b * ((isFinite(st.overcastTDirect) ? +st.overcastTDirect : 0) - 1);
    const wSun = WEATHER[Math.max(0, Math.min(WEATHER.length - 1, st.weather | 0))].sun;
    const dir = sl.direct.map(v => v * wSun * tD);
    let amb = rf2Ambient(sl.scat).map((v, i) => v * c.fix[i]);
    // twilight / night (SilverLining: twilight table + moon): previous model, scaled into rF2 units, faded in below 3 deg
    const night = [0, 1, 2].map(i => (k.ambUp[i] + k.ambHor[i]) / 2 / RF2_K * c.night[i]);
    const cap = rf2Ambient(slLight(3, k.T, st.loc && st.loc.alt).scat).map((v, i) => v * c.fix[i]);   // not brighter than at 3 deg
    for (let i = 0; i < 3; i++) night[i] = Math.min(night[i], cap[i]);
    const tw = Math.max(0, Math.min(1, (3 - el) / 3));
    amb = amb.map((v, i) => v * (1 - tw) + night[i] * tw);
    k.rf2Sun = el > 0 && !k.moon ? dir : k.sunCol.map(v => v / RF2_K / c.comp);
    k.rf2Amb = amb;
    if (!k.moon) k.sunCol = dir.map(v => v * RF2_K);
    const am = [0, 1, 2].map(i => (k.ambUp[i] + k.ambHor[i]) / 2);
    const ground0 = k.ambDown.slice();
    ['ambUp', 'ambHor', 'ambDown'].forEach(n => { k[n] = k[n].map((v, i) => am[i] > 1e-9 ? v / am[i] * amb[i] * RF2_K : amb[i] * RF2_K); });
    // exposure: pplib_base_0.json TimeOfDayProfile target exposure, relative to the fixed PostProcess exposure 2^-4.125.
    // PROVISIONAL until it is clear which tone mapper rF2 uses on tracks (PPLib/YEBIS "Sensitometric" or PostProcess
    // Filmic U2): the image keeps its previous overall brightness (expoComp), only the values, ratio and colours of sun
    // and ambient are rF2's. The sky dome keeps its previous brightness as well.
    k.expoComp = c.comp;
    k.adapt = todExposure(el) / Math.pow(2, -4.125) * k.expoComp;
    k.norm /= k.expoComp;
    k.skyGround = ground0.map(v => v / k.expoComp);
    if (k.moon) k.sunCol = k.sunCol.map(v => v / k.expoComp);
    return k;
  }

  // GDB text -> location
  function parseGdb(text) {
    const loc = { dst: [] };
    const num = v => parseFloat(String(v).replace(',', '.'));
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.split('//')[0].trim();
      let m;
      if ((m = line.match(/^Latitude\s*=\s*([-+\d.,]+)/i))) loc.lat = num(m[1]);
      else if ((m = line.match(/^Longitude\s*=\s*([-+\d.,]+)/i))) loc.lon = num(m[1]);
      else if ((m = line.match(/^Altitude\s*=\s*([-+\d.,]+)/i))) loc.alt = num(m[1]);
      else if ((m = line.match(/^TimezoneRelativeGMT\s*=\s*([-+\d.,]+)/i))) loc.tz = num(m[1]);
      else if ((m = line.match(/^RaceDate\s*=\s*(.+)$/i))) loc.raceDate = m[1].trim();
      else if ((m = line.match(/^DSTRange\s*=\s*\(([^)]*)\)/i))) loc.dst.push(m[1].split(',').map(num));
      else if ((m = line.match(/^TrackName\s*=\s*(.+)$/i))) loc.name = m[1].trim();
      else if ((m = line.match(/^(AirPollution|NightLightPollution|HazeBaseScale|HazeCloudyScale|HazeDawnScale|HazeStormScale|NightLightThreshold|NorthDirection)\s*=\s*([-+\d.,]+)/i))) loc[m[1][0].toLowerCase() + m[1].slice(1)] = num(m[2]);
    }
    return loc;
  }
  // rF2: sscanf("%s %d , %d") - month = first 3 letters (Jan..Dec), then day and year; GDB default "July 5, 2007"
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function parseRaceDate(s) {
    const m = String(s || 'July 5, 2007').trim().match(/^(\S+)\s+(-?\d+)\s*,\s*(-?\d+)/);
    if (!m) return null;
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const y = Math.max(1582, +m[3]), mon = mo >= 0 ? mo + 1 : 7;
    const dim = new Date(Date.UTC(y, mon, 0)).getUTCDate();
    return [y, mon, Math.max(1, Math.min(dim, +m[2]))];
  }

  return { compute, sunPosition, parseGdb, parseRaceDate, WEATHER, RF2_K };
})();
