/*
# Change administrator cancellation password

1. Modified data
- `carretinha_admin_settings.password_hash`: replaces the administrator password hash used to authorize sale cancellations.

2. Security
- The new password is converted to a bcrypt hash inside PostgreSQL.
- The plain password is not stored in the table and the settings row remains inaccessible to the browser.
- Existing sessions, sales, cancellation records and daily closings are unchanged.

3. Important notes
- The new administrator password is `821227`.
- The cancellation function continues to validate the password server-side before changing any sale.
*/

UPDATE public.carretinha_admin_settings
SET password_hash = crypt('821227', gen_salt('bf'))
WHERE id = true;