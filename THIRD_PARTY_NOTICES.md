# Third-party notices

## Claw3D

The Office is derived from [iamlukethedev/Claw3D](https://github.com/iamlukethedev/Claw3D).
The initial source base is commit `0565b7892909eca7bbc8f2d9b0fad171dd75ad7c`.
Original copyright: **Copyright (c) 2026 Luke The Dev**.
License: **MIT**, preserved in the repository's [LICENSE](LICENSE).
Upstream history and source attribution are retained.

## OpenClaw browser gateway client

`src/lib/gateway/openclaw/GatewayBrowserClient.ts` is adapted from OpenClaw's
`ui/src/ui/gateway.ts`. Its existing provenance header identifies OpenClaw
2026.2.12, commit `f9e444dd56ccfc2271e8ae1729b7a14a55e1c11e`.

- Source: [OpenClaw](https://github.com/openclaw/openclaw).
- Original copyright: **Copyright (c) 2025 Peter Steinberger**.
- License: **MIT**; the full upstream notice is included in
  [licenses/OpenClaw-MIT.txt](licenses/OpenClaw-MIT.txt), from tag `v2026.2.12`.

Compatibility with its gateway protocol does not bundle the OpenClaw runtime.

## Furniture models

The GLB furniture assets under `public/office-assets/models/furniture/` originate
from [Kenney's Furniture Kit](https://kenney.nl/assets/furniture-kit), inherited
through Claw3D. They retain the kit's **Creative Commons CC0** terms.

Source pack: <https://kenney.nl/assets/furniture-kit>.
License: <https://creativecommons.org/publicdomain/zero/1.0/>.
All 17 bundled GLB files were verified byte-for-byte against the official kit
archive when preparing this publication. The original kit notice is included in
[licenses/Kenney-Furniture-Kit.txt](licenses/Kenney-Furniture-Kit.txt).
Credit to Kenney is retained even though CC0 does not require attribution.

## Ship plants and machinery

The selected models in `public/office-assets/models/ship/` are by **Quaternius**,
from the free Standard versions of
[Stylized Nature MegaKit](https://quaternius.itch.io/stylized-nature-megakit) and
[Modular Sci-Fi MegaKit](https://quaternius.itch.io/modular-sci-fi-megakit).
Both are **CC0 1.0 Universal**. The original notices are preserved in
[licenses/Quaternius-nature-Standard.txt](licenses/Quaternius-nature-Standard.txt)
and [licenses/Quaternius-scifi-Standard.txt](licenses/Quaternius-scifi-Standard.txt).

Geometry and authored surface maps are retained. Textures are shared, limited to
1024 pixels and encoded as lossless WebP; sci-fi trim uses the pack's neutral
color variant. The exact source selections, archive hashes and bundled file
hashes are recorded in [SOURCE.json](public/office-assets/models/ship/SOURCE.json).

## Environment lighting

`public/environments/potsdamer_platz_1k.hdr` is **Potsdamer Platz** by **Greg Zaal**,
from [Poly Haven](https://polyhaven.com/a/potsdamer_platz), under
[CC0](https://polyhaven.com/license).
The exact bundled-source revision is recorded in
[public/environments/README.md](public/environments/README.md).

## Return pod visual reference

The return pod uses original procedural geometry. Its visual direction references
[Helldivers Drop Pod by Metekohy](https://sketchfab.com/3d-models/helldivers-drop-pod-387d376c7a77462796b553d284c20652).
The referenced model was not offered for download or licensed for reuse when
reviewed; its mesh and textures are not included in this repository.

## Package dependencies

Dependencies retain their individual licenses and notices as shipped with their
packages. The root MIT license does not replace their terms. Dependency versions
and integrity hashes are recorded in `package-lock.json`.
