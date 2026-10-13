package team.bbt.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;

/** Shows BBT notifications: the bike logo, tap to open the activity, and Still in / I'm out when the payload asks. */
final class Notifier {

    static final String APP_URL = "https://app.bbt.team";
    static final String EXTRA_PATH = "bbt_path";
    private static final String CHANNEL = "activities";
    private static final int BLUE = 0xFF0077D1;

    private Notifier() {}

    /** A push payload from the Worker: {title, body, url, activityId?, actions?}. */
    static void show(Context ctx, JSONObject data) {
        String title = data.optString("title", "BBT");
        String body = data.optString("body", "");
        String path = data.optString("url", "/");
        String activityId = data.optString("activityId", "");
        int id = (path + System.currentTimeMillis()).hashCode();
        NotificationCompat.Builder b = builder(ctx, id, title, body, path);
        if (!activityId.isEmpty() && data.has("actions")) {
            b.addAction(0, "Still in", answer(ctx, id, "in", activityId, title, path));
            b.addAction(0, "I'm out", answer(ctx, id, "out", activityId, title, path));
        }
        post(ctx, id, b);
    }

    /** A plain notification that opens `path`, e.g. "You're out" after answering from a notification. */
    static void simple(Context ctx, int id, String title, String body, String path) {
        post(ctx, id, builder(ctx, id, title, body, path));
    }

    private static NotificationCompat.Builder builder(Context ctx, int id, String title, String body, String path) {
        Intent open = new Intent(ctx, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_PATH, path);
        PendingIntent tap = PendingIntent.getActivity(
            ctx,
            id,
            open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        return new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_bbt)
            .setColor(BLUE)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(tap);
    }

    private static PendingIntent answer(Context ctx, int id, String action, String activityId, String title, String path) {
        Intent i = new Intent(ctx, RsvpReceiver.class)
            .setAction("team.bbt.app.RSVP_" + action)
            .putExtra(RsvpReceiver.EXTRA_NOTIFICATION, id)
            .putExtra(RsvpReceiver.EXTRA_ACTIVITY, activityId)
            .putExtra(RsvpReceiver.EXTRA_TITLE, title)
            .putExtra(EXTRA_PATH, path);
        return PendingIntent.getBroadcast(
            ctx,
            id * 31 + action.hashCode(),
            i,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    @SuppressLint("MissingPermission") // checked just below
    private static void post(Context ctx, int id, NotificationCompat.Builder b) {
        if (
            Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return;
        ensureChannel(ctx);
        NotificationManagerCompat.from(ctx).notify(id, b.build());
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Activities", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("New activities, changes and cancellations");
        nm.createNotificationChannel(ch);
    }
}
