package com.theoffice.android;

/** UI-thread state. A stale message may never control a later call. */
final class VoiceCall {
    final String id;
    final String threadId;
    boolean ready;
    boolean connected;
    boolean muted;
    int commandSerial;

    VoiceCall(String id, String threadId) {
        if (id == null || !id.matches("[a-fA-F0-9-]{36}") || threadId == null || threadId.trim().isEmpty() || threadId.length() > 200)
            throw new IllegalArgumentException("Invalid voice session.");
        this.id = id;
        this.threadId = threadId;
    }

    boolean matches(String id) { return this.id.equals(id); }
    String description() { return muted ? "Microphone muted" : connected ? "Voice call connected" : "Connecting voice call…"; }
}
