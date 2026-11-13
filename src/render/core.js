import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { store } from '../util.js';

export const canvas = document.querySelector('#gl');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.24;
export const ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0705);
scene.fog = new THREE.FogExp2(0x0b0705, 0.12);
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.12;
  pmrem.dispose();
}

export const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 30);
scene.add(camera);

/* ---------- post chain ----------
   scene (MSAA, half float) -> sanitize -> half-res bloom -> tone map + grain + vignette.
   Only the scene pass is multisampled: the composer's ping-pong buffers hold full-screen quads, where
   MSAA and depth buy nothing but memory and a resolve blit per pass. */
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
class ScenePass extends Pass {
  constructor() {
    super();
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    // One overflowing specular highlight (Inf/NaN in the half-float buffer) would be smeared over the
    // whole frame by the bloom blur and tone-mapped to black, so clamp before blooming.
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.target.texture } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv);
          if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0);
          gl_FragColor = vec4(clamp(c.rgb, 0.0, 24.0), 1.0); }`,
    }));
  }
  setSize(w, h) { this.target.setSize(w, h); }
  setSamples(n) { if (this.target.samples !== n) { this.target.samples = n; this.target.dispose(); } }
  render(renderer, writeBuffer) {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}
const scenePass = new ScenePass();
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
composer.addPass(scenePass);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.8);
composer.addPass(bloom);
// OutputPass and the film grade in one pass: ACES + sRGB as three's OutputShader does, then vignette and grain.
export const grade = new ShaderPass(new THREE.RawShaderMaterial({
  defines: { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' },
  uniforms: { tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, uTime: { value: 0 }, uVignette: { value: 0.5 }, uGrain: { value: 0.035 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `precision highp float; uniform mat4 modelViewMatrix, projectionMatrix; attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `precision highp float; uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain; uniform vec2 uRes; varying vec2 vUv;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = ACESFilmicToneMapping(c.rgb);
      c = sRGBTransferOETF(c);
      vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
      float v = smoothstep(0.95, 0.25, length(q) * (0.9 + uVignette * 0.6));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      c.rgb += (h(floor(vUv * uRes) + fract(uTime) * 61.0) - 0.5) * uGrain;
      gl_FragColor = vec4(c.rgb, 1.0); }`,
}));
composer.addPass(grade);

/* ---------- quality ----------
   'auto' walks down a ladder when frames run long; fixed presets pin a rung. */
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 2);
// At 2x density a pixel edge is already half as wide, so 2 MSAA samples look like 4 at half the memory.
const RUNGS = [
  { dpr: MAX_DPR, post: true, shadow: 2048, msaa: MAX_DPR >= 1.75 ? 2 : 4 },
  { dpr: Math.min(MAX_DPR, 1.5), post: true, shadow: 2048, msaa: 4 },
  { dpr: Math.min(MAX_DPR, 1.25), post: true, shadow: 1024, msaa: 4 },
  { dpr: 1, post: true, shadow: 1024, msaa: 4 },
  { dpr: 1, post: false, shadow: 1024, msaa: 4 },
  { dpr: 0.8, post: false, shadow: 512, msaa: 4 },
];
export const PRESETS = { high: 0, medium: 2, low: 4 };
// Auto starts at the sharpest rung whose drawing buffer fits a pixel budget. Phones and tablets start
// no sharper than 1.5x: their GPUs drive dense screens at a fraction of desktop fill rate, and 1.5x
// on a hand-held screen is past what the eye resolves. adapt() only ever steps down from there.
const COARSE = matchMedia('(pointer: coarse)').matches;
function autoRung() {
  const budget = COARSE ? 2.3e6 : 4.2e6, css = innerWidth * innerHeight;
  let r = COARSE ? 1 : 0;
  while (r < 3 && css * RUNGS[r].dpr ** 2 > budget) r++;
  return r;
}
export const quality = {
  mode: store.get('quality', 'auto'),
  rung: 0,
  postAllowed: location.hash !== '#nopost',
  onShadowSize: null,
};
quality.rung = quality.mode === 'auto' ? autoRung() : PRESETS[quality.mode];

