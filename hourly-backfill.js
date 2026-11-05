// One-time backfill for the Timeline: 6-hourly frames from Oct 1 up to the first hourly capture, built from
// Polymarket price history (race and chamber odds) and the early-vote feed's daily per-state series.
// Writes hourly/backfill.json, which hourly-index.js merges in. Run: node hourly-backfill.js
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'hourly'), STEP = 6 * 3600, START = Date.parse('2026-10-01T00:00:00Z') / 1000;
const caps = fs.readdirSync(dir).filter(f => /^\d{4}-.*\.json$/.test(f) && f !== 'backfill.json').sort();
const firstCap = JSON.parse(fs.readFileSync(path.join(dir, caps[0]), 'utf8')), lastCap = JSON.parse(fs.readFileSync(path.join(dir, caps.at(-1)), 'utf8'));
const END = Date.parse(firstCap.captured) / 1000;
const get = async url => { for (let i = 0; i < 3; i++) { const r = await fetch(url); if (r.ok) return r.json(); await new Promise(s => setTimeout(s, 1000 * (i + 1))); } throw new Error('failed ' + url); };
const r3 = x => Math.round(x * 1000) / 1000;
const tagOf = t => /\(D\)|Democrat/.test(t) ? 'D' : /\(R\)|Republican/.test(t) ? 'R' : /\(I\)|Independent/.test(t) ? 'I' : null;

async function series(slug, pick) { // {bucket: value} for an event, forward-filled on the 6-hour grid
  const ev = (await get('https://gamma-api.polymarket.com/events?slug=' + slug))[0];
  if (!ev) return {};
  const mks = ev.markets.filter(m => m.active !== false && m.clobTokenIds && pick(m));
  const hist = await Promise.all(mks.map(async m => { const h = (await get(`https://clob.polymarket.com/prices-history?market=${JSON.parse(m.clobTokenIds)[0]}&startTs=${START - 86400}&fidelity=360`)).history ?? [];
    return { m, h: h.sort((a, b) => a.t - b.t) }; }));
  return { ev, hist };
}
const priceAt = (h, t) => { let p = null; for (const x of h) { if (x.t > t) break; p = x.p; } return p; };

async function main() {
  const grid = []; for (let t = START; t < END; t += STEP) grid.push(t);
  const jobs = []; // [key, slug, kind]
  for (const [o, k] of [['senate', 'S'], ['governor', 'G']]) for (const r of firstCap.data[o].races) if (r.market?.url) jobs.push([`${k}:${r.label}`, r.market.url.split('/').pop(), 'race']);
  for (const r of firstCap.data.president.races) jobs.push([`P:${r.state}`, `2028-presidential-election-${r.state.toLowerCase().replace(/ /g, '-')}-winner`, 'race']);
  jobs.push(['mkt:S', 'which-party-will-win-the-senate-in-2026', 'ctrl'], ['mkt:H', 'which-party-will-win-the-house-in-2026', 'ctrl'], ['mkt:P', 'which-party-wins-2028-us-presidential-election', 'ctrl']);
  const out = {}; // key -> [value per grid point]
  for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map(async ([key, slug, kind]) => {
    try {
      const { hist } = await series(slug, m => kind === 'ctrl' ? /Democratic/.test(m.groupItemTitle) : true);
      if (!hist?.length) return;
      out[key] = grid.map(t => {
        if (kind === 'ctrl') return priceAt(hist[0].h, t);
        const party = { D: 0, R: 0, I: 0 };
        for (const { m, h } of hist) { const p = priceAt(h, t), tag = tagOf((m.groupItemTitle || '') + ' ' + m.question); if (p != null && tag) party[tag] += p; }
        const d = party.D + party.I, r = party.R;
        return kind === 'party' ? (d + r ? d / (d + r) : null) : d + r > 0 ? d / (d + r) : null;
      });
    } catch (e) { console.warn(key, e.message); }
  }));
  const e = lastCap.data.early, dayIdx = t => { const d = new Date(t * 1000).toLocaleDateString('en-CA'); let i = -1; e.dates.forEach((x, j) => { if (x <= d) i = j; }); return i; };
  const rows = grid.map((t, g) => {
    const i = dayIdx(t), race = {}, ev = {};
    for (const [k, v] of Object.entries(out)) if (!k.startsWith('mkt:') && v[g] != null) race[k] = r3(v[g]);
    if (i >= 0) for (const s of e.states) if (s.series?.[i]) ev[s.state_name] = s.series[i];
    const early = Object.values(ev).reduce((a, b) => a + b, 0) || null;
    return { t: new Date(t * 1000).toISOString(), bf: 1, call: {}, hs: {}, ev, mkt: { S: out['mkt:S']?.[g] != null ? r3(out['mkt:S'][g]) : null, H: out['mkt:H']?.[g] != null ? r3(out['mkt:H'][g]) : null, P: out['mkt:P']?.[g] != null ? r3(out['mkt:P'][g]) : null },
      seats: { S: null, H: null, G: null }, early, res: { S: null, H: null, G: null }, race };
  });
  fs.writeFileSync(path.join(dir, 'backfill.json'), JSON.stringify(rows));
  console.log(`${rows.length} frames ${rows[0].t} → ${rows.at(-1).t}; ${Object.keys(out).length} of ${jobs.length} markets; early from ${e.dates[0]}`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
