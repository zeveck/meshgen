# Animating models Meshy can't rig

Read this when the user wants an animal, monster or other model without a
humanoid rig to move: a fish swimming, a dragon flying, a frog hopping. Meshy
rigs only humanoids (its four-legged rig is experimental and came back
unusable in testing), so the motion is made in the game's code. The
[Creature Showcase](https://zeveck.github.io/meshgen/creatures/) does it
for a fish, a dragon, a frog and a cat (source:
https://github.com/zeveck/meshgen/blob/main/examples/creatures/showcase.js).

## 1. Describe the motion as key poses first

Before writing code, write down what the motion looks like at its key
moments, as an animator would. Think about how the real animal moves, not
about what's easiest to code. For example:

- **Frog hop:** crouch; push off with the body stretched out level and both
  hind legs straight back; land front feet first and fold back to sitting.
- **Bird or dragon wingbeat:** each wing turns at the shoulder; a quick,
  strong downstroke, a slower upstroke; the tips trail a little behind.
- **Fish swim:** a wave travelling from head to tail, bigger toward the tail.
- **Four-legged trot:** legs swing in diagonal pairs (front left with back
  right) about the hips and shoulders, and the body bobs twice per stride.

## 2. Check whether the model can reach those poses

Look at the preview sheet. Meshy's models are one surface, so a part can
only move on its own if it's clearly separate from the body.

- **Parts that stick out** (wings, tails, fins, long legs): turn them about
  a pivot (shoulder, hip, tail root) in a vertex shader or by moving
  vertices. Don't shear or stretch them; that flattens them into sticks.
- **Parts fused into the body** (a sitting frog's folded legs, a curled
  tail): they can't be bent out without smearing the surface. Make each key
  pose as its own model instead. Edit the original picture with imagegen2
  ("the same frog, mid-leap, seen from the side, legs stretched back"), make
  it with `meshgen model`, and swap the models at a moment the motion hides,
  such as the squash on takeoff and landing. Each pose is 30 credits.

A picture's view decides what the model is good at: a flat front view of
spread wings gives thin wings that read well only from above or below.

## 3. Check it from more than one angle

Render frames of the motion from at least two directions (the side and the
front, or the angles the game's camera uses) and compare them with the key
poses from step 1. A motion can look right from one side and broken from
another. Show moving parts from angles where they face the camera.

## Doing it in three.js

1. **Bake the model into meters.** Apply each mesh's world matrix to its
   geometry, so shader code sees the model's own space (+Y up, +Z front):

   ```js
   gltf.scene.updateMatrixWorld(true);
   gltf.scene.traverse((o) => { if (o.isMesh) o.geometry = o.geometry.clone().applyMatrix4(o.matrixWorld); });
   ```

2. **Add a deformation** after three.js computes `transformed`:

   ```js
   mesh.material.onBeforeCompile = (shader) => {
     Object.assign(shader.uniforms, { uTime, uMaxZ, uLen }); // { value: ... }; update uTime each frame
     shader.vertexShader = 'uniform float uTime, uMaxZ, uLen;\n' + shader.vertexShader.replace(
       '#include <begin_vertex>',
       `#include <begin_vertex>
        float along = clamp((uMaxZ - position.z) / uLen, 0.0, 1.0);   // 0 head, 1 tail
        transformed.x += uLen * 0.16 * pow(along, 1.7) * sin(uTime * 5.0 - along * 5.5);`);
   };
   mesh.material.customProgramCacheKey = () => 'fish';
   ```

   - **Swimming:** a sine wave down the body, stronger toward the tail.
   - **Wings:** turn each wing's vertices about the shoulder by an angle
     that follows the wingbeat; the tips can lag a little behind.
   - **Legs:** turn the vertices below the hips forward and back about the
     hip, in diagonal pairs for a trot.
   - **Hops:** squash and stretch the whole model (scale y up, x and z down),
     and move it along an arc.

3. **Check the picture's view.** Meshy usually turns a creature to face +Z
   even when the picture was a side view, but not always. Look at the
   preview's front view before choosing the body axis.
