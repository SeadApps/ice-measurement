-- ============================================================================
-- D7, fix: changing the editing code failed on the real project with
--   "DELETE requires a WHERE clause"
-- Supabase refuses a DELETE that has none, and admin_set_editing_code ended its work with one. The change was rolled back
-- whole, so nothing was half done. Run this once in the SQL editor. It only replaces that one function, and d1-01-add.sql
-- has the same fix, so re-running d1-01 will not bring the bug back.
-- ============================================================================
create or replace function public.admin_set_editing_code(p_code text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if length(coalesce(p_code, '')) < 8 then
    raise exception 'an editing code needs at least 8 characters';
  end if;
  insert into app.codes (name, hash) values ('editing', extensions.crypt(p_code, extensions.gen_salt('bf')))
    on conflict (name) do update set hash = excluded.hash, changed_at = now();
  delete from app.unlocks where true;               -- the old code's windows end with it
end $$;

revoke all on function public.admin_set_editing_code(text) from public, anon, authenticated;
grant execute on function public.admin_set_editing_code(text) to service_role;
