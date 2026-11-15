# Election Tracker

[![Site](https://img.shields.io/website?url=https%3A%2F%2Ftom-neverwinter.github.io%2Felection-tracker%2F&label=site)](https://tom-neverwinter.github.io/election-tracker/)
[![Pages deploy](https://github.com/Tom-Neverwinter/election-tracker/actions/workflows/pages/pages-build-deployment/badge.svg)](https://github.com/Tom-Neverwinter/election-tracker/actions/workflows/pages/pages-build-deployment)
[![Data updated](https://img.shields.io/github/last-commit/Tom-Neverwinter/election-tracker?label=data%20updated)](https://github.com/Tom-Neverwinter/election-tracker/commits/main)
[![Commit activity](https://img.shields.io/github/commit-activity/w/Tom-Neverwinter/election-tracker)](https://github.com/Tom-Neverwinter/election-tracker/commits/main)
[![Open issues](https://img.shields.io/github/issues/Tom-Neverwinter/election-tracker)](https://github.com/Tom-Neverwinter/election-tracker/issues)
[![Repo size](https://img.shields.io/github/repo-size/Tom-Neverwinter/election-tracker)](https://github.com/Tom-Neverwinter/election-tracker)

[![Senate](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FTom-Neverwinter%2Felection-tracker%2Fmain%2Fbadges%2Fsenate.json)](https://tom-neverwinter.github.io/election-tracker/#results)
[![House](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FTom-Neverwinter%2Felection-tracker%2Fmain%2Fbadges%2Fhouse.json)](https://tom-neverwinter.github.io/election-tracker/#results)
[![Governors](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FTom-Neverwinter%2Felection-tracker%2Fmain%2Fbadges%2Fgovernors.json)](https://tom-neverwinter.github.io/election-tracker/#results)
[![Votes counted](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FTom-Neverwinter%2Felection-tracker%2Fmain%2Fbadges%2Fvotes.json)](https://tom-neverwinter.github.io/election-tracker/#early)
[![Ballot measures](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FTom-Neverwinter%2Felection-tracker%2Fmain%2Fbadges%2Fmeasures.json)](https://tom-neverwinter.github.io/election-tracker/#measures)
[![States certified](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FTom-Neverwinter%2Felection-tracker%2Fmain%2Fbadges%2Fcertified.json)](https://tom-neverwinter.github.io/election-tracker/#results)
[![Who voted](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FTom-Neverwinter%2Felection-tracker%2Fmain%2Fbadges%2Fwhovoted.json)](https://tom-neverwinter.github.io/election-tracker/#demo)

A single-page tracker for US elections: the 2026 midterms as they were forecast, voted and counted, plus election history back to 1789.

**Live site: <https://tom-neverwinter.github.io/election-tracker/>**

Every badge above is live. The first row is site reachability, the GitHub Pages deployment and repository activity as reported by GitHub; "Data updated" is the time of the last commit, normally the hourly data capture. The second row is the election itself: seats called (including seats not on the 2026 ballot), votes counted, measures decided, states certified and North Carolina counties that have posted who voted. `badges.js` rewrites those numbers in `badges/` every hour, and shields.io may cache them for a few minutes.

## What's on the page

| Tab | What it shows |
| --- | --- |
| President | 2028 state and national market odds, and every presidential election since 1788 |
| Senate, House, Governor | 2026 forecasts (consensus of the published race ratings plus Polymarket odds), and past results by year |
| Results | Nov 3, 2026 results for Senate, House, Governor and other statewide races, plus each state's certification deadline |
| Timeline | Hour-by-hour captures of odds, projected seats, early votes and race calls |
| Early vote | Ballots cast before Election Day by state, per eligible voter and against 2022 |
| Measures | Statewide ballot measures: 2026 with results, and past years |
| Who voted | Every state's 2026 turnout of eligible citizens and who could vote (Census: citizens 18+ by age, sex and race); full turnout by age, race, party and sex, statewide and by county, where the state publishes it (North Carolina, Louisiana, Colorado; Washington after certification) |
| States | Party control of each state government and trifectas, 1776 to today |
| History | Turnout by state for any two elections from 1980 to 2024, and national turnout since 1789 |

Links are shareable: the address tracks the open tab and year, for example `#president/1860`. Add `?day=YYYY-MM-DD` to open a saved daily snapshot of the forecasts.

## How it works

There is no build step and no server. `index.html` is the whole app; it loads D3 and the data files below as plain scripts, so it runs from GitHub Pages or straight from disk.

- **Live on open.** `data.js` fetches forecast ratings from Wikipedia, odds from Polymarket and the early-vote feed in the visitor's browser. If that fails, the page falls back to the newest saved snapshot.
- **Captured on a schedule.** Results can't be fetched from the browser, so Node scripts write them into data files that are committed to this repo. `hourly.js` runs all of them, saves a capture to `hourly/`, and pushes.

| Script | Writes | Source |
| --- | --- | --- |
| `snapshot.js` | `history.js` (one forecast snapshot per day) | everything `data.js` loads |
| `results.js` | `results-data.js` | NBC News results (Associated Press vote data) |
| `measures-results.js` | `measures-results-data.js` | Wikipedia's 2026 ballot measures table, NBC News, and each measure's Wikipedia page |
| `legislature-results.js` | `legislature-results-data.js` | Wikipedia, 2026 state legislative elections |
| `state-demo.js` | `state-demo-data.js` | State election offices: North Carolina, Louisiana, Colorado, Washington |
| `eligible.js` (yearly, not hourly) | `eligible-data.js` | Census Bureau American Community Survey 2020–2024 |
| `badges.js` | `badges/*.json` (README badges) | the data files above |
| `hourly-index.js` | `hourly/index.js` (compact summary of every capture) | `hourly/*.json` |
| `hourly.js` | runs all of the above, then commits and pushes | |

Static data lives in `past/` (president, Senate, House, governor, turnout, state control, ballot measures), `measures.js` and `certification.js`.

## Run it yourself

Open `index.html` in a browser. Nothing to install.

To refresh the captured data you need Node 18 or newer (the scripts use the built-in `fetch`; there are no dependencies):

```sh
node snapshot.js   # save today's forecasts
node results.js    # pull current results
node hourly.js     # run everything, save an hourly capture, commit and push
```

## Hand-maintained data

A few things have no reliable feed and are edited by hand:

- **Early-vote corrections** in `data.js`, for states where the feed lags official or news-reported totals. Each carries its source and shows on the page as hand-entered.
- **Certified dates** in `certification.js`. The page shows each state's legal deadline; a state is marked "Certified" only when its `certified` date is filled in.
- **Ballot-measure summaries** in `measures.js`, written for this site.

## Sources

- Race ratings: Wikipedia's 2026 Senate, House and gubernatorial ratings tables
- Market odds: [Polymarket](https://polymarket.com)
- Results: [NBC News](https://www.nbcnews.com/politics/2026-elections), with vote data from the Associated Press
- Early vote: [Who Shows Up](https://whoshowsup.net/early-vote), plus state election offices for corrections
- Past results: [MIT Election Lab](https://electionlab.mit.edu/data), [Voteview](https://voteview.com/data), Wikipedia
- Turnout: [UF Election Lab](https://election.lab.ufl.edu/voter-turnout/)
- Certification deadlines: [USAFacts](https://usafacts.org/articles/the-viz-lab/election-certification/), compiled from NCSL and state election offices
- Population and eligible voters: US Census Bureau

## Caveats

This is a personal project, not an official source. Race calls are media projections until a state certifies. The "consensus" rating is a simple average of published ratings and market odds, not a model. Market odds for 2028 are thinly traded.
