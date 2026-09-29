/**
 * Vercel Serverless Function — "Ask AI" (page-aware assistant).
 *
 * The client sends the page id, a compact pre-aggregated digest of the data
 * currently shown on that page (built client-side from live state), and the
 * conversation so far. This function calls NVIDIA NIM (OpenAI-compatible
 * chat completions) with a strict system prompt: answer ONLY from the
 * provided context, never invent numbers.
 *
 * POST /api/ask-ai
 *   body: { page, pageTitle, context: object, messages: [{role, content}] }
 *   → { ok: true, answer, model }
 *
 * Env vars:
 *   NVIDIA_API_KEY   (required) — key from build.nvidia.com
 *   NVIDIA_MODEL     (optional) — default meta/llama-3.3-70b-instruct
 *   NVIDIA_BASE_URL  (optional) — default https://integrate.api.nvidia.com/v1
 */

const MAX_CONTEXT_CHARS = 60_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_MESSAGES = 12;
const REQUEST_TIMEOUT_MS = 55_000;

/**
 * Model candidates tried in order when one is retired (410), not hosted (404)
 * or not accepted for this key (403). Override with NVIDIA_MODEL (single) or
 * NVIDIA_MODELS (comma-separated list).
 */
const DEFAULT_MODELS = [
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "openai/gpt-oss-20b",
  "mistralai/mistral-large-2-instruct",
];

function modelCandidates() {
  const single = process.env.NVIDIA_MODEL;
  const list = process.env.NVIDIA_MODELS;
  const candidates = [
    ...(single ? [single] : []),
    ...(list ? list.split(",").map((s) => s.trim()).filter(Boolean) : []),
    ...DEFAULT_MODELS,
  ];
  return [...new Set(candidates)];
}

/** Some Nemotron models emit <think>…</think> reasoning — strip it for display. */
function cleanAnswer(text) {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "") // unterminated block: drop the remainder
    .trim();
}

function readBody(req) {
  // Vercel parses JSON bodies into req.body; the dev shim may not.
  if (req.body) return Promise.resolve(req.body);
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function buildSystemPrompt(page, pageTitle, context, today) {
  let contextJson = "";
  try {
    contextJson = JSON.stringify(context, null, 1);
  } catch {
    contextJson = "{}";
  }
  if (contextJson.length > MAX_CONTEXT_CHARS) {
    contextJson = contextJson.slice(0, MAX_CONTEXT_CHARS) + " …(truncated)";
  }
  return [
    `You are "Ask AI", the built-in assistant of the K12 Central System — a logistics console for K12 Techno Services. The user is on the "${pageTitle}" page (${page}).`,
    "",
    "RULES:",
    "1. Answer ONLY from the PAGE CONTEXT JSON below. It holds pre-aggregated statistics computed from the live data on that page. Never invent or estimate numbers.",
    "2. If the context cannot answer the question, say so briefly and suggest what would be needed.",
    "3. One row in the payment data = one student's FIRST payment. So \"total payments for Bangalore in January\" = the count of payment records for that zone in that month. zones[].byMonth already sums all branches of the zone — prefer it over adding branches yourself.",
    "4. Format numbers with Indian digit grouping (e.g. 1,23,456). Dates are yyyy-mm-dd; \"January\" means month 01 of the relevant year.",
    "5. Be concise: give the direct answer first, then at most a few short supporting bullets.",
    "",
    `Today is ${today}.`,
    "",
    "PAGE CONTEXT:",
    contextJson,
  ].join("\n");
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

export default async function handler(req, res) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.method !== "POST") {
    res.writeHead(405, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "POST only" }));
  }

  const apiKey = process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { ...cors, "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({ ok: false, error: "NVIDIA_API_KEY env var is not set — add it in Vercel → Settings → Environment Variables." })
    );
  }

  try {
    const body = await readBody(req);
    const page = String(body.page ?? "").slice(0, 60);
    const pageTitle = String(body.pageTitle ?? page).slice(0, 80);
    const context = body.context && typeof body.context === "object" ? body.context : {};
    const messages = sanitizeMessages(body.messages);
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      res.writeHead(400, { ...cors, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "No user message provided." }));
    }

    const baseUrl = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
    const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

    const systemPrompt = buildSystemPrompt(page, pageTitle, context, today);
    const candidates = modelCandidates();
    let answer = null;
    let usedModel = null;
    let lastError = null;
    for (const model of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const nimRes = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0.1,
            top_p: 0.9,
            max_tokens: 900,
            messages: [{ role: "system", content: systemPrompt }, ...messages],
          }),
        });
        if (!nimRes.ok) {
          const errBody = await nimRes.text().catch(() => "");
          lastError = `NVIDIA API ${nimRes.status} (${model}): ${errBody.slice(0, 200)}`;
          // Retired / unhosted / not-accepted-for-key → try the next candidate.
          if ([410, 404, 403].includes(nimRes.status)) continue;
          throw new Error(lastError);
        }
        const completion = await nimRes.json();
        const content = completion?.choices?.[0]?.message?.content;
        if (!content) {
          lastError = `NVIDIA API (${model}) returned no answer content.`;
          continue;
        }
        answer = cleanAnswer(content);
        usedModel = model;
        break;
      } finally {
        clearTimeout(timer);
      }
    }
    if (!answer) {
      throw new Error(lastError || "NVIDIA API returned no answer for any available model.");
    }
    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, answer, model: usedModel }));
  } catch (e) {
    const msg = e.name === "AbortError" ? "The AI request timed out — try again." : String(e.message || e).slice(0, 400);
    res.writeHead(500, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: msg }));
  }
}
