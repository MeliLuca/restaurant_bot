-- Newer Supabase CLI stacks stopped granting data access on the public schema
-- to the API roles by default. v1 runs without RLS on the anon key (see the
-- deferred-RLS note in the initial schema), so grant table access explicitly.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated;

-- Future tables created by migrations get the same access automatically.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

-- Re-apply the app_users column-level protection: pin_hash stays unreadable.
revoke select on app_users from anon, authenticated;
grant select (id, name, role_id, is_active, created_at) on app_users
  to anon, authenticated;
