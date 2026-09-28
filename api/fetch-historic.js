/**
 * Vercel Serverless Function — Payment Report fetcher (Historic Report).
 *
 * Triggered by:
 *  - Vercel Cron daily at 02:30 UTC (8:00 AM IST)
 *  - Manual "Fetch Now" from the Historic Report page (?report=payment)
 *
 * Flow:
 *  1. Log in to Eduvate with env credentials
 *  2. Download the Store Report - Kit Wise CSV
 *  3. Exclude branches containing "taproot" (case-insensitive) or "PU" (case-sensitive)
 *  4. Sort by Paid Date ascending
 *  5. Dedupe by Enrollment Code keeping the FIRST payment of each ERP
 *  6. Keep only: Branch | Enrollment Code | Grade | Student Type | First Paid Date
 *     (Student Type: ERP starts with "26" = New for FY 26-27, otherwise Old)
 *  7. Replace the snapshot in Supabase (small — one row per ERP)
 *
 * Zone is NOT stored here — the UI joins it live from the Branch & ZBH
 * mapping (Branch (Eduvate) lookup) so Add/Skip is instant.
 *
 * Env vars: EDUVATE_USERNAME, EDUVATE_PASSWORD, SUPABASE_URL,
 * SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY), FINANCE_SESSION_YEAR_ID (default 47).
 */

const FINANCE_BASE = "https://orchids.finance.letseduvate.com/qbox/apiV1";
const ERP_BASE = "https://orchids.letseduvate.com/qbox";
const ADMISSION_YEAR_PREFIX = "26"; // FY 2026-27

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

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

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

function studentType(enrollmentCode) {
  const code = String(enrollmentCode ?? "").trim();
  return code.startsWith(ADMISSION_YEAR_PREFIX) ? "New" : "Old";
}

/**
 * Core transform: CSV text → first-payment-per-ERP rows.
 */
function buildPaymentRows(csvText) {
  const raw = parseCsv(csvText);
  if (raw.length < 2) return { rows: [], excludedBranches: 0, totalDataRows: 0 };

  const header = raw[0].map((h) => h.trim());
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iBranch = col("Branch");
  const iPaid = col("Paid Date");
  const iEnroll = col("Enrollment code") !== -1 ? col("Enrollment code") : col("Enrollement Code");
  const iGrade = col("Grade");

  // 3) Branch filter: drop "taproot" (case-insensitive) or "PU" (case-sensitive)
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

  // 2) Sort whole data by Paid Date ascending
  kept.sort((a, b) => a.paidSort.localeCompare(b.paidSort));

  // 3) Dedupe by ERP keeping the FIRST payment
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
      student_type: studentType(k.enrollment_code),
      first_paid_date: k.paidRaw,
    });
  }

  return { rows, excludedBranches, totalDataRows: raw.length - 1 };
}

// ---------- Supabase helpers ----------
async function chunkedDeleteAll(supabaseUrl, serviceKey, table) {
  for (let round = 0; round < 500; round++) {
    const sel = await fetch(
      `${supabaseUrl}/rest/v1/${table}?select=id&order=id.asc&limit=1000`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!sel.ok) throw new Error(`Supabase select-ids ${table} failed: ${sel.status} ${(await sel.text()).slice(0, 150)}`);
    const ids = await sel.json();
    if (!Array.isArray(ids) || ids.length === 0) return;
    const inList = `(${ids.map((r) => r.id).join(",")})`;
    const del = await fetch(`${supabaseUrl}/rest/v1/${table}?id=in.${inList}`, {
      method: "DELETE",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=minimal",
      },
    });
    if (!del.ok) {
      const body = await del.text();
      throw new Error(`Supabase chunked delete ${table} failed: ${del.status} ${body.slice(0, 200)}`);
    }
  }
}

async function supabaseInsert(supabaseUrl, serviceKey, table, rows, chunkSize = 1000) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows.slice(i, i + chunkSize)),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase insert ${table} failed: ${res.status} ${body.slice(0, 300)}`);
    }
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
  const sessionYearId = process.env.FINANCE_SESSION_YEAR_ID || "47";

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

    const reportDate = new Date().toISOString().slice(0, 10);

    const token = await eduvateLogin(username, password);
    const csv = await downloadStoreCsv(token, sessionYearId, reportDate);
    const { rows, excludedBranches, totalDataRows } = buildPaymentRows(csv);

    // Replace snapshot
    await chunkedDeleteAll(supabaseUrl, serviceKey, "payment_report_rows");
    if (rows.length > 0) {
      await supabaseInsert(supabaseUrl, serviceKey, "payment_report_rows", rows);
    }

    await supabaseFetchLogUpsert(supabaseUrl, serviceKey, {
      report_key: "payment_report",
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
    await supabaseFetchLogUpsert(
      supabaseUrl,
      serviceKey || "missing",
      {
        report_key: "payment_report",
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
