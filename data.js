// Fetches all live data. Classic script (not a module) so the page still works from file://, and snapshot.js can require() it.
const PAGES = { governor: '2026_United_States_gubernatorial_elections', senate: '2026_United_States_Senate_elections' };
const LEVEL = { safe: 3, solid: 3, likely: 2, lean: 1, tilt: 0.5, tossup: 0 };
const SIGN = { D: 1, R: -1, I: 1 }; // ponytail: independents count as anti-R; fine for 2026 (Osborn etc.), revisit if an I runs against a D
const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); });
const wiki = p => get('https://en.wikipedia.org/w/api.php?format=json&origin=*&' + new URLSearchParams(p));
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

function ratingScore(level, party) {
  const l = level.trim().toLowerCase().replace(/[- ]/g, '');
  if (!(l in LEVEL)) return null;
  return LEVEL[l] === 0 ? 0 : LEVEL[l] * (SIGN[party.trim().toUpperCase()] ?? 0);
}

// Each rating cell is preceded by an editor comment naming its rater, e.g. <!--Cook--> | {{USRaceRating|Lean|D}}
function parseTable(text) {
  let t = text.slice(text.indexOf('{|')); t = t.slice(0, t.indexOf('\n|}'));
  const rows = []; let names = [];
  for (const c of t.split('\n|-')) {
    const ratings = [...c.matchAll(/<!--\s*([^>]+?)\s*-->\s*\|\s*\{\{USRaceRating\|([^|}]*)\|?([^|}]*)/g)];
    const m = c.trim().match(/^!\s*\[\[[^|\]]*\|([^\]]+)\]\](.*)/m);
    if (!ratings.length || !m) continue;
    const inc = c.split('\n').find(l => l.startsWith('|') && l.includes('Party shading')) ?? '';
    const name = inc.match(/\{\{sortname\|([^|}]+)\|([^|}]+)/) ?? inc.match(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/);
    const party = inc.match(/Party shading\/(\w+)/), pvi = c.match(/Shading PVI\|(\w)\|(\d+)/), note = inc.match(/\{\{[Ss]mall\|\(([^)]+)\)\}\}/);
    const special = m[2].includes('special');
    rows.push({
      state: m[1].trim(), label: m[1].trim() + (special ? ' (special)' : ''),
      incumbent: name ? name.slice(1).filter(Boolean).join(' ') : '', incParty: party ? party[1][0] : '',
      note: note ? note[1] : special ? 'special' : '', pvi: pvi ? `${pvi[1]}+${pvi[2]}` : 'EVEN',
      ratings: ratings.map(r => [r[2], r[3]]),
    });
    if (ratings.length > names.length) names = ratings.map(r => r[1]);
  }
  return [names, rows];
}

async function polymarket(title) { // exact-title active event → party odds + leader
  try {
    const q = new URLSearchParams({ q: title, limit_per_type: 25, events_status: 'active' });
    const ev = ((await get('https://gamma-api.polymarket.com/public-search?' + q)).events ?? []).find(e => e.title.toLowerCase() === title.toLowerCase());
    if (!ev) return null;
    const odds = [], party = {};
    for (const mk of ev.markets ?? []) {
      if (mk.closed || !mk.outcomePrices) continue;
      const p = +JSON.parse(mk.outcomePrices)[0], name = mk.groupItemTitle || mk.question, text = name + ' ' + mk.question;
      odds.push([p, name]);
      for (const [tag, words] of [['D', ['(D)', 'Democrat']], ['R', ['(R)', 'Republican']], ['I', ['(I)', 'Independent']]])
        if (words.some(w => text.includes(w))) party[tag] = (party[tag] ?? 0) + p;
    }
    if (!odds.length) return null;
    const [p, leader] = odds.reduce((a, b) => b[0] > a[0] ? b : a);
    const out = { leader, leaderP: round(p, 3), url: 'https://polymarket.com/event/' + ev.slug, volume: Math.round(+ev.volume || 0) };
    const d = (party.D ?? 0) + (party.I ?? 0), r = party.R ?? 0;
    if (d + r > 0) out.pD = round(d / (d + r), 3);
    return out;
  } catch { return null; }
}

const marketScore = p => Math.max(-3, Math.min(3, (p - 0.5) * 6.6)); // ponytail: linear, 50%→tossup, ~95%→safe

