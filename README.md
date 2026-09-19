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

**Section 1 — Verification.** Product name, ingredients, claimed benefits, facility / lab
information, and a brand voice sample. **Submit for Certification** calls `POST /api/verify`, which
asks Claude to act as a scientific claim reviewer and rate every claim `Supported` / `Partial` /
`Unsupported` with a one-sentence reason. Each comes back with a badge.

Facility and lab details are carried on the certification record only. The reviewer is explicitly
told that a certified facility does not make a claim more scientifically supported, so credentials
can't launder a bad claim into a pass — there's a regression test for this.

If any claim is `Unsupported`, Section 2 stays locked and the page says what to fix. If none are,
you get the **Certified — ClaimGuard Approved** banner and Section 2 appears.

**Section 2 — Certification Benefits.** Unlocking it immediately calls `POST /api/strategy`, which
returns six fields, all reasoning only from the claims that passed: target audience, their main
concern, why the product fits, 2–3 consumer concerns, a pricing tier (Budget / Mid-market /
Premium) with rationale, and 2–3 ready-to-use marketing phrases.

Each marketing phrase carries a `backed_by` tag naming the verified claim behind it. That field is
a JSON-schema `enum` built per request from this product's actual claims, so a phrase cannot cite
a benefit that wasn't verified — it's enforced by the schema, not by asking the model.

**Generate Ad** then calls `POST /api/ad` to write copy in the brand voice, restricted to the
verified claims (`Partial` ones must be hedged).

## Layout

| Path | Role |
| --- | --- |
| `server.js` | Static file server + the three `/api/*` routes that call Claude |
| `public/index.html` | Both sections; Section 2 starts hidden |
| `public/app.js` | Form handling, badge rendering, gating, fetch calls |
| `public/styles.css` | Light background, single accent colour, single column |

Model: `claude-sonnet-4-6`. The two analytical calls use structured outputs so the front end can
gate on `status` values rather than parse prose; the ad generation call returns plain text.
