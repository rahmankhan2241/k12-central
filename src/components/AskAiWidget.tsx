import { useEffect, useMemo, useRef, useState } from "react";
import { useHistoricGlobal } from "../useHistoricFetch";
import { useBranchZbhMapping } from "../useBranchZbhMapping";
import { useIcseConfig } from "../useIcseConfig";
import {
  buildPageSource,
  enrichPayments,
  executeAiTool,
  useGrnSource,
  type GrnSource,
  type PaymentRowLite,
} from "../askAiSource";

type Msg = { role: "user" | "assistant"; content: string };
type ToolResult = {
  tool: string;
  args: unknown;
  result: Record<string, unknown>;
  toolCallId: string | null;
};

const MAX_TOOL_ROUNDS = 6;

/** Server-injected interpretation (middle agent) — replayed silently, never shown. */
const INTERPRETATION_PREFIX = "[QUERY INTERPRETATION]";

type View = "normal" | "stretch" | "full";

function StretchIcon({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {on ? (
        <>
          <path d="M4 14h6v6" />
          <path d="M20 10h-6V4" />
          <path d="M14 10l7-7" />
          <path d="M3 21l7-7" />
        </>
      ) : (
        <>
          <path d="M15 3h6v6" />
          <path d="M9 21H3v-6" />
          <path d="M21 3l-7 7" />
          <path d="M3 21l7-7" />
        </>
      )}
    </svg>
  );
}

function FullscreenIcon({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {on ? (
        <>
          <path d="M8 3v3a2 2 0 0 1-2 2H3" />
          <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
          <path d="M3 16h3a2 2 0 0 1 2 2v3" />
          <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
        </>
      ) : (
        <>
          <path d="M8 3H5a2 2 0 0 0-2 2v3" />
          <path d="M16 3h3a2 2 0 0 1 2 2v3" />
          <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
          <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        </>
      )}
    </svg>
  );
}

/**
 * Floating "Ask AI" button + chat panel with an agentic loop:
 *  1. POST question + light page-source descriptor
 *  2. server model replies with native tool_calls or the final answer
 *  3. we execute the tools locally against live page data and re-POST
 *  4. repeat until the model answers (capped rounds)
 *
 * The user only ever sees their question and the final answer; tool activity
 * is a transient status line while the loop runs.
 */
