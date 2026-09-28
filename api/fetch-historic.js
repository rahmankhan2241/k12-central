/**
 * Vercel Serverless Function — Payment Report fetcher (Historic Report).
 *
 * Triggered by:
 *  - Vercel Cron daily at 02:30 UTC (8:00 AM IST) — 26-27 (current session)
 *  - Manual "Fetch Now" from the Historic Report page (?report=payment&year=YYYY-YY)
 *
 * Academic years: the UI selects 2024-25 / 2025-26 / 2026-27; each maps to a
 * different Eduvate finance_session_year_id and report date (see SESSIONS).
 *
 * Pipeline (per selected year):
 *  1. Log in to Eduvate with env credentials
 *  2. Download the Store Report CSV for that session (live year: today;
 *     closed years: session-end date — the report is cumulative "till date")
 *  3. Exclude branches containing "taproot" (case-insensitive) or "PU" (case-sensitive)
 *  4. Sort by Paid Date ascending
 *  5. Dedupe by Enrollment Code keeping the FIRST payment of each ERP
 *  6. Keep only: Branch | Enrollment Code | Grade | Student Type | First Paid Date
 *     (Student Type: ERP starts with the session's admission prefix = New)
 *  7. Write the snapshot to Supabase tagged with session_year, replacing only
 *     that year's previous snapshot
 *
 * Snapshot replacement is insert-first, delete-second, scoped to the year:
 *  - every inserted row is stamped with this run's fetched_at + session_year
 *  - after all inserts succeed, that year's old rows are removed with a SINGLE
 *    `fetched_at=neq.<ts>&session_year=eq.<year>` delete
 *  - if anything fails before the delete, the old snapshot stays intact
 *
 * Zone is NOT stored here — the UI joins it live from the Branch & ZBH
 * mapping (Branch (Eduvate) lookup) so Add/Skip is instant.
 *
 * Env vars: EDUVATE_USERNAME, EDUVATE_PASSWORD, SUPABASE_URL,
 * SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY).
 */

const FINANCE_BASE = "https://orchids.finance.letseduvate.com/qbox/apiV1";
const ERP_BASE = "https://orchids.letseduvate.com/qbox";
const INSERT_WAVE = 5; // concurrent insert/delete requests

/**
 * Academic sessions — finance_session_year_id + report date confirmed against
 * the Eduvate Historic Reports page (year IDs are NOT sequential).
 * Closed sessions need a date INSIDE that session; the session-end date gives
 * the complete cumulative year ("data of all branches till <date>").
 * admissionPrefix: ERP codes starting with this are "New" students.
 * 2027-28 is intentionally absent until Eduvate opens that session.
 */
const SESSIONS = {
  "2026-27": { eduvateId: 47, admissionPrefix: "26", live: true },
  "2025-26": { eduvateId: 42, admissionPrefix: "25", reportDate: "2026-03-31" },
  "2024-25": { eduvateId: 9, admissionPrefix: "24", reportDate: "2025-03-31" },
};
const DEFAULT_YEAR = "2026-27";

// ---------- tiny CSV parser (no deps) ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (ch === "\r") {
      // skip
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ---------- Eduvate login ----------
async function eduvateLogin(username, password) {
  const res = await fetch(`${ERP_BASE}/erp_user/user-mgmt/staff-login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, unified_login: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.status_code !== 200 || !data.result) {
    throw new Error(`Eduvate login failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  const token = data.result.access_token || data.result.access;
  if (!token) throw new Error("Eduvate login returned no access token");
  return token;
}

// ---------- Download the Store Report CSV ----------
async function downloadStoreCsv(token, sessionYearId, dateStr) {
  const url = `${FINANCE_BASE}/storereport_download_url/?finance_session_year_id=${sessionYearId}&date=${dateStr}`;
  const r1 = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r1.ok) throw new Error(`Download-URL API failed: ${r1.status}`);
  const j1 = await r1.json();
  if (!j1.data) throw new Error(`No CSV URL returned: ${JSON.stringify(j1).slice(0, 200)}`);
  const r2 = await fetch(j1.data);
  if (!r2.ok) throw new Error(`CSV download failed: ${r2.status}`);
  return await r2.text();
}

/** Normalise a Paid Date to yyyy-mm-dd where possible (for sorting). */
function normalizePaidDate(s) {
  const v = String(s ?? "").trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; // day-first
  }
  return v; // leave as-is; sorts after real dates
}

function studentType(enrollmentCode, admissionPrefix) {
  const code = String(enrollmentCode ?? "").trim();
  return code.startsWith(admissionPrefix) ? "New" : "Old";
}

