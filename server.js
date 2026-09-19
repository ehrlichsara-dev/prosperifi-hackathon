import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

const MODEL = "claude-sonnet-4-6";
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

const client = new Anthropic();

/* ---------------------------------------------------------------- schemas */

const VerificationFormat = jsonSchemaOutputFormat({
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string", description: "The claim, quoted close to how the user wrote it." },
          status: { type: "string", enum: ["Supported", "Partial", "Unsupported"] },
          reason: { type: "string", description: "Exactly one sentence." },
        },
        required: ["claim", "status", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
});

const StrategyFormat = jsonSchemaOutputFormat({
  type: "object",
  properties: {
    target_audience: { type: "string" },
    main_concern: { type: "string" },
    why_it_fits: { type: "string" },
  },
  required: ["target_audience", "main_concern", "why_it_fits"],
  additionalProperties: false,
});

/* -------------------------------------------------------------- api calls */

async function verifyClaims({ productName, ingredients, claims }) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system:
      "You are a scientific claim reviewer for cosmetic and skincare marketing. " +
      "You assess whether a product's advertised benefits are plausibly supported by its " +
      "ingredient list, using general dermatological and cosmetic science knowledge. " +
      "Rate each claim:\n" +
      "- Supported: an ingredient at a typical cosmetic use level is well established to produce this effect.\n" +
      "- Partial: there is some evidence or a related but weaker/narrower effect, or the effect depends on " +
      "concentration, formulation, or duration that is not stated.\n" +
      "- Unsupported: no ingredient present plausibly produces this effect, or the claim overstates what " +
      "a topical cosmetic can do (e.g. structural, medical, or permanent changes).\n" +
      "Give exactly one sentence of reasoning per claim, naming the relevant ingredient where possible. " +
      "Return one entry per distinct claim the user listed, quoting each claim close to how it was written.",
    output_config: { effort: "medium", format: VerificationFormat },
    messages: [
      {
        role: "user",
        content:
          `Product name: ${productName}\n\n` +
          `Ingredients:\n${ingredients}\n\n` +
          `Claimed benefits:\n${claims}`,
      },
    ],
  });

  if (!response.parsed_output) throw new Error("Model did not return a parseable verification.");
  return response.parsed_output;
}

async function recommendStrategy({ productName, ingredients, verifiedClaims }) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system:
      "You are a skincare brand strategist. Given a product and the claims that survived scientific " +
      "review, recommend the single best target audience to market it to. Base the recommendation only " +
      "on the verified claims and the ingredient list — never on a benefit that was not verified. " +
      "Be specific and concrete: a real segment of people, not 'everyone who wants good skin'. " +
      "Two to three sentences per field.",
    output_config: { effort: "low", format: StrategyFormat },
    messages: [
      {
        role: "user",
        content:
          `Product name: ${productName}\n\n` +
          `Ingredients:\n${ingredients}\n\n` +
          `Verified claims:\n${formatClaims(verifiedClaims)}`,
      },
    ],
  });

  if (!response.parsed_output) throw new Error("Model did not return a parseable recommendation.");
  return response.parsed_output;
}

async function generateAd({ productName, brandVoice, verifiedClaims, strategy }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system:
      "You are a copywriter. Write one short ad (60-110 words) for the product, matching the brand voice " +
      "sample's tone, rhythm, and vocabulary.\n\n" +
      "Hard rules:\n" +
      "- Use ONLY the verified claims supplied. Do not invent, extrapolate, or imply any other benefit.\n" +
      "- Claims marked Supported may be stated plainly.\n" +
      "- Claims marked Partial must be hedged (e.g. 'helps', 'can support') and never stated as a guarantee.\n" +
      "- No medical or drug claims, no 'clinically proven' unless that exact wording was verified.\n\n" +
      "Output the ad copy only — no headings, no preamble, no notes.",
    messages: [
      {
        role: "user",
        content:
          `Product name: ${productName}\n\n` +
          `Brand voice sample:\n${brandVoice}\n\n` +
          `Target audience: ${strategy.target_audience}\n` +
          `Their main concern: ${strategy.main_concern}\n\n` +
          `Verified claims:\n${formatClaims(verifiedClaims)}`,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Model returned no ad copy.");
  return { ad: text };
}

function formatClaims(claims) {
  return claims.map((c) => `- [${c.status}] ${c.claim} (${c.reason})`).join("\n");
}

/* ----------------------------------------------------------------- routes */

const routes = {
  "/api/verify": async (body) => {
    requireFields(body, ["productName", "ingredients", "claims"]);
    return verifyClaims(body);
  },
  "/api/strategy": async (body) => {
    requireFields(body, ["productName", "ingredients", "verifiedClaims"]);
    return recommendStrategy(body);
  },
  "/api/ad": async (body) => {
    requireFields(body, ["productName", "brandVoice", "verifiedClaims", "strategy"]);
    return generateAd(body);
  },
};

function requireFields(body, fields) {
  for (const field of fields) {
    const value = body?.[field];
    const empty = value == null || (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && value.length === 0);
    if (empty) throw new HttpError(400, `Missing required field: ${field}`);
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------ http server */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    const handler = routes[url.pathname];
    if (!handler || req.method !== "POST") return send(res, 404, { error: "Not found" });
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      return send(res, 500, {
        error: "No Anthropic credentials. Copy .env.example to .env, add ANTHROPIC_API_KEY, and restart.",
      });
    }
    try {
      const result = await handler(await readJson(req));
      send(res, 200, result);
    } catch (error) {
      send(res, statusOf(error), { error: messageOf(error) });
      if (!(error instanceof HttpError)) console.error(error);
    }
    return;
  }

  await serveStatic(url.pathname, res);
});

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Request body was not valid JSON.");
  }
}

function statusOf(error) {
  if (error instanceof HttpError) return error.status;
  if (error instanceof Anthropic.APIError) return error.status ?? 502;
  return 500;
}

function messageOf(error) {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) {
    return "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in your .env file.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited by the Anthropic API — wait a moment and try again.";
  }
  if (error instanceof Anthropic.APIError) return `Anthropic API error ${error.status}: ${error.message}`;
  return error.message || "Something went wrong.";
}

async function serveStatic(pathname, res) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, relative);

  // Keep requests inside public/ regardless of what the path contains.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("Warning: ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.\n");
}

server.listen(PORT, () => {
  console.log(`Skincare marketing tool running at http://localhost:${PORT}`);
});
