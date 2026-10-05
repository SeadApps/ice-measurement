# Supabase scripts for D1

These put the server side of D1 in place: a person-by-person sign-in, an editing
window, a "changed by" stamp, facility access per person and the activity log.
They are written against what `dev/fake-supabase.js` does, which is what the
client suites test. **They have not been run against a real database** - nothing
here could reach one. Read the checklist at the bottom before step 5.

The order matters, and everything up to step 5 can be abandoned without anyone
noticing.

| Step | File | What it does | Reversible |
|---|---|---|---|
| 1 | `d1-01-add.sql` | Tables, columns, functions, triggers, new row rules. Behaves exactly like today until step 5. Saves the old policies first. | yes |
| 1b | `functions/manage-staff` | The Edge Function. See below. | yes |
| 2a | `d1-02a-backfill-preview.sql` | Read-only: what each record would be tagged, what disagrees, what cannot be placed. | n/a |
| 2b | `d1-02b-backfill-apply.sql` | Tags records and gives sheets a shape, without moving any timestamp. | tags only |
| 3 | (the client) | Ship the new `sync.js` / `records.js` / `ice.html` / `glass.html`. | yes |
| 4a | `d1-03-first-manager.sql` | Makes the first Manager. | yes |
| 4b | (the Staff page, or the function directly) | Add everyone else, set their facilities, hand out codes. | yes |
| 5 | `d1-04-tighten.sql` | One switch. The shared account can then only list names. | `d1-04-untighten.sql` |
| - | `d1-05-restore-old-policies.sql` | Only if you want D1's policies gone entirely. | - |

## The editing code

Set it once, by hand, in the SQL editor, after step 1:

```sql
select public.admin_set_editing_code('...');
```

Never commit it, and never reuse the real one as a test value. Management can
change it afterwards from the Staff page (`set_editing_code`).

## The Edge Function

```
supabase functions deploy manage-staff
```

It reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the platform's own
environment. The service role key must not appear in the page, the repository
or any file here. Anyone who can sign in can reach the function's address, so
the function itself refuses everyone but an active Manager.

## What the client depends on

The client (and its tests) rely on these exact behaviours. If a real-database
check below fails, the client will misbehave in the way described.

* **`editing is locked`** in the error message of a refused write. The client
  tells "unlock editing" from every other refusal by this wording. A different
  message shows the person "refused by the server" instead.
* **A wrong editing code answers 403** and a right one 200 with `{until}`. A
  wrong code uses `set_config('response.status', '403', true)` rather than
  raising, so that the failed try is recorded; raising would roll it back.
* **`my_facilities()`** returns `{role, facilities}`. The client keys its pull
  cursor on it. Without it a person given a facility later never receives older
  records.
* **`staff_names()`** callable by the shared account; `id` is the person's
  `login`, and `<login>@staff.conwayarena.local` is their sign-in email.

## Checklist: verify on the real project before step 5

Do these on the live project with a spare test person, in this order. Each one
is something the fake server could only imitate.

- [ ] Step 1 runs without error, and the app works exactly as before (open
      Ice and Glass on a phone, make an edit, see it arrive on a second device).
- [ ] `select * from app.old_policies;` shows the policies that were there.
- [ ] A write made by a signed-in person has `changed_by` and `changed_by_name`
      set, and one made by the shared account has them null.
- [ ] A write that tries to send its own `changed_by` (in the JSON) is overruled.
- [ ] `public.activity` gains one row per write, with old and new values, and
      `update`/`delete`/`truncate` on it all fail, even as the owner.
- [ ] After `tight = true`: the shared account reads nothing and writes nothing
      but can call `staff_names()`.
- [ ] After `tight = true`, a person with no open window gets **HTTP 403 and a
      message containing "editing is locked"** on a write.
- [ ] A wrong editing code gives HTTP 403, five wrong tries in ten minutes block
      further tries, and the right code works again afterwards.
- [ ] A Staff person given one facility reads and writes only that one, cannot
      rewrite another facility's record by re-tagging it, and cannot write a
      `facility` or `sheet` record.
- [ ] A Staff person cannot set a flag to resolved, and cannot change a flag
      that is already resolved (reopen it or edit it); Management can do both.
      A `glass_widths` record in their own facility is theirs to write.
- [ ] `manage-staff` `codes` returns `{access, editing}`. After `set_editing_code`
      and `set_access_code` each has a fresh time; before either has been
      changed since step 1 it is null (a code set by hand has no row).
- [ ] **Removing a person signs their device out.** After `remove`, their next
      token refresh must come back as HTTP 400 or 401, which is what the client
      treats as "signed out". If the hosted auth answers 403 for a banned user
      the client will keep the session and show "can't reach the server" instead.
      If that happens, tell me: the fix is a small client change.
- [ ] The keepalive workflow still passes. After step 5 the anonymous read it
      makes is refused; it accepts 200 or 401, so check it does not come back 403.
- [ ] Rotating the access code (`set_access_code`) puts the gate back on a device
      within the hour, and does not erase its local records.
- [ ] Time the whole thing on the free tier: the token endpoint allows 150
      requests per 5 minutes per IP, shared by every device on the building's
      wifi, and each sign-in now takes two.

## Rolling back

* Before step 5: nothing to undo. Abandon it.
* After step 5: `d1-04-untighten.sql`. One statement.
* To remove D1's row rules entirely: `d1-05-restore-old-policies.sql`.
