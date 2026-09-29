/**
 * Vercel Serverless Function — "Ask AI" (agentic, page-aware).
 *
 * The model does NOT get a fixed summary. It gets a light DATA-SOURCE
 * descriptor for the page the user is on plus tool specifications, and it
 * decides what it needs:
 *
 *   model replies {"tool":"query_payments","args":{...}}
 *     → server returns {type:"tool_request"} and the BROWSER executes the
 *       query against the live rows (payments come from Supabase into the
 *       client; the uploaded GRN file exists only in browser memory) and
 *       re-POSTs the result as toolResults.
 *   model replies with prose
 *     → server returns {type:"answer"}.
 *
 * Loop cap: the client stops after MAX_TOOL_ROUNDS tool results; the server
 * tells the model to answer with what it has once the budget is spent.
 *
 * POST /api/ask-ai
 *   body: {
 *     page, pageTitle,
 *     source: <descriptor from src/askAiSource.ts buildPageSource()>,
 *     messages: [{role:"user"|"assistant", content}],
 *     toolResults?: [{tool, args, result}]
 *   }
 *   → { ok:true, type:"tool_request", tool, args, model }
 *     | { ok:true, type:"answer", answer, model, toolsUsed }
 *
 * Env: NVIDIA_API_KEY (required), NVIDIA_MODEL / NVIDIA_MODELS / NVIDIA_BASE_URL (optional).
 */

// Vercel: allow up to 60s per invocation (the client loops tool rounds as
// separate requests, so one invocation = one model round trip).
export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 6_000;
const MAX_MESSAGES = 14;
const MAX_TOOL_RESULT_CHARS = 24_000;
const MAX_TOOL_ROUNDS = 6;
// Per-NIM-attempt timeout. NIM free tier intermittently queues requests for
// minutes; on timeout we fall through to the next candidate model rather
// than failing the whole request.
const REQUEST_TIMEOUT_MS = 45_000;

const DEFAULT_MODELS = [
  "openai/gpt-oss-20b",
  "deepseek-ai/deepseek-v4.1-flash",
];

function modelCandidates() {
  const single = process.env.NVIDIA_MODEL;
  const list = process.env.NVIDIA_MODELS;
  return [...new Set([
    ...(single ? [single] : []),
    ...(list ? list.split(",").map((s) => s.trim()).filter(Boolean) : []),
    ...DEFAULT_MODELS,
  ])];
}

