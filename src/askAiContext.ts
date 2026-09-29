import type { PaymentExportRow } from "./exportPaymentExcel";

/**
 * Compact, pre-aggregated "page context" handed to Ask AI. The AI never sees
 * raw rows (too big) — it sees summaries computed from exactly the data the
 * page shows, so its answers match what the user is looking at.
 */

export type AskAiContext = Record<string, unknown>;

function monthKeyOf(dateStr: string): string | null {
  // first_paid_date is yyyy-mm-dd in the DB snapshot.
  const m = /^(\d{4})-(\d{2})/.exec(String(dateStr).trim());
  return m ? `${m[1]}-${m[2]}` : null;
}

function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

/**
 * First-payment counts from the currently filtered rows:
 *  - per zone (with per-zone month breakdown across all its branches)
 *  - per branch (with per-branch month breakdown)
 *  - per grade / student type / segment, plus overall month totals.
 */
function paymentDigest(rows: PaymentExportRow[]) {
  const zoneCount = new Map<string, number>();
  const zoneMonths = new Map<string, Map<string, number>>();
  const branchCount = new Map<string, number>();
  const branchMonths = new Map<string, Map<string, number>>();
  const gradeCount = new Map<string, number>();
  const typeCount = new Map<string, number>();
  const segmentCount = new Map<string, number>();
  const allMonths = new Map<string, number>();
  let total = 0;

  for (const r of rows) {
    total++;
    const mk = monthKeyOf(r.first_paid_date);
    if (mk) bump(allMonths, mk);
    if (r.zone) bump(zoneCount, r.zone);
    bump(branchCount, r.branch);
    bump(gradeCount, r.grade);
    bump(typeCount, r.student_type);
    bump(segmentCount, r.segment);
    if (!mk) continue;
    if (r.zone) {
      const zm = zoneMonths.get(r.zone) ?? new Map<string, number>();
      bump(zm, mk);
      zoneMonths.set(r.zone, zm);
    }
    const bm = branchMonths.get(r.branch) ?? new Map<string, number>();
    bump(bm, mk);
    branchMonths.set(r.branch, bm);
  }

  const objOf = (m: Map<string, number>) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));

  return {
    totalStudents: total,
    zones: [...zoneCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([zone, count]) => ({
        zone,
        students: count,
        byMonth: objOf(zoneMonths.get(zone) ?? new Map()),
      })),
    branches: [...branchCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([branch, count]) => ({ branch, students: count, byMonth: objOf(branchMonths.get(branch) ?? new Map()) })),
    byGrade: objOf(gradeCount),
    byStudentType: objOf(typeCount),
    bySegment: objOf(segmentCount),
    allMonths: objOf(allMonths),
  };
}

export function buildHistoricContext(
  rows: PaymentExportRow[],
  extra: Record<string, unknown>
): AskAiContext {
  return {
    report: "Payment Report (one row = one student's FIRST payment for that ERP)",
    rowDescription:
      "row fields: zone, branch, enrollment_code, grade, student_type (New/Old), segment (ICSE/OIS), first_paid_date (yyyy-mm-dd). Counts below are computed from the rows currently MATCHING the user's filters.",
    ...extra,
    rowsSummary: paymentDigest(rows),
  };
}

export function buildGenericContext(pageTitle: string, extra: Record<string, unknown>): AskAiContext {
  return { page: pageTitle, ...extra };
}
