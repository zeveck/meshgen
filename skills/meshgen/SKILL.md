---
name: meshgen
description: Make 3D game assets with Meshy through a bundled zero-dependency CLI - textured models from text or pictures (props, weapons, buildings, creatures), rigged and animated humanoid characters (idle, walk, run, jump, attacks, spells, hit, die and 600+ more), one game-ready GLB each for three.js, Godot or other engines, screenshot previews, and STL/3MF files for 3D printing. Use when someone asks for a 3D model, 3D character, rig, 3D animation or 3D print.
disable-model-invocation: false
allowed-tools: "Bash(node ${CLAUDE_SKILL_DIR}/meshgen.cjs *), Bash(node */meshgen/meshgen.cjs *)"
argument-hint: <what to make> [--image picture.png] [--actions idle,walk,run,...] [--height meters] [--draft]
---

# meshgen

meshgen turns a description or a picture into a 3D model with Meshy, and can
rig and animate humanoid characters. Each asset ends up as one GLB file with
all its animation clips, in meters (`--height` sets the size). Models stand
on the ground (y = 0), and Meshy's characters face +Z. That's what three.js,
Godot and most engines expect; the preview sheet and the JSON `warnings` show
when something is off.

The CLI sits next to this file:

```bash
node ${CLAUDE_SKILL_DIR}/meshgen.cjs <command> <name> [options]
```

It reads `MESHY_API_KEY` from the project's `.env`. Every command prints one
JSON line on stdout; progress goes to stderr.

Ask the user questions in plain words in your reply. Never use a question tool.

**For a 3D print** (a figurine, miniature, toy or part to print), read
`${CLAUDE_SKILL_DIR}/printing.md` first and follow it instead of the game
advice below: prints need millimeters, full detail, solid printable shapes
and no rig.

**To animate a model without a humanoid rig** (an animal, monster or
creature to swim, fly, hop or walk), read `${CLAUDE_SKILL_DIR}/animating.md`
before writing the motion code.

## Costs

Meshy charges credits (about $0.02 each on the Pro plan). Before spending,
add up what the whole request will cost, say it once in plain words ("4
models and a rigged character: about 170 credits, roughly $3.40. Go
ahead?") and wait for a yes, unless the user already gave you a budget (for
example through gamegen). Leave room for a retry or two in that number:
Meshy's free retries are only for its web app, so an API redo costs full
price. `--dry-run` shows the exact cost of one command without calling
Meshy, and `balance` shows what's left.

| Asset | Credits |
|---|---|
| Model from text or a picture | 30 (`--draft`: 15, rougher) |
| Character: model, rig, idle/walk/run/jump/attack/hit/die | about 50 |
| Each extra animation | 3 (walk and run come free with every rig) |
| Remesh | 5 |
| `balance`, `actions`, `inspect`, `preview`, `view`, `rebuild`, `--dry-run` | free |

## Text or picture?

- **Picture first** for characters and anything whose look matters. Make the
  picture with the imagegen2 skill if it's installed (or use one the user
  gives you), show it, and only then spend 3D credits. Pictures cost cents and
  keep details: in a test, the text route turned a "spiky-haired mage in a
  short tunic with purple and red sunglass lenses" into a robed figure with a
  hair bun, while the picture route kept every detail.
- **Text** is fine for simple props, or when there's no picture tool.

A good picture for meshgen: one subject, full body or full object, front
view, plain or transparent background, even lighting, no cast shadows, no
text. For characters also: A-pose (arms angled down and away from the body),
legs apart and visible (no long robes or gowns covering the legs), empty
hands. More views (side, back) can follow the front one as extra `--image`s.

## Characters

```bash
node ${CLAUDE_SKILL_DIR}/meshgen.cjs character hero --image concepts/hero.png --height 1.8 \
  --actions idle,walk,run,jump,slash,cast,hit,die
```

This makes the model in A-pose, rigs it, adds the clips, and writes
`assets/meshgen/hero/hero.glb` plus a preview sheet. Clips are named after the
words you used.

- Rigging works on **two-legged humanoids** with clear arms and legs. For
  animals, creatures, vehicles and props, make a plain `model` and animate it
  in the game's code (see animating.md). `--quadruped` asks Meshy for a
  four-legged rig with a walk clip. It is experimental: in our test (a cat)
  Meshy's rig came back about 60 times too small (meshgen rescales that) and
  its walk clip was unusable, so check the preview before relying on it.
- **Held items** (swords, staffs, shields, guns) work best as separate
  `model`s attached to the hand bone in the game (`RightHand`, `LeftHand`).
  They rig cleaner, can be swapped, and effects like flames belong to the
  game. Make the character with empty hands.
- Plain action names: idle, walk, run, jump, attack, slash, combo, cast, hit,
  die, block, dodge, punch, kick, wave, cheer, bow, taunt, dance,
  combat-idle, crouch, swim, climb, fall, get-up, sit, sleep, push, pickup.
  For anything else, search the library (`actions <word>`), then use
  `name=<id>`, like `spell=129`.
