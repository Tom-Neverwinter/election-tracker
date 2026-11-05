// Nov 3 2026 state legislative chamber results from the "Result" column of Wikipedia's "2026 United States state legislative elections" ratings table.
// Run: node legislature-results.js (hourly.js runs it). Writes legislature-results-data.js: window.LEG_RESULTS = {states: {State: {up, lo}}, pending}.
const fs = require('fs'), path = require('path');
const PARTY = { D: 'Democratic', R: 'Republican' };

function parse(wiki) {
  const tb = wiki.slice(wiki.indexOf('!Result'), wiki.indexOf('== National results'));
  const states = {}; let st, n = 0, pending = 0;
  for (const row of tb.split(/\n\|-[^\n]*\n/)) {
    st = row.match(/\[\[#([^|\]]+)\|/)?.[1] ?? st;
    const ch = row.match(/\[\[[^|\]]+\|(Senate|House|Assembly|House of Delegates)\]\]/)?.[1]; // Nebraska's nonpartisan "Legislature" is skipped
    if (!ch) continue; n++;
    const p = PARTY[row.split('\n').filter(l => /^\|/.test(l)).at(-1).match(/\|\s*([DR]) \d+–\d+[^|]*$/)?.[1]]; // "R 74–31"; coalitions and blanks = no result
    if (p) (states[st] ??= {})[ch === 'Senate' ? 'up' : 'lo'] = p; else pending++;
  }
  return { states, pending, n };
}

async function main() {
  const res = await fetch('https://en.wikipedia.org/w/index.php?title=2026_United_States_state_legislative_elections&action=raw', { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } });
  if (!res.ok) throw new Error(`${res.status} from Wikipedia`);
  const { states, pending, n } = parse(await res.text());
  if (n < 80) throw new Error(`only ${n} chambers parsed; table format changed?`);
  fs.writeFileSync(path.join(__dirname, 'legislature-results-data.js'), 'window.LEG_RESULTS = ' + JSON.stringify({ states, pending }) + ';\n');
  console.log(`${n - pending} of ${n} chambers with a result`);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
