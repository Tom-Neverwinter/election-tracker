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
  const dir = path.join(CACHE, 'co'), PR = 'https://www.coloradosos.gov/pubs/newsRoom/pressReleases/2026/';
  // The state posts one file per day (named for the day the data runs through); take the newest that exists. Daily reports ended with Nov 12 data.
  let act, asOf;
  for (let d = new Date(); !act && d >= new Date('2026-11-04'); d.setDate(d.getDate() - 1)) {
    const ymd = d.toLocaleDateString('en-CA').replace(/-/g, '');
    try { act = sheets(await download(PR + ymd + 'GenElectionActivity.xlsx', path.join(dir, 'act.xlsx'))); asOf = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch {}
  }
  if (!act) throw new Error('CO: no ballot-return file found');
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
  return { source: `Colorado Secretary of State ballot returns (through ${asOf}) and voter registration (Nov 1)`, url: 'https://www.coloradosos.gov/pubs/newsRoom/pressReleases/2026/PR20261113BallotReturns.html',
    note: `Colorado figures are unofficial ballots returned through ${asOf}, before certification. Age and sex are statewide only; counties are by party. Colorado does not record race. Registered = active and inactive voters on Nov 1.`,
    countiesIn: 64, countiesAll: 64, state, counties };
}

// Pennsylvania's Department of State posts a "voter registration and vote history summary" spreadsheet per election: by county & party and by county & age.
// File names change between elections, so for 2026 the loader finds the link on the election-data page; past years pass their URL.
const PA_PAGE = 'https://www.pa.gov/agencies/dos/resources/voting-and-elections-resources/voting-and-election-statistics/election-data';
async function pennsylvania(url) {
  if (!url) { // 2026 general: look for its summary on the state's page
    const html = await (await fetch(PA_PAGE, { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } })).text();
    const href = [...html.matchAll(/href="([^"]+\.xlsx)"/g)].map(m => m[1]).find(h => /2026[-_ ]?general(?!-primary)|2026%20general/i.test(h) && /vote[-_ %20]*history/i.test(h) && !/primary/i.test(h));
    if (!href) throw new Error('2026 general not posted yet');
    url = new URL(href, PA_PAGE).href;
  }
  const S = sheets(await download(url, path.join(CACHE, 'pa', 'summary.xlsx')));
  const party = S['By county &amp; party'], age = S['By county &amp; age'];
  if (!party || !age) throw new Error('PA layout changed: sheets missing');
  const col = (rows, name) => { const i = rows[0].indexOf(name); if (i < 0) throw new Error('PA layout changed: no ' + name); return i; };
  const PARTIES = { Democratic: 'Democratic', Republican: 'Republican', Libertarian: 'Other parties', Other: 'Other parties' };
  const AGES = ['18 to 24', '25 to 34', '35 to 44', '45 to 54', '55 to 64', '65 to 74', '75+'];
  const counties = {}, g = (c, dim, k) => ((c.by[dim] ??= {})[k] ??= { reg: 0, voted: 0 });
  let total;
  for (const r of party.slice(1)) { if (!r[0]) continue;
    const c = { reg: 0, voted: 0, method: {}, complete: true, by: {} };
    for (const [p, label] of Object.entries(PARTIES)) { const v = +r[col(party, `${p} Vote History`)], n = +r[col(party, `${p} Voter Registration`)]; c.voted += v; c.reg += n; g(c, 'party', label).voted += v; g(c, 'party', label).reg += n; }
    if (r[0] === 'TOTAL') total = c; else counties[title(r[0])] = c; }
  for (const r of age.slice(1)) { const c = counties[title(r[0] ?? '')]; if (!c) continue;
    for (const a of AGES) { const k = a === '75+' ? '75+' : a.replace(' to ', '-'); g(c, 'age', k).voted += +r[col(age, `${a} Vote History`)]; g(c, 'age', k).reg += +r[col(age, `${a} Voter Registration`)]; } }
  const state = rollup(counties);
  if (!total || state.voted !== total.voted || state.reg !== total.reg) throw new Error(`PA: counties add to ${state.voted}/${state.reg}, TOTAL row says ${total?.voted}/${total?.reg}`);
  if (Object.keys(counties).length !== 67) throw new Error(`PA: parsed ${Object.keys(counties).length} counties`);
  return { source: 'Pennsylvania Department of State voter registration and vote history summary', url: PA_PAGE,
    note: 'Pennsylvania reports turnout by party and by age, not by race or sex. Age excludes voters with placeholder birth dates and protected voters, so age groups add to slightly fewer voters than the party totals. Registered = voters on the rolls for the election.',
    countiesIn: 67, countiesAll: 67, state, counties };
}
const title = s => String(s).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

