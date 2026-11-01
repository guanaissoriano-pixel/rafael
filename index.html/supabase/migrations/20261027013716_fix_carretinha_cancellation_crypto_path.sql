/*
# Fix cancellation password verification path

1. Modified behavior
- Updates `cancel_carretinha_sale` to call the password-hash function from the installed PostgreSQL extension schema explicitly.

2. Security
- Keeps the server-side password verification, fixed search path and atomic cancellation behavior.
- No table permissions are widened and no browser-side password check is introduced.

3. Important notes
- The previous implementation could not find the hash function after setting a restricted search path, so every cancellation stopped before validating the sale.
- Existing sessions, sales and audit records are unchanged.
*/

CREATE OR REPLACE FUNCTION public.cancel_carretinha_sale(
  p_sale_id uuid,
  p_admin_password text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  IF p_admin_password IS NULL OR p_reason IS NULL OR char_length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Invalid cancellation request';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.carretinha_admin_settings
    WHERE id = true
      AND password_hash = extensions.crypt(p_admin_password, password_hash)
  ) THEN
    RAISE EXCEPTION 'Administrator authorization failed';
  END IF;

  UPDATE public.carretinha_sales
  SET status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = trim(p_reason)
  WHERE id = p_sale_id
    AND status = 'completed'
  RETURNING session_id INTO v_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale is not available for cancellation';
  END IF;

  INSERT INTO public.carretinha_cancellation_logs (sale_id, reason)
  VALUES (p_sale_id, trim(p_reason));

  UPDATE public.carretinha_sessions
  SET status = 'cancelled',
      ended_at = COALESCE(ended_at, now())
  WHERE id = v_session_id
    AND status <> 'completed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_carretinha_sale(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_carretinha_sale(uuid, text, text) TO anon, authenticated;