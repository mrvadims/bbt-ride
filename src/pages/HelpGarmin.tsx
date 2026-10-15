// Help → Routes on your Garmin (DESIGN.md → Help): getting a ride's RideWithGPS route onto a Garmin, and what to check
// when it doesn't arrive. Opened from the account menu.

const CHECKS: { q: string; fix: string }[] = [
  { q: "Does the route open in RideWithGPS?", fix: "No: ask the ride's organizer. It must be public or shared." },
  {
    q: "Is it a route, not an activity?",
    fix: "A route's address has /routes/, an activity's /trips/ (BBT's tile always opens a route). Activities don't sync: on the RideWithGPS website, More → Copy to My Routes.",
  },
  {
    q: "Is it in Garmin Connect, under More → Training & Planning → Courses?",
    fix: "No: it never reached Garmin. In Garmin Connect, remove Ride with GPS from Connected Apps; reconnect in RideWithGPS; pin the route again.",
  },
  { q: "Does the device have room?", fix: "Most Garmins hold 100 courses, some fewer. Delete old ones on the device." },
  { q: "In Garmin Connect but not on the device?", fix: "Sync the device in the Garmin Connect app." },
  { q: "Still missing?", fix: "Load the file by hand, below." },
];

export function HelpGarmin() {
  return (
    <section className="help">
      <div>
        <div className="kicker">Help</div>
        <h1>Routes on your Garmin</h1>
        <p className="muted small">
          RideWithGPS → Garmin Connect → your Edge or watch. Set it up once; after that, each route is one tap.
        </p>
      </div>
      <div className="panel help-sec">
        <h2>Set up once</h2>
        <ol>
          <li>
            In RideWithGPS: <b>Settings → Connected Services → Connect with Garmin</b>, then sign in to Garmin.
          </li>
          <li>
            Turn on <b>Courses</b>. This is what sends routes to Garmin.
          </li>
          <li>Pair your Edge or watch with the Garmin Connect app.</li>
        </ol>
      </div>
      <div className="panel help-sec">
        <h2>Each ride</h2>
        <ol>
          <li>
            Tap the ride's <b>RideWithGPS</b> tile.
          </li>
          <li>
            In RideWithGPS, tap <b>Send to Garmin</b>, or pin the route.
          </li>
          <li>
            Open Garmin Connect so your device syncs. The route appears under <b>Courses</b>.
          </li>
        </ol>
      </div>
      <div className="panel help-sec">
        <h2>Route not on your Garmin?</h2>
        <p className="muted small">Check in order; fix the first "No".</p>
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
        <h2>Load the file by hand</h2>
        <ol>
          <li>
            On the RideWithGPS website: <b>More → Export as File → FIT Course</b> (turn-by-turn) or <b>GPX Track</b>.
          </li>
          <li>
            Connect the device by USB; copy the file into <b>GARMIN/NewFiles</b>.
          </li>
          <li>
            Unplug. The route appears under <b>Courses</b>.
          </li>
        </ol>
      </div>
    </section>
  );
}