// Delaware's Department of Elections posts "Registered Voters by Age Group and Party" for each general election: a fixed-width report with a block
// per election district, then county and statewide blocks. Age × party is crossed only within each block, so counties and the state get both.
async function delaware(year = 2026) {
  const res = await fetch(`https://elections.delaware.gov/voter/registrationtotals/reports/agprpt_${year}.txt`, { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } });
  if (res.status === 404) throw new Error(`${year} general not posted yet`);
  if (!res.ok) throw new Error(`DE ${res.status}`);
  const lines = (await res.text()).split(/\r?\n/), PARTY = ['Democratic', 'Republican', 'Other parties'];
  const AGE = { 'Under 21': '18-20', '21-29': '21-29', '30-39': '30-39', '40-49': '40-49', '50-59': '50-59', '60-65': '60-65', 'Over 65': 'Over 65' };
  const blocks = {}; // "KENT COUNTY" / "STATEWIDE" summary blocks: a heading line followed directly by the party header line
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = lines[i].trim();
    if (!/^([A-Za-z ]+ COUNTY|STATEWIDE)$/.test(head) || !/Democrat/.test(lines[i + 1])) continue;
    const b = { rows: {} };
    for (let j = i + 3; j < lines.length && /^\s+[a-i]\./.test(lines[j]); j++) {
      const m = lines[j].match(/^\s+[a-i]\.\s+(.+?)\s{2,}([\d,].*)$/); if (!m) continue;
      const n = m[2].trim().split(/\s+/).map(x => +x.replace(/,/g, '')); // [D reg, D voted, D %, R reg, R voted, R %, O reg, O voted, O %, T reg, T voted, T %]
      b.rows[m[1].trim()] = n;
    }
    blocks[head] = b;
  }
  const unit = b => { const t = b.rows.Total; if (!t) throw new Error('DE: block without a Total row');
    const u = { reg: t[9], voted: t[10], method: {}, complete: true, by: { age: {}, party: {} } };
    PARTY.forEach((p, k) => u.by.party[p] = { reg: t[k * 3], voted: t[k * 3 + 1] });
    for (const [row, label] of Object.entries(AGE)) { const r = b.rows[row]; if (!r) throw new Error('DE: missing age row ' + row); u.by.age[label] = { reg: r[9], voted: r[10] }; }
    const sum = d => Object.values(u.by[d]).reduce((a, g) => a + g.voted, 0);
    if (sum('age') !== u.voted || sum('party') !== u.voted) throw new Error(`DE: age ${sum('age')} / party ${sum('party')} don't add to ${u.voted}`);
    return u; };
  const counties = Object.fromEntries(Object.entries(blocks).filter(([k]) => k !== 'STATEWIDE').map(([k, b]) => [title(k.replace(/ COUNTY$/, '')), unit(b)]));
  const state = unit(blocks.STATEWIDE ?? (() => { throw new Error('DE: no STATEWIDE block'); })());
  const cs = rollup(counties);
  if (cs.voted !== state.voted || cs.reg !== state.reg) throw new Error(`DE: counties add to ${cs.voted}, statewide says ${state.voted}`);
  if (Object.keys(counties).length !== 3) throw new Error(`DE: parsed ${Object.keys(counties).length} counties`);
  return { source: 'Delaware Department of Elections, Registered Voters by Age Group and Party', url: `https://elections.delaware.gov/voter/registrationtotals/reports/agprpt_${year}.txt`,
    note: 'Delaware reports turnout by age group and party (Democrat, Republican, all others), not by race or sex. Registered = voters on the rolls for the election.',
    countiesIn: 3, countiesAll: 3, state, counties };
}

