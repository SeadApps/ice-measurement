-- ============================================================================
-- D1: UNTIGHTEN. The way back, in one statement.
--
-- Puts the shared account back to reading and writing everything, as it did
-- before step 5. The row rules installed in step 1 are written to behave
-- exactly like the old ones while `tight` is false, so this is the whole of it.
--
-- What it does not undo: the stamps and the activity log keep being written
-- (they are additive and harm nothing), and devices that already moved to the
-- new sign-in keep it. The shared account works for data again, so a device
-- that fell back to the old gate gets in with the access code alone.
-- ============================================================================

update app.settings set value = 'false' where key = 'tight';
select key, value from app.settings where key = 'tight';
