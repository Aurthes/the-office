# Ship pets and service robots

Only four selected models are bundled, totaling about 2.34 MB. They load locally
on the main deck. Geometry, materials and textures are cached and reused; the
robots add no lights, shadow passes or transmission render passes.

| File | Author | License | Triangles | Location |
| --- | --- | --- | ---: | --- |
| cat.glb | Kenney | CC0 1.0 | 684 | Observation lounge |
| dog.glb | Kenney | CC0 1.0 | 490 | Observation lounge |
| mech-drone.glb | Willy Decarpentrie | CC BY 4.0 | 9,059 | Maintenance bay |
| core-bartender.glb | Anthony Monteagudo | CC BY 4.0 | 34,677 | Behind the lounge bar |

Sources:

- [Cube Pets 2.0](https://kenney.nl/assets/cube-pets), Kenney.
- [Mech Drone](https://sketchfab.com/3d-models/mech-drone-8d06874aac5246c59edb4adbe3606e0e), Willy Decarpentrie.
- [C.O.R.E. the Robot Bartender](https://sketchfab.com/3d-models/core-the-robot-bartender-aaea45be393045e09843afd08dac0f7d), Anthony Monteagudo.

The robot files were obtained from the public
[Ai2 Objaverse collection](https://huggingface.co/datasets/allenai/objaverse),
with their original model IDs, author credits and CC BY 4.0 metadata intact.
`SOURCE.json` records the exact mirror revision, paths, source hashes and bundled
file hashes. The Kenney archive hash is recorded there as well.

Processing used glTF Transform 4.5.1 and meshoptimizer 1.3.0. C.O.R.E.'s geometry
was simplified from 98,130 triangles and quantized; its transmission was replaced
with alpha blending. Mech Drone's legacy specular/glossiness materials were
converted to metallic/roughness for the current Three.js loader. All models
retain their authored colors and normal maps. Texture edges are capped at 256px
for the drone and 128px for the other models, then encoded as WebP. Redundant
data and duplicate textures were removed. The combined decoded RGBA texture
footprint is approximately 7.3 MiB including mipmaps; actual GPU allocation and
frame cost depend on the browser and device.

Pets blend their supplied idle, walk, run and eating clips with procedural
resting and stretching poses. They choose independent activities and use the
ship's existing corridor routes to visit common cabins. Mech Drone combines its
supplied flight animation with inspection, repair and charging behaviours.

C.O.R.E. has no authored animation. At load time the app assigns its existing
rigid arm parts to a small procedural skeleton. Both arms share one skeleton;
the original triangle count, materials, texture maps and material draw count
are retained. Inverse kinematics moves its actual grippers to glasses, cleaning
cloths and the existing bottle positions. Its routine includes washing glasses,
checking stock, pouring drinks and wiping the counter. Small visual effects use
ordinary geometry and alpha materials, without extra lights or transmission.

All four NPCs use the existing selection camera and information card, with live
activity text. A selected moving NPC stays in view until the user moves the
camera. Behaviour and animation pause on hidden decks; changing views preserves
their current routine. Animation mixers, cloned skeletons and procedural buffers
are released when the scene unmounts. There is one cat, one dog, one drone and
one bartender; no additional character assets or network services are needed.

License notices: `licenses/Kenney-Cube-Pets.txt` and
`licenses/Companion-Robots-CC-BY-4.0.txt`. Changes listed above are adaptations
by The Office contributors; original authors do not endorse this project.
