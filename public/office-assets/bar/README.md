# Listening bar surfaces

The bar and turntable use app-authored Three.js geometry. Textures are pinned locally at 1K resolution; no runtime CDN requests are needed.

- `wood-*.jpg`: [Wood Table 001, Poly Haven](https://polyhaven.com/a/wood_table_001), [CC0](https://polyhaven.com/license). Original color, OpenGL normal and roughness maps from `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_table_001/wood_table_001_{diff,nor_gl,rough}_1k.jpg`.
- `marble-*.jpg`: [Marble 006, ambientCG](https://ambientcg.com/view?id=Marble006), [CC0 1.0](https://docs.ambientcg.com/license/). Original color, OpenGL normal and roughness maps from `https://ambientcg.com/get?file=Marble006_1K-JPG.zip`.

The preview at `/bar-preview` adds the bar to the main deck's observation lounge, with the central crew lane left clear, and starts focused on that room. The bar is enabled only by the `musicPreview` prop until the design has been reviewed. Click the turntable or its Music label, then choose NetEase Cloud Music to open its official web player in a new browser tab. Authentication, availability and playback are controlled by the provider. The full player refused embedded loading in the browser check, so this prototype uses a normal link and does not embed or proxy provider content. Closing the chooser leaves the external player running.
