package team.bbt.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;
import androidx.core.app.NotificationManagerCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * A notification's Still in / I'm out buttons. Still in only closes the notification; I'm out answers with the
 * WebView's session (the same request the app makes) and confirms, or offers to open the activity if it can't.
 */
public class RsvpReceiver extends BroadcastReceiver {

    static final String EXTRA_NOTIFICATION = "bbt_notification";
    static final String EXTRA_ACTIVITY = "bbt_activity";
    static final String EXTRA_TITLE = "bbt_title";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        int id = intent.getIntExtra(EXTRA_NOTIFICATION, 0);
        NotificationManagerCompat.from(ctx).cancel(id);
        if (!"team.bbt.app.RSVP_out".equals(intent.getAction())) return;
        String activity = intent.getStringExtra(EXTRA_ACTIVITY);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String path = intent.getStringExtra(Notifier.EXTRA_PATH);
        if (activity == null) return;
        PendingResult pending = goAsync();
        new Thread(() -> {
            boolean ok = out(activity);
            if (ok) Notifier.simple(ctx, id, "You're out", title, path);
            else Notifier.simple(ctx, id, "Couldn't answer", "Tap to open " + title, path);
            pending.finish();
        }).start();
    }

    private static boolean out(String activity) {
        HttpURLConnection c = null;
        try {
            URL url = new URL(Notifier.APP_URL + "/api/activities/" + URLEncoder.encode(activity, "UTF-8") + "/rsvp");
            c = (HttpURLConnection) url.openConnection();
            c.setRequestMethod("PUT");
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Origin", Notifier.APP_URL); // the Worker refuses data changes from other origins
            String cookies = CookieManager.getInstance().getCookie(Notifier.APP_URL);
            if (cookies != null) c.setRequestProperty("Cookie", cookies);
            try (OutputStream os = c.getOutputStream()) {
                os.write("{\"status\":\"out\",\"routeLabel\":null}".getBytes(StandardCharsets.UTF_8));
            }
            return c.getResponseCode() / 100 == 2;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