// California: UC Berkeley's Statewide Database (the Legislature's redistricting database) publishes, per precinct, registered voters and voters who
// voted, by party, sex, age band (within party × sex) and surname-identified Latino and Asian voters. Built from county voter files about a year after
// each election, so it's past elections only. Its vote history matches about 97% of ballots counted, so rates run a little low.
async function california(year) {
  const yy = String(year).slice(2), base = `https://statewidedatabase.org/pub/data/G${yy}/state/state_g${yy}_`;
  const read = async kind => { const z = unzip(fs.readFileSync(await download(`${base}${kind}_by_g${yy}_srprec.zip`, path.join(CACHE, 'ca', `g${yy}_${kind}.zip`))));
    const [head, ...lines] = Object.values(z)[0].toString('latin1').split(/\r?\n/).filter(Boolean), h = head.split(',');
    const tot = {}, byFips = {}, fi = h.indexOf('FIPS');
    for (const l of lines) { const c = l.split(','), t = (byFips[c[fi]] ??= {}); c.forEach((v, i) => { if (i >= 7) { tot[h[i]] = (tot[h[i]] ?? 0) + (+v || 0); t[h[i]] = (t[h[i]] ?? 0) + (+v || 0); } }); }
    return { tot, byFips }; };
  const [{ tot: V, byFips: VC }, { tot: R, byFips: RC }] = await Promise.all([read('voters'), read('registration')]);
  // County names from the Census Bureau's county code list (the files carry only FIPS codes)
  const names = Object.fromEntries((await (await fetch('https://www2.census.gov/geo/docs/reference/codes2020/cou/st06_ca_cou2020.txt')).text())
    .split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split('|')).map(c => ['06' + c[2], c[4].replace(/ County$/, '')]));
  const OTHER = ['AIP', 'PAF', 'MSC', 'LIB', 'NLP', 'GRN', 'REF'], ASIAN = ['KOR', 'JPN', 'CHI', 'IND', 'VIET', 'FIL'], P4 = ['DEM', 'REP', 'DCL', 'OTH'];
  const AGE = { '1824': '18-23', '2534': '24-33', '3544': '34-43', '4554': '44-53', '5564': '54-63', '65PL': '64+', 'UNK': 'Unknown' }; // the codebook's bands: column names say 1824 but mean 18-23
  const groups = T => {
    const sum = cols => cols.reduce((a, c) => { if (!(c in T)) throw new Error('CA layout changed: no ' + c); return a + T[c]; }, 0);
    const age = Object.fromEntries(Object.entries(AGE).map(([code, label]) => [label, sum(P4.flatMap(p => ['M', 'F'].map(x => p + x + code)))]));
    return { total: T.TOTREG_R,
      party: { Democratic: T.DEM, Republican: T.REP, 'No party preference': T.DCL, 'Other parties': sum(OTHER) },
      sex: { Female: T.FEMALE, Male: T.MALE, 'Not stated': T.TOTREG_R - T.FEMALE - T.MALE }, age,
      ethnicity: { 'Latino (by surname)': sum(['DEM', 'REP', 'DCL', 'OTH'].map(p => 'HISP' + p)), 'Asian (by surname)': sum(ASIAN.flatMap(a => ['DEM', 'REP', 'DCL', 'OTH'].map(p => a + p))) } }; };
  const unit = (Vt, Rt) => { const v = groups(Vt), r = groups(Rt), u = { reg: r.total, voted: v.total, method: {}, complete: true, by: {} };
    for (const dim of ['party', 'sex', 'age', 'ethnicity']) u.by[dim] = Object.fromEntries(Object.keys(v[dim]).filter(k => k !== 'Unknown' && r[dim][k] > 0).map(k => [k, { reg: r[dim][k], voted: v[dim][k] }])); // empty groups (e.g. sex not stated) left out
    for (const [name, g] of [['party', v.party], ['age', v.age]]) { const s = Object.values(g).reduce((a, b) => a + b, 0); if (s !== v.total) throw new Error(`CA ${year}: ${name} adds to ${s}, total ${v.total}`); }
    return u; };
  const state = unit(V, R), counties = {};
  for (const f of Object.keys(RC)) { if (!names[f]) throw new Error(`CA: no county name for FIPS ${f}`); counties[names[f]] = unit(VC[f] ?? {}, RC[f]); }
  if (Object.keys(counties).length !== 58) throw new Error(`CA: ${Object.keys(counties).length} counties`);
  const cs = rollup(counties); if (cs.voted !== state.voted || cs.reg !== state.reg) throw new Error(`CA: counties add to ${cs.voted}, state ${state.voted}`);
  return { state, counties, countiesIn: 58, countiesAll: 58 };
}

