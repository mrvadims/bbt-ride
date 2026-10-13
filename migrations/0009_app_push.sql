-- v2 step 3 (DESIGN.md → v2, Android app): a device is a browser's Web Push subscription or the Android app's Firebase
-- token (stored in endpoint; keys_json is '{}' for the app).
alter table push_subscriptions add column kind text not null default 'web' check (kind in ('web', 'fcm'));
