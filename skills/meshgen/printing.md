# meshgen for 3D printing

Read this when the user wants something printed: a figurine, a miniature, a
toy, a keychain, a part. It replaces the game advice in SKILL.md. A print
has different goals:

| | Game asset | 3D print |
|---|---|---|
| Size | meters, set by `--height` | millimeters, set by `--height-mm` |
| Detail | game-sized (10k-30k triangles) | full detail, no remesh |
| Skeleton and clips | often | never |
| Textures | always | only for full-color or multi-color printers |
| Must be | light and fast to load | solid, watertight, thick enough, printable without collapsing |
| Files | GLB | STL or 3MF for the slicer (plus the GLB to look at) |

## Costs

| Step | Credits |
|---|---|
| `model --print` | 30 (15 with `--draft`) |
| `printcheck` | free |
| `repair` | 10 |
| `multicolor` | 10 |
| `split` | 10 |

Add up the whole plan, say it once in plain words, and wait for a yes,
unless the user already gave you a budget. Meshy's free retries are for its
web app only.

## The picture or prompt

Ask for a shape that prints well. With imagegen2, ask for:

- **One solid, compact object** on a **flat round or square base** (a base
  keeps figurines standing and gives the print a flat first layer).
- **A pose with limbs close to the body**: arms down or touching the body,
  no outstretched fingers, no thin swords or staffs held out. For games we
  want A-pose; for prints we want the opposite.
- **Chunky features**: thick horns, tails resting on the base, no hair
  strands, whiskers, antennae or cloth edges thinner than a couple of mm at
  print size.
- **Few overhangs**: parts hanging out sideways or downward need supports.
  Wings folded, heads not bent far forward, capes touching the base.
- Front view, plain or transparent background, even lighting, no text.

Example: "a chunky stylized tree frog figurine sitting on a round mossy base,
front view, compact pose, thick limbs touching the body, smooth simple
shapes, isolated on a transparent background, no text".

## The steps

```bash
node ${CLAUDE_SKILL_DIR}/meshgen.cjs model frog-figurine --print --image concepts/frog-figurine.png --height-mm 80
node ${CLAUDE_SKILL_DIR}/meshgen.cjs printcheck frog-figurine --height-mm 80 --printer fdm
node ${CLAUDE_SKILL_DIR}/meshgen.cjs repair frog-figurine --height-mm 80 --printer fdm
```

1. **`model --print`** keeps Meshy's full detail and saves
   `source/model.stl` and `source/model.3mf` next to the GLB. Expect big
   files: a frog figurine came back at 1.4 million triangles (a 69 MB STL),
   which slicers handle fine; `--polycount 300000` makes lighter ones.
   `--height-mm` sets the size meshgen previews at; the slicer decides the
   real size, so tell the user what height you planned for.
2. **`printcheck`** (free) reports whether the mesh is watertight, its
   holes, non-manifold edges and degenerate faces, and, with `--height-mm`
   and `--printer`, walls too thin for that printer (FDM 1.0 mm, resin
   0.8 mm, full color 2.0 mm). Read `printability.status` (for example
   `warning` or `error`) and its `metrics`. Meshy's models often show
   hundreds of thousands of "degenerate faces" (zero-area triangles); that
   alone is only a warning, and slicers cope with it.
3. **`repair`** (10) fixes holes and non-manifold edges and thickens thin
   walls for the printer and size you give. Meshy returns a GLB **without
   colors**; meshgen also writes `print/<name>-repair.stl` from it, in
   millimeters at `--height-mm`, Z up, standing on the plate. Use it for
   single-color prints. Run `printcheck` first: when the mesh is watertight
   with no holes and the walls are fine, skip `repair`.
4. Then, if wanted:
   - **`multicolor`** (10) makes a 3MF with up to 16 color regions for a
     multi-color printer: `--colors 6 --style cartoon --printer-brand prusa`
     (`realistic` keeps more texture detail and makes bigger files). Brands:
     bambu (default), anycubic, creality, elegoo, flashforge, prusa, qidi,
     snapmaker, ankermake. Meshy picks the colors: with 6 colors it kept the
     frog's greens, orange toes and cream belly but dropped its small red
     eyes. Tell the user which colors came out (they're listed in the 3MF's
     `Metadata/project_settings.config`), and use more colors when a small
     feature matters.
   - **`split`** (10) cuts a big or awkward model into parts that print
     separately: `--parts "head, body, base"` to choose the cuts (otherwise
     Meshy picks), `--plate` to lay the parts flat ready to slice,
     `--connectors` to add pegs. It saves GLB, STL and 3MF. Split parts lose
     the texture (they get flat colors) and come back at Meshy's own scale,
     so set the size in the slicer.

`repair`, `multicolor` and `split` all start from Meshy's original
full-detail model, never the game remesh. (Meshy's multi-color and split
steps refuse a repaired model, so they can't be chained after `repair`.)
`printcheck` checks the repaired model when there is one.

## Overhangs and supports

meshgen can't measure overhangs. Look at the preview sheet's side and back
views: anything that sticks out more than about 45 degrees from vertical,
with nothing under it, will need supports in the slicer. Tell the user which
parts those are, or make a new picture with a more compact pose. Turning the
model in the slicer (for example lying a sword flat) often removes them.

## Print options

| Option | Meaning |
|---|---|
| `--print` | For `model`: full detail, STL and 3MF, no game remesh |
| `--height-mm <n>` | Planned print height in millimeters |
| `--printer <type>` | `fdm` (default), `sla` (resin) or `full_color` |
| `--colors <n>` | `multicolor`: up to 16 (default 4) |
| `--style <s>` | `multicolor`: `realistic` (default) or `cartoon` |
| `--printer-brand <b>` | `multicolor`: slicer preset brand (default `bambu`) |
| `--parts <text>` | `split`: the parts to cut along |
| `--plate` | `split`: lay parts flat on the build plate |
| `--connectors` | `split`: add pegs between parts |

## Files

```
assets/meshgen/frog-figurine/
  frog-figurine.glb            to look at (preview, view)
  source/model.stl, model.3mf  Meshy's full-detail print files
  print/frog-figurine-repair.glb and .stl, -multicolor.3mf, -split.glb/.stl/.3mf
```

Hand the user the STL or 3MF and the planned height. Slicing (supports,
infill, orientation) happens in their slicer: Bambu Studio, PrusaSlicer,
OrcaSlicer, Cura and others.
