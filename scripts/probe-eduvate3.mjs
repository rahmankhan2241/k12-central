/**
 * Probe #3: verify closed-session reports download with in-session dates.
 *   24-25 -> session id 9,  25-26 -> id 42 (confirmed from the ERP UI).
 * Tries session-end dates (full-year capture) and mid-year dates.
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
  if (data.status_code !== 200 || !data.result) throw new Error("login failed");
  return data.result.access_token || data.result.access;
}

const CASES = [
  [9, "2025-03-31", "24-25 session end (full year)"],
  [9, "2024-12-01", "24-25 user-suggested"],
  [9, "2024-06-15", "24-25 mid-year"],
  [42, "2026-03-31", "25-26 session end (full year)"],
  [42, "2025-12-01", "25-26 user-suggested"],
  [42, "2026-09-27", "25-26 with current date (expect fail)"],
];

const token = await login();
console.log("logged in OK\n");

for (const [id, date, label] of CASES) {
  const url = `${FINANCE_BASE}/storereport_download_url/?finance_session_year_id=${id}&date=${date}`;
  try {
    const r1 = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const b1 = await r1.text();
    let j1 = null;
    try { j1 = JSON.parse(b1); } catch {}
    if (r1.ok && j1?.data) {
      const r2 = await fetch(j1.data);
      if (!r2.ok) { console.log(`id ${id} ${date} [${label}] -> CSV HTTP ${r2.status}`); continue; }
      const csv = await r2.text();
      const lines = csv.split("\n").filter((l) => l.trim()).length;
      const header = csv.split("\n")[0].split(",").slice(0, 8).join(",");
      // sample the Session Year column values (col index 1 per known header)
      const syVals = new Set();
      for (const l of csv.split("\n").slice(1, 4000)) {
        const c = l.split(",");
        if (c[1]) syVals.add(c[1].trim());
        if (syVals.size > 3) break;
      }
      console.log(`id ${id} ${date} [${label}] -> OK ${(lines - 1).toLocaleString()} rows, ${(csv.length / 1e6).toFixed(1)} MB`);
      console.log(`   header: ${header}`);
      console.log(`   Session Year values: ${[...syVals].slice(0, 4).join(" | ")}`);
    } else {
      console.log(`id ${id} ${date} [${label}] -> ${r1.status} ${b1.slice(0, 110).replace(/\s+/g, " ")}`);
    }
  } catch (e) {
    console.log(`id ${id} ${date} [${label}] -> EXC ${String(e.message ?? e).slice(0, 100)}`);
  }
}
