-- Password reset by birthday. Accounts made before this keep their recovery
-- code (recovery_kind 'code') until the owner adds a birthday in Settings.
-- Wrong reset answers are counted per account so a birthday cannot be guessed
-- by trying every date.
ALTER TABLE users ADD COLUMN recovery_kind TEXT NOT NULL DEFAULT 'code';
ALTER TABLE users ADD COLUMN reset_fails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN reset_locked_until INTEGER NOT NULL DEFAULT 0;
