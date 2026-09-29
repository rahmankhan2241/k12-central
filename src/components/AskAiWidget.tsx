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
type ToolResult = { tool: string; args: unknown; result: Record<string, unknown> };

const MAX_TOOL_ROUNDS = 6;

/**
 * Floating "Ask AI" button + chat panel with an agentic loop:
 *  1. POST question + light page-source descriptor
 *  2. server model replies with either a tool_request (JSON) or the answer
 *  3. we execute the tool locally against live page data (payments rows or
 *     the uploaded GRN file) and re-POST with the result
 *  4. repeat until the model answers (capped rounds)
 */
export default function AskAiWidget({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  async function askOnce(
    history: Msg[],
    toolResults: ToolResult[]
  ): Promise<{ type: "answer"; answer: string; model?: string } | { type: "tool_request"; tool: string; args: unknown; model?: string }> {
    const res = await fetch("/api/ask-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page,
        pageTitle: pageTitle[page] ?? page,
        source,
        messages: history.slice(-12),
        toolResults,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      throw new Error(body.error || `Ask AI failed (${res.status})`);
    }
    return body;
  }

  const send = async (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if (!text || busy) return;
    const withUser = [...messages, { role: "user" as const, content: text }];
    setMessages(withUser);
    setInput("");
    setBusy(true);
    setError(null);
    let history: Msg[] = withUser;
    try {
      const toolResults: ToolResult[] = [];
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        setBusyNote(round === 0 ? "Thinking…" : `Checking the data (${round}/${MAX_TOOL_ROUNDS})…`);
        const reply = await askOnce(history, toolResults);
        if (reply.type === "answer") {
          setMessages([...history, { role: "assistant", content: reply.answer }]);
          return;
        }
        // Tool request → execute locally and continue the loop.
        const result = executeAiTool(reply.tool, reply.args, toolCtx);
        toolResults.push({ tool: reply.tool, args: reply.args, result });
        history = [
          ...history,
          { role: "assistant", content: `[called ${reply.tool} ${JSON.stringify(reply.args ?? {})}]` },
        ];
        setMessages(history);
      }
      setMessages([
        ...history,
        { role: "assistant", content: "I couldn't finish this analysis within my data-lookup budget. Please narrow the question and try again." },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages(history); // keep the user's message visible for a retry
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
        : page === "pending-grn"
          ? null
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
        <div className="askai-panel" role="dialog" aria-label="Ask AI">
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
            <button className="askai-close" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
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
              // Tool-call steps are shown as small status lines, not chat bubbles.
              if (m.role === "assistant" && m.content.startsWith("[called ")) {
                return (
                  <div key={i} className="askai-step" title={m.content}>
                    🔎 Checking the data…
                  </div>
                );
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
