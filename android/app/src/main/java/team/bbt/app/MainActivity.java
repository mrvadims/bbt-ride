package team.bbt.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebView;
import java.util.regex.Pattern;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * The app's only screen: Capacitor's WebView showing https://app.bbt.team (DESIGN.md → v2, Android app). Adds the BBT
 * plugin, opens the activity a tapped notification points to, and makes Back go back in the app.
 */
public class MainActivity extends BridgeActivity {

    // Notifications open home, an activity, a date poll or Announcements; nothing else (another app could start this
    // activity with any extra).
    private static final Pattern PATH = Pattern.compile("^/((a|polls)/[A-Za-z0-9_-]{1,64}|announcements)?$");
    // Back closes an open sheet (<dialog>) the way Escape does, before going back a page.
    private static final String CLOSE_SHEET =
        "(function(){var d=document.querySelector('dialog[open]');" +
        "if(!d)return false;d.dispatchEvent(new Event('cancel',{cancelable:true}));return true})()";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BbtNativePlugin.class);
        super.onCreate(savedInstanceState); // also hands the launch intent to onNewIntent
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null) {
                    finish();
                    return;
                }
                WebView web = getBridge().getWebView();
                web.evaluateJavascript(CLOSE_SHEET, closed -> {
                    if ("true".equals(closed)) return;
                    if (web.canGoBack()) web.goBack();
                    else moveTaskToBack(true);
                });
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openFromNotification(intent);
    }

    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush(); // so a notification's "I'm out" can use the session after the app closes
    }

    private void openFromNotification(Intent intent) {
        String path = intent == null ? null : intent.getStringExtra(Notifier.EXTRA_PATH);
        if (path == null) return;
        intent.removeExtra(Notifier.EXTRA_PATH);
        if (!PATH.matcher(path).matches() || getBridge() == null) return;
        WebView web = getBridge().getWebView();
        web.post(() -> web.loadUrl(Notifier.APP_URL + path));
    }
}
