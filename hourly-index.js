// Builds hourly/index.js: a compact hour-by-hour summary of every hourly/*.json capture, small enough for the page to load.
// Run by hourly.js after each capture; also runnable alone: node hourly-index.js
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'hourly');
const NOT_UP = { governor: { D: 6, R: 8 }, senate: { D: 34, R: 31 }, house: { D: 0, R: 0 } }; // same as the page
const likely = r => !r.score ? r.incParty : r.score > 0 ? 'D' : 'R';
const r3 = x => x == null ? null : Math.round(x * 1000) / 1000;

function summarize(cap) {
  const d = cap.data ?? {}, res = cap.results?.races ?? [];
  const seats = o => { if (!d[o]) return null; const c = { ...NOT_UP[o] }; for (const r of d[o].races) if (likely(r) in c) c[likely(r)]++; return c; };
  const called = code => { const rs = res.filter(r => r.office === code); if (!rs.length) return null;
    const c = { D: 0, R: 0, O: 0, n: rs.length, called: 0 };
    for (const r of rs) if (r.called) { c.called++; const p = /^dem/i.test(r.winnerParty) ? 'D' : /^rep/i.test(r.winnerParty) ? 'R' : 'O'; c[p]++; }
    return c; };
  const race = {};
  for (const [o, k] of [['senate', 'S'], ['governor', 'G'], ['president', 'P']]) for (const r of d[o]?.races ?? []) if (r.market?.pD != null) race[`${k}:${r.label}`] = r3(r.market.pD);
  const call = {}; // "S:Georgia": "D" called / "d" leading (for the Timeline map scrubber)
  for (const r of res) { const k = `${r.office}:${r.state}`;
    if ((r.office === 'S' || r.office === 'G') && !call[k] && (r.called || r.votes)) { const p = r.called ? r.winnerParty : r.cands[0]?.party, s = /^dem/i.test(p) ? 'D' : /^rep/i.test(p) ? 'R' : 'O'; call[k] = r.called ? s : s.toLowerCase(); } }
  return {
    t: cap.captured, call,
    mkt: { S: r3(d.control?.Senate?.['Democratic Party']), H: r3(d.control?.House?.['Democratic Party']), P: r3(d.president?.party?.Democratic) },
    seats: { S: seats('senate'), H: seats('house'), G: seats('governor') },
    early: d.early ? d.early.states.reduce((a, s) => a + s.cast, 0) : null,
    res: { S: called('S'), H: called('H'), G: called('G') },
    race,
  };
}

function build() {
  const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d\d-\d\dT\d\d(-\d\d)?\.json$/.test(f)).sort();
  const rows = files.map(f => { try { return summarize(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { return null; } }).filter(Boolean).sort((a, b) => a.t.localeCompare(b.t));
  fs.writeFileSync(path.join(dir, 'index.js'), '// Hour-by-hour summary of hourly/*.json, built by hourly-index.js.\nwindow.HOURLY = [\n' + rows.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n];\n');
  return rows;
}

if (require.main === module) { const rows = build(); console.log(`${rows.length} hours summarized`, JSON.stringify(rows.at(-1)).slice(0, 300)); }
module.exports = { build };
