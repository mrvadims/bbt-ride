-- "Roll-out" is "meet time" everywhere: the rides column and the team-settings key follow.
alter table rides rename column rollout to meet_time;
delete from settings where key = 'rollout' and exists (select 1 from settings where key = 'meetTime');
update settings set key = 'meetTime' where key = 'rollout';
