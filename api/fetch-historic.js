/**
 * Vercel Serverless Function — Historic Report fetcher.
 *
 * Triggered by:
 *  - Vercel Cron daily at 02:30 UTC (8:00 AM IST)
 *  - Manual "Fetch Now" from the Historic Report page (GET ?report=tpnd|store|all)
 *
 * Flow: log in to Eduvate with env credentials → get signed CSV URLs →
 * download CSVs → upsert into Supabase → update fetch log.
 *
 * Required env vars (set in Vercel → Settings → Environment Variables):
 *   EDUVATE_USERNAME  — Eduvate ERP ID (e.g. 20250003042_OIS)
 *   EDUVATE_PASSWORD  — Eduvate password
 *   SUPABASE_URL      — https://dovbrtzcxicfudskwyat.supabase.co
 *   SUPABASE_SERVICE_KEY — service_role key (bypasses RLS; server-side only!)
 *
 * Optional env vars:
 *   FINANCE_SESSION_YEAR_ID — default "47" (FY 2026-27)
 *   CRON_SECRET — if set, scheduled invocations must send this as Authorization Bearer
 */

const FINANCE_BASE = "https://orchids.finance.letseduvate.com/qbox/apiV1";
const ERP_BASE = "https://orchids.letseduvate.com/qbox";

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
  const result = data.result;
  const token = result.access_token || result.access;
  if (!token) throw new Error("Eduvate login returned no access token");
  return token;
}

// ---------- Download a report CSV ----------
async function downloadReportCsv(token, kind, sessionYearId, dateStr) {
  const url =
    kind === "tpnd"
      ? `${FINANCE_BASE}/tpnd_report_download_url/?finance_session_year_id=${sessionYearId}&date=${dateStr}&rep_type=installment`
      : `${FINANCE_BASE}/storereport_download_url/?finance_session_year_id=${sessionYearId}&date=${dateStr}`;
  const r1 = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r1.ok) throw new Error(`Download-URL API ${kind} failed: ${r1.status}`);
  const j1 = await r1.json();
  const csvUrl = j1.data;
  if (!csvUrl) throw new Error(`No CSV URL returned for ${kind}: ${JSON.stringify(j1).slice(0, 200)}`);
  const r2 = await fetch(csvUrl);
  if (!r2.ok) throw new Error(`CSV download ${kind} failed: ${r2.status}`);
  return await r2.text();
}

// ---------- Row mapping ----------
const num = (v) => {
  const n = Number(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const todayIso = () => new Date().toISOString().slice(0, 10);

function mapTpndRows(csvText, reportDate) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iBranch = col("Branch Name");
  const iGrade = col("Grade");
  const iEnroll = col("Enrollement Code") !== -1 ? col("Enrollement Code") : col("Enrollment Code");
  const iStatus = col("Permanent_Status");
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells || cells.length < 2) continue;
    const enrollment = String(cells[iEnroll] ?? "").trim();
    if (!enrollment) continue;
    const extra = {};
    header.forEach((h, idx) => {
      if (![iBranch, iGrade, iEnroll, iStatus].includes(idx)) {
        const v = String(cells[idx] ?? "").trim();
        if (v) extra[h] = v;
      }
    });
    out.push({
      report_date: reportDate,
      branch_name: String(cells[iBranch] ?? "").trim(),
      grade: String(cells[iGrade] ?? "").trim(),
      enrollment_code: enrollment,
      permanent_status: String(cells[iStatus] ?? "").trim(),
      extra,
    });
  }
  return out;
}

function mapStoreRows(csvText, reportDate) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iBranch = col("Branch");
  const iPaid = col("Paid Date");
  const iEnroll = col("Enrollment code") !== -1 ? col("Enrollment code") : col("Enrollement Code");
  const iGrade = col("Grade");
  const iSection = col("Section");
  const iKit = col("Kit Name");
  const iQty = col("Quantity");
  const iAmount = col("Amount");
  const iTotal = col("Total");
  const iReceipt = col("Receipt No");
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells || cells.length < 2) continue;
    const extra = {};
    header.forEach((h, idx) => {
      if (![iBranch, iPaid, iEnroll, iGrade, iSection, iKit, iQty, iAmount, iTotal, iReceipt].includes(idx)) {
        const v = String(cells[idx] ?? "").trim();
        if (v) extra[h] = v;
      }
    });
    out.push({
      report_date: reportDate,
      branch: String(cells[iBranch] ?? "").trim(),
      paid_date: String(cells[iPaid] ?? "").trim(),
      enrollment_code: String(cells[iEnroll] ?? "").trim(),
      grade: String(cells[iGrade] ?? "").trim(),
      section: String(cells[iSection] ?? "").trim(),
      kit_name: String(cells[iKit] ?? "").trim(),
      quantity: num(cells[iQty]),
      amount: num(cells[iAmount]),
      total: num(cells[iTotal]),
      receipt_no: String(cells[iReceipt] ?? "").trim(),
      extra,
    });
  }
  return out;
}