/**
 * Core transform: CSV text → first-payment-per-ERP rows (stamped with fetchedAt).
 */
function buildPaymentRows(csvText, fetchedAt, sessionYear, admissionPrefix) {
  const raw = parseCsv(csvText);
  if (raw.length < 2) return { rows: [], excludedBranches: 0, totalDataRows: 0 };

  const header = raw[0].map((h) => h.trim());
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iBranch = col("Branch");
  const iPaid = col("Paid Date");
  const iEnroll = col("Enrollment code") !== -1 ? col("Enrollment code") : col("Enrollement Code");
  const iGrade = col("Grade");

  // Branch filter: drop "taproot" (case-insensitive) or "PU" (case-sensitive)
  const isExcluded = (branch) =>
    branch.toLowerCase().includes("taproot") || branch.includes("PU");

  let excludedBranches = 0;
  const kept = [];
  for (let r = 1; r < raw.length; r++) {
    const cells = raw[r];
    if (!cells || cells.length < 2) continue;
    const branch = String(cells[iBranch] ?? "").trim();
    const enroll = String(cells[iEnroll] ?? "").trim();
    if (!enroll) continue;
    if (isExcluded(branch)) { excludedBranches++; continue; }
    kept.push({
      branch,
      enrollment_code: enroll,
      grade: String(cells[iGrade] ?? "").trim(),
      paidSort: normalizePaidDate(cells[iPaid]),
      paidRaw: String(cells[iPaid] ?? "").trim(),
    });
  }

  // Sort whole data by Paid Date ascending
  kept.sort((a, b) => a.paidSort.localeCompare(b.paidSort));

  // Dedupe by ERP keeping the FIRST payment
  const seen = new Set();
  const rows = [];
  for (const k of kept) {
    const key = k.enrollment_code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      branch: k.branch,
      enrollment_code: k.enrollment_code,
      grade: k.grade,
      student_type: studentType(k.enrollment_code, admissionPrefix),
      first_paid_date: k.paidRaw,
      fetched_at: fetchedAt,
      session_year: sessionYear,
    });
  }

  return { rows, excludedBranches, totalDataRows: raw.length - 1 };
}

// ---------- Supabase helpers ----------
async function supabaseInsertWave(supabaseUrl, serviceKey, table, rows, waveSize = INSERT_WAVE) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += 1000) chunks.push(rows.slice(i, i + 1000));
  for (let i = 0; i < chunks.length; i += waveSize) {
    const wave = chunks.slice(i, i + waveSize);
    const results = await Promise.all(
      wave.map((chunk) =>
        fetch(`${supabaseUrl}/rest/v1/${table}`, {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(chunk),
        }).then(async (res) => {
          if (!res.ok) {
            const body = await res.text();
            throw new Error(`Supabase insert ${table} failed: ${res.status} ${body.slice(0, 300)}`);
          }
        })
      )
    );
    void results;
  }
}

/** Does payment_report_rows have the session_year column yet? */
async function supabaseHasSessionYearColumn(supabaseUrl, serviceKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/payment_report_rows?select=id&session_year=eq.probe&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (res.ok) return true;
  const body = await res.text().catch(() => "");
  // 42703 = undefined_column → column missing. Any other failure is treated as
  // "column present" so real errors surface later with their proper message.
  return !(res.status === 400 && (body.includes("42703") || body.includes("session_year")));
}

