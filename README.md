# Keeper League

Fantasy baseball keeper league dashboard — power rankings, roster viewer, and automated data pipeline.

## Overview

A 10-team H2H categories keeper league tool that:
- Fetches roster, projection, and real-stats data from Fantrax and FanGraphs APIs
- Computes power rankings across 6 projection systems (Steamer, ZiPS, ATC, THE BAT, THE BAT X, Depth Charts)
- Blends projected stats with real season performance as the year progresses
- Serves a static frontend on GitHub Pages with live data refreshes via CI/CD

### Scoring Categories (10-cat Roto)

| Hitting | Pitching |
|---------|----------|
| HR | K |
| RBI | ERA |
| TB | WHIP |
| OPS | W+QS |
| SBN (net steals) | SVH (saves + holds) |

## Project Structure

```
├── index.html              # Roster viewer page
├── power-rankings.html     # Power rankings page
├── styles.css              # Shared styles
├── script.js               # Roster viewer logic
├── projections.js          # Projection provider registry
├── power-rankings.js       # Rankings computation & rendering
├── shared/                 # Shared modules (browser + Node)
│   ├── categories.js       #   Categories, team abbreviations, projection systems
│   └── normalize.js        #   Name normalization & projection lookup
├── data/                   # JSON data files (auto-generated)
│   ├── api.js              #   API wrapper (Fantrax + FanGraphs)
│   └── *.json              #   Cached API responses & computed rankings
├── server/                 # Local development server
│   ├── index.js            #   Entry point
│   ├── serve.js            #   HTTP server with static files + API endpoints
│   ├── config.js           #   Environment configuration
│   ├── scheduler.js        #   Cron-based data refresh scheduler
│   ├── rankings.js         #   Power rankings computation engine
│   └── history.js          #   Rankings history tracking
├── scripts/
│   └── refresh-data.js     # Standalone data refresh (for CI/CD)
├── tests/                  # Jest test suite
│   ├── normalize.test.js
│   ├── categories.test.js
│   └── validation.test.js
└── .github/workflows/
    └── refresh-data.yml    # Automated data refresh (every 6 hours)
```

## Setup

### Prerequisites

- Node.js 18+
- A Fantrax league ID
- (Optional) Fantrax session cookie for authenticated endpoints

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
FANTRAX_LEAGUE_ID=your_league_id
FANTRAX_COOKIE=your_session_cookie    # Optional: for real stats
API_TOKEN=your_secret_token           # Optional: protect /api/refresh endpoint
```

### Running Locally

```bash
# Start the development server (auto-refreshes data on schedule)
npm start

# Fetch all data manually
npm run fetch

# Fetch specific data
npm run fetch:rosters
npm run fetch:projections
npm run fetch:stats

# Regenerate rankings from existing data
npm run refresh:rankings

# Full data refresh (fetch + rankings)
npm run refresh
```

The server starts at `http://localhost:3000` with:
- `/` — Roster viewer
- `/power-rankings.html` — Power rankings
- `/api/status` — Health check & job status
- `/api/refresh` — Trigger manual data refresh

### Running Tests

```bash
npm test
```

## CI/CD

The GitHub Actions workflow (`.github/workflows/refresh-data.yml`) runs every 6 hours:

1. Fetches fresh data from Fantrax and FanGraphs APIs
2. Regenerates power rankings for all projection systems
3. Validates all JSON files
4. Commits and pushes updated data to the repo

GitHub Pages serves the static frontend directly from the repo, so data stays in sync.

### Required Secrets

| Secret | Purpose |
|--------|---------|
| `FANTRAX_LEAGUE_ID` | Your Fantrax league ID |
| `FANTRAX_COOKIE` | Fantrax session cookie (for authenticated stats endpoints) |

## Architecture

### Data Flow

```
Fantrax API ─┐
             ├─→ data/*.json ─→ server/rankings.js ─→ power_rankings.json
FanGraphs API┘                                        power_rankings_history.json
```

### Shared Modules

The `shared/` directory contains code shared between the browser frontend and the Node.js backend using a UMD pattern:

- **categories.js** — League categories, team abbreviation mappings, projection system definitions
- **normalize.js** — Player name normalization, Fantrax-to-FanGraphs name matching, projection lookup

### Security

- XSS protection via `escapeHtml()` on all dynamic content
- Content Security Policy headers on all responses
- Rate limiting on `/api/refresh` (5 requests/minute)
- Optional Bearer token auth on `/api/refresh` (set `API_TOKEN` env var)
- Atomic file writes (write to `.tmp`, then rename)
- API response validation before saving
