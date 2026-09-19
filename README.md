# prosperifi-hackathon

AI marketing tool for ProsperiFi Chatathon track.

A single-page skincare marketing tool. You give it a product; it reviews the claims against the
ingredient list, and only unlocks the campaign work if nothing is scientifically unsupported.

## Setup

```bash
npm install
cp .env.example .env     # then paste your key into ANTHROPIC_API_KEY
npm start                # http://localhost:3000
```

The API key stays on the server — the browser only talks to this app's own `/api/*` routes.

## How it works

**Section 1 — Verification.** Product name, ingredients, claimed benefits, and a brand voice sample.
`POST /api/verify` asks Claude to act as a scientific claim reviewer and rate every claim
`Supported` / `Partial` / `Unsupported` with a one-sentence reason. Each comes back with a badge.

If any claim is `Unsupported`, Section 2 stays locked and the page says what to fix. If none are,
you get the **Gold Star — Verified** banner and Section 2 appears.

**Section 2 — Strategy & Content.** Unlocking it immediately calls `POST /api/strategy`, which
recommends a target audience, their main concern, and why the product fits — reasoning only from
the claims that passed. **Generate Ad** then calls `POST /api/ad` to write copy in the brand voice,
restricted to the verified claims (`Partial` ones must be hedged).

## Layout

| Path | Role |
| --- | --- |
| `server.js` | Static file server + the three `/api/*` routes that call Claude |
| `public/index.html` | Both sections; Section 2 starts hidden |
| `public/app.js` | Form handling, badge rendering, gating, fetch calls |
| `public/styles.css` | Light background, single accent colour, single column |

Model: `claude-sonnet-4-6`. The two analytical calls use structured outputs so the front end can
gate on `status` values rather than parse prose; the ad generation call returns plain text.
