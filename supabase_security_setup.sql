-- ====================================================================
-- Duet Karaoke Maker - Database Security & Row Level Security (RLS) Setup
-- Run this script in the Supabase SQL Editor (https://supabase.com/dashboard)
-- ====================================================================

-- 1. Ensure profiles table structure with constraints
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 6,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Upgrade existing table if columns are missing
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 6;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- Auto-create / backfill profiles for all existing auth.users
INSERT INTO public.profiles (id, email, credits)
SELECT id, email, 6
FROM auth.users
ON CONFLICT (id) DO UPDATE SET 
  email = EXCLUDED.email,
  credits = COALESCE(public.profiles.credits, 6);

-- Trigger to automatically create profile for any new user signing up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, credits)
  VALUES (new.id, new.email, 6)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. ENABLE ROW LEVEL SECURITY (Mandatory)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop any previous insecure or overlapping policies
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Enable all for users" ON public.profiles;

-- 3. STRICT READ POLICY: Users can ONLY read their own profile
CREATE POLICY "Users can view own profile" 
ON public.profiles 
FOR SELECT 
TO authenticated 
USING (auth.uid() = id);

-- 4. STRICT INSERT POLICY: User can only insert their own row on first signup
CREATE POLICY "Users can insert own profile on signup" 
ON public.profiles 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = id);

-- 5. PREVENT CLIENT-SIDE CREDIT TAMPERING:
-- Direct client updates to the 'credits' column are forbidden.
-- Users cannot modify their own credits via client-side supabase.from('profiles').update().
REVOKE UPDATE (credits) ON public.profiles FROM authenticated, anon;

-- 6. ATOMIC, SERVER-CONTROLLED TOKEN DEDUCTION (RPC)
-- Runs with SECURITY DEFINER so it can modify credits safely on behalf of the authenticated user.
CREATE OR REPLACE FUNCTION public.deduct_tokens(tokens_needed INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_current_credits INT;
  v_new_credits INT;
BEGIN
  -- Verify caller is logged in
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized');
  END IF;

  IF tokens_needed <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid token amount requested');
  END IF;

  -- Lock row for update to prevent race conditions
  SELECT credits INTO v_current_credits
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF v_current_credits IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  IF v_current_credits < tokens_needed THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Insufficient credits', 
      'credits', v_current_credits
    );
  END IF;

  v_new_credits := v_current_credits - tokens_needed;

  UPDATE public.profiles
  SET credits = v_new_credits, updated_at = timezone('utc'::text, now())
  WHERE id = v_user_id;

  RETURN jsonb_build_object('success', true, 'credits', v_new_credits);
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.deduct_tokens(INT) TO authenticated;

-- 7. SECURE ADMIN RPC FUNCTIONS (Protected by Admin Email Check)
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT;
  v_result JSONB;
BEGIN
  SELECT email INTO v_caller_email FROM auth.users WHERE id = auth.uid();

  IF v_caller_email IS NULL OR lower(v_caller_email) NOT IN ('feroznadafm@gmail.com') THEN
    RETURN jsonb_build_object('error', 'Unauthorized: Admin access required');
  END IF;

  -- Ensure any auth.users missing from profiles get created
  INSERT INTO public.profiles (id, email, credits)
  SELECT u.id, u.email, 6
  FROM auth.users u
  ON CONFLICT (id) DO NOTHING;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'credits', COALESCE(p.credits, 6),
      'created_at', u.created_at
    )
  ) INTO v_result
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY u.created_at DESC;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_all_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_credits(target_email TEXT, new_credits INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT;
BEGIN
  SELECT email INTO v_caller_email FROM auth.users WHERE id = auth.uid();

  IF v_caller_email IS NULL OR lower(v_caller_email) NOT IN ('feroznadafm@gmail.com') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Admin access required');
  END IF;

  IF new_credits < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Credits cannot be negative');
  END IF;

  UPDATE public.profiles
  SET credits = new_credits, updated_at = timezone('utc'::text, now())
  WHERE lower(email) = lower(trim(target_email));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User with email not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'email', target_email, 'credits', new_credits);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_credits(TEXT, INT) TO authenticated;

