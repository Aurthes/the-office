package com.theoffice.android;
import org.junit.Test;
import static org.junit.Assert.*;

public class VoiceCallTest {
    @Test public void bindsControlsToOneVoiceSession() {
        VoiceCall call = new VoiceCall("11111111-1111-4111-8111-111111111111", "original-thread");
        assertTrue(call.matches("11111111-1111-4111-8111-111111111111"));
        assertFalse(call.matches("22222222-2222-4222-8222-222222222222"));
        assertFalse(call.matches(null));
        assertEquals("original-thread", call.threadId);
        assertTrue(call.description().startsWith("Connecting"));
        call.connected = true;
        assertEquals("Voice call connected", call.description());
        call.muted = true;
        assertEquals("Microphone muted", call.description());
    }
    @Test public void rejectsInvalidCallIdentifiers() {
        assertThrows(IllegalArgumentException.class, () -> new VoiceCall("arbitrary", "thread"));
        assertThrows(IllegalArgumentException.class, () -> new VoiceCall("11111111-1111-4111-8111-111111111111", ""));
    }
}
