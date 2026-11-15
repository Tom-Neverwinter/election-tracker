// Writes badges/*.json for shields.io endpoint badges in README.md (https://shields.io/badges/endpoint-badge).
// Run by hourly.js after the data steps; also runnable alone: node badges.js. Counts follow the page's rules (index.html).
const fs = require('fs'), path = require('path');
global.window = {};
for (const f of ['results-data.js', 'measures.js', 'measures-results-data.js', 'certification.js', 'state-demo-data.js']) try { require('./' + f); } catch {}
const R = window.RESULTS ?? { races: [] }, dir = path.join(__dirname, 'badges');
const NOT_UP = { G: { D: 6, R: 8 }, S: { D: 34, R: 31 }, H: { D: 0, R: 0 } }; // same as the page: seats not on the 2026 ballot
const party = p => /^dem/i.test(p) ? 'D' : /^rep/i.test(p) ? 'R' : p ? 'O' : null;
const D_BLUE = '1c4e8f', R_RED = 'a02626', GREY = '555';

function chamber(code, label, need) { // called seats, including those not up this year
  const rows = R.races.filter(r => r.office === code), c = { ...NOT_UP[code] }, total = c.D + c.R + rows.length;
  for (const r of rows) if (r.called) { const p = party(r.winnerParty); c[p] = (c[p] ?? 0) + 1; }
  const left = total - c.D - c.R - (c.O ?? 0);
  return { label, message: `D ${c.D} · R ${c.R}${c.O ? ` · O ${c.O}` : ''}${left ? ` · ${left} uncalled` : ''}`, color: c.D >= need ? D_BLUE : c.R >= need ? R_RED : GREY };
}

function votesCounted() { // highest office per state: its biggest statewide race, or all its House races together
  const by = {}; for (const r of R.races) (by[r.state] ??= []).push(r);
  let n = 0; for (const rs of Object.values(by)) n += Math.max(0, ...rs.filter(r => r.district == null).map(r => r.votes ?? 0), rs.filter(r => r.office === 'H').reduce((a, r) => a + (r.votes ?? 0), 0));
  return n;
}

const M = window.MEASURES ?? [], MR = window.MEASURES_RESULTS ?? {}, C = Object.values(window.CERT ?? {});
const decided = M.filter(m => MR[`${m.state}|${m.name}`]).length, certified = C.filter(c => c.certified).length, official = C.filter(c => !c.certified && c.official).length;
const badges = {
  senate: chamber('S', 'Senate', 51),
  house: chamber('H', 'House', 218),
  governors: chamber('G', 'governors', 26),
  votes: { label: 'votes counted', message: `${(votesCounted() / 1e6).toFixed(1)}M`, color: '2f9e44' },
  measures: { label: 'ballot measures', message: `${decided} of ${M.length} decided`, color: decided === M.length ? '2f9e44' : 'e6bb5c' },
  certified: { label: 'states certified', message: `${certified} of ${C.length}${official ? ` · ${official} official` : ''}`, color: certified === C.length ? '2f9e44' : 'e6bb5c' },
  whovoted: { label: 'who voted', message: `${Object.keys(window.STATE_DEMO ?? {}).length} states with demographics`, color: '2f9e44' },
};
fs.mkdirSync(dir, { recursive: true });
for (const [name, b] of Object.entries(badges)) fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ schemaVersion: 1, ...b }) + '\n');
console.log(Object.entries(badges).map(([k, b]) => `${k}: ${b.message}`).join(' | '));
