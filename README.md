# Arena Management System

Ice thickness measurement and rink glass management for a multi-facility arena operation. A static site on
GitHub Pages: no build step, no framework, nothing to install to use it. Open `index.html` (the shell), sign in,
pick a facility and a sheet, then Ice Manager or Glass Manager.

**How it works** is in [`ARCHITECTURE.md`](ARCHITECTURE.md): the files, the record store and why it is shaped the
way it is, sync, sign-in and access, the maps, the tests, the open items and how to release.

**Running it locally.** The tests serve the site and a stand-in for the server from one command:

```
cd dev && npm install && npx playwright install chromium     # once; development only
node dev/fake-supabase.js &                                  # the site and a fake Supabase on localhost:8200
```

**Running the tests.** `node dev/runall.js` runs every suite, one at a time against a fresh fake server, and
reports a suite green only if it exits 0, prints no FAIL and reaches its count in `dev/expected.json`
(about half an hour). `node dev/runall.js NAME NAME` runs just those.

**The specifications** for the redesign (the phases D1 to D6, the mock-ups and the flow chart) are not in this
repository; `ARCHITECTURE.md` records what was built from them.

**The server side** (SQL, the `manage-staff` function and a README with the checklist) is in `supabase/`.
