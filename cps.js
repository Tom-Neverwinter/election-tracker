// Who voted in past elections, every state: Census Bureau Current Population Survey (CPS) Voting and Registration Supplement,
// Tables 4b (sex, race, Hispanic origin) and 4c (age), for States. Writes cps-data.js: window.CPS = { "Alabama": { 2024: { Total: {...}, Male: {...}, ... } } }.
// Each group: { cit: citizens 18+ (thousands), pct: % of citizens who said they voted, moe: margin of error in points }. "B" (base too small) → left out.
// Run once after each new release (about six months after an election): node cps.js
const fs = require('fs'), path = require('path'), { sheets } = require('./xlsx.js');
const BASE = 'https://www2.census.gov/programs-surveys/cps/tables/p20/';
const YEARS = { 2024: ['587/vote04b_2024', '587/vote04c_2024'], 2022: ['586/vote04b_2022', '586/vote04c_2022'], 2020: ['585/table04b', '585/table04c'], 2018: ['583/table04b', '583/table04c'], 2016: ['580/table04b', '580/table04c'] };
const KEEP = { 'Total': 'Total', 'Male': 'Male', 'Female': 'Female', 'White non-Hispanic alone': 'White (not Hispanic)', 'Black alone': 'Black', 'Asian alone': 'Asian', 'Hispanic (any race)': 'Hispanic', 'Hispanic (of any race)': 'Hispanic',
  '18 to 24': '18–24', '25 to 34': '25–34', '35 to 44': '35–44', '45 to 64': '45–64', '65+': '65+', '65 years and over': '65+' };
const label = s => KEEP[String(s).trim().replace(/ years$/, '')] ?? KEEP[String(s).trim()];
const title = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/ Of /g, ' of ');

async function rows(file, year) {
  const dir = path.join(__dirname, '.cache', 'cps'), local = path.join(dir, file.replace('/', '_') + '.xlsx');
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetch(BASE + file + '.xlsx', { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } });
  if (!res.ok) throw new Error(`${res.status} ${file}`);
  fs.writeFileSync(local, Buffer.from(await res.arrayBuffer()));
  const R = Object.values(sheets(local))[0];
  if (!R.some(r => new RegExp(`November ${year}`).test(String(r?.[0] ?? '')))) throw new Error(`${file} is not November ${year}`);
  const h = R.find(r => r?.some?.(c => /Percent voted/.test(String(c))));
  if (!/Percent voted[\s\S]*Citizen/.test(String(h?.[12])) || !/Total citizen/i.test(String(R.find(r => /Total citizen/i.test(String(r?.[3] ?? '')))?.[3]))) throw new Error(`${file}: layout changed`);
  const out = []; let st = null;
  for (const r of R) { if (r?.[0] && /^[A-Z .]+$/.test(String(r[0]).trim())) st = String(r[0]).trim(); const g = label(r?.[1] ?? '');
    if (st && !/^(US|UNITED STATES)$/.test(st) && g) out.push([title(st), g, { cit: +r[3], pct: typeof r[12] === 'number' ? r[12] : null, moe: typeof r[13] === 'number' ? r[13] : null }]); }
  return out;
}

async function main() {
  const out = {};
  for (const [year, files] of Object.entries(YEARS)) for (const f of files) for (const [st, g, v] of await rows(f, year)) ((out[st] ??= {})[year] ??= {})[g] = v;
  const n = Object.keys(out).length;
  if (n !== 51) throw new Error(`expected 51 states, got ${n}: ${Object.keys(out).join(', ')}`);
  for (const [st, ys] of Object.entries(out)) for (const y of Object.keys(YEARS)) if (ys[y]?.Total?.pct == null) throw new Error(`${st} ${y}: no total`);
  fs.writeFileSync(path.join(__dirname, 'cps-data.js'), `// Built by cps.js on ${new Date().toISOString()} from Census CPS Voting and Registration Supplement Tables 4b and 4c, 2016–2024.\nwindow.CPS = ${JSON.stringify(out)};\n`);
  console.log(`${n} states × ${Object.keys(YEARS).length} elections`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
