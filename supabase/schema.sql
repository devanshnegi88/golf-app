-- =====================================================================
--  Par4Good — Complete Supabase Schema
--  Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────
-- PROFILES  (extends auth.users)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL DEFAULT '',
  role                TEXT NOT NULL DEFAULT 'subscriber'
                        CHECK (role IN ('subscriber','admin')),
  charity_id          UUID,
  charity_percent     INT  NOT NULL DEFAULT 10
                        CHECK (charity_percent BETWEEN 10 AND 100),
  stripe_customer_id  TEXT UNIQUE,
  country             TEXT DEFAULT 'GB',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- SUBSCRIPTIONS
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status                  TEXT NOT NULL DEFAULT 'inactive'
                            CHECK (status IN ('inactive','active','cancelled','lapsed','past_due')),
  plan                    TEXT CHECK (plan IN ('monthly','yearly')),
  amount_pence            INT  DEFAULT 0,
  currency                TEXT DEFAULT 'gbp',
  stripe_subscription_id  TEXT UNIQUE,
  stripe_customer_id      TEXT,
  stripe_price_id         TEXT,
  cancel_at_period_end    BOOLEAN DEFAULT FALSE,
  start_date              DATE,
  end_date                DATE,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id)   -- one subscription row per user (upserted)
);

-- ─────────────────────────────────────────────────────────────────────
-- SCORES  (Stableford, max 5 rolling, 1 per date)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scores (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  score      INT  NOT NULL CHECK (score BETWEEN 1 AND 45),
  date       DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, date)
);

-- Trigger: enforce 5-score rolling window
CREATE OR REPLACE FUNCTION public.enforce_score_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_count INT; v_oldest UUID;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.scores WHERE user_id = NEW.user_id;
  IF v_count >= 5 THEN
    SELECT id INTO v_oldest FROM public.scores
    WHERE user_id = NEW.user_id ORDER BY date ASC, created_at ASC LIMIT 1;
    DELETE FROM public.scores WHERE id = v_oldest;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_score_limit ON public.scores;
CREATE TRIGGER trg_score_limit
  BEFORE INSERT ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.enforce_score_limit();

-- ─────────────────────────────────────────────────────────────────────
-- CHARITIES
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.charities (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  description     TEXT DEFAULT '',
  mission         TEXT DEFAULT '',
  website         TEXT DEFAULT '',
  image_url       TEXT DEFAULT '',
  events          JSONB DEFAULT '[]',
  featured        BOOLEAN DEFAULT FALSE,
  active          BOOLEAN DEFAULT TRUE,
  total_received  BIGINT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- DRAWS
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.draws (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  month               TEXT NOT NULL UNIQUE,   -- YYYY-MM
  draw_type           TEXT NOT NULL DEFAULT 'random'
                        CHECK (draw_type IN ('random','algorithmic')),
  algo_mode           TEXT DEFAULT 'frequent'
                        CHECK (algo_mode IN ('frequent','infrequent')),
  numbers             INT[] NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','simulated','published')),
  prize_pool_total    BIGINT DEFAULT 0,
  match5_amount       BIGINT DEFAULT 0,
  match4_amount       BIGINT DEFAULT 0,
  match3_amount       BIGINT DEFAULT 0,
  jackpot_rollover    BIGINT DEFAULT 0,
  active_subscribers  INT DEFAULT 0,
  simulation_data     JSONB,
  notes               TEXT DEFAULT '',
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- DRAW WINNERS
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.draw_winners (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  draw_id      UUID NOT NULL REFERENCES public.draws(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_count  INT NOT NULL CHECK (match_count IN (3,4,5)),
  prize_amount BIGINT NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','verified','rejected','paid')),
  proof_url    TEXT,
  proof_submitted_at TIMESTAMPTZ,
  verified_by  UUID REFERENCES public.profiles(id),
  verified_at  TIMESTAMPTZ,
  rejection_reason TEXT,
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (draw_id, user_id)
);

-- ─────────────────────────────────────────────────────────────────────
-- PAYMENTS  (subscriptions + charity donations)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_pence    BIGINT NOT NULL,
  currency        TEXT DEFAULT 'gbp',
  type            TEXT CHECK (type IN ('subscription','charity_auto','charity_manual')),
  charity_id      UUID REFERENCES public.charities(id),
  status          TEXT DEFAULT 'paid',
  stripe_pi       TEXT,
  reference       TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────
-- STRIPE EVENTS  (webhook idempotency)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  payload      JSONB
);

-- ─────────────────────────────────────────────────────────────────────
-- NOTIFICATIONS  (email log)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,  -- draw_result | winner_alert | payment_success | etc.
  subject     TEXT,
  sent_at     TIMESTAMPTZ DEFAULT NOW(),
  status      TEXT DEFAULT 'sent'
);

-- ─────────────────────────────────────────────────────────────────────
-- AUTO-CREATE PROFILE ON SIGNUP
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)),
    COALESCE(NEW.raw_user_meta_data->>'role','subscriber')
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DO $$ BEGIN
  CREATE TRIGGER trg_profiles_upd BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_subs_upd BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_scores_upd BEFORE UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role='admin');
