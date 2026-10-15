// Help → Routes on your Garmin (DESIGN.md → Help): getting a ride's RideWithGPS route onto a Garmin, and what to check
// when it doesn't arrive. Written for people who aren't technical: plain words, the app's own button names in bold.
// Opened from the account menu.

const CHECKS: { q: string; fix: string }[] = [
  {
    q: "Does the route open in RideWithGPS?",
    fix: "If not, ask the person who posted the ride to make the route public or share it.",
  },
  {
    q: "Did you open it from BBT?",
    fix: "BBT always opens a route, which can sync. A ride someone recorded can't: on the RideWithGPS website, open it, choose More → Copy to My Routes, and send the copy.",
  },
  {
    q: "Is it in the Garmin Connect app, under More → Training & Planning → Courses?",
    fix: "If not, it never reached Garmin. In the Garmin Connect app's settings, open Connected Apps and remove Ride with GPS. Then do “Set up once” again and send the route again.",
  },
  {
    q: "Does your Edge or watch have room?",
    fix: "Most hold 100 courses, some fewer. Delete courses you no longer need on the device.",
  },
  {
    q: "Is it in Garmin Connect but not on your Edge or watch?",
    fix: "Open the Garmin Connect app with the device on and nearby, and wait for it to sync.",
  },
  { q: "Still missing?", fix: "Copy the route over by cable (below)." },
];

export function HelpGarmin() {
  return (
    <section className="help">
      <div>
        <div className="kicker">Help</div>
        <h1>Routes on your Garmin</h1>
        <p className="muted small">
          A ride's route goes from RideWithGPS to the Garmin Connect app on your phone, then to your Edge or watch. Set
          it up once; after that, each route takes a few taps.
        </p>
      </div>
      <div className="panel help-sec">
        <h2>Set up once</h2>
        <ol>
          <li>
            In the RideWithGPS app or website, go to <b>Settings → Connected Services</b> and tap{" "}
            <b>Connect with Garmin</b>.
          </li>
          <li>Sign in with your Garmin account and allow access.</li>
          <li>
            Make sure <b>Courses</b> is turned on. This is what sends routes to Garmin.
          </li>
        </ol>
        <p className="muted small">
          Your Edge or watch must also be set up in the Garmin Connect app (most people did this when they got it).
        </p>
      </div>
      <div className="panel help-sec">
        <h2>For each ride</h2>
        <ol>
          <li>
            In BBT, open the ride and tap the <b>RideWithGPS</b> tile.
          </li>
          <li>
            In RideWithGPS, tap <b>Send to Garmin</b>.
          </li>
          <li>Open the Garmin Connect app, with your Edge or watch on and nearby. It syncs by itself.</li>
          <li>
            On your Edge or watch, the route is in the <b>Courses</b> list.
          </li>
        </ol>
      </div>
      <div className="panel help-sec">
        <h2>Route not on your Garmin?</h2>
        <p className="muted small">Go down the list. At the first “no”, do what it says.</p>
        <ol className="help-checks">
          {CHECKS.map((c) => (
            <li key={c.q}>
              <b>{c.q}</b>
              <span className="muted small">{c.fix}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="panel help-sec">
        <h2>Copy the route over by cable</h2>
        <p className="muted small">Needs a computer and your device's USB cable.</p>
        <ol>
          <li>
            On the RideWithGPS website, open the route and choose <b>More → Export as File → FIT Course</b>.
          </li>
          <li>Connect your Edge or watch to the computer with the cable.</li>
          <li>
            Copy the file into the device's <b>Garmin</b> folder, then into <b>NewFiles</b>.
          </li>
          <li>
            Eject and unplug. The route is in the <b>Courses</b> list.
          </li>
        </ol>
      </div>
    </section>
  );
}
