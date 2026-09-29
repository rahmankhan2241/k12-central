/**
 * Vercel Serverless Function — "Ask AI" (agentic, page-aware).
 *
 * The model does NOT get a fixed summary. It gets a light DATA-SOURCE
 * descriptor for the page the user is on plus NATIVE tool declarations
 * (OpenAI-style `tools`), and it decides what it needs:
 *
 *   model returns tool_calls → server replies {type:"tool_request", calls:[…]}
 *     and the BROWSER executes them against the live rows (payments come from
 *     Supabase into the client; the uploaded GRN file exists only in browser
 *     memory) and re-POSTs the results as toolResults.
 *   model returns prose → server replies {type:"answer"}.
 *
 * The user only ever sees the final prose answer; tool activity is a client-
 * side status line and the tool-call markers are stripped from chat history
 * before it reaches this function.
 *
 * POST /api/ask-ai
 *   body: {
 *     page, pageTitle,
 *     source: <descriptor from src/askAiSource.ts buildPageSource()>,
 *     messages: [{role:"user"|"assistant", content}],
 *     toolResults?: [{tool, args, result, toolCallId}]
 *   }
 *   → { ok:true, type:"tool_request", calls:[{tool, args, toolCallId}], model }
 *     | { ok:true, type:"answer", answer, model, toolsUsed }
 *
 * Env (provider chain — first key present wins, later ones are fallbacks):
 *   GROQ_API_KEY     — Groq (fastest, tried first)
 *   NVIDIA_API_KEY   — NVIDIA NIM — fallback
 *   AI_API_KEY + AI_BASE_URL (+ AI_MODEL/AI_MODELS) — any OpenAI-compatible service
 */

// Vercel: allow up to 60s per invocation (the client loops tool rounds as
// separate requests, so one invocation = one model round trip).
export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 6_000;
const MAX_MESSAGES = 14;
const MAX_TOOL_RESULT_CHARS = 24_000;
const MAX_TOOL_ROUNDS = 6;
// Per-attempt timeout; on timeout/4xx we fall through to the next candidate.
const REQUEST_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Provider chain
// ---------------------------------------------------------------------------

const GROQ_BASE = "https://api.groq.com/openai/v1";
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

const GROQ_MODELS = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
const NVIDIA_MODELS_DEFAULT = ["openai/gpt-oss-20b", "deepseek-ai/deepseek-v4.1-flash"];

function providerChain() {
  const chain = [];
  const envList = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null);

  if (process.env.GROQ_API_KEY) {
    chain.push({
      name: "groq",
      baseUrl: GROQ_BASE,
      apiKey: process.env.GROQ_API_KEY,
      models: [...(envList(process.env.AI_MODELS) ?? []), ...(envList(process.env.GROQ_MODEL) ?? []), ...GROQ_MODELS],
    });
  }
  if (process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY) {
    chain.push({
      name: "nvidia",
      baseUrl: (process.env.NVIDIA_BASE_URL || NVIDIA_BASE).replace(/\/+$/, ""),
      apiKey: process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY,
      models: [...(envList(process.env.NVIDIA_MODEL) ?? []), ...NVIDIA_MODELS_DEFAULT],
    });
  }
  if (process.env.AI_API_KEY && process.env.AI_BASE_URL) {
    chain.push({
      name: "custom",
      baseUrl: process.env.AI_BASE_URL.replace(/\/+$/, ""),
      apiKey: process.env.AI_API_KEY,
      models: envList(process.env.AI_MODEL) ?? envList(process.env.AI_MODELS) ?? [],
    });
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Tool declarations (native OpenAI-style tool calling)
// ---------------------------------------------------------------------------

const QUERY_PAYMENTS_SCHEMA = {
  type: "function",
  function: {
    name: "query_payments",
    description:
      "Filter, count and group the payment rows (source.kind = 'payments'). One row = one student's FIRST payment, so a count = number of payment records. Copy zone/branch/grade names EXACTLY from the data source. Omit groupBy for a single total; use groupBy 'month' for month-wise counts (first_paid_date, yyyy-mm).",
    parameters: {
      type: "object",
      properties: {
        zones: { type: "array", items: { type: "string" }, description: 'Zone names, e.g. ["Bangalore"]' },
        branches: { type: "array", items: { type: "string" }, description: "Branch names exactly as in source.zoneByBranch keys" },
        grades: { type: "array", items: { type: "string" }, description: 'e.g. ["Grade 6"] or ["K1"]' },
        studentTypes: { type: "array", items: { type: "string", enum: ["New", "Old"] } },
        segments: { type: "array", items: { type: "string", enum: ["ICSE", "OIS"] } },
        dateFrom: { type: "string", description: "inclusive yyyy-mm-dd" },
        dateTo: { type: "string", description: "inclusive yyyy-mm-dd" },
        groupBy: {
          type: "string",
          enum: ["zone", "branch", "grade", "student_type", "segment", "month"],
          description: "omit for a single total",
        },
        withMonths: { type: "boolean", description: "include per-group month breakdown (default true)" },
        limit: { type: "number", description: "max groups returned, 1-50 (default 10)" },
      },
    },
  },
};

const ANALYZE_GRN_SCHEMA = {
  type: "function",
  function: {
    name: "analyze_grn",
    description:
      "Analyze the uploaded Pending-GRN file (source.kind = 'grn_file'). Column names must match source.columns EXACTLY. With no groupBy and no aggregate, returns the first matching rows (capped) so you can read examples.",
    parameters: {
      type: "object",
      properties: {
        filters: {
          type: "array",
          description: "filters AND-ed together",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              op: { type: "string", enum: ["eq", "neq", "contains", "gt", "gte", "lt", "lte"] },
              value: { description: "comparison value" },
            },
            required: ["column", "op", "value"],
          },
        },
        groupBy: {
          type: ["string", "array"],
          items: { type: "string" },
          description: "column name, or array of column names for multi-level grouping",
        },
        aggregate: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["count", "sum", "avg", "min", "max"] },
            column: { type: "string", description: "numeric column for sum/avg/min/max" },
          },
        },
        sortBy: {
          type: "object",
          properties: {
            by: { type: "string", enum: ["count", "value", "group"] },
            dir: { type: "string", enum: ["asc", "desc"] },
          },
        },
        limit: { type: "number", description: "1-100 (default 20)" },
      },
    },
  },
};

