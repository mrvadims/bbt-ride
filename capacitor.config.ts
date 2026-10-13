// The Android app (DESIGN.md → v2, Android app): a Capacitor shell that opens https://app.bbt.team, so every web deploy
// reaches it without a new APK. native/www holds only the offline page; the native code is in android/.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "team.bbt.app",
  appName: "BBT",
  webDir: "native/www",
  server: {
    url: "https://app.bbt.team",
    errorPath: "offline.html",
  },
  plugins: {
    // Edge to edge: the page (viewport-fit=cover) pads itself with env(safe-area-inset-*). The status bar gets light
    // icons for the blue top bar at start (src/lib/native.ts → startApp); the navigation bar follows the phone's theme.
    SystemBars: { insetsHandling: "css", style: "DEFAULT" },
    // Native Google sign-in asks Google for an ID token for the web app's OAuth client, which the Worker verifies.
    BbtNative: {
      googleClientId: "788843663115-civobe823j0r2vnkpgsjg7o8vqvik76c.apps.googleusercontent.com",
    },
  },
};

export default config;