// South Carolina's voter registration system (VREMS) serves voter-history statistics per county: registered and voted, each broken down by race, sex and
// four age bands (separate totals, not crossed). No party (South Carolina has no party registration). One request each for voted and registered.
async function southCarolina(year) {
  const get = async type => { const res = await fetch(`https://vrems.scvotes.sc.gov/Statistics/GetVoterHistoryResultsByCounty?dataType=${type}&year=${year}&electionType=GEN`, { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } });
    if (!res.ok) throw new Error(`${year} general not posted yet (VREMS ${res.status})`); // asking for an election it lacks gives a server error
    const j = (await res.json()).voterHistoryResults; if (!j?.countyPrecinctResults?.length) throw new Error(`${year} general not posted yet`); return j; };
  const [V, R] = await Promise.all([get('VOT'), get('REG')]);
  const ages = [1, 2, 3, 4].map(i => V[`ageRange${i}Label`].replace(/-up$/, '+').replace(/^Under 25$/, '18-24')); // bands differ by year (2018 and earlier: 18-21, 22-34, 35-64, 65+)
  if (ages.some(a => !/^\d+(-\d+|\+)$/.test(a))) throw new Error('SC layout changed: age bands ' + ages);
  const allRaces = V.countyPrecinctResults.some(r => r.county && r.showAllRaces); // 2022 and earlier report only White vs Nonwhite
  const RACE = allRaces ? { white: 'White', blackAA: 'Black', hispanic: 'Hispanic', asian: 'Asian', nativeAmerican: 'American Indian', multiple: 'Two or more', other: 'Other', unknown: 'Not stated' } : { white: 'White', nonwhite: 'Nonwhite' };
  const SEX = { female: 'Female', male: 'Male', unknownGender: 'Not stated' };
  const breakdown = (row, total) => { const by = { race: {}, sex: {}, age: {} };
    for (const [k, l] of Object.entries(RACE)) by.race[l] = row[k]; for (const [k, l] of Object.entries(SEX)) by.sex[l] = row[k];
    ages.forEach((l, i) => by.age[l] = row[`ageRange${i + 1}`]);
    for (const [dim, g] of Object.entries(by)) { const s = Object.values(g).reduce((a, b) => a + b, 0), gap = Math.abs(s - row[total]); // older years miss a voter here and there (no birth date)
      if (gap > Math.max(5, row[total] * 1e-4)) throw new Error(`SC ${year} ${row.county}: ${dim} adds to ${s}, total ${row[total]}`);
      if (gap) console.warn(`SC ${year} ${row.county}: ${dim} adds to ${s}, total ${row[total]} (source gap of ${gap})`); }
    return by; };
  const regBy = Object.fromEntries(R.countyPrecinctResults.filter(r => r.county && !r.isSummary).map(r => [r.county, r]));
  const counties = {};
  for (const v of V.countyPrecinctResults.filter(r => r.county && !r.isSummary)) { const r = regBy[v.county]; if (!r) throw new Error('SC: no registration row for ' + v.county);
    const bv = breakdown(v, 'totalVoting'), br = breakdown(r, 'totalRegistered'), c = { reg: r.totalRegistered, voted: v.totalVoting, method: {}, complete: true, by: {} };
    for (const dim of Object.keys(bv)) c.by[dim] = Object.fromEntries(Object.keys(bv[dim]).filter(k => br[dim][k] > 0).map(k => [k, { reg: br[dim][k], voted: bv[dim][k] }]));
    counties[title(v.county)] = c; }
  const state = rollup(counties), tot = V.countyPrecinctResults.find(r => r.isSummary);
  if (tot && Math.abs(tot.totalVoting - state.voted) > 25) throw new Error(`SC ${year}: counties add to ${state.voted}, Totals row says ${tot.totalVoting}`); // a handful of voters have no county
  if (Object.keys(counties).length !== 46) throw new Error(`SC: ${Object.keys(counties).length} counties`);
  return { state, counties, countiesIn: 46, countiesAll: 46 };
}

