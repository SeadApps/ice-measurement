/* Run every suite, one at a time, each against a fresh fake server, and say honestly what happened.

     node dev/runall.js            all suites
     node dev/runall.js shelltest maptest      just these

   A suite counts as GREEN only if it exits 0, prints no FAIL, AND reaches the number of checks
   recorded in dev/expected.json. The last condition is the one that matters: a suite that throws
   partway (a selector that no longer exists, a timeout) prints "0 FAIL" for the checks it got
   through and never reaches the rest, so counting FAIL lines alone calls a crash green. That is
   exactly how a suite once dropped from 35 checks to 11 unnoticed.

   A suite that is not green is run once more. If the second run is green it is reported as FLAKY,
   not as passed: it is a timing problem to understand, and it must not be quietly absorbed.
   Exit code is 0 only when every suite is green on its FIRST run or reported as flaky is zero;
   pass --allow-flaky to accept flakes (they are still listed). To record new counts after adding
   or changing a suite, run it and edit dev/expected.json by hand: the number is a claim. */
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');

const DIR = __dirname, EXPECTED = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));
const args = process.argv.slice(2), allowFlaky = args.includes('--allow-flaky');
const want = args.filter(a => !a.startsWith('--'));
const suites = want.length ? want : Object.keys(EXPECTED);
const unknown = suites.filter(s => !(s in EXPECTED));
if (unknown.length) { console.error('no expected count for: ' + unknown.join(', ') + ' (add it to dev/expected.json)'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
function run(cmd, a, ms) {
  return new Promise(res => {
    const p = spawn(process.execPath, [cmd].concat(a || []), { cwd: path.join(DIR, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    const t = setTimeout(() => { out += '\n[runall] killed after ' + ms + 'ms'; p.kill(); }, ms);
    p.on('close', code => { clearTimeout(t); res({ code, out }); });
  });
}
async function once(name) {
  const server = spawn(process.execPath, [path.join(DIR, 'fake-supabase.js')], { cwd: path.join(DIR, '..'), stdio: 'ignore' });
  await sleep(1500);
  const r = await run(path.join(DIR, name + '.js'), [], 15 * 60 * 1000);
  server.kill(); await sleep(700);
  const pass = (r.out.match(/^\s+PASS\s/gm) || []).length, fail = (r.out.match(/^\s+FAIL\s/gm) || []).length;
  const crash = r.code !== 0 && fail === 0;
  const green = r.code === 0 && fail === 0 && pass >= EXPECTED[name];
  return { pass, fail, code: r.code, crash, green, out: r.out };
}

(async () => {
  const rows = []; let bad = 0, flaky = 0; const t0 = Date.now();
  for (const name of suites) {
    let r = await once(name), note = '';
    if (!r.green) {
      const first = r; r = await once(name);
      if (r.green) { note = 'FLAKY (first run: ' + first.pass + ' pass, ' + first.fail + ' fail, exit ' + first.code + ')'; flaky++; }
      else { note = 'FAILED'; bad++; r.firstOut = first.out; }
    }
    rows.push({ name, r, note });
    const line = name.padEnd(20) + String(r.pass).padStart(4) + ' / ' + String(EXPECTED[name]).padEnd(4) + (note ? '  ' + note : '  ok');
    console.log(line);
    if (note === 'FAILED') {
      const lines = r.out.split('\n').filter(l => /FAIL|Error|waiting for|runall/.test(l)).slice(0, 6);
      lines.forEach(l => console.log('      ' + l.trim().slice(0, 180)));
    }
  }
  const total = rows.reduce((a, x) => a + x.r.pass, 0);
  console.log('\n' + rows.length + ' suites, ' + total + ' checks, ' + bad + ' failed, ' + flaky + ' flaky, ' + Math.round((Date.now() - t0) / 60000) + ' min');
  process.exit(bad || (flaky && !allowFlaky) ? 1 : 0);
})();
