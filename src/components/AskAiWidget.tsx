import { useEffect, useMemo, useRef, useState } from "react";
import { buildGenericContext, buildHistoricContext } from "../askAiContext";
import { useHistoricGlobal } from "../useHistoricFetch";
import { useBranchZbhMapping } from "../useBranchZbhMapping";
import { useIcseConfig } from "../useIcseConfig";

type Msg = { role: "user" | "assistant"; content: string };

/**
 * Floating "Ask AI" button + chat panel. Context is built per page from that
 * page's live data, so answers are grounded in what the user is looking at.
 */
export default function AskAiWidget({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const historic = useHistoricGlobal();
  const { rows: mapping } = useBranchZbhMapping();
  const { rows: icseRules } = useIcseConfig();

  const pageTitle: Record<string, string> = {
    home: "Home",
    "pending-grn": "Pending GRN Report",
    "historic-report": "Historic Report — Payment Report",
    settings: "Settings",
  };

  const context = useMemo(() => {
    if (page === "historic-report") {
      const zoneByBranch = new Map<string, string>();
      for (const r of mapping) {
        if (r.zone) zoneByBranch.set(r.branchEduvate, r.zone);
      }
      const icseSet = new Set(icseRules.map((r) => `${r.branch.trim().toLowerCase()}|${r.grade.trim().toLowerCase()}`));
      const exportRows = (historic.rows ?? []).map((r) => ({
        zone: zoneByBranch.get(r.branch) || "(Unmapped)",
        branch: r.branch,
        enrollment_code: r.enrollment_code,
        grade: r.grade,
        student_type: r.student_type,
        segment: icseSet.has(`${r.branch.trim().toLowerCase()}|${r.grade.trim().toLowerCase()}`) ? "ICSE" : "OIS",
        first_paid_date: r.first_paid_date,
      }));
      return buildHistoricContext(exportRows, {
        academicYear: historic.selectedYear,
        note: "Counts reflect ALL rows of the selected year, not the user's active filters.",
      });
    }
    return buildGenericContext(pageTitle[page] ?? page, {
      note: "This page has no analysable data table yet.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, historic.rows, historic.selectedYear, mapping, icseRules]);

  // Auto-scroll to the latest message.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ask-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page,
          pageTitle: pageTitle[page] ?? page,
          context,
          messages: next.slice(-10),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || `Ask AI failed (${res.status})`);
      }
      setMessages([...next, { role: "assistant", content: body.answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages(next); // keep the user's message visible for a retry
    } finally {
      setBusy(false);
    }
  };

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
              <div className="askai-sub">{pageTitle[page] ?? page} · answers come from this page's data</div>
            </div>
            <button className="askai-close" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="askai-list" ref={listRef}>
            {messages.length === 0 && (
              <div className="askai-empty">
                <p>Ask anything about the data on this page, e.g.:</p>
                <button
                  className="askai-chip"
                  onClick={() => setInput("What are the total payments for Bangalore branch zone in January?")}
                >
                  “Total payments for Bangalore in January?”
                </button>
                <button className="askai-chip" onClick={() => setInput("Which 5 branches have the most students?")}>
                  “Top 5 branches by students?”
                </button>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`askai-msg ${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && <div className="askai-msg assistant askai-thinking">Thinking…</div>}
            {error && <div className="askai-err">{error}</div>}
          </div>

          <div className="askai-inputrow">
            <input
              value={input}
              placeholder="Ask about this page's data…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              disabled={busy}
            />
            <button className="askai-send" onClick={send} disabled={busy || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
