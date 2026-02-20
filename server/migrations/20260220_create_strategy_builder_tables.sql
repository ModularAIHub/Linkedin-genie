-- Strategy Builder tables for LinkedIn Genie
-- Created: 2026-02-20

CREATE TABLE IF NOT EXISTS user_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  team_id UUID,
  niche TEXT,
  target_audience TEXT,
  content_goals TEXT[] DEFAULT '{}',
  posting_frequency TEXT,
  tone_style TEXT,
  topics TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS strategy_chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS strategy_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  variables JSONB DEFAULT '{}'::jsonb,
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,
  is_favorite BOOLEAN DEFAULT false,
  performance_score DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_strategies_user_id ON user_strategies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_strategies_team_id ON user_strategies(team_id);
CREATE INDEX IF NOT EXISTS idx_user_strategies_status ON user_strategies(status);

CREATE INDEX IF NOT EXISTS idx_strategy_chat_strategy_id ON strategy_chat_history(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_chat_created_at ON strategy_chat_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_prompts_strategy_id ON strategy_prompts(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_prompts_category ON strategy_prompts(category);
CREATE INDEX IF NOT EXISTS idx_strategy_prompts_favorite ON strategy_prompts(is_favorite) WHERE is_favorite = true;

CREATE OR REPLACE FUNCTION set_strategy_builder_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_user_strategies_updated_at'
  ) THEN
    CREATE TRIGGER trg_user_strategies_updated_at
    BEFORE UPDATE ON user_strategies
    FOR EACH ROW
    EXECUTE FUNCTION set_strategy_builder_updated_at();
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_strategy_prompts_updated_at'
  ) THEN
    CREATE TRIGGER trg_strategy_prompts_updated_at
    BEFORE UPDATE ON strategy_prompts
    FOR EACH ROW
    EXECUTE FUNCTION set_strategy_builder_updated_at();
  END IF;
END;
$$;
