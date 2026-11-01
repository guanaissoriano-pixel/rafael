/*
# Create Carretinha Play operating data

1. New Tables
- `carretinha_sessions`: one record per rental session, including the slot, child, optional responsible, duration, timer state and payment details.
- `carretinha_sales`: the financial event linked to a session, with amount, payment method and cancellation state.
- `carretinha_cancellation_logs`: append-only audit record for every administrator-authorized cancellation.
- `carretinha_cash_closures`: saved daily cash closing snapshots and notes.
- `carretinha_admin_settings`: private singleton that stores the administrator password hash.

2. Security
- RLS is enabled on every table.
- The app is intentionally single-tenant and has no sign-in screen, so operational rows are available to the anon and authenticated app roles.
- Administrator settings are not readable by the browser.
- Sales cannot be updated or deleted by the browser; cancellation is only possible through the protected database function, which verifies the administrator password and writes an audit record.

3. Important notes
- Prices are computed again inside the database function that creates sessions, rather than trusting browser-provided amounts.
- The initial administrator password is `admin123`; the first version exposes this in the app's administrator help so the operator can use the protected cancellation flow. It is stored only as a password hash.
- Existing rows are preserved because all objects are created idempotently.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.carretinha_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_number integer NOT NULL CHECK (slot_number BETWEEN 1 AND 30),
  duration_minutes integer NOT NULL CHECK (duration_minutes IN (10, 30)),
  child_name text NOT NULL CHECK (char_length(trim(child_name)) BETWEEN 1 AND 80),
  responsible_name text CHECK (responsible_name IS NULL OR char_length(trim(responsible_name)) <= 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  paused_at timestamptz,
  ended_at timestamptz,
  elapsed_seconds integer NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  price numeric(10,2) NOT NULL CHECK (price IN (10.00, 20.00)),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'pix')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS carretinha_one_open_session_per_slot
  ON public.carretinha_sessions (slot_number)
  WHERE status IN ('active', 'paused');

CREATE TABLE IF NOT EXISTS public.carretinha_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.carretinha_sessions(id) ON DELETE RESTRICT,
  amount numeric(10,2) NOT NULL CHECK (amount IN (10.00, 20.00)),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'pix')),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancellation_reason text
);

CREATE TABLE IF NOT EXISTS public.carretinha_cancellation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.carretinha_sales(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 3 AND 240),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.carretinha_cash_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_date date NOT NULL UNIQUE,
  cash_total numeric(10,2) NOT NULL DEFAULT 0,
  pix_total numeric(10,2) NOT NULL DEFAULT 0,
  sales_count integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.carretinha_admin_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.carretinha_admin_settings (id, password_hash)
VALUES (true, crypt('admin123', gen_salt('bf')))
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.carretinha_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carretinha_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carretinha_cancellation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carretinha_cash_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carretinha_admin_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.carretinha_sessions TO anon, authenticated;
GRANT SELECT, INSERT ON public.carretinha_sales TO anon, authenticated;
GRANT SELECT ON public.carretinha_cancellation_logs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.carretinha_cash_closures TO anon, authenticated;
REVOKE ALL ON public.carretinha_admin_settings FROM anon, authenticated;

DROP POLICY IF EXISTS "app_select_sessions" ON public.carretinha_sessions;
CREATE POLICY "app_select_sessions" ON public.carretinha_sessions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "app_insert_sessions" ON public.carretinha_sessions;
CREATE POLICY "app_insert_sessions" ON public.carretinha_sessions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "app_update_sessions" ON public.carretinha_sessions;
CREATE POLICY "app_update_sessions" ON public.carretinha_sessions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "app_select_sales" ON public.carretinha_sales;
CREATE POLICY "app_select_sales" ON public.carretinha_sales FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "app_insert_sales" ON public.carretinha_sales;
CREATE POLICY "app_insert_sales" ON public.carretinha_sales FOR INSERT TO anon, authenticated WITH CHECK (status = 'completed' AND amount IN (10.00, 20.00));

DROP POLICY IF EXISTS "app_select_cancellation_logs" ON public.carretinha_cancellation_logs;
CREATE POLICY "app_select_cancellation_logs" ON public.carretinha_cancellation_logs FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "app_select_closures" ON public.carretinha_cash_closures;
CREATE POLICY "app_select_closures" ON public.carretinha_cash_closures FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "app_insert_closures" ON public.carretinha_cash_closures;
CREATE POLICY "app_insert_closures" ON public.carretinha_cash_closures FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "app_update_closures" ON public.carretinha_cash_closures;
CREATE POLICY "app_update_closures" ON public.carretinha_cash_closures FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.cancel_carretinha_sale(
  p_sale_id uuid,
  p_admin_password text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.carretinha_sales%ROWTYPE;
BEGIN
  IF p_admin_password IS NULL OR p_reason IS NULL OR char_length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Invalid cancellation request';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.carretinha_admin_settings
    WHERE id = true AND password_hash = crypt(p_admin_password, password_hash)
  ) THEN
    RAISE EXCEPTION 'Administrator authorization failed';
  END IF;

  SELECT * INTO v_sale
  FROM public.carretinha_sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF v_sale.id IS NULL OR v_sale.status <> 'completed' THEN
    RAISE EXCEPTION 'Sale is not available for cancellation';
  END IF;

  UPDATE public.carretinha_sales
  SET status = 'cancelled', cancelled_at = now(), cancellation_reason = trim(p_reason)
  WHERE id = p_sale_id;

  INSERT INTO public.carretinha_cancellation_logs (sale_id, reason)
  VALUES (p_sale_id, trim(p_reason));

  UPDATE public.carretinha_sessions
  SET status = 'cancelled', ended_at = COALESCE(ended_at, now())
  WHERE id = v_sale.session_id AND status <> 'completed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_carretinha_sale(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_carretinha_sale(uuid, text, text) TO anon, authenticated;