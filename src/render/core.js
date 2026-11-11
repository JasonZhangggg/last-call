import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
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
   scene (MSAA, half float) -> sanitize -> half-res bloom -> tone map -> grain + vignette */
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? 4 : 0 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
// One overflowing specular highlight (Inf/NaN in the half-float buffer) would be smeared over the
// whole frame by the bloom blur and tone-mapped to black, so clamp before blooming.
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 24.0), 1.0); }`,
}));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());
export const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.5 }, uGrain: { value: 0.035 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
      float v = smoothstep(0.95, 0.25, length(q) * (0.9 + uVignette * 0.6));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      c.rgb += (h(floor(vUv * uRes) + fract(uTime) * 61.0) - 0.5) * uGrain;
      gl_FragColor = vec4(c.rgb, 1.0); }`,
});
composer.addPass(grade);

/* ---------- quality ----------
   'auto' walks down a ladder when frames run long; fixed presets pin a rung. */
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 2);
const RUNGS = [
  { dpr: MAX_DPR, post: true, shadow: 2048 },
  { dpr: Math.min(MAX_DPR, 1.5), post: true, shadow: 2048 },
  { dpr: Math.min(MAX_DPR, 1.25), post: true, shadow: 1024 },
  { dpr: 1, post: true, shadow: 1024 },
  { dpr: 1, post: false, shadow: 1024 },
  { dpr: 0.8, post: false, shadow: 512 },
];
export const PRESETS = { high: 0, medium: 2, low: 4 };
export const quality = {
  mode: store.get('quality', 'auto'),
  rung: 0,
  postAllowed: location.hash !== '#nopost',
  onShadowSize: null,
};
quality.rung = quality.mode === 'auto' ? (innerWidth * (window.devicePixelRatio || 1) > 2600 ? 1 : 0) : PRESETS[quality.mode];

const postOn = () => RUNGS[quality.rung].post && quality.postAllowed;
export function applyQuality() {
  const r = RUNGS[quality.rung];
  renderer.setPixelRatio(r.dpr); composer.setPixelRatio(r.dpr);
  renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
  grade.uniforms.uRes.value.set(innerWidth * r.dpr, innerHeight * r.dpr);
  document.body.classList.toggle('no-post', !postOn());
  quality.onShadowSize?.(r.shadow);
}
export function setQualityMode(mode) {
  quality.mode = mode; store.set('quality', mode);
  quality.rung = mode === 'auto' ? 0 : PRESETS[mode];
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
const postCheck = { frame: 0, black: 0 };
const probe = new Uint8Array(4);
function checkPostOutput() {
  const gl = renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  let sum = 0;
  for (const [fx, fy] of [[0.5, 0.42], [0.38, 0.5], [0.62, 0.5], [0.5, 0.58]]) {
    gl.readPixels(Math.floor(W * fx), Math.floor(H * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
    sum += probe[0] + probe[1] + probe[2];
  }
  postCheck.black = sum < 12 ? postCheck.black + 1 : 0;
  if (postCheck.black >= 2) { quality.postAllowed = false; applyQuality(); console.warn('Post-processing produced black frames; rendering directly.'); }
}

export function render(dt, t) {
  if (postOn()) {
    grade.uniforms.uTime.value = t;
    composer.render(dt);
    if (++postCheck.frame % 40 === 0 && postCheck.frame <= 480) checkPostOutput();
  } else renderer.render(scene, camera);
}

export function canvasTex(c, { repeat, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