$$;

CREATE OR REPLACE FUNCTION public.has_active_subscription()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM public.subscriptions WHERE user_id = auth.uid() AND status='active');
$$;

CREATE OR REPLACE FUNCTION public.user_id_from_stripe_customer(cus_id TEXT)
RETURNS UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id FROM public.profiles WHERE stripe_customer_id = cus_id LIMIT 1;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draws            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draw_winners     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications    ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (id = auth.uid() OR is_admin());
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (id = auth.uid() OR is_admin());
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());

-- subscriptions
CREATE POLICY "subs_select" ON public.subscriptions FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "subs_insert" ON public.subscriptions FOR INSERT WITH CHECK (user_id = auth.uid() OR is_admin());
CREATE POLICY "subs_update" ON public.subscriptions FOR UPDATE USING (user_id = auth.uid() OR is_admin());

-- scores
CREATE POLICY "scores_select" ON public.scores FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "scores_insert" ON public.scores FOR INSERT WITH CHECK (user_id = auth.uid() AND has_active_subscription());
CREATE POLICY "scores_update" ON public.scores FOR UPDATE USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "scores_delete" ON public.scores FOR DELETE USING (user_id = auth.uid() OR is_admin());

-- charities
CREATE POLICY "charities_public_read" ON public.charities FOR SELECT USING (active = TRUE OR is_admin());
CREATE POLICY "charities_admin_write" ON public.charities FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "charities_admin_update" ON public.charities FOR UPDATE USING (is_admin());
CREATE POLICY "charities_admin_delete" ON public.charities FOR DELETE USING (is_admin());

-- draws
CREATE POLICY "draws_public_read" ON public.draws FOR SELECT USING (status = 'published' OR is_admin());
CREATE POLICY "draws_admin_write" ON public.draws FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "draws_admin_update" ON public.draws FOR UPDATE USING (is_admin());

-- draw_winners
CREATE POLICY "winners_select" ON public.draw_winners FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "winners_insert" ON public.draw_winners FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "winners_update" ON public.draw_winners FOR UPDATE USING ((user_id = auth.uid() AND status = 'pending') OR is_admin());

-- payments
CREATE POLICY "payments_select" ON public.payments FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "payments_insert" ON public.payments FOR INSERT WITH CHECK (user_id = auth.uid() OR is_admin());

-- stripe_events
CREATE POLICY "stripe_events_admin" ON public.stripe_events FOR ALL USING (is_admin());

-- notifications
CREATE POLICY "notifs_select" ON public.notifications FOR SELECT USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "notifs_insert" ON public.notifications FOR INSERT WITH CHECK (is_admin());

-- ─────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_scores_user_date       ON public.scores (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_subs_user              ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subs_status            ON public.subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_subs_stripe_sub        ON public.subscriptions (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe        ON public.profiles (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_draws_month            ON public.draws (month DESC);
CREATE INDEX IF NOT EXISTS idx_winners_draw           ON public.draw_winners (draw_id);
CREATE INDEX IF NOT EXISTS idx_winners_user           ON public.draw_winners (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user          ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS idx_charities_featured     ON public.charities (featured, active);
