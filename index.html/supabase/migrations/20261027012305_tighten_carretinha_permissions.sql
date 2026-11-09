/*
# Tighten Carretinha Play Data API permissions

1. Modified tables
- `carretinha_sessions`: browser keeps only the SELECT, INSERT and UPDATE actions needed to operate timers.
- `carretinha_sales`: browser keeps only SELECT and INSERT; sales cannot be edited or deleted directly.
- `carretinha_cancellation_logs`: browser can only read the audit history.
- `carretinha_cash_closures`: browser keeps only SELECT, INSERT and UPDATE for daily closing snapshots.

2. Security
- Remove any broader role privileges that may have been inherited from default database grants.
- Keep the cancellation function callable to the no-sign-in app because it performs the administrator password check inside the database.
- The private administrator settings table remains unreachable from the browser.

3. Important notes
- This migration does not delete data or change columns.
- The database function remains the only path that can change a sale to cancelled and write its audit record.
*/

REVOKE ALL ON public.carretinha_sessions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.carretinha_sessions TO anon, authenticated;

REVOKE ALL ON public.carretinha_sales FROM anon, authenticated;
GRANT SELECT, INSERT ON public.carretinha_sales TO anon, authenticated;

REVOKE ALL ON public.carretinha_cancellation_logs FROM anon, authenticated;
GRANT SELECT ON public.carretinha_cancellation_logs TO anon, authenticated;

REVOKE ALL ON public.carretinha_cash_closures FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.carretinha_cash_closures TO anon, authenticated;

REVOKE ALL ON public.carretinha_admin_settings FROM anon, authenticated;
-- Garante que o RLS está ativo nas tabelas
ALTER TABLE carretinha_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE carretinha_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE carretinha_cash_closures ENABLE ROW LEVEL SECURITY;

-- Remove políticas antigas se já existirem (para evitar conflito de duplicidade)
DROP POLICY IF EXISTS "Acesso total em carretinha_sessions" ON carretinha_sessions;
DROP POLICY IF EXISTS "Acesso total em carretinha_sales" ON carretinha_sales;
DROP POLICY IF EXISTS "Acesso total em carretinha_cash_closures" ON carretinha_cash_closures;

-- Cria novas políticas permitindo leitura, inserção, atualização e exclusão públicas
CREATE POLICY "Acesso total em carretinha_sessions" 
ON carretinha_sessions FOR ALL 
USING (true) WITH CHECK (true);

CREATE POLICY "Acesso total em carretinha_sales" 
ON carretinha_sales FOR ALL 
USING (true) WITH CHECK (true);

CREATE POLICY "Acesso total em carretinha_cash_closures" 
ON carretinha_cash_closures FOR ALL 
USING (true) WITH CHECK (true);
