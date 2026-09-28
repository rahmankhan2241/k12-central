-- ============================================================
-- K12 Central — Historic Report schema
-- Run once in Supabase SQL Editor.
-- ============================================================

-- 1) TPND Report - Installment rows (trimmed to useful columns)
create table if not exists historic_tpnd_rows (
  id bigint generated always as identity primary key,
  report_date date not null,
  branch_name text not null default '',
  paid_date text default '',
  grade text default '',
  enrollment_code text not null default '',
  permanent_status text default '',
  extra jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (report_date, enrollment_code, grade)
);

-- 2) Store Report - Kit Wise rows
create table if not exists historic_store_rows (
  id bigint generated always as identity primary key,
  report_date date not null,
  branch text not null default '',
  paid_date text default '',
  enrollment_code text default '',
  grade text default '',
  section text default '',
  kit_name text default '',
  quantity numeric default 0,
  amount numeric default 0,
  total numeric default 0,
  extra jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (report_date, enrollment_code, kit_name, paid_date, receipt_no)
);

alter table historic_store_rows add column if not exists receipt_no text default '';

-- 3) Fetch log — "when was this report last fetched?"
create table if not exists historic_fetch_log (
  id bigint generated always as identity primary key,
  report_key text not null unique,          -- 'tpnd_installment' | 'store_kit_wise'
  last_fetched_at timestamptz not null default now(),
  last_report_date date,
  last_row_count bigint default 0,
  last_status text not null default 'ok',   -- 'ok' | 'failed'
  last_error text
);

-- 4) RLS: same model as report_config — anon full access on these config tables
alter table historic_tpnd_rows enable row level security;
alter table historic_store_rows enable row level security;
alter table historic_fetch_log enable row level security;

drop policy if exists "anon full access tpnd" on historic_tpnd_rows;
create policy "anon full access tpnd" on historic_tpnd_rows
  for all to anon using (true) with check (true);

drop policy if exists "anon full access store" on historic_store_rows;
create policy "anon full access store" on historic_store_rows
  for all to anon using (true) with check (true);

drop policy if exists "anon full access fetchlog" on historic_fetch_log;
create policy "anon full access fetchlog" on historic_fetch_log
  for all to anon using (true) with check (true);

-- 5) Fast search support
create index if not exists idx_tpnd_branch on historic_tpnd_rows (branch_name);
create index if not exists idx_tpnd_date on historic_tpnd_rows (report_date);
create index if not exists idx_store_branch on historic_store_rows (branch);
create index if not exists idx_store_kit on historic_store_rows (kit_name);
create index if not exists idx_store_date on historic_store_rows (report_date);
