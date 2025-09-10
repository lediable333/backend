-- migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  photo_url TEXT,
  banned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_balance (
  user_id TEXT PRIMARY KEY REFERENCES app_user(id),
  balance INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  wheel_size INT NOT NULL DEFAULT 17,
  server_seed_hash TEXT, -- sha256 hex
  server_seed_revealed BOOLEAN DEFAULT FALSE,
  config_json JSONB NOT NULL, -- masks, supplies, goals snapshot
  snapshot_hash TEXT,
  published_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spin (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES session(id),
  user_id TEXT REFERENCES app_user(id),
  client_spin_id TEXT NOT NULL,
  nonce BIGINT NOT NULL,
  chosen_index INT NOT NULL,
  set_id TEXT NOT NULL,
  proof_hmac TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, client_spin_id)
);

CREATE TABLE IF NOT EXISTS ticket_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  delta INT NOT NULL,
  balance_after INT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prize_supply (
  session_id UUID REFERENCES session(id),
  slot_index INT NOT NULL,
  prize_id TEXT,
  supply BIGINT, -- NULL => infinite
  PRIMARY KEY(session_id, slot_index)
);
