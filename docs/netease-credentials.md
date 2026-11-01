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

This saves developer application credentials only. It does not configure the official CLI or connect the Office player. NetEase user authorization, search, and browser playback still need separate verification. A normal NetEase account QR login is separate from these app credentials.