async function build(office) {
  const page = PAGES[office];
  const idx = (await wiki({ action: 'parse', page, prop: 'sections' })).parse.sections.find(s => s.line.trim().toLowerCase() === 'predictions').index;
  const text = (await wiki({ action: 'parse', page, prop: 'wikitext', section: idx })).parse.wikitext['*'];
  const [names, rows] = parseTable(text);
  const word = office === 'governor' ? 'Governor' : 'Senate';
  const markets = await Promise.all(rows.map(r => polymarket(`${r.state} ${word} Election Winner`)));
  rows.forEach((r, i) => {
    r.sources = names.map((n, j) => r.ratings[j] && { name: n, rating: r.ratings[j].join(' ').trim(), score: ratingScore(...r.ratings[j]) }).filter(Boolean);
    delete r.ratings;
    const scores = r.sources.map(s => s.score).filter(s => s != null);
    r.market = markets[i];
    if (r.market?.pD != null) scores.push(marketScore(r.market.pD));
    r.score = scores.length ? round(mean(scores)) : null;
    r.spread = scores.length > 1 ? round(Math.sqrt(mean(scores.map(s => (s - mean(scores)) ** 2)))) : 0;
  });
  return { raters: names, races: rows, wiki: 'https://en.wikipedia.org/wiki/' + page };
}

async function control(slug) {
  try {
    const ev = (await get('https://gamma-api.polymarket.com/events?slug=' + slug))[0];
    return Object.fromEntries(ev.markets.filter(m => m.outcomePrices && !m.closed).map(m => [m.groupItemTitle || m.question, round(+JSON.parse(m.outcomePrices)[0], 3)]));
  } catch { return {}; }
}

// [population July 2025 (Census Vintage 2025), citizens 18+ (Census CVAP, ACS 2020-2024)]. Static: these don't move before Election Day.
const POP = {"Alabama":[5193088,3845696],"Alaska":[737270,538813],"Arizona":[7623818,5324115],"Arkansas":[3114791,2245940],"California":[39355309,26132799],"Colorado":[6012561,4355173],"Connecticut":[3688496,2663362],"Delaware":[1059952,764113],"District of Columbia":[693645,506632],"Florida":[23462518,16182912],"Georgia":[11302748,7834503],"Hawaii":[1432820,1054556],"Idaho":[2029733,1411149],"Illinois":[12719141,9094987],"Indiana":[6973333,5030938],"Iowa":[3238387,2381746],"Kansas":[2977220,2134491],"Kentucky":[4606864,3401787],"Louisiana":[4618189,3413948],"Maine":[1414874,1114201],"Maryland":[6265347,4418305],"Massachusetts":[7154084,5155255],"Michigan":[10127884,7653711],"Minnesota":[5830405,4247053],"Mississippi":[2954160,2221761],"Missouri":[6270541,4685988],"Montana":[1144694,871202],"Nebraska":[2018006,1413882],"Nevada":[3282188,2223535],"New Hampshire":[1415342,1109601],"New Jersey":[9548215,6433712],"New Mexico":[2125498,1553239],"New York":[20002427,14104696],"North Carolina":[11197968,7898161],"North Dakota":[799358,581737],"Ohio":[11900510,8956209],"Oklahoma":[4123288,2923605],"Oregon":[4273586,3211655],"Pennsylvania":[13059432,9961815],"Rhode Island":[1114521,826623],"South Carolina":[5570274,4009585],"South Dakota":[935094,669733],"Tennessee":[7315076,5275348],"Texas":[31709821,19865984],"Utah":[3538904,2291434],"Vermont":[644663,521797],"Virginia":[8880107,6378483],"Washington":[8001020,5583139],"West Virginia":[1766147,1409278],"Wisconsin":[5972787,4505014],"Wyoming":[588753,440292]};

