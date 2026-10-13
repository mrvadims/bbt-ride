package team.bbt.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.ContextCompat;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * What the web app asks of the phone (src/lib/native.ts): the app's version, Firebase notifications, native Google
 * sign-in (Google doesn't allow its sign-in page inside an app's WebView), the share sheet, and opening links outside.
 */
@CapacitorPlugin(
    name = "BbtNative",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class BbtNativePlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo p = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject r = new JSObject();
            r.put("versionCode", PackageInfoCompat.getLongVersionCode(p));
            r.put("versionName", p.versionName);
            r.put("pushConfigured", !FirebaseApp.getApps(getContext()).isEmpty());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** Whether notifications are allowed: "granted", "denied" or "prompt". */
    @PluginMethod
    public void pushPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("state", notificationsAllowed() ? "granted" : getPermissionState("notifications").toString());
        call.resolve(r);
    }

    /** Asks for permission if needed, then returns this device's Firebase token for the Worker. */
    @PluginMethod
    public void pushRegister(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.reject("Notifications aren't set up in this version of the app.");
            return;
        }
        if (notificationsAllowed()) token(call);
        else requestPermissionForAlias("notifications", call, "afterPermission");
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("notifications") == PermissionState.GRANTED) token(call);
        else call.reject("Notifications are turned off for BBT in Android settings.");
    }

    private void token(PluginCall call) {
        Notifier.ensureChannel(getContext());
        FirebaseMessaging.getInstance()
            .getToken()
            .addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) {
                    call.reject("Couldn't turn on notifications. Check your connection and try again.");
                    return;
                }
                JSObject r = new JSObject();
                r.put("token", task.getResult());
                call.resolve(r);
            });
    }

    /** Forgets this device's token, so it gets no more notifications even if the Worker still has it. */
    @PluginMethod
    public void pushUnregister(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.resolve();
            return;
        }
        FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener(task -> call.resolve());
    }

    private boolean notificationsAllowed() {
        if (Build.VERSION.SDK_INT < 33) return true; // no runtime permission before Android 13
        return getPermissionState("notifications") == PermissionState.GRANTED;
    }

    /** Google's account picker; returns an ID token for the web app's OAuth client, which Better Auth verifies. */
    @PluginMethod
    public void googleSignIn(PluginCall call) {
        String clientId = getConfig().getString("googleClientId");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("Google sign-in isn't set up in this version of the app.");
            return;
        }
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(new GetSignInWithGoogleOption.Builder(clientId).build())
            .build();
        CredentialManager.create(getContext()).getCredentialAsync(
            getActivity(),
            request,
            null,
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential c = response.getCredential();
                    if (
                        c instanceof CustomCredential &&
                        GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())
                    ) {
                        JSObject r = new JSObject();
                        r.put("idToken", GoogleIdTokenCredential.createFrom(c.getData()).getIdToken());
                        call.resolve(r);
                    } else {
                        call.reject("Google sign-in didn't return an account.");
                    }
                }

                @Override
                public void onError(GetCredentialException e) {
                    if (e instanceof GetCredentialCancellationException) call.reject("cancelled", "CANCELLED");
                    else call.reject("Google sign-in didn't complete. Try again.");
                }
            }
        );
    }

    /** The Android share sheet (the WebView has no Web Share API). */
    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text", "");
        String url = call.getString("url", "");
        Intent send = new Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "BBT"))
            .putExtra(Intent.EXTRA_TEXT, url.isEmpty() ? text : text + "\n" + url);
        getActivity().startActivity(Intent.createChooser(send, null));
        call.resolve();
    }

    /** Opens an https link in the browser, e.g. the APK download (the WebView can't download files). */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://")) {
            call.reject("Only https links");
            return;
        }
        getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        call.resolve();
    }
}
