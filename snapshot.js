// Saves today's data into history.js. Run daily: node snapshot.js
const fs = require('fs'), path = require('path');
const { loadData } = require('./data.js');

const FILE = path.join(__dirname, 'history.js'), PREFIX = 'window.HISTORY = ';
const realFetch = fetch;
globalThis.fetch = (u, o = {}) => realFetch(u, { ...o, headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)', ...o.headers } }); // Wikipedia rejects the default UA

async function main() {
  const D = await loadData();
  for (const o of ['governor', 'senate'])
    if (!D[o].races.length) throw new Error(`no ${o} races parsed`); // a bad parse must not replace a good snapshot
  // ponytail: one file so a plain <script> can load it from file://; split by day if it ever gets slow (each day adds ~70KB)
  const history = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8').slice(PREFIX.length)) : {};
  const day = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD; rerunning the same day replaces that day
  history[day] = D;
  fs.writeFileSync(FILE + '.tmp', PREFIX + JSON.stringify(history));
  fs.renameSync(FILE + '.tmp', FILE);
  const mk = r => r.filter(x => x.market).length;
  console.log(`${day}: ${D.governor.races.length} gov (${mk(D.governor.races)} markets), ${D.senate.races.length} senate (${mk(D.senate.races)} markets), early ${D.early ? D.early.asOf : 'MISSING'}, ${Object.keys(history).length} days stored`);
}

main().catch(e => { // the scheduled run has no console, so leave a trace
  fs.appendFileSync(path.join(__dirname, 'snapshot.log'), `${new Date().toISOString()} ${e.stack}\n`);
  console.error(e); process.exitCode = 1;
});