export default function AskAiWidget({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("normal");
  const listRef = useRef<HTMLDivElement>(null);

  const historic = useHistoricGlobal();
  const { rows: mapping } = useBranchZbhMapping();
  const { rows: icseRules } = useIcseConfig();
  const grn = useGrnSource();

  const pageTitle: Record<string, string> = {
    home: "Home",
    "pending-grn": "Pending GRN Report",
    "historic-report": "Historic Report — Payment Report",
    settings: "Settings",
  };

  // Live tool context for the page the user is on.
  const toolCtx = useMemo(() => {
    if (page === "historic-report") {
      const zoneByBranch = new Map<string, string>();
      for (const r of mapping) {
        if (r.zone) zoneByBranch.set(r.branchEduvate, r.zone);
      }
      const icseKeys = new Set(
        icseRules.map((r) => `${r.branch.trim().toLowerCase()}|${r.grade.trim().toLowerCase()}`)
      );
      const rows: PaymentRowLite[] = enrichPayments(historic.rows ?? [], zoneByBranch, icseKeys);
      return { paymentsRows: rows, grn: null as GrnSource | null };
    }
    if (page === "pending-grn") {
      return { paymentsRows: undefined, grn };
    }
    return { paymentsRows: undefined, grn: null };
  }, [page, historic.rows, mapping, icseRules, grn]);

  const source = useMemo(
    () =>
      buildPageSource({
        page,
        pageTitle: pageTitle[page] ?? page,
        historicRows: page === "historic-report" ? historic.rows ?? [] : undefined,
        year: historic.selectedYear,
        zoneByBranch:
          page === "historic-report"
            ? new Map(mapping.filter((r) => r.zone).map((r) => [r.branchEduvate, r.zone]))
            : undefined,
        icseRules: page === "historic-report" ? icseRules : undefined,
        grn: page === "pending-grn" ? grn : null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, historic.rows, historic.selectedYear, mapping, icseRules, grn]
  );

  // Auto-scroll to the latest message.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy, busyNote]);

  // Escape steps back out of fullscreen / stretch (never closes the chat).
  useEffect(() => {
    if (!open || view === "normal") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setView("normal");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, view]);

  const send = async (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if (!text || busy) return;
    const withUser: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(withUser);
    setInput("");
    setBusy(true);
    setError(null);
    let history: Msg[] = withUser;
    try {
      // Display-only tool markers, kept out of what the server receives.
      let display: Msg[] = [...history];
      const toolResults: ToolResult[] = [];
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        setBusyNote(round === 0 ? "Thinking…" : `Checking the data (${round}/${MAX_TOOL_ROUNDS})…`);
        const res = await fetch("/api/ask-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            page,
            pageTitle: pageTitle[page] ?? page,
            source,
            // History WITHOUT tool markers or interpreter notes: prose only.
            // (The server re-injects a fresh interpretation for each new question.)
            messages: history.filter((m) => !m.content.startsWith("[called ") && !m.content.startsWith(INTERPRETATION_PREFIX)).slice(-12),
            toolResults,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          throw new Error(body.error || `Ask AI failed (${res.status})`);
        }
        if (body.type === "answer") {
          setMessages([...history, { role: "assistant", content: body.answer }]);
          return;
        }
        // The server may attach the middle agent's interpretation as a user
        // note — keep it in the loop history (silently) so later rounds see it.
        if (body.interpretation) {
          history = [...history, { role: "user", content: String(body.interpretation).slice(0, 3000) }];
        }
        // Tool request → execute locally, track results, show a status line.
        const calls: Array<{ tool: string; args: unknown; toolCallId: string | null }> = Array.isArray(body.calls)
          ? body.calls
          : [{ tool: body.tool, args: body.args, toolCallId: null }];
        display = [...history, { role: "assistant", content: `[called ${calls.map((c) => c.tool).join(", ")}]` }];
        setMessages(display);
        for (const c of calls) {
          const result = executeAiTool(c.tool, c.args, toolCtx);
          toolResults.push({ tool: c.tool, args: c.args, result, toolCallId: c.toolCallId ?? null });
        }
        history = [
          ...history,
          { role: "assistant", content: `[called ${calls.map((c) => c.tool).join(", ")}]` },
        ];
      }
      setMessages([
        ...history,
        { role: "assistant", content: "I couldn't finish this analysis within my data-lookup budget. Please narrow the question and try again." },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Keep the user msg for retry; drop tool/interpreter plumbing.
      setMessages(history.filter((m) => !m.content.startsWith("[called ") && !m.content.startsWith(INTERPRETATION_PREFIX)));
    } finally {
      setBusy(false);
      setBusyNote("");
    }
  };

  const suggestions =
    page === "historic-report"
      ? ["What are the total payments for Bangalore branch zone in January?", "Which 5 branches have the most students?", "How many ICSE students paid in March 2026?"]
      : page === "pending-grn" && grn
        ? ["Which vendor has the most pending GRNs?", "Show a summary by status column", "What is the average value by branch?"]
        : null;

  return (
    <>
      {!open && (
        <button className="askai-fab" onClick={() => setOpen(true)} aria-label="Ask AI" title="Ask AI about this page's data">
          <span className="askai-fab-icon" aria-hidden>✦</span>
          Ask AI
        </button>
      )}
      {open && (
        <div
          className={`askai-panel ${view === "stretch" ? "askai-stretch" : ""} ${
            view === "full" ? "askai-full" : ""
          }`}
          role="dialog"
          aria-label="Ask AI"
        >
          <div className="askai-head">
            <span className="askai-head-icon" aria-hidden>✦</span>
            <div>
              <div className="askai-title">Ask AI</div>
              <div className="askai-sub">
                {pageTitle[page] ?? page}
                {source.kind === "payments" && ` · ${source.rowCount.toLocaleString("en-IN")} rows · ${source.year}`}
                {source.kind === "grn_file" && ` · ${grn?.fileName ?? source.fileName} · ${source.rowCount.toLocaleString("en-IN")} rows`}
                {source.kind === "none" && " · no data on this page"}
              </div>
            </div>
            <div className="askai-head-actions">
              <button
                className={`askai-iconbtn ${view === "stretch" ? "on" : ""}`}
                onClick={() => setView((v) => (v === "stretch" ? "normal" : "stretch"))}
                aria-label={view === "stretch" ? "Back to normal size" : "Stretch the panel"}
                title={view === "stretch" ? "Back to normal size" : "Stretch — larger panel"}
              >
                <StretchIcon on={view === "stretch"} />
              </button>
              <button
                className={`askai-iconbtn ${view === "full" ? "on" : ""}`}
                onClick={() => setView((v) => (v === "full" ? "normal" : "full"))}
                aria-label={view === "full" ? "Exit full screen" : "Full screen"}
                title={view === "full" ? "Exit full screen" : "Full screen"}
              >
                <FullscreenIcon on={view === "full"} />
              </button>
              <button
                className="askai-iconbtn"
                onClick={() => setOpen(false)}
                aria-label="Close"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="askai-list" ref={listRef}>
            {messages.length === 0 && (
              <div className="askai-empty">
                {source.kind === "none" ? (
                  <p>This page has no data to analyse. Ask AI works on the Historic Report (payment data) and the Pending GRN Report (after you upload a file).</p>
                ) : (
                  <>
                    <p>Ask anything about the data on this page — the AI will look up what it needs, e.g.:</p>
                    {(suggestions ?? []).map((s) => (
                      <button key={s} className="askai-chip" onClick={() => void send(s)}>
                        “{s}”
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            {messages.map((m, i) => {
              // Interpreter notes are loop plumbing — never rendered.
              if (m.role === "user" && m.content.startsWith(INTERPRETATION_PREFIX)) return null;
              // Tool-call steps are hidden entirely while the loop is idle —
              // only the transient status line shows activity.
              if (m.role === "assistant" && m.content.startsWith("[called ")) {
                return busy ? (
                  <div key={i} className="askai-step">🔎 Checking the data…</div>
                ) : null;
              }
              return (
                <div key={i} className={`askai-msg ${m.role}`}>
                  {m.content}
                </div>
              );
            })}
            {busy && <div className="askai-msg assistant askai-thinking">{busyNote || "Thinking…"}</div>}
            {error && <div className="askai-err">{error}</div>}
          </div>

          <div className="askai-inputrow">
            <input
              value={input}
              placeholder={source.kind === "none" ? "No data on this page…" : "Ask about this page's data…"}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void send()}
              disabled={busy || source.kind === "none"}
            />
            <button className="askai-send" onClick={() => void send()} disabled={busy || !input.trim() || source.kind === "none"}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
