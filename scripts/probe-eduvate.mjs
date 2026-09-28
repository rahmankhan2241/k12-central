/**
 * One-off probe: discover Eduvate finance_session_year_id for the historical
 * sessions (24-25, 25-26) and which report dates still return a CSV.
 * Not part of the app build.
 *
 *   EDUVATE_USERNAME=... EDUVATE_PASSWORD=... node scripts/probe-eduvate.mjs
 */
const FINANCE_BASE = "https://orchids.finance.letseduvate.com/qbox/apiV1";
const ERP_BASE = "https://orchids.letseduvate.com/qbox";

const USERNAME = process.env.EDUVATE_USERNAME;
const PASSWORD = process.env.EDUVATE_PASSWORD;
if (!USERNAME || !PASSWORD) {
  console.error("Set EDUVATE_USERNAME and EDUVATE_PASSWORD env vars first.");
  process.exit(1);
}

async function login() {
  const res = await fetch(`${ERP_BASE}/erp_user/user-mgmt/staff-login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, unified_login: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (data.status_code !== 200 || !data.result) {
    throw new Error(`login failed: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.result.access_token || data.result.access;
}

async function probe(token, sessionYearId, date) {
  const url = `${FINANCE_BASE}/storereport_download_url/?finance_session_year_id=${sessionYearId}&date=${date}`;
  const r1 = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r1.text();
  let j1 = null;
  try { j1 = JSON.parse(body); } catch {}
  if (!r1.ok || !j1?.data) {
    return { ok: false, status: r1.status, hint: body.slice(0, 120) };
  }
  const r2 = await fetch(j1.data);
  if (!r2.ok) return { ok: false, status: r2.status, hint: "csv fetch failed" };
  const csv = await r2.text();
  const lines = csv.split("\n").filter((l) => l.trim().length > 0);
  const header = (lines[0] ?? "").split(",").slice(0, 6).join(",");
  const paidCol = header.toLowerCase().includes("paid date");
  return {
    ok: paidCol,
    status: r1.status,
    bytes: csv.length,
    dataRows: Math.max(0, lines.length - 1),
    header,
  };
}

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const dayBefore = (n) => iso(new Date(today.getTime() - n * 86400000));

// candidate dates: yesterday, 2 days ago, 7 days ago, FY start 26-27 / 25-26 / 24-25, mid-June of 25-26
const DATES = [
  dayBefore(1),
  dayBefore(2),
  dayBefore(7),
  "2026-04-01",
  "2025-04-01",
  "2024-04-01",
  "2025-06-15",
];

const YEARS = [
  { id: 49, label: "27-28 (guess)" },
  { id: 48, label: "27-28 (alt guess)" },
  { id: 47, label: "26-27 (known)" },
  { id: 46, label: "25-26 (guess)" },
  { id: 45, label: "24-25 (guess)" },
  { id: 44, label: "23-24 (guess)" },
];

const token = await login();
console.log("logged in OK\n");

for (const y of YEARS) {
  for (const date of DATES) {
    let r;
    try {
      r = await probe(token, y.id, date);
    } catch (e) {
      r = { ok: false, status: "EXC", hint: String(e.message ?? e).slice(0, 100) };
    }
    const flag = r.ok ? "CSV OK " : "no     ";
    console.log(
      `year ${String(y.id).padStart(2)} [${y.label}] date ${date} -> ${flag}` +
        (r.ok ? ` ${r.dataRows} rows, ${r.bytes} B, header: ${r.header}` : ` (${r.status}) ${r.hint ?? ""}`)
    );
  }
  console.log("");
}
