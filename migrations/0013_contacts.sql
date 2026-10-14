-- Phone and emergency contact on each account (DESIGN.md → Team and contacts). Phones are stored as "+" and digits.
-- Existing members have none yet; the app asks for a phone on their next visit.
alter table "user" add column phone text;
alter table "user" add column emergency_name text;
alter table "user" add column emergency_phone text;