// ---------- Supabase REST upsert (chunked) ----------
async function supabaseDelete(supabaseUrl, serviceKey, table, filter) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase delete ${table} failed: ${res.status} ${body.slice(0, 300)}`);
  }
}

async function supabaseUpsert(supabaseUrl, serviceKey, table, rows) {
  const CHUNK = 800;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    // Plain insert — the caller deletes the previous snapshot first, so no
    // unique constraint / merge-duplicates is needed.
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase upsert ${table} failed: ${res.status} ${body.slice(0, 300)}`);
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
  // Supabase↔Vercel integration provides SUPABASE_SERVICE_ROLE_KEY;
  // a manually-set SUPABASE_SERVICE_KEY also works.
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

    // Cron auth: if triggered by Vercel Cron (no user session), require the secret
    const authHeader = req.headers.authorization || "";
    const isVercelCron = req.headers["x-vercel-cron"] !== undefined;
    if (isVercelCron && process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      res.writeHead(401, cors);
      return res.end(JSON.stringify({ error: "Unauthorized cron call" }));
    }

    const which = (req.query.report || "all").toString();
    const reportDate = todayIso();
    const results = {};

    const token = await eduvateLogin(username, password);

    const runTpnd = which === "all" || which === "tpnd";
    const runStore = which === "all" || which === "store";

    if (runTpnd) {
      try {
        const csv = await downloadReportCsv(token, "tpnd", sessionYearId, reportDate);
        const rows = mapTpndRows(csv, reportDate);
        // Replace-strategy: keep only the latest snapshot so the DB doesn't
        // grow unbounded with 124k rows/day. Delete old, insert fresh.
        await supabaseDelete(supabaseUrl, serviceKey, "historic_tpnd_rows", "report_date=neq." + reportDate);
        if (rows.length > 0) {
          await supabaseUpsert(supabaseUrl, serviceKey, "historic_tpnd_rows", rows);
        }
        await supabaseFetchLogUpsert(supabaseUrl, serviceKey, {
          report_key: "tpnd_installment",
          last_fetched_at: new Date().toISOString(),
          last_report_date: reportDate,
          last_row_count: rows.length,
          last_status: "ok",
          last_error: null,
        });
        results.tpnd = { rows: rows.length, ok: true };
      } catch (e) {
        results.tpnd = { ok: false, error: String(e.message || e).slice(0, 400) };
        await supabaseFetchLogUpsert(supabaseUrl, serviceKey, {
          report_key: "tpnd_installment",
          last_fetched_at: new Date().toISOString(),
          last_report_date: reportDate,
          last_row_count: 0,
          last_status: "failed",
          last_error: String(e.message || e).slice(0, 400),
        }).catch(() => {});
      }
    }

    if (runStore) {
      try {
        const csv = await downloadReportCsv(token, "store", sessionYearId, reportDate);
        const rows = mapStoreRows(csv, reportDate);
        await supabaseDelete(supabaseUrl, serviceKey, "historic_store_rows", "report_date=neq." + reportDate);
        if (rows.length > 0) {
          await supabaseUpsert(supabaseUrl, serviceKey, "historic_store_rows", rows);
        }
        await supabaseFetchLogUpsert(supabaseUrl, serviceKey, {
          report_key: "store_kit_wise",
          last_fetched_at: new Date().toISOString(),
          last_report_date: reportDate,
          last_row_count: rows.length,
          last_status: "ok",
          last_error: null,
        });
        results.store = { rows: rows.length, ok: true };
      } catch (e) {
        results.store = { ok: false, error: String(e.message || e).slice(0, 400) };
        await supabaseFetchLogUpsert(supabaseUrl, serviceKey, {
          report_key: "store_kit_wise",
          last_fetched_at: new Date().toISOString(),
          last_report_date: reportDate,
          last_row_count: 0,
          last_status: "failed",
          last_error: String(e.message || e).slice(0, 400),
        }).catch(() => {});
      }
    }

    res.writeHead(200, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, ms: Date.now() - started, results }));
  } catch (e) {
    res.writeHead(500, { ...cors, "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 400), ms: Date.now() - started }));
  }
}
