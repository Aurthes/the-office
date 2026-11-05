# Focused character audio

Duck crew and the duck CEO share an optional sound bank. Selecting one plays a
random call after the first user interaction. While the same character stays
focused, each finished call is followed by a random 12–25 second pause. The next
call differs from the previous one when the bank has multiple clips.

Switching targets stops the previous call. Leaving character focus, muting,
opening another scene/panel, or hiding the page stops playback and pending calls.
Returning to a visible page waits a fresh random interval. Background roster
updates do not restart the player. Pets, robots, furniture and space objects do
not use the duck bank. The toolbar speaker button mutes these calls independently
of music. It does not edit character profiles or organizational settings.

Install audio privately under
`<OPENCLAW_STATE_DIR>/claw3d/character-audio/`, using the existing Studio state
directory resolution when that variable is unset. `sources.json` contains:

```json
{
  "clips": [
    { "id": "call-1", "file": "call-1.mp3", "group": "focus" },
    { "id": "result-1", "file": "result-1.mp3", "group": "review" },
    { "id": "input-1", "file": "input-1.mp3", "group": "waiting" },
    { "id": "error-1", "file": "error-1.mp3", "group": "error" }
  ]
}
```

`focus` is the normal selected-character pool and the default for older clips
without a group. `review` plays for a new yellow question mark, `waiting` for a
new yellow exclamation mark, and `error` for a new red exclamation mark. Each
event picks a random clip only from its group, without an immediate repeat when
there is a choice. A missing group stays silent instead of using another sound.

Status calls work without character focus, including in background tabs, after
the browser's first interaction. The first populated roster is a baseline;
unchanged markers and temporary empty rosters do not replay notifications.
Simultaneous changes produce one call, preferring error, then input, then review.
Status calls interrupt ordinary calls and share their mute control and player.

Files must be direct children of this directory, in MP3, WAV or Ogg format.
Preserve source/rights information in the private manifest as appropriate. No
third-party game recordings are included in the repository. Without an installed
bank the feature is silent and its toolbar control is hidden.

The authenticated Studio API serves embedded audio bytes from this fixed bank;
it accepts no caller-supplied file path or remote URL. Web Audio decodes these
bytes locally and reuses buffers, without depending on media-element autoplay
or changing the HTML preview security policy.
