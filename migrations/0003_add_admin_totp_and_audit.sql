-- migrations/0003_add_admin_totp_and_audit.sql
-- Add admin flag + totp secret; add server_seed_key_enc; create admin_audit table

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_secret text;

ALTER TABLE session
  ADD COLUMN IF NOT EXISTS server_seed_key_enc text;

CREATE TABLE IF NOT EXISTS admin_audit (
  id bigserial PRIMARY KEY,
  admin_id text NOT NULL REFERENCES app_user(id),
  action text NOT NULL,
  target jsonb NULL,
  meta jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
