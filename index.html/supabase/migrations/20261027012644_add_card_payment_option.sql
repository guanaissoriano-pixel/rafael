/*
# Add card payment support

1. Modified tables
- `carretinha_sessions`: accepts `card` as a payment method for new rental sessions.
- `carretinha_sales`: accepts `card` as a payment method for new sales.
- `carretinha_cash_closures`: adds `card_total` to preserve the card amount in daily closing snapshots.

2. Security and integrity
- Existing rows and previous payment methods are preserved.
- The existing RLS policies and role grants remain unchanged.
- New card records use the same price checks and operational access rules as cash and Pix records.

3. Important notes
- The new closing amount defaults to zero for previous closing records.
- No data is deleted or recreated.
*/

ALTER TABLE public.carretinha_sessions
  DROP CONSTRAINT IF EXISTS carretinha_sessions_payment_method_check;
ALTER TABLE public.carretinha_sessions
  ADD CONSTRAINT carretinha_sessions_payment_method_check
  CHECK (payment_method IN ('cash', 'pix', 'card'));

ALTER TABLE public.carretinha_sales
  DROP CONSTRAINT IF EXISTS carretinha_sales_payment_method_check;
ALTER TABLE public.carretinha_sales
  ADD CONSTRAINT carretinha_sales_payment_method_check
  CHECK (payment_method IN ('cash', 'pix', 'card'));

ALTER TABLE public.carretinha_cash_closures
  ADD COLUMN IF NOT EXISTS card_total numeric(10,2) NOT NULL DEFAULT 0;
