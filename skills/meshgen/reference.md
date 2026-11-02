# meshgen reference

## What a meshgen GLB is

- glTF 2.0 binary, units in meters, +Y up. Models are put on the ground
  (y = 0); Meshy's characters face +Z with their feet at y = 0. meshgen warns
  when the height or ground is off, and the preview shows the facing.
- Characters: one skinned mesh and a 24-bone humanoid skeleton with
  Mixamo-style names and no prefix: `Hips`, `Spine`, `Spine01`, `Spine02`,
  `neck`, `Head`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, the
  same on the right, `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftToeBase`, the
  same on the right, plus `head_end` and `headfront`. There are no finger
  bones, so hands stay open.
- Every clip from one character shares that skeleton. Each clip has
  `extras.loop` (true for idle, walk, run and other cycles).
- Meshy sends PNG or JPEG textures. PNGs are shrunk to at most 1024 px
  unless `--max-texture` says otherwise; JPEGs stay as they are (they are
  already compact). A character is about 6 MB, a prop or creature 3-5 MB.

## three.js

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const gltf = await new GLTFLoader().loadAsync('assets/meshgen/hero/hero.glb');
const hero = gltf.scene;                     // already 1 unit = 1 m
scene.add(hero);
const mixer = new THREE.AnimationMixer(hero);
const clip = (name) => mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, name));

let current = clip('idle');
current.play();
function playClip(name, once = false) {
  const next = clip(name);
  next.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat).play();
  next.clampWhenFinished = once;
  current.crossFadeTo(next, 0.2, false);
  current = next;
}
// each frame: mixer.update(dt)
```

- Plain GLBs need no Draco, Meshopt or KTX2 decoders.
- More of the same character: `SkeletonUtils.clone(gltf.scene)` with its own
  `AnimationMixer`. Plain `.clone()` breaks skinning.
- Turn the character to face its direction of travel with
  `hero.rotation.y = Math.atan2(dir.x, dir.z)`, since the model faces +Z.
- One-shot actions: listen for the mixer's `finished` event, then fade back to
  idle, walk or run. Clips can be sped up with `action.timeScale`.
- For timing (the frame a sword hits), check
  `action.time / clip.duration` each frame against a fraction you pick from
  the preview sheet.
- Vendor three.js into the game (no CDN). meshgen's own copy is in
  `${CLAUDE_SKILL_DIR}/viewer/vendor/` (three.js 0.186.1, MIT).

## Godot 4

- Copy the `.glb` into the project (say `res://models/hero.glb`). Godot
  imports it as a scene with an `AnimationPlayer` holding every clip. Godot
  also uses meters, +Y up, and models facing +Z, so no conversion is needed.
- Looping: Godot sets the loop flag on clips whose names start or end with
  `loop`. Otherwise set Loop Mode per clip in the Advanced Import Settings,
  or in code: `anim.get_animation("idle").loop_mode = Animation.LOOP_LINEAR`.
- Held items: add a `BoneAttachment3D` under the `Skeleton3D`, set its bone
  to `RightHand`, and put the weapon scene under it.

## Held items (weapons, tools, shields)

Make them as separate models with a sensible `--height` (sword about 1.0,
staff about 1.6, dagger about 0.4), then attach them to `RightHand` or
`LeftHand` in the game. In three.js:

```js
const hand = hero.getObjectByName('RightHand');
hero.updateMatrixWorld(true);
const s = hand.getWorldScale(new THREE.Vector3()).x;   // the rig is often scaled 0.01
const holder = new THREE.Group();
holder.scale.setScalar(1 / s);                          // back to meters
holder.position.set(0, 0.09 / s, 0.02 / s);             // into the palm
holder.rotation.set(Math.PI / 2, 0, 0);                 // blade forward and up
sword.position.y = -0.14;                               // the grip's height on the model
holder.add(sword);
hand.add(holder);
```

Check the grip from the front and side in screenshots, and adjust the
numbers. Flames, glows and trails are best made in the game: particles along
the blade, a point light, and an emissive material.

## Meshy clips or code?

| Need | Use |
|---|---|
| A humanoid's idle, walk, run, jump, attacks, spells, hit, death | Meshy clips (3 credits each; walk and run free) |
| A crowd of humanoid NPCs | Rig each one and reuse the same action list; or one character cloned with `SkeletonUtils.clone` |
| Blending (walk into run, strafing) | The engine: crossfades and weights, or Godot's AnimationTree |
| Small reactions: flinch, recoil, look-at, aiming, breathing | The engine, layered on top of the clips (additive clips, IK, a bone turned in code) |
| Props: chest lid, door, lever, wheels, spinning pickups | No rig: rotate or move the model's parts in code |
| Animals, monsters, vehicles, anything not two-legged | No rig: a plain model, moved in code (see animating.md). Meshy's `--quadruped` rig is experimental and gave an unusable walk in our test |
| Clips Meshy doesn't have | Search more (`actions <word>`); Quaternius's CC0 animation libraries can be retargeted in Godot. Don't automate Mixamo downloads |

## Animating plain models in code

See `animating.md`: plan the key poses, turn parts about pivots or make each
pose as its own model, and check the motion from more than one angle.

## Prompts and pictures

- Say the style the game uses ("stylized hand-painted", "low-poly flat
  colors", "realistic"), and keep it the same for every asset in a game.
- Name the materials and colors of each part; Meshy textures from what it sees
  or reads.
- Characters: full body, A-pose, front view, legs visible, empty hands, no
  props or base. Short clothes rig better than long robes or gowns.
- Props: the whole object, centered, upright, nothing else in frame.
- Meshy sometimes gives a nearly flat shape for thin things seen only from the
  front (signs, leaves). Add a side view as a second `--image`.

## When things go wrong

| JSON says | What to do |
|---|---|
| `"pending": true` | Run the same command again; no extra cost |
| couldn't find a humanoid pose | The picture needs a clear two-legged A-pose with arms away from the body; make a new picture |
| not enough credits | `balance`; the user may need to top up at meshy.ai |
| its files may have expired, or no longer has the job | Meshy keeps jobs 3 days. For an expired rig, run `rig <name>` (it rigs again and remakes the paid clips), then `animate` again; otherwise run the command again to redo that step |
| warnings about height or ground | Check the preview; use `--height` or `rebuild` |

Meshy's API docs: https://docs.meshy.ai (rate limits, prices and job times
change; `balance` and `--dry-run` are always current for credits).
