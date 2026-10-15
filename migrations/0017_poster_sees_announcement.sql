-- The person posting an announcement now sees its banner too, until they tap Got it (DESIGN.md → Announcements). Drop the
-- "seen" rows the app used to add for the poster when posting (same moment as the announcement), so those show again;
-- a Got it the poster tapped later is kept.
delete from announcement_seen
where exists (
  select 1 from announcements n
  where n.id = announcement_seen.announcement_id
    and n.created_by = announcement_seen.user_id
    and n.created_at = announcement_seen.at
);
