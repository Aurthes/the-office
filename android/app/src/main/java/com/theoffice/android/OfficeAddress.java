package com.theoffice.android;

import java.net.URI;
import java.util.Locale;

/** Only the explicitly configured HTTPS origin receives the native bridge. */
final class OfficeAddress {
    final String url;
    final String origin;

    OfficeAddress(String input) {
        try {
            URI uri = new URI(input.trim());
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getUserInfo() != null
                    || uri.getPort() == 0 || uri.getPort() < -1 || uri.getPort() > 65535)
                throw new IllegalArgumentException();
            int port = uri.getPort();
            origin = "https://" + host.toLowerCase(Locale.ROOT) + (port == -1 || port == 443 ? "" : ":" + port);
            url = origin + (uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/office" : uri.getRawPath())
                    + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery())
                    + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
        } catch (Exception error) {
            throw new IllegalArgumentException("Enter your Office HTTPS address.");
        }
    }

    boolean owns(String target) {
        try { return origin.equals(new OfficeAddress(target).origin); }
        catch (IllegalArgumentException ignored) { return false; }
    }
}
