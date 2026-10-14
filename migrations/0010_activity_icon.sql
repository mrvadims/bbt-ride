-- Sport icons (DESIGN.md → v2, Sport icons): an Other activity can show an icon an editor picked from shared/sport-icons.ts.
-- Null shows the sport's own icon; the API keeps it null for every sport but Other.
alter table activities add column icon text;