// Kentucky's State Board of Elections posts "Voter Turnout by Age and Sex" PDFs per general election: registered, voted and % by 5 age groups × sex,
// for all voters and by party (Democratic, Republican, other), statewide and for each district and county. Text is pulled out with Python's pypdf.
const KY_PDF = { 2024: '2024G%20Voter%20Turnout%20Age%2c%20Gender%2c%20Party.pdf', 2022: 'General2022AgeSex.pdf', 2020: 'voterturnoutagesex-2020G-20210302-043012.pdf' };
function pdfText(file) { // shortcut: needs Python with pypdf; fine for the once-off --past build, not for the hourly job
  return require('child_process').execFileSync('python', ['-c', 'import pypdf,sys\nr=pypdf.PdfReader(sys.argv[1])\nsys.stdout.buffer.write("\\n".join(p.extract_text() for p in r.pages).encode("utf8"))', file], { maxBuffer: 1e8 }).toString('utf8');
}
async function kentucky(year) {
  let file = KY_PDF[year];
  if (!file) { // a new election: look for its general-election PDF on the turnout page (file names change every year)
    const html = await (await fetch('https://elect.ky.gov/Resources/Pages/Turnout.aspx', { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } })).text();
    file = [...html.matchAll(/href="[^"]*\/Documents\/([^"]+\.pdf)"/gi)].map(m => m[1])
      .find(f => { const d = decodeURIComponent(f); return (d.includes(`${year}G`) || d.includes(`General${year}`) || d.includes(`${year}-G`)) && /age|gender|sex/i.test(d) && !/primary/i.test(d); });
    if (!file) throw new Error(`${year} general not posted yet`); }
  const text = pdfText(await download('https://elect.ky.gov/Resources/Documents/' + file, path.join(CACHE, 'ky', `${year}.pdf`)));
  const num = s => +s.replace(/,/g, ''), sections = {}; let cur = null, age = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^([A-Z][A-Z .']+) County$/) ?? (line.trim() === 'Statewide' ? [null, 'STATEWIDE'] : null);
    if (h) { cur = sections[h[1]] = { ages: {}, all: null, sex: {} }; age = null; continue; }
    if (/^(Congressional|Senate|House) District|^Supreme Court/.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^(Age Group \d \(([^)]+)\)|All Ages|Females|Males|None)\s+([\d,]+)\s+([\d,]+)\s+\S+\s+([\d,]+)\s+([\d,]+)\s+\S+\s+([\d,]+)\s+([\d,]+)\s+\S+\s+([\d,]+)\s+([\d,]+)\s+\S+/);
    if (!m) continue;
    const v = { reg: num(m[3]), voted: num(m[4]), party: { Democratic: { reg: num(m[5]), voted: num(m[6]) }, Republican: { reg: num(m[7]), voted: num(m[8]) }, 'Other parties': { reg: num(m[9]), voted: num(m[10]) } } };
    if (m[2]) { age = m[2].replace(/ & over/, '+'); cur.ages[age] = v; }
    else if (m[1] === 'All Ages') { age = 'ALL'; cur.all = v; }
    else if (age === 'ALL') cur.sex[{ Females: 'Female', Males: 'Male', None: 'Not stated' }[m[1]]] = v;
  }
  const unit = (s, name) => { if (!s.all) throw new Error(`KY ${year} ${name}: no All Ages row`);
    const u = { reg: s.all.reg, voted: s.all.voted, method: {}, complete: true, by: { age: {}, sex: {}, party: s.all.party } };
    for (const [k, v] of Object.entries(s.ages)) u.by.age[k] = { reg: v.reg, voted: v.voted };
    for (const [k, v] of Object.entries(s.sex)) if (v.reg > 0) u.by.sex[k] = { reg: v.reg, voted: v.voted };
    for (const dim of ['age', 'sex', 'party']) { const sv = Object.values(u.by[dim]).reduce((a, g) => a + g.voted, 0); if (sv !== u.voted) throw new Error(`KY ${year} ${name}: ${dim} adds to ${sv}, total ${u.voted}`); }
    return u; };
  const counties = Object.fromEntries(Object.entries(sections).filter(([k]) => k !== 'STATEWIDE').map(([k, s]) => [title(k), unit(s, k)]));
  if (Object.keys(counties).length !== 120) throw new Error(`KY ${year}: ${Object.keys(counties).length} counties`);
  const state = unit(sections.STATEWIDE, 'Statewide'), cs = rollup(counties);
  if (cs.voted !== state.voted || cs.reg !== state.reg) throw new Error(`KY ${year}: counties add to ${cs.voted}/${cs.reg}, statewide ${state.voted}/${state.reg}`);
  return { state, counties, countiesIn: 120, countiesAll: 120 };
}

