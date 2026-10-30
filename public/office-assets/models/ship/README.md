# Ship plants and machinery

Author: Quaternius. License: CC0 1.0 Universal.

| Local model | Original model | Free Standard pack |
| --- | --- | --- |
| rainforestTree | CommonTree_1 | Stylized Nature MegaKit |
| rainforestFern | Fern_1 | Stylized Nature MegaKit |
| rainforestBush | Plant_1_Big | Stylized Nature MegaKit |
| rainforestRock | Rock_Medium_1 | Stylized Nature MegaKit |
| machineConsole | Prop_Computer | Modular Sci-Fi MegaKit |
| machineFan | Prop_Fan_Small | Modular Sci-Fi MegaKit |

Sources:

- https://quaternius.itch.io/stylized-nature-megakit
- https://quaternius.itch.io/modular-sci-fi-megakit

Only these six models and their referenced textures are bundled. Geometry and
authored PBR maps are retained; tree height is scaled to 0.55 on Y to fit the pressure hull. Texture dimensions are capped at 1024 pixels and
encoded as lossless WebP using the glTF `EXT_texture_webp` extension. Materials
keep their alpha cutouts, normal maps and roughness; sci-fi trim uses the neutral
variant. Shared texture files avoid repeated downloads. Total asset payload is
about 5.5 MB, before HTTP compression. Loading is local and optional; procedural
fallbacks preserve the room layout if an asset is unavailable.

`SOURCE.json` pins the original archive hashes and the bundled model, buffer and
texture hashes. Original license notices are in the repository's `licenses/`.
