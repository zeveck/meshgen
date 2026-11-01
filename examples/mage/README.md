# Mage Playground

A small three.js scene built from four meshgen commands: a spiky-haired mage
with one purple and one red sunglass lens, a crystal staff, and a sword that
burns. Topple the training dummies with the sword, fireballs and an arcane
nova.

Run it from this folder with any static server, for example
`python3 -m http.server 8790`, then open http://localhost:8790.

| Keys | Action |
|---|---|
| W A S D (Shift to run) | Walk and run |
| Space, Q | Jump, dodge roll |
| J or click | Flaming sword |
| K or right-click | Fireball |
| L | Arcane nova |
| E, H, X | Wave, take a hit, collapse (X again to get up) |
| Drag | Turn the camera |

## How it was made

The pictures in `concepts/` came from imagegen2. Then:

```bash
meshgen character mage --image concepts/mage.png --height 1.75 \
  --actions idle,walk,run,jump,slash,cast,spell=129,hit,die,dodge,wave
meshgen model staff --image concepts/staff.png --height 1.6
meshgen model sword --image concepts/sword.png --height 1.0
meshgen remesh staff
meshgen remesh sword
```

That came to 137 Meshy credits: 67 for the mage (30 model, 5 remesh, 5 rig,
27 for nine clips; walk and run were free), and 35 each for the staff and
sword (30 for the model, 5 for the remesh). meshgen now asks Meshy for
game-sized meshes up front, so the remeshes aren't needed and the same
assets would cost 122.

The weapons are separate models attached to the `RightHand` and `LeftHand`
bones in `game.js`. The flames, fireballs, nova and dummies are all made in
code.
