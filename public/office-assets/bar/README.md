# Listening bar surfaces

The bar and turntable use app-authored Three.js geometry. Textures are pinned locally at 1K resolution; no runtime CDN requests are needed.

- `wood-*.jpg`: [Wood Table 001, Poly Haven](https://polyhaven.com/a/wood_table_001), [CC0](https://polyhaven.com/license). Original color, OpenGL normal and roughness maps from `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_table_001/wood_table_001_{diff,nor_gl,rough}_1k.jpg`.
- `marble-*.jpg`: [Marble 006, ambientCG](https://ambientcg.com/view?id=Marble006), [CC0 1.0](https://docs.ambientcg.com/license/). Original color, OpenGL normal and roughness maps from `https://ambientcg.com/get?file=Marble006_1K-JPG.zip`.

The preview at `/bar-preview` adds the bar to the main deck's observation lounge, with the central crew lane left clear, and starts focused on that room. The bar is enabled only by the `musicPreview` prop until the design has been reviewed. The Music label appears on mouse hover or keyboard focus; touch users tap the turntable directly.

Choose NetEase Cloud Music to load its full official web interface (`https://music.163.com/st/webplayer`) inside the office. The app never launches a browser tab for this action. The CSP permits this exact frame origin. The frame sandbox permits scripts, provider-origin storage and forms while preventing popups and top-level navigation; provider features requiring a popup cannot escape into another tab. Search, sign-in, song selection, availability and playback belong to NetEase. Minimize (or Escape) hides the dialog while preserving its iframe; click the turntable to return. The stop/close button and returning to the player chooser unload the iframe. Reload creates a fresh iframe when the provider needs to reconnect. No provider credentials or music data are handled by the app's server.

Known blocker, verified 2026-10-31: the full web client includes browser auth redirects to `/login`, and both `/login` and `/discover` return `X-Frame-Options: SAMEORIGIN`. They cannot load inside the cross-origin Office frame. The entry page's HTTP 200 and passing local UI tests do not establish working login or playback; this full-client prototype remains unaccepted. A separate supported music integration needs an agreed design.
