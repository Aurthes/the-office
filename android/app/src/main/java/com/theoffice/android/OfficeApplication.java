package com.theoffice.android;

import android.app.Application;

public final class OfficeApplication extends Application {
    WebSession session;
    @Override public void onCreate() { super.onCreate(); session = new WebSession(this); }
}
