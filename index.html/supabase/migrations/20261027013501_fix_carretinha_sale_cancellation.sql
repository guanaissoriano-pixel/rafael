/*
# Fix administrator sale cancellation

1. Modified behavior
- Replaces the cancellation function implementation so it atomically claims only a completed sale, marks it cancelled, records the reason and frees its rental session.

2. Security
- The function remains server-enforced and uses the stored administrator password hash.
- It runs with a fixed search path and disables row-security interaction for the controlled internal mutation, while keeping the browser unable to update or delete sales directly.
- The administrator settings table remains private.

3. Important notes
- If the sale is already cancelled, missing, or the password is wrong, the operation fails without changing any data.
- Existing sales and cancellation logs are preserved.
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
      AND password_hash = crypt(p_admin_password, password_hash)
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