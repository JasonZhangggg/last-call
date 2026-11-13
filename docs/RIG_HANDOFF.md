# Rigged characters: handoff

Brass is the pilot. He is a glTF model with a skeleton, made by scripted headless Blender, and the
game plays him through an AnimationMixer with a thin contact IK and collision pass. Noctua and
Gristle are still code-built.

## What is done

- **Pipeline.** `npm run models` runs `tools/models/build.sh`. It makes a Python 3.11 venv with the
  `bpy` module (Blender 5.0.1, about 900 MB, in `tools/models/.venv`, not committed) and runs
  `tools/models/brass.py`, which writes `assets/models/brass.glb`. A run takes about 8 seconds.
  `node tools/models/inspect.mjs` prints what the file holds.
- **Asset.** 47 bones, one skinned mesh in 8 materials (8 draw calls, 16,030 triangles), 10
  sockets, 9 body clips and 4 finger-pose clips. 809 KB.
- **Run time.** `src/render/rig.js` loads it, swaps the game's own materials in by name, and
  replaces the code-built posing for any character that has a model. `buildCharacter` returns the
  same object shape either way.
- **Checks.** `scripts/rig-shots.mjs` stages Brass's poses, photographs them and probes collisions.

## How it fits together

| File | Owns |
|---|---|
| `tools/models/lib/meshkit.py` | Geometry in numpy, laid out like three.js primitives. No Blender. |
| `tools/models/lib/hand.py` | The shared hand: shape, finger bones, the grips on the revolver and the glass. A port of the hand in `characters.js`. |
| `tools/models/lib/pose.py` | Quaternions, the two-bone arm solve, keyed channels with easing. |
| `tools/models/lib/rigkit.py` | The Blender side: armature, skinned mesh, sockets, baked actions, glTF export. |
| `tools/models/brass.py` | Brass's look, sockets, pose targets and clips. |
| `src/render/rig.js` | Loading, the mixer layers, procedural overlay, contact IK, collision. |
| `src/render/characters.js` | Two hooks: `riggedCharacter()` in `buildCharacter`, and `updateRig()` in `updateCharacter`. |
| `src/modes/dice.js` | One line in `poseSip` hands a rigged character's drink to `rigSip()`. |

Conventions that everything relies on:

- The generator works in the game's space: metres, +y up, +z toward the table, right hand on -x.
- **Every bone is an axis-aligned stub.** Its rest rotation is the identity in Blender, in the .glb
  and in three.js. So `chest`, `neck` and `head` stand in for the old `upper`, `neck` and `head`
  groups, and a pose quaternion means the same thing everywhere. Bones do not point at their children.
- GLTFLoader strips dots from names: `upperarm.R` is `upperarmR` in three.js.
- Sockets are empties on bones: `grip_gun` and `grip_glass` on the right hand, `palm_l` and `fan`
  on the left. Pose targets are empties too (`rest_r`, `rest_l`, `aim`, `fan_hold`, `fan_up`,
  `mouth`), so the numbers live in the generator only.
- Clips other than `idle` are made additive at load, relative to idle's first frame. Layer weights
  follow the existing targets and envelopes (`ch.target`, `ch.env`), which still gate the game logic.
- The mixer only writes a bone when its value changes. Bones posed after the mixer are restored to
  the mixer's last output first (`rig.post`). Add any new post-posed bone to that list.
- The elbow has its own bone that turns half as far as the forearm and swells a little. That is what
  keeps the tube round at a tight bend.

## Proof so far

`node scripts/rig-shots.mjs --out artifacts/rig/after` (and `--page artifacts/rig/before.html --out
artifacts/rig/before` for the old build, if a copy of the old page is kept there).

- Torso capsule, all staged phases (cards, rest, reach, aim, lower, drink): 0 forearm or hand
  vertices inside, 0 held-prop vertices inside. The upper arm past the first 12 cm has at most 6
  vertices inside, 11 mm deep, where the arm is set into the boiler under the shoulder dome.
- Table top: the lowest arm vertex is between 0 and 8 mm under it (fingertips and the cuff resting).
- Drink: the wrist is 2 to 7 degrees off the forearm at the lip, and the rim is 2.0 to 2.4 cm from the
  mouth point.
- The old Brass, same staging: 20 visible body meshes, 25,436 triangles, 51 arm vertices in the
  torso at rest, and the upper arm through the chest while drinking.

## What is next

1. **Page size.** The .glb is bundled as base64, and the page went from 353 KB to 1.44 MB. Options:
   quantise in a post-step (weights to u8, normals to i8, about 40% off), or serve models as static
   assets from the Worker and fetch them during the loading screen. Three characters need one of these.
2. **Noctua and Gristle.** Each needs a `<name>.py` with its look ported from `DESIGNS` (torso,
   head, cuffs), its arm radii and hand size, and `mats` on its design entry. The skeleton, hand,
   sockets, pose maths and clips can be shared: move the clip functions and `solve()` out of
   `brass.py` into a `lib/clips.py` first. Cloth sleeves want the same single tube; Noctua's cape,
   collar, hat and plumes and Gristle's beard and bicorne are rigid parts on the chest or head bone.
   Their eyes and lids need `lid` bones like Brass's shutter. Then add them to `SOURCES` in `rig.js`.
3. **Props.** The revolver, glass, cups and cards are still code-built and attach to the sockets
   as before. They could become .glb files with the same generator kit. Nothing needs it yet.
4. **Delete the old path.** Once all three are rigged, `buildArm`, `poseArms`, `solveArm`,
   `straightGrip`, `poseRightHand`, the morph hands and the design build functions in
   `characters.js` can go. The player's own arm (`playerArm.js`) still uses the morph hand.

## Gaps

- `relief` and the tremble are still procedural, added after the mixer. `inspect` (cards raised to
  read) is a contact target, not a clip.
- The reach is one generic clip. The IK carries the hand to wherever the target is, so far targets
  lean on IK more than on keyed motion.
- Putting a layer down is a weight fade, not a keyed return. Only `drink` has its own way back.
- The upper arm still meets the boiler under the shoulder dome. Moving the shoulder joints out a
  centimetre or two would clear it, at a small change to his silhouette.
- Collision uses the wrist, elbow, two forearm points, one upper-arm point, the barrel and the
  glass. Fingers are only kept off the table, not out of the body.
- `index.html` has no `modulepreload` for GLTFLoader, so it costs one extra round trip at boot.
- Not profiled on a real GPU. The software renderer says nothing useful about frame time.
- `scripts/bend-probe.mjs`, `shake-probe.mjs` and `motion-probe.mjs` were not rerun.
