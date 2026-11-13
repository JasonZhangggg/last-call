---
name: last-call-3d
description: Project rules and known traps for Last Call's three.js rendering, character rigs, animation and headless verification. Read before changing anything in src/render, src/modes, tools/models or scripts, and before trusting a screenshot or probe number from the test harness.
---

# Last Call: 3D rules and traps

Each item below cost real time in this project. Check against them before you ship.

## three.js traps

- **`Quaternion.slerpQuaternions(a, b, t)` copies `a` into the target before it reads `b`.** If the target is `b`, the result is always `a`. Slerp into a different object: `out.copy(a).slerp(b, t)` with `out !== b`. This silently froze the characters' drinking hand at its table pose for weeks. `Vector3.lerpVectors` is safe to alias.
- **`renderer.compile` and `compileAsync` walk visible objects only.** Anything that waits hidden (blood, other modes' tables, a model loaded later) compiles on first show, which is a hitch at the worst moment. `compileScene()` in `src/render/core.js` shows hidden objects for the call. Build new things before it runs, or call it again.
- **The post chain renders into a half-float target, which needs a different shader variant from the screen.** Compile both. `compileScene()` does.
- **One material shared by meshes that need different variants** (morph vs plain, instanced vs plain) re-selects its program every frame and makes garbage. Clone the material per variant.
- **`getWorldQuaternion` on a node under a negatively scaled parent gives nonsense.** Measure rotations in the local frame you posed them in.
- **No allocations in per-frame code.** No `new Vector3`, array or object literals, or closures in `update`/`frame` paths. Use module scratch objects. `smoothDamp(state, key, ...)` with variable keys boxes numbers. Prefer fixed-shape objects with named fields (see `motion.js`).
- **`toDataURL` and `readPixels` stall on the GPU.** Never call them mid-game. Make thumbnails at load.

## Characters and rigs

- **Characters are rigged glTF models built by scripted headless Blender.** `tools/models/*.py` uses the shared `lib/biped.py`. `npm run models` or `tools/models/build.sh <name>` writes `assets/models/<name>.glb`. Read `docs/RIG_HANDOFF.md` first.
- **Changes to `lib/` must stay backward compatible.** Prove other characters are unchanged by rebuilding and running `cmp` against the committed `.glb`.
- **IK is a thin contact layer over clips, not the pose itself.** A held object (gun, glass, cards) must stay exactly where its mover or socket puts it. Never rotate the hand to fix a wrist angle, because the prop rotates with it. Move the forearm or elbow instead.
- **Wrists stay within about 25° of the forearm. Elbows hang down and out.** Arms and props stay outside the torso capsule, head box and table top. `scripts/rig-shots.mjs` measures this.
- **Models are served beside the page, not inlined.** Each needs:
  - a `MODELS` entry in `src/worker.js`
  - a preload link in `index.html`
  - a `SOURCES` entry in `src/render/rig.js`

  `scripts/build.mjs` copies them into `dist/models`.

## The headless test harness lies in specific ways

- **The test browser renders in software.** Each frame takes about 1.3 s and the sim advances at most 0.25 s per frame. Animations run far slower than the game's own waits.
- **`#autoplay` cuts every scripted `wait` to a fifth.** So in autoplay a drink, a shot or a count often never plays out before the next step. To capture an animation, turn the shortcut off while it runs:

  ```js
  settings.autoplay = false;
  settings.speed = 0.1;
  ```

  `scripts/glass-shots.mjs` does this while a glass is held. Or stage the pose directly through `window.__lastcall.pose`, `blood`, `spray` and so on.
- **Test pages load from `http://last-call.local/...`,** fulfilled from disk by each script's `page.route`, because Chromium won't `fetch()` from `file://`. Copy that pattern in new scripts.
- **Don't run several probes on one `--out` folder.** They wipe each other's files.
- **A capture that "never happens" usually means the trigger condition never became true in that state.** Check it in the page before blaming the game.

## Useful probes

- `scripts/verify.mjs [--mode dice|auction] [--soak N] [--size WxH]` runs a full play-through with screenshots and fails on page errors.
- `scripts/glass-shots.mjs <out> <n> [cards]` pauses on glass reaches, sips and revolver aims, and logs wrist bend and rim-to-mouth distance.
- `scripts/bend-probe.mjs` gives the wrist bend distribution over a self-played game.
- `scripts/rig-shots.mjs --who <character>` gives staged rig close-ups and the collision probe.
- `scripts/motion-probe.mjs` and `shake-probe.mjs` find velocity pops and stuck tremble.
- `scripts/perf-probe.mjs` gives allocations, programs and long tasks.

## Shipping

```bash
npm test
```

```bash
npm run build
```

Deploy:

```bash
CLOUDFLARE_API_TOKEN=dummy-token-proxy-injects CLOUDFLARE_ACCOUNT_ID=978f4e3ba44187686afa309188037268 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt npx wrangler deploy
```

Check a room creates:

```bash
curl -s -X POST https://last-call.jasonxyz.workers.dev/api/rooms
```

Push:

```bash
git push origin master:main
```
