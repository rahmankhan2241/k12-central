-- ============================================================================
-- PO Tracking: purchase-order rows for the PO dashboard.
-- Run this ONCE in the Supabase SQL Editor (Dashboard -> SQL Editor -> Run).
-- Safe to re-run: IF NOT EXISTS / DROP POLICY IF EXISTS guards everywhere.
-- ============================================================================

create table if not exists public.po_rows (
  id             bigint generated always as identity primary key,
  po_date        text not null default '',
  category       text not null default '',
  material_name  text not null default '',
  sku_code       text not null default '',
  edition        text not null default '',
  existing_stock numeric not null default 0,
  po_qty         numeric not null default 0,
  uploaded_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Fast type-ahead search on SKU / material / category.
create index if not exists po_rows_sku_idx on public.po_rows (sku_code);
create index if not exists po_rows_category_idx on public.po_rows (category);

create or replace function public.po_rows_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists po_rows_touch_trg on public.po_rows;
create trigger po_rows_touch_trg
  before update on public.po_rows
  for each row execute function public.po_rows_touch();

-- Row Level Security: publishable (anon) key access, same as the other tables.
alter table public.po_rows enable row level security;

drop policy if exists po_rows_select on public.po_rows;
create policy po_rows_select on public.po_rows for select using (true);

drop policy if exists po_rows_insert on public.po_rows;
create policy po_rows_insert on public.po_rows for insert with check (true);

drop policy if exists po_rows_update on public.po_rows;
create policy po_rows_update on public.po_rows
  for update using (true) with check (true);

drop policy if exists po_rows_delete on public.po_rows;
create policy po_rows_delete on public.po_rows for delete using (true);

grant select, insert, update, delete on public.po_rows to anon, authenticated;
