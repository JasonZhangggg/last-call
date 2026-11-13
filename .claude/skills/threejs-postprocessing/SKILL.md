---
name: threejs-postprocessing
description: "Three.js post-processing: composer pass chains, bloom, depth of field, ambient occlusion, custom screen effects. Use when adding visual effects, color grading, blur, glow, or screen-space shaders, with three r170 and WebGLRenderer."
---

# Three.js Post-Processing

> Vendored from [cloudai-x/threejs-skills](https://github.com/cloudai-x/threejs-skills) at commit 0e18186, MIT licence (`.claude/skills/THREEJS_SKILLS_LICENSE`). Upstream targets three.js r186.
>
> **In this project:** three@0.170.0 from the import map in `index.html`, `WebGLRenderer` only. The upstream WebGPU and TSL sections and WebGPU-only mistakes were cut. Text marked **r170** corrects upstream for this release. `docs/AGENT_BRIEF.md` wins over anything here.
>
> **r170:** `Timer` is not in core yet. Import it with `import { Timer } from "three/addons/misc/Timer.js"` and build it with `new Timer()`. It has no `connect()` and watches page visibility by itself. `THREE.Clock` is not deprecated in r170, and `src/main.js` uses it.
>
> **In this project:** `src/render/core.js` builds the chain by hand: a multisampled half-float scene pass that clamps NaN and Inf, an `UnrealBloomPass`, then one `RawShaderMaterial` grade pass doing OutputPass's ACES and sRGB work plus vignette and grain.

## Quick Start

```javascript
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 5);

// A bright emissive sphere gives bloom something to pick up
const mesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 16),
  new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 2 }),
);
scene.add(mesh);

// The composer replaces renderer.render(). Render the scene, then effects,
// then OutputPass last: it applies renderer.toneMapping and outputColorSpace once.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
// bloomPass.strength, .radius and .threshold are live properties; threshold is the luminance above which things glow
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function animate() {
  composer.render(); // not renderer.render()
}

renderer.setAnimationLoop(animate);
```

## Pass Order

The composer's buffers hold linear colors; tone mapping and the sRGB conversion happen once, in `OutputPass`, using the renderer's settings. Build chains in this order: `RenderPass` → linear-space effects (bloom, depth of field, SSAO, outline, ...) → `SMAAPass`, after the effects whose edges it should smooth → `OutputPass` → FXAA only when FXAA is used, because FXAA needs sRGB input. **r170:** there is no `FXAAPass`; use `new ShaderPass(FXAAShader)` (`three/addons/shaders/FXAAShader.js`) and set `uniforms.resolution.value` to `1 / (width × pixelRatio)`, `1 / (height × pixelRatio)` on every resize. Without FXAA, `OutputPass` is the last pass.

`SSAOPass` darkens the image produced by the previous pass, so a `RenderPass` must come before it. `RenderPixelatedPass` renders the scene itself and replaces `RenderPass`. `pass.enabled = false` skips a pass without rebuilding the chain.

```javascript
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85));
composer.addPass(new SMAAPass(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio())); // r170 takes a size; the composer resizes it
composer.addPass(new OutputPass());
```

## Composer Setup

- The composer copies the renderer's pixel ratio at construction. Call `renderer.setPixelRatio()` before constructing it, or `composer.setPixelRatio()` afterwards.
- The composer's buffers are not multisampled; `antialias: true` on the renderer does not reach them. For MSAA on the scene render and the composer's buffers, pass your own buffer with `samples` (CSS-pixel size) and size the composer once:

```javascript
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";

const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType,
    samples: 4, // MSAA on the composer's two buffers
  }),
);
composer.setSize(window.innerWidth, window.innerHeight); // scales the buffer by the pixel ratio
```

- On resize, call `camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); composer.setSize(w, h);` — the composer resizes its buffers and every pass, pixel-ratio included. Never resize a pass by hand.
- `composer.render()` drives time-based passes (FilmPass) from its own internal timer; pass a delta in seconds only if you manage time yourself.
- The composer assigns `renderToScreen` to the last enabled pass every frame. Set `composer.renderToScreen = false` only to keep the result off screen, as selective bloom does below.

## Selective Bloom

Bloom only meshes marked with a layer: paint everything else black for a bloom-only composer that renders off screen, then mix its texture into a final composer that renders the clean scene. `scene.background` is not a mesh: set it to `null` around `bloomComposer.render()`, or it is added to the final image a second time; on resize, call `setSize` on both composers.

```javascript
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const BLOOM_LAYER = 1;
const bloomLayer = new THREE.Layers();
bloomLayer.set(BLOOM_LAYER); // test mask: matches any object enabled on this layer

mesh.layers.enable(BLOOM_LAYER); // add the layer; set() would remove the mesh from layer 0

// Paint non-bloomed meshes black, then restore them
const darkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
const materials = new Map();

function darkenNonBloomed(object) {
  if (object.isMesh && bloomLayer.test(object.layers) === false) {
    materials.set(object, object.material);
    object.material = darkMaterial;
  }
}

function restoreMaterial(object) {
  if (materials.has(object)) {
    object.material = materials.get(object);
    materials.delete(object);
  }
}

// Bloom-only composer; with renderToScreen off, its result stays in renderTarget2
const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(new RenderPass(scene, camera));
bloomComposer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85));

// Final composer: the clean scene plus the bloom texture, mixed by a ShaderPass
const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(new RenderPass(scene, camera));
finalComposer.addPass(
  new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        baseTexture: { value: null }, // filled from the previous pass
        bloomTexture: { value: bloomComposer.renderTarget2.texture },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
        }
      `,
    }),
    "baseTexture",
  ),
);
finalComposer.addPass(new OutputPass());