/** Remove every row from a previous run in ONE request via fetched_at=neq.<ts>. */
async function supabaseDeleteOldGeneration(supabaseUrl, serviceKey, table, fetchedAt, sessionYear) {
  let qs = `fetched_at=neq.${encodeURIComponent(fetchedAt)}`;
  if (sessionYear) qs += `&session_year=eq.${encodeURIComponent(sessionYear)}`;
  const res = await fetch(
    `${supabaseUrl}/rest/v1/${table}?${qs}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=minimal",
      },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase delete-old-rows ${table} failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

async function supabaseFetchLogUpsert(supabaseUrl, serviceKey, entry) {
  const res = await fetch(`${supabaseUrl}/rest/v1/historic_fetch_log?on_conflict=report_key`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(entry),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase fetch-log upsert failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

// ---------- Handler ----------
export default async function handler(req, res) {
  const started = Date.now();
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    "https://dovbrtzcxicfudskwyat.supabase.co";
  const serviceKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  const username = process.env.EDUVATE_USERNAME;
  const password = process.env.EDUVATE_PASSWORD;

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  try {
    if (!serviceKey) throw new Error("SUPABASE_SERVICE_KEY env var is not set");
    if (!username || !password) throw new Error("EDUVATE_USERNAME / EDUVATE_PASSWORD env vars are not set");

    const authHeader = req.headers.authorization || "";
    const isVercelCron = req.headers["x-vercel-cron"] !== undefined;
    if (isVercelCron && process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      res.writeHead(401, cors);
      return res.end(JSON.stringify({ error: "Unauthorized cron call" }));
    }

    // Academic year from ?year= (validated) — used for source session, row
    // tagging, deletion scope and the per-year fetch-log key.
    const requested = (req.query?.year ?? req.query?.session ?? "").toString();
    const sessionYear = SESSIONS[requested] ? requested : DEFAULT_YEAR;
    const session = SESSIONS[sessionYear];

    const reportDate = session.reportDate ?? new Date().toISOString().slice(0, 10);
    const fetchedAt = new Date().toISOString();
    const logKey = `payment_report:${sessionYear}`;

    const token = await eduvateLogin(username, password);
    const csv = await downloadStoreCsv(token, session.eduvateId, reportDate);
    const { rows, excludedBranches, totalDataRows } = buildPaymentRows(
      csv,
      fetchedAt,
      sessionYear,
      session.admissionPrefix
    );

    // If the session_year column hasn't been added yet (migration pending),
    // fall back to legacy behaviour: store rows without the tag and scope
    // deletes without it. Keeps the cron working during the transition.
    const hasYearColumn = await supabaseHasSessionYearColumn(supabaseUrl, serviceKey);
    if (!hasYearColumn && sessionYear !== DEFAULT_YEAR) {
      // Without the column the table can only hold ONE year at a time —
      // a historical fetch would wipe the 26-27 snapshot. Refuse instead.
      throw new Error(
        "session_year column is missing — run scripts/migration-session-year.sql in the Supabase SQL Editor before fetching historical years"
      );
    }
    const insertRows = hasYearColumn ? rows : rows.map(({ session_year, ...r }) => r);

    // Refuse to wipe the snapshot with an empty transform (bad CSV, schema drift…).
    if (rows.length === 0) {
      throw new Error(
        `Transform produced 0 rows from ${totalDataRows} CSV rows — refusing to replace the snapshot`
      );
    }

    // Insert the new generation FIRST (old data untouched on failure)…
    try {
      await supabaseInsertWave(supabaseUrl, serviceKey, "payment_report_rows", insertRows);
    } catch (e) {
      // Roll back the partial new generation so the table keeps ONLY the
      // previous complete snapshot (no duplicate rows from the half-write).
      await fetch(
        `${supabaseUrl}/rest/v1/payment_report_rows?fetched_at=eq.${encodeURIComponent(fetchedAt)}&session_year=eq.${encodeURIComponent(sessionYear)}`,
        {
          method: "DELETE",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: "return=minimal",
          },
        }
      ).catch(() => {});
      throw e;
    }

    // …then drop every row from previous runs of THIS year in one request.
    if (hasYearColumn) {
      await supabaseDeleteOldGeneration(
        supabaseUrl,
        serviceKey,
        "payment_report_rows",
        fetchedAt,
        sessionYear
      );
    } else {
      // Legacy table: only 26-27 data lives here, so replace it wholesale.
      await supabaseDeleteOldGeneration(
        supabaseUrl,
        serviceKey,
        "payment_report_rows",
        fetchedAt,
        null
      );
    }

    await supabaseFetchLogUpsert(supabaseUrl, serviceKey, {
      report_key: logKey,
      last_fetched_at: new Date().toISOString(),
      last_report_date: reportDate,
      last_row_count: rows.length,
      last_status: "ok",
      last_error: null,
    });

    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      ms: Date.now() - started,
      session_year: sessionYear,
      results: {
        payment: {
          ok: true,
          csvRows: totalDataRows,
          excludedBranchRows: excludedBranches,
          uniqueErps: rows.length,
        },
      },
    }));
  } catch (e) {
    const msg = String(e.message || e).slice(0, 400);
    // Which year failed? ?year= if valid, else the default — must match the
    // log key the success path would have used.
    const failYearRaw = (req.query?.year ?? req.query?.session ?? "").toString();
    const failYear = SESSIONS[failYearRaw] ? failYearRaw : DEFAULT_YEAR;
    await supabaseFetchLogUpsert(
      supabaseUrl,
      serviceKey || "missing",
      {
        report_key: `payment_report:${failYear}`,
        last_fetched_at: new Date().toISOString(),
        last_report_date: null,
        last_row_count: 0,
        last_status: "failed",
        last_error: msg,
      }
    ).catch(() => {});
    res.writeHead(500, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: msg, ms: Date.now() - started }));
  }
}
