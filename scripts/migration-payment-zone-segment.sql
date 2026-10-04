-- ============================================================
-- K12 Central — Historic Report: store Zone + Segment on each row
-- Run once in the Supabase SQL Editor.
--
-- The fetch pipeline (api/fetch-historic.js) now resolves these two
-- derived fields when it downloads the Eduvate report, so each stored
-- student row already carries its Zone (from the Branch (Eduvate) →
-- Zone mapping) and Segment (ICSE when Branch + Grade match an ICSE
-- rule, else OIS). This migration adds the columns and backfills the
-- rows fetched before the change.
-- ============================================================

alter table payment_report_rows add column if not exists zone text;
alter table payment_report_rows add column if not exists segment text;

-- 1) Zone — from grn_branch_zbh_mapping (first mapping entry per branch wins,
--    mirroring the UI's findZoneByBranchEduvate lookup).
with map as (
  select distinct on (lower(trim(m ->> 'branchEduvate')))
    lower(trim(m ->> 'branchEduvate')) as bkey,
    trim(m ->> 'zone')                  as zone
  from report_config rc
  cross join lateral jsonb_array_elements(rc.value) with ordinality as t(m, ord)
  where rc.config_key = 'grn_branch_zbh_mapping'
    and coalesce(trim(m ->> 'branchEduvate'), '') <> ''
  order by lower(trim(m ->> 'branchEduvate')), t.ord
)
update payment_report_rows r
set zone = map.zone
from map
where lower(trim(r.branch)) = map.bkey
  and (r.zone is null or r.zone = '');

-- 2) Segment — ICSE when Branch AND Grade both match a historic_icse_config
--    rule (case-insensitive), else OIS.
with icse as (
  select distinct
    lower(trim(m ->> 'branch')) as bkey,
    lower(trim(m ->> 'grade'))  as gkey
  from report_config rc
  cross join lateral jsonb_array_elements(rc.value) m
  where rc.config_key = 'historic_icse_config'
    and coalesce(trim(m ->> 'branch'), '') <> ''
    and coalesce(trim(m ->> 'grade'), '') <> ''
)
update payment_report_rows r
set segment = case when exists (
  select 1 from icse
  where icse.bkey = lower(trim(r.branch))
    and icse.gkey = lower(trim(r.grade))
) then 'ICSE' else 'OIS' end
where r.segment is null or r.segment = '';

create index if not exists payment_report_rows_zone_idx on payment_report_rows (zone);
create index if not exists payment_report_rows_segment_idx on payment_report_rows (segment);