// ponytail: hand-entered from news/state reports, update by hand. Used only while higher than the feed, so a feed that catches up wins.
const NBC = st => `https://www.nbcnews.com/politics/2026-elections/${st}-results`;
const MANUAL = [
  { state_po: 'MA', state_name: 'Massachusetts', date: '2026-11-02', cast: 1070364, requested: 1337457, returned: null, inperson: null, turnout22: 2511461, source: NBC('massachusetts'), note: 'NBC/TargetSmart; state said about 700,000 mail and 286,000 in person as of Oct 29' },
  { state_po: 'DC', state_name: 'District of Columbia', date: '2026-11-02', cast: 111150, requested: 453471, returned: null, inperson: null, turnout22: 205774, source: NBC('district-of-columbia'), note: 'NBC/TargetSmart' },
  { state_po: 'NH', state_name: 'New Hampshire', date: '2026-11-02', cast: 41325, requested: 48142, returned: null, inperson: null, turnout22: 615000, source: NBC('new-hampshire'), note: 'NBC/TargetSmart; absentee only, 2022 vote is approximate' },
  { state_po: 'CT', state_name: 'Connecticut', date: '2026-11-01', cast: 505973, requested: 71658, returned: 50804, inperson: 455169, source: 'https://portal.ct.gov/sots/press-releases/2026-press-releases/early-voting-and-absentee-ballot-totals-as-of-november-1', note: 'CT Secretary of the State, unofficial, final day of early voting; the feed showed far fewer' },
  { state_po: 'MD', state_name: 'Maryland', date: '2026-11-02', cast: 993206, requested: 658748, inperson: null, source: NBC('maryland'), note: 'NBC/TargetSmart; feed had mail only' },
  { state_po: 'MI', state_name: 'Michigan', date: '2026-11-02', cast: 2313165, requested: 2174646, inperson: null, source: NBC('michigan'), note: 'NBC/TargetSmart; state dashboard showed 2,021,127 on Oct 31' },
  { state_po: 'NY', state_name: 'New York', date: '2026-11-02', cast: 2160716, returned: null, source: NBC('new-york'), note: 'NBC/TargetSmart; feed had in-person only' },
  { state_po: 'TX', state_name: 'Texas', date: '2026-11-02', cast: 7718734, returned: 259793, inperson: 7458941, source: 'https://www.callthemap.com/early-vote/texas', note: 'Secretary of State county file via Call the Map, through Oct 30; Texas Tribune reports more than 7.7 million' },
  { state_po: 'GA', state_name: 'Georgia', date: '2026-11-02', cast: 2832554, returned: null, inperson: null, source: NBC('georgia'), note: 'NBC/TargetSmart; AJC and others reported 2,810,170 when early voting closed Oct 30; feed stopped at Oct 29' },
  { state_po: 'NJ', state_name: 'New Jersey', date: '2026-11-02', cast: 1222263, returned: null, inperson: null, source: NBC('new-jersey'), note: 'NBC/TargetSmart; feed stopped at Oct 29' },
  { state_po: 'MN', state_name: 'Minnesota', date: '2026-11-02', cast: 886427, returned: null, inperson: null, source: NBC('minnesota'), note: 'NBC/TargetSmart; feed stopped at Oct 29' },
  { state_po: 'IN', state_name: 'Indiana', date: '2026-11-02', cast: 804304, returned: null, inperson: null, source: NBC('indiana'), note: 'NBC/TargetSmart; feed stopped at Oct 29' },
  { state_po: 'OK', state_name: 'Oklahoma', date: '2026-10-31', cast: 229157, returned: 42669, inperson: 186488, source: 'https://www.callthemap.com/early-vote/oklahoma', note: 'State Election Board figures via Call the Map, not read from the board directly; some counties lag; feed had mail only' },
  // 2026-11-02: NBC/TargetSmart was ahead of a feed that stopped Oct 26-31 (IL: feed current but lower). Left on the feed: OR, WI, WY (feed higher), KY, TN (equal), ME (NBC page wouldn't load).
  { state_po: 'IL', state_name: 'Illinois', date: '2026-11-02', cast: 1579728, requested: 1188674, returned: null, inperson: null, source: NBC('illinois'), note: 'NBC/TargetSmart; feed lower (1,394,420)' },
  { state_po: 'AR', state_name: 'Arkansas', date: '2026-11-02', cast: 551032, returned: null, inperson: null, source: NBC('arkansas'), note: 'NBC/TargetSmart; feed stopped at Oct 31' },
  { state_po: 'HI', state_name: 'Hawaii', date: '2026-11-02', cast: 249140, returned: null, inperson: null, source: NBC('hawaii'), note: 'NBC/TargetSmart; feed stopped at Oct 31' },
  { state_po: 'IA', state_name: 'Iowa', date: '2026-11-02', cast: 464216, requested: 482855, returned: null, inperson: null, source: NBC('iowa'), note: 'NBC/TargetSmart; feed stopped at Oct 31' },
  { state_po: 'ID', state_name: 'Idaho', date: '2026-11-02', cast: 263257, requested: 156888, returned: null, inperson: null, source: NBC('idaho'), note: 'NBC/TargetSmart; feed stopped at Oct 30' },
  { state_po: 'KS', state_name: 'Kansas', date: '2026-11-02', cast: 470170, requested: 108022, returned: null, inperson: null, source: NBC('kansas'), note: 'NBC/TargetSmart; feed stopped at Oct 31' },
  { state_po: 'MS', state_name: 'Mississippi', date: '2026-11-02', cast: 116453, requested: 123040, returned: null, inperson: null, source: NBC('mississippi'), note: 'NBC/TargetSmart; feed stopped at Oct 26' },
  { state_po: 'NE', state_name: 'Nebraska', date: '2026-11-02', cast: 251919, requested: 290190, returned: null, inperson: null, source: NBC('nebraska'), note: 'NBC/TargetSmart; feed stopped at Oct 30' },
  { state_po: 'NM', state_name: 'New Mexico', date: '2026-11-02', cast: 456726, requested: 90420, returned: null, inperson: null, source: NBC('new-mexico'), note: 'NBC/TargetSmart; feed stopped at Oct 30' },
  { state_po: 'NV', state_name: 'Nevada', date: '2026-11-02', cast: 752788, returned: null, inperson: null, source: NBC('nevada'), note: 'NBC/TargetSmart; feed stopped at Oct 31' },
  { state_po: 'RI', state_name: 'Rhode Island', date: '2026-11-02', cast: 127224, requested: 33437, returned: null, inperson: null, source: NBC('rhode-island'), note: 'NBC/TargetSmart; feed stopped at Oct 30' },
  { state_po: 'SC', state_name: 'South Carolina', date: '2026-11-02', cast: 1084542, requested: 48712, returned: null, inperson: null, source: NBC('south-carolina'), note: 'NBC/TargetSmart; feed stopped at Oct 30' },
  { state_po: 'SD', state_name: 'South Dakota', date: '2026-11-02', cast: 77795, requested: 83453, returned: null, inperson: null, source: NBC('south-dakota'), note: 'NBC/TargetSmart; feed stopped at Oct 31' },
  { state_po: 'WA', state_name: 'Washington', date: '2026-11-02', cast: 1834247, returned: null, inperson: null, source: NBC('washington'), note: 'NBC/TargetSmart; feed stopped at Oct 30' },
  { state_po: 'WV', state_name: 'West Virginia', date: '2026-11-02', cast: 169350, requested: 9735, returned: null, inperson: null, source: NBC('west-virginia'), note: 'NBC/TargetSmart; feed stopped at Oct 29' },
];
// Counts that look wrong but have no confirmed replacement: shown as reported, with a warning.
const FLAGS = {
  MO: 'Likely undercount: this count stopped at Oct 24, though no-excuse voting runs through Nov 2. Jackson, Clay and Platte counties alone reported about 39,000 by Oct 27-30. No statewide count found.',
};

async function earlyVote() { // whoshowsup.net's data file (civicAPI, state election offices); file name is content-hashed
  try {
    const html = await fetch('https://whoshowsup.net/early-vote').then(r => r.text());
    const ev = await get('https://whoshowsup.net' + html.match(/\/_file\/data\/early_vote[\w.]*\.json/)[0]);
    const dates = [...new Set(ev.series.map(r => r.date))].sort(), by = {};
    for (const r of ev.series) (by[r.state_po] ??= {})[r.date] = r.cast;
    for (const s of ev.states) s.series = dates.map(d => by[s.state_po]?.[d] ?? 0);
    for (const m of MANUAL) {
      const s = ev.states.find(x => x.state_po === m.state_po);
      if (!s) ev.states.push({ ...m, series: null, feedCast: 0 });
      else if (m.cast > s.cast) Object.assign(s, { feedCast: s.cast }, m, { dem: null, rep: null, other: null }); // feed's party split doesn't describe the hand-entered total
    }
    for (const s of ev.states) if (FLAGS[s.state_po] && !s.note) s.flag = FLAGS[s.state_po];
    return { asOf: ev.as_of, dates, states: ev.states, source: 'https://whoshowsup.net/early-vote' };
  } catch (e) { console.warn('early vote unavailable', e); return null; }
}

async function loadData() {
  const [governor, senate, early, sen, house] = await Promise.all([build('governor'), build('senate'), earlyVote(),
    control('which-party-will-win-the-senate-in-2026'), control('which-party-will-win-the-house-in-2026')]);
  return { governor, senate, early, control: { Senate: sen, House: house }, updated: new Date().toISOString() };
}

if (typeof module !== 'undefined') module.exports = { loadData };