/** Some Nemotron models emit <think>…</think> reasoning — strip it. */
function cleanAnswer(text) {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

function readBody(req) {
  if (req.body) return Promise.resolve(req.body);
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const QUERY_PAYMENTS_SPEC = `{"tool":"query_payments","args":{...}} — filter/count/group the payment rows (source.kind = "payments").
  args (all optional): zones[] , branches[], grades[], studentTypes[] ("New"|"Old"), segments[] ("ICSE"|"OIS"),
    dateFrom "yyyy-mm-dd", dateTo "yyyy-mm-dd",
    groupBy: "zone"|"branch"|"grade"|"student_type"|"segment"|"month"|null, withMonths (bool, default true), limit (1-50, default 10).
  Semantics: one row = one student's FIRST payment, so a count = number of payment records. Month grouping uses first_paid_date (yyyy-mm).
  Branch/zone/grade names must match the data EXACTLY — copy spellings from source.zoneByBranch keys (branches) and source.zones (zones). Grades look like "Grade 1".."Grade 12", "K1", "K2".
  To rank (top-N), set groupBy and read the groups array (already sorted desc by count).`;

const ANALYZE_GRN_SPEC = `{"tool":"analyze_grn","args":{...}} — analyze the uploaded Pending-GRN file (only when source.kind = "grn_file").
  args: filters: [{column, op, value}] with op one of "eq"|"neq"|"contains"|"gt"|"gte"|"lt"|"lte" (all filters AND-ed),
    groupBy: column name or [col1, col2], aggregate: {op: "count"|"sum"|"avg"|"min"|"max", column: <numeric column for sum/avg/min/max>},
    sortBy: {by: "count"|"value"|"group", dir: "asc"|"desc"}, limit (1-100, default 20).
  Column names must match source.columns EXACTLY. With no groupBy and no aggregate, the tool returns the first matching rows (capped) so you can read examples.`;

function buildSystemPrompt(source, today, toolRoundsUsed) {
  const lines = [
    'You are "Ask AI", the assistant embedded in K12 Central System — a logistics console for K12 Techno Services (schools). The user is on the "' + (source.pageTitle || source.page) + '" page.',
    "",
    "DATA SOURCE (the ONLY data you may use):",
    JSON.stringify(source),
    "",
    "You are an AGENT: understand what the user is really asking (rephrase vague wording internally, e.g. \"Bangalore in January\" → zone Bangalore, January of the report's year), fetch exactly the data you need with tools, then answer.",
    "",
    "TOOLS — to call one, reply with ONLY a single JSON object on one line, no prose, no markdown fences:",
    QUERY_PAYMENTS_SPEC,
    ANALYZE_GRN_SPEC,
    "",
    "RULES:",
    "1. If the source kind is \"none\", do NOT call tools — politely answer that this page has no data to analyse and say which pages do.",
    "2. Never guess, estimate or invent numbers. Any figure in your final answer must come from a tool result (or from the source descriptor itself, e.g. total row count).",
    "3. Tool results arrive as messages starting with [TOOL RESULT]. Read them carefully; call another tool if you need a different cut of the data.",
    `4. Tool budget: you may request at most ${MAX_TOOL_ROUNDS} tool calls in total` + (toolRoundsUsed > 0 ? ` (already used: ${toolRoundsUsed})` : "") + ". When the budget is exhausted, answer from what you have.",
    "5. FINAL ANSWER (plain prose, not JSON): direct answer first, numbers with Indian digit grouping (1,23,456), then at most 4 short supporting bullets. Mention the exact filters you applied (e.g. zone, month) when relevant.",
    "6. If the data cannot answer the question (e.g. a field the source doesn't have), say so briefly and suggest what would help.",
    "",
    "Today is " + today + ".",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool-call parsing: the model must reply with a single JSON object.
// ---------------------------------------------------------------------------

function parseToolCall(text) {
  const raw = String(text ?? "").trim();
  if (!raw.startsWith("{")) return null;
  // Tolerate ```json fences or stray prose around the object.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj.tool !== "string") return null;
  const args = obj.args && typeof obj.args === "object" && !Array.isArray(obj.args) ? obj.args : {};
  return { tool: obj.tool, args };
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

function sanitizeToolResults(toolResults) {
  if (!Array.isArray(toolResults)) return [];
  return toolResults
    .filter((t) => t && typeof t.tool === "string" && t.result && typeof t.result === "object")
    .slice(-MAX_TOOL_ROUNDS)
    .map((t) => {
      let json;
      try {
        json = JSON.stringify(t.result);
      } catch {
        json = "{}";
      }
      if (json.length > MAX_TOOL_RESULT_CHARS) json = json.slice(0, MAX_TOOL_RESULT_CHARS) + " …(truncated)";
      const argsJson = JSON.stringify(t.args ?? {});
      return `[TOOL RESULT] you called ${t.tool} with ${argsJson} and got:\n${json}`;
    });
}

// ---------------------------------------------------------------------------
// NIM call with model fallback
// ---------------------------------------------------------------------------

async function callNim({ baseUrl, apiKey, model, systemPrompt, messages, signal }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      top_p: 0.9,
      // Reasoning models (gpt-oss) spend tokens thinking before the answer —
      // a tight budget here empties `content` entirely, a huge one makes
      // responses take minutes. 700 keeps tool-call replies fast.
      max_tokens: 700,
      ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const err = new Error(`NVIDIA API ${res.status} (${model}): ${errBody.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const completion = await res.json();
  return completion?.choices?.[0]?.message?.content ?? "";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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
    const source = body.source && typeof body.source === "object" ? body.source : { kind: "none", page: String(body.page ?? "").slice(0, 60) };
    const messages = sanitizeMessages(body.messages);
    const toolResults = sanitizeToolResults(body.toolResults);

    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      res.writeHead(400, { ...cors, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "No user message provided." }));
    }
    if (toolResults.length >= MAX_TOOL_ROUNDS) {
      res.writeHead(400, { ...cors, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Tool budget exhausted." }));
    }

    const baseUrl = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
    const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    const systemPrompt = buildSystemPrompt(source, today, toolResults.length);

    const nimMessages = [...messages, ...toolResults.map((content) => ({ role: "user", content }))];
    if (toolResults.length > 0 && toolResults.length < MAX_TOOL_ROUNDS) {
      nimMessages.push({
        role: "user",
        content: `[SYSTEM NOTE] Tool results received (${toolResults.length}/${MAX_TOOL_ROUNDS} budget used). Either call another tool (single JSON line) or give the final answer.`,
      });
    }
    if (toolResults.length === MAX_TOOL_ROUNDS - 1) {
      nimMessages.push({
        role: "user",
        content: "[SYSTEM NOTE] This is the LAST tool round. After this result you MUST give the final answer from the data you already have.",
      });
    }

    const candidates = modelCandidates();
    let lastError = null;
    const startedAt = Date.now();
    const TOTAL_BUDGET_MS = 55_000; // stay under the platform's 60s cap
    for (const model of candidates) {
      if (Date.now() - startedAt > TOTAL_BUDGET_MS) break; // give up gracefully
      const controller = new AbortController();
      const remaining = Math.min(REQUEST_TIMEOUT_MS, TOTAL_BUDGET_MS - (Date.now() - startedAt));
      if (remaining < 5_000) break;
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        const content = await callNim({ baseUrl, apiKey, model, systemPrompt, messages: nimMessages, signal: controller.signal });
        const cleaned = cleanAnswer(content);
        if (!cleaned) {
          lastError = `NVIDIA API (${model}) returned no content.`;
          continue;
        }
        const toolCall = parseToolCall(cleaned);
        if (toolCall) {
          res.writeHead(200, { ...cors, "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, type: "tool_request", ...toolCall, model }));
        }
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true, type: "answer", answer: cleaned, model, toolsUsed: toolResults.length }));
      } catch (e) {
        if (e.name === "AbortError") {
          lastError = `NVIDIA API timed out after ${REQUEST_TIMEOUT_MS / 1000}s (${model})`;
          continue; // try the next candidate model
        }
        lastError = e.message;
        // Retired / unhosted / not-accepted-for-key → try the next candidate.
        if ([410, 404, 403, 429, 503].includes(e.status)) continue;
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(
      (lastError || "NVIDIA API returned no answer for any available model.") +
        " — the AI service seems slow right now, please try again shortly."
    );
  } catch (e) {
    const msg = e.name === "AbortError" ? "The AI request timed out — try again." : String(e.message || e).slice(0, 400);
    res.writeHead(500, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: msg }));
  }
}
