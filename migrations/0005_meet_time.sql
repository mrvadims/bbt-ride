-- "Roll-out" is "meet time" everywhere: the rides column and the team-settings key follow.
alter table rides rename column rollout to meet_time;
update settings set key = 'meetTime' where key = 'rollout';
