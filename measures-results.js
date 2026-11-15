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
  const rows = parse(await res.text()), out = match(rows), wiki = Object.keys(out).length;
  Object.assign(out, { ...nbc(), ...out }); // Wikipedia wins where both have it
  Object.assign(out, await pages(window.MEASURES.filter(m => !out[`${m.state}|${m.name}`])).catch(e => (console.warn('measure pages:', e.message), {})));
  const extra = Object.keys(out).length - wiki;
  fs.writeFileSync(path.join(__dirname, 'measures-results-data.js'), 'window.MEASURES_RESULTS = ' + JSON.stringify(out) + ';\n');
  console.log(`${rows.length} November rows on Wikipedia, ${rows.filter(r => r.status).length} decided; NBC + measure pages add ${extra}; ${Object.keys(out).length} of ${window.MEASURES.length} measures have a result`);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
// NBC (results-data.js, written by results.js just before this) calls about a quarter of measures, named like "144 - Require voter ID".
// Match on the measure number when both have one, else on shared words with our name + summary.
function nbc() {
  let R; try { global.window.RESULTS = null; delete require.cache[require.resolve('./results-data.js')]; require('./results-data.js'); R = global.window.RESULTS; } catch { return {}; }
  const out = {}, ALIAS = { 'Colorado|135': 'Initiative 110' }; // Colorado's ballot number differs from its filing number
  for (const r of (R?.races ?? []).filter(r => /^I/.test(r.office) && r.called)) {
    const [, label, text] = r.name.match(/^(.+?)\s+-\s+(.*)$/) ?? [null, '', r.name], n = label.split(' ').pop(), mine = window.MEASURES.filter(m => m.state === r.state); // "SB 921 - ..." → 921
    let m = mine.find(m => m.name === ALIAS[`${r.state}|${n}`]) ?? (n && mine.find(m => m.name.split(/[^A-Za-z0-9]+/).includes(n))); // "Proposition 144", "Constitutional Amendment J"
    if (!m) { const want = norm(text); m = mine.map(m => [m, want.filter(w => norm(m.name + ' ' + m.summary).includes(w)).length / want.length]).filter(([, sc]) => sc >= 0.5).sort((a, b) => b[1] - a[1])[0]?.[0]; }
    const yes = r.cands.find(c => /^(yes|for)$/i.test(c.name));
    if (m && yes) out[`${m.state}|${m.name}`] = { result: /^(yes|for)$/i.test(r.winner) ? 'Passed' : 'Failed', yes: yes.pct, src: 'NBC' };
  }
  return out;
}
// A measure's own Wikipedia page often has counts before the big table does: {{Referendum results|for=N|against=N|majorityneeded=55%}} or infobox yes=/no=.
async function pages(missing) {
  const out = {}, list = missing.filter(m => m.source.includes('/wiki/') && !m.source.includes('#'));
  const int = s => s == null ? null : +s.replace(/[^\d]/g, '') || null;
  for (let i = 0; i < list.length; i += 20) {
    const batch = list.slice(i, i + 20), title = m => decodeURIComponent(m.source.split('/wiki/')[1]).replace(/_/g, ' ');
    const q = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', format: 'json', formatversion: 2, redirects: 1, titles: batch.map(title).join('|') });
    const j = await (await fetch('https://en.wikipedia.org/w/api.php?' + q, { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } })).json();
    const redir = Object.fromEntries((j.query.redirects ?? []).map(r => [r.from, r.to]));
    for (const m of batch) {
      const t = j.query.pages.find(p => p.title === (redir[title(m)] ?? title(m)))?.revisions?.[0]?.slots.main.content ?? '';
      const rr = t.match(/\{\{Referendum results\|([^}]*)\}\}/i)?.[1] ?? '', f = k => (rr.match(new RegExp(`\\b${k}\\s*=\\s*([\\d,]+)`)) ?? t.match(new RegExp(`\\|\\s*${k === 'for' ? 'yes' : 'no'}\\s*=\\s*([\\d,]+)`)))?.[1];
      const yes = int(f('for')), no = int(f('against')), need = +(rr.match(/majorityneeded\s*=\s*([\d.]+)/)?.[1] ?? t.match(/requires? an? (\d+)% (?:super)?majority/i)?.[1] ?? 50);
      if (!yes || !no) continue;
      const pct = Math.round(yes / (yes + no) * 1000) / 10;
      if (Math.abs(pct - need) >= 1) out[`${m.state}|${m.name}`] = { result: pct > need ? 'Passed' : 'Failed', yes: pct, src: 'Wikipedia page' }; // shortcut: unofficial counts; within 1 pt of the threshold stays undecided
    }
  }
  return out;
}
module.exports = { parse, match, nbc, pages };
