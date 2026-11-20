// Recount rules by state, for the Recount tab. Automatic thresholds are from NASS, "Summary: State Election Canvassing Timeframes and
// Recount Thresholds" (October 2024, nass.org), each with the statute it cites. States not listed under auto have no automatic recount.
//   pct    margin at or below this % triggers it (lt: true = strictly below)
//   base   what the % is of: 'total' = all votes for the office, 'top2' = votes for the top two, 'winner' = the leading candidate's votes
//   votes  a vote margin at or below this also triggers it (any: either test triggers; all: both must hold)
//   scope  'all' offices, 'statewide' only, or 'statewide+federal'
//   kind   'automatic' (default) or 'discretionary' / 'request' when the law needs someone to act
window.RECOUNT_RULES = {
  Alabama:   { pct: 0.5, base: 'total', scope: 'all', cite: 'Ala. Code § 17-16-20' },
  Arizona:   { pct: 0.5, base: 'total', scope: 'all', cite: 'A.R.S. § 16-661' },
  California:{ kind: 'discretionary', pct: 0.015, votes: 1000, test: 'all', base: 'total', scope: 'statewide', cite: 'Cal. Elec. Code § 15645',
               text: 'The governor may order a state-funded recount of a statewide race when the top two are within the lesser of 1,000 votes or 0.015%.' },
  Colorado:  { pct: 0.5, base: 'winner', scope: 'all', cite: 'Colorado statute (NASS summary; section not cited)' },
  Connecticut:{ pct: 0.5, lt: true, base: 'total', maxVotes: 2000, orVotes: 20, scope: 'all', cite: 'Connecticut statute (NASS summary; section not cited)',
               text: 'Automatic when the top two are within 0.5% (but not more than 2,000 votes), or within 20 votes.' },
  'District of Columbia': { pct: 1, lt: true, base: 'total', scope: 'all', cite: '3 DCMR § 814' },
  Florida:   { pct: 0.5, base: 'total', scope: 'all', cite: 'Fla. Stat. § 102.141', text: 'Automatic recount when a candidate or issue was defeated by 0.5% or less of the votes cast.' },
  Hawaii:    { pct: 0.25, votes: 100, test: 'greater', base: 'total', scope: 'all', cite: 'Haw. Rev. Stat. ch. 11 (as cited by NASS)', text: 'Automatic when the margin is 100 votes or 0.25% or less, whichever is greater.' },
  Kentucky:  { pct: 0.5, base: 'total', scope: 'statewide+federal', cite: 'KRS 120.157' },
  Michigan:  { votes: 2000, scope: 'statewide', cite: 'Mich. Comp. Laws 168.880 (as cited by NASS)', text: 'Automatic for statewide offices decided by 2,000 votes or less.' },
  Montana:   { kind: 'request', pct: 0.25, base: 'total', scope: 'all', cite: 'MCA 13-16-201',
               text: 'Not automatic: the losing candidate may request a state-paid recount at 0.25% or less, or one at their own expense up to 0.5%.' },
  Nebraska:  { pct: 1, base: 'winner', scope: 'all', cite: 'Nebraska statute (NASS summary; section not cited)', text: 'Automatic at 1% or less of the winner\'s votes (2% if fewer than 500 votes were cast).' },
  'New Mexico': { pct: 0.25, lt: true, base: 'total', scope: 'statewide+federal', cite: 'N.M. Stat. § 1-14-24', text: 'Automatic below 0.25% for federal and statewide offices (below 1% for other state offices).' },
  'New York':{ pct: 0.5, base: 'total', orVotes: 20, scope: 'all', cite: 'N.Y. Elec. Law § 9-208', text: 'Automatic at 0.5% or less, 20 votes or less, or under 5,000 votes when at least 1 million ballots were cast.' },
  'North Dakota': { pct: 0.5, base: 'winner', scope: 'all', cite: 'N.D.C.C. § 16.1-16-01' },
  Ohio:      { pct: 0.25, base: 'total', scope: 'all', districtPct: 0.5, cite: 'Ohio Rev. Code § 3515.011', text: 'Automatic at 0.25% or less for statewide races and 0.5% or less for district races.' },
  Oregon:    { pct: 0.2, base: 'top2', scope: 'all', cite: 'ORS 258.280' },
  Pennsylvania: { pct: 0.5, base: 'total', scope: 'statewide', cite: '25 P.S. § 3154', text: 'Automatic for statewide races decided by 0.5% or less.' },
  'South Carolina': { pct: 1, lt: true, base: 'total', scope: 'all', cite: 'S.C. Code § 7-17-280' },
  Washington:{ pct: 0.5, lt: true, base: 'top2', votes: 2000, test: 'all', scope: 'all', cite: 'RCW 29A.64.021', text: 'Automatic when the margin is under 2,000 votes and also under 0.5% of the votes for the top two.' },
  Wyoming:   { pct: 1, lt: true, base: 'winner', scope: 'all', cite: 'Wyo. Stat. § 22-16-109' },
// Request-only and contest-only states with close 2026 races, verified from statute (2026-11-18). kind 'request': the losing candidate may ask.
  Minnesota: { kind: 'request', pct: 0.25, lt: true, base: 'total', scope: 'statewide+federal', cite: 'Minn. Stat. 204C.35',
               text: 'Not automatic. The losing candidate may request a publicly funded recount when the margin is under 0.25% (congressional and statewide races), or a recount at their own expense above that.' },
  'North Carolina': { kind: 'request', pct: 0.5, statewideVotes: 10000, districtPct: 1, base: 'total', scope: 'all', cite: 'N.C.G.S. 163-182.7',
               text: 'Not automatic. A candidate may demand a recount when the margin is 1% or less (non-statewide races such as U.S. House), or 0.5% or 10,000 votes, whichever is less (statewide).' },
  Kansas:    { kind: 'request', pct: 0.5, base: 'total', scope: 'all', cite: 'K.S.A. 25-3107',
               text: 'Not automatic. Any candidate may request a recount; at 0.5% or less the state pays, otherwise the candidate posts a bond.' },
  Tennessee: { kind: 'contest', cite: 'T.C.A. 2-17-117', text: 'No recount on request. A recount happens only if a court or tribunal orders one in an election contest.' },
  Louisiana: { kind: 'contest', cite: 'La. R.S. 18:1451', text: 'No general recount. A candidate may request a recount of absentee-by-mail and early-voting ballots only, if they could change the outcome.' },
  Mississippi: { kind: 'contest', cite: 'Miss. Code 23-15-911', text: 'No recount on request. A candidate may examine the ballot boxes; changing a result requires an election contest.' },
};

