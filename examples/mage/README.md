# Mage Playground

A small three.js scene built from four meshgen commands: a spiky-haired mage
whose hair and sunglass lenses are half purple and half red, a crystal staff,
and a sword that burns. Topple the training dummies with the sword, fireballs
and an arcane nova.

Play it at https://zeveck.github.io/meshgen/mage/ (keyboard and mouse, or touch), or run it from this folder with any static server, for example
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

On a phone or tablet, a stick on the left walks (push it to the edge to run)
and buttons on the right swing the sword, throw a fireball, cast the nova,
jump and roll; "…" opens wave, hit and fall. Drag anywhere else to turn the
camera.

## How it was made

The pictures in `concepts/` came from imagegen2. The mage's prompt was based
on an art piece by Derek Zielinski. Then:

```bash
meshgen character mage --image concepts/mage.png --height 1.75 \
  --actions idle,walk,run,jump,slash,cast,spell=129,hit,die,dodge,wave \
  --texture-prompt "Spiky hair split down the middle: the half on the same side as the purple lens is vivid purple, the other half vivid red, front and back. Round sunglasses with one vivid purple lens and one vivid red lens. Tall navy stand-up collar with gold trim."
meshgen model staff --image concepts/staff.png --height 1.6
meshgen model sword --image concepts/sword.png --height 1.0
meshgen remesh staff
meshgen remesh sword
```

The mage took 62 Meshy credits: 30 for the model, 5 for the rig and 27 for
nine clips (walk and run were free). The staff and sword took 35 each: 30 for
the model and 5 for a remesh. meshgen now asks Meshy for game-sized meshes up
front, so those remeshes aren't needed anymore.

The weapons are separate models attached to the `RightHand` and `LeftHand`
bones in `game.js`. The flames, fireballs, nova and dummies are all made in
code.
