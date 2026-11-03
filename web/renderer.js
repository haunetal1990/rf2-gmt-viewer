// WebGL2 renderer: rF2 IBL material model (port of the CoreShaders logic used
// by the Blender importer), DDS blocks uploaded as-is (BC1-BC7), orbit / fly
// camera, picking, wireframe, ground grid.
'use strict';

// rF2 HDR units -> viewer units: advancedEffects PostProcess Exposure -4.125 (the viewer multiplies the 1.5 back in)
const RF2_HDRK = Math.pow(2, -4.125) / 1.5;
const M4 = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
    return o;
  },
  look(e, c, up) {
    let z = norm3(sub3(e, c)), x = norm3(cross3(up, z)), y = cross3(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot3(x, e), -dot3(y, e), -dot3(z, e), 1]);
  },
  inv(m) {
    const a = m, o = new Float32Array(16);
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
    const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
    const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return o;
    det = 1 / det;
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return o;
  },
};
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scl3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aTan;
layout(location=3) in vec3 aBit; layout(location=4) in vec4 aUvAB; layout(location=5) in vec4 aUvCD;
layout(location=6) in vec4 aCol;
uniform mat4 uViewProj; uniform vec3 uOffset; uniform mat4 uXf; uniform int uXfOn; uniform vec3 uDefX;   // uXf: part moved (clearance check)
uniform mat4 uBody; uniform int uBodyOn;   // whole car lifted / pitched onto its wheels (clearance check)
out vec3 vPos; out vec3 vNrm; out vec3 vTan; out vec3 vBit; out vec4 vUvAB; out vec4 vUvCD; out vec4 vCol;
void main(){
  vec3 p = aPos + uOffset; vNrm = aNrm; vTan = aTan; vBit = aBit;
  if (uXfOn == 1) { mat3 r = mat3(uXf); p = (uXf * vec4(p, 1.0)).xyz; vNrm = r * aNrm; vTan = r * aTan; vBit = r * aBit; }
  else if (uXfOn == 2) {   // suspension arm: inner end stays at the car, outer end moves with the wheel (uDefX = inner |x|, outer |x|, side)
    float w = clamp((p.x * uDefX.z - uDefX.x) / max(uDefX.y - uDefX.x, 1e-3), 0.0, 1.0);
    mat3 r = mat3(uXf); p = mix(p, (uXf * vec4(p, 1.0)).xyz, w);
    vNrm = normalize(mix(aNrm, r * aNrm, w)); vTan = mix(aTan, r * aTan, w); vBit = mix(aBit, r * aBit, w); }
  if (uBodyOn == 1) { mat3 b = mat3(uBody); p = (uBody * vec4(p, 1.0)).xyz; vNrm = b * vNrm; vTan = b * vTan; vBit = b * vBit; }
  vPos = p;
  vUvAB = aUvAB; vUvCD = aUvCD; vCol = aCol;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const ENV_GLSL = `
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform int uEnv;
// rF2 sky (env 3): Preetham / SilverLining sky.fx - Perez A..E for x, y, Y
uniform vec3 uPzA, uPzB, uPzC, uPzD, uPzE, uZen, uF0, uSkySun, uAmbUp, uAmbHor, uAmbDown, uSkyGround;
uniform float uSkyNorm, uOvercast, uNight, uWhite;   // uWhite > 0: rF2 tone mapping
// showroom (env 4): static cube map of the showroom MAS (e.g. TRACK_CUBE.DDS), DirectX/game orientation
uniform samplerCube uCube; uniform int uHasCube, uCubeManual; uniform float uCubeGain;
// rF2 showroom in HDR mode: IRRADIANCE_PROBE / REFMAP0 rendered at runtime -> uProbe = 1: uCube is our own
// linear HDR cube of the showroom (GL orientation), uSH = its irradiance (SH9, already divided by PI);
// uBake = 1 while that cube is rendered: the scene ambient (game: 11.23, 13.84, 16.23) is the only ambient light
uniform int uProbe, uBake; uniform vec3 uSH[9]; uniform vec3 uRoomAmb; uniform float uProbeLod;
uniform samplerCube uRefl; uniform int uHasRefl;   // REFMAP0 (sharp reflections, rendered at the car)
// rF2 getRefPixel / getRefDir (PShaderMacros): with doParallaxRefMap (measured in the game: on) the reflection vector is
// box projected: ray from the pixel along normalize(R) to the box cubeBBMin/cubeBBMax, lookup = hit point - cubeBBPos.
// Measured box (Frida, GlobalCBFloats_Draw): world AABB of the whole vehicle, cubeBBPos = its centre.
uniform int uBoxOn; uniform vec3 uBoxMin, uBoxMax, uBoxPos;
vec3 refBox(vec3 P, vec3 R){
  if (uBoxOn == 0) return R;
  vec3 n = normalize(R);
  vec3 r = vec3(n.x > 0.0 ? uBoxMax.x - P.x : uBoxMin.x - P.x, n.y > 0.0 ? uBoxMax.y - P.y : uBoxMin.y - P.y,
                n.z > 0.0 ? uBoxMax.z - P.z : uBoxMin.z - P.z) / n;
  float f = min(min(r.x, r.y), r.z);
  return P + n * f - uBoxPos;
}
vec3 shIrr(vec3 n){
  return max(uSH[0] + uSH[1] * n.y + uSH[2] * n.z + uSH[3] * n.x + uSH[4] * (n.x * n.y) + uSH[5] * (n.y * n.z)
    + uSH[6] * (3.0 * n.z * n.z - 1.0) + uSH[7] * (n.x * n.z) + uSH[8] * (n.x * n.x - n.y * n.y), vec3(0.0));
}
// REFMAP0 lookup of the car shaders (getRefPixel: plain texCUBE, i.e. hardware mip selection)
vec3 refMap(vec3 P, vec3 R);
vec3 cubeAt(vec3 d){
  if (uProbe == 1) return uHasRefl == 1 ? textureLod(uRefl, d, 0.0).rgb : textureLod(uCube, d, 0.0).rgb;
  vec3 c = texture(uCube, vec3(d.x, d.y, -d.z)).rgb;
  if (uCubeManual == 1) c = pow(c, vec3(2.2));
  return c * uCubeGain;
}
vec3 xyY2rgb(vec3 c){
  float Y = c.z; if (c.y <= 1e-5) return vec3(0.0);
  float X = c.x * Y / c.y, Z = (1.0 - c.x - c.y) * Y / c.y;
  return max(vec3(3.2406*X - 1.5372*Y - 0.4986*Z, -0.9689*X + 1.8758*Y + 0.0415*Z, 0.0557*X - 0.2040*Y + 1.0570*Z), 0.0);
}
vec3 rf2Sky(vec3 d){
  float ct = max(d.y, 0.02), cg = clamp(dot(d, uSkySun), -1.0, 1.0), g = acos(cg);
  vec3 F = (1.0 + uPzA * exp(uPzB / ct)) * (1.0 + uPzC * exp(uPzD * g) + uPzE * cg * cg);
  vec3 c = uZen * F / uF0;
  c = mix(c, vec3(0.31, 0.316, uZen.z * (1.0 + 2.0 * ct) / 3.0), uOvercast);
  c.z = max(c.z, 0.0) * uSkyNorm;
  vec3 col = xyY2rgb(c) + vec3(0.004, 0.006, 0.012) * uNight;
  if (d.y < 0.0) col = mix(col, uSkyGround, clamp(-d.y * 6.0, 0.0, 1.0));
  return col;
}
vec3 envGrad(vec3 d){
  if (uEnv == 3) return rf2Sky(d);
  if (uEnv == 4 && uBake == 1) return uRoomAmb;
  if (uEnv == 4 && uHasCube == 1) return cubeAt(d);
  float y = d.y;
  if (uEnv == 1 || uEnv == 4) {                       // studio: dark room + soft boxes
    vec3 c = mix(vec3(0.035), vec3(0.09), clamp(y*0.5+0.5, 0.0, 1.0));
    c += vec3(2.6) * smoothstep(0.80, 0.93, y);
    c += vec3(1.1) * smoothstep(0.93, 0.98, abs(d.x)) * smoothstep(0.45, 0.2, abs(y));
    c += vec3(0.7) * smoothstep(0.90, 0.97, -d.z) * smoothstep(0.5, 0.25, abs(y - 0.15));
    return c;
  }
  if (uEnv == 2) return mix(vec3(0.20), vec3(0.42), clamp(y*0.5+0.5, 0.0, 1.0));
  vec3 zen = vec3(0.18, 0.36, 0.72) * 1.35, hor = vec3(0.72, 0.82, 0.93) * 1.45, gnd = vec3(0.28, 0.27, 0.25) * 0.55;
  if (y > 0.0) return mix(hor, zen, pow(y, 0.55));
  return mix(hor * 0.75, gnd, pow(min(-y * 5.0, 1.0), 0.6));
}
vec3 refMap(vec3 P, vec3 R){
  if (uEnv == 4 && uProbe == 1 && uHasRefl == 1 && uBake == 0) return texture(uRefl, refBox(P, R)).rgb;
  return envGrad(R);
}
vec3 envDiffuse(vec3 n){
  if (uEnv == 3) return n.y >= 0.0 ? mix(uAmbHor, uAmbUp, n.y) : mix(uAmbHor, uAmbDown, -n.y);
  if (uEnv == 4 && uBake == 1) return uRoomAmb;
  if (uEnv == 4 && uProbe == 1) return shIrr(n);
  if (uEnv == 4 && uHasCube == 1) {                  // cosine-weighted irradiance from a few cube directions
    vec3 acc = vec3(0.0); float w = 0.0;
    vec3 D[10] = vec3[10](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1),
      normalize(vec3(1,1,1)), normalize(vec3(-1,1,-1)), normalize(vec3(1,1,-1)), normalize(vec3(-1,1,1)));
    for (int i = 0; i < 10; i++) { float k = max(dot(n, D[i]), 0.0) + 0.05; acc += cubeAt(D[i]) * k; w += k; }
    return acc / w;
  }
  if (uEnv == 1 || uEnv == 4) return mix(vec3(0.07), vec3(0.55), clamp(n.y*0.5+0.5, 0.0, 1.0));
  if (uEnv == 2) return mix(vec3(0.22), vec3(0.40), clamp(n.y*0.5+0.5, 0.0, 1.0));
  vec3 skyA = vec3(0.42, 0.56, 0.80), gndA = vec3(0.22, 0.21, 0.19);
  return mix(gndA, skyA, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
}
vec3 envSpec(vec3 r, float rough){
  if (uEnv == 4 && uProbe == 1 && uBake == 0) return textureLod(uCube, r, sqrt(clamp(rough, 0.0, 1.0)) * uProbeLod).rgb;
  return mix(envGrad(r), envDiffuse(r), clamp(rough * rough * 1.3, 0.0, 1.0));
}
vec3 envSpecRF(vec3 r, float rough){                  // rF2: texCUBElod(irradSpecular, (8 - 1) * roughness)
  if (uEnv == 4 && uProbe == 1 && uBake == 0) return textureLod(uCube, r, clamp(rough, 0.0, 1.0) * uProbeLod).rgb;
  return envSpec(r, rough);
}`;

// Sun shadow map (rF2: directional shadow map, PCF filtered; NormalShadowOffset from advancedEffects.json "Shadows")
const SHADOW_GLSL = `
uniform highp sampler2DShadow uShadow; uniform mat4 uLightVP; uniform int uShadowOn;
uniform float uShadowTexel, uShadowSoft, uNormalOffset;
float shadowAt(vec3 p, vec3 n, vec3 l){
  if (uShadowOn == 0) return 1.0;
  float ndl = clamp(dot(n, l), 0.0, 1.0);
  vec3 q = p + n * (uShadowTexel * 1.5 + uNormalOffset * (1.0 - ndl)) + l * uShadowTexel;   // normal offset + slope bias
  vec4 c = uLightVP * vec4(q, 1.0);
  vec3 s = c.xyz / c.w * 0.5 + 0.5;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0) return 1.0;
  const vec2 P[12] = vec2[12](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621),
    vec2(0.962,-0.195), vec2(0.473,-0.480), vec2(0.519,0.767), vec2(0.185,-0.893), vec2(0.507,0.064),
    vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
  float r = uShadowSoft / float(textureSize(uShadow, 0).x), acc = 0.0;
  for (int i = 0; i < 12; i++) acc += texture(uShadow, vec3(s.xy + P[i] * r, s.z - 0.0004));
  return acc / 12.0;
}`;
const SHADOW_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNrm; in vec3 vTan; in vec3 vBit; in vec4 vUvAB; in vec4 vUvCD; in vec4 vCol;
uniform sampler2D t0; uniform int uClip, uUv0; uniform vec2 uSc0;
void main(){
  if (uClip == 1) {
    vec2 uv = uUv0 == 0 ? vUvAB.xy : uUv0 == 1 ? vUvAB.zw : uUv0 == 2 ? vUvCD.xy : vUvCD.zw;
    if (texture(t0, uv * uSc0).a < 0.5) discard;
  }
}`;
// ground shadow catcher (no showroom): darkens the floor plane where the model casts its shadow
const GROUND_VS = `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uViewProj; out vec3 vPos;
void main(){ vPos = aPos; gl_Position = uViewProj * vec4(aPos, 1.0); }`;
const GROUND_FS = `#version 300 es
precision highp float; in vec3 vPos; uniform vec3 uSunDir, uCenter; uniform float uFade, uStrength;
${SHADOW_GLSL}
out vec4 frag;
void main(){
  float sh = shadowAt(vPos, vec3(0.0, 1.0, 0.0), uSunDir);
  float f = clamp(1.0 - length(vPos.xz - uCenter.xz) / uFade, 0.0, 1.0);
  frag = vec4(0.0, 0.0, 0.0, (1.0 - sh) * uStrength * f);
}`;

// rF2 under-car shadow (Irradiance.gfx, ps30_UndercarShadowGen.psh / vs30_underCarShadows.vsh), 512 x 512:
// 1. L2UnderCarShadowDepth: car seen from below, YCoord = 0.01 + saturate((y - yOffset) * 0.1)
const UC_DEPTH_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNrm; in vec3 vTan; in vec3 vBit; in vec4 vUvAB; in vec4 vUvCD; in vec4 vCol;
uniform float uY0; out vec4 frag;
void main(){ frag = vec4(0.01 + clamp((vPos.y - uY0) * 0.1, 0.0, 1.0)); }`;
// 2. L2UnderCarShadowOcclude: ps30_computeUnderCarOcclusion (horizon based, 32 directions, 1 m rays)
const UC_QUAD_VS = `#version 300 es
out vec2 vUv; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const UC_OCC_FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vUv; uniform sampler2D uDepth; uniform vec4 uCarBox; out vec4 frag;
void main(){
  const float SHADOW_TEXTURE_SIZE = 512.0, RAY_MAX_LENGTH_METERS = 1.0, START_FADE_RADIUS = 0.1, END_FADE_RADIUS = 0.5;
  const float MAX_OCCLUSION = 0.05, MONTECARLO_RANDOMISATION = 0.2, DEPTH_TO_METERS = 10.0, SKY_DEPTH_THRESHOLD = 5.0;
  const float CAR_PADDING = 0.5, DEPTH_OFFSET = 0.1, MAX_OCCLUSION_DEPTH = 0.5;
  const int HORIZON_STEPS = 32;
  float twoPi = 6.283185, deg90InRad = twoPi / 4.0;
  float uniformRandom = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  float carUVSize = uCarBox.w - uCarBox.y, paddingUVSize = 1.0 - carUVSize;
  float metersPerUV = (CAR_PADDING + CAR_PADDING) / paddingUVSize;
  float occlusion = 0.0;
  for (int i = 0; i < HORIZON_STEPS; ++i) {
    float theta = twoPi * float(i) / float(HORIZON_STEPS) + uniformRandom * MONTECARLO_RANDOMISATION;
    vec2 rayDirection = vec2(cos(theta), sin(theta));
    float rayThresholdInUVSpace = RAY_MAX_LENGTH_METERS / metersPerUV;
    float rayStepInUVSpace = 1.0 / SHADOW_TEXTURE_SIZE;
    int raySteps = int(rayThresholdInUVSpace / rayStepInUVSpace);
    float occluderAngle = -1.0, horizonVisible = 0.0, lightRegionStart = 0.0;
    bool wasUnderSky = true;
    for (int j = 0; j < 512; ++j) {
      if (j >= raySteps) break;
      float depthMeters = textureLod(uDepth, vUv + float(j) * rayStepInUVSpace * rayDirection, 0.0).r * DEPTH_TO_METERS;
      depthMeters = max(0.0, depthMeters - DEPTH_OFFSET);
      bool isUnderSky = depthMeters > SKY_DEPTH_THRESHOLD;
      depthMeters = min(depthMeters, MAX_OCCLUSION_DEPTH);
      float offsetMeters = float(j) * rayStepInUVSpace * metersPerUV;
      float horizonAngle = atan(offsetMeters / max(depthMeters, 1e-8));
      if (horizonAngle > occluderAngle) {
        if (isUnderSky) { if (!wasUnderSky) { lightRegionStart = horizonAngle; wasUnderSky = true; } }
        else { if (wasUnderSky) { horizonVisible += horizonAngle - lightRegionStart; wasUnderSky = false; } occluderAngle = horizonAngle; }
      } else if (wasUnderSky) { horizonVisible += horizonAngle - lightRegionStart; wasUnderSky = false; }
    }
    if (wasUnderSky) horizonVisible += deg90InRad - lightRegionStart;
    occlusion += clamp(horizonVisible / deg90InRad, 0.0, 1.0);
  }
  vec2 uvNearestInBox = clamp(vUv, uCarBox.xy, uCarBox.zw);
  float distanceToCarInMeters = length(uvNearestInBox - vUv) * metersPerUV;
  float distanceFade = clamp(distanceToCarInMeters - START_FADE_RADIUS, 0.0, 1.0) / (END_FADE_RADIUS - START_FADE_RADIUS);
  distanceFade *= distanceFade;
  occlusion = clamp(occlusion / float(HORIZON_STEPS) + distanceFade, 0.0, 1.0);
  frag = vec4(clamp(mix(MAX_OCCLUSION, 1.2, occlusion), 0.0, 1.0));
}`;
// 3. L2UnderCarShadowDraw_Showroom: ps30_drawUnderCarOcclusion_Showroom, black with alpha = clamp(2 (1 - occ), 0, 0.75)
//    (rF2 blends in linear HDR before tone mapping; here after it -> alpha converted with the display gamma)
const UC_DRAW_FS = `#version 300 es
precision highp float; in vec3 vPos; uniform sampler2D uOcc; uniform vec4 uBounds; out vec4 frag;
void main(){
  vec2 uv = (vPos.xz - uBounds.xy) / uBounds.zw;
  float occ = clamp(texture(uOcc, uv).a, 0.0, 1.0);
  float a = clamp(2.0 * (1.0 - occ), 0.0, 0.75);
  frag = vec4(0.0, 0.0, 0.0, 1.0 - pow(1.0 - a, 1.0 / 2.2));
}`;

const FS = `#version 300 es
precision highp float; precision highp int;
in vec3 vPos; in vec3 vNrm; in vec3 vTan; in vec3 vBit; in vec4 vUvAB; in vec4 vUvCD; in vec4 vCol;
uniform sampler2D t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11;
uniform int uHas, uSrgbManual, uNormalBC5;
uniform int uUv[12]; uniform vec2 uScale[12];
uniform int uFamily, uAlbedoFn, uBlendMode, uAlphaMode, uDebug;
uniform vec2 uDashP; uniform ivec3 uBlendFns; uniform vec4 uBaseAlbedoAlt; uniform vec2 uBaseMRAlt;   // IBLStandardBlend
uniform vec4 uOCP, uOCC; uniform vec3 uOCS;
uniform vec4 uLegDif, uLegSpc, uLegSP, uLegCF; uniform int uLegNoShadow;   // legacy CUBEMATERIAL: diffuse, specular, specPower+specFresnel, cubeMapFresnel+albedo correction   // ps30_carPaint: specPower, specFresnel Min/Max/Exp | cube Fresnel Min/Max/Exp, albedo correction | specularColour
uniform vec4 uTint, uBaseAlbedo, uEmissiveColour;
uniform float uSpecAdj, uMetalAdj, uRoughAdj, uIOR, uNormalIntensity, uBaseAO, uBaseSpec, uBaseMetal, uBaseRough;
uniform float uRoughFromAlbedoA, uDetailAlbedo, uVcolMul, uEmissiveOn, uEmissiveScalar, uBlendConst, uTerrainBias;
uniform int uLegGroups[4], uLegLerp, uReflMode, uReflLayer; uniform float uLegSpec;
uniform vec3 uCamPos; uniform float uExposure, uAmbient, uSelected; uniform vec3 uAccent;
${ENV_GLSL}
${SHADOW_GLSL}
uniform int uRecv;
out vec4 frag;
const float PI = 3.14159265;
// ---- rF2 car lights (GEN Light=Headlight/Taillight/Brakelight, Type=Spot): D3D-style spot + attenuation
uniform int uSpotN;
uniform vec4 uSpotPos[8], uSpotDir[8], uSpotCol[8], uSpotCone[8], uSpotAtt[8];
// ---- rain (procedural drop texture: xy = drop normal 0..1, a = drop life), advancedEffects.json WetBody/WetWindscreen
uniform sampler2D uRainTex; uniform float uRain; uniform int uWindscreen;
uniform int uLum, uLinearOut; uniform vec3 uLumP; uniform float uHdrK;
uniform int uMirrorTex, uMirrorSide; uniform vec3 uMirrorUv, uMirL, uMirC, uMirR;   // material MIRROR: live mirror picture, UV pan/zoom like LMIRROR_IN/CMIRROR_IN/RMIRROR_IN
// exactly like doSpotLight() in PShaderMacros_DX11.h (CoreShaders): no N.L, but the spot direction against the
// normal (smoothstep -0.175..0.1), cone pow((rho-outer)/(inner-outer), falloff), saturate(coeff / (X + d(Y + dZ))),
// linear fade to the range; the result is added to the diffuse light (omni + spot), no specular
void spotLights(vec3 P, vec3 N, vec3 V, float rough, vec3 F0, vec3 diff, out vec3 dOut, out vec3 sOut){
  dOut = vec3(0.0); sOut = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uSpotN) break;
    vec3 sd = uSpotDir[i].xyz;
    float intens = dot(-sd, N);
    if (intens <= -0.175) continue;
    vec3 sv = P - uSpotPos[i].xyz; float mag = length(sv);
    if (mag >= uSpotPos[i].w) continue;
    float rho = dot(sd, sv / max(mag, 1e-5));
    if (rho < uSpotCone[i].y) continue;
    float coeff = rho < uSpotCone[i].x ? pow(abs((rho - uSpotCone[i].y) / max(uSpotCone[i].x - uSpotCone[i].y, 1e-5)), uSpotDir[i].w) : 1.0;
    intens = smoothstep(-0.175, 0.1, intens);
    float att = clamp(coeff / (uSpotAtt[i].x + mag * (uSpotAtt[i].y + mag * uSpotAtt[i].z)), 0.0, 1.0);
    dOut += uSpotCol[i].rgb * att * (1.0 - mag / uSpotPos[i].w) * intens;
  }
}
// ---- ps30_IBLCarPaint (L2IBLCarBody) - region map driven clear coat / base coat / metallic flakes
uniform vec4 uCB[24]; uniform vec4 uCBX; uniform vec4 uCBEmis;
struct CPS { float nCC; float nBC; float bcR; float ccR; float bcS; float ccS; float flake; float metal; vec4 lac; vec4 flc; };
void cpAddB(inout CPS r, int i, float w){
  vec4 A = uCB[i*4], B = uCB[i*4+1], C = uCB[i*4+2];
  r.nCC += w * sqrt(B.x); r.nBC += w * sqrt(B.y); r.bcR += w * A.x; r.ccR += w * A.w;
  r.lac += w * C; r.bcS += w * A.y; r.ccS += w * A.z;
}
void cpAdd(inout CPS r, int i, float w){ cpAddB(r, i, w); vec4 B = uCB[i*4+1], D = uCB[i*4+3]; r.flake += w * B.w; r.metal += w * B.z; r.flc += w * D; }
void cpRefl(out float rS, out float rP, float c, float nA, float nB){
  float t = sqrt(max(0.0, 1.0 - nA * nA / nB / nB * (1.0 - c * c)));
  rS = (nA * c - nB * t) / (nA * c + nB * t + 1e-6); rS *= rS;
  rP = (nA * t - nB * c) / (nA * t + nB * c + 1e-6); rP *= rP;
}
float cpReflAvg(float c, float n){ float a, b; cpRefl(a, b, c, 1.0, n); return 0.5 * (a + b); }
float cpSchlick(float c, float r0){ return r0 + (1.0 - r0) * pow(1.0 - clamp(c, 0.0, 1.0), 5.0); }
float cpGGX(vec3 N, vec3 V, vec3 L, float rough){            // LightingFuncGGXNoFresnel_REF
  float al = max(rough * rough, 0.0004), a2 = al * al; vec3 H = normalize(V + L);
  float nl = clamp(dot(N, L), 0.0, 1.0), nv = clamp(dot(N, V), 0.0, 1.0), nh = clamp(dot(N, H), 0.0, 1.0);
  float dn = nh * nh * (a2 - 1.0) + 1.0; float D = a2 / (3.14159265 * dn * dn);
  float k = al / 2.0; float vis = 1.0 / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k));
  return nl * D * vis * 0.25;
}
float cpHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 carPaint(vec4 baseTex, vec4 aoTex, vec4 regionTex, vec4 flakeTex, bool hasFlake, vec3 N, vec3 rainNW, vec2 uv,
              vec3 P, vec3 Ls, vec3 sunCol, float shad, vec3 spotIrr, float wet, float rainA, float rainNz){
  vec4 rt = regionTex; rt.rgb = sqrt(max(rt.rgb, 0.0));
  float mx = max(max(rt.r, rt.g), rt.b), mn = min(min(rt.r, rt.g), rt.b);
  float sat = clamp((mx - mn) / max(mx, 1e-2), 0.0, 1.0);
  vec3 rgbB = clamp(rt.rgb + (sat - 1.0), 0.0, 1.0);
  float whiteB = clamp(mx - sat, 0.0, 1.0);
  float sum = rgbB.r + rgbB.g + rgbB.b + whiteB, blackB = 1.0 - sum;
  float mul = rt.a / max(sum, 1.0); rgbB *= mul; whiteB *= mul; blackB *= rt.a;
  CPS r = CPS(0.0, 0.0, 0.0, 0.1 + wet * 0.2, 0.0, 0.0, 0.0, 0.0, vec4(0.0), vec4(0.0));
  cpAdd(r, 0, blackB); cpAddB(r, 1, rgbB.r); cpAddB(r, 2, rgbB.g); cpAddB(r, 3, rgbB.b); cpAddB(r, 4, whiteB); cpAddB(r, 5, 1.0 - rt.a);
  vec3 emissive = clamp(1.25 * rgbB.g - 0.25, 0.0, 1.0) * uCBEmis.rgb * uCBX.z * 0.04;
  r.nCC *= r.nCC; r.nBC *= r.nBC;
  r.ccR = mix(r.ccR, 0.1, wet); r.ccS *= uCBX.x; r.ccS = clamp(r.ccS + wet, 0.0, 1.0);
  r.nCC = mix(r.nCC, 1.33, wet); r.nCC = max(r.nCC, 1.0); r.nBC = max(r.nBC, 1.0);
  vec3 eyeVec = normalize(P - uCamPos);
  vec3 wN = normalize(N - clamp(dot(N, eyeVec), 0.0, 1.0) * eyeVec);
  float satSun = clamp(dot(Ls, wN), 0.0, 1.0);
  vec3 refl = normalize(refBox(P, reflect(eyeVec, wN)));          // getRefDir (box projected)
  float nCCBC = (r.nBC - r.nCC) / (r.nBC + r.nCC); nCCBC *= nCCBC;
  r.lac = max(r.lac, vec4(10.0 / 255.0));
  vec3 H = normalize(refl - eyeVec); float cosF = clamp(dot(H, -eyeVec), 0.0, 1.0);
  float fS, fP; cpRefl(fS, fP, cosF, 1.0, r.nCC);
  float bcF = cpSchlick(cosF, nCCBC);
  float fSB = bcF * (1.0 - fS), fPB = bcF * (1.0 - fP);
  vec3 refCC = r.ccR > 0.1 ? envSpec(refl, r.ccR) : envGrad(refl);
  float specFres = cpReflAvg(satSun, r.nCC);
  float specCC = cpGGX(rainNW, -eyeVec, Ls, r.ccR);
  float specBC = (1.0 - specFres) * cpGGX(wN, -eyeVec, Ls, r.bcR + r.ccR);
  vec3 spn = normalize(cross(Ls, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
  vec3 prj = refl - dot(refl, spn) * spn; float sg = dot(prj, Ls); float s2 = sg * sg; float pol = s2 / (2.0 - s2);
  float pS = 0.5 - 0.5 * pol, pP = 0.5 + 0.5 * pol;
  float rCC = pP * fP + pS * fS, rBC = pP * fPB + pS * fSB;
  float occCC = cpReflAvg(satSun, r.nCC);
  float diffOcc = 1.0 - (occCC + cpSchlick(satSun, nCCBC) * (1.0 - occCC));
  vec3 specularBase = 0.5 * sunCol * shad;
  vec3 diffuseLight = sunCol * shad * satSun / 3.14159265 * diffOcc + spotIrr + emissive;
  float ambIR = 2.0 * acos(1.0 / r.nCC) / 3.14159265;
  vec3 ambientLight = aoTex.g * envDiffuse(wN) * uAmbient;
  float ambLost = 1.0 - mix(0.16, 1.0, nCCBC);
  vec3 internalRefl = (ambientLight + diffuseLight) * baseTex.rgb;
  ambientLight = ambLost * mix(ambientLight, internalRefl, ambIR);
  // metallic flakes (metalFlakes texture at UV * 8, procedural when the core texture is not there)
  vec4 ms = hasFlake ? flakeTex : vec4(cpHash(floor(uv * 2048.0)), cpHash(floor(uv * 2048.0) + 7.3), cpHash(floor(uv * 2048.0) + 3.1), 1.0);
  ms.xy = 2.0 * (ms.xy - 0.5);
  float mLow = mix(1.0, 0.25, r.flake), mPert = 0.25 * r.flake;
  float mNoise = mix(mLow, 1.0, ms.b) / (mLow + 1.0);
  float mxy = dot(ms.xy, ms.xy); float tv = sqrt(1.0 - clamp(mxy * 0.8, 0.0, 1.0));
  vec3 mN = normalize(wN + vec3(2.0 * ms.xy * tv, 1.0 - 2.0 * mxy) * mPert * (0.1 + ms.b));
  vec3 mRefl = normalize(refBox(P, reflect(eyeVec, mN)));         // getRefDir (box projected)
  vec3 refBC = r.bcR > 0.1 ? envSpec(mRefl, r.bcR) : envGrad(mRefl);
  float flakeDir = dot(mN, normalize(Ls - eyeVec)), flakeDir2 = clamp(dot(wN, -eyeVec), 0.0, 1.0);
  float soft = pow(clamp(flakeDir, 0.0, 1.0), 30.0); soft = 4.0 * soft * 31.0 / (4.0 * 3.14159265);
  float mIB = (r.nCC - 1.0) * 4.0 + 1.0; mIB = 1.0 - pow(0.8, mIB);
  vec3 softV = soft * specularBase;
  vec3 mComp = (r.lac.rgb * refBC + clamp(r.lac.rgb + mNoise, 0.0, 1.0) * softV * mNoise) * clamp(pow(flakeDir2, 2.0) * 3.0, 0.0, 1.0) * 0.5;
  mComp = mix(mComp, internalRefl * mNoise, mIB);
  float t1 = aoTex.a * baseTex.a * rBC * r.bcS;
  vec3 baseLayer = (diffuseLight + ambientLight) * baseTex.rgb + t1 * refBC + t1 * specBC * specularBase;
  float t2 = aoTex.a * rCC;
  vec3 ccLayer = t2 * refCC + t2 * specCC * specularBase;
  mComp *= r.flc.rgb;
  float depth = uCBX.y / clamp(dot(-eyeVec, wN) + 0.001, 0.0, 1.0);
  vec3 lacAbs = pow(r.lac.rgb, vec3(depth));
  baseLayer = clamp(1.1 - 0.25 * rainA * rainNz, 0.0, 1.0) * mix(baseLayer, mComp, r.metal * mNoise);
  return mix(vec3(1.0), lacAbs, r.ccS) * baseLayer + ccLayer * r.ccS;
}

bool has(int i){ return ((uHas >> i) & 1) == 1; }
vec2 uvSet(int s){
  if (s == 0) return vUvAB.xy; if (s == 1) return vUvAB.zw;
  if (s == 2) return vUvCD.xy; if (s == 3) return vUvCD.zw;
  return vec2(vPos.x, vPos.z);
}
vec4 tx(sampler2D t, int i, vec4 def){
  if (!has(i)) return def;
  vec4 c = texture(t, uvSet(uUv[i]) * uScale[i]);
  if (((uSrgbManual >> i) & 1) == 1) c.rgb = pow(c.rgb, vec3(2.2));
  return c;
}
vec3 decodeN(vec4 c){
  if (uNormalBC5 == 1) {           // rF2: xy = tex*2 - 254/255, z rebuilt
    vec2 xy = (c.rg * 2.0 - 254.0/255.0) * uNormalIntensity;
    return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
  }
  // legacy shaders: DecodeNormal_DXT1 - xy = (rg - (129, 128) / 255) * 2, z rebuilt (blue channel unused)
  vec2 xy = (c.rg - vec2(129.0, 128.0) / 255.0) * 2.0 * uNormalIntensity;
  return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}
float adjust(float v, float m){ float a = clamp(2.0*m, 0.0, 1.0), b = clamp(2.0*m - 1.0, 0.0, 1.0); float v1 = v*a; return v1 + b*(1.0 - v1); }
vec3 overlay(vec3 a, vec3 b){ vec3 lo = 2.0*a*b, hi = 1.0 - 2.0*(1.0-a)*(1.0-b); return mix(lo, hi, step(0.5, a)); }
// rF2 IBLIntegrationMap.DDS (CoreShaders, 128x128 RG8: x = scale A, y = bias B) averaged to 16x16, [roughness][N.V]
uniform vec4 uLut[128];
vec2 lutAt(int r, int c){ int i = r * 16 + c; vec4 v = uLut[i >> 1]; return (i & 1) == 0 ? v.xy : v.zw; }
vec2 rf2Lut(float nv, float r){
  float x = clamp(nv * 16.0 - 0.5, 0.0, 15.0), y = clamp(r * 16.0 - 0.5, 0.0, 15.0);
  int x0 = int(floor(x)), y0 = int(floor(y)), x1 = min(x0 + 1, 15), y1 = min(y0 + 1, 15);
  float tx = x - float(x0), ty = y - float(y0);
  return mix(mix(lutAt(y0, x0), lutAt(y0, x1), tx), mix(lutAt(y1, x0), lutAt(y1, x1), tx), ty);
}
vec2 envBRDF(float r, float nv){
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022), c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 rr = r * c0 + c1; float a004 = min(rr.x * rr.x, exp2(-9.28 * nv)) * rr.x + rr.y;
  return vec2(-1.04, 1.04) * a004 + rr.zw;
}
vec3 u2f(vec3 x){ return ((x*(0.44*x+0.1*0.5)+0.25*0.02)/(x*(0.44*x+0.5)+0.25*0.32)) - 0.02/0.32; }
// uWhite > 0: rF2 tone mapping - CoreShaders PostProcessing.h ToneMapFilmicU2 (ToneMapTechnique 7) with the
// advancedEffects.json "PostProcess" values (Shoulder 0.44, Linear 0.5, Angle 0.1, Toe 0.25, 0.02/0.32, LinearWhite 0.65, Bias 0.497)
vec3 aces(vec3 x){ if (uWhite > 0.0) return clamp(u2f(0.497 * x) / u2f(vec3(0.65)), 0.0, 1.0); return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
void main(){
  if (uMirrorTex == 1) {           // rF2 replaces the texture MIRROR by the mirror render target (already display-ready)
    vec2 muv = uvSet(uUv[0]) * uScale[0];
    // by position (preview without LMIRROR_IN ...): rF2 +x = left
    vec3 ma = uMirrorSide == 1 ? (vPos.x > 0.15 ? uMirL : vPos.x < -0.15 ? uMirR : uMirC) : uMirrorUv;
    muv = vec2((muv.x - 0.5) * ma.z + 0.5 + ma.x, (muv.y - 0.5) * ma.z + 0.5 - ma.y);
    vec3 mc = texture(t0, muv).rgb;   // sampler WRAP like the GMT stage (address U/V = 1 = D3DTADDRESS_WRAP)
    frag = vec4(uLinearOut == 1 ? pow(mc, vec3(2.2)) : mc, 1.0);
    return;
  }
  vec4 c0 = tx(t0, 0, uFamily == 4 ? vec4(0.5,0.5,0.5,0.8) : vec4(1.0));
  vec4 c1 = tx(t1, 1, uFamily == 4 ? vec4(0.5,0.5,0.5,0.8) : vec4(1.0));
  vec4 c2 = tx(t2, 2, uFamily == 4 ? vec4(0.5) : vec4(1.0));
  vec4 c3 = tx(t3, 3, uFamily == 4 ? vec4(0.0,0.0,0.0,1.0) : vec4(0.0,0.5,0.0,1.0));
  vec4 c4 = tx(t4, 4, uFamily == 4 ? vec4(0.5,0.5,0.5,0.8) : (uFamily == 7 ? vec4(1.0) : vec4(0.0,0.5,0.0,1.0)));
  vec4 c5 = tx(t5, 5, vec4(0.5,0.5,1.0,1.0));
  vec4 c6 = tx(t6, 6, vec4(0.5,0.5,1.0,1.0));
  vec4 c7 = tx(t7, 7, vec4(1.0));
  vec4 c8 = tx(t8, 8, vec4(0.5));
  vec4 c9 = tx(t9, 9, uFamily == 4 ? vec4(0.5,0.5,0.5,0.8) : vec4(1.0));
  vec4 c10 = tx(t10, 10, vec4(1.0));

  // geometry frame (derivatives outside any branch)
  vec3 N0 = normalize(vNrm); if (!gl_FrontFacing) N0 = -N0;
  vec2 nuv = uvSet(uUv[5]) * uScale[5];
  vec3 dp1 = dFdx(vPos), dp2 = dFdy(vPos); vec2 du1 = dFdx(nuv), du2 = dFdy(nuv);
  vec3 T = vTan, B = vBit;
  if (dot(T,T) < 0.01 || dot(B,B) < 0.01) {
    vec3 p2 = cross(dp2, N0), p1 = cross(N0, dp1);
    T = p2 * du1.x + p1 * du2.x; B = p2 * du1.y + p1 * du2.y;
    float im = inversesqrt(max(max(dot(T,T), dot(B,B)), 1e-20)); T *= im; B *= im;
  } else {
    T = normalize(T - N0 * dot(N0, T)); B = normalize(B - N0 * dot(N0, B));
  }

  int fam = uFamily;
  vec4 legBase = vec4(1.0);
  vec3 albedo = c0.rgb; float alpha = c0.a, spec = 1.0, ao = 1.0, metal = 0.0, rough = 0.5;
  vec3 nTS = vec3(0.0, 0.0, 1.0); bool nmap = has(5);
  if (nmap) nTS = decodeN(c5);
  if (fam == 4) {                                   // TERRAIN
    float mr = c2.r; vec4 sp = c3; float bias = max(uTerrainBias, 0.001);
    float tb = clamp((sp.r - mr) / bias, 0.0, 1.0), tc = clamp((sp.g - mr) / bias, 0.0, 1.0), td = clamp((sp.b - mr) / bias, 0.0, 1.0);
    albedo = mix(mix(mix(c0.rgb, c1.rgb, tb), c4.rgb, tc), c9.rgb, td);
    rough = mix(mix(mix(c0.a, c1.a, tb), c4.a, tc), c9.a, td);
    spec = c2.g * uSpecAdj * uSpecAdj; ao = 0.5 + 0.5 * sp.a; metal = 0.0; alpha = 1.0;
    if (has(6)) { nTS = normalize(mix(nTS, decodeN(c6), tb)); nmap = true; }
  } else if (fam == 5 || fam == 6) {                // GLASS / WATER
    rough = fam == 5 ? 0.05 : 0.02; spec = uSpecAdj * uSpecAdj;
  } else if (fam == 7) {                            // LEGACY ps30_blinn*: formula from the .gfx ShaderDesc
    vec4 Ls[4] = vec4[4](c0, c1, c4, c9);
    if (uLegLerp == 1) Ls[0] = mix(c1, c0, clamp(vCol.a, 0.0, 1.0));      // lerp(T2, T1, vertex alpha)
    else if (uLegLerp == 2) Ls[0] = mix(c0, c1, 0.5);                      // lerp(T1, T2, blendPct)
    vec4 term[4] = vec4[4](vec4(1.0), vec4(1.0), vec4(1.0), vec4(1.0));
    bool used[4] = bool[4](false, false, false, false);
    for (int i = 0; i < 4; i++) {
      int g = uLegGroups[i];
      if (g < 0 || (uLegLerp > 0 && i == 1)) continue;
      for (int j = 0; j < 4; j++) if (j == g) { term[j] *= Ls[i]; used[j] = true; }
    }
    vec4 acc = vec4(0.0);
    for (int j = 0; j < 4; j++) if (used[j]) acc += term[j];
    legBase = acc;
    albedo = acc.rgb * clamp(vCol.rgb, 0.0, 1.0); alpha = clamp(acc.a, 0.0, 1.0);
    spec = uLegSpec * (has(10) ? dot(c10.rgb, vec3(0.333)) : 0.5); rough = uLegSpec > 0.0 ? 0.35 : 0.8;
  } else if (fam == 11) {                           // ps30_dashboard: albedo = tex * vertex colour, metallic 0, specular 1, ao 1
    albedo = c0.rgb * clamp(vCol.rgb, 0.0, 1.0); alpha = c0.a * clamp(vCol.a, 0.0, 1.0);
    rough = uDashP.x; metal = 0.0; spec = 1.0; ao = 1.0;
  } else if (fam != 8) {                            // STANDARD / BLEND / VEGETATION / ROAD
    if (fam <= 1 && !has(0)) albedo = uBaseAlbedo.rgb;
    vec4 aos = c2; if (fam == 0) aos *= c10;
    float ar = aos.r, ag = aos.g;
    if (fam <= 1 && !has(2)) { ar = uBaseSpec; ag = uBaseAO; }
    spec = ar * uSpecAdj * uSpecAdj; ao = ag;
    if (fam == 2) { rough = c3.g; }
    else if (fam == 3) { rough = c0.a; alpha = 1.0; }
    else {
      metal = has(3) ? c3.r : uBaseMetal; rough = has(3) ? c3.g : uBaseRough;
      if (uRoughFromAlbedoA > 0.5) { rough = c0.a; alpha = 1.0; }
    }
    if (fam == 1) {                                 // ps30_IBLStandardBlend 1:1: blendData, ALBEDO/METALLIC/ROUGHNESS/NORMALFUNCTION
      float t = uBlendConst;                        // no BLENDMASK: rF2 blendData = 0 (function fully applied); slider = preview
      if (uBlendMode == 1) t = vCol.a; else if (uBlendMode == 2) { t = 1.0 - c0.a; alpha = 1.0; }
      else if (uBlendMode == 3) t = c9.r; else if (uBlendMode == 4) t = vCol.r; else if (uBlendMode == 5) t = 1.0 - c1.a;
      vec3 alt = has(1) ? c1.rgb : uBaseAlbedoAlt.rgb * uBaseAlbedoAlt.rgb, sel = albedo;
      if (uAlbedoFn == 1) sel = alt; else if (uAlbedoFn == 2) sel = overlay(albedo, alt);
      else if (uAlbedoFn == 3) sel = albedo * alt; else if (uAlbedoFn == 4) sel = albedo * alt * alt;
      else if (uAlbedoFn == 5) sel = albedo + alt; else if (uAlbedoFn == 6) sel = albedo - alt;
      albedo = mix(sel, albedo, t);
      // METALLICROUGHNESSALTMAP or Base_Material.*Alt; functions: 0 @Undef, 1 Switch, 2 Overlay, 3 Multiply, 4 Add, 5 Subtract
      float mA = has(4) ? c4.r : (uBlendFns.x > 0 ? uBaseMRAlt.x : 0.0);
      float rA = has(4) ? c4.g : (uBlendFns.y > 0 ? uBaseMRAlt.y : 0.0);
      if (uBlendFns.y == 2) rA = rough < 0.5 ? 2.0 * rough * rA : 1.0 - 2.0 * (1.0 - rough) * (1.0 - rA);
      else if (uBlendFns.y == 3) rA *= rough; else if (uBlendFns.y == 4) rA += rough; else if (uBlendFns.y == 5) rA -= rough;
      else if (uBlendFns.y != 1) rA = rough;
      rough = mix(rA, rough, t);
      if (uBlendFns.x == 2) mA = metal < 0.5 ? 2.0 * metal * mA : 1.0 - 2.0 * (1.0 - metal) * (1.0 - mA);
      else if (uBlendFns.x == 3) mA *= metal; else if (uBlendFns.x == 4) mA += metal;
      else if (uBlendFns.x != 1) mA -= metal;       // Subtract and (as in the shader source) @Undef: metallicAlt -= metallic
      metal = mix(mA, metal, t);
      if (has(6) && uBlendFns.z == 1) { nTS = decodeN(mix(c6, c5, t)); nmap = true; }
      else if (has(6) && uBlendFns.z == 2) {         // ComputeNormalRNM
        vec3 na = vec3(c5.rg * 2.0 - 254.0/255.0, 0.0); na.z = sqrt(max(0.0, 1.0 - dot(na.xy, na.xy)));
        vec3 nb = vec3(c6.rg * 2.0 - 254.0/255.0, 0.0); nb.z = sqrt(max(0.0, 1.0 - dot(nb.xy, nb.xy)));
        vec3 A = vec3(c5.rg, na.z) * vec3(2.0, 2.0, 2.0) + vec3(-1.0, -1.0, 0.0);
        vec3 Bn = vec3(c6.rg, nb.z) * vec3(-2.0, -2.0, 2.0) + vec3(1.0, 1.0, -1.0);
        vec3 r = normalize(A * dot(A, Bn) - Bn * A.z);
        vec3 n = mix(r, na, t); n.xy *= uNormalIntensity; nTS = normalize(n); nmap = true;
      }
    }
    if (uDetailAlbedo > 0.0 && has(8)) albedo += 2.0 * uDetailAlbedo * (c8.rgb - 0.5);
    albedo = mix(albedo, albedo * vCol.rgb, uVcolMul);
  }
  albedo = max(albedo, 0.0) * uTint.rgb * uTint.rgb;
  if (fam <= 1) metal = adjust(metal, uMetalAdj);
  if (fam <= 4) rough = adjust(rough, uRoughAdj);
  rough = clamp(rough, 0.02, 1.0); metal = fam == 1 ? metal : clamp(metal, 0.0, 1.0);   // Blend: no saturate in rF2 either
  if (uAlphaMode == 1 && alpha < 0.5) discard;

  vec3 N = nmap ? normalize(T * nTS.x + B * nTS.y + N0 * nTS.z) : N0;
  // rain drops: windscreen (UV_D, WetWindscreenLifespan 0.15 / Transparency 0.35) and car body (UV_A)
  vec4 rs = vec4(0.5, 0.5, 0.0, 0.0); float rainT = 0.0;
  if (uRain > 0.0 && (uWindscreen == 1 || fam == 9)) {
    rs = texture(uRainTex, fract(uWindscreen == 1 ? uvSet(3) * 3.0 : uvSet(0) * 6.0));
    rs.a *= uRain;
    if (uWindscreen == 1) {
      vec2 rn = (rs.xy - 0.5) * 2.0 * step(0.02, rs.a);
      N = normalize(N + T * rn.x + B * rn.y);
      rainT = clamp(clamp((rs.a - 0.15) * 10.0, 0.0, 1.0), 0.0, 2.0 * 0.35);
      ao *= mix(1.0, 0.1, rainT);
      alpha = max(alpha, clamp(0.3 * uRain * step(0.02, rs.a) + rainT, 0.0, 1.0) * 0.6);
    }
  }
  vec3 V = normalize(uCamPos - vPos);
  float NdV = max(dot(N, V), 1e-4);
  float a = rough * rough;
  float f0d = pow((uIOR - 1.0) / (uIOR + 1.0), 2.0) * spec;
  if (uWindscreen == 1) f0d = max(rainT * 0.15, f0d);
  vec3 F0 = mix(vec3(f0d), albedo, metal);
  vec3 diff = albedo * (1.0 - metal);
  vec3 L = uSunDir, H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0), NdH = max(dot(N, H), 0.0), VdH = max(dot(V, H), 0.0);
  float d = NdH * NdH * (a * a - 1.0) + 1.0;
  float D = a * a / (PI * d * d);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = NdV / (NdV * (1.0 - k) + k) * NdL / (NdL * (1.0 - k) + k);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
  float sh = uRecv == 1 ? shadowAt(vPos, N0, L) : 1.0;
  vec3 direct = (diff * (1.0 - F) / PI + D * G * F / max(4.0 * NdV * NdL, 1e-4)) * uSunCol * NdL * sh;
  vec2 AB = envBRDF(rough, NdV);
  vec3 R = reflect(-V, N);
  float specOcc = clamp(pow(NdV + ao, exp2(-16.0 * rough - 1.0)) - 1.0 + ao, 0.0, 1.0);
  vec3 ambient = (diff * envDiffuse(N) * ao + envSpec(R, rough) * (F0 * AB.x + AB.y) * specOcc) * uAmbient;
  vec3 emis = uEmissiveOn * uEmissiveColour.rgb * (has(7) ? c7.g : 1.0) * uEmissiveScalar * 0.04;
  vec3 spD, spS; spotLights(vPos, N, V, rough, F0, diff, spD, spS);
  vec3 col = direct + ambient + emis + diff * spD;
  if (fam == 11) emis = vec3(uDashP.y * (uHdrK > 0.0 ? uHdrK : 0.04));   // dashboard: constantLight = emissive (rF2 HDR units)
  if (fam <= 4 || fam == 11) {                      // rF2 doIBLLighting (IBLShared.h) 1:1, r0 from iorDefault 1.8
    const float r0 = 0.0816327;
    vec3 E = -V, Hd = normalize(L - E);
    float nl = clamp(dot(N, L), 0.0, 1.0), nv = clamp(dot(N, V), 0.0, 1.0), nh = clamp(dot(N, Hd), 0.0, 1.0);
    // diffuse: (sun * N.L * shadow + omni + spot + emissive) / PI + irradiance * ao
    vec3 dLight = (uSunCol * nl * sh + spD + emis) / PI + envDiffuse(N) * ao * uAmbient;
    vec3 dif = dLight * albedo * (1.0 - metal) * (1.0 - spec * r0);
    // direct specular: GGX without Fresnel (roughness + 0.05), Schlick on the half vector, small-edge limiter
    float fd = r0 + (1.0 - r0) * pow(1.0 - clamp(dot(Hd, -E), 0.0, 1.0), 5.0);
    vec3 dsv = uSunCol * spec * mix(vec3(fd), mix(albedo, vec3(1.0), fd), metal);
    float rr = clamp(rough + 0.05, 0.0, 1.0), al = rr * rr, a2 = al * al, kk = al * 0.5;
    float dn = nh * nh * (a2 - 1.0) + 1.0;
    float ds = nl * (a2 / (3.14159 * dn * dn)) / ((nl * (1.0 - kk) + kk) * (nv * (1.0 - kk) + kk));
    float sed = 10.0 * dot(Hd, N), gx = dFdx(sed), gy = dFdy(sed);
    float sef = clamp(sqrt(gx * gx + gy * gy), 0.0, 1.0);
    float lim = mix(1.0, 100.0, clamp(1.0 / (1.0 - 10.0 * sef), 0.0, 1.0) + rough);
    ds = min(ds, lim * lim) * sh;
    // indirect specular: irradSpecular at mip 7 * roughness, rF2 integration LUT (dielectric F0 0.08)
    vec3 Rr = normalize(reflect(E, N));
    float cd = clamp(dot(normalize(Rr - E), -E), 0.0, 1.0);
    vec2 lt = rf2Lut(cd, rough);
    vec3 csv = spec * mix(vec3(lt.y + 0.08 * lt.x), mix(albedo, vec3(1.0), lt.y), metal);
    col = dif + dsv * ds / PI + csv * envSpecRF(Rr, rough) * uAmbient;
  }
  if (fam == 5) {                                    // L2IBLGlass / L2Windscreen*: doIBLDiffuseAmbient + doIBLSpecularGlass (iorGlass 1.5)
    const float r0g = 0.04;
    vec3 E = -V, Hd = normalize(L - E);
    float nl = clamp(dot(N, L), 0.0, 1.0), nv = clamp(dot(N, V), 0.0, 1.0), nh = clamp(dot(N, Hd), 0.0, 1.0), lh = clamp(dot(L, Hd), 0.0, 1.0);
    vec3 dif = ((uSunCol * nl * sh + spD) / PI + envDiffuse(N) * ao * uAmbient) * albedo * (1.0 - spec * r0g);
    vec3 Rr = normalize(reflect(E, N));
    float cf = r0g + (1.0 - r0g) * pow(1.0 - clamp(dot(normalize(Rr - E), -E), 0.0, 1.0), 5.0);
    float al = 0.075 * 0.075, a2 = al * al, dn = nh * nh * (a2 - 1.0) + 1.0, kk = al * 0.5;
    float ggx = nl * (a2 / (PI * dn * dn)) * (r0g + (1.0 - r0g) * pow(1.0 - lh, 5.0)) / ((nl * (1.0 - kk) + kk) * (nv * (1.0 - kk) + kk));
    vec3 spc = (uSunCol * ggx * sh / PI + cf * envGrad(Rr)) * spec;
    col = dif + spc / clamp(alpha + 0.001, 0.0, 1.0);  // premultiplied for the alpha blend: reflections stay at full strength
  }
  if (fam == 9) {                                    // L2IBLCarBody (ps30_IBLCarPaint)
    vec2 rn = (rs.xy - 0.5) * 2.0 * clamp(rs.a - 0.1, 0.0, 1.0);
    float rz = sqrt(max(0.0, 1.0 - dot(rn, rn)));
    vec3 rainN = normalize(T * rn.x + B * rn.y + N0 * rz);
    float wet = clamp(8.0 * rs.a - 0.4, 0.0, 1.0);
    vec4 baseT = has(0) ? c0 : vec4(uBaseAlbedo.rgb, 1.0);
    baseT.rgb *= uTint.rgb * uTint.rgb;
    vec4 aoT = has(2) ? c2 : vec4(1.0);
    vec4 fl = texture(t11, uvSet(0) * 8.0);
    col = carPaint(baseT, aoT, has(9) ? c9 : vec4(1.0), fl, has(11), N0, rainN, uvSet(0), vPos, L, uSunCol, sh, spD, wet, rs.a, rz);
  }
  if (fam == 10) {                                   // L2CarBodyPaintWithDamage = ps30_carPaint (BumpMapSM3.gfx), 1:1
    vec4 bt = c0;
    if (uOCC.w > 0.5) {                              // !NOALBEDOCORRECT: saturate(0.015 + TransformHSV(rgb, 0, 1.2, 2.85) * 0.985)
      const float v = 2.85, vsu = 2.85 * 1.2;
      vec3 c = bt.rgb, t;
      t.r = (.299*v + .701*vsu)*c.r + (.587*v - .587*vsu)*c.g + (.114*v - .114*vsu)*c.b;
      t.g = (.299*v - .299*vsu)*c.r + (.587*v + .413*vsu)*c.g + (.114*v - .114*vsu)*c.b;
      t.b = (.299*v - .300*vsu)*c.r + (.587*v - .588*vsu)*c.g + (.114*v + .886*vsu)*c.b;
      bt.rgb = clamp(0.015 + t * 0.985, 0.0, 1.0);
    }
    bt.rgb *= uTint.rgb * uTint.rgb;
    vec4 st = has(10) ? c10 : vec4(1.0);            // sSpec (gloss / spec colour)
    vec3 E = -V, Hh = normalize(L - E);              // eyeVec = normalize(WorldPos + worldEye), worldEye = -camera
    float ndl = max(0.0, dot(L, N)) / PI;            // NdotL / PI, computeDiffuse multiplies by RCP_PI again
    vec3 dif = clamp(ndl, 0.0, 1.0) * uSunCol * sh / PI + spD / PI + envDiffuse(N) * uAmbient;
    float P = max(uOCP.x, 1.0);
    float fs = uOCP.y + uOCP.z * pow(1.0 - clamp(dot(-E, Hh), 0.0, 1.0), uOCP.w);     // computeFresnelSpecular
    vec3 spc = max(vec3(0.0), pow(max(0.0, dot(Hh, N)), P) * ((P + 8.0) / (8.0 * PI)) * uOCS * uSunCol * sh * ndl) * fs;
    vec3 cube = refMap(vPos, reflect(E, N));        // REFMAP0 (getRefPixel, box projected)
    // CUBEFRESNEL Default = (0.1, 1, 5): game shader = min(0.1 + (1 - N.V)^5, 1)
    vec3 cf = uOCC.x < 0.0 ? vec3(0.1, 1.0, 5.0) : uOCC.xyz;
    float fr = clamp(cf.x + cf.y * pow(1.0 - clamp(dot(-E, N), 0.0, 1.0), cf.z), 0.0, 1.0);  // computeFresnelReflection
    col = (bt.rgb * dif + spc * st.rgb + cube * st.rgb * bt.a * fr) * clamp(vCol.rgb, 0.0, 1.0);
  }
  if (fam == 7) {                                   // legacy ps30_blinn* (DiffuseSM3 / BumpMapSM3 / CubeMapSM3), 1:1
    vec4 bt = legBase;
    if (uLegCF.w > 0.5) {                            // correctAlbedo: 0.015 + saturate(TransformHSV(rgb, 0, 1.2, 2.5)) * 0.935
      const float v = 2.5, vsu = 2.5 * 1.2;
      vec3 c = bt.rgb, t;
      t.r = (.299*v + .701*vsu)*c.r + (.587*v - .587*vsu)*c.g + (.114*v - .114*vsu)*c.b;
      t.g = (.299*v - .299*vsu)*c.r + (.587*v + .413*vsu)*c.g + (.114*v - .114*vsu)*c.b;
      t.b = (.299*v - .300*vsu)*c.r + (.587*v - .588*vsu)*c.g + (.114*v + .886*vsu)*c.b;
      bt.rgb = 0.015 + clamp(t, 0.0, 1.0) * 0.935;
    }
    bt.rgb *= uTint.rgb * uTint.rgb;
    vec4 st = has(10) ? c10 : vec4(1.0);            // sSpec
    vec3 E = -V, Hh = normalize(L - E);
    float ndl = max(0.0, dot(L, N));
    vec3 dcol = uLegDif.rgb;
    if (uLegNoShadow == 1) { dcol *= st.a; ndl = ndl * 0.5 + 0.5; ndl *= ndl; }
    // computeDiff / computeDiffSpec: NdotL * diffuseColor * shadow / PI + (omni + spot) / PI + irradiance (IBL ambient)
    vec3 dif = clamp(ndl, 0.0, 1.0) * dcol * uSunCol * sh / PI + spD / PI + envDiffuse(N) * uAmbient;
    vec3 spc = vec3(0.0);
    if (uLegSpec > 0.0) {                            // computeSpecular * computeFresnelSpecular * spec map
      float P = max(uLegSP.x, 1.0);
      float fs = uLegSP.y + uLegSP.z * pow(1.0 - clamp(dot(-E, Hh), 0.0, 1.0), uLegSP.w);
      spc = max(vec3(0.0), pow(max(0.0, dot(Hh, N)), P) * ((P + 8.0) / (8.0 * PI)) * uLegSpc.rgb * uSunCol * sh * ndl) * fs * st.rgb;
    }
    col = bt.rgb * dif + spc;
    if (uReflMode > 0) {                             // cube map (REFMAP0 / CAR_CUBE): computeFresnelReflection
      vec3 cube = refMap(vPos, reflect(E, N));      // getRefPixel (box projected)
      float fr = clamp(uLegCF.x + uLegCF.y * pow(1.0 - clamp(dot(-E, N), 0.0, 1.0), uLegCF.z), 0.0, 1.0);
      vec4 mod1 = uReflLayer == 1 ? c1 : bt;
      if (uReflMode == 1) col += cube * st.rgb * mod1.a * fr;                       // add alpha reflect (LERPTEX: spec.rgb * tex.a)
      else if (uReflMode == 2) col += cube * mod1.rgb * fr;
      else if (uReflMode == 3) col += cube * dot(mod1.rgb, vec3(0.299, 0.587, 0.114)) * fr;
      else if (uReflMode == 4) col += cube * st.rgb * fr;
      else if (uReflMode == 5) col = mix(col, cube, clamp(bt.a * fr, 0.0, 1.0));
      else col += cube * st.rgb * fr;
    }
    col *= clamp(vCol.rgb, 0.0, 1.0);
  }
  if (fam == 8) {
    col = albedo;
    // Emissive.gfx: L2HighLumSun = ps30_noShadeUserLumT0 (tex * 75 * lerp(BaseScale, GlareScale, pow(N.V, GlareFactor))),
    // L2LowLumEmissive = ps30_noShadeLowLumT0 (8 * scene ambient * tex * vertex colour) - rF2 HDR units * uHdrK
    if (uHdrK > 0.0 && uLum == 1) col = albedo * 75.0 * mix(uLumP.x, uLumP.y, pow(clamp(NdV, 0.0, 1.0), uLumP.z)) * uHdrK;
    else if (uHdrK > 0.0 && uLum == 2 && uEnv == 4) col = 8.0 * uRoomAmb * albedo;
  }
  if (uLinearOut == 1) { frag = vec4(col, 1.0); return; }
  if (uDebug == 1) col = albedo; else if (uDebug == 2) col = N * 0.5 + 0.5; else if (uDebug == 3) col = vec3(rough);
  else if (uDebug == 4) col = vec3(metal); else if (uDebug == 5) col = vec3(ao); else if (uDebug == 6) col = vec3(spec);
  else if (uDebug == 7) { vec2 g = fract(uvSet(0) * 8.0); col = mix(vec3(0.15), vec3(0.85), step(0.5, g.x) == step(0.5, g.y) ? 1.0 : 0.0); }
  if (uDebug == 0) {
    col += uSelected * uAccent * (pow(1.0 - NdV, 2.5) * 0.7 + 0.03);
    col = aces(col * uExposure);
  } else if (uDebug == 1) col = clamp(col, 0.0, 1.0);
  else col = pow(clamp(col, 0.0, 1.0), vec3(2.2));
  float outA = uAlphaMode >= 2 ? alpha : 1.0;
  frag = vec4(pow(col, vec3(1.0 / 2.2)), outA);
}`;

const BG_VS = `#version 300 es
out vec2 vNdc; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0; vNdc = p; gl_Position = vec4(p, 0.9999, 1.0); }`;
const BG_FS = `#version 300 es
precision highp float; in vec2 vNdc; uniform mat4 uInvViewProj; uniform float uExposure;
${ENV_GLSL}
out vec4 frag;
vec3 u2f(vec3 x){ return ((x*(0.44*x+0.1*0.5)+0.25*0.02)/(x*(0.44*x+0.5)+0.25*0.32)) - 0.02/0.32; }
// uWhite > 0: rF2 tone mapping - CoreShaders PostProcessing.h ToneMapFilmicU2 (ToneMapTechnique 7) with the
// advancedEffects.json "PostProcess" values (Shoulder 0.44, Linear 0.5, Angle 0.1, Toe 0.25, 0.02/0.32, LinearWhite 0.65, Bias 0.497)
vec3 aces(vec3 x){ if (uWhite > 0.0) return clamp(u2f(0.497 * x) / u2f(vec3(0.65)), 0.0, 1.0); return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
void main(){
  vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0), b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  vec3 c;
  if (uEnv == 0) { c = envGrad(d); float s = max(dot(d, uSunDir), 0.0); c += uSunCol * (pow(s, 900.0) * 30.0 + pow(s, 12.0) * 0.18); }
  else if (uEnv == 3) {
    c = envGrad(d); float s = max(dot(d, uSkySun), 0.0);
    c += uSunCol * (1.0 - uOvercast * 0.8) * (pow(s, 1800.0) * 40.0 + pow(s, 16.0) * 0.12) * step(0.0, uSkySun.y + 0.02);
    if (uNight > 0.0 && d.y > 0.0) {                  // stars
      vec3 q = d * 300.0; vec3 id = floor(q);
      float h = fract(sin(dot(id, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float st = step(0.9965, h) * smoothstep(0.5, 0.05, length(fract(q) - 0.5)) * (1.0 - uOvercast);
      c += vec3(0.9, 0.95, 1.0) * st * uNight * 0.8 * smoothstep(0.0, 0.15, d.y);
    }
  }
  else if (uEnv == 1) { float v = length(vNdc * vec2(0.8, 1.0)); c = mix(vec3(0.075), vec3(0.018), clamp(v * 0.75, 0.0, 1.0)); }
  else c = mix(vec3(0.30), vec3(0.22), clamp(length(vNdc) * 0.7, 0.0, 1.0));
  frag = vec4(pow(aces(c * uExposure), vec3(1.0/2.2)), 1.0);
}`;
const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos; uniform mat4 uViewProj; uniform vec3 uOffset; uniform mat4 uXf; uniform int uXfOn; uniform vec3 uDefX; uniform mat4 uBody; uniform int uBodyOn; out vec3 vP;
void main(){ vP = aPos + uOffset; if (uXfOn == 1) vP = (uXf * vec4(vP, 1.0)).xyz;
  else if (uXfOn == 2) { float w = clamp((vP.x * uDefX.z - uDefX.x) / max(uDefX.y - uDefX.x, 1e-3), 0.0, 1.0); vP = mix(vP, (uXf * vec4(vP, 1.0)).xyz, w); }
  if (uBodyOn == 1) vP = (uBody * vec4(vP, 1.0)).xyz;
  gl_Position = uViewProj * vec4(vP, 1.0); }`;
const LINE_FS = `#version 300 es
precision highp float; in vec3 vP; uniform vec4 uColor; uniform vec3 uCenter; uniform float uFade; out vec4 frag;
void main(){ float f = uFade > 0.0 ? clamp(1.0 - length(vP.xz - uCenter.xz) / uFade, 0.0, 1.0) : 1.0; frag = vec4(uColor.rgb, uColor.a * f); }`;
// mirror picture: frame copy -> mirror texture, flipped left/right (mirror) and top/bottom (DX rows: v = 0 at the top)
const MIRCOPY_FS = `#version 300 es
precision highp float; in vec2 vNdc; uniform sampler2D uSrc; out vec4 frag;
void main(){ vec2 t = vNdc * 0.5 + 0.5; frag = vec4(texture(uSrc, vec2(1.0 - t.x, 1.0 - t.y)).rgb, 1.0); }`;
// TGM overlay (tyre physics nodes): coloured lines, colour per vertex
const TGM_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec4 aCol; uniform mat4 uViewProj; out vec4 vC;
void main(){ vC = aCol; gl_Position = uViewProj * vec4(aPos, 1.0); }`;
const TGM_FS = `#version 300 es
precision highp float; in vec4 vC; uniform float uAlpha; out vec4 frag;
void main(){ frag = vec4(vC.rgb, vC.a * uAlpha); }`;
// rF2 "Heat Effect" (L2BumpT0ProjNoShadow): projected frame buffer offset by the animated normal map.
// Built from the cbHeatHaze parameters of ps30_heathaze (bumpOffsetAttenuation 0.025,
// defaultTransparency 0.25, TimeScaleX 0.5 / TimeScaleY 0). The DX11 shader body itself is a stub.
const HEAT_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNrm; in vec3 vTan; in vec3 vBit; in vec4 vUvAB; in vec4 vUvCD; in vec4 vCol;
uniform sampler2D uScene, uBump; uniform int uUvSet, uHasBump; uniform vec2 uUvScale, uView, uScroll;
uniform float uTime, uAtten, uTransp, uGain;
out vec4 frag;
vec2 uvSet(int s){
  if (s == 0) return vUvAB.xy; if (s == 1) return vUvAB.zw;
  if (s == 2) return vUvCD.xy; if (s == 3) return vUvCD.zw;
  return vec2(vPos.x, vPos.z);
}
void main(){
  vec2 suv = gl_FragCoord.xy / uView;
  vec2 uv = uvSet(uUvSet) * uUvScale + uScroll * uTime;
  vec2 n = uHasBump == 1 ? texture(uBump, uv).xy * 2.0 - 1.0 : vec2(0.0);
  vec2 off = n * uAtten * uGain;
  vec3 c = texture(uScene, clamp(suv + off, vec2(0.0), vec2(1.0))).rgb;
  frag = vec4(c, 1.0 - uTransp);
}`;
const PICK_FS = `#version 300 es
precision highp float; in vec3 vPos; uniform vec4 uId; uniform int uSide; out vec4 frag;
void main(){ frag = uSide == 1 ? vec4(vPos.x > 0.15 ? 1.0 : 0.0, vPos.x < -0.15 ? 1.0 : 0.0, 0.0, 1.0) : uId; }`;   // uSide: left / right half (rF2 +x = left)
const THUMB_FS = `#version 300 es
precision highp float; in vec2 vNdc; uniform sampler2D uT; uniform int uManual; out vec4 frag;
void main(){ vec4 c = texture(uT, vNdc * 0.5 + 0.5); if (uManual == 0) c.rgb = pow(c.rgb, vec3(1.0/2.2)); frag = vec4(c.rgb, 1.0); }`;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 wird von diesem Browser nicht unterstützt.');
    this.gl = gl;
    this.ext = {
      s3tc: gl.getExtension('WEBGL_compressed_texture_s3tc'),
      s3tcSrgb: gl.getExtension('WEBGL_compressed_texture_s3tc_srgb'),
      rgtc: gl.getExtension('EXT_texture_compression_rgtc'),
      bptc: gl.getExtension('EXT_texture_compression_bptc'),
      aniso: gl.getExtension('EXT_texture_filter_anisotropic'),
    };
    this.maxAniso = this.ext.aniso ? Math.min(8, gl.getParameter(this.ext.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 0;
    this.prog = this._program(VS, FS);
    this.bgProg = this._program(BG_VS, BG_FS);
    this.lineProg = this._program(LINE_VS, LINE_FS);
    this.pickProg = this._program(VS, PICK_FS);
    this.thumbProg = this._program(BG_VS, THUMB_FS);
    this.heatProg = this._program(VS, HEAT_FS);
    this.tgmProg = this._program(TGM_VS, TGM_FS);
    this.mirCopyProg = this._program(BG_VS, MIRCOPY_FS);
    this.mirror = null;                              // {enabled, pose} - rF2 mirror camera (cockpitinfo MirrorPos)
    this.tgm = null;                                 // TGM overlay: {vao, buf, count, xray}
    this.shadowProg = this._program(VS, SHADOW_FS);
    this.groundProg = this._program(GROUND_VS, GROUND_FS);
    this.ucDepthProg = this._program(VS, UC_DEPTH_FS);
    this.ucOccProg = this._program(UC_QUAD_VS, UC_OCC_FS);
    this.ucDrawProg = this._program(GROUND_VS, UC_DRAW_FS);
    this.uni = {};
    for (const [n, p] of [['m', this.prog], ['bg', this.bgProg], ['l', this.lineProg], ['p', this.pickProg], ['t', this.thumbProg], ['h', this.heatProg],
      ['s', this.shadowProg], ['g', this.groundProg],
      ['tg', this.tgmProg], ['mc', this.mirCopyProg], ['ucd', this.ucDepthProg], ['uco', this.ucOccProg], ['ucw', this.ucDrawProg]]) this.uni[n] = this._uniforms(p);
    gl.useProgram(this.prog);
    for (let i = 0; i < 12; i++) gl.uniform1i(this.uni.m['t' + i], i);
    gl.uniform4fv(this.uni.m.uLut, new Float32Array([0.1276,0.7909,0.3668,0.6075,0.5565,0.4298,0.6979,0.293,0.8007,0.1927,0.8737,0.1221,0.9233,0.07286,0.9561,0.04087,0.9768,0.02157,0.989,0.008824,0.9957,0.002941,0.9996,0,1,0,1,0,1,0,1,0,0.1589,0.6195,0.348,0.5385,0.5336,0.402,0.6765,0.2804,0.7819,0.1872,0.8577,0.1191,0.9103,0.07187,0.9458,0.04038,0.9683,0.02151,0.9825,0.008946,0.9907,0.002941,0.9955,0,0.9983,0,0.9999,0,1,0,1,0,0.2379,0.4968,0.3446,0.4325,0.5075,0.3491,0.645,0.255,0.7518,0.1752,0.8308,0.114,0.8869,0.06998,0.9262,0.04001,0.9526,0.02157,0.9701,0.009926,0.9811,0.003064,0.9882,0,0.9928,0,0.9961,0,0.9985,0,1,0,0.3452,0.4097,0.3748,0.3329,0.4952,0.2813,0.6149,0.217,0.7159,0.1555,0.7947,0.1046,0.854,0.06642,0.897,0.03928,0.9282,0.02145,0.9498,0.01029,0.9646,0.003799,0.9749,0,0.9821,0,0.9877,0,0.9922,0,0.9963,0,0.4566,0.3362,0.4315,0.2589,0.5056,0.218,0.5972,0.174,0.6832,0.1297,0.7567,0.09087,0.8155,0.05987,0.8612,0.03664,0.8953,0.02065,0.9201,0.01042,0.9386,0.004412,0.9529,0.0001225,0.9644,0,0.9737,0,0.9816,0,0.988,0,0.5571,0.2725,0.5009,0.2039,0.5352,0.1681,0.5958,0.1347,0.6615,0.1036,0.7226,0.07525,0.7745,0.05147,0.8176,0.03309,0.8535,0.01961,0.8831,0.01023,0.9062,0.004779,0.9249,0.000674,0.94,0,0.952,0,0.9626,0,0.9719,0,0.6413,0.2184,0.5691,0.1623,0.5741,0.1301,0.6066,0.1042,0.649,0.08088,0.6917,0.06005,0.735,0.0424,0.7755,0.02837,0.8098,0.0174,0.8392,0.009681,0.864,0.004596,0.8851,0.0009804,0.9034,0,0.9195,0,0.9334,0,0.9459,0,0.7085,0.1744,0.6294,0.1295,0.6124,0.1018,0.6203,0.08045,0.6402,0.06207,0.671,0.04694,0.7026,0.03364,0.7344,0.02298,0.7646,0.01464,0.7926,0.008824,0.8174,0.004105,0.8395,0.0009804,0.8591,0,0.8763,0,0.8922,0,0.9066,0,0.7608,0.1393,0.6781,0.1031,0.6439,0.07996,0.6318,0.06201,0.6404,0.04792,0.6569,0.03615,0.6785,0.02629,0.7013,0.01826,0.7242,0.01189,0.7463,0.006985,0.767,0.003922,0.786,0.0004902,0.8046,0,0.8222,0,0.8382,0,0.8539,0,0.8003,0.1118,0.7143,0.0826,0.6653,0.06317,0.6448,0.04841,0.6419,0.03683,0.6479,0.02776,0.6583,0.0201,0.6708,0.01409,0.6848,0.009252,0.699,0.005392,0.714,0.003493,0.7296,0,0.745,0,0.7596,0,0.7743,0,0.7887,0,0.8284,0.09056,0.7388,0.06673,0.6808,0.05,0.6549,0.03811,0.6433,0.0288,0.6385,0.02138,0.6381,0.01544,0.6408,0.01066,0.6454,0.00723,0.6532,0.003983,0.6623,0.002145,0.6713,0,0.6815,0,0.6921,0,0.7029,0,0.7142,0,0.8483,0.07433,0.7524,0.05392,0.692,0.04001,0.6605,0.03015,0.6399,0.02243,0.6259,0.01636,0.6165,0.01183,0.6103,0.008088,0.609,0.004779,0.6084,0.003799,0.6099,0.0003676,0.6129,0,0.6169,0,0.622,0,0.6276,0,0.634,0,0.8614,0.06158,0.7584,0.04406,0.6971,0.03241,0.6598,0.0239,0.6312,0.01752,0.6091,0.01268,0.5922,0.008701,0.5806,0.005821,0.5705,0.003922,0.5633,0.0019,0.5585,0,0.5551,0,0.5529,0,0.552,0,0.5521,0,0.5531,0,0.8693,0.0519,0.7595,0.03634,0.6963,0.02623,0.6526,0.019,0.6175,0.01366,0.5885,0.00962,0.5667,0.006924,0.5474,0.003983,0.5317,0.003248,0.5192,0.0001225,0.5081,0,0.4988,0,0.4912,0,0.4846,0,0.4793,0,0.4749,0,0.873,0.0443,0.7564,0.03015,0.6904,0.02151,0.6401,0.01526,0.5983,0.01078,0.5657,0.007598,0.5371,0.00435,0.513,0.00386,0.4927,0.0008578,0.4743,0,0.4584,0,0.4448,0,0.4325,0,0.4214,0,0.4116,0,0.4027,0,0.8733,0.03836,0.7498,0.02537,0.679,0.01759,0.6229,0.01225,0.5763,0.008333,0.5383,0.005392,0.5059,0.003922,0.4775,0.001961,0.4521,0,0.4306,0,0.4111,0,0.3934,0,0.3775,0,0.3631,0,0.3501,0,0.3382,0]));
    gl.uniform1i(this.uni.m.uShadow, 12); gl.uniform1i(this.uni.m.uCube, 13); gl.uniform1i(this.uni.m.uRainTex, 14);
    this.carLights = [];                             // GEN Light= spots, GL coordinates
    this.lightsOn = { head: false, brake: false, rain: false, reverse: false, warning: false };
    this.rain = 0;
    // rF2: spotRGB = Color / 255 * Intensity, cone = cos(Hotspots / 2) in degrees,
    // falloff + attenuation as in the GEN. rF2 shows the frame with Exposure 2^-4.125 (advancedEffects.json
    // PostProcess), the viewer with ~1.5 -> rF2 light units x 0.038 in viewer units
    this.spotScale = Math.pow(2, -4.125) / 1.5;
    gl.useProgram(this.bgProg); gl.uniform1i(this.uni.bg.uCube, 13);
    gl.useProgram(this.groundProg); gl.uniform1i(this.uni.g.uShadow, 12);
    gl.useProgram(this.shadowProg); gl.uniform1i(this.uni.s.t0, 0);
    this.showroom = null;                            // {sunDir, sunCol, clear, cube} while a showroom is shown
    this.shadowSize = 2048;
    this.white = this._solid([255, 255, 255, 255]);
    this.parts = new Map();
    this.textures = new Map();
    this.onTexture = null;
    this.selected = -1;
    this.timeFn = () => performance.now() / 1000;   // set by the app (texture animation clock)
    this.heatGain = 3;                               // shimmer strength x rF2 bumpOffsetAttenuation (1 = raw value, barely visible)
    this.fly = { speed: 1, look: 1, smooth: 0, v: null };
    this.settings = { env: 0, sunAz: 35, sunEl: 40, exposure: 1, ambient: 1, grid: true, cull: false, faceOrient: false, wire: false, debug: 0, shadows: true };
    this.cam = { target: [0, 0, 0], dist: 5, yaw: 0.75, pitch: 0.32, fov: 40 * Math.PI / 180, mode: 'orbit' };
    this.scene = { min: [-1, -1, -1], max: [1, 1, 1] };
    this.keys = new Set();
    this.dirty = true;
    this.accent = [0.31, 0.70, 0.85];
    this._grid = null;
    this._lastT = performance.now();
    this._bindInput();
    const loop = t => { this._frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- GL utils
  _shader(type, src) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  _program(vs, fs) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this._shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, this._shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  _uniforms(p) {
    const gl = this.gl, out = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      out[name] = gl.getUniformLocation(p, info.name);
    }
    return out;
  }
  _solid(rgba) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    return t;
  }
  requestRender() { this.dirty = true; }

  // ---------------------------------------------------------------- meshes
  addPart(buf) {
    const gl = this.gl, dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x4d324652) throw new Error('ungültige Mesh-Daten');
    const jl = dv.getUint32(4, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl)));
    let off = 8 + jl;
    const vc = meta.vertexCount, ic = meta.indexCount;
    const take = (Type, n, comps) => {
      const bytes = n * comps * Type.BYTES_PER_ELEMENT;
      const arr = new Type(buf.slice(off, off + bytes));
      off += bytes + ((4 - bytes % 4) % 4);
      return arr;
    };
    const pos = take(Float32Array, vc, 3), nrm = take(Float32Array, vc, 3), tan = take(Float32Array, vc, 3),
      bit = take(Float32Array, vc, 3), uv = take(Float32Array, vc, 8), col = take(Uint8Array, vc, 4), idx = take(Uint32Array, ic, 1);
    this.removePart(meta.partId);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bufs = [];
    const attr = (loc, data, size, type = gl.FLOAT, normalized = false, stride = 0, offset = 0, b = null) => {
      if (!b) { b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); bufs.push(b); }
      else gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, normalized, stride, offset);
      return b;
    };
    attr(0, pos, 3); attr(1, nrm, 3); attr(2, tan, 3); attr(3, bit, 3);
    const ub = attr(4, uv, 4, gl.FLOAT, false, 32, 0); attr(5, null, 4, gl.FLOAT, false, 32, 16, ub);
    attr(6, col, 4, gl.UNSIGNED_BYTE, true);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const part = { id: meta.partId, meta, vao, bufs, ib, idx, pos, visible: true, groups: meta.groups.map(g => ({ ...g, mat: null })),
      center: meta.bboxMin.map((v, i) => (v + meta.bboxMax[i]) / 2), wire: null };
    this.parts.set(meta.partId, part);
    this.requestRender();
    return part;
  }
  removePart(id) {
    const p = this.parts.get(id);
    if (!p) return;
    const gl = this.gl;
    gl.deleteVertexArray(p.vao); p.bufs.forEach(b => gl.deleteBuffer(b)); gl.deleteBuffer(p.ib);
    if (p.wire) { gl.deleteVertexArray(p.wire.vao); gl.deleteBuffer(p.wire.ib); }
    this.parts.delete(id);
    this.requestRender();
  }
  clear() { [...this.parts.keys()].forEach(id => this.removePart(id)); this.selected = -1; }
  setVisible(id, v) { const p = this.parts.get(id); if (p) { p.visible = v; this.requestRender(); } }

  _wire(p) {
    if (p.wire) return p.wire;
    const gl = this.gl, idx = p.idx, seen = new Set(), out = [];
    const vc = p.meta.vertexCount;
    for (let i = 0; i < idx.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        let a = idx[i + k], b = idx[i + (k + 1) % 3];
        if (a > b) [a, b] = [b, a];
        const key = a * vc + b;
        if (!seen.has(key)) { seen.add(key); out.push(a, b); }
      }
    }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, p.bufs[0]); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(out), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    p.wire = { vao, ib, count: out.length };
    return p.wire;
  }

  // -------------------------------------------------------------- textures
  texture(name, srgb, path = null) {
    const stem = String(path || name || '').split(/[\\/]/).pop().split(' ')[0].toLowerCase().replace(/\.[^.]*$/, '');
    if (stem === 'mirror' || stem === 'mirror_tonemapped') return this._mirrorEntry();
    const key = (path ? 'p:' + path : 'n:' + name).toLowerCase() + (srgb ? '|s' : '|l');
    let e = this.textures.get(key);
    if (!e) {
      e = { key, name, path, srgb, status: 'loading', tex: null, manual: false, info: '', users: 0 };
      this.textures.set(key, e);
      this._load(e);
    }
    return e;
  }
  // texture drawn on the page (cockpit displays) - re-uploaded on every change
  canvasTexture(key, canvas, srgb = true) {
    const gl = this.gl;
    let e = this.textures.get(key);
    if (!e) { e = { key, name: key, path: null, srgb, status: 'ok', tex: this._newTex(), manual: false, info: 'Display', users: 0 }; this.textures.set(key, e); }
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    this._filter(1 + Math.floor(Math.log2(Math.max(canvas.width, canvas.height))));
    e.w = canvas.width; e.h = canvas.height; e.info = 'Display ' + canvas.width + '×' + canvas.height;
    this.requestRender();
    return e;
  }
  reloadPath(path) {
    for (const e of this.textures.values()) {
      if (e.path && e.path.toLowerCase() === path.toLowerCase()) { e.status = 'loading'; this._load(e); }
    }
  }
  async _load(e) {
    const q = e.path && e.key.startsWith('p:') ? 'path=' + encodeURIComponent(e.path) : 'name=' + encodeURIComponent(e.name);
    try {
      const r = await fetch('/api/tex?' + q);
      if (!r.ok) { e.status = 'missing'; e.info = (await r.json().catch(() => ({}))).error || 'nicht gefunden'; return this._texDone(e); }
      e.path = JSON.parse(r.headers.get('X-Tex-Path') || 'null') || e.path;
      const kind = r.headers.get('X-Tex-Kind');
      const buf = await r.arrayBuffer();
      if (kind === 'dds') {
        let dds = null;
        try { dds = DDS.parse(buf); } catch (err) { e.info = err.message; }
        if (dds && this._uploadDDS(e, dds)) return this._texDone(e);
        const r2 = await fetch('/api/texpng?path=' + encodeURIComponent(e.path));
        if (!r2.ok) { e.status = 'error'; e.info = (await r2.json().catch(() => ({}))).error || e.info || 'Format nicht darstellbar'; return this._texDone(e); }
        await this._uploadImage(e, await r2.blob());
        e.info = (dds ? dds.format + ' ' + dds.width + '×' + dds.height : 'DDS') + ' · per CPU dekodiert';
      } else {
        await this._uploadImage(e, new Blob([buf]));
      }
      this._texDone(e);
    } catch (err) {
      e.status = 'error'; e.info = String(err.message || err); this._texDone(e);
    }
  }
  _texDone(e) { this.requestRender(); if (this.onTexture) this.onTexture(e); }
  _newTex() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }
  _filter(levels) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, Math.max(0, levels - 1));
    if (this.maxAniso) gl.texParameterf(gl.TEXTURE_2D, this.ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, this.maxAniso);
  }
  _uploadDDS(e, d) {
    const gl = this.gl, x = this.ext;
    let fmt = null, manual = false;
    const want = e.srgb;
    if (d.compressed) {
      const f = d.format;
      if ((f === 'BC1' || f === 'BC2' || f === 'BC3') && x.s3tc) {
        const lin = { BC1: x.s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, BC2: x.s3tc.COMPRESSED_RGBA_S3TC_DXT3_EXT, BC3: x.s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT }[f];
        if (want && x.s3tcSrgb) fmt = { BC1: x.s3tcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT, BC2: x.s3tcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT, BC3: x.s3tcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT }[f];
        else { fmt = lin; manual = want; }
      } else if ((f === 'BC4' || f === 'BC4S' || f === 'BC5' || f === 'BC5S') && x.rgtc) {
        fmt = { BC4: x.rgtc.COMPRESSED_RED_RGTC1_EXT, BC4S: x.rgtc.COMPRESSED_SIGNED_RED_RGTC1_EXT,
          BC5: x.rgtc.COMPRESSED_RED_GREEN_RGTC2_EXT, BC5S: x.rgtc.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT }[f];
        manual = want;
      } else if ((f === 'BC7' || f === 'BC6H' || f === 'BC6HS') && x.bptc) {
        if (f === 'BC7') fmt = want ? x.bptc.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT : x.bptc.COMPRESSED_RGBA_BPTC_UNORM_EXT;
        else fmt = f === 'BC6H' ? x.bptc.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT : x.bptc.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;
      }
      if (!fmt) { e.info = d.format + ': GPU-Format im Browser nicht verfügbar'; return false; }
      if (d.width % 4 || d.height % 4) { e.info = 'Größe kein Vielfaches von 4'; return false; }
      const t = this._newTex();
      let levels = 0;
      try {
        for (const m of d.mips) { gl.compressedTexImage2D(gl.TEXTURE_2D, levels, fmt, m.w, m.h, 0, m.data); levels++; }
      } catch (err) { gl.deleteTexture(t); e.info = String(err); return false; }
      if (gl.getError() !== gl.NO_ERROR) { gl.deleteTexture(t); e.info = 'Upload fehlgeschlagen'; return false; }
      this._filter(levels);
      this._swap(e, t, manual, d.format + ' ' + d.width + '×' + d.height + (levels > 1 ? ' · ' + levels + ' Mips' : ''), d.width, d.height);
      return true;
    }
    // 32-bit
    const t = this._newTex();
    let levels = 0;
    for (const m of d.mips) {
      let px = m.data;
      if (d.format.startsWith('BGR')) {
        px = new Uint8Array(m.data);
        for (let i = 0; i < px.length; i += 4) { const b = px[i]; px[i] = px[i + 2]; px[i + 2] = b; }
      }
      if (d.format.endsWith('X8')) { px = px === m.data ? new Uint8Array(m.data) : px; for (let i = 3; i < px.length; i += 4) px[i] = 255; }
      gl.texImage2D(gl.TEXTURE_2D, levels, want ? gl.SRGB8_ALPHA8 : gl.RGBA8, m.w, m.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      levels++;
    }
    if (levels === 1) { gl.generateMipmap(gl.TEXTURE_2D); levels = 1 + Math.floor(Math.log2(Math.max(d.width, d.height))); }
    this._filter(levels);
    this._swap(e, t, false, d.format + ' ' + d.width + '×' + d.height, d.width, d.height);
    return true;
  }
  async _uploadImage(e, blob) {
    const gl = this.gl;
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const t = this._newTex();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, e.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.generateMipmap(gl.TEXTURE_2D);
    this._filter(1 + Math.floor(Math.log2(Math.max(bmp.width, bmp.height))));
    this._swap(e, t, false, e.info || ('Bild ' + bmp.width + '×' + bmp.height), bmp.width, bmp.height);
    bmp.close && bmp.close();
  }
  _swap(e, t, manual, info, w, h) {
    if (e.tex) this.gl.deleteTexture(e.tex);
    e.tex = t; e.manual = manual; e.status = 'ok'; e.info = info; e.w = w; e.h = h;
    this.texVersion = (this.texVersion || 0) + 1;
  }
  thumbnail(e, size = 48) {
    if (!e || e.status !== 'ok') return null;
    const gl = this.gl;
    if (!this._thumbFbo) {
      this._thumbFbo = gl.createFramebuffer();
      this._thumbTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._thumbTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._thumbFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._thumbTex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._thumbFbo);
    gl.viewport(0, 0, size, size);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.thumbProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.uniform1i(this.uni.t.uT, 0);
    gl.uniform1i(this.uni.t.uManual, e.srgb && !e.manual ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8ClampedArray(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const img = new ImageData(size, size);
    for (let y = 0; y < size; y++) img.data.set(px.subarray(y * size * 4, (y + 1) * size * 4), y * size * 4);   // v=0 top (DX)
    this.requestRender();
    return img;
  }

  // ----------------------------------------------------------------- camera
  sceneBounds(onlyIds = null) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], n = 0;
    for (const p of this.parts.values()) {
      if (onlyIds ? !onlyIds.includes(p.id) : (!p.visible || p.env)) continue;
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.meta.bboxMin[i]); hi[i] = Math.max(hi[i], p.meta.bboxMax[i]); }
      n++;
    }
    if (!n) return null;
    return { min: lo, max: hi };
  }
  focus(onlyIds = null, keepAngle = true) {
    const b = this.sceneBounds(onlyIds) || this.sceneBounds();
    if (!b) return;
    const c = b.min.map((v, i) => (v + b.max[i]) / 2);
    const r = Math.max(0.05, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2);
    this.cam.target = c;
    const asp = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const f = Math.min(this.cam.fov, 2 * Math.atan(Math.tan(this.cam.fov / 2) * asp));
    this.cam.dist = r / Math.sin(f / 2) * 1.05;
    if (!keepAngle) { this.cam.yaw = 0.75; this.cam.pitch = 0.3; }
    this._updateScene();
    this.requestRender();
  }
  _updateScene() {
    const b = this.sceneBounds() || { min: [-1, -1, -1], max: [1, 1, 1] };
    this.scene = b;
    this._grid = null;
  }
  eye() {
    const c = this.cam, cp = Math.cos(c.pitch);
    return add3(c.target, scl3([cp * Math.sin(c.yaw), Math.sin(c.pitch), cp * Math.cos(c.yaw)], c.dist));
  }
  _matrices() {
    const w = this.canvas.width, h = this.canvas.height, c = this.cam;
    const b = this.scene, r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2 || 1;
    const near = Math.max(0.002, Math.min(c.dist * 0.02, r * 0.05));
    const far = c.dist + r * 40 + 500;
    if (this.camView) {                     // looking through an rF2 camera (.cam)
      const v = this.camView;
      const proj = M4.persp(v.fovY, v.aspect || w / Math.max(1, h), Math.max(0.01, v.near), Math.max(v.far, 10));
      const view = M4.look(v.eye, add3(v.eye, v.dir), v.up);
      return { vp: M4.mul(proj, view), eye: v.eye };
    }
    const proj = M4.persp(c.fov, w / Math.max(1, h), near, far);
    const eye = this.eye();
    const view = M4.look(eye, c.target, [0, 1, 0]);
    return { vp: M4.mul(proj, view), eye };
  }

  // k < 1 = closer, k > 1 = farther (orbit: distance, fly: move along the view)
  zoomBy(k) {
    if (this.camView) return;
    const c = this.cam;
    if (c.mode === 'fly') {
      const eye = this.eye(), fwd = norm3(sub3(c.target, eye));
      c.target = add3(c.target, scl3(fwd, (1 - k) * Math.max(c.dist, 0.5) * 2));
    } else c.dist = Math.max(0.01, c.dist * k);
    this.requestRender();
  }

  _bindInput() {
    const cv = this.canvas;
    let drag = null;
    cv.addEventListener('contextmenu', ev => ev.preventDefault());
    cv.addEventListener('pointerdown', ev => {
      cv.focus();
      if (this.camView) { if (this.onCamViewInput) this.onCamViewInput(); return; }
      cv.setPointerCapture(ev.pointerId);
      drag = { x: ev.clientX, y: ev.clientY, b: ev.button, shift: ev.shiftKey, ctrl: ev.ctrlKey || ev.metaKey, moved: 0 };
    });
    cv.addEventListener('pointermove', ev => {
      if (!drag) return;
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      drag.x = ev.clientX; drag.y = ev.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
      const c = this.cam;
      const fly = c.mode === 'fly';
      if (drag.ctrl && drag.b === 0) {               // Ctrl + left drag = zoom (Blender style)
        this.zoomBy(Math.exp(dy * 0.006));
        return;
      }
      if ((drag.b === 0 && !drag.shift && !fly) || (fly && (drag.b === 2 || drag.b === 0))) {
        if (fly) {                                   // look around the eye
          const eye = this.eye();
          const ls = 0.004 * (this.fly.look || 1);
          c.yaw -= dx * ls; c.pitch = Math.max(-1.55, Math.min(1.55, c.pitch + dy * ls));
          const cp = Math.cos(c.pitch);
          c.target = sub3(eye, scl3([cp * Math.sin(c.yaw), Math.sin(c.pitch), cp * Math.cos(c.yaw)], c.dist));
        } else {
          c.yaw -= dx * 0.006; c.pitch = Math.max(-1.55, Math.min(1.55, c.pitch + dy * 0.006));
        }
      } else {                                       // pan
        const eye = this.eye(), fwd = norm3(sub3(c.target, eye));
        const right = norm3(cross3(fwd, [0, 1, 0])), up = cross3(right, fwd);
        const s = c.dist * 2 * Math.tan(c.fov / 2) / Math.max(1, cv.clientHeight);
        c.target = add3(c.target, add3(scl3(right, -dx * s), scl3(up, dy * s)));
      }
      this.requestRender();
    });
    const end = ev => {
      if (!drag) return;
      const d = drag; drag = null;
      // a click may wobble a few pixels (mouse / pen / high DPI); right click is often pressed with a small movement
      if (d.moved < 6 && d.b === 0 && !d.ctrl && this.onPick) this.onPick(this.pick(ev.clientX, ev.clientY), ev);
      if (d.moved < 10 && d.b === 2 && this.onContext) this.onContext(this.pick(ev.clientX, ev.clientY), ev);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', () => { drag = null; });
    cv.addEventListener('dblclick', ev => { if (this.onDoublePick) this.onDoublePick(this.pick(ev.clientX, ev.clientY)); });
    cv.addEventListener('wheel', ev => {
      ev.preventDefault();
      if (this.camView) return;
      this.zoomBy(Math.exp(Math.sign(ev.deltaY) * Math.min(Math.abs(ev.deltaY), 200) * 0.0012));
    }, { passive: false });
    window.addEventListener('keydown', ev => {
      if (ev.target.closest && ev.target.closest('input,textarea,select')) return;
      this.keys.add(ev.code);
      this._shift = ev.shiftKey; this._ctrl = ev.ctrlKey;
    });
    window.addEventListener('keyup', ev => { this.keys.delete(ev.code); this._shift = ev.shiftKey; this._ctrl = ev.ctrlKey; });
    window.addEventListener('blur', () => this.keys.clear());
    new ResizeObserver(() => this.requestRender()).observe(cv);
  }

  // fly camera: this.fly = { speed: multiplier, look: mouse multiplier, smooth: 0..1 (ease in / out, for videos) }
  _flyStep(dt) {
    const c = this.cam, F = this.fly;
    if (c.mode !== 'fly' || this.camView) { F.v = null; return false; }
    const eye = this.eye(), fwd = norm3(sub3(c.target, eye)), right = norm3(cross3(fwd, [0, 1, 0]));
    let mv = [0, 0, 0];
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) mv = add3(mv, fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) mv = sub3(mv, fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) mv = add3(mv, right);
    if (k.has('KeyA') || k.has('ArrowLeft')) mv = sub3(mv, right);
    if (k.has('KeyE') || k.has('PageUp')) mv = add3(mv, [0, 1, 0]);
    if (k.has('KeyQ') || k.has('PageDown')) mv = sub3(mv, [0, 1, 0]);
    const b = this.scene, r = Math.max(0.5, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2);
    const speed = r * 0.5 * (F.speed || 1) * (this._shift ? 4 : 1) * (this._ctrl ? 0.2 : 1);
    const want = dot3(mv, mv) ? scl3(norm3(mv), speed) : [0, 0, 0];
    let v = want;
    if (F.smooth > 0) {                              // velocity follows the keys with a time constant -> soft start / stop
      const tau = 0.05 + F.smooth * 0.6, a = 1 - Math.exp(-dt / tau);
      const v0 = F.v || [0, 0, 0];
      v = add3(v0, scl3(sub3(want, v0), a));
      if (!dot3(want, want) && dot3(v, v) < 1e-8) v = [0, 0, 0];
    }
    F.v = v;
    if (!dot3(v, v)) return false;
    c.target = add3(c.target, scl3(v, dt));
    return true;
  }

  // ------------------------------------------------------------------ draw
  _frame(t) {
    const dt = Math.min(0.1, (t - this._lastT) / 1000); this._lastT = t;
    if (this._flyStep(dt)) this.dirty = true;
    const cv = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; this.dirty = true; }
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  }
  _rf2Sky() {
    const st = this.settings.sky;
    if (this.settings.env !== 3 || !st || typeof SKY === 'undefined') return null;
    const key = JSON.stringify(st);
    if (this._skyKey !== key) { this._skyKey = key; this._sky = SKY.compute(st); if (this.onSky) this.onSky(this._sky); }
    return this._sky;
  }
  _skyUniforms(u, k) {
    const gl = this.gl, P = k.perez, ch = i => [P.x[i], P.y[i], P.Y[i]];
    gl.uniform3fv(u.uPzA, ch(0)); gl.uniform3fv(u.uPzB, ch(1)); gl.uniform3fv(u.uPzC, ch(2));
    gl.uniform3fv(u.uPzD, ch(3)); gl.uniform3fv(u.uPzE, ch(4));
    gl.uniform3fv(u.uZen, k.zenith); gl.uniform3fv(u.uF0, k.F0); gl.uniform3fv(u.uSkySun, k.sunDir);
    gl.uniform3fv(u.uAmbUp, k.ambUp); gl.uniform3fv(u.uAmbHor, k.ambHor); gl.uniform3fv(u.uAmbDown, k.ambDown); gl.uniform3fv(u.uSkyGround, k.skyGround || k.ambDown);
    gl.uniform1f(u.uSkyNorm, k.norm); gl.uniform1f(u.uOvercast, k.overcast); gl.uniform1f(u.uNight, k.night);
  }
  _sun() {
    if (this.settings.env === 4 && this.showroom) return { dir: this.showroom.sunDir, col: this.showroom.sunCol, room: this.showroom };
    const k = this._rf2Sky();
    if (k) return { dir: k.lightDir, col: k.sunCol, sky: k };
    const s = this.settings, az = s.sunAz * Math.PI / 180, el = s.sunEl * Math.PI / 180;
    const dir = norm3([Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]);
    const warm = Math.max(0, 1 - s.sunEl / 25);
    const base = s.env === 1 ? 1.6 : s.env === 2 ? 1.8 : 3.0;
    const col = [base, base * (0.96 - 0.15 * warm), base * (0.9 - 0.35 * warm)];
    return { dir, col };
  }
  draw() {
    if (!this._inMirror) this._mirrorPass();
    const gl = this.gl, s = this.settings;
    const { vp, eye } = this._matrices();
    const sun = this._sun();
    const sh = this._shadowPass(sun);
    if (sun.room) this._bakeProbe(sun, sh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const cc = sun.room ? (sun.room.clearT || sun.room.clear) : [0.08, 0.09, 0.1];
    gl.clearColor(cc[0], cc[1], cc[2], 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const room = sun.room;
    gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_CUBE_MAP, room && room.probe ? room.probe.tex : room && room.cube && room.cube.tex ? room.cube.tex : this._blackCube());
    gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, this._shadowTex());
    gl.activeTexture(gl.TEXTURE0);
    // background
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.bgProg);
    const ub = this.uni.bg;
    gl.uniformMatrix4fv(ub.uInvViewProj, false, M4.inv(vp));
    // showroom (HDR mode): fixed exposure like advancedEffects PostProcess (AutoExposure 0, Exposure -4.125) -> RF2_HDRK * 1.5
    const expo = s.exposure * (sun.sky ? sun.sky.adapt * 1.5 : sun.room ? 1.5 : 1);
    const white = sun.sky ? sun.sky.white : sun.room ? 1 : 0;   // Filmic U2 (rF2) needs more light than ACES for the same mid grey
    gl.uniform3fv(ub.uSunDir, sun.dir); gl.uniform3fv(ub.uSunCol, sun.col); gl.uniform1i(ub.uEnv, s.env);
    gl.uniform1f(ub.uExposure, expo); gl.uniform1f(ub.uWhite, white);
    if (sun.sky) this._skyUniforms(ub, sun.sky);
    this._cubeUniforms(ub, room);
    if (!room) gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL);
    if (s.grid && !room) this._drawGrid(vp);
    if (sh && !room && !s.debug) this._drawGroundShadow(vp, sun, sh);

    // meshes
    gl.useProgram(this.prog);
    const u = this.uni.m;
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniform3fv(u.uCamPos, eye); gl.uniform3fv(u.uSunDir, sun.dir); gl.uniform3fv(u.uSunCol, sun.col);
    gl.uniform1i(u.uEnv, s.env); gl.uniform1f(u.uExposure, expo); gl.uniform1f(u.uAmbient, s.ambient); gl.uniform1f(u.uWhite, white);
    gl.uniform1f(u.uHdrK, sun.sky || sun.room ? RF2_HDRK : 0); gl.uniform1i(u.uLinearOut, 0);
    if (sun.sky) this._skyUniforms(u, sun.sky);
    this._cubeUniforms(u, room);
    this._shadowUniforms(u, sh);
    this._spotUniforms(u);
    gl.uniform1f(u.uRain, this.rain || 0);
    gl.activeTexture(gl.TEXTURE14); gl.bindTexture(gl.TEXTURE_2D, this._rainTex()); gl.activeTexture(gl.TEXTURE0);
    gl.uniform3fv(u.uAccent, this.accent); gl.uniform1i(u.uDebug, s.debug);
    const opaque = [], blended = [], heat = [];
    for (const p of this.parts.values()) {
      if (!p.visible || p.reflectOnly) continue;
      for (const g of p.groups) {
        if (g.mat && g.mat.gpu && g.mat.gpu.heat) { heat.push([p, g]); continue; }   // drawn last, needs the finished frame
        const am = g.mat && g.mat.gpu ? g.mat.gpu.u.alphaMode : 0;
        (am >= 2 ? blended : opaque).push([p, g]);
      }
    }
    if (s.wire) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1); }
    gl.disable(gl.BLEND);
    for (const [p, g] of opaque) this._drawGroup(p, g);
    if (room && !s.debug) { this._drawUnderCar(vp); if (s.wire) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1); } }
    gl.useProgram(this.prog);
    if (blended.length) {
      blended.sort((a, b) => dot3(sub3(b[0].center, eye), sub3(b[0].center, eye)) - dot3(sub3(a[0].center, eye), sub3(a[0].center, eye)));
      gl.enable(gl.BLEND); gl.depthMask(false);
      for (const [p, g] of blended) {
        if (g.mat.gpu.u.alphaMode === 3) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this._drawGroup(p, g);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    if (heat.length && !s.debug) this._drawHeat(heat, vp, eye);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (s.wire) {
      gl.useProgram(this.lineProg);
      const ul = this.uni.l;
      gl.uniformMatrix4fv(ul.uViewProj, false, vp); gl.uniform1f(ul.uFade, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const p of this.parts.values()) {
        if (!p.visible || p.reflectOnly) continue;
        const wv = this._wire(p);
        this._off(ul, p);
        gl.uniform4fv(ul.uColor, p.id === this.selected ? [0.31, 0.70, 0.85, 0.9] : [0.85, 0.9, 0.95, 0.35]);
        gl.bindVertexArray(wv.vao);
        gl.drawElements(gl.LINES, wv.count, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.BLEND);
    }
    if (this.tgmGhost && this.tgmGhost.length && !this.clean) {        // TGM preview: tyre + rim as see-through wire frame
      gl.useProgram(this.lineProg);
      const ul = this.uni.l;
      gl.uniformMatrix4fv(ul.uViewProj, false, vp); gl.uniform1f(ul.uFade, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const id of this.tgmGhost) {
        const p = this.parts.get(id);
        if (!p) continue;
        const wv = this._wire(p);
        this._off(ul, p);
        gl.uniform4fv(ul.uColor, [0.85, 0.9, 0.95, 0.22]);
        gl.bindVertexArray(wv.vao);
        gl.drawElements(gl.LINES, wv.count, gl.UNSIGNED_INT, 0);
      }
      gl.disable(gl.BLEND);
    }
    if (this.tgm && this.tgm.count && this.tgm.visible && !this.clean) this._drawTgm(vp);
    if (this.marks && this.marks.count && !this.camView && !this.clean) this._drawMarks(vp);
    if (this.gizmos && this.gizmos.length && !this.camView && !this.clean) this._drawGizmos(vp);
    gl.bindVertexArray(null);
  }
  // copy of the finished frame (MSAA default framebuffer -> single-sample texture)
  _grabScene() {
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height;
    let g = this._grab;
    if (!g || g.w !== w || g.h !== h) {
      if (g) { gl.deleteTexture(g.tex); gl.deleteFramebuffer(g.fb); }
      g = this._grab = { w, h, tex: gl.createTexture(), fb: gl.createFramebuffer(), fmt: this._grabFmt || 0 };
      gl.bindTexture(gl.TEXTURE_2D, g.tex);
      const f = [gl.RGB8, gl.RGBA8][g.fmt % 2];
      gl.texStorage2D(gl.TEXTURE_2D, 1, f, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, g.fb);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g.tex, 0);
    }
    while (gl.getError() !== gl.NO_ERROR) { /* clear */ }
    if (g.fmt < 2) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, g.fb);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (gl.getError() !== gl.NO_ERROR) {           // format mismatch: RGB8 -> RGBA8 -> copyTexSubImage
        this._grabFmt = g.fmt + 1; gl.deleteTexture(g.tex); gl.deleteFramebuffer(g.fb); this._grab = null;
        return this._grabScene();
      }
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, g.tex);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    }
    return g.tex;
  }
  _drawHeat(list, vp, eye) {
    const gl = this.gl, u = this.uni.h;
    const scene = this._grabScene();
    gl.useProgram(this.heatProg);
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniform2f(u.uView, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, this.timeFn());
    gl.uniform1f(u.uAtten, 0.025); gl.uniform1f(u.uTransp, 0.25); gl.uniform2f(u.uScroll, 0.5, 0.0);
    gl.uniform1f(u.uGain, this.heatGain);
    gl.uniform1i(u.uScene, 0); gl.uniform1i(u.uBump, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    list.sort((a, b) => dot3(sub3(b[0].center, eye), sub3(b[0].center, eye)) - dot3(sub3(a[0].center, eye), sub3(a[0].center, eye)));
    for (const [p, g] of list) {
      const gpu = g.mat.gpu, slot = gpu.heatUnit >= 0 ? gpu.units[gpu.heatUnit] : null, e = slot && slot.entry;
      gl.activeTexture(gl.TEXTURE1);
      const ok = e && e.status === 'ok';
      gl.bindTexture(gl.TEXTURE_2D, ok ? e.tex : this.white);
      gl.uniform1i(u.uHasBump, ok ? 1 : 0);
      gl.uniform1i(u.uUvSet, slot ? slot.uv : 0);
      gl.uniform2fv(u.uUvScale, slot ? slot.scale : [1, 1]);
      this._off(u, p);
      gl.bindVertexArray(p.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, g.start * 4);
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(this.prog);
    if (!this._heatTick) this._heatTick = setTimeout(() => { this._heatTick = 0; this.dirty = true; }, 33);   // ~30 fps shimmer, only while visible
  }
  // ---------------------------------------------------------------- mirrors
  // rF2: one picture from the mirror camera (cockpitinfo MirrorPos, default 64 x 14 degrees) is rendered into the
  // texture MIRROR; every material using it shows its part of the picture through its UVs.
  _mirrorEntry() {
    if (!this._mirEnt) {
      const gl = this.gl, W = 1024, H = 256, tex = gl.createTexture(), fb = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0.05, 0.05, 0.06, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      // live picture of the mirror camera (own target: the glass may show the test card, the screen mirror is always live)
      const lt = gl.createTexture(), lf = gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D, lt);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, lf);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lt, 0);
      this._mirLive = { tex: lt, fb: lf };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._mirEnt = { key: 'mirror:rt', name: 'MIRROR', path: null, srgb: false, status: 'ok', tex, fb, w: W, h: H,
        manual: false, info: 'Spiegel (live) ' + W + '×' + H, users: 0, isMirror: true };
      this.textures.set(this._mirEnt.key, this._mirEnt);
    }
    return this._mirEnt;
  }
  // test card instead of the live picture (canvas, row 0 = top = DX v 0)
  mirrorTestCard(canvas) {
    const gl = this.gl, e = this._mirrorEntry();
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, e.w, e.h, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this._mirrorSig = 'test';
    this.requestRender();
  }
  _mirrorPass() {
    const m = this.mirror, e = this._mirEnt;
    if (!m || !m.pose || !e) return;
    const glass = [];
    let vis = 0;
    for (const p of this.parts.values()) {
      if (!p.visible) continue;
      vis++;
      if (p.groups.some(g => g.mat && g.mat.gpu && g.mat.gpu.units[0] && g.mat.gpu.units[0].entry === e)) glass.push(p);
    }
    const toGlass = m.enabled && !m.test && glass.length > 0;
    if (!toGlass && !m.overlay) return;             // nobody shows the live picture
    const s = this.settings;
    const sig = JSON.stringify([m.pose, !!m.showCar, toGlass, !!m.overlay, vis, this.parts.size, this.texVersion || 0, s.env, s.sunAz, s.sunEl, s.exposure, s.ambient,
      s.sky, this.lightsOn, this.rain, this.showroom ? 1 : 0, this.canvas.width, this.canvas.height, this._mirrorBump || 0]);
    if (sig === this._mirrorSig) return;
    const keep = { camView: this.camView, gizmos: this.gizmos, tgm: this.tgm ? this.tgm.visible : null, wire: s.wire, sel: this.selected };
    this._inMirror = true;
    try {
      for (const p of glass) p.visible = false;     // the mirror does not see itself
      if (!m.showCar) for (const p of this.parts.values()) if (p.visible && !p.env) { p.visible = false; glass.push(p); }   // in rF2 the own car is not in the mirror
      this.camView = m.pose; this.gizmos = []; if (this.tgm) this.tgm.visible = false; s.wire = false; this.selected = null;
      this.draw();
      const src = this._grabScene();
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._mirLive.fb);
      gl.viewport(0, 0, e.w, e.h);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.useProgram(this.mirCopyProg);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform1i(this.uni.mc.uSrc, 0);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (this.onMirror && m.overlay) {
        const px = new Uint8Array(e.w * e.h * 4);
        gl.readPixels(0, 0, e.w, e.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        try { this.onMirror(px, e.w, e.h); } catch (err) { /* ignore */ }
      }
      if (toGlass) {                                // live picture -> texture MIRROR on the glass
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._mirLive.fb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, e.fb);
        gl.blitFramebuffer(0, 0, e.w, e.h, 0, 0, e.w, e.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.DEPTH_TEST);
    } finally {
      for (const p of glass) p.visible = true;
      this.camView = keep.camView; this.gizmos = keep.gizmos; if (this.tgm) this.tgm.visible = keep.tgm; s.wire = keep.wire; this.selected = keep.sel;
      this._inMirror = false;
    }
    this._mirrorSig = sig;
  }
  // TGM overlay: pos = Float32Array xyz (GL), col = Float32Array rgba, line list
  // offset of a part + its transform (clearance check moves wheels: p.xf = column-major 4x4 or null)
  _off(u, p) {
    const gl = this.gl;
    gl.uniform3fv(u.uOffset, p.meta.position);
    if (u.uBodyOn) {
      gl.uniform1i(u.uBodyOn, this.bodyXf ? 1 : 0);
      if (this.bodyXf) gl.uniformMatrix4fv(u.uBody, false, this.bodyXf);
    }
    if (!u.uXfOn) return;
    if (p.xf) {
      gl.uniform1i(u.uXfOn, p.xfDef ? 2 : 1); gl.uniformMatrix4fv(u.uXf, false, p.xf);
      if (p.xfDef && u.uDefX) gl.uniform3fv(u.uDefX, p.xfDef);
    } else gl.uniform1i(u.uXfOn, 0);
  }
  // def = [inner |x|, outer |x|, side +1/-1]: blend from the car (inner) to the wheel transform (outer)
  // whole car (clearance: car stands on its wheels) - column-major 4x4 or null
  setBodyXf(m) { this.bodyXf = m ? new Float32Array(m) : null; this.requestRender(); }
  setPartXf(id, m, def) {
    const p = this.parts.get(id);
    if (!p) return;
    p.xf = m ? new Float32Array(m) : null;
    p.xfDef = m && def ? new Float32Array(def) : null;
    this.requestRender();
  }
  // markers drawn on top of everything (clearance contacts): pos / col per line vertex
  setMarks(pos, col) {
    const gl = this.gl;
    if (!this.marks) {
      const vao = gl.createVertexArray(), pb = gl.createBuffer(), cb = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.marks = { vao, pb, cb, count: 0 };
    }
    const m = this.marks;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.bufferData(gl.ARRAY_BUFFER, pos || new Float32Array(0), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.cb); gl.bufferData(gl.ARRAY_BUFFER, col || new Float32Array(0), gl.DYNAMIC_DRAW);
    m.count = pos ? pos.length / 3 : 0;
    this.requestRender();
  }
  _drawMarks(vp) {
    const gl = this.gl, m = this.marks, u = this.uni.tg;
    gl.useProgram(this.tgmProg);
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.bindVertexArray(m.vao);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST); gl.uniform1f(u.uAlpha, 0.45); gl.drawArrays(gl.LINES, 0, m.count);   // hidden part faint
    gl.enable(gl.DEPTH_TEST); gl.uniform1f(u.uAlpha, 1.0); gl.drawArrays(gl.LINES, 0, m.count);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  setTgm(pos, col, opts = {}) {
    const gl = this.gl;
    if (!this.tgm) {
      const vao = gl.createVertexArray(), pb = gl.createBuffer(), cb = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.tgm = { vao, pb, cb, count: 0, visible: true, xray: true };
    }
    const t = this.tgm;
    if (pos) {
      gl.bindBuffer(gl.ARRAY_BUFFER, t.pb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, t.cb); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW);
      t.count = pos.length / 3;
    }
    if (opts.visible !== undefined) t.visible = !!opts.visible;
    if (opts.xray !== undefined) t.xray = !!opts.xray;
    if (opts.front !== undefined) t.front = !!opts.front;
    this.requestRender();
  }
  _drawTgm(vp) {
    const gl = this.gl, t = this.tgm, u = this.uni.tg;
    gl.useProgram(this.tgmProg);
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.bindVertexArray(t.vao);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (t.front) {                                  // preview while editing: every line fully visible
      gl.disable(gl.DEPTH_TEST);
      gl.uniform1f(u.uAlpha, 1.0);
      gl.drawArrays(gl.LINES, 0, t.count);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
      return;
    }
    if (t.xray) {                                   // hidden lines (inside the tyre GMT) dimmed
      gl.disable(gl.DEPTH_TEST);
      gl.uniform1f(u.uAlpha, 0.32);
      gl.drawArrays(gl.LINES, 0, t.count);
      gl.enable(gl.DEPTH_TEST);
    }
    gl.depthFunc(gl.LEQUAL);
    gl.uniform1f(u.uAlpha, 1.0);
    gl.drawArrays(gl.LINES, 0, t.count);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
  _drawGizmos(vp) {
    const gl = this.gl;
    const b = this.scene, r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2 || 1;
    const L = Math.max(0.15, Math.min(0.6, r * 0.12));
    gl.useProgram(this.lineProg);
    const ul = this.uni.l;
    gl.uniformMatrix4fv(ul.uViewProj, false, vp); gl.uniform3fv(ul.uOffset, [0, 0, 0]); if (ul.uXfOn) gl.uniform1i(ul.uXfOn, 0); if (ul.uBodyOn) gl.uniform1i(ul.uBodyOn, 0); gl.uniform1f(ul.uFade, 0);
    if (!this._gizBuf) { this._gizVao = gl.createVertexArray(); this._gizBuf = gl.createBuffer();
      gl.bindVertexArray(this._gizVao); gl.bindBuffer(gl.ARRAY_BUFFER, this._gizBuf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); }
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    for (const gz of this.gizmos) {
      if (gz.point) {                                   // cross marker (Eyepoint, CameraTarget)
        const q = gz.point, h = L * 0.35, pts = [];
        for (const ax of [[h, 0, 0], [0, h, 0], [0, 0, h]]) pts.push(...sub3(q, ax), ...add3(q, ax));
        gl.bindVertexArray(this._gizVao); gl.bindBuffer(gl.ARRAY_BUFFER, this._gizBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
        gl.uniform4fv(ul.uColor, gz.color);
        gl.drawArrays(gl.LINES, 0, 6);
        continue;
      }
      const v = gz.pose;
      if (this.camView && this.camView === v) continue;
      const right = norm3(cross3(v.dir, v.up)), up = cross3(right, v.dir);
      const asp = v.aspect || this.canvas.width / Math.max(1, this.canvas.height);
      const th = Math.tan(v.fovY / 2) * L, tw = th * asp;
      const c = add3(v.eye, scl3(v.dir, L));
      const k = [add3(add3(c, scl3(right, -tw)), scl3(up, th)), add3(add3(c, scl3(right, tw)), scl3(up, th)),
        add3(add3(c, scl3(right, tw)), scl3(up, -th)), add3(add3(c, scl3(right, -tw)), scl3(up, -th))];
      const tip = add3(c, scl3(up, th * 1.6));
      const pts = [];
      for (let i = 0; i < 4; i++) pts.push(...v.eye, ...k[i], ...k[i], ...k[(i + 1) % 4]);
      pts.push(...add3(c, scl3(up, th)), ...tip);
      if (v.target) pts.push(...v.eye, ...v.target);
      gl.bindVertexArray(this._gizVao); gl.bindBuffer(gl.ARRAY_BUFFER, this._gizBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
      gl.uniform4fv(ul.uColor, gz.color);
      gl.drawArrays(gl.LINES, 0, pts.length / 3);
    }
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  }
  // ------------------------------------------------------------- shadows
  _shadowTex() {
    const gl = this.gl;
    if (!this._sm) {
      const tex = gl.createTexture(), fb = gl.createFramebuffer(), n = this.shadowSize;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, n, n);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._sm = { tex, fb, n };
    }
    return this._sm.tex;
  }
  _blackCube() {
    const gl = this.gl;
    if (!this._bcube) {
      this._bcube = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, this._bcube);
      for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    }
    return this._bcube;
  }
  // casters: every visible opaque / alpha-tested group of the model (not the showroom, not FX / blended)
  _shadowPass(sun) {
    const gl = this.gl, s = this.settings;
    if (!s.shadows || sun.dir[1] < 0.03 || dot3(sun.col, [1, 1, 1]) < 0.02) return null;
    const casters = [];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of this.parts.values()) {
      if (!p.visible || p.env || p.noCast) continue;
      let any = false;
      for (const g of p.groups) {
        const gpu = g.mat && g.mat.gpu;
        if (gpu && (gpu.heat || gpu.u.alphaMode >= 2)) continue;
        casters.push([p, g]); any = true;
      }
      if (any) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.meta.bboxMin[i]); hi[i] = Math.max(hi[i], p.meta.bboxMax[i]); }
    }
    if (!casters.length) return null;
    let c = lo.map((v, i) => (v + hi[i]) / 2);
    let r = Math.max(0.05, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
    // big scenes (far-away parts, whole folders): fit the map to what the camera looks at
    const view = this.camView ? null : Math.max(0.5, this.cam.dist * 0.9);
    if (view && view < r * 0.8) { c = this.cam.target.slice(); r = view; }
    const L = norm3(sun.dir);
    // the shadow falls on the floor next to the model -> widen and shift the map at low sun
    const reach = Math.min(4, 1 / Math.max(0.2, L[1]));
    const half = r * (1 + 0.5 * reach);
    const up = Math.abs(L[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const hz = Math.hypot(L[0], L[2]) || 1;
    const cc = [c[0] - L[0] / hz * r * 0.5 * (reach - 1), c[1], c[2] - L[2] / hz * r * 0.5 * (reach - 1)];
    const eye = add3(cc, scl3(L, r * 4));
    const lview = M4.look(eye, cc, up);
    const n = 0.01, f = r * 8 + half * 2;
    const o = new Float32Array(16);
    o[0] = 1 / half; o[5] = 1 / half; o[10] = -2 / (f - n); o[14] = -(f + n) / (f - n); o[15] = 1;
    const lvp = M4.mul(o, lview);
    this._shadowTex();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._sm.fb);
    gl.viewport(0, 0, this._sm.n, this._sm.n);
    gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2.0);
    gl.useProgram(this.shadowProg);
    const u = this.uni.s;
    gl.uniformMatrix4fv(u.uViewProj, false, lvp);
    gl.activeTexture(gl.TEXTURE0);
    for (const [p, g] of casters) {
      const gpu = g.mat && g.mat.gpu, slot = gpu && gpu.units[0], e = slot && slot.entry;
      const clip = !!(gpu && gpu.u.alphaMode === 1 && e && e.status === 'ok');
      gl.uniform1i(u.uClip, clip ? 1 : 0);
      gl.bindTexture(gl.TEXTURE_2D, clip ? e.tex : this.white);
      gl.uniform1i(u.uUv0, clip ? slot.uv : 0); gl.uniform2fv(u.uSc0, clip ? slot.scale : [1, 1]);
      this._off(u, p);
      gl.bindVertexArray(p.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, g.start * 4);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(null);
    return { lvp, texel: 2 * half / this._sm.n, center: c, r, floorY: Math.max(lo[1], c[1] - r) };
  }
  _shadowUniforms(u, sh) {
    const gl = this.gl;
    gl.uniform1i(u.uShadowOn, sh ? 1 : 0);
    if (!sh) return;
    gl.uniformMatrix4fv(u.uLightVP, false, sh.lvp);
    gl.uniform1f(u.uShadowTexel, sh.texel);
    gl.uniform1f(u.uShadowSoft, this.shadowSoft || 1.5);
    gl.uniform1f(u.uNormalOffset, Math.min(0.0547, sh.texel * 4));    // rF2 Shadows/NormalShadowOffset 0.0547 (upper limit)
  }
  // rF2 showroom: IRRADIANCE_PROBE (PROBE_POSITION) / REFMAP0 are rendered by the game at runtime. Same here:
  // the showroom meshes (lit by the showroom sun + scene ambient) into a linear HDR cube, mip mapped for the
  // reflections, plus its SH9 irradiance for the diffuse light of the car.
  _bakeProbe(sun, sh) {
    const gl = this.gl, room = sun.room;
    if (!room || room.probeFail) return;
    if (room.probe && room.probeVer === (this.texVersion || 0)) return;
    const now = performance.now();
    if (room.probe && now - room.probeT < 400) { clearTimeout(this._probeTimer); this._probeTimer = setTimeout(() => this.requestRender(), 450); return; }
    if (!this._cbf) this._cbf = gl.getExtension('EXT_color_buffer_float') ? 1 : -1;
    if (this._cbf < 0) { room.probeFail = true; return; }
    const N = 128, LV = Math.log2(N);
    let P = room.probe;
    if (!P) {
      P = { tex: gl.createTexture(), fb: gl.createFramebuffer(), depth: gl.createRenderbuffer(), lod: LV - 1, sh: new Float32Array(27) };
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, P.tex);
      gl.texStorage2D(gl.TEXTURE_CUBE_MAP, LV + 1, gl.RGBA16F, N, N);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindRenderbuffer(gl.RENDERBUFFER, P.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, N, N);
    }
    const pos = room.probePos || [0, 2, 0];
    const faces = [[[1, 0, 0], [0, -1, 0]], [[-1, 0, 0], [0, -1, 0]], [[0, 1, 0], [0, 0, 1]],
      [[0, -1, 0], [0, 0, -1]], [[0, 0, 1], [0, -1, 0]], [[0, 0, -1], [0, -1, 0]]];
    const s = this.settings, u = this.uni.m;
    gl.activeTexture(gl.TEXTURE13); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this._blackCube());
    gl.activeTexture(gl.TEXTURE12); gl.bindTexture(gl.TEXTURE_2D, this._shadowTex());
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(this.prog);
    gl.uniform3fv(u.uCamPos, pos); gl.uniform3fv(u.uSunDir, sun.dir); gl.uniform3fv(u.uSunCol, sun.col);
    gl.uniform1i(u.uEnv, 4); gl.uniform1f(u.uExposure, 1); gl.uniform1f(u.uAmbient, 1); gl.uniform1f(u.uWhite, 1);
    gl.uniform1f(u.uHdrK, RF2_HDRK); gl.uniform1i(u.uLinearOut, 1); gl.uniform1i(u.uDebug, 0);
    gl.uniform1f(u.uRain, 0); gl.uniform3fv(u.uAccent, this.accent);
    this._cubeUniforms(u, room, true);
    this._shadowUniforms(u, sh);
    this._spotUniforms(u);
    const opaque = [], blended = [];
    for (const p of this.parts.values()) {
      if (!p.visible || !p.env) continue;
      for (const g of p.groups) ((g.mat && g.mat.gpu ? g.mat.gpu.u.alphaMode : 0) >= 2 ? blended : opaque).push([p, g]);
    }
    const sel = this.selected; this.selected = null;
    const cc = (room.clear || [0, 0, 0]).map(v => v * RF2_HDRK);
    const renderFaces = (tex, size, at, near, rb) => {
      const pj = M4.persp(Math.PI / 2, 1, near, 400);
      gl.uniform3fv(u.uCamPos, at);
      gl.bindFramebuffer(gl.FRAMEBUFFER, P.fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      gl.viewport(0, 0, size, size);
      for (let f = 0; f < 6; f++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tex, 0);
        if (f === 0 && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return false;
        gl.clearColor(cc[0], cc[1], cc[2], 1); gl.clearDepth(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniformMatrix4fv(u.uViewProj, false, M4.mul(pj, M4.look(at, add3(at, faces[f][0]), faces[f][1])));
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
        for (const [p, g] of opaque) this._drawGroup(p, g);
        if (blended.length) {
          gl.enable(gl.BLEND); gl.depthMask(false);
          for (const [p, g] of blended) {
            if (g.mat.gpu.u.alphaMode === 3) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            this._drawGroup(p, g);
          }
          gl.depthMask(true); gl.disable(gl.BLEND);
        }
      }
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      return true;
    };
    // REFMAP0: rF2 tracks it on the car (showroom LoadScene:(refmap0, SLOT000)) - the sharp clear coat
    // reflections (refMapper) come from a cube rendered at the car, not from the irradiance probe
    const RN = 512;                 // measured: REFMAP0 is a 512 px R16G16B16A16 cube in the game
    if (!P.refl) {
      P.refl = gl.createTexture(); P.reflDepth = gl.createRenderbuffer();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, P.refl);
      gl.texStorage2D(gl.TEXTURE_CUBE_MAP, Math.log2(RN) + 1, gl.RGBA16F, RN, RN);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindRenderbuffer(gl.RENDERBUFFER, P.reflDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, RN, RN);
    }
    if (!renderFaces(P.refl, RN, room.reflPos || this._carTrackPos(), 0.005, P.reflDepth)) {
      room.probeFail = true; this.selected = sel; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
    if (!renderFaces(P.tex, N, pos, 0.02, P.depth)) {
      room.probeFail = true; this.selected = sel; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return; }
    this.selected = sel;
    // SH9 irradiance from mip level 3 (16x16 per face), solid-angle weighted
    const L = 3, M = N >> L, buf = new Float32Array(M * M * 4), c = new Float64Array(27);
    let wsum = 0;
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    for (let f = 0; f < 6; f++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, P.tex, L);
      gl.readPixels(0, 0, M, M, gl.RGBA, gl.FLOAT, buf);
      const fw = faces[f][0], up = faces[f][1], rt = cross3(fw, up);
      for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
        const a = (x + 0.5) / M * 2 - 1, b = (y + 0.5) / M * 2 - 1;
        const d = norm3([fw[0] + a * rt[0] + b * up[0], fw[1] + a * rt[1] + b * up[1], fw[2] + a * rt[2] + b * up[2]]);
        const w = 1 / Math.pow(1 + a * a + b * b, 1.5); wsum += w;
        const Y = [0.282095, 0.488603 * d[1], 0.488603 * d[2], 0.488603 * d[0], 1.092548 * d[0] * d[1],
          1.092548 * d[1] * d[2], 0.315392 * (3 * d[2] * d[2] - 1), 1.092548 * d[0] * d[2], 0.546274 * (d[0] * d[0] - d[1] * d[1])];
        const k = (y * M + x) * 4;
        for (let i = 0; i < 9; i++) for (let ch = 0; ch < 3; ch++) c[i * 3 + ch] += buf[k + ch] * Y[i] * w;
      }
    }
    // radiance SH -> irradiance (Ramamoorthi & Hanrahan: A0 = PI, A1 = 2PI/3, A2 = PI/4), / PI, basis constants folded in
    const A = [1, 2 / 3, 2 / 3, 2 / 3, 0.25, 0.25, 0.25, 0.25, 0.25];
    const B = [0.282095, 0.488603, 0.488603, 0.488603, 1.092548, 1.092548, 0.315392, 1.092548, 0.546274];
    for (let i = 0; i < 9; i++) for (let ch = 0; ch < 3; ch++) P.sh[i * 3 + ch] = c[i * 3 + ch] * (4 * Math.PI / wsum) * A[i] * B[i];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    room.probe = P; room.probeVer = this.texVersion || 0; room.probeT = now;
  }
  // cubeBBMin / cubeBBMax / cubeBBPos as measured in the game: AABB over all vehicle meshes, centre = cubeBBPos
  // (Frida: (-2.155, 0, -3.349) / (1.742, 1.164, 2.392) = exactly the bounds of all 40 DLM27 meshes rotated by the spinner)
  _carBox() {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of this.parts.values()) {
      if (p.env) continue;
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.meta.bboxMin[i]); hi[i] = Math.max(hi[i], p.meta.bboxMax[i]); }
    }
    if (!isFinite(lo[0])) return null;
    return [lo, hi, [0, 1, 2].map(i => (lo[i] + hi[i]) / 2)];
  }
  // SLOT000 = the car: its origin (GEN/VEH root = world origin here), on the floor plane -> just above the lowest car point
  _carTrackPos() {
    let lo = Infinity;
    for (const p of this.parts.values()) if (p.visible && !p.env) lo = Math.min(lo, p.meta.bboxMin[1]);
    return [0, (isFinite(lo) ? Math.max(lo, 0) : 0) + 0.02, 0];
  }
  _cubeUniforms(u, room, bake) {
    const gl = this.gl, c = !!(room && room.cube && room.cube.status === 'ok');
    const pr = room && room.probe && !bake ? room.probe : null;
    gl.uniform1i(u.uProbe, pr ? 1 : 0); gl.uniform1i(u.uBake, bake ? 1 : 0);
    if (pr) { gl.uniform3fv(u.uSH, pr.sh); gl.uniform1f(u.uProbeLod, pr.lod); }
    gl.uniform1i(u.uRefl, 15); gl.uniform1i(u.uHasRefl, pr && pr.refl ? 1 : 0);
    const bx = pr && pr.refl ? this._carBox() : null;                 // doParallaxRefMap: vehicle world AABB
    gl.uniform1i(u.uBoxOn, bx ? 1 : 0);
    if (bx) { gl.uniform3fv(u.uBoxMin, bx[0]); gl.uniform3fv(u.uBoxMax, bx[1]); gl.uniform3fv(u.uBoxPos, bx[2]); }
    gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_CUBE_MAP, pr && pr.refl ? pr.refl : this._blackCube()); gl.activeTexture(gl.TEXTURE0);
    gl.uniform3fv(u.uRoomAmb, room && room.amb ? room.amb : [0, 0, 0]);
    gl.uniform1i(u.uHasCube, c ? 1 : 0);
    gl.uniform1i(u.uCubeManual, c && room.cube.manual ? 1 : 0);
    gl.uniform1f(u.uCubeGain, room ? (room.cubeGain || 1.6) : 1);
  }
  _drawGroundShadow(vp, sun, sh) {
    const gl = this.gl, u = this.uni.g;
    const R = sh.r * 6, y = sh.floorY + 0.001, c = sh.center;
    if (!this._gq) {
      this._gq = { vao: gl.createVertexArray(), buf: gl.createBuffer() };
      gl.bindVertexArray(this._gq.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this._gq.buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    }
    gl.bindVertexArray(this._gq.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this._gq.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([c[0] - R, y, c[2] - R, c[0] + R, y, c[2] - R, c[0] + R, y, c[2] + R,
      c[0] - R, y, c[2] - R, c[0] + R, y, c[2] + R, c[0] - R, y, c[2] + R]), gl.DYNAMIC_DRAW);
    gl.useProgram(this.groundProg);
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniform3fv(u.uSunDir, sun.dir); gl.uniform3fv(u.uCenter, c); gl.uniform1f(u.uFade, R);
    gl.uniform1f(u.uStrength, this.settings.env === 1 ? 0.75 : 0.5);
    this._shadowUniforms(u, sh);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.bindVertexArray(null);
  }
  // under-car shadow of the showroom (computed once per car, see UC_* shaders)
  _underCar() {
    const gl = this.gl;
    const casters = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let key = '';
    for (const p of this.parts.values()) {
      if (!p.visible || p.env || p.noCast) continue;
      let any = false;
      for (const g of p.groups) {
        const gpu = g.mat && g.mat.gpu;
        if (gpu && (gpu.heat || gpu.u.alphaMode >= 2)) continue;
        casters.push([p, g]); any = true;
      }
      if (any) { key += p.id + ','; for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.meta.bboxMin[i]); hi[i] = Math.max(hi[i], p.meta.bboxMax[i]); } }
    }
    if (!casters.length) return null;
    if (this._uc && this._uc.key === key) return this._uc;
    const N = this.ucSize || 512;                      // 512 like rF2 (ucSize: test hook only)
    let U = this._uc;
    if (!U) {
      U = { depth: gl.createTexture(), occ: gl.createTexture(), fb: gl.createFramebuffer(), rb: gl.createRenderbuffer(),
        vao: gl.createVertexArray(), buf: gl.createBuffer() };
      if (!this._cbf) this._cbf = gl.getExtension('EXT_color_buffer_float') ? 1 : -1;
      gl.bindTexture(gl.TEXTURE_2D, U.depth); gl.texStorage2D(gl.TEXTURE_2D, 1, this._cbf > 0 ? gl.R16F : gl.RGBA8, N, N);
      gl.bindTexture(gl.TEXTURE_2D, U.occ); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, N, N);
      for (const t of [U.depth, U.occ]) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      gl.bindRenderbuffer(gl.RENDERBUFFER, U.rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, N, N);
      gl.bindVertexArray(U.vao); gl.bindBuffer(gl.ARRAY_BUFFER, U.buf);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    // car box (rF2: length along z) + 0.5 m padding; square texture of the padded length, centred on the car
    const W = hi[0] - lo[0], Lc = hi[2] - lo[2], Lp = Math.max(Lc, W) + 1.0;
    const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2, bx = cx - Lp / 2, bz = cz - Lp / 2, y0 = lo[1];
    U.key = key; U.bounds = [bx, bz, Lp, Lp]; U.y = y0;
    U.box = [(lo[0] - bx) / Lp, (lo[2] - bz) / Lp, (hi[0] - bx) / Lp, (hi[2] - bz) / Lp];
    const m = new Float32Array(16);                     // column major: x -> u, z -> v, y -> depth (lowest wins)
    m[0] = 2 / Lp; m[12] = -2 * bx / Lp - 1;
    m[9] = 2 / Lp; m[13] = -2 * bz / Lp - 1;
    m[6] = 0.2; m[14] = -0.2 * y0 - 1;
    m[15] = 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, U.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, U.depth, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, U.rb);
    gl.viewport(0, 0, N, N);
    gl.clearColor(1, 1, 1, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.ucDepthProg);
    const ud = this.uni.ucd;
    gl.uniformMatrix4fv(ud.uViewProj, false, m); gl.uniform1f(ud.uY0, y0);
    for (const [p, g] of casters) {
      this._off(ud, p);
      gl.bindVertexArray(p.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, g.start * 4);
    }
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, U.occ, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.ucOccProg);
    const uo = this.uni.uco;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, U.depth);
    gl.uniform1i(uo.uDepth, 0); gl.uniform4fv(uo.uCarBox, U.box);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._uc = U;
    return U;
  }
  _drawUnderCar(vp) {
    const gl = this.gl;
    const U = this._underCar();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (!U) return;
    const [bx, bz, L] = U.bounds, y = U.y + 0.002;
    gl.bindVertexArray(U.vao); gl.bindBuffer(gl.ARRAY_BUFFER, U.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([bx, y, bz, bx + L, y, bz, bx + L, y, bz + L, bx, y, bz, bx + L, y, bz + L, bx, y, bz + L]), gl.DYNAMIC_DRAW);
    gl.useProgram(this.ucDrawProg);
    const u = this.uni.ucw;
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, U.occ);
    gl.uniform1i(u.uOcc, 0); gl.uniform4fv(u.uBounds, U.bounds);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2); gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.depthMask(true); gl.disable(gl.BLEND); gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }
  // GEN car lights: Headlight* + Taillight* with the headlights, Brakelight* with the brake light
  // (Taillight missing -> Brakelight is used, and the other way round, like rF2)
  _spotUniforms(u) {
    const gl = this.gl, on = this.lightsOn, list = [];
    const L = this.carLights || [];
    const hasTail = L.some(l => /^taillight/i.test(l.name)), hasBrake = L.some(l => /^brakelight/i.test(l.name));
    for (const l of L) {
      const n = l.name.toLowerCase();
      let lit = false;
      if (n.startsWith('headlight')) lit = on.head;
      else if (n.startsWith('taillight')) lit = on.head || (!hasBrake && on.brake);
      else if (n.startsWith('brakelight')) lit = on.brake || (!hasTail && on.head);
      if (lit) list.push(l);
    }
    const n = Math.min(8, list.length);
    const P = new Float32Array(32), D = new Float32Array(32), C = new Float32Array(32), K = new Float32Array(32), A = new Float32Array(32);
    for (let i = 0; i < n; i++) {
      const l = list[i], d = norm3(l.dir || [0, -0.15, 1]);
      const hs = l.hotspots || [1, 150], rg = l.range || [0, 400], at = l.attenuate || [0.25, 0.25, 0.0005];
      const k = (l.intensity ? l.intensity[0] : 1) / 255 * this.spotScale;
      P.set([l.pos[0], l.pos[1], l.pos[2], rg[1] || 400], i * 4);
      D.set([d[0], d[1], d[2], l.falloff ? l.falloff[0] : 1], i * 4);
      C.set([l.color[0] * k, l.color[1] * k, l.color[2] * k, 0], i * 4);
      K.set([Math.cos(Math.min(179, hs[0]) * Math.PI / 360), Math.cos(Math.min(179, hs[1] ?? hs[0]) * Math.PI / 360), 0, 0], i * 4);
      A.set([at[0] ?? 1, at[1] ?? 0, at[2] ?? 0, 0], i * 4);
    }
    gl.uniform1i(u.uSpotN, n);
    gl.uniform4fv(u.uSpotPos, P); gl.uniform4fv(u.uSpotDir, D); gl.uniform4fv(u.uSpotCol, C);
    gl.uniform4fv(u.uSpotCone, K); gl.uniform4fv(u.uSpotAtt, A);
  }
  // procedural rain drop texture (the engine renders its drops at run time): xy = drop normal, a = drop life
  _rainTex() {
    if (this._rt) return this._rt;
    const gl = this.gl, n = 512, px = new Uint8Array(n * n * 4);
    for (let i = 0; i < px.length; i += 4) { px[i] = 128; px[i + 1] = 128; px[i + 2] = 255; px[i + 3] = 0; }
    let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 900; k++) {
      const cx = rnd() * n, cy = rnd() * n, r = 1.5 + Math.pow(rnd(), 3) * 9, life = 0.35 + rnd() * 0.65;
      const ex = 1 + rnd() * 0.6;                    // slightly stretched drops
      for (let y = Math.floor(cy - r * ex - 1); y <= cy + r * ex + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const dx = (x - cx) / r, dy = (y - cy) / (r * ex), q = dx * dx + dy * dy;
        if (q > 1) continue;
        const o = (((y % n) + n) % n * n + ((x % n) + n) % n) * 4;
        px[o] = Math.round((dx * 0.8 * 0.5 + 0.5) * 255); px[o + 1] = Math.round((dy * 0.8 * 0.5 + 0.5) * 255);
        px[o + 2] = 255; px[o + 3] = Math.max(px[o + 3], Math.round(life * Math.min(1, (1 - q) * 4) * 255));
      }
    }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this._rt = t;
    return t;
  }
  // showroom cube map (DDS with 6 faces)
  async loadCube(name) {
    const gl = this.gl, e = { name, status: 'loading', tex: null, manual: false };
    try {
      const r = await fetch('/api/tex?name=' + encodeURIComponent(name));
      if (!r.ok) throw new Error('nicht gefunden');
      const d = DDS.parseCube(await r.arrayBuffer());
      if (!d) throw new Error('keine Cube-Map');
      const x = this.ext;
      let fmt = null;
      if (d.compressed) {
        if (x.s3tc && /^BC[123]$/.test(d.format)) {
          if (x.s3tcSrgb) fmt = { BC1: x.s3tcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT, BC2: x.s3tcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT, BC3: x.s3tcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT }[d.format];
          else { fmt = { BC1: x.s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT, BC2: x.s3tc.COMPRESSED_RGBA_S3TC_DXT3_EXT, BC3: x.s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT }[d.format]; e.manual = true; }
        } else if (x.bptc && d.format === 'BC7') fmt = x.bptc.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT;
        if (!fmt) throw new Error(d.format + ' nicht verfügbar');
      }
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
      d.faces.forEach((f, i) => {
        if (fmt) gl.compressedTexImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, fmt, f.w, f.h, 0, f.data);
        else gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.SRGB8_ALPHA8, f.w, f.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, f.data);
      });
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      e.tex = t; e.status = 'ok'; e.info = d.format + ' Cube ' + d.width;
    } catch (err) { e.status = 'error'; e.info = err.message; }
    this.requestRender();
    return e;
  }

  _drawGroup(p, g) {
    const gl = this.gl, u = this.uni.m, s = this.settings;
    const gpu = g.mat && g.mat.gpu;
    this._off(u, p);
    gl.uniform1f(u.uSelected, p.id === this.selected ? 1 : 0);
    let hasMask = 0, manual = 0;
    const uvs = new Int32Array(12), scales = new Float32Array(24).fill(1);
    for (let i = 0; i < 12; i++) {
      const slot = gpu ? gpu.units[i] : null;
      const e = slot && slot.entry;
      gl.activeTexture(gl.TEXTURE0 + i);
      if (e && e.status === 'ok') {
        gl.bindTexture(gl.TEXTURE_2D, e.tex); hasMask |= 1 << i;
        if (e.manual) manual |= 1 << i;
        uvs[i] = slot.uv; scales[i * 2] = slot.scale[0]; scales[i * 2 + 1] = slot.scale[1];
      } else gl.bindTexture(gl.TEXTURE_2D, this.white);
    }
    gl.uniform1i(u.uHas, hasMask); gl.uniform1i(u.uSrgbManual, manual);
    const mir = !!(gpu && gpu.units[0] && gpu.units[0].entry && gpu.units[0].entry.isMirror);
    gl.uniform1i(u.uMirrorTex, mir ? 1 : 0);
    if (mir) {
      const ms = this.mirrorSides;
      gl.uniform1i(u.uMirrorSide, !p.mirrorUv && ms ? 1 : 0);
      gl.uniform3fv(u.uMirrorUv, p.mirrorUv || [0, 0, 1]);
      if (ms) { gl.uniform3fv(u.uMirL, ms.L); gl.uniform3fv(u.uMirC, ms.C); gl.uniform3fv(u.uMirR, ms.R); }
      if (p.mirrorOffset) gl.uniform3fv(u.uOffset, add3(p.meta.position, p.mirrorOffset));
    }
    gl.uniform1iv(u.uUv, uvs); gl.uniform2fv(u.uScale, scales);
    const v = gpu ? gpu.u : RF2.uniforms({ params: {}, flags: {}, family: 'STANDARD', slots: [] }, null, {});
    gl.uniform1i(u.uNormalBC5, gpu ? gpu.normalBC5 : 1);
    gl.uniform1i(u.uFamily, v.family); gl.uniform1i(u.uAlbedoFn, v.albedoFn); gl.uniform1i(u.uBlendMode, v.blendMode);
    gl.uniform1i(u.uAlphaMode, v.alphaMode);
    gl.uniform4fv(u.uTint, v.tint); gl.uniform4fv(u.uBaseAlbedo, v.baseAlbedo); gl.uniform4fv(u.uEmissiveColour, v.emissiveColour);
    gl.uniform1f(u.uSpecAdj, v.specAdj); gl.uniform1f(u.uMetalAdj, v.metalAdj); gl.uniform1f(u.uRoughAdj, v.roughAdj);
    gl.uniform1f(u.uIOR, v.ior); gl.uniform1f(u.uNormalIntensity, v.normalIntensity);
    gl.uniform1f(u.uBaseAO, v.baseAO); gl.uniform1f(u.uBaseSpec, v.baseSpec); gl.uniform1f(u.uBaseMetal, v.baseMetal);
    gl.uniform1f(u.uBaseRough, v.baseRough); gl.uniform1f(u.uRoughFromAlbedoA, v.roughFromAlbedoA);
    gl.uniform1f(u.uDetailAlbedo, v.detailAlbedo); gl.uniform1f(u.uVcolMul, v.vcolMul);
    gl.uniform1f(u.uEmissiveOn, v.emissiveOn); gl.uniform1f(u.uEmissiveScalar, v.emissiveScalar);
    gl.uniform3i(u.uBlendFns, ...(v.blendFns || [0, 0, 0])); gl.uniform4fv(u.uBaseAlbedoAlt, v.baseAlbedoAlt || [1, 1, 1, 1]);
    gl.uniform2fv(u.uBaseMRAlt, v.baseMRAlt || [0, 0.5]);
    gl.uniform2fv(u.uDashP, v.dashP || [0.3, 40]);
    gl.uniform1f(u.uBlendConst, v.blendConst); gl.uniform1f(u.uTerrainBias, v.terrainBias);
    gl.uniform1i(u.uRecv, gpu && gpu.noShadow ? 0 : 1);
    gl.uniform1i(u.uWindscreen, v.windscreen || 0);
    if (v.legDif) { gl.uniform4fv(u.uLegDif, v.legDif); gl.uniform4fv(u.uLegSpc, v.legSpc); gl.uniform4fv(u.uLegSP, v.legSP); gl.uniform4fv(u.uLegCF, v.legCF); gl.uniform1i(u.uLegNoShadow, v.legNoShadow); }
    if (v.ocp) { gl.uniform4fv(u.uOCP, v.ocp); gl.uniform4fv(u.uOCC, v.occ); gl.uniform3fv(u.uOCS, v.ocs); }
    gl.uniform1i(u.uLum, v.lum || 0); gl.uniform3fv(u.uLumP, v.lumP || [1, 4, 128]);
    if (v.cb) { gl.uniform4fv(u.uCB, v.cb); gl.uniform4fv(u.uCBX, v.cbX); gl.uniform4fv(u.uCBEmis, v.cbEmis); }
    gl.uniform1iv(u.uLegGroups, new Int32Array(v.legGroups || [0, -1, -1, -1])); gl.uniform1i(u.uLegLerp, v.legLerp || 0);
    gl.uniform1f(u.uLegSpec, v.legSpec ?? 0.5); gl.uniform1i(u.uReflMode, v.reflMode || 0); gl.uniform1i(u.uReflLayer, v.reflLayer || 0);
    const twoSided = s.faceOrient ? !!(gpu && gpu.gmtTwoSided) : (gpu ? gpu.twoSided : true);
    if ((s.cull || s.faceOrient) && !twoSided) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); } else gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(p.vao);
    gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, g.start * 4);
  }
  _drawGrid(vp) {
    const gl = this.gl, b = this.scene;
    const size = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2], 0.5);
    const step = Math.pow(10, Math.floor(Math.log10(size / 2)));
    const cx = Math.round((b.min[0] + b.max[0]) / 2 / step) * step, cz = Math.round((b.min[2] + b.max[2]) / 2 / step) * step;
    const n = 40, y = b.min[1];
    if (!this._grid || this._grid.key !== [cx, cz, step, y].join()) {
      const pts = [];
      for (let i = -n; i <= n; i++) {
        pts.push(cx + i * step, y, cz - n * step, cx + i * step, y, cz + n * step);
        pts.push(cx - n * step, y, cz + i * step, cx + n * step, y, cz + i * step);
      }
      if (this._grid) { gl.deleteBuffer(this._grid.buf); gl.deleteVertexArray(this._grid.vao); }
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this._grid = { key: [cx, cz, step, y].join(), vao, buf, count: pts.length / 3, center: [cx, y, cz], fade: n * step };
    }
    gl.useProgram(this.lineProg);
    const ul = this.uni.l;
    gl.uniformMatrix4fv(ul.uViewProj, false, vp); gl.uniform3fv(ul.uOffset, [0, 0, 0]); if (ul.uXfOn) gl.uniform1i(ul.uXfOn, 0); if (ul.uBodyOn) gl.uniform1i(ul.uBodyOn, 0);
    const light = this.settings.env === 0;
    gl.uniform4fv(ul.uColor, light ? [1, 1, 1, 0.22] : [1, 1, 1, 0.08]);
    gl.uniform3fv(ul.uCenter, this._grid.center); gl.uniform1f(ul.uFade, this._grid.fade);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.bindVertexArray(this._grid.vao); gl.drawArrays(gl.LINES, 0, this._grid.count);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.bindVertexArray(null);
  }

  pick(cx, cy) {
    const gl = this.gl, cv = this.canvas;
    const w = cv.width, h = cv.height;
    if (!this._pick || this._pick.w !== w || this._pick.h !== h) {
      if (this._pick) { gl.deleteFramebuffer(this._pick.fb); gl.deleteRenderbuffer(this._pick.c); gl.deleteRenderbuffer(this._pick.d); }
      const fb = gl.createFramebuffer(), c = gl.createRenderbuffer(), d = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
      this._pick = { fb, c, d, w, h };
    }
    const { vp } = this._matrices();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._pick.fb);
    gl.viewport(0, 0, w, h);
    // clean state: a mask / offset left by another pass would leave old depth in the pick buffer (= nothing hit)
    gl.depthMask(true); gl.colorMask(true, true, true, true); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.pickProg);
    const u = this.uni.p;
    gl.uniformMatrix4fv(u.uViewProj, false, vp);
    gl.uniform1i(u.uSide, 0);
    for (const p of this.parts.values()) {
      if (!p.visible || p.env) continue;
      this._off(u, p);
      gl.bindVertexArray(p.vao);
      p.groups.forEach((g, gi) => {
        const id = p.id + 1;
        gl.uniform4fv(u.uId, [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255, (gi + 1) / 255]);
        gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, g.start * 4);
      });
    }
    const r = cv.getBoundingClientRect();
    const x = Math.floor((cx - r.left) * w / r.width), y = Math.floor(h - (cy - r.top) * h / r.height);
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    this.requestRender();
    const id = px[0] | (px[1] << 8) | (px[2] << 16);
    if (!id) return null;
    const hit = { partId: id - 1, group: px[3] - 1 };
    // which side of the car was hit (mirror glass: left / center / right) - same pixel, side colour instead of the id
    const hp = this.parts.get(hit.partId), hg = hp && hp.groups[hit.group];
    if (hg) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._pick.fb);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1i(u.uSide, 1);
      this._off(u, hp);
      gl.bindVertexArray(hp.vao);
      gl.drawElements(gl.TRIANGLES, hg.count, gl.UNSIGNED_INT, hg.start * 4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.uniform1i(u.uSide, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindVertexArray(null);
      hit.side = px[0] > 127 ? 'L' : px[1] > 127 ? 'R' : 'C';
    }
    return hit;
  }

  stats() {
    let v = 0, t = 0, n = 0;
    for (const p of this.parts.values()) if (p.visible && !p.env) { v += p.meta.vertexCount; t += p.meta.indexCount / 3; n++; }
    return { v, t, n };
  }
  formats() {
    const x = this.ext, f = [];
    if (x.s3tc) f.push('BC1-3'); if (x.rgtc) f.push('BC4/5'); if (x.bptc) f.push('BC6/7');
    return f;
  }
}
