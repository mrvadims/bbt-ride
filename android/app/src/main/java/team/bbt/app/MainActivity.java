package team.bbt.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * The app's only screen: Capacitor's WebView showing https://app.bbt.team (DESIGN.md → v2, Android app). Adds the BBT
 * plugin, opens the activity a tapped notification points to, and makes Back go back in the app.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BbtNativePlugin.class);
        super.onCreate(savedInstanceState);
        openFromNotification(getIntent());
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge().getWebView();
                if (web.canGoBack()) web.goBack();
                else moveTaskToBack(true);
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
        if (path == null || !path.startsWith("/")) return;
        intent.removeExtra(Notifier.EXTRA_PATH);
        WebView web = getBridge().getWebView();
        web.post(() -> web.loadUrl(Notifier.APP_URL + path));
    }
}
