# Local NetEase developer credentials

Run this from the repository in an interactive terminal with Node.js 20 or newer:

```sh
node scripts/setup-netease-credentials.js
```

Enter only the developer application's `appId` value, then press Enter. App ID input is visible, and the script displays `Using App ID: ...` so you can check what was accepted. Empty values or values containing spaces prompt you to retry before entering the private key.

Then paste `privateKey` and press Enter. Only private key input is hidden. The key can be a single-line Base64 value or the complete PEM, including its BEGIN and END lines. For multiline PEM, press Enter after the END line. The public key is not needed. Ctrl+C cancels before saving.

The script checks the RSA key format locally and stores JSON containing `appId` and `privateKey` at:

```text
~/.config/the-office/netease/credentials.json
```

The `the-office` and `netease` directories have mode `700`; the file has mode `600`. The JSON is plaintext, protected by the operating system's file permissions, not encrypted. The script refuses symlinked credential directories and does not overwrite an existing file. No dependency installation or network request is made.

Keep the file outside the repository and the public assets directory. Do not paste credentials into chat, commands, frontend code, or `NEXT_PUBLIC_*` variables. The browser must not receive the developer private key.

The script saves developer application credentials only. Open the listening bar's turntable in Office, choose NetEase, then use the sign-in QR or the official authorization link. Account authorization is separate from developer credentials. An existing Office authorization is reused, and expired access tokens are refreshed when possible; revoked or expired authorization offers sign-in again.

Account tokens are stored in `authorization.json` beside the credentials with mode `600`. A pending sign-in uses `pending-authorization.json`, also mode `600`, and expires after five minutes. The server signs requests and keeps credentials and account tokens out of browser responses. The browser receives song metadata, a temporary audio URL, or a sign-in QR/link.

Personal developer applications use the device descriptors from the official `@music163/ncm-cli` 0.1.7 client. Search uses `/openapi/music/basic/search/song/get/v3`; playback uses `/openapi/music/basic/song/detail/get/v2` with `withUrl`, which is available to personal apps even when the separate `song/playurl` endpoint is not. Availability, previews and account entitlements are enforced by NetEase. Browser playback requires a user action; if automatic start is blocked, tap the audio controls.

The personal developer/CLI channel does not have the same playback catalog as the NetEase app. The [official FAQ](https://developer.music.163.com/st/developer/document?docId=3b75ab8e475d41ca93d91ebd4dfd383f) states that copyright restrictions can prevent CLI playback even for SVIP users. An unavailable track is not necessarily an account setup error. `visible` and `playFlag` determine list availability; `freeTrailFlag` advertises preview support, while the actual `freeTrail` returned with a playback URL determines a preview's limits.

Daily recommendations use `/openapi/music/basic/recommend/songlist/get/v2`. Scene recommendations search playlists with `/openapi/music/basic/search/playlist/get/v2`, then retrieve their songs with `/openapi/music/basic/playlist/song/list/get/v3`. This does not require the separately authorized AI playlist API.