const postOn = () => RUNGS[quality.rung].post && quality.postAllowed;
export function applyQuality() {
  const r = RUNGS[quality.rung];
  renderer.setPixelRatio(r.dpr); composer.setPixelRatio(r.dpr);
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
  scenePass.setSamples(r.msaa);
  grade.uniforms.uRes.value.set(innerWidth * r.dpr, innerHeight * r.dpr);
  document.body.classList.toggle('no-post', !postOn());
  quality.onShadowSize?.(r.shadow);
}
export function setQualityMode(mode) {
  quality.mode = mode; store.set('quality', mode);
  quality.rung = mode === 'auto' ? autoRung() : PRESETS[mode];
  perf.acc = 0; perf.frames = 0; perf.slow = 0; perf.hold = 3;
  applyQuality();
}

/*
 * Auto quality only ever steps down, and rarely: every step resizes the post chain (and maybe the
 * shadow map), which is itself a hitch. A window counts as slow only when its average frame,
 * with stalls such as a tab switch clipped out, misses ~48 fps; it takes two slow windows in a
 * row to act, a step jumps straight to the rung predicted to hold ~55 fps, then nothing changes
 * for a while. While the table is tense (the revolver is up) a pending step waits until it's over.
 */
const WINDOW = 2, SLOW = 1 / 48, AIM = 1 / 55;
const perf = { acc: 0, frames: 0, slow: 0, hold: 3 };
const cost = (r) => r.dpr * r.dpr * (r.post ? 1 : 0.7);
export function adapt(dt) {
  if (quality.mode !== 'auto') return;
  perf.acc += Math.min(dt, 0.1); perf.frames++;
  if (perf.acc < WINDOW) return;
  const avg = perf.acc / perf.frames; perf.acc = 0; perf.frames = 0;
  if (perf.hold > 0) { perf.hold--; perf.slow = 0; return; }
  perf.slow = avg > SLOW ? perf.slow + 1 : 0;
  if (perf.slow < 2 || quality.rung >= RUNGS.length - 1 || document.body.classList.contains('tense')) return;
  const now = cost(RUNGS[quality.rung]);
  let next = quality.rung + 1;
  while (next < RUNGS.length - 1 && next < quality.rung + 3 && avg * cost(RUNGS[next]) / now > AIM) next++;
  quality.rung = next; perf.slow = 0; perf.hold = 5;
  applyQuality();
}

// Safety net: a post chain that yields black frames on some GPU falls back to direct rendering.
// Each check is a readPixels, which stalls until the GPU finishes the frame, so it stops checking
// once the chain has drawn a few good frames in a row.
const postCheck = { frame: 0, black: 0, good: 0 };
const probe = new Uint8Array(4);
function checkPostOutput() {
  const gl = renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  let sum = 0;
  for (const [fx, fy] of [[0.5, 0.42], [0.38, 0.5], [0.62, 0.5], [0.5, 0.58]]) {
    gl.readPixels(Math.floor(W * fx), Math.floor(H * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
    sum += probe[0] + probe[1] + probe[2];
  }
  postCheck.black = sum < 12 ? postCheck.black + 1 : 0;
  postCheck.good = sum < 12 ? 0 : postCheck.good + 1;
  if (postCheck.black >= 2) { quality.postAllowed = false; applyQuality(); console.warn('Post-processing produced black frames; rendering directly.'); }
}

/**
 * Compiles every program the scene can use, for each object whether or not it is in view. A program
 * drawn into the post chain's buffer differs from one drawn to the screen (no tone mapping, linear
 * output), so both sets are built: the post chain's for normal play, the screen's for the low rungs.
 */
export function compileScene() {
  // compile only walks visible objects, and things that wait hidden for their moment (the blood, the
  // other modes' tables) would otherwise compile when they first appear: show them for the call
  const hidden = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  const direct = renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(scenePass.target);
  const post = renderer.compileAsync(scene, camera);
  renderer.setRenderTarget(null);
  for (const o of hidden) o.visible = false;
  return Promise.all([direct, post]);
}

export function render(dt, t) {
  if (postOn()) {
    grade.uniforms.uTime.value = t;
    grade.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    composer.render(dt);
    if (++postCheck.frame % 40 === 0 && postCheck.frame <= 480 && postCheck.good < 4) checkPostOutput();
  } else renderer.render(scene, camera);
}

export function canvasTex(c, { repeat, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
