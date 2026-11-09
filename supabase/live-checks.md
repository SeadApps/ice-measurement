# Checks to run on the real server before a second rink is added

Nothing here changes Conway's data. Do them in order; tick them off.

## 1. Glass records carry a rink tag (read only)

In the Supabase SQL editor:

```sql
select kind, count(*) as live, count(*) filter (where facility_id is null) as untagged
from public.records
where kind like 'glass%' and not deleted
group by kind order by kind;
```

Every `untagged` should be 0. An untagged Glass record is invisible to Staff and to a rink's Manager,
and the app tags each Glass record it writes from the sheet it belongs to (a panel on a device that does not yet know its sheet is the one way to leave one bare). If a number is above 0, list them:

```sql
select kind, id from public.records where kind like 'glass%' and not deleted and facility_id is null order by kind, id;
```

and send me the list. Do not tag them by hand.

## 2. Reset code (Staff page)

Use a spare test person, never a real one.

1. Add the test person (Staff, one facility). Note the code shown once.
2. Sign in as them in a private window. It works.
3. On your device press **Reset code** for them. A new code is shown once.
4. In a second private window the OLD code is refused and the NEW one works.
5. The first window (still signed in on the old code): note whether it keeps working. Tell me what it does;
   the server may leave an existing session alone until its token refreshes.
6. Remove the test person. Restore them, then Reset code again (the old code must stop working).

## 3. Change Editing Code (Staff page, shared codes)

1. Change it to a new code. The "last changed" time updates.
2. A signed-in device with its editing window open: the next save is refused ("editing is locked") and it asks for the code again.
3. The OLD code is refused (wrong code), the NEW one opens a window.
4. Keep the new code somewhere safe. It is shown once.

## 4. Change Access Code (Staff page, shared codes)

Already proved on the live project on 5 Sep (devices were put back at the gate within the hour). The only
new thing to check is the **button** on the Staff page, and rotating it signs every device out, so only do this
when you are ready to type the new code into each of them.

1. Change it. The "last changed" time updates.
2. A device already signed in is asked for the code again within about an hour and keeps its local records.
3. The old code is refused at the gate, the new one works.
