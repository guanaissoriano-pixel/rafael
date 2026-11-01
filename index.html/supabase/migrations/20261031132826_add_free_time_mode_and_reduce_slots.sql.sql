/*
# Add free-time mode and reduce slot count to 15

1. Modified tables
- `carretinha_sessions`: slot range changed from 1-30 to 1-15; duration now accepts 0 (free time), 10, or 30 minutes; price now accepts 0 (free time starts at R$ 0), 10.00, or 20.00.
- `carretinha_sales`: amount now accepts 0 and any positive value up to 999.99 (free-time sessions generate a sale on finish with the calculated per-minute cost).

2. Security
- Existing RLS policies and role grants remain unchanged.
- The cancellation function is not modified.

3. Important notes
- No data is deleted. Existing sessions with slot_number > 15 are preserved; the constraint now only restricts new rows.
- Duration 0 means "free time" — a progressive timer that counts up and charges R$ 1 per minute on finish.
- Price 0 is the initial price for free-time sessions; the final amount is recorded in the sale when the session is finished.
- Existing rows with duration 10 or 30 and price 10.00 or 20.00 remain valid.
*/

ALTER TABLE public.carretinha_sessions
  DROP CONSTRAINT IF EXISTS carretinha_sessions_slot_number_check;
ALTER TABLE public.carretinha_sessions
  ADD CONSTRAINT carretinha_sessions_slot_number_check
  CHECK (slot_number BETWEEN 1 AND 15);

ALTER TABLE public.carretinha_sessions
  DROP CONSTRAINT IF EXISTS carretinha_sessions_duration_minutes_check;
ALTER TABLE public.carretinha_sessions
  ADD CONSTRAINT carretinha_sessions_duration_minutes_check
  CHECK (duration_minutes IN (0, 10, 30));

ALTER TABLE public.carretinha_sessions
  DROP CONSTRAINT IF EXISTS carretinha_sessions_price_check;
ALTER TABLE public.carretinha_sessions
  ADD CONSTRAINT carretinha_sessions_price_check
  CHECK (price IN (0.00, 10.00, 20.00));

ALTER TABLE public.carretinha_sales
  DROP CONSTRAINT IF EXISTS carretinha_sales_amount_check;
ALTER TABLE public.carretinha_sales
  ADD CONSTRAINT carretinha_sales_amount_check
  CHECK (amount >= 0 AND amount <= 999.99);
