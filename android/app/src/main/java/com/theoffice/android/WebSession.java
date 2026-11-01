package com.theoffice.android;

import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.ViewGroup;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.lang.ref.WeakReference;
import java.util.Collections;
import org.json.JSONException;
import org.json.JSONObject;

/** Retain the same document independently of the foreground Activity. */
final class WebSession {
    private final OfficeApplication app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private WeakReference<MainActivity> activity = new WeakReference<>(null);
    private JavaScriptReplyProxy reply;
    private PermissionRequest pendingAudio;
    private OfficeAddress address;
    WebView webView;
    VoiceCall call;

    WebSession(OfficeApplication app) { this.app = app; }
    void attach(MainActivity owner) { activity = new WeakReference<>(owner); }
    void detach(MainActivity owner) {
        if (activity.get() != owner) return;
        activity.clear();
        if (webView != null && webView.getParent() instanceof ViewGroup parent) parent.removeView(webView);
    }
    boolean active() { return call != null; }

    WebView open(String input) {
        OfficeAddress next = new OfficeAddress(input);
        if (webView != null && address.url.equals(next.url)) return webView;
        if (active()) throw new IllegalStateException("End your call before changing the Office address.");
        if (webView != null) { webView.destroy(); webView = null; }
        address = next;
        WebView view = new WebView(app);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        view.setBackgroundColor(0xff111b27);
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                if (!request.isForMainFrame() || address.owns(request.getUrl().toString())) return false;
                if (request.isForMainFrame() && "https".equalsIgnoreCase(request.getUrl().getScheme())) {
                    MainActivity owner = activity.get();
                    if (owner != null) owner.startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                }
                return true;
            }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
                if (webView != v) return true;
                if (call != null) release(call.id);
                if (v.getParent() instanceof ViewGroup parent) parent.removeView(v);
                v.destroy(); webView = null;
                MainActivity owner = activity.get();
                if (owner != null) main.post(owner::browserInterrupted);
                return true;
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                MainActivity owner = activity.get();
                boolean audioOnly = request.getResources().length == 1
                        && PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(request.getResources()[0]);
                if (!audioOnly || !address.owns(request.getOrigin().toString()) || owner == null || !owner.resumed) {
                    request.deny(); return;
                }
                pendingAudio = request;
                owner.ensureMicrophone(allowed -> {
                    if (pendingAudio != request) return;
                    pendingAudio = null;
                    if (allowed && webView == view && address.owns(request.getOrigin().toString()))
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    else request.deny();
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingAudio == request) pendingAudio = null;
            }
            @Override public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                MainActivity owner = activity.get();
                if (owner == null) return false;
                owner.chooseFiles(callback, params); return true;
            }
        });
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            view.destroy(); throw new IllegalStateException("Update Android System WebView to use Office voice.");
        }
        WebViewCompat.addWebMessageListener(view, "OfficeAndroid", Collections.singleton(address.origin), (v, message, origin, isMainFrame, proxy) -> {
            if (!isMainFrame || !address.owns(origin.toString())) return;
            String text = message.getData();
            if (text == null || text.length() > 4096) return;
            try { handle(new JSONObject(text), proxy); }
            catch (JSONException | IllegalArgumentException ignored) { /* Ignore malformed messages. */ }
        });
        webView = view;
        view.loadUrl(address.url);
        return view;
    }

    private void handle(JSONObject message, JavaScriptReplyProxy proxy) throws JSONException {
        String id = message.optString("id");
        switch (message.optString("type")) {
            case "voice.prepare" -> prepare(id, message.optString("threadId"), proxy);
            case "voice.release" -> release(id);
            case "voice.state" -> {
                if (call == null || !call.matches(id) || !call.ready) return;
                call.connected = "connected".equals(message.optString("status"));
                call.muted = message.optBoolean("muted");
                app.startService(new Intent(app, VoiceService.class).setAction(VoiceService.UPDATE).putExtra("id", id));
            }
            default -> { }
        }
    }

    private void prepare(String id, String threadId, JavaScriptReplyProxy proxy) {
        MainActivity owner = activity.get();
        if (owner == null || !owner.resumed) { prepared(proxy, id, "Open Office before starting a voice call."); return; }
        if (call != null) { prepared(proxy, id, "A voice call is already active."); return; }
        VoiceCall next = new VoiceCall(id, threadId);
        call = next; reply = proxy;
        owner.ensureMicrophone(allowed -> {
            if (call != next) return;
            MainActivity current = activity.get();
            if (!allowed || current == null || !current.resumed) {
                prepared(proxy, id, "Microphone permission is required to start a call.");
                release(id); return;
            }
            try {
                app.startForegroundService(new Intent(app, VoiceService.class).setAction(VoiceService.START).putExtra("id", id));
            } catch (RuntimeException error) {
                prepared(proxy, id, "Could not start Android voice. Open Office and retry."); release(id);
            }
        });
        main.postDelayed(() -> {
            if (call == next && !next.ready) {
                prepared(proxy, id, "Voice preparation timed out. Please retry."); release(id);
            }
        }, 60000);
    }
    private void prepared(JavaScriptReplyProxy proxy, String id, String error) {
        try {
            JSONObject value = new JSONObject().put("type", "voice.prepared").put("id", id);
            if (error != null) value.put("error", error);
            proxy.postMessage(value.toString());
        } catch (JSONException | IllegalStateException ignored) { if (error == null) release(id); }
    }
    void serviceReady(String id) {
        if (call == null || !call.matches(id) || call.ready) return;
        call.ready = true;
        prepared(reply, id, null);
    }
    void release(String id) {
        if (call == null || !call.matches(id)) return;
        call = null; reply = null;
        app.stopService(new Intent(app, VoiceService.class));
    }
    void command(String command) {
        if (call == null) return;
        String id = call.id;
        try { reply.postMessage(new JSONObject().put("type", "voice.command").put("id", id).put("command", command).toString()); }
        catch (JSONException | IllegalStateException ignored) { }
        if ("stop".equals(command)) main.postDelayed(() -> {
            if (call == null || !call.matches(id)) return;
            // A non-responsive renderer must not keep recording after hangup.
            release(id);
            if (webView != null) webView.loadUrl(address.url);
        }, 2000);
    }
    void serviceFailed(String id) {
        if (call == null || !call.matches(id)) return;
        if (!call.ready) { prepared(reply, id, "Android could not start voice. Open Office and retry."); release(id); }
        else command("stop");
    }
    void serviceStopped(String id) {
        if (call != null && call.matches(id)) command("stop");
    }
}
