-- ============================================================================
-- Pending GRN: cloud snapshot of the LAST uploaded file
-- Run this ONCE in the Supabase SQL Editor (Dashboard -> SQL Editor -> Run).
-- Safe to re-run: IF NOT EXISTS / DROP POLICY IF EXISTS guards everywhere.
-- ============================================================================

-- One row, keyed 'latest': whatever GRN file was uploaded most recently.
-- Storing the PARSED matrix (columns + rows of strings) means the report and
-- Ask AI can restore it without re-parsing the original file.
create table if not exists public.grn_snapshots (
  snapshot_key text primary key,
  file_name    text not null,
  sheet_name   text,
  columns      jsonb not null default '[]'::jsonb,
  rows         jsonb not null default '[]'::jsonb,
  row_count    integer not null default 0,
  file_size    bigint  not null default 0,
  uploaded_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Keep updated_at honest on every upsert.
create or replace function public.grn_snapshots_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists grn_snapshots_touch_trg on public.grn_snapshots;
create trigger grn_snapshots_touch_trg
  before update on public.grn_snapshots
  for each row execute function public.grn_snapshots_touch();

-- Row Level Security: this app talks to Supabase with the publishable (anon)
-- key, exactly like report_config. Allow the anon role to read and write the
-- snapshot; tighten later if the console becomes multi-tenant.
alter table public.grn_snapshots enable row level security;

drop policy if exists grn_snapshots_select on public.grn_snapshots;
create policy grn_snapshots_select on public.grn_snapshots
  for select using (true);

drop policy if exists grn_snapshots_insert on public.grn_snapshots;
create policy grn_snapshots_insert on public.grn_snapshots
  for insert with check (true);

drop policy if exists grn_snapshots_update on public.grn_snapshots;
create policy grn_snapshots_update on public.grn_snapshots
  for update using (true) with check (true);

drop policy if exists grn_snapshots_delete on public.grn_snapshots;
create policy grn_snapshots_delete on public.grn_snapshots
  for delete using (true);

grant select, insert, update, delete on public.grn_snapshots to anon, authenticated;
