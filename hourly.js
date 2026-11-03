// Hourly capture around Election Day: node hourly.js (run by the "ElectionTrackerHourly" scheduled task).
// Runs snapshot.js (forecasts, markets, early vote) and results.js (live results), saves both to hourly/<local YYYY-MM-DDTHH>.json,
// then commits and pushes so the site updates too. Each step's failure is logged and the rest still runs.
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const dir = __dirname, log = m => fs.appendFileSync(path.join(dir, 'hourly.log'), `${new Date().toISOString()} ${m}\n`);
const run = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60e3 }).trim(); } catch (e) { log(`${cmd} ${args.join(' ')} failed: ${(e.stderr || e.message).slice(0, 500)}`); return null; } };
const load = (file, prefix) => { try { return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').trim().replace(/;$/, '').slice(prefix.length)); } catch { return null; } };

const now = new Date(), pad = n => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}`;
log(`start ${stamp}`);
log('snapshot: ' + run(process.execPath, ['snapshot.js']));
log('results: ' + run(process.execPath, ['results.js']));

const history = load('history.js', 'window.HISTORY = ');
const day = now.toLocaleDateString('en-CA');
fs.mkdirSync(path.join(dir, 'hourly'), { recursive: true });
fs.writeFileSync(path.join(dir, 'hourly', stamp + '.json'), JSON.stringify({ captured: now.toISOString(), data: history?.[day] ?? null, results: load('results-data.js', 'window.RESULTS = ') }));

run('git', ['add', 'history.js', 'results-data.js', 'hourly']);
if (require('child_process').spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: dir }).status === 1) { // 1 = something staged
  run('git', ['commit', '-q', '-m', `hourly ${stamp}`]);
  run('git', ['pull', '-q', '--rebase']);
  log('push: ' + (run('git', ['push', '-q']) ?? 'FAILED'));
}
log(`done ${stamp}`);
