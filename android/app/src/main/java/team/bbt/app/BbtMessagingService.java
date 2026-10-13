package team.bbt.app;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Receives the Worker's Firebase messages. They are data-only (the notification JSON in "json"), so this app draws
 * every notification itself, with the BBT logo and the Still in / I'm out buttons, in the foreground and background.
 */
public class BbtMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(RemoteMessage message) {
        String json = message.getData().get("json");
        if (json == null) return;
        try {
            Notifier.show(this, new JSONObject(json));
        } catch (JSONException e) {
            // not a BBT message
        }
    }

    @Override
    public void onNewToken(String token) {
        // The web app registers the current token with the Worker each time it starts (src/lib/native.ts).
    }
}
