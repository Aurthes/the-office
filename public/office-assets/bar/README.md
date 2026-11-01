# Listening bar surfaces

The bar and turntable use app-authored Three.js geometry. Textures are pinned locally at 1K resolution; no runtime CDN requests are needed.

- `wood-*.jpg`: [Wood Table 001, Poly Haven](https://polyhaven.com/a/wood_table_001), [CC0](https://polyhaven.com/license). Original color, OpenGL normal and roughness maps from `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_table_001/wood_table_001_{diff,nor_gl,rough}_1k.jpg`.
- `marble-*.jpg`: [Marble 006, ambientCG](https://ambientcg.com/view?id=Marble006), [CC0 1.0](https://docs.ambientcg.com/license/). Original color, OpenGL normal and roughness maps from `https://ambientcg.com/get?file=Marble006_1K-JPG.zip`.

The bar is in the main deck's observation lounge, with the central crew lane left clear. `/bar-preview` starts focused on that room. The Music label appears on mouse hover or keyboard focus; touch users tap the turntable directly.

Choose NetEase Cloud Music to search and play through the official API inside Office. Developer credentials and account authorization stay on the server; see [credential setup](../../../docs/netease-credentials.md). Sign-in uses a locally generated QR or an explicit official authorization link for phone users. Closing the panel, pressing Escape, or clicking its backdrop keeps the same audio playing as background music. A compact control panel floats over the camera view with the song, pause/resume, volume and a separate Stop button. Click the song or turntable to reopen the full player. Returning to the chooser stops playback; Reload restarts the player. Account entitlements and preview limits still apply.

The earlier full-site iframe prototype could not complete sign-in because NetEase's login and discovery pages forbid cross-origin framing. The API player replaces that prototype.
