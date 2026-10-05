-- ============================================================================
-- D1, step 4a: THE FIRST MANAGER. Run once, by hand.
--
-- Everything after this - adding people, resetting codes, setting facilities -
-- is done by a Manager through the manage-staff function. But the first Manager
-- has to come from somewhere, and that somewhere is you.
--
-- 1. In the Supabase dashboard: Authentication > Users > Add user.
--      Email:    <login>@staff.conwayarena.local      (e.g. pete@staff.conwayarena.local)
--      Password: their personal code - at least 8 characters, from a password
--                manager, not a word
--      Tick "Auto Confirm User".
-- 2. Edit the two values below to match, and run this.
--
-- Do not commit a filled-in copy of this file.
-- ============================================================================

do $$
declare
  v_login text := 'pete';                 -- the part of the email before the @
  v_name  text := 'Pete';                 -- what the picker and the stamps show
  v_user  uuid;
begin
  select id into v_user from auth.users where email = v_login || '@staff.conwayarena.local';
  if v_user is null then
    raise exception 'No auth user % - create it in the dashboard first', v_login || '@staff.conwayarena.local';
  end if;
  insert into app.staff (user_id, login, name, role) values (v_user, v_login, v_name, 'management')
    on conflict (user_id) do update set name = excluded.name, role = 'management', active = true;
  raise notice '% is now a Manager', v_name;
end $$;

select login, name, role, active from app.staff order by name;
