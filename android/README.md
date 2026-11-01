# Office Android wrapper

A small Android 8+ app that displays the existing HTTPS Office. Voice still uses
the same browser WebRTC, Office WebSocket owner, Codex thread and native timeline.
It does not implement a second chat client or require a new backend service.

## Install and use

Install the prototype APK, paste your Office HTTPS address, and sign in normally.
The app has its own web login; Chrome cookies are not imported. Start voice with
the headphones button. Grant microphone access and allow call notifications.
The notification offers Mute, End call, and a return to the same Office window.
Changing workers continues to use the original call and its original session.

Ending the call releases the microphone and Android foreground service. Removing
the app from Recents ends its call. Process death never automatically restarts a
microphone session. Changing the configured Office address requires hangup.

## Background behavior and current validation boundary

The application retains one WebView when its Activity is backgrounded or
recreated. It deliberately does not pause WebView timers at screen lock. Before
opening the microphone, the webpage waits for a foreground service declared as
`microphone|mediaPlayback`. This follows Android's microphone permission and
foreground-start rules. The service displays an ongoing call notification.
Notification controls return to the same webpage call using its unique voice ID;
stale controls cannot stop another call. If hangup is not acknowledged, the
wrapper reloads the document to release media and the owning WebSocket.

This is a prototype to validate reuse of the existing WebRTC engine. A foreground
service is not proof that every Android/System WebView version will keep capture,
playback and networking alive. Physical-device lock-screen validation is required
before calling this supported. No native WebRTC/audio engine, Telecom integration,
or battery-optimization bypass is included in this first iteration.

Device acceptance: start a real Office call and verify bidirectional audio;
lock for 30 seconds and then 5–10 minutes, speaking a new phrase while locked;
check its native chat transcript after unlock. Repeat with Home/return, worker
switching, Bluetooth connection changes, mute/unmute, and hangup from the
notification. Confirm the call stays attached to the original session and the
microphone indicator disappears after hangup. Record device, Android, System
WebView version and each result. Incoming-call audio interruptions still need
this same device validation.

## Build

JDK 17, Android SDK platform/build tools 35, Gradle 8.11.1 (wrapper included),
AGP 8.9.2, and AndroidX WebKit 1.14.0 are pinned. No NDK is needed.

```sh
cd android
./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug
```

The GitHub Android Wrapper workflow runs those checks and uploads a signed debug
prototype APK plus reports. Debug APKs are test builds; production distribution
and stable release signing are a separate step. No Office URL or credentials are
embedded in the source or package. The app accepts only a user-configured HTTPS
origin; the message bridge is restricted to that origin and the main frame.
File access and mixed-content loading are disabled. Other origins receive no
native voice privileges.

References: [foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types),
[WebView messaging](https://developer.android.com/reference/androidx/webkit/WebViewCompat#addWebMessageListener(android.webkit.WebView,java.lang.String,java.util.Set,androidx.webkit.WebViewCompat.WebMessageListener)).
