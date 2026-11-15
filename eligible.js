// Who could vote: citizens 18+ in each state by age, sex and race, from the Census Bureau's American Community Survey 2020–2024 (5-year).
// Writes eligible-data.js: window.ELIGIBLE = { "Alabama": { total, age: {...}, sex: {...}, race: {...} } }. Run once a year: node eligible.js
// Uses the keyless table-based summary files on www2.census.gov (the Census API now needs a key).
const fs = require('fs'), path = require('path');
const BASE = 'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-';
const FIPS = { '01': 'Alabama', '02': 'Alaska', '04': 'Arizona', '05': 'Arkansas', '06': 'California', '08': 'Colorado', '09': 'Connecticut', '10': 'Delaware', '11': 'District of Columbia', '12': 'Florida', '13': 'Georgia', '15': 'Hawaii', '16': 'Idaho', '17': 'Illinois', '18': 'Indiana', '19': 'Iowa', '20': 'Kansas', '21': 'Kentucky', '22': 'Louisiana', '23': 'Maine', '24': 'Maryland', '25': 'Massachusetts', '26': 'Michigan', '27': 'Minnesota', '28': 'Mississippi', '29': 'Missouri', '30': 'Montana', '31': 'Nebraska', '32': 'Nevada', '33': 'New Hampshire', '34': 'New Jersey', '35': 'New Mexico', '36': 'New York', '37': 'North Carolina', '38': 'North Dakota', '39': 'Ohio', '40': 'Oklahoma', '41': 'Oregon', '42': 'Pennsylvania', '44': 'Rhode Island', '45': 'South Carolina', '46': 'South Dakota', '47': 'Tennessee', '48': 'Texas', '49': 'Utah', '50': 'Vermont', '51': 'Virginia', '53': 'Washington', '54': 'West Virginia', '55': 'Wisconsin', '56': 'Wyoming' };

async function table(id) { // {state name: {column: value}} for the 51 state rows
  const res = await fetch(BASE + id + '.dat', { headers: { 'User-Agent': 'ElectionTracker/1.0 (personal project)' } });
  if (!res.ok) throw new Error(`${res.status} ${id}`);
  const [head, ...lines] = (await res.text()).trim().split('\n'), h = head.split('|'), out = {};
  for (const l of lines) { const c = l.split('|'), st = FIPS[c[0].match(/^0400000US(\d\d)$/)?.[1]]; if (st) out[st] = Object.fromEntries(h.map((k, i) => [k, +c[i]])); }
  if (Object.keys(out).length !== 51) throw new Error(`${id}: ${Object.keys(out).length} states`);
  return out;
}

async function main() {
  const age = await table('b29001'); // citizen voting-age population by age
  const cit = (t, T) => ({ Male: t[`${T}_E009`] + t[`${T}_E011`], Female: t[`${T}_E020`] + t[`${T}_E022`] }); // 18+ native + naturalized
  const RACE = { H: 'White (not Hispanic)', B: 'Black', I: 'Hispanic (any race)', D: 'Asian', C: 'American Indian', E: 'Pacific Islander', G: 'Two or more', F: 'Other' };
  const sexT = await table('b05003'), races = {};
  for (const k of Object.keys(RACE)) races[k] = await table('b05003' + k.toLowerCase());
  const out = {};
  for (const st of Object.values(FIPS)) {
    const a = age[st], total = a.B29001_E001, s = cit(sexT[st], 'B05003');
    const ages = { '18–29': a.B29001_E002, '30–44': a.B29001_E003, '45–64': a.B29001_E004, '65+': a.B29001_E005 };
    const sum = o => Object.values(o).reduce((x, y) => x + y, 0);
    if (sum(ages) !== total) throw new Error(`${st}: age bands ${sum(ages)} ≠ total ${total}`);
    if (sum(s) !== total) throw new Error(`${st}: sexes ${sum(s)} ≠ total ${total}`); // two tables from the same survey must agree
    out[st] = { total, age: ages, sex: s, race: Object.fromEntries(Object.entries(RACE).map(([k, name]) => [name, sum(cit(races[k][st], 'B05003' + k))])) };
  }
  fs.writeFileSync(path.join(__dirname, 'eligible-data.js'), `// Built by eligible.js on ${new Date().toISOString()} from ACS 2020–2024 5-year tables B29001 and B05003, B05003B–I.\nwindow.ELIGIBLE = ${JSON.stringify(out)};\n`);
  console.log(`51 states; US citizens 18+: ${Object.values(out).reduce((x, o) => x + o.total, 0).toLocaleString()}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