- Clips play in place, so the game moves the character. `--root-motion`
  keeps the clips' own forward movement.
- Add clips later with `animate hero dance wave` (3 credits each).

## Props and other models

```bash
node ${CLAUDE_SKILL_DIR}/meshgen.cjs model treasure-chest --prompt "wooden treasure chest with iron bands" --height 0.6
node ${CLAUDE_SKILL_DIR}/meshgen.cjs model sword --image concepts/sword.png --height 1.0
```

`--height` scales the model in meters; give one for every game asset, since
without it a model keeps whatever size Meshy picked. Either way it stands on
the ground. Models come out game-sized: 10,000
triangles for props, 30,000 for characters. Change it with `--polycount`, or
later with `remesh` (5 credits).

## Checking the result

Always look at the preview sheet before calling an asset done:
`preview/sheet.png` in the asset's folder (`preview` makes it again). The
first row shows front, three-quarter, side and back views with the height,
and a red arrow on the ground pointing to the front (+Z). Each further row
shows four frames of one clip. Check that:

- it looks like the picture or description;
- the character faces the arrow, stands on the ground and is the right size;
- every clip moves the way its name says, with no twisted limbs;
- the JSON `warnings` list is empty (`notes` are just information).

`view <name>` serves an interactive viewer (orbit, play each clip, show the
bones) for the user to open in a browser. Run it in the background.

If Meshy is still busy when the command's wait runs out, the JSON says
`"pending": true`. Run the same command again; it picks the job back up
without paying twice.

## Commands and options

| Command | What it does |
|---|---|
| `balance` | Credits left and the reset date |
| `actions [word]` | Plain action names, or search Meshy's library |
| `model <name>` | Textured model from `--prompt` or `--image` |
| `character <name>` | Model in A-pose, rig, `--actions`, preview |
| `remesh <name>` | New triangle count (`--polycount`) |
| `rig <name>` | Skeleton plus the free walk and run; remakes the paid clips on it (3 each) |
| `animate <name> <actions...>` | More clips |
| `rebuild <name>` | Remake the final GLB from saved files (free) |
| `inspect <name or file.glb>` | Height, triangles, bones, clips, textures |
| `preview <name or file.glb>` | Screenshot sheet (`--clips` picks clips) |
| `view <name or file.glb>` | Interactive viewer on `--port` (default 8737) |
| `printcheck`, `repair`, `multicolor`, `split` | 3D printing: see printing.md |

| Option | Meaning |
|---|---|
| `--prompt <text>` | What to make |
| `--image <path or url>` | Reference picture; repeat for more views (front first, up to 4) |
| `--texture-prompt <text>` | Extra texture guidance |
| `--draft` | Cheaper, rougher model |
| `--height <meters>` | Character height for rigging, or a model's height |
| `--polycount <n>` | Triangles (100-300000) |
| `--topology <t>` | `triangle` (default) or `quad` |
| `--pose <p>` | `a-pose`, `t-pose` or `none` |
| `--pbr` | Metallic, roughness and normal maps |
| `--texture <res>` | What Meshy paints: `2k`, `4k`, `8k` (`--draft`: 2k only) |
| `--max-texture <px>` | Shrink the GLB's PNG textures to fit (default 1024; 0 keeps them) |
| `--formats <list>` | `glb` plus any of `fbx`, `obj`, `usdz`, `stl`, `3mf` (saved in `source/`) |
| `--actions <list>` | Clips for `character` |
| `--quadruped` | Four-legged rig, walk clip only (experimental) |
| `--root-motion` | Keep clips' forward movement |
| `--no-root-motion` | Back to in-place clips (`rebuild`, `animate`) |
| `--dir <path>` | Where asset folders go (default `assets/meshgen`) |
| `--max-credits <n>` | Refuse to start if the estimate is higher |
| `--wait <seconds>` | How long to wait for Meshy (default 540) |
| `--clips <list>` | For `preview` |
| `--port <n>` | For `view` |
| `--category <name>` | For `actions` |
| `--dry-run` | Show requests and credits, call nothing |
| `--no-history` | Skip `.meshgen-history.jsonl` |

## Files

```
assets/meshgen/hero/
  hero.glb          the game file: mesh, skeleton, every clip
  meshgen.json      what was asked, Meshy job ids, clips, credits
  preview/sheet.png the screenshot sheet
  source/           Meshy's downloads (rigged model, clips, thumbnail, other formats)
```

meshgen never overwrites an asset: a new `model` with a taken name becomes
`hero-v2`. Meshy deletes its copies after 3 days, so `source/` is the only
lasting copy; keep it while the asset is in progress. Once a rig has expired,
`animate` stops and says to run `rig <name>`, which rigs again and remakes the
paid clips.

Read `${CLAUDE_SKILL_DIR}/reference.md` for loading the GLB in three.js or
Godot, attaching held items, deciding between Meshy clips and code-driven
animation, and more prompt tips.
