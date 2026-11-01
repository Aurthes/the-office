package com.theoffice.android;
import org.junit.Test;
import static org.junit.Assert.*;

public class OfficeAddressTest {
    @Test public void acceptsOnlyTheConfiguredHttpsOrigin() {
        OfficeAddress address = new OfficeAddress(" https://OFFICE.example:443/office?view=chat ");
        assertEquals("https://office.example/office?view=chat", address.url);
        assertEquals("https://office.example", address.origin);
        assertTrue(address.owns("https://office.example/login"));
        assertTrue(address.owns("https://office.example/office#section"));
        assertFalse(address.owns("https://office.example.evil.test/office"));
        assertFalse(address.owns("https://office.example:444/office"));
        assertFalse(address.owns("http://office.example/office"));
        assertFalse(address.owns("file:///etc/passwd"));
    }
    @Test public void rejectsUnsafeAndAmbiguousAddresses() {
        for (String value : new String[]{"javascript:alert(1)", "http://example.test", "https://user:pass@example.test", "https://example.test:0", "https://example.test:70000"}) {
            assertThrows(value, IllegalArgumentException.class, () -> new OfficeAddress(value));
        }
    }
    @Test public void addsTheOfficePathToBareHosts() {
        assertEquals("https://office.test/office", new OfficeAddress("https://office.test").url);
        assertTrue(new OfficeAddress("https://office.test:8443/office").owns("https://office.test:8443/login"));
    }
}
