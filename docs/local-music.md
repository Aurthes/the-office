# Music sources and local playback

The listening bar offers NetEase and a local library. One provider component is
mounted at a time; switching sources or returning to the chooser stops and
unloads the previous audio element and cancels its pending requests. Closing the
dialog keeps the selected source playing through the shared mini player.

Both providers implement `MusicPlayerProps` and use `MusicMiniPlayer` for pause,
resume, next, volume, reopen and stop. Provider-specific discovery and playback
stay inside their own components. Additional services can use the same seam;
Spotify authorization and playback are not implemented by this change.

The selected provider is remembered in browser storage. On subsequent Office
entry, the saved provider is used instead of always choosing NetEase. Browsers
that block autoplay show a tap-to-play hint. Playback also works without browser
storage. Local playback offers Repeat all (library order), Random Mix (the default,
without repeats within each shuffled batch), and Repeat one (native audio loop).
The mode is remembered. Changing modes keeps the current track and pause state;
manual next still advances in Repeat one. Random Mix avoids starting with the
last heard track when alternatives exist. Scene changes do not interrupt a local track or undo a pause.

Install local music privately under
`<OPENCLAW_STATE_DIR>/claw3d/music-library/`, using the usual Studio state-directory
resolution when the environment variable is unset. `library.json` contains:

```json
{
  "name": "My music",
  "tracks": [
    { "id": "track-1", "file": "track-1.mp3", "name": "Track One",
      "artists": "Artist", "album": "Album" }
  ]
}
```

Files must be direct children of that directory, in MP3, WAV, Ogg or M4A format.
Local files still travel over the connection to the listener. Files are served
unchanged; the player does not transcode them. The player preloads audio and allows a two-second download reserve after an
incomplete stream becomes playable. Already buffered tracks start immediately;
an explicit resume tap always calls play directly. Buffering status is shown
while waiting for data.
An optional per-track `sha256` field becomes the playback URL's revision, so a
replacement encoding does not reuse an older cached file. Outdated explicit
revisions return 404 instead of mixing bytes from different encodings.
Source and rights metadata can be retained in extra private manifest fields.
Music files are not committed or bundled into the open-source repository.

The authenticated `/api/music/local` endpoint returns public track metadata.
Adding `?id=track-1` streams only the corresponding configured file, with HTTP
byte-range support for seeking and mobile playback. Files are streamed rather
than loaded into memory. Callers cannot supply filesystem paths or remote URLs.
Missing libraries show an empty player, while missing tracks return 404. A bad
track stops with an error instead of retrying an entire broken queue indefinitely.
