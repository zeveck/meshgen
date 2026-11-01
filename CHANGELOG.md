# Changelog

## 2026.11.1.2

- 3D printing has its own guide, `printing.md`, which the skill reads only when you ask for a print: sizes in millimeters, solid shapes, overhangs and supports. Game requests never load it.
- `model --print` keeps full detail and saves STL and 3MF. New print steps: `repair` (also writes a slicer-ready STL in millimeters), `multicolor` (a multi-color 3MF for your printer) and `split` (parts that print separately, with optional pegs).
- `--quadruped` asks Meshy for a four-legged rig. It's experimental: in testing the rig came back far too small (meshgen now rescales a rig that comes back more than twice off the height you asked for) and its walk clip wasn't usable.
- Two meshgen commands can now work on the same asset at once without losing each other's Meshy job records.
- The skill adds up the cost of a whole request and asks once.
- Fixes from a bug review (#1): a lost answer from Meshy can no longer attach another asset's model; a new rig remakes the clips made for the old one; a rerun keeps the height, clips and options you chose before; jobs Meshy has deleted are remade on the next run instead of getting stuck; two commands on one asset keep each other's clips; a busy Meshy respects `--wait`; tiny rigs are resized exactly.
- Fixes from a second review (#2): a text model whose preview Meshy has deleted is remade instead of getting stuck; `--draft` refuses 4k and 8k textures from text before spending anything; a new rig keeps the walk and run clips; a rerun collects a job it already paid for even when the balance is low; `rebuild --height` on a rigged character explains how to change its height.
- New demos: the Creature Showcase (a fish, dragon, frog and cat animated in code) and a gallery page at zeveck.github.io/meshgen.

## 2026.11.1

First release.

- `meshgen model` makes a textured 3D model from text, or from 1 to 4 pictures (front view first).
- `meshgen character` makes a rigged, animated character in one step: model in A-pose, rig, animations, preview.
- `meshgen rig` and `meshgen animate` add a skeleton and clips by plain names (idle, walk, run, jump, slash, cast, hit, die and more) or any of Meshy's 600+ library actions.
- Every asset ends up as one GLB with all its clips, in meters, standing on the ground. Clips play in place unless you ask for root motion.
- Models come out game-sized (30,000 triangles for characters, 10,000 for props); `meshgen remesh` changes that later.
- `meshgen preview` saves a screenshot sheet (four views plus frames of every clip); `meshgen view` opens an interactive viewer.
- `meshgen printcheck` runs Meshy's free 3D-print check; `--formats stl,3mf` gets print files.
- Jobs survive interruptions: run the same command again and it picks up where it left off without paying twice.
- `balance`, `actions`, `inspect` and `--dry-run` are free.
