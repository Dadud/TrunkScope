-- Operational configuration persisted independently from deployment environment.
CREATE TABLE IF NOT EXISTS app_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS scan_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  pause_on_activity boolean NOT NULL DEFAULT true,
  resume_after_ms integer NOT NULL DEFAULT 5000 CHECK (resume_after_ms >= 0),
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retention_policies (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  audio_days integer NOT NULL DEFAULT 30 CHECK (audio_days > 0),
  transcript_days integer NOT NULL DEFAULT 365 CHECK (transcript_days > 0),
  metadata_days integer NOT NULL DEFAULT 365 CHECK (metadata_days > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO retention_policies (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS systems (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  protocol text NOT NULL,
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Use a namespaced table so installs that already have a legacy `calls`
-- table with a different relational schema remain fully writable.
CREATE TABLE IF NOT EXISTS trunkscope_calls (
    id uuid PRIMARY KEY,
    started_at timestamptz NOT NULL,
    document jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receiver_profiles (
    id integer PRIMARY KEY,
    document jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