const TOOLS = [QUERY_PAYMENTS_SCHEMA, ANALYZE_GRN_SCHEMA];

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** Some models emit <think>…</think> reasoning — strip it. */
function cleanAnswer(text) {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

function buildSystemPrompt(source, today, toolRoundsUsed) {
  const lines = [
    'You are "Ask AI", the assistant embedded in K12 Central System — a logistics console for K12 Techno Services (schools). The user is on the "' + (source.pageTitle || source.page) + '" page.',
    "",
    "DATA SOURCE (the ONLY data you may use):",
    JSON.stringify(source),
    "",
    'You are an AGENT: understand what the user is really asking (rephrase vague wording internally, e.g. "Bangalore in January" → zone Bangalore, January of the report\'s year), call the tools silently to fetch exactly the data you need, then give the final answer.',
    "",
    "RULES:",
    "1. Get every figure from a tool result (or the source descriptor itself). NEVER state a number you have not fetched. NEVER narrate or describe tool calls in prose — just call them; the user sees only your final answer.",
    '2. If the source kind is "none", do NOT call tools — politely answer that this page has no data to analyse and mention which pages do (Historic Report — payment data; Pending GRN — after a file is uploaded).',
    `3. Tool budget: at most ${MAX_TOOL_ROUNDS} tool calls in total` + (toolRoundsUsed > 0 ? ` (already used: ${toolRoundsUsed})` : "") + ". Once you have enough data (or the budget is spent), answer.",
    '4. FINAL ANSWER — plain prose, NOT JSON, no tool talk: direct answer first (e.g. "Total payments for Bangalore in January is 2,841."), numbers with Indian digit grouping (1,23,456), then at most 4 short supporting bullets. Mention the filters you applied when relevant.',
    "5. If the data cannot answer the question (e.g. a field the source doesn't have), say so briefly and suggest what would help.",
    "",
    "Today is " + today + ".",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

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

/** Fallback: parse a tool call the model wrote as text. */
function parseToolCall(text) {
  const raw = String(text ?? "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.tool === "string") {
    let args = obj.args && typeof obj.args === "object" && !Array.isArray(obj.args) ? obj.args : {};
    if (typeof args.tool === "string" && args.args && typeof args.args === "object") args = args.args;
    return { tool: obj.tool, args };
  }
  if (typeof obj.name === "string" && obj.arguments && typeof obj.arguments === "object") {
    return { tool: obj.name.replace(/^tool_/, ""), args: obj.arguments };
  }
  return null;
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
    .map((t) => ({
      tool: String(t.tool).slice(0, 60),
      args: t.args && typeof t.args === "object" ? t.args : {},
      result: t.result,
      toolCallId: typeof t.toolCallId === "string" ? t.toolCallId.slice(0, 80) : null,
    }));
}

function toolResultJson(tr) {
  let json;
  try {
    json = JSON.stringify(tr.result);
  } catch {
    json = "{}";
  }
  return json.length > MAX_TOOL_RESULT_CHARS ? json.slice(0, MAX_TOOL_RESULT_CHARS) + " …(truncated)" : json;
}

// ---------------------------------------------------------------------------
// Provider call (native tools) — returns the assistant message object
// ---------------------------------------------------------------------------

async function callChat({ baseUrl, apiKey, model, systemPrompt, messages, signal }) {
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
      // a tight budget here empties `content`, a huge one makes responses
      // take minutes. 700 keeps replies fast.
      max_tokens: 700,
      ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
      tools: TOOLS,
      tool_choice: "auto",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    // Some models emit a tool call even when tools weren't declared; the API
    // 400s with tool_use_failed but includes the raw generation — recover it.
    const fg = /"failed_generation"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(errBody);
    if (fg) {
      try {
        return { content: JSON.parse(`"${fg[1]}"`) }; // unescape \n, \" etc.
      } catch {
        /* fall through to normal error */
      }
    }
    const err = new Error(`AI API ${res.status} (${model}): ${errBody.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const completion = await res.json();
  return completion?.choices?.[0]?.message ?? null;
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

  const chain = providerChain();
  if (chain.length === 0) {
    res.writeHead(500, { ...cors, "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({ ok: false, error: "No AI provider key is configured — set GROQ_API_KEY (recommended) or NVIDIA_API_KEY in Vercel → Settings → Environment Variables." })
    );
  }

  try {
    const body = await readBody(req);
    const source = body.source && typeof body.source === "object" ? body.source : { kind: "none", page: String(body.page ?? "").slice(0, 60) };
    const messages = sanitizeMessages(body.messages);
    const toolResults = sanitizeToolResults(body.toolResults);

    // The client strips its display-only tool markers, so the last entry is a
    // user message on round 1 and reconstructed tool messages follow on later
    // rounds — requiring a user message SOMEWHERE is enough.
    if (!messages.some((m) => m.role === "user")) {
      res.writeHead(400, { ...cors, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "No user message provided." }));
    }

    const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    const systemPrompt = buildSystemPrompt(source, today, toolResults.length);

    const nimMessages = [...messages];
    for (const tr of toolResults) {
      const resultJson = toolResultJson(tr);
      if (tr.toolCallId) {
        // Native tool-calling continuation (OpenAI pattern).
        nimMessages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: tr.toolCallId,
              type: "function",
              function: { name: tr.tool, arguments: JSON.stringify(tr.args ?? {}) },
            },
          ],
        });
        nimMessages.push({ role: "tool", tool_call_id: tr.toolCallId, content: resultJson });
      } else {
        // Text-protocol fallback for providers that didn't return native calls.
        nimMessages.push({
          role: "user",
          content: `[TOOL RESULT] you called ${tr.tool} with ${JSON.stringify(tr.args ?? {})} and got:\n${resultJson}`,
        });
      }
    }
    if (toolResults.length >= MAX_TOOL_ROUNDS) {
      nimMessages.push({
        role: "user",
        content: "[SYSTEM NOTE] Tool budget exhausted. Give the FINAL ANSWER now from the data you already have.",
      });
    } else if (toolResults.length > 0) {
      nimMessages.push({
        role: "user",
        content: `[SYSTEM NOTE] Tool results received (${toolResults.length}/${MAX_TOOL_ROUNDS}). Call another tool if needed, or give the final answer.`,
      });
    }

    let lastError = null;
    const startedAt = Date.now();
    const TOTAL_BUDGET_MS = 55_000; // stay under the platform's 60s cap
    outer: for (const provider of chain) {
      for (const model of provider.models) {
        const elapsed = Date.now() - startedAt;
        if (elapsed > TOTAL_BUDGET_MS) break outer;
        const remaining = Math.min(REQUEST_TIMEOUT_MS, TOTAL_BUDGET_MS - elapsed);
        if (remaining < 5_000) break outer;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), remaining);
        const tag = `${provider.name}:${model}`;
        try {
          const msg = await callChat({
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model,
            systemPrompt,
            messages: nimMessages,
            signal: controller.signal,
          });

          // Native tool calls take priority over prose.
          const rawCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
          const content = cleanAnswer(msg?.content ?? "");
          if (rawCalls.length === 0 && content) {
            const tc = parseToolCall(content); // text fallback
            if (tc) rawCalls.push({ id: null, function: { name: tc.tool, arguments: JSON.stringify(tc.args) } });
          }
          if (rawCalls.length > 0) {
            const calls = [];
            for (const tc of rawCalls.slice(0, 3)) {
              const fn = tc?.function ?? {};
              let args = {};
              try {
                args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments || "{}") : fn.arguments ?? {};
              } catch {
                args = {};
              }
              const name = String(fn.name ?? "").replace(/^tool_/, "");
              if (name) calls.push({ tool: name, args, toolCallId: typeof tc.id === "string" ? tc.id : null });
            }
            if (calls.length > 0) {
              res.writeHead(200, { ...cors, "Content-Type": "application/json" });
              return res.end(JSON.stringify({ ok: true, type: "tool_request", calls, model: tag }));
            }
          }
          if (!content) {
            lastError = `${tag} returned no content.`;
            continue;
          }
          res.writeHead(200, { ...cors, "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, type: "answer", answer: content, model: tag, toolsUsed: toolResults.length }));
        } catch (e) {
          if (e.name === "AbortError") {
            lastError = `AI timed out after ${REQUEST_TIMEOUT_MS / 1000}s (${tag})`;
            continue; // try the next candidate
          }
          lastError = e.message;
          // Retired / unhosted / rate-limited / unavailable → next candidate.
          if ([410, 404, 403, 429, 503].includes(e.status)) continue;
          break outer;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw new Error(
      (lastError || "No AI provider returned an answer.") +
        " — the AI service seems slow right now, please try again shortly."
    );
  } catch (e) {
    const msg = e.name === "AbortError" ? "The AI request timed out — try again." : String(e.message || e).slice(0, 400);
    res.writeHead(500, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: msg }));
  }
}
