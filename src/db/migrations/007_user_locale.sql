-- 007_user_locale.sql
ALTER TABLE users ADD COLUMN locale VARCHAR(10) DEFAULT NULL;