// Maryland's State Board of Elections posts "Official Turnout (By Party and County)": a Statewide block, then one block per party, each with ballots by
// method and eligible voters for the 24 local boards. Blocks shift between columns A and B, so values are read relative to the "LBE" header cell.
const MD_FILE = { 2026: '2026_stats/GG26/Official%20by%20Party%20and%20County.xlsx', 2024: '2024_stats/PG24/Official%20by%20Party%20and%20County.xlsx', 2022: '2022_stats/GG22/Updated-Official_by_Party_and_County.xlsx' };
async function maryland(year) {
  const f = await download('https://elections.maryland.gov/press_room/' + MD_FILE[year], path.join(CACHE, 'md', `${year}.xlsx`));
  if (fs.readFileSync(f).subarray(0, 2).toString() !== 'PK') throw new Error(`${year} general not posted yet`); // the site answers missing files with an HTML page and HTTP 200
  const R = Object.values(sheets(f))[0];
  const PARTY = { Democrat: 'Democratic', Republican: 'Republican', Unaffiliated: 'Unaffiliated' }; // every other block (Libertarian, Green, NLM, Other Parties...) is "Other parties"
  const blocks = {}; let label = null;
  for (let i = 0; i < R.length; i++) { const r = R[i] ?? [], j = r.indexOf('LBE');
    if (j < 0) { const t = r.find(x => typeof x === 'string' && x.trim()); if (t && !/TOTAL|Official|Election|^\s*$/i.test(t) && r.filter(x => x !== null && x !== '').length === 1) label = t.trim(); continue; }
    if (!label) throw new Error('MD: block without a heading at row ' + i);
    const key = label === 'Statewide' ? 'Statewide' : PARTY[label] ?? 'Other parties', b = (blocks[key] ??= {});
    for (let k = i + 1; k < R.length && R[k]?.[j] && R[k][j] !== 'TOTAL'; k++) { const c = R[k], n = x => +c[j + x] || 0, cty = String(c[j]).trim();
      const e = (b[cty] ??= { voted: 0, reg: 0 }); e.voted += n(4) + n(8) + n(10) + n(12); e.reg += n(14); }
    label = null; }
  if (!blocks.Statewide || !blocks.Democratic || !blocks.Republican) throw new Error(`MD ${year}: missing blocks (${Object.keys(blocks)})`);
  const counties = {};
  for (const [cty, t] of Object.entries(blocks.Statewide)) {
    const c = { reg: t.reg, voted: t.voted, method: {}, complete: true, by: { party: {} } };
    for (const p of ['Democratic', 'Republican', 'Unaffiliated', 'Other parties']) if (blocks[p]?.[cty]) c.by.party[p] = { reg: blocks[p][cty].reg, voted: blocks[p][cty].voted };
    let sv = Object.values(c.by.party).reduce((a, g) => a + g.voted, 0), sr = Object.values(c.by.party).reduce((a, g) => a + g.reg, 0);
    const dv = c.voted - sv, dr = c.reg - sr; // the 2022 file leaves one minor party out of the breakdown (about 0.1% in every county)
    if (dv < 0 || dr < 0 || dr > c.reg * 0.01) throw new Error(`MD ${year} ${cty}: parties add to ${sv}/${sr}, county total ${c.voted}/${c.reg}`);
    if (dv || dr) { const o = (c.by.party['Other parties'] ??= { reg: 0, voted: 0 }); o.voted += dv; o.reg += dr; } // those voters belong to no listed party
    counties[cty] = c; }
  if (Object.keys(counties).length !== 24) throw new Error(`MD ${year}: ${Object.keys(counties).length} jurisdictions`);
  return { state: rollup(counties), counties, countiesIn: 24, countiesAll: 24 };
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
  for (const [st, load] of [['North Carolina', northCarolina], ['Louisiana', louisiana], ['Washington', washington], ['Colorado', colorado], ['Pennsylvania', () => pennsylvania()], ['Delaware', () => delaware()],
    ['South Carolina', () => southCarolina(2026).then(d => ({ ...d, source: 'South Carolina Election Commission voter history statistics (VREMS)', url: 'https://vrems.scvotes.sc.gov/Statistics/VoterHistory', note: 'South Carolina reports turnout by race, sex and age per county; it has no party registration.' }))],
    ['Maryland', () => maryland(2026).then(d => ({ ...d, source: 'Maryland State Board of Elections official turnout by party and county', url: 'https://elections.maryland.gov/press_room/index.html', note: 'Maryland reports turnout by party only. Registered = eligible voters.' }))],
    ['Kentucky', () => kentucky(2026).then(d => ({ ...d, source: 'Kentucky State Board of Elections turnout by age, sex and party', url: 'https://elect.ky.gov/Resources/Pages/Turnout.aspx', note: 'Kentucky labels these turnout reports unofficial. Its youngest group includes 17-year-olds registered to vote at 18.' }))]]) try { out[st] = await load(); } catch (e) { errs.push(`${st}: ${e.message}`); } // one state failing keeps the others
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
  Pennsylvania: [['2024', () => pennsylvania('https://www.pa.gov/content/dam/copapwp-pagov/en/dos/resources/voting-and-elections/bulk-data/2024-general-election/voter%20registration%20-%20vote%20history%20summary%20-%202024%20general.xlsx')]],
  Delaware: ['2024', '2022', '2020'].map(y => [y, () => delaware(+y)]), // 2018 and earlier use an older report layout
  California: ['2024', '2022'].map(y => [y, () => california(+y)]),
  'South Carolina': ['2024', '2022', '2020', '2018', '2016', '2014', '2012', '2010'].map(y => [y, () => southCarolina(+y)]),
  Kentucky: ['2024', '2022', '2020'].map(y => [y, () => kentucky(+y)]),
  Maryland: ['2024', '2022'].map(y => [y, () => maryland(+y)]),
};
const PAST_NOTES = { // shown under a state's past-records grid when its source needs explaining
  Maryland: "From the Maryland State Board of Elections' official turnout by party and county (eligible voters and ballots cast). Maryland doesn't break turnout down by age, race or sex.",
  Kentucky: "From the Kentucky State Board of Elections' turnout reports by age, sex and party (it labels them unofficial). Kentucky's youngest group includes 17-year-olds registered to vote at 18.",
  'South Carolina': "From South Carolina's voter registration system (VREMS) statistics, which count voters by race, sex and age within each county. South Carolina has no party registration. Registered counts every voter on its rolls, so rates can run below turnout figures quoted using active voters only.",
  California: "From UC Berkeley's Statewide Database, built from county voter files. Its vote history matches about 97% of ballots counted (2024: 15.6 million of 16.1 million certified), so rates run about 2 points low. Latino and Asian voters are identified by surname, an estimate.",
};
async function buildPast() {
  const out = {};
  for (const [st, years] of Object.entries(PAST)) for (const [y, load] of years)
    for (let tries = 1; ; tries++) try { const { state: s, counties } = await load(); ((out[st] ??= {})[y] = { reg: s.reg, voted: s.voted, by: s.by, method: s.method,
        counties: Object.fromEntries(Object.entries(counties ?? {}).map(([k, c]) => [k, { reg: c.reg, voted: c.voted, by: c.by }])) }); break; }
      catch (e) { if (tries === 3) { console.warn(`skipped ${st} ${y}: ${e.message}`); break; } } // downloads occasionally drop
  fs.writeFileSync(path.join(__dirname, 'state-past-data.js'), `// Built by state-demo.js --past on ${new Date().toISOString()}\nwindow.STATE_PAST = ${JSON.stringify(out)};\nwindow.STATE_PAST_NOTES = ${JSON.stringify(PAST_NOTES)};\n`);
  for (const [st, ys] of Object.entries(out)) console.log(`${st}: ${Object.entries(ys).map(([y, d]) => `${y} ${(d.voted / d.reg * 100).toFixed(1)}%`).join(' · ')}`);
}

if (require.main === module) (process.argv.includes('--past') ? buildPast() : main()).catch(e => { console.error(e.message); process.exitCode = 1; });
