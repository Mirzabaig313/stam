-- A signed-in user's app settings (language, theme, colour mode, direction) with when they were
-- saved, as JSON: a new device starts with them (P2).
ALTER TABLE user ADD COLUMN settings TEXT;
