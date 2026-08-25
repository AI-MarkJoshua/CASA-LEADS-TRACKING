-- Preserve notes from existing lead spreadsheets.
alter table public.leads
add column if not exists note text;
