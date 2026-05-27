CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'archived')),
    provider TEXT NOT NULL DEFAULT 'anthropic',
    model TEXT NOT NULL,
    system_prompt TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    content_redacted TEXT,
    has_pii BOOLEAN DEFAULT FALSE,
    turn_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inference_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    session_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    request_started_at TIMESTAMPTZ NOT NULL,
    request_ended_at TIMESTAMPTZ,
    latency_ms INTEGER,
    time_to_first_token_ms INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    input_preview TEXT,
    output_preview TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'error', 'cancelled')),
    error_code TEXT,
    error_message TEXT,
    http_status INTEGER,
    is_streaming BOOLEAN DEFAULT FALSE,
    stream_chunks INTEGER,
    estimated_cost_microcents BIGINT,
    raw_request JSONB,
    raw_response JSONB,
    sdk_metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL,
    aggregate_id UUID,
    aggregate_type TEXT,
    payload JSONB NOT NULL DEFAULT '{}',
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics_hourly (
    hour TIMESTAMPTZ NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    total_requests INTEGER DEFAULT 0,
    successful_requests INTEGER DEFAULT 0,
    failed_requests INTEGER DEFAULT 0,
    avg_latency_ms NUMERIC,
    p50_latency_ms NUMERIC,
    p95_latency_ms NUMERIC,
    p99_latency_ms NUMERIC,
    total_tokens BIGINT DEFAULT 0,
    total_prompt_tokens BIGINT DEFAULT 0,
    total_completion_tokens BIGINT DEFAULT 0,
    estimated_cost_usd NUMERIC,
    PRIMARY KEY (hour, provider, model)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_inference_logs_conversation ON inference_logs(conversation_id);
CREATE INDEX IF NOT EXISTS idx_inference_logs_created ON inference_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inference_logs_provider_model ON inference_logs(provider, model);
CREATE INDEX IF NOT EXISTS idx_inference_logs_status ON inference_logs(status);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type, processed);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status, created_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'conversations_updated_at'
  ) THEN
    CREATE TRIGGER conversations_updated_at
      BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;