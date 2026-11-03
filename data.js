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
    return eventOdds(((await get('https://gamma-api.polymarket.com/public-search?' + q)).events ?? []).find(e => e.title.toLowerCase() === title.toLowerCase()));
  } catch { return null; }
}

function eventOdds(ev) {
  if (!ev) return null;
    const odds = [], party = {};
    for (const mk of ev.markets ?? []) {
      if (mk.closed || mk.active === false || !mk.outcomePrices) continue; // inactive = placeholder ("Person A") slots
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
}

// House 2026: ratings page lists only competitive seats; every other district is Safe for the side its 2026 PVI leans (mid-decade maps make the incumbent's party unreliable).
const ABBR = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };
async function houseForecast() {
  const text = async page => (await wiki({ action: 'parse', page, prop: 'wikitext', formatversion: 2 })).parse.wikitext;
  const [all, rated] = await Promise.all([text('2026_United_States_House_of_Representatives_elections'), text('2026_United_States_House_of_Representatives_election_ratings')]);
  const dist = b => { const m = b.match(/^!(?:[^|{\n]*\|)?\s*\{\{ushr\|(\w\w)\|(\w+)/); return m && [m[1], m[2] === 'AL' ? 'AL' : String(+m[2])]; }; // "!rowspan=2 |{{ushr..." too
  const blocks = t => t.split(/\n(?:\|-[^\n]*\n)+/).filter(b => dist(b)); // tables sometimes repeat the row separator
  const head = rated.slice(rated.indexOf('{|'), rated.search(/\n\|-[^\n]*\n!\{\{ushr/));
  const raters = [...head.matchAll(/^!\s*\[\[[^\]|]*\|([^\]]+)\]\]/gm)].map(m => m[1].trim());
  const ratings = {};
  for (const b of blocks(rated)) ratings[dist(b).join('-')] = [...b.matchAll(/\{\{USRaceRating\|([^|}]*)\|?([^|}]*)/g)].map(m => [m[1], m[2]]);
  const races = [];
  for (const b of blocks(all.slice(all.search(/\n==\s*Alabama\s*==/)))) { // per-state sections only; earlier tables (retirements, redistricting) list districts too
    const [st, n] = dist(b), key = st + '-' + n;
    if (!ABBR[st] || races.some(r => r.label === key)) continue;
    const pvi = b.match(/[Ss]hading PVI\|(\w)\|(\d+)/), name = b.match(/\{\{sortname\|([^|}]+)\|([^|}]+)/);
    const party = (b.match(/^\|[^\n]*\|\s*(Republican|Democratic|Independent)\s*$/m) ?? [])[1];
    const rs = ratings[key] ?? [], r = rs.length ? raters.slice(-rs.length) : [];
    const sources = rs.map((x, i) => ({ name: r[i], rating: x.join(' ').trim(), score: ratingScore(...x) }));
    const scores = sources.map(s => s.score).filter(s => s != null);
    const lean = pvi ? (pvi[1] === 'D' ? 3 : -3) : party === 'Democratic' ? 3 : -3;
    races.push({ state: ABBR[st], label: key, incumbent: name ? name.slice(1).join(' ') : 'Open/new seat', incParty: party?.[0] ?? '', note: rs.length ? '' : 'not rated competitive',
      pvi: pvi ? `${pvi[1]}+${pvi[2]}` : 'EVEN', sources, market: null,
      score: scores.length ? round(mean(scores)) : lean, spread: scores.length > 1 ? round(Math.sqrt(mean(scores.map(s => (s - mean(scores)) ** 2)))) : 0 });
  }
  if (races.length < 400) throw new Error(`House forecast parsed only ${races.length} districts`);
  return { raters, races, wiki: 'https://en.wikipedia.org/wiki/2026_United_States_House_of_Representatives_election_ratings' };
}

// 2028: no forecaster ratings exist yet, so each state is its Polymarket market alone. EVs per the 2020 census (used 2024-2028).
const ELECTORS = {"Alabama":9,"Alaska":3,"Arizona":11,"Arkansas":6,"California":54,"Colorado":10,"Connecticut":7,"Delaware":3,"District of Columbia":3,"Florida":30,"Georgia":16,"Hawaii":4,"Idaho":4,"Illinois":19,"Indiana":11,"Iowa":6,"Kansas":6,"Kentucky":8,"Louisiana":8,"Maine":4,"Maryland":10,"Massachusetts":11,"Michigan":15,"Minnesota":10,"Mississippi":6,"Missouri":10,"Montana":4,"Nebraska":5,"Nevada":6,"New Hampshire":4,"New Jersey":14,"New Mexico":5,"New York":28,"North Carolina":16,"North Dakota":3,"Ohio":17,"Oklahoma":7,"Oregon":8,"Pennsylvania":19,"Rhode Island":4,"South Carolina":9,"South Dakota":3,"Tennessee":11,"Texas":40,"Utah":6,"Vermont":3,"Virginia":13,"Washington":12,"West Virginia":4,"Wisconsin":10,"Wyoming":3};
async function president() { // ponytail: Maine/Nebraska district electors folded into the statewide winner
  const ev = slug => get('https://gamma-api.polymarket.com/events?slug=' + slug).then(r => eventOdds(r[0])).catch(() => null);
  const states = Object.keys(ELECTORS);
  const markets = await Promise.all(states.map(s => ev(`2028-presidential-election-${s.toLowerCase().replace(/ /g, '-')}-winner`)));
  const races = states.map((state, i) => ({ state, label: state, ev: ELECTORS[state], incumbent: '', incParty: '', note: '', pvi: '', sources: [], spread: 0,
    market: markets[i], score: markets[i]?.pD != null ? round(marketScore(markets[i].pD)) : null }));
  const [party, dem, rep, winner] = await Promise.all(['which-party-wins-2028-us-presidential-election', 'democratic-presidential-nominee-2028', 'republican-presidential-nominee-2028', 'presidential-election-winner-2028'].map(control));
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { raters: [], races, party, dem: top(dem), rep: top(rep), winner: top(winner), wiki: 'https://en.wikipedia.org/wiki/2028_United_States_presidential_election' };
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
  { state_po: 'RI', state_name: 'Rhode Island', date: '2026-11-02', cast: 137138, requested: 33437, returned: 25237, inperson: 111901, source: 'https://rhodeislandcurrent.com/2026/11/02/on-election-day-eve-ri-surpasses-17-voter-turnout-with-record-early-voting-numbers/', note: 'Rhode Island Current: final early in-person plus mail received; feed stopped at Oct 30' },
  { state_po: 'SC', state_name: 'South Carolina', date: '2026-11-02', cast: 1084542, requested: 48712, returned: null, inperson: null, source: NBC('south-carolina'), note: 'NBC/TargetSmart; feed stopped at Oct 30' },
  { state_po: 'SD', state_name: 'South Dakota', date: '2026-10-30', cast: 78778, requested: 82274, returned: null, inperson: null, source: 'https://sdsos.gov/elections-voting/upcoming-elections/general-information/2026-Election-Absentee-Data.aspx', note: 'SD Secretary of State weekly absentee report (includes in-person absentee); feed stopped at Oct 31' },
  { state_po: 'WA', state_name: 'Washington', date: '2026-11-02', cast: 1834247, returned: null, inperson: null, source: NBC('washington'), note: 'NBC/TargetSmart; feed stopped at Oct 30' },
  { state_po: 'WV', state_name: 'West Virginia', date: '2026-11-02', cast: 169350, requested: 9735, returned: null, inperson: null, source: NBC('west-virginia'), note: 'NBC/TargetSmart; feed stopped at Oct 29' },
  // 2026-11-02 night: NBC loaded for ME; CA and LA feeds current but well behind NBC.
  { state_po: 'ME', state_name: 'Maine', date: '2026-11-02', cast: 302409, requested: 322811, returned: null, inperson: null, source: NBC('maine'), note: 'NBC/TargetSmart; feed stopped at Oct 30' },
  { state_po: 'CA', state_name: 'California', date: '2026-11-01', cast: 6406161, returned: 6107024, inperson: 299137, source: 'https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/bsr-statistics-11-01-26.pdf', note: 'CA Secretary of State ballot report, Nov 1; feed lower (5,965,896)' },
  { state_po: 'LA', state_name: 'Louisiana', date: '2026-11-02', cast: 579714, returned: null, inperson: null, source: NBC('louisiana'), note: 'NBC/TargetSmart; feed lower (530,514)' },
];
// Counts that look wrong but have no confirmed replacement: shown as reported, with a warning.
const FLAGS = {
  MO: 'Likely undercount: this count stopped at Oct 24, though no-excuse voting runs through Nov 2. Jackson, Clay and Platte counties alone reported about 39,000 by Oct 27-30. No statewide count found.',
};

// Dated statewide totals from news reports and state press releases: [as-of date, ballots cast, source, note]. Fills in trend lines the feed lacks.
// Compiled 2026-11-02 by research agents; rounded "more than" figures are lower bounds, so they can only understate.
const BACKFILL = {
  MA: [["2026-10-28",903279,"https://www.wamc.org/news/2026-10-29/early-voter-turnout-2026-elections-midterms-albany-new-york-massachusetts-vermont","'voted early' as of Wed evening per preliminary state numbers; mail+in-person split not given (mail alone was >733k by Oct 30, so it must include mail). Other MA reports give only 'more than' figures (>170k mail returned Oct 15; >1.1M Nov 2 morning)"]],
  DC: [["2026-11-02",111150,"https://www.nbcnews.com/politics/2026-elections/district-of-columbia-results","mail-in + early in-person; NBC News/TargetSmart, page section updated Nov 2 (not DCBOE). WTOP Nov 2 said 'more than 98,000'"]],
  CT: [["2026-10-19",65411,"https://portal.ct.gov/sots/press-releases/2026-press-releases/early-voting-and-absentee-ballot-totals-as-of-october-19","SOTS: 42,241 early in-person + 23,170 absentee returned"],["2026-10-20",105534,"https://portal.ct.gov/sots/press-releases/2026-press-releases/early-voting-and-absentee-ballot-totals-as-of-october-20","SOTS: 80,076 EIP + 25,458 absentee"],["2026-10-22",172354,"https://portal.ct.gov/sots/press-releases/2026-press-releases/early-voting-and-absentee-ballot-totals-as-of-october-22","SOTS: 141,991 EIP + 30,363 absentee"],["2026-10-24",220859,"https://portal.ct.gov/sots/press-releases/2026-press-releases/early-voting-and-absentee-ballot-totals-as-of-october-24","SOTS: 188,256 EIP + 32,603 absentee"],["2026-10-26",270114,"https://portal.ct.gov/sots/press-releases/2026-press-releases/early-voting-and-absentee-ballot-totals-as-of-october-26","SOTS: 231,577 EIP + 38,537 absentee"],["2026-10-28",349546,"https://portal.ct.gov/sots/press-releases/2026-press-releases/early-voting-and-absentee-ballot-totals-as-of-october-28","SOTS: 305,032 EIP + 44,514 absentee"],["2026-10-30",438451,"https://portal.ct.gov/sots/press-releases/2026-press-releases/early-voting-and-absentee-ballot-totals-as-of-october-30","SOTS: 388,342 EIP + 50,109 absentee"],["2026-11-01",505973,"https://portal.ct.gov/sots/press-releases/2026-press-releases/early-voting-and-absentee-ballot-totals-as-of-november-1","SOTS: 455,169 EIP (final, EV ended Nov 1) + 50,804 absentee"]],
  MD: [["2026-10-25",538382,"https://thedailyrecord.com/2026/10/28/early-voting-surges-in-maryland-with-67-percent-increase/","305,690 mail returned as of Sun Oct 25 (Daily Record) + 232,692 early in-person = sum of SBE days 1-4 (Oct 22-25) from https://elections.maryland.gov/press_room/2026_stats/GG26/EarlyVoting_by_County.pdf"],["2026-11-01",993206,"https://elections.maryland.gov/press_room/2026_stats/GG26/Absentees_Sent_and_Returned_by_County.pdf","SBE: 388,810 mail received as of Nov 1 6PM + 604,396 early in-person final (Oct 22-29, EarlyVoting_by_County.pdf)"]],
  MI: [["2026-10-06",201909,"https://content.govdelivery.com/accounts/MISOS/bulletins/42e2d69","SOS 7am: absentee returned only (EIP not yet open)"],["2026-10-13",440677,"https://www.michigan.gov/sos/resources/news/2026/10/13/three-weeks-before-election-day-6-percent-of-voters-have-already-cast-their-ballot","SOS: absentee returned only"],["2026-10-20",789572,"https://content.govdelivery.com/accounts/MISOS/bulletins/42fcf6d","SOS 7am: 789,476 absentee + 96 in-person"],["2026-10-27",1392170,"https://content.govdelivery.com/accounts/MISOS/bulletins/430a5e9","SOS 7am: 1,176,375 absentee + 215,795 early in-person"]],
  NY: [["2026-10-28",1110053,"https://www.wamc.org/news/2026-10-29/early-voter-turnout-2026-elections-midterms-albany-new-york-massachusetts-vermont","early in-person only, prelim SBOE, Wed evening; no statewide absentee-returned counts found"],["2026-10-29",1277235,"https://cbs6albany.com/news/local/more-than-127-million-new-yorkers-voted-early-in-first-six-days-of-2026-election-new-york-city-saratoga-county-schenectady-rensselaer-fulton-columbia-montgomery-schoharie-washington-warren-capital-region-general-elections-cbs6-wrgb","early in-person only, SBOE, days 1-6 (Oct 24-29)"],["2026-10-31",1705698,"https://cbs6albany.com/news/local/early-voting-wraps-sunday-as-new-york-reports-17-million-ballots-cast-statewide","early in-person only, SBOE; county table labeled Day 8 Oct 31"],["2026-11-01",1965043,"https://ny1.com/nyc/all-boroughs/politics/2026/11/02/democrats-see-an-advantage-in-new-yorks-early-voting-surge","early in-person only, final 9-day total (Oct 24-Nov 1), unofficial"]],
  ME: [["2026-10-16",101777,"https://www.pressherald.com/2026/10/20/democrats-dominating-maine-absentee-voting-so-far/","absentee returned+accepted 'as of Friday' (inferred Oct 16); likely includes in-person absentee at town offices. Later reports only approximate (>136k ~Oct 21; 'more than half of 200k' Oct 23)"]],
  TX: [["2026-10-24",4200000,"https://www.sos.state.tx.us/about/newsreleases/2026/102626.shtml","SOS release: 'more than 4.2 million' cast in first six days (in-person + mail), through Sat Oct 24; rounded lower bound"],["2026-10-25",4500000,"https://www.texastribune.org/2026/10/27/texas-early-voting-2026-election/","Texas Tribune: 'nearly 4.5 million' in first seven days through Sun Oct 25 (23.4% of RV, ballot or mail); rounded"],["2026-10-30",7410631,"https://www.cbsnews.com/texas/news/texas-early-voting-record-10-31-2026/","CBS Texas citing SOS: in person + mail as of Fri Oct 30 (last day of early voting), 38.92% of RV"],["2026-11-01",7700000,"https://www.texastribune.org/2026/10/31/texas-early-voting-turnout-rate-election-2026/","Texas Tribune: 'more than 7.7 million' per preliminary SOS data as of Sunday morning (40.5%); rounded lower bound, likely includes late mail"]],
  GA: [["2026-10-19",1005130,"https://www.atlantanewsfirst.com/2026/10/19/more-than-1-million-votes-cast-georgias-midterm-election-so-far/","total turnout as of 5:50pm Mon; 960,707 in-person early + remainder absentee"],["2026-10-20",1055931,"https://sos.ga.gov/news/georgia-surpasses-one-million-early-votes","SOS: overall turnout incl. 48,916 absentee accepted, as of noon Tue (page 403 to fetch; figures via search snippet)"],["2026-10-26",1781209,"https://www.fox5atlanta.com/election/georgia-enters-final-week-early-voting-1-8m-ballots-cast","1,698,469 in-person + 82,740 absentee accepted, through Oct 26 (SOS dashboard)"],["2026-10-27",2097834,"https://sos.ga.gov/news/georgia-surpasses-two-million-person-early-votes","SOS: 2,000,452 in-person + 97,382 absentee accepted as of 4:30pm Tue; sum of two stated figures"],["2026-10-29",2402526,"https://sos.ga.gov/news/early-voting-passes-2022-midterm-record-one-day-left","SOS: 2,294,275 in-person + 108,251 absentee accepted as of 1:35pm Thu; sum of two stated figures (in-day partial)"],["2026-10-30",2700000,"https://www.atlantanewsfirst.com/2026/10/14/by-numbers-georgias-daily-early-voting-totals-ahead-november-election/","ANF end-of-early-voting: 'more than 2.7 million Georgians cast their ballots early'; rounded lower bound, absentee inclusion unstated"]],
  NJ: [["2026-10-14",319422,"https://newjerseymonitor.com/2026/10/15/county-clerks-voters-drop-boxes-election-2026/","MAIL ONLY: returned mail ballots as of Wed morning Oct 14 (before in-person early voting began Oct 24)"],["2026-10-19",364128,"https://newjerseyglobe.com/congress/democrats-dominate-early-vote-by-mail-returns-in-new-jersey-including-three-key-congressional-districts/","MAIL ONLY: mail ballots returned 'so far', article published Oct 19 10pm; as-of date inferred from publish date"],["2026-10-29",952656,"https://newjerseyglobe.com/campaigns/democrats-maintain-commanding-early-vote-lead-but-republicans-show-signs-of-improvement/","mail returned + in-person through Thu Oct 29 (day 6 of early voting); as-of inferred, article published Oct 30"]],
  MN: [["2026-09-23",12322,"https://www.sos.mn.gov/about-the-office/news-room/384-995-ballots-sent-in-first-week-of-voting-for-november-3-election/","SOS first six days: 8,403 in-person + 3,919 by mail (sum of stated figures); release Sep 24"],["2026-10-01",63396,"https://www.sos.mn.gov/about-the-office/news-room/63-396-ballots-accepted-in-first-two-weeks-of-voting-for-november-3-election/","SOS accepted, close of business Oct 1: 26,174 in-person + 37,222 mail"],["2026-10-08",127682,"https://www.sos.mn.gov/about-the-office/news-room/127-682-ballots-accepted-in-first-three-weeks-of-voting-for-november-3-election/","SOS accepted as of Oct 8: 47,968 in-person + 79,714 mail"],["2026-10-15",202252,"https://www.sos.mn.gov/about-the-office/news-room/202-252-ballots-accepted-in-first-four-weeks-of-voting-for-november-3-election/","SOS accepted, first four weeks, as of Oct 15 (released Oct 16); mail + in-person"],["2026-10-29",728961,"https://www.sos.mn.gov/about-the-office/news-room/728-961-ballots-accepted-in-first-six-weeks-of-voting-for-november-3-election/","SOS accepted as of Thu Oct 29: 483,520 in-person + 245,441 mail; Oct 22 (week 5) release not found"]],
  IN: [["2026-10-27",476802,"https://www.wbaa.org/statewide/2026-10-29/early-voting-numbers-are-up-around-the-state-before-the-2026-midterm","'a week from the midterm' (date approximate; article Oct 29): 405,786 in-person + 64,721 mailed; stated total doesn't exactly equal sum"],["2026-11-02",804304,"https://www.nbcnews.com/politics/2026-elections/indiana-results","NBC News: mail-in + early in-person votes cast, last updated Nov 2"]],
  IL: [["2026-11-02",1579728,"https://www.nbcnews.com/politics/2026-elections/illinois-results","NBC News: mail-in + early in-person votes cast, last updated Nov 2"]],
  CA: [["2026-10-05",6319,"https://web.archive.org/web/20261007150832/https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/bsr-statistics.pdf","SOS VoteCal ballot return stats as of Mon Oct 5: VBM returned only (report had no in-person columns yet)"],["2026-10-19",1716890,"https://web.archive.org/web/20261022170100/https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/bsr-statistics-10-19-2026.pdf","SOS VoteCal as of Mon Oct 19: VBM returned only (no in-person columns in this report)"],["2026-10-31",6018065,"https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/bsr-statistics-10-31-26.pdf","SOS VoteCal as of Sat Oct 31: 5,791,054 VBM returned + 227,011 in-person cast = TOTAL BALLOTS CAST"],["2026-11-01",6406161,"https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/bsr-statistics-11-01-26.pdf","SOS VoteCal as of Sun Nov 1: 6,107,024 VBM returned + 299,137 in-person cast = TOTAL BALLOTS CAST"]],
  AR: [["2026-10-22",210285,"https://talkbusiness.net/2026/10/sebastian-county-early-voting-up-21-from-2022-midterm-election/","early in-person 205,493 + absentee 4,792; through Thu Oct 22 (Turnout Tracker data, preliminary)"],["2026-10-29",459941,"https://talkbusiness.net/2026/10/sebastian-county-early-voting-up-13-5-arkansas-early-voting-up-17/","early in-person 451,762 + absentee 8,179; through Thu Oct 29, first 10 days (preliminary)"]],
  HI: [["2026-10-15",510,"https://elections.hawaii.gov/wp-content/uploads/AbsenteeReconState-20261015.pdf","electronic (UOCAVA email/fax) voted only; mail voted 0 yet; SOE report generated 10/15 3am"],["2026-10-19",14801,"https://elections.hawaii.gov/wp-content/uploads/AbsenteeReconState-20261019.pdf","mail voted 14,242 + electronic 559 + early in-person 0; SOE report generated 10/19 3am"],["2026-10-22",79348,"https://elections.hawaii.gov/wp-content/uploads/AbsenteeReconState-20261022.pdf","mail voted 78,113 + early in-person 504 + electronic 731; SOE 'VOTED' total, report generated 10/22 3am"],["2026-10-26",125118,"https://elections.hawaii.gov/wp-content/uploads/AbsenteeReconState-20261026.pdf","mail voted 123,057 + early in-person 1,245 + electronic 816; SOE report generated 10/26 3am"],["2026-10-29",190203,"https://elections.hawaii.gov/wp-content/uploads/AbsenteeReconState-20261029.pdf","mail voted 186,426 + early in-person 2,824 + electronic 953; SOE report generated 10/29 3am"],["2026-10-31",230724,"https://elections.hawaii.gov/wp-content/uploads/AbsenteeReconState-20261031.pdf","mail voted 225,236 + early in-person 4,443 + electronic 1,045; SOE report generated 10/31 3am"],["2026-11-02",249140,"https://elections.hawaii.gov/wp-content/uploads/AbsenteeReconState-20261102.pdf","mail voted 242,598 + early in-person 5,472 + electronic 1,070; SOE report generated 11/2 3am"]],
  IA: [["2026-10-21",125287,"https://iowaledger.com/","absentee returned (mail + in-person absentee); SOS report of Oct 21, flagged provisional"],["2026-10-24",265803,"https://www.bleedingheartland.com/2026/10/24/iowa-absentee-ballot-numbers-in-the-2026-general-election/","absentee received (mail + in-person absentee) through Oct 24, per SOS"],["2026-10-27",307080,"https://www.bleedingheartland.com/2026/10/24/iowa-absentee-ballot-numbers-in-the-2026-general-election/","absentee received incl. in-person early; SOS data pulled morning of Oct 27 (also Axios DSM)"],["2026-10-28",338882,"https://www.bleedingheartland.com/2026/10/24/iowa-absentee-ballot-numbers-in-the-2026-general-election/","absentee received incl. in-person early; SOS data pulled morning of Oct 28"],["2026-10-29",407549,"https://www.bleedingheartland.com/2026/10/24/iowa-absentee-ballot-numbers-in-the-2026-general-election/","absentee received incl. in-person early; through Oct 29 per SOS"],["2026-10-30",437689,"https://www.bleedingheartland.com/2026/10/24/iowa-absentee-ballot-numbers-in-the-2026-general-election/","absentee received incl. in-person early; through Oct 30 per SOS"],["2026-11-02",464216,"https://iowaledger.com/","absentee returned incl. in-person early; SOS report Nov 2 (provisional; also Bleeding Heartland, morning pull)"]],
  ID: [["2026-10-28",192796,"https://www.eastidahonews.com/2026/10/idahos-early-voting-numbers-driven-by-fired-up-electorate/","early in-person 94,297 + absentee returned 98,499; as of Wed Oct 28"],["2026-10-30",234199,"https://www.idahopress.com/news/elections/more-than-200-000-idahoans-vote-early-for-midterms/article_c4d4024a-8453-4a05-8499-5d662bada56e.html","early in-person 122,372 + absentee returned 111,827; SOS figures as of Fri Oct 30 morning"]],
  KS: [["2026-10-22",122344,"https://www.wibw.com/2026/10/23/kansas-sees-boost-early-voting-ahead-november-general-election/","mail returned 24,155 + in-person advance 98,189; per SOS as of Oct 22"],["2026-10-27",245000,"https://www.kcur.org/politics-elections-and-government/2026-10-28/early-voting-kansas-city-missouri-wyandotte-clay-platte-johnson-2026-elections","'more than 245,000' (lower bound, rounded) mail returned + in-person, as of Tue Oct 27"]],
  MS: [["2026-09-28",4148,"https://www.sos.ms.gov/news/2026-november-general-election-absentee-report-september-28","absentee received (mail; no early voting in MS, in-person absentee counted as absentee); SEMS"],["2026-10-05",9761,"https://www.sos.ms.gov/news/2026-november-general-election-absentee-report-october-5","absentee received (mail + in-person absentee); SEMS"],["2026-10-12",17591,"https://www.sos.ms.gov/news/2026-november-general-election-absentee-report-october-12","absentee received (mail + in-person absentee); SEMS"],["2026-10-19",29647,"https://www.sos.ms.gov/news/2026-november-general-election-absentee-report-october-19","absentee received (mail + in-person absentee); SEMS"],["2026-10-26",56049,"https://www.sos.ms.gov/news/2026-november-general-election-absentee-report-october-26","absentee received (mail + in-person absentee); SEMS"],["2026-11-02",116453,"https://www.sos.ms.gov/news/2026-november-general-election-absentee-report-november-2","absentee received (mail + in-person absentee); SEMS"]],
  LA: [["2026-10-27",520942,"https://www.kplctv.com/2026/10/29/early-voting-up-38-statewide-black-early-votes-calcasieu-more-than-double-2022/","final early-voting total through Oct 27 (end of early voting), SOS data; reported split 448,525 in-person + 72,417 absentee; mail returned after Oct 27 not included"]],
  NM: [["2026-10-16",63000,"https://sourcenm.com/2026/10/16/new-mexico-early-voting-locations-expand-on-saturday/","absentee + early in-person; rounded: 'just more than 63,000' as of Friday morning (4.3% of registered), SOS data"],["2026-10-19",97494,"https://www.yahoo.com/news/politics/articles/nearly-100-000-mexicans-cast-090842694.html","absentee + early in-person; Source NM, 'cast as of Oct. 19'"],["2026-10-21",159965,"https://www.abqjournal.com/news/early-voting-turnout-nears-160000-with-democrats-outpacing-republicans-at-the-polls-so-far/3146675","early + absentee; ABQ Journal, 'as of Wednesday' (entering Wed Oct 21; may be through Oct 20)"],["2026-10-28",316642,"https://www.kob.com/news/top-news/new-mexico-early-voting-eclipses-300k-ballots-cast/","total cast per SOS 'Wednesday morning'; article undated, Wed inferred as Oct 28 from 'early voting ends this Saturday'"]],
  NV: [["2026-10-08",1839,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail only (accepted), pre in-person; Nevada Independent blog 10/8 11:20 AM"],["2026-10-12",2955,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail only; blog 10/12 11 AM"],["2026-10-14",6478,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail only (accepted); blog 10/14 12:20 PM"],["2026-10-16",41702,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail only, day before in-person EV opened Oct 17; blog 10/16 1:30 PM"],["2026-10-17",82102,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail + in-person; blog 10/17 9 PM, first day of in-person EV"],["2026-10-19",151735,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail + in-person; blog 10/19 10 PM"],["2026-10-21",244767,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail + in-person; blog 10/21 8:30 PM"],["2026-10-22",284836,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail + in-person; blog 10/22 7:45 PM"],["2026-10-23",333341,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail + in-person; blog 10/23 9:15 PM"],["2026-10-25",375492,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail + in-person; blog 10/25 8:30 AM (morning update, likely through 10/24)"],["2026-10-26",395325,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail + in-person; blog 10/26 6:45 AM (morning update)"],["2026-10-28",565480,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail + in-person; blog 10/28 9 PM"],["2026-10-30",628500,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail + in-person; blog 10/30 6 AM (morning update, likely through 10/29)"],["2026-11-02",732000,"https://thenevadaindependent.com/article/the-early-voting-blog-2026-general","mail + in-person, rounded; blog 11/2 7 AM ('739,000 if you include returned but not accepted mail'); in-person EV ended 10/30"]],
  RI: [["2026-10-21",41000,"https://rhodeislandcurrent.com/2026/10/21/eight-days-in-30000-rhode-island-voters-cast-ballots-early/","rounded: 'more than 41,000' = just over 30,000 early in-person + nearly 11,000 mail received; 5.2% of registered"],["2026-11-02",137138,"https://rhodeislandcurrent.com/2026/11/02/on-election-day-eve-ri-surpasses-17-voter-turnout-with-record-early-voting-numbers/","111,901 early in-person (final, 4pm Mon close) + 25,237 mail received; article says 'surpassed 137,000', 17.2%"]],
  SC: [["2026-10-19",97968,"https://abcnews4.com/news/state/nearly-98000-cast-ballots-on-first-day-of-early-voting-in-south-carolina-election-midterms","early in-person only (SEC report), day 1; mail absentee not included/reported"],["2026-10-22",363566,"https://www.foxcarolina.com/2026/10/22/over-280k-early-votes-cast-so-far-south-carolina/","early in-person cumulative through Thu Oct 22; mail absentee not stated"],["2026-10-27",671314,"https://abcnews4.com/news/local/south-carolina-early-voting-surpasses-671000-ballots-with-four-days-remaining","early in-person cumulative through Tue Oct 27 (7 voting days); mail absentee not stated"],["2026-10-28",753108,"https://www.wtoc.com/2026/10/29/over-750k-votes-cast-sc-sees-record-early-voting-turnout/","early in-person cumulative through Wed Oct 28 (671,314 + 81,794); mail absentee not stated"],["2026-10-31",1043810,"https://www.wtoc.com/2026/10/29/over-750k-votes-cast-sc-sees-record-early-voting-turnout/","final early voting period Oct 19-31 per SEC; page since updated (same URL now shows final); mail absentee not stated"]],
  SD: [["2026-09-25",5134,"https://sdsos.gov/elections-voting/upcoming-elections/general-information/2026-Election-Absentee-Data.aspx","absentee ballots received (SD absentee includes in-person absentee); SOS weekly table, 12,625 sent"],["2026-10-02",11164,"https://sdsos.gov/elections-voting/upcoming-elections/general-information/2026-Election-Absentee-Data.aspx","absentee received; SOS weekly"],["2026-10-09",20105,"https://sdsos.gov/elections-voting/upcoming-elections/general-information/2026-Election-Absentee-Data.aspx","absentee received; SOS weekly"],["2026-10-16",31562,"https://sdsos.gov/elections-voting/upcoming-elections/general-information/2026-Election-Absentee-Data.aspx","absentee received; SOS weekly"],["2026-10-23",49438,"https://sdsos.gov/elections-voting/upcoming-elections/general-information/2026-Election-Absentee-Data.aspx","absentee received; SOS weekly"],["2026-10-30",78778,"https://sdsos.gov/elections-voting/upcoming-elections/general-information/2026-Election-Absentee-Data.aspx","absentee received; SOS weekly (82,274 sent)"]],
  WA: [["2026-10-20",385992,"https://www.nwprogressive.org/weblog/2026/10/first-washington-state-ballot-return-statistics-of-2026-general-election-show-slight-uptick-in-early-voting-compared-to-2022.html","all-mail state, ballots returned per SOS stats; NPI blog 'Day -14' (date inferred as Oct 20)"],["2026-10-23",705231,"https://www.spokanepublicradio.org/regional-news/2026-10-24/more-than-700-000-wa-state-voters-have-cast-ballots","ballots returned as of Friday afternoon; WA State Standard (13.7%)"],["2026-10-27",1200000,"https://www.spokesman.com/stories/2026/oct/27/more-than-12-million-washington-ballots-returned-a/","rounded: '1.2 million votes cast as of 5 p.m. Tuesday'"],["2026-10-30",1696308,"https://www.fox13seattle.com/news/voters-cast-ballots-wa","ballots returned 'by Friday' per SOS (32.84% of 5,165,860)"]],
  WV: [["2026-10-24",66855,"https://wvmetronews.com/2026/10/26/nearly-67000-west-virginians-take-to-polls-through-first-four-days-of-early-voting/","62,366 early in-person + 4,489 absentee returned, end of day Sat Oct 24 (SOS)"],["2026-10-28",115855,"https://sos.wv.gov/article/secretary-warner-announces-more-115000-ballots-have-been-cast-absentee-voting-and-during","109,902 early in-person + 5,953 absentee, end of day Wed Oct 28 (SOS release)"],["2026-10-31",169350,"https://wchstv.com/newsletter-daily/west-virginia-sees-rise-in-early-voting-turnout-for-2026-midterm-election","cast or returned during early voting Oct 21-31 (162,349 in-person); unofficial SOS figures"]],
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
    for (const s of ev.states) { // news-report points (and the hand-entered total) lift the trend line; each carries forward until the next
      const pts = [...(BACKFILL[s.state_po] ?? [])];
      if (s.note) pts.push([s.date, s.cast]);
      if (!pts.length) continue;
      s.series ??= dates.map(() => 0);
      s.series = s.series.map((v, i) => Math.max(v, ...pts.filter(p => p[0] <= dates[i]).map(p => p[1])));
    }
    for (const s of ev.states) if (FLAGS[s.state_po] && !s.note) s.flag = FLAGS[s.state_po];
    return { asOf: ev.as_of, dates, states: ev.states, source: 'https://whoshowsup.net/early-vote' };
  } catch (e) { console.warn('early vote unavailable', e); return null; }
}

async function loadData() {
  const [governor, senate, early, sen, house, pres, houseRaces] = await Promise.all([build('governor'), build('senate'), earlyVote(),
    control('which-party-will-win-the-senate-in-2026'), control('which-party-will-win-the-house-in-2026'), president().catch(() => null), houseForecast().catch(e => (console.warn('house forecast unavailable', e), null))]);
  return { governor, senate, early, president: pres, house: houseRaces, control: { Senate: sen, House: house }, updated: new Date().toISOString() };
}

if (typeof module !== 'undefined') module.exports = { loadData };
