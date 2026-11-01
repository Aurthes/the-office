package com.theoffice.android;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.function.Consumer;

public final class MainActivity extends Activity {
    private static final int MICROPHONE = 10, FILES = 11;
    private WebSession session;
    private LinearLayout layout;
    private Consumer<Boolean> permissionCallback;
    private Boolean permissionResult;
    private ValueCallback<Uri[]> fileCallback;
    boolean resumed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        session = ((OfficeApplication)getApplication()).session;
        session.attach(this);
        layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(0xff111b27);
        layout.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            }
            return insets;
        });
        setContentView(layout);
        String saved = getPreferences(MODE_PRIVATE).getString("officeUrl", "");
        if (saved.trim().isEmpty()) settings(); else showOffice(saved);
    }
    private void showOffice(String url) {
        try {
            WebView view = session.open(url);
            layout.removeAllViews();
            if (view.getParent() instanceof ViewGroup parent) parent.removeView(view);
            layout.addView(view, new LinearLayout.LayoutParams(-1, 0, 1));
            Button settings = new Button(this);
            settings.setText("Office address"); settings.setTextSize(11);
            settings.setOnClickListener(v -> {
                if (session.active()) toast("End your call before changing the Office address.");
                else settings();
            });
            layout.addView(settings, new LinearLayout.LayoutParams(-1, dp(36)));
        } catch (RuntimeException error) { toast(error.getMessage()); settings(); }
    }
    private void settings() {
        layout.removeAllViews();
        TextView title = new TextView(this); title.setText("The Office"); title.setTextSize(26); title.setPadding(dp(20),dp(30),dp(20),dp(12));
        TextView help = new TextView(this); help.setText("Paste the HTTPS address you use to open Office. Sign in normally, then start a voice call in your chat."); help.setPadding(dp(20),0,dp(20),dp(12));
        EditText address = new EditText(this); address.setSingleLine(true); address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("https://your-office.example/office"); address.setText(getPreferences(MODE_PRIVATE).getString("officeUrl", ""));
        address.setContentDescription("Office address");
        Button open = new Button(this); open.setText("Open Office");
        open.setOnClickListener(v -> {
            try {
                OfficeAddress parsed = new OfficeAddress(address.getText().toString());
                getPreferences(MODE_PRIVATE).edit().putString("officeUrl", parsed.url).apply(); showOffice(parsed.url);
            } catch (IllegalArgumentException error) { address.setError(error.getMessage()); }
        });
        layout.addView(title); layout.addView(help); layout.addView(address); layout.addView(open);
    }
    void ensureMicrophone(Consumer<Boolean> callback) {
        if (!resumed || permissionCallback != null) { callback.accept(false); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { callback.accept(true); return; }
        permissionCallback = callback;
        ArrayList<String> permissions = new ArrayList<>(); permissions.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        requestPermissions(permissions.toArray(new String[0]), MICROPHONE);
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == MICROPHONE) {
            permissionResult = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            deliverPermission();
        }
    }
    private void deliverPermission() {
        if (!resumed || permissionCallback == null || permissionResult == null) return;
        Consumer<Boolean> callback = permissionCallback;
        boolean allowed = permissionResult; permissionCallback = null; permissionResult = null;
        callback.accept(allowed);
    }
    @Override protected void onResume() { super.onResume(); resumed = true; session.attach(this); deliverPermission(); }
    @Override protected void onPause() { resumed = false; super.onPause(); }
    // Keep WebView timers and the document alive when the screen locks.
    @Override protected void onDestroy() {
        if (permissionCallback != null) { permissionCallback.accept(false); permissionCallback = null; }
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        session.detach(this); super.onDestroy();
    }
    @Override public void onBackPressed() {
        if (session.webView != null && session.webView.getParent() != null && session.webView.canGoBack()) session.webView.goBack();
        else moveTaskToBack(true);
    }
    void chooseFiles(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        try { startActivityForResult(params.createIntent(), FILES); }
        catch (RuntimeException error) { callback.onReceiveValue(null); fileCallback = null; toast("No file picker is available."); }
    }
    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (request == FILES && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, intent)); fileCallback = null;
        }
    }
    void browserInterrupted() { toast("Office was interrupted. Reconnect voice after the page reloads."); showOffice(getPreferences(MODE_PRIVATE).getString("officeUrl", "")); }
    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private void toast(String text) { Toast.makeText(this, text == null ? "Could not open Office." : text, Toast.LENGTH_LONG).show(); }
}
