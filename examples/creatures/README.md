# Creature Showcase

Four Meshy models brought to life in code: a betta fish swimming, a dragon
flying, a tree frog hopping across lily pads, and a cat trotting. None of them
has a skeleton. The animation is a few lines of vertex shader each, plus
paths, squash and stretch, in `showcase.js`.

Play it at https://zeveck.github.io/meshgen/creatures/, or serve the
`examples` folder (this page borrows the mage example's three.js) with
`python3 -m http.server 8791` and open http://localhost:8791/creatures/.
Click a scene to see it on its own.

## How it was made

The pictures in `concepts/` came from imagegen2. Then, 30 credits each (125 in all, with the cat's 5-credit rig test below):

```bash
meshgen model betta --image concepts/betta.png --height 0.07
meshgen model dragon --image concepts/dragon.png --height 1.0
meshgen model frog --image concepts/frog.png --height 0.08
meshgen model cat --image concepts/cat.png --height 0.3
```

The cat was also a test of Meshy's experimental four-legged rig
(`meshgen rig cat --quadruped`, 5 credits). The rig came back about 60 times
too small and its walk clip had the cat dropping to the ground, so the trot
here is made in code like the others.
