-- migrations/0002_server_seed_enc.sql
ALTER TABLE session
  ADD COLUMN IF NOT EXISTS server_seed_enc TEXT,  -- base64 of iv|tag|ciphertext
  ADD COLUMN IF NOT EXISTS server_seed_revealed BOOLEAN DEFAULT FALSE;
