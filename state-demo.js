// Who voted, by demographic group, from states that publish it. Writes state-demo-data.js: window.STATE_DEMO = { "North Carolina": {...} }.
// Run: node state-demo.js. North Carolina's State Board posts, per county and precinct, registered voters (voter_stats) and voters who cast
// a ballot (history_stats), each counted by age, race, ethnicity, sex and party. Turnout by group = voted ÷ registered.
// Add a state by writing another loader that returns the same shape.
const fs = require('fs'), path = require('path'), { unzip, sheets } = require('./xlsx.js');
const CACHE = path.join(__dirname, '.cache');

async function download(url, file) { // into .cache/, fresh each run
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}
const zipText = async (url, file) => Object.values(unzip(fs.readFileSync(await download(url, file))))[0].toString('latin1'); // NC: one text file per zip
const RACE = { W: 'White', B: 'Black', A: 'Asian', I: 'American Indian', M: 'Two or more', O: 'Other', P: 'Pacific Islander', U: 'Not stated' };
const ETH = { HL: 'Hispanic', NL: 'Not Hispanic', UN: 'Not stated' };
const PARTY = { DEM: 'Democratic', REP: 'Republican', UNA: 'Unaffiliated', LIB: 'Libertarian', GRE: 'Green', NLB: 'No Labels', CST: 'Constitution', JFA: 'Justice For All' };
const SEX = { F: 'Female', M: 'Male', U: 'Not stated' };
const METHOD = { EV: 'Early in person', EC: 'Early in person', V: 'Election Day', C: 'Election Day', T: 'Election Day', M: 'Absentee by mail', P: 'Provisional' }; // EC/C = curbside, T = transfer

