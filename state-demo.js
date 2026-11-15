// Who voted, by demographic group, from states that publish it. Writes state-demo-data.js: window.STATE_DEMO = { "North Carolina": {...} }.
// Run: node state-demo.js. North Carolina's State Board posts, per county and precinct, registered voters (voter_stats) and voters who cast
// a ballot (history_stats), each counted by age, race, ethnicity, sex and party. Turnout by group = voted ÷ registered.
// Add a state by writing another loader that returns the same shape.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const CACHE = path.join(__dirname, '.cache');

async function zipText(url, file) { // download once a run into .cache/, then read the single text file inside the zip
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const buf = fs.readFileSync(file), at = buf.readUInt32LE(18) === 0 ? null : 0; // local file header: compressed size may be 0 when a data descriptor is used
  const nameLen = buf.readUInt16LE(26), extra = buf.readUInt16LE(28), start = 30 + nameLen + extra;
  const cdir = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); // central directory has the real compressed size
  const size = buf.readUInt32LE(cdir + 20);
  return zlib.inflateRawSync(buf.subarray(start, start + size)).toString('latin1');
}

const RACE = { W: 'White', B: 'Black', A: 'Asian', I: 'American Indian', M: 'Two or more', O: 'Other', P: 'Pacific Islander', U: 'Not stated' };
const ETH = { HL: 'Hispanic', NL: 'Not Hispanic', UN: 'Not stated' };
const PARTY = { DEM: 'Democratic', REP: 'Republican', UNA: 'Unaffiliated', LIB: 'Libertarian', GRE: 'Green', NLB: 'No Labels', CST: 'Constitution', JFA: 'Justice For All' };
const SEX = { F: 'Female', M: 'Male', U: 'Not stated' };
const METHOD = { EV: 'Early in person', EC: 'Early in person', V: 'Election Day', C: 'Election Day', T: 'Election Day', M: 'Absentee by mail', P: 'Provisional' }; // EC/C = curbside, T = transfer

async function northCarolina() {
  const base = 'https://s3.amazonaws.com/dl.ncsbe.gov/ENRS/2026_11_03/', dir = path.join(CACHE, 'nc');
  const [hist, reg, res] = await Promise.all(['history_stats_20261103', 'voter_stats_20261103', 'results_pct_20261103'].map(f => zipText(base + f + '.zip', path.join(dir, f + '.zip'))));
  const rows = (text, need) => { const [head, ...lines] = text.split(/\r?\n/), h = head.split('\t'), at = Object.fromEntries(need.map(k => [k, h.indexOf(k)]));
    for (const k of need) if (at[k] < 0) throw new Error(`NC layout changed: no column ${k}`);
    return lines.filter(Boolean).map(l => { const c = l.split('\t'); return Object.fromEntries(need.map(k => [k, c[at[k]].trim()])); }); };
  const keys = ['county_desc', 'age', 'party_cd', 'race_code', 'ethnic_code', 'sex_code', 'total_voters'];
  const groups = r => ({ age: r.age.replace(/^Age /, ''), race: RACE[r.race_code] ?? r.race_code, ethnicity: ETH[r.ethnic_code] ?? r.ethnic_code, party: PARTY[r.party_cd] ?? r.party_cd, sex: SEX[r.sex_code] ?? r.sex_code });
  const blank = () => ({ reg: 0, voted: 0, by: {}, method: {} });
  const counties = {};
  const add = (t, kind, r, n) => { t[kind] += n; for (const [dim, val] of Object.entries(groups(r))) { const d = (t.by[dim] ??= {}), g = (d[val] ??= { reg: 0, voted: 0 }); g[kind] += n; } };
  for (const r of rows(reg, keys)) add(counties[r.county_desc] ??= blank(), 'reg', r, +r.total_voters);
  for (const r of rows(hist, [...keys, 'voting_method'])) { const n = +r.total_voters, c = (counties[r.county_desc] ??= blank()); add(c, 'voted', r, n);
    const m = METHOD[r.voting_method] ?? r.voting_method; c.method[m] = (c.method[m] ?? 0) + n; }
  // Counties load voter history at their own pace; one counts only once its history covers 95% of its counted US Senate votes.
  for (const r of rows(res, ['County', 'Contest Name', 'Total Votes'])) if (r['Contest Name'] === 'US SENATE' && counties[r.County]) counties[r.County].counted = (counties[r.County].counted ?? 0) + +r['Total Votes'];
  const state = blank(), done = Object.entries(counties).filter(([, c]) => c.counted && c.voted >= 0.95 * c.counted);
  if (!done.length) throw new Error('NC: no county has posted voter history yet');
  for (const [, c] of done) { state.reg += c.reg; state.voted += c.voted;
    for (const [dim, d] of Object.entries(c.by)) for (const [val, g] of Object.entries(d)) { const t = ((state.by[dim] ??= {})[val] ??= { reg: 0, voted: 0 }); t.reg += g.reg; t.voted += g.voted; }
    for (const [m, n] of Object.entries(c.method)) state.method[m] = (state.method[m] ?? 0) + n; }
  for (const c of Object.values(counties)) c.complete = !!(c.counted && c.voted >= 0.95 * c.counted);
  return { source: 'North Carolina State Board of Elections (voter_stats, history_stats, results_pct)', url: 'https://dl.ncsbe.gov/?prefix=ENRS/2026_11_03/',
    note: `Counties post voter history at their own pace. Statewide figures use only the ${done.length} of ${Object.keys(counties).length} counties whose history covers at least 95% of their counted votes. Registered = active and inactive voters on Election Day.`,
    countiesIn: done.length, countiesAll: Object.keys(counties).length, state, counties };
}

async function main() {
  const out = { 'North Carolina': await northCarolina() };
  fs.writeFileSync(path.join(__dirname, 'state-demo-data.js'), `// Built by state-demo.js on ${new Date().toISOString()}\nwindow.STATE_DEMO = ${JSON.stringify(out)};\n`);
  for (const [st, d] of Object.entries(out)) console.log(`${st}: ${d.countiesIn} of ${d.countiesAll} counties complete; there ${d.state.voted.toLocaleString()} voted of ${d.state.reg.toLocaleString()} registered (${(d.state.voted / d.state.reg * 100).toFixed(1)}%)`);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
