// Election-night results from NBC News (AP data). Run: node results.js && git commit -am results && git push
// NBC's results API has no CORS headers, so the page can't fetch it directly; this writes results-data.js for the page instead.
// ponytail: one full pass per run (~2.7 MB per state); rerun by hand as often as you like.
const fs = require('fs'), path = require('path');
const DAY = process.env.DAY || '2026-11-03'; // DAY=2026-03-17 replays the primaries, for testing
const STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];
const slug = s => s.toLowerCase().replace(/ /g, '-');

function collect(o, out, seen = new Set()) { // every race object anywhere in the payload, deduped by id
  if (!o || typeof o !== 'object') return out;
  if (o.race_id && Array.isArray(o.candidates) && !seen.has(o.race_id)) { seen.add(o.race_id); out.push(o); }
  for (const v of Object.values(o)) collect(v, out, seen);
  return out;
}

function race(r, state) {
  const cands = r.candidates.map(c => ({ name: c.candidate_name || [c.given_name, c.family_name].filter(Boolean).join(' '), party: c.major_party || '', abbr: c.abbreviation, votes: +c.vote || 0, pct: +c.percent || 0 }))
    .sort((a, b) => b.votes - a.votes);
  const called = !!(r.call_at && r.call_lead);
  const win = called ? cands.find(c => c.abbr === r.call_lead || c.name.endsWith(' ' + r.call_lead)) : null;
  cands.forEach(c => delete c.abbr);
  return { id: r.race_id, state, office: r.office_code, district: r.jtype === 'SW' ? null : r.jcode ?? null, name: r.office_name || r.race_name,
    pctIn: r.estimate_vote_percent ?? r.percent_in ?? null, votes: +r.total_vote || 0, called, winner: win?.name ?? null, winnerParty: win?.party ?? null, cands: cands.slice(0, 4) };
}

// General-election pages use a different shape: stateRaceResults.{discreteOffices (S, G), house, ballotProps}.
const PARTY = { dem: 'Democratic', gop: 'Republican' };
function general(r, state, office) {
  const cands = r.candidates.map(c => ({ name: c.name, party: PARTY[c.party] ?? c.party ?? '', votes: +c.votes || 0, pct: +c.percentVote || 0, won: !!c.isWinner }))
    .sort((a, b) => b.votes - a.votes);
  const win = cands.find(c => c.won);
  cands.forEach(c => delete c.won);
  return { id: r.raceId ?? `${state}~${office}~${r.district ?? r.name}`, state, office, district: office === 'H' ? r.district ?? 0 : null, name: r.officeName || r.headlineText || r.name,
    pctIn: r.percentIn ?? null, votes: +r.votes || 0, called: !!win, winner: win?.name ?? null, winnerParty: win?.party ?? null, cands: cands.slice(0, 4) };
}
const fromGeneral = (s, name) => !s ? [] : [
  ...(s.discreteOffices ?? []).map(r => general(r, name, r.officeCode)),
  ...(s.house ?? []).map(r => general(r, name, 'H')),
  ...(s.ballotProps ?? []).map(r => general(r, name, r.officeCode || 'I')),
];

async function state(name) {
  const url = `https://www.nbcnews.com/firecracker/api/v2/state-results/2026-elections/${slug(name)}-results`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (ElectionTracker personal project)' } });
  if (!res.ok) throw new Error(`${res.status} ${name}`);
  const j = await res.json();
  const old = collect(j, []).filter(r => String(r.election_date) === DAY).map(r => race(r, name));
  return old.length ? old : fromGeneral(j.stateRaceResults, name);
}

async function main() {
  const races = [], failed = [];
  for (let i = 0; i < STATES.length; i += 6) // 6 states at a time
    for (const [k, p] of (await Promise.allSettled(STATES.slice(i, i + 6).map(state))).entries())
      p.status === 'fulfilled' ? races.push(...p.value) : failed.push(STATES[i + k]);
  const out = { updated: new Date().toISOString(), day: DAY, races, failed };
  fs.writeFileSync(path.join(__dirname, 'results-data.js'), 'window.RESULTS = ' + JSON.stringify(out) + ';\n');
  const n = o => races.filter(r => r.office === o), c = o => n(o).filter(r => r.called).length;
  console.log(`${races.length} races (${c('S')}/${n('S').length} Senate, ${c('G')}/${n('G').length} Governor, ${c('H')}/${n('H').length} House called)${failed.length ? '; failed: ' + failed.join(', ') : ''}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { collect, race };
