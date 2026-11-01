# Changelog

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