-- 7B. SECURE SERVER-AUTHENTICATED ADMIN FUNCTIONS (Secret Token Verified)
CREATE OR REPLACE FUNCTION public.server_admin_get_users(p_secret_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_secret_token IS NULL OR (
     p_secret_token != 'd74f260388d745a584065672ab684346e499a09945199651586a1df2775fec6f'
     AND COALESCE(auth.role(), '') != 'service_role'
  ) THEN
    RETURN jsonb_build_object('error', 'Unauthorized caller');
  END IF;

  -- Ensure any auth.users missing from profiles get created
  INSERT INTO public.profiles (id, email, credits)
  SELECT u.id, u.email, 6
  FROM auth.users u
  ON CONFLICT (id) DO NOTHING;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'credits', COALESCE(p.credits, 6),
      'created_at', u.created_at
    )
  ) INTO v_result
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY u.created_at DESC;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.server_admin_get_users(TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.server_admin_update_credits(
  p_secret_token TEXT,
  p_target_email TEXT,
  p_amount INT,
  p_mode TEXT DEFAULT 'set'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_credits INT;
  v_new_credits INT;
  v_user_id UUID;
BEGIN
  IF p_secret_token IS NULL OR (
     p_secret_token != 'd74f260388d745a584065672ab684346e499a09945199651586a1df2775fec6f'
     AND COALESCE(auth.role(), '') != 'service_role'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized caller');
  END IF;

  p_target_email := lower(trim(p_target_email));

  IF p_target_email IS NULL OR p_target_email = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Target customer email is required');
  END IF;

  SELECT id, credits INTO v_user_id, v_current_credits
  FROM public.profiles
  WHERE lower(email) = p_target_email
  FOR UPDATE;

  IF v_current_credits IS NULL THEN
    SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = p_target_email;
    IF v_user_id IS NOT NULL THEN
      IF p_mode = 'add' THEN
        v_new_credits := GREATEST(0, 6 + p_amount);
      ELSIF p_mode = 'remove' THEN
        v_new_credits := GREATEST(0, 6 - p_amount);
      ELSE
        v_new_credits := GREATEST(0, p_amount);
      END IF;

      INSERT INTO public.profiles (id, email, credits)
      VALUES (v_user_id, p_target_email, v_new_credits)
      ON CONFLICT (id) DO UPDATE SET credits = v_new_credits;

      RETURN jsonb_build_object('success', true, 'email', p_target_email, 'credits', v_new_credits, 'previous_credits', 0);
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'User not found in system with email: ' || p_target_email);
    END IF;
  END IF;

  IF p_mode = 'add' THEN
    v_new_credits := GREATEST(0, v_current_credits + p_amount);
  ELSIF p_mode = 'remove' THEN
    v_new_credits := GREATEST(0, v_current_credits - p_amount);
  ELSE
    v_new_credits := GREATEST(0, p_amount);
  END IF;

  UPDATE public.profiles
  SET credits = v_new_credits, updated_at = timezone('utc'::text, now())
  WHERE lower(email) = p_target_email;

  RETURN jsonb_build_object('success', true, 'email', p_target_email, 'credits', v_new_credits, 'previous_credits', v_current_credits);
END;
$$;

GRANT EXECUTE ON FUNCTION public.server_admin_update_credits(TEXT, TEXT, INT, TEXT) TO anon, authenticated, service_role;

-- ====================================================================
-- 8. AUTOMATED CASHFREE PAYMENTS & ATOMIC TOKEN RECHARGE (IDEMPOTENT)
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT UNIQUE NOT NULL,
  cf_payment_id TEXT,
  email TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  tokens INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  payment_method TEXT DEFAULT 'cashfree',
  raw_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
CREATE POLICY "Users can view own payments"
ON public.payments
FOR SELECT
TO authenticated
USING (lower(email) = lower(auth.jwt() ->> 'email'));

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_email ON public.payments (lower(email));
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments (status);

-- Atomic, Idempotent Function to credit tokens from verified Cashfree payment
CREATE OR REPLACE FUNCTION public.credit_tokens_from_payment(
  p_secret_token TEXT,
  p_order_id TEXT,
  p_payment_id TEXT,
  p_email TEXT,
  p_tokens INT,
  p_amount NUMERIC,
  p_payment_method TEXT DEFAULT 'cashfree',
  p_raw_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_status TEXT;
  v_current_credits INT;
  v_new_credits INT;
  v_user_id UUID;
BEGIN
  -- 1. Security Check: Validate Secret Token or Service Role
  IF p_secret_token IS NULL OR (
     p_secret_token != 'd74f260388d745a584065672ab684346e499a09945199651586a1df2775fec6f'
     AND COALESCE(auth.role(), '') != 'service_role'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized caller');
  END IF;

  p_email := lower(trim(p_email));
  p_order_id := trim(p_order_id);

  IF p_email IS NULL OR p_email = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid email address');
  END IF;

  IF p_tokens <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid token quantity');
  END IF;

  -- 2. Idempotency Check: Prevent duplicate crediting
  SELECT status INTO v_existing_status
  FROM public.payments
  WHERE order_id = p_order_id;

  IF v_existing_status = 'PAID' OR v_existing_status = 'SUCCESS' THEN
    SELECT credits INTO v_current_credits
    FROM public.profiles
    WHERE lower(email) = p_email;

    RETURN jsonb_build_object(
      'success', true,
      'already_credited', true,
      'credits', COALESCE(v_current_credits, 0),
      'message', 'Payment already processed and tokens credited.'
    );
  END IF;

  -- 3. Atomically update user profile credits
  SELECT id, credits INTO v_user_id, v_current_credits
  FROM public.profiles
  WHERE lower(email) = p_email
  FOR UPDATE;

  IF v_current_credits IS NULL THEN
    SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = p_email;
    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.profiles (id, email, credits)
      VALUES (v_user_id, p_email, 6 + p_tokens)
      ON CONFLICT (id) DO UPDATE SET credits = profiles.credits + p_tokens
      RETURNING credits INTO v_new_credits;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'User profile not found for email: ' || p_email);
    END IF;
  ELSE
    v_new_credits := v_current_credits + p_tokens;
    UPDATE public.profiles
    SET credits = v_new_credits, updated_at = timezone('utc'::text, now())
    WHERE lower(email) = p_email;
  END IF;

  -- 4. Record or update successful payment record
  INSERT INTO public.payments (order_id, cf_payment_id, email, amount, tokens, status, payment_method, raw_payload, updated_at)
  VALUES (p_order_id, p_payment_id, p_email, p_amount, p_tokens, 'PAID', p_payment_method, p_raw_payload, timezone('utc'::text, now()))
  ON CONFLICT (order_id) DO UPDATE
  SET cf_payment_id = EXCLUDED.cf_payment_id,
      status = 'PAID',
      payment_method = EXCLUDED.payment_method,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = timezone('utc'::text, now());

  RETURN jsonb_build_object(
    'success', true,
    'already_credited', false,
    'credits', v_new_credits,
    'tokens_added', p_tokens
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.credit_tokens_from_payment(TEXT, TEXT, TEXT, TEXT, INT, NUMERIC, TEXT, JSONB) TO anon, authenticated, service_role;

-- ====================================================================
-- 9. HIGH CONCURRENCY CONNECTION POOLING CONFIGURATION (SUPAVISOR - PORT 6543)
-- To support thousands of concurrent users on the Supabase free tier:
-- 1. In Supabase Dashboard -> Project Settings -> Database -> Connection string:
--    Select "Transaction" mode (Port 6543) instead of "Session" (Port 5432).
-- 2. Supavisor Transaction Pooler reuses small physical PostgreSQL connections
--    instantly across thousands of concurrent client requests.
-- ====================================================================

-- Optimize profile indexes for high concurrent queries (avoids sequential table scans)
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON public.profiles (lower(email));
CREATE INDEX IF NOT EXISTS idx_profiles_credits ON public.profiles (credits);

-- Ensure atomic read/write performance
ALTER TABLE public.profiles SET (fillfactor = 90);

-- ====================================================================
-- Database Security & Concurrency Configuration Complete!
-- ====================================================================