// Status of close 2026 races and known recounts, from news reports (each linked). Race names match the Recount tab's labels. Checked 2026-11-20.
// trigger: false = officials determined the race is outside the automatic margin on the final count, overriding our margin from the results feed.
window.RECOUNT_STATUS = [
  { state: 'Florida', race: 'Florida 27', date: 'Nov 10', status: 'Automatic machine recount completed; Salazar (R) still wins by about 1,086 votes, and Rodriguez (D) congratulated him', source: 'https://local10.com/news/politics/2026/11/11/miami-dade-to-officially-announce-salazar-as-winner-of-floridas-27th-congressional-district' },
  { state: 'Florida', race: 'Florida 7', date: 'Nov 7', trigger: false, status: 'No recount: just outside the 0.5% trigger; the state said Florida 27 was the only U.S. House recount', source: 'https://www.clickorlando.com/news/local/2026/11/07/no-recounts-in-contested-central-florida-us-house-districts/' },
  { state: 'South Carolina', race: 'South Carolina 2', date: 'Nov 11', status: 'Mandatory recount completed and certified; Wilson (R) wins by 2,840', source: 'https://abcnews4.com/news/state/2026-11-11-joe-wilson-wins-congressional-recount-zyon-khalifa-announces-2028-run-political-news' },
  { state: 'Minnesota', race: 'Minnesota 1', date: 'Nov 19', status: 'Recount requested: the state certified Johnson (D) by 324 votes and Finstad (R) filed for a publicly funded hand recount in all 21 counties, starting Nov 30', source: 'https://www.kaaltv.com/news/finstad-officially-requests-recount-in-minnesota-cd-1-race/' },
  { state: 'North Carolina', race: 'North Carolina 3', date: 'Nov 11', status: 'No recount: Murphy (R) conceded', source: 'https://abc11.com/post/vote-2026-rep-greg-murphy-concedes-nc-3-race-raymond-smith-county-canvass-approaches/20033978/' },
  { state: 'North Carolina', race: 'North Carolina 5', date: 'Nov 18', status: 'Recount underway: machine recounts Nov 18–20 (Watauga first, Surry last) after Foxx (R) requested one; state certification Nov 24', source: 'https://wataugaonline.com/foxx-says-she-is-requesting-a-recount-in-5th-district-race-against-hubbard/' },
  { state: 'Tennessee', race: 'Tennessee 4', date: 'Nov 16', status: 'No recount: DesJarlais (R) conceded after provisional ballots were counted (margin about 280)', source: 'https://wpln.org/post/desjarlais-concedes-tennessee-district-4-officially-flips-blue/' },
  { state: 'Louisiana', race: 'Louisiana 6', date: 'Nov 4', status: 'Not a recount case: an open multi-candidate race; the top two, Banks (D) and Miguez (R), go to a Dec 12 runoff', source: 'https://www.wafb.com/2026/11/04/chauna-banks-blake-miguez-advance-runoff-louisianas-6th-congressional-district/' },
  { state: 'Kansas', race: 'Kansas Secretary Of State', date: 'Nov 17', status: 'No recount: Day (D) conceded at the request deadline', source: 'https://www.ksnt.com/capitol-bureau/jennifer-day-concedes-kansas-secretary-of-state-race-to-pat-proctor-as-he-outlines-his-legislative-goals/' },
  { state: 'Ohio', race: 'Ohio Attorney General', date: 'Nov 4', status: 'No recount: outside the 0.25% statewide trigger; Faber (R) conceded', source: 'https://ohiocapitaljournal.com/2026/11/04/kulewicz-holds-narrow-lead-over-faber-in-ohio-attorney-general-race/' },
  { state: 'Mississippi', race: 'Mississippi U.S. Senate', date: 'Nov 11', status: 'No recount or contest: Hyde-Smith (R) conceded', source: 'https://www.wlbt.com/2026/11/12/i-respect-decision-sen-cindy-hyde-smith-concedes-defeat-scott-colom/' },
  { state: 'New Hampshire', race: 'State House (16 races)', date: 'Nov 10', status: '16 state House recounts by the Secretary of State, Nov 9–20; by Nov 10 two were done and both winners held', source: 'https://newhampshirebulletin.com/2026/11/10/16-recounts-for-new-hampshire-house-races-underway/' },
  { state: 'Arizona', race: 'State House, District 27 (2nd seat)', date: 'Nov 12', status: 'Automatic recount required by law: 311 votes separate the candidates', source: 'https://www.azfamily.com/2026/11/12/311-votes-separate-arizona-house-candidates-recount-looms/' },
  { state: 'Maine', race: 'State House (Windham)', date: 'Nov 9', status: 'Recount requested by Rep. Barbara Bagshaw (R), who trailed by 139 votes', source: 'https://www.pressherald.com/2026/11/09/windham-state-representative-requests-recount/' },
  { state: 'Iowa', race: 'Legislative race (Council Bluffs)', date: 'Nov 10', status: 'Recount requested in writing; Secretary of State set a recount', source: 'https://www.wowt.com/2026/11/10/recount-set-council-bluffs-legislative-race/' },
  { state: 'North Carolina', race: 'North Carolina 10', date: 'Nov 16', status: 'Recount requested by Ashley Bell (D), who trails Pat Harrigan (R) by about 2,500 votes, inside the state\'s 1% threshold', source: 'https://www.wunc.org/2026-11-16/democrat-ashley-bell-requests-recount-in-ncs-10th-congressional-district' },
  { state: 'North Dakota', race: 'State House, District 41', date: 'Nov 18', status: 'Qualifies for a recount on request; the trailing candidate has until Nov 21 to ask, and the canvassing board would reconvene Nov 25', source: 'https://www.valleynewslive.com/2026/11/18/north-dakota-canvassing-board-certifies-2026-election-results-one-house-race-qualifies-recount/' },
];
