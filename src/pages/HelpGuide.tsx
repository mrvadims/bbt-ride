// Help → Using BBT (DESIGN.md → Help): a quick tour of the app with a link to do each thing. Written for people who
// aren't technical: the app's own names in bold, one line per task. Planning shows to Editors and Admins, Settings to
// Admins, as only they have those screens.
import type { Me } from "../../shared/api.ts";
import { Link } from "../lib/router.tsx";

const Go = ({ href, children }: { href: string; children: string }) =>
  href.startsWith("/download/") ? ( // a static page, outside the app's own pages
    <a className="btn btn-outline btn-sm" href={href}>
      {children} <span aria-hidden="true">›</span>
    </a>
  ) : (
    <Link className="btn btn-outline btn-sm" href={href}>
      {children} <span aria-hidden="true">›</span>
    </Link>
  );

export function HelpGuide({ me }: { me: Me }) {
  const editor = me.role !== "view";
  const admin = me.role === "admin";
  return (
    <section className="help guide">
      <div>
        <div className="kicker">Help</div>
        <h1>Using BBT</h1>
        <p className="muted small">
          Everything the team plans in one place: what's coming up, who's going, the weather at the start, and how to
          get there or join online.
        </p>
      </div>

      <div className="panel help-sec">
        <h2>Getting around</h2>
        <ul>
          <li>
            <b>Bike logo</b> (top left): back to Home, the list of what's coming up.
          </li>
          <li>
            <b>Team</b>: everyone on the team, with Call and Text.
          </li>
          {editor && (
            <li>
              <b>Plan</b>: post a new activity (Editors and Admins).
            </li>
          )}
          {admin && (
            <li>
              <b>Settings</b>: users, announcements, sports, places and weather warnings (Admins).
            </li>
          )}
          <li>
            <b>Your initial</b> (top right): the account menu, with your contact info, notifications, calendar link,
            theme, units, announcements and help.
          </li>
        </ul>
      </div>

      <div className="panel help-sec">
        <h2>Join an activity</h2>
        <ol>
          <li>On Home, tap an activity. Use the sport buttons at the top to show one sport.</li>
          <li>
            In <b>Who's in</b>, tap <b>In</b> or <b>Out</b>. Tap it again to clear your answer. If there are two routes,
            pick yours.
          </li>
          <li>
            Post in <b>Messages</b>. Type <b>@</b> and a name to mention someone; they get a notification.
          </li>
          <li>Tap anyone's name to call or text them.</li>
        </ol>
        <Go href="/">See what's coming up</Go>
      </div>

      <div className="panel help-sec">
        <h2>Date polls</h2>
        <ul>
          <li>
            A <b>date poll</b> asks which day (or weekend) works before something is planned. When one is waiting for
            you, it's at the top of Home: tap <b>Answer</b>.
          </li>
          <li>
            For each date, tap <b>In</b>, <b>Maybe</b> or <b>Out</b> (tap it again to clear it) and add a note if you
            like. <b>Can't make any of these</b> marks them all Out.
          </li>
          <li>
            Everyone asked sees the results, best date first, and can post in the poll's <b>Messages</b>.
          </li>
          {editor && (
            <li>
              Editors: <b>Plan</b> → <b>Date poll</b> to start one (up to 14 days or weekends, within a year). On the
              results, <b>Plan this</b> turns a date into an activity and closes the poll.
            </li>
          )}
        </ul>
        <Go href="/polls">All date polls</Go>
      </div>

      <div className="panel help-sec">
        <h2>On an activity's page</h2>
        <ul>
          <li>
            <b>Directions</b> opens Google Maps, Apple Maps or Waze. For an online activity, <b>Join</b> opens the Zoom,
            Meet or Teams link.
          </li>
          <li>
            <b>Calendar</b> adds it to your calendar. <b>Share</b> sends it by text or chat.
          </li>
          <li>
            <b>RideWithGPS</b> opens the route. To get it onto a Garmin, see <b>Routes on your Garmin</b> below.
          </li>
          <li>
            <b>Weather</b> shows the forecast for the activity's hours, with warnings (rain, thunderstorms, wind, wet
            roads, heat, cold and weather alerts) and, for rides, what to wear.
          </li>
          <li>
            A <b>lock</b> on the icon means it's private: only the people invited see it.
          </li>
        </ul>
      </div>

      <div className="panel help-sec">
        <h2>Stay in the loop</h2>
        <ul>
          <li>
            Account menu → <b>Notifications</b>: turn them on for this phone or computer. You're told when an activity
            is changed, cancelled or back on, and when someone mentions you.
          </li>
          <li>
            Account menu → <b>Tell me about new</b>: pick the sports you want to hear about when something new is
            posted.
          </li>
          <li>
            Account menu → <b>Calendar link</b>: subscribe once and everything you're In for shows in your calendar,
            kept up to date.
          </li>
          <li>
            <b>Announcements</b> from the team admins show as a banner until you tap <b>Got it</b>.
          </li>
        </ul>
        <div className="btnrow">
          <Go href="/download/">Get the phone app</Go>
          <Go href="/announcements">Announcements</Go>
          <Go href="/updates">What's new</Go>
        </div>
      </div>

      <div className="panel help-sec">
        <h2>Team and your details</h2>
        <ul>
          <li>
            <b>Team</b> lists everyone with Call and Text. Tap a name to see their emergency contact.
          </li>
          <li>
            Account menu → <b>My contact info</b>: your mobile number and an emergency contact (optional). The whole
            team can see them.
          </li>
          <li>Account menu → your name: change how your name shows.</li>
        </ul>
        <div className="btnrow">
          <Go href="/team">Open Team</Go>
          <Go href="/past">Past activities</Go>
        </div>
      </div>

      {editor && (
        <div className="panel help-sec">
          <h2>Plan an activity (Editors)</h2>
          <ol>
            <li>
              Tap <b>Plan</b>. Pick the sport, a date and the place. A place is a map pin, or a Zoom or Meet link for an
              online meet-up.
            </li>
            <li>
              Rides and runs: search the route library or paste a RideWithGPS link, then set the pace. Other sports, or
              anything online: set the start and end times.
            </li>
            <li>
              <b>Visibility</b>: <b>Public</b> for the whole team, or <b>Private</b> to invite only the people you pick.
            </li>
            <li>
              Check the <b>Preview</b>, with the weather, then tap <b>Publish</b>. Your plan saves as you go.
            </li>
            <li>
              To change it, tap the <b>pencil</b> on the activity: update it, cancel it, or delete it (its creator or an
              Admin). Changes and cancellations are sent to everyone with notifications on.
            </li>
            <li>
              From a past activity, <b>Reuse this plan</b> starts a new one with the same details.
            </li>
          </ol>
          <Go href="/plan">Plan an activity</Go>
        </div>
      )}

      {admin && (
        <div className="panel help-sec">
          <h2>Run the team (Admins)</h2>
          <ul>
            <li>
              <b>Users</b>: invite people by email (you send them the link), change roles, disable, or create a password
              reset link.
            </li>
            <li>
              <b>Announcements</b>: post to everyone, see who got it, edit or end it.
            </li>
            <li>
              <b>Sports</b>, <b>Places</b>, ride defaults and weather warnings for the team.
            </li>
          </ul>
          <Go href="/settings">Open Settings</Go>
        </div>
      )}

      <div className="panel help-sec">
        <h2>More help</h2>
        <ul>
          <li>
            <b>Routes on your Garmin</b>: send a ride's RideWithGPS route to your Edge or watch, and what to check when
            it doesn't arrive.
          </li>
          <li>Something missing or not working? Ask a team admin.</li>
        </ul>
        <Go href="/help/garmin">Routes on your Garmin</Go>
      </div>
    </section>
  );
}
