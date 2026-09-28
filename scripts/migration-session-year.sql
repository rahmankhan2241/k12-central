-- ============================================================================
-- Payment Report: per-academic-year data (24-25 / 25-26 / 26-27 / 27-28)
-- Run this ONCE in the Supabase SQL Editor (Dashboard -> SQL Editor -> Run).
-- Safe to re-run: IF NOT EXISTS / IF EXISTS guards everywhere.
-- ============================================================================

-- 1) Tag every payment row with its academic session year.
ALTER TABLE public.payment_report_rows
  ADD COLUMN IF NOT EXISTS session_year text;

-- 2) Existing rows were all fetched from session 47 (2026-27).
UPDATE public.payment_report_rows
SET session_year = '2026-27'
WHERE session_year IS NULL;

-- 3) Backfill on insert: any row written without a year is a 26-27 row
--    (the pipeline always sets it explicitly; this is just a safety net).
ALTER TABLE public.payment_report_rows
  DROP CONSTRAINT IF EXISTS payment_report_rows_session_year_fill;
ALTER TABLE public.payment_report_rows
  ALTER COLUMN session_year SET DEFAULT '2026-27';

-- 4) Fast per-year filtering/deleting.
CREATE INDEX IF NOT EXISTS payment_report_rows_session_year_idx
  ON public.payment_report_rows (session_year);

-- 5) One fetch-log row PER year instead of a single shared one.
--    report_key becomes '<key>:<year>' (e.g. payment_report:2025-26).
--    Rename the existing 26-27 log row so its history is kept.
UPDATE public.historic_fetch_log
SET report_key = 'payment_report:2026-27'
WHERE report_key = 'payment_report';