function animate() {
  const background = scene.background;
  scene.background = null; // not a mesh: it would bloom and be added twice
  scene.traverse(darkenNonBloomed); // black scene: only marked meshes bloom
  bloomComposer.render();
  scene.traverse(restoreMaterial);
  scene.background = background;
  finalComposer.render(); // clean scene + bloom to the screen
}

renderer.setAnimationLoop(animate);
```

## Depth of Field

```javascript
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera)); // BokehPass reads this color image

const bokehPass = new BokehPass(scene, camera, {
  focus: 10.0, // view-space depth that stays sharp, in world units
  aperture: 0.025, // how far out of focus things blur
  maxblur: 0.01, // cap on the blur radius
});
composer.addPass(bokehPass);
composer.addPass(new OutputPass());

// Refocus at runtime: distanceTo matches the view-space depth for objects near the view center
bokehPass.uniforms.focus.value = camera.position.distanceTo(mesh.position);
```

## Ambient Occlusion

```javascript
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const composer = new EffectComposer(renderer);

// SSAOPass darkens the previous image, so the scene render must come first
composer.addPass(new RenderPass(scene, camera));

const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssaoPass.kernelRadius = 16;
ssaoPass.minDistance = 0.005;
ssaoPass.maxDistance = 0.1;
composer.addPass(ssaoPass);
composer.addPass(new OutputPass());

// Debug views: ssaoPass.output = SSAOPass.OUTPUT.SSAO (or Blur, Depth, Normal); the default shows the shaded scene
```

## Outline

```javascript
import * as THREE from "three";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
outlinePass.selectedObjects = [mesh]; // only these are outlined
outlinePass.edgeStrength = 3;
outlinePass.visibleEdgeColor.set(0xffffff);
outlinePass.hiddenEdgeColor.set(0x190a05); // parts hidden behind other objects
composer.addPass(outlinePass);
composer.addPass(new OutputPass());
```

## More Passes

Film grain, glitch, halftone and vignette are drop-in filters for the middle of the chain. `ColorCorrectionShader` works like the vignette: a `ShaderPass` with `powRGB` / `mulRGB` / `addRGB` uniform vectors. Its default powRGB of (2, 2, 2) darkens the image; start from (1, 1, 1) for neutral.

```javascript
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FilmPass } from "three/addons/postprocessing/FilmPass.js";
import { GlitchPass } from "three/addons/postprocessing/GlitchPass.js";
import { HalftonePass } from "three/addons/postprocessing/HalftonePass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const filmPass = new FilmPass(0.35, false); // grain intensity, grayscale; animates from the composer's delta
composer.addPass(filmPass);

const glitchPass = new GlitchPass();
glitchPass.goWild = true; // glitch every frame; false (the default) glitches at random intervals
composer.addPass(glitchPass);

const halftonePass = new HalftonePass(window.innerWidth, window.innerHeight, { shape: 1, radius: 4, scatter: 0, greyscale: false }); // r170 takes (width, height, params). shape: 1 dot, 2 ellipse, 3 line, 4 square, 5 diamond
composer.addPass(halftonePass);

const vignettePass = new ShaderPass(VignetteShader); // uniforms: offset and darkness
vignettePass.uniforms.offset.value = 1.0;
vignettePass.uniforms.darkness.value = 1.0;
composer.addPass(vignettePass);

