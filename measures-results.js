// Nov 3 2026 ballot-measure results from Wikipedia's "2026 United States ballot measures" tables, matched to measures.js.
// Run: node measures-results.js (hourly.js runs it). Writes measures-results-data.js: window.MEASURES_RESULTS = {"State|Name": {result, yes}}.
// NBC only reports about a quarter of measures; Wikipedia fills in the rest as editors add results.
const fs = require('fs'), path = require('path');
global.window = {}; require('./measures.js');
const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);

function parse(wiki) { // [{state, title, text, status, yes}] for November rows
  const rows = [];
  for (const sec of wiki.split(/\n===([^=\n]+)===\n/).reduce((a, x, i, arr) => (i % 2 ? a.push([x.trim(), arr[i + 1]]) : 0, a), [])) {
    const [state, body] = sec;
    for (const row of body.split(/\n\|-[^\n]*\n/)) {
      const cells = row.split('\n').filter(l => /^\|(?!\}|-)/.test(l)).map(l => l.replace(/^\|\s*(?:[^|[\]]*?style="[^"]*"\s*\|)?/, '').trim());
      if (cells.length < 5 || !/Nov/.test(cells[4])) continue;
      const link = cells[2].match(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/);
      const pcts = [...row.matchAll(/([\d.]+)%/g)].map(m => +m[1]);
      rows.push({ state, title: link?.[1], text: (link?.[2] ?? link?.[1] ?? cells[2]).replace(/'''/g, ''), status: /Approved/i.test(cells[1]) ? 'Passed' : /Failed|Rejected/i.test(cells[1]) ? 'Failed' : null, yes: pcts.length >= 2 ? pcts.at(-2) : null });
    }
  }
  return rows;
}

function match(rows) {
  const out = {};
  for (const m of window.MEASURES) {
    const mine = rows.filter(r => r.state === m.state), title = !m.source.includes('#') ? decodeURIComponent(m.source.split('/wiki/')[1] ?? '').replace(/_/g, ' ') : null;
    let r = title && mine.find(r => r.title === title);
    if (!r) { const want = norm(m.name); r = mine.map(r => [r, want.filter(w => norm(r.text).includes(w)).length / want.length]).filter(([, s]) => s >= 0.6).sort((a, b) => b[1] - a[1])[0]?.[0]; }
    if (r?.status) out[`${m.state}|${m.name}`] = { result: r.status, yes: r.yes };
  }
  return out;
}

async function main() {
  const res = await fetch('https://en.wikipedia.org/w/index.php?title=2026_United_States_ballot_measures&action=raw', { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } });
  if (!res.ok) throw new Error(`${res.status} from Wikipedia`);
  const rows = parse(await res.text()), out = match(rows);
  fs.writeFileSync(path.join(__dirname, 'measures-results-data.js'), 'window.MEASURES_RESULTS = ' + JSON.stringify(out) + ';\n');
  console.log(`${rows.length} November rows on Wikipedia, ${rows.filter(r => r.status).length} decided; ${Object.keys(out).length} of ${window.MEASURES.length} measures matched with a result`);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { parse, match };
