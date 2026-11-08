# Amore: free manual recovery for orders, inquiries, and settings

## Current plan and limits

Checked on November 8, 2026: the connected Supabase organization is on the **Free** plan and its project is active.

- Supabase documents automatic daily database backups for Pro, Team, and Enterprise plans. Free projects do **not** get those scheduled backups or the dashboard's daily-backup restore option.
- Supabase recommends that Free projects regularly export their data and keep an off-site copy. The Dashboard SQL Editor can export query results as CSV, and Supabase documents importing CSV files through the Table Editor.
- Point-in-Time Recovery (PITR) is a paid add-on for paid plans. It is not enabled for this recovery plan and must not be activated without the owner's approval.
- A manual CSV export is a data copy, not a full project backup. It does not recreate project configuration, authentication settings/users, Storage objects, or other Supabase services.

Official references:

- [Supabase database backups and plan retention](https://supabase.com/docs/guides/platform/backups)
- [Supabase CSV import](https://supabase.com/docs/guides/database/import-data)
- [Supabase CLI database dump reference](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [Supabase user management and export](https://supabase.com/docs/guides/auth/managing-user-data)

## What is covered

The record tables in this checklist are:

- `public.customer_orders` — private checkout records, including contact and delivery details.
- `public.cafe_inquiries` — private café contacts and inquiry details.
- `public.store_settings` — the Amore settings row (`id = 'amore'`).

All three tables have row-level security enabled and no public access. The application accesses them from its server using a server-only key. Keep that key out of exports, shell history, screenshots, email, and Git.

The account-order table `public.orders` is a customer-readable projection maintained from `customer_orders`. Do not export/import it as a separate source of truth; verify it after restoring its source orders. Account-linked orders also reference Supabase Auth user IDs. If Auth users were lost or the whole project must be recreated, this checklist alone is insufficient: recover/configure Auth separately before restoring those orders.

The project schema is tracked in `lib/db/migrations/`. Keep those migrations with the code; they contain schema, not customer order or inquiry exports.

## Secure manual export

1. Export on a private, trusted device with full-disk encryption enabled. Use an encrypted external drive or encrypted container as the off-site copy. Do not use a shared/public computer.
2. In the Supabase Dashboard, confirm the correct Amore project, then open **SQL Editor**. Run each query separately and use the results' CSV download/export action:

   ```sql
   select * from public.customer_orders order by created_at, id;
   ```

   ```sql
   select * from public.cafe_inquiries order by id;
   ```

   ```sql
   select * from public.store_settings where id = 'amore';
   ```

3. Save the three files with a date in their names, for example `amore-orders-YYYY-MM-DD.csv`, `amore-inquiries-YYYY-MM-DD.csv`, and `amore-settings-YYYY-MM-DD.csv`.
4. Move the files promptly into the encrypted backup location. Keep access limited to the owner. Do not put them in the Replit workspace, Git, email, chat, or an unencrypted/public cloud folder. The repository ignores common recovery-export paths and dump files as a safety net, but that does not make workspace storage appropriate.
5. Record only the export date, project, table names, and row counts in a separate non-sensitive checklist. Never record customer names, phone numbers, addresses, emails, notes, order tokens, payment links, or payment identifiers there.
6. Open each CSV locally to confirm it is readable and has the expected headers and row count; do not paste its contents into tickets, chat, or logs. Keep two encrypted copies in separate secure locations. Securely delete any temporary plaintext copies.
7. Repeat at least weekly and after a significant settings change. Retain only as long as needed for recovery and applicable business/legal requirements; securely delete retired copies.

These are operational instructions only. No customer rows were exported or copied as part of this task.

## Restore checklist

Restoring changes live data. First identify the exact target project and the intended recovery point; if there is any doubt, stop before importing. Do not create a new paid project or enable a paid backup feature as part of this procedure.

1. Confirm the target still has the expected schema and RLS policies from `lib/db/migrations/`. If the whole project or schema is missing, stop and restore/recreate the project configuration and migrations through the normal owner-approved process before importing rows.
2. Make a fresh encrypted export of the target tables first, if the target is still accessible. Keep it separately so the current state can be recovered if the import is wrong.
3. Decrypt the selected backup only on the trusted device. Verify the file names, date, headers, and counts before upload.
4. For `customer_orders` and `cafe_inquiries`, use **Table Editor → select the table → Import data from CSV**. Import only into an empty table or after carefully identifying only missing rows. CSV import does not make duplicate records safe; stop rather than overwrite or delete data to force an import.
5. For `store_settings`, the row is a singleton. If `id = 'amore'` already exists, edit that row's `content` and `updated_at` to the backed-up values; do not try to create a duplicate `amore` row. If it is missing, import the one-row CSV.
6. Check the `cafe_inquiries` identity sequence after importing explicit IDs, so future inquiries will receive unused IDs:

   ```sql
   select setval(
     pg_get_serial_sequence('public.cafe_inquiries', 'id'),
     coalesce(max(id), 1),
     max(id) is not null
   )
   from public.cafe_inquiries;
   ```

7. Verify restored row counts against the non-sensitive export checklist. Confirm expected order numbers/statuses and inquiry statuses in the protected admin area without copying customer details into notes or screenshots. Confirm that account-linked rows are reflected in `public.orders`; do not import that derived table directly.
8. Have the owner confirm that storefront/admin reads work and settings are correct. Keep the encrypted source export until verification is complete, then remove any temporary plaintext files.

If restoration would require replacing the entire project, restoring Auth users, or importing into non-empty production tables with conflicts, stop and plan that recovery separately. Do not run destructive resets, bulk deletes, or migration changes against production as a shortcut.

## Repository safety

Recovery exports and database dump files are excluded by `.gitignore` and `.replitignore`. Save actual customer exports outside the repository anyway. Never create test exports from live customer records; verify this procedure with fictional data in an isolated environment only.
