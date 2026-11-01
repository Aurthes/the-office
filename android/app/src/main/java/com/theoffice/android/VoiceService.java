package com.theoffice.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.net.Uri;
import android.os.IBinder;

/** Gives an existing WebView call foreground microphone/playback eligibility. */
public final class VoiceService extends Service {
    static final String START = "voice.start", UPDATE = "voice.update", STOP = "voice.stop", MUTE = "voice.mute";
    private static final String CHANNEL = "office_voice";
    private static final int NOTIFICATION = 1;
    private String servedId;
    private WebSession session;

    @Override public void onCreate() {
        super.onCreate();
        session = ((OfficeApplication)getApplication()).session;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Voice calls", NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        VoiceCall call = session.call;
        if (intent == null || call == null) {
            stopSelf(startId); return START_NOT_STICKY;
        }
        if (!call.matches(intent.getStringExtra("id"))) return START_NOT_STICKY;
        servedId = call.id;
        if (STOP.equals(intent.getAction())) { session.command("stop"); return START_NOT_STICKY; }
        if (MUTE.equals(intent.getAction())) { session.command("toggleMute"); return START_NOT_STICKY; }
        try {
            Notification notification = notification(call);
            if (Build.VERSION.SDK_INT >= 29) {
                int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
                if (Build.VERSION.SDK_INT >= 30) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                startForeground(NOTIFICATION, notification, types);
            } else startForeground(NOTIFICATION, notification);
            session.serviceReady(call.id);
        } catch (RuntimeException error) {
            session.serviceFailed(call.id); stopSelf(startId);
        }
        return START_NOT_STICKY; // Never resurrect a microphone call after process death.
    }
    private PendingIntent action(String action, String id, int code) {
        return PendingIntent.getService(this, code,
                new Intent(this, VoiceService.class).setAction(action).setData(Uri.parse("office-voice://call/" + id + "/" + action)).putExtra("id", id),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification notification(VoiceCall call) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = action(STOP, call.id, 1);
        Notification.Builder builder = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("Office voice")
                .setContentText(call.description()).setContentIntent(open).setOngoing(true)
                .setOnlyAlertOnce(true).setShowWhen(false).setCategory(Notification.CATEGORY_CALL)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .addAction(new Notification.Action.Builder(null, call.muted ? "Unmute" : "Mute", action(MUTE, call.id, 2)).build());
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setStyle(Notification.CallStyle.forOngoingCall(new Person.Builder().setName("Office voice").build(), stop));
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        } else builder.addAction(new Notification.Action.Builder(null, "End call", stop).build());
        return builder.build();
    }
    @Override public void onTaskRemoved(Intent rootIntent) { session.command("stop"); super.onTaskRemoved(rootIntent); }
    @Override public void onDestroy() {
        if (servedId != null) session.serviceStopped(servedId);
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