async function northCarolina(folder = '2026_11_03') { // a past election's folder (e.g. '2022_11_08') loads that year, with every county's history complete
  const base = `https://s3.amazonaws.com/dl.ncsbe.gov/ENRS/${folder}/`, dir = path.join(CACHE, 'nc'), stamp = folder.replace(/_/g, ''), past = folder !== '2026_11_03';
  const [hist, reg, res] = await Promise.all(['history_stats_', 'voter_stats_', ...(past ? [] : ['results_pct_'])].map(f => zipText(base + f + stamp + '.zip', path.join(dir, f + stamp + '.zip'))));
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
  if (past) for (const c of Object.values(counties)) c.counted = c.voted; // past elections: history is final
  else for (const r of rows(res, ['County', 'Contest Name', 'Total Votes'])) if (r['Contest Name'] === 'US SENATE' && counties[r.County]) counties[r.County].counted = (counties[r.County].counted ?? 0) + +r['Total Votes'];
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

// Louisiana's Secretary of State posts post-election statistics: registered, voted and % voting by race (White/Black/Other) × party, per parish.
async function louisiana() {
  const base = 'https://electionstatistics.sos.la.gov/Data/Post_Election_Statistics/', dir = path.join(CACHE, 'la');
  const sta = sheets(await download(base + 'statewide/2026_1103_sta.xlsx', path.join(dir, 'sta.xlsx')));
  const par = sheets(await download(base + 'parish/2026_1103_par.xlsx', path.join(dir, 'par.xlsx')));
  const names = {}; // "PAR 01" → "ACADIA", read from the parish file (one sheet per parish: name row, then code row)
  for (const rows of Object.values(par)) for (let i = 0; i + 1 < rows.length; i++) { const code = String(rows[i + 1]?.[1] ?? '').trim();
    if (/^PAR \d+$/.test(code) && rows[i]?.[1] && !/^PAR /.test(rows[i][1])) { names[code] = String(rows[i][1]).trim(); break; } }
  const rows = sta.Sheet1, head = rows.find(r => r?.[3] === 'TOTAL');
  if (!head || head.slice(3, 19).join() !== 'TOTAL,WHITE,BLACK,OTHER,TOTAL,WHITE,BLACK,OTHER,TOTAL,WHITE,BLACK,OTHER,TOTAL,WHITE,BLACK,OTHER') throw new Error('LA layout changed');
  const unit = (reg, vot) => { const n = (r, i) => +r[i] || 0, g = i => ({ reg: n(reg, i), voted: n(vot, i) });
    return { reg: n(reg, 3), voted: n(vot, 3), method: {}, complete: true,
      by: { race: { White: g(4), Black: g(5), Other: g(6) }, party: { Democratic: g(7), Republican: g(11), 'Other parties': g(15) } } }; };
  let state, counties = {};
  for (let i = 0; i + 1 < rows.length; i++) { const id = String(rows[i]?.[1] ?? '').trim();
    if (!/^(STATE|PAR \d+)$/.test(id) || String(rows[i + 1]?.[1]).trim() !== '# VOTING') continue;
    const u = unit(rows[i], rows[i + 1]);
    if (id === 'STATE') state = u; else { if (!names[id]) throw new Error('LA: no parish name for ' + id); counties[names[id]] = u; } }
  const n = Object.keys(counties).length;
  if (!state || n !== 64) throw new Error(`LA: parsed ${n} parishes`);
  const sum = Object.values(counties).reduce((a, c) => a + c.voted, 0);
  if (sum !== state.voted) throw new Error(`LA: parishes add to ${sum}, state says ${state.voted}`);
  return { source: 'Louisiana Secretary of State post-election statistics', url: 'https://electionstatistics.sos.la.gov/default.aspx?Stats=Post_Election_Statistics&Type=Parish',
    note: 'Louisiana reports race as White, Black or Other and party as Democratic, Republican or other; it does not break turnout down by age or sex. Registered = active and inactive voters.',
    countiesIn: n, countiesAll: n, unitName: 'parish', state, counties };
}

// Washington's Secretary of State keeps one spreadsheet of registered voters and ballots by county × age × sex for every election.
// The 2026 general rows exist but stay zero until the state certifies (about Dec 4); until then this throws and the state shows as pending.
let waTable; // one download per run serves every year
async function washington(year = 2026) {
  const R = await (waTable ??= download('https://www.sos.wa.gov/sites/default/files/2022-05/VoterParticipation.xlsx', path.join(CACHE, 'wa', 'vp.xlsx')).then(f => sheets(f).Table));
  const h = R[0].map(x => String(x).trim()), at = k => { const i = h.indexOf(k); if (i < 0) throw new Error('WA layout changed: no ' + k); return i; };
  const [cI, yI, tI, aI] = ['County', 'Year', 'Election Type', 'Age'].map(at), SEX = { Female: 'Female', Male: 'Male', Unknown: 'Not stated' };
  const rows = R.slice(1).filter(r => r[yI] == year && r[tI] === 'General'), STATE = 'zWashington State';
  const total = rows.find(r => r[cI] === STATE && r[aI] === '0TOTAL');
  if (!total || !(+total[at('Total Ballots')] > 0)) throw new Error(`${year} general not posted yet`);
  const counties = {};
  for (const r of rows) { if (r[aI] === '0TOTAL' || r[cI] === STATE) continue; // subtotal rows
    const c = (counties[r[cI]] ??= { reg: 0, voted: 0, method: {}, complete: true, by: {} });
    for (const [col, sex] of Object.entries(SEX)) { const reg = +r[at(col + ' Voters')] || 0, voted = +r[at(col + ' Ballots')] || 0;
      c.reg += reg; c.voted += voted;
      for (const [dim, val] of [['age', r[aI] === '65-' ? '65+' : r[aI]], ['sex', sex]]) { const g = ((c.by[dim] ??= {})[val] ??= { reg: 0, voted: 0 }); g.reg += reg; g.voted += voted; } } }
  const state = rollup(counties);
  const gap = Math.abs(state.voted - +total[at('Total Ballots')]); // the state's own sheet is off by 1 ballot in 2014; anything more means we misread it
  if (gap > state.voted * 1e-4) throw new Error(`WA ${year}: counties add to ${state.voted}, state says ${total[at('Total Ballots')]}`);
  if (gap) console.warn(`WA ${year}: counties add to ${state.voted}, the state's total row says ${total[at('Total Ballots')]} (source discrepancy of ${gap})`);
  return { source: 'Washington Secretary of State voter participation data', url: 'https://www.sos.wa.gov/elections/data-research/election-data-and-maps/reports-data-and-statistics',
    note: "Washington records age and sex but not race, and has no party registration. Registered voters are the state's estimate for the election period.",
    countiesIn: Object.keys(counties).length, countiesAll: Object.keys(counties).length, state, counties };
}

// Colorado's Secretary of State posts ballots returned by sex × age × party (statewide) and by party (per county), plus registration by the same groups.
// These are unofficial returns, updated daily through Nov 13; registration is the Nov 1 count.
async function colorado() {
  const dir = path.join(CACHE, 'co');
  const act = sheets(await download('https://www.coloradosos.gov/pubs/newsRoom/pressReleases/2026/20261111GenElectionActivity.xlsx', path.join(dir, 'act.xlsx')));
  const reg = sheets(await download('https://www.coloradosos.gov/pubs/elections/VoterRegNumbers/2026/OctoberStatistics2026.xlsx', path.join(dir, 'reg.xlsx')));
  const PARTY = { DEM: 'Democratic', REP: 'Republican', UAF: 'Unaffiliated' }, party = code => PARTY[code] ?? 'Other parties';
  const SEX = { Female: 'Female', FEMALE: 'Female', Male: 'Male', MALE: 'Male', 'Not Disclosed': 'Not stated', 'NOT DISCLOSED': 'Not stated', X: 'X' };
  const AGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65-74', '75+'];
  const g = (t, dim, val) => ((t.by[dim] ??= {})[val] ??= { reg: 0, voted: 0 });
  // Registered, per county: active + inactive by party (pre-registrants under 18 are left out)
  const ps = reg['Party &amp; Status'], ph = ps[2], counties = {};
  for (const r of ps.slice(3)) { const name = r[0]; if (!name || /total|end of/i.test(name)) continue;
    const c = (counties[name] ??= { reg: 0, voted: 0, method: {}, complete: true, by: {} });
    for (let i = 1; i < 12; i++) { const n = (+r[i] || 0) + (+r[i + 13] || 0); c.reg += n; g(c, 'party', party(ph[i])).reg += n; } }
  // Ballots returned, per county × party
  const bc = act.All_Returned_Ballots_By_County, bh = bc[1];
  for (const r of bc.slice(2)) { const c = counties[r[0]]; if (!c) continue;
    for (let i = 1; i < 12; i++) { const n = +r[i] || 0; c.voted += n; g(c, 'party', party(bh[i])).voted += n; } }
  const state = { reg: 0, voted: 0, method: {}, by: {} };
  for (const c of Object.values(counties)) { state.reg += c.reg; state.voted += c.voted; for (const [k, v] of Object.entries(c.by.party)) { g(state, 'party', k).reg += v.reg; g(state, 'party', k).voted += v.voted; } }
  // Statewide sex × age: registration from the all-parties block, ballots from the sex/age sheet
  const ga = reg['Gender Party, Age &amp; Status'], hdr = ga[5], blocks = hdr.map((x, i) => x === 'COUNTY' ? i : -1).filter(i => i >= 0);
  const parties = blocks.filter(b => ga[1][b] !== 'Total'), tot = blocks.find(b => ga[1][b] === 'Total'); // one block per party, then an all-parties grand total
  for (const b of parties) if (hdr[b + 3] !== '18-24 Active' || hdr[b + 9] !== '75+ Active' || hdr[b + 11] !== '18-24 Inactive' || hdr[b + 17] !== '75+ Inactive') throw new Error('CO registration layout changed');
  let check = 0;
  for (const r of ga.slice(6)) for (const b of parties) { const sex = SEX[r[b + 1]]; if (!r[b] || /total/i.test(r[b]) || !sex) continue;
    AGES.forEach((a, k) => { const n = (+r[b + 3 + k] || 0) + (+r[b + 11 + k] || 0); g(state, 'age', a).reg += n; g(state, 'sex', sex).reg += n; }); }
  for (const r of ga.slice(6)) if (r[tot] && !/total/i.test(r[tot]) && SEX[r[tot + 1]]) check += +r[tot + 2] || 0;
  const ageReg = AGES.reduce((a, k) => a + g(state, 'age', k).reg, 0), prereg = ga.slice(6).reduce((a, r) => a + parties.reduce((s, b) => s + (r[b] && !/total/i.test(r[b]) && SEX[r[b + 1]] ? +r[b + 2] || 0 : 0), 0), 0);
  if (ageReg + prereg !== check) throw new Error(`CO: age bands + pre-registrants = ${ageReg + prereg}, grand total says ${check}`);
  let sex = null;
  for (const r of act.All_Returned_Ballots_GenderAge.slice(2)) { const k = String(r[0] ?? '').trim(), n = +r.at(-1) || 0;
    if (SEX[k]) { sex = SEX[k]; continue; }
    if (k === 'Grand Total') { if (n !== state.voted) throw new Error(`CO: counties add to ${state.voted}, sex/age sheet says ${n}`); break; }
    const age = k === '75 AND OVER' ? '75+' : k; if (!sex || !AGES.includes(age)) continue; // '<18' = pre-registrants, left out
    g(state, 'age', age).voted += n; g(state, 'sex', sex).voted += n; }
  if (Object.keys(counties).length !== 64) throw new Error(`CO: parsed ${Object.keys(counties).length} counties`);
  return { source: 'Colorado Secretary of State ballot returns (Nov 11) and voter registration (Nov 1)', url: 'https://www.coloradosos.gov/pubs/newsRoom/pressReleases/2026/PR20261112BallotReturns.html',
    note: 'Colorado figures are unofficial ballots returned as of Nov 11, before certification. Age and sex are statewide only; counties are by party. Colorado does not record race. Registered = active and inactive voters on Nov 1.',
    countiesIn: 64, countiesAll: 64, state, counties };
}

function rollup(counties) { // statewide totals = sum of counties
  const state = { reg: 0, voted: 0, method: {}, by: {} };
  for (const c of Object.values(counties)) { state.reg += c.reg; state.voted += c.voted;
    for (const [dim, d] of Object.entries(c.by)) for (const [val, g] of Object.entries(d)) { const t = ((state.by[dim] ??= {})[val] ??= { reg: 0, voted: 0 }); t.reg += g.reg; t.voted += g.voted; } }
  return state;
}

// Why each other state has no breakdown here yet (survey of state election offices, 2026-11-15). Shown on the map for states without data.
const STATUS = {
  Pennsylvania: 'Publishes turnout by age and party for each county, after certification (likely late Dec–Jan)',
  Washington: 'Publishes turnout by age and sex for each county, after certification (about Dec 4)',
  Delaware: 'Publishes turnout by age and party for every district, months after the election',
  Maryland: 'Publishes turnout by party, after certification',
  California: 'UC Berkeley Statewide Database publishes voters by party, sex and age about a year after the election',
  Kentucky: 'Publishes turnout by age, sex and party as PDF only, months after the election',
  Iowa: 'Publishes turnout by age, sex and party as PDF only (expected around January)',
  Oregon: 'Publishes turnout by age and party as PDF only (expected around January)',
  Alabama: 'Publishes turnout by race, sex and age as PDF only, about a year after the election',
  Alaska: 'Publishes turnout by age, sex and party as a web report only',
  Nevada: 'Publishes turnout by party for each county; its site blocks automated downloads',
  'South Carolina': 'Publishes registered voters by race, age and sex, but turnout by group only for absentee voters',
  Ohio: 'No summary; its free voter file (age, party) gets vote history after the canvass',
  Maine: 'Publishes party breakdowns for absentee ballots only',
  Florida: 'Voter file with race, sex and party is free by request only; no public summary found (site blocks automated access)',
  Georgia: 'Not confirmed: its election data site blocks automated access',
  Colorado: 'Publishes unofficial ballot returns by party, sex and age',
  ...Object.fromEntries(['Arizona', 'Arkansas', 'Connecticut', 'District of Columbia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Kansas', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana',
    'Nebraska', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Dakota', 'Oklahoma', 'Rhode Island', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'West Virginia',
    'Wisconsin', 'Wyoming'].map(st => [st, 'Does not publish turnout by age, race, sex or party'])),
};

async function main() {
  const out = {}, errs = [];
  for (const [st, load] of [['North Carolina', northCarolina], ['Louisiana', louisiana], ['Washington', washington], ['Colorado', colorado]]) try { out[st] = await load(); } catch (e) { errs.push(`${st}: ${e.message}`); } // one state failing keeps the others
  if (!Object.keys(out).length) throw new Error(errs.join('; '));
  for (const e of errs) console.warn('skipped ' + e);
  const status = Object.fromEntries(Object.entries(STATUS).filter(([st]) => !out[st]));
  fs.writeFileSync(path.join(__dirname, 'state-demo-data.js'), `// Built by state-demo.js on ${new Date().toISOString()}\nwindow.STATE_DEMO = ${JSON.stringify(out)};\nwindow.STATE_DEMO_STATUS = ${JSON.stringify(status)};\n`);
  for (const [st, d] of Object.entries(out)) console.log(`${st}: ${d.countiesIn} of ${d.countiesAll} counties complete; there ${d.state.voted.toLocaleString()} voted of ${d.state.reg.toLocaleString()} registered (${(d.state.voted / d.state.reg * 100).toFixed(1)}%)`);
}
// Past general elections from the same state files (statewide totals by group). They never change, so they're built once: node state-demo.js --past
const PAST = {
  'North Carolina': [['2024', '2024_11_05'], ['2022', '2022_11_08'], ['2020', '2020_11_03']].map(([y, f]) => [y, () => northCarolina(f)]),
  Washington: ['2024', '2022', '2020', '2018', '2016', '2014', '2012', '2010'].map(y => [y, () => washington(+y)]),
};
async function buildPast() {
  const out = {};
  for (const [st, years] of Object.entries(PAST)) for (const [y, load] of years)
    for (let tries = 1; ; tries++) try { const { state: s } = await load(); ((out[st] ??= {})[y] = { reg: s.reg, voted: s.voted, by: s.by, method: s.method }); break; }
      catch (e) { if (tries === 3) { console.warn(`skipped ${st} ${y}: ${e.message}`); break; } } // downloads occasionally drop
  fs.writeFileSync(path.join(__dirname, 'state-past-data.js'), `// Built by state-demo.js --past on ${new Date().toISOString()}\nwindow.STATE_PAST = ${JSON.stringify(out)};\n`);
  for (const [st, ys] of Object.entries(out)) console.log(`${st}: ${Object.entries(ys).map(([y, d]) => `${y} ${(d.voted / d.reg * 100).toFixed(1)}%`).join(' · ')}`);
}

if (require.main === module) (process.argv.includes('--past') ? buildPast() : main()).catch(e => { console.error(e.message); process.exitCode = 1; });