composer.addPass(new OutputPass());
```

`RenderPixelatedPass` renders the scene itself, so it replaces `RenderPass` instead of following it:

```javascript
import { RenderPixelatedPass } from "three/addons/postprocessing/RenderPixelatedPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const composer = new EffectComposer(renderer);
const pixelatedPass = new RenderPixelatedPass(6, scene, camera); // 6 = pixel size
pixelatedPass.normalEdgeStrength = 0.3; // edges where the surface normal changes (creases)
pixelatedPass.depthEdgeStrength = 0.4; // depth-discontinuity edges
composer.addPass(pixelatedPass);
composer.addPass(new OutputPass());
```

## Custom Passes

Wrap any `ShaderMaterial`-style shader object in a `ShaderPass`. The `tDiffuse` uniform receives the previous pass output. Keep custom effects before `OutputPass` while they work in linear space; place one after it only if it needs sRGB input, like FXAA.

```javascript
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const WaveShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    intensity: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float intensity;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      uv.x += sin(uv.y * 10.0 + time) * 0.01 * intensity; // wave distortion
      gl_FragColor = texture2D(tDiffuse, uv);
    }
  `,
};

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const wavePass = new ShaderPass(WaveShader);
composer.addPass(wavePass);
composer.addPass(new OutputPass());

// Drive time uniforms from a Timer
const timer = new Timer();

function animate() {
  timer.update();
  wavePass.uniforms.time.value = timer.getElapsed();
  composer.render();
}

renderer.setAnimationLoop(animate);
```

## Renderer Built-In Effects (No Composer)

**r170:** `renderer.setEffects()` and the `outputBufferType` option do not exist. Use EffectComposer.

**In this project:** the upstream WebGPU and TSL section was cut. This project renders with WebGLRenderer.

## Common Mistakes

Entries that only apply to WebGPURenderer or TSL were cut. Entries marked **r170** replace upstream advice that is wrong for three r170.

- `three/examples/jsm/postprocessing/EffectComposer.js` → `three/addons/postprocessing/EffectComposer.js`: the examples/jsm specifier does not resolve under the import map.
- `composer.addPass(new ShaderPass(GammaCorrectionShader))` → `composer.addPass(new OutputPass())`: GammaCorrectionShader only applies the sRGB transfer function, while OutputPass applies renderer tone mapping, exposure and output color space and ends every chain; only passes that need sRGB input, such as FXAAPass, follow it.
- `composer.addPass(bloomPass); composer.render();` → `composer.addPass(bloomPass); composer.addPass(new OutputPass()); composer.render();`: the composer's buffers are linear, and without OutputPass tone mapping and the sRGB conversion are skipped or applied unevenly.
- `composer.addPass(fxaaPass); composer.addPass(outputPass);` → `composer.addPass(outputPass); composer.addPass(fxaaPass);`: FXAA needs sRGB input so it follows OutputPass, while SMAA works in linear space and must run before it.
- **r170:** `new ShaderPass(FXAAShader)` is the FXAA pass here (there is no FXAAPass). Set its `resolution` uniform from the composer size times the pixel ratio, again on every resize, or it is wrong on HiDPI screens.
- `new FilmPass(0.35, 0.5, 648, false)` → `new FilmPass(0.35, false)`: the signature is (intensity, grayscale); the scanline arguments do not exist.
- **r170:** `new HalftonePass(width, height, params)` is the signature here; the single-object form is r175.
- **r170:** `new SMAAPass(width, height)` is the signature here; the no-argument form is r175.
- `new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 1.5, 0.4, 0.85)` → `new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85)`: addPass immediately resizes the pass to the composer size, undoing the half-resolution trick.
- `bloomPass.resolution.set(width, height)` → `composer.setSize(width, height)`: UnrealBloomPass reads its resolution only in the constructor; the composer resizes the pass and its mips.
- `bloomPass.renderToScreen = false` → `bloomComposer.renderToScreen = false`: the composer reassigns renderToScreen on every enabled pass each frame, so only the composer-level switch keeps the result off screen.
- `requestAnimationFrame(animate)` → `renderer.setAnimationLoop(animate)`: both renderers' docs advise it over a manual loop, and it hands frames to the WebXR session when one starts.
- **r170:** `new THREE.Clock()` is fine here; Clock is deprecated only from r183. Its trap holds in r170: `getElapsedTime()` calls `getDelta()`, so a `getDelta()` after it in the same frame returns about zero. Read the delta once per frame and add it up.
- `composer.render(); renderer.render(scene, camera);` → `bloomComposer.render(); finalComposer.render();`: the second renderer.render clears the canvas and erases the composer output; selective bloom mixes the bloom texture in through a second composer.

## See Also

- `threejs-fundamentals` — renderer creation, sizing, color spaces and the animation loop.
- `threejs-shaders` — GLSL ShaderMaterial authoring for custom effects.
- `threejs-textures` — render targets and using a post-processed image as a texture.
