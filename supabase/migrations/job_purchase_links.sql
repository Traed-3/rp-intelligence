-- Job purchases: tie every emailed vendor invoice, packing slip and receipt to the Construction job it was for.
--
-- Until now only `expenses` rows carried a job (con_job_id), and the job page did not read even those, so the
-- Materials tab and Cost Summary showed nothing unless someone typed the materials in by hand.
--
--   billing_inbox_documents.con_job_id       the job the paperwork belongs to
--   billing_inbox_documents.job_link_source  'auto' (worked out here) | 'manual' (a person picked it; never re-worked)
--
-- How the job is worked out (con_pick_job_for_doc):
--   1. A site named in the email subject, else in the PO / job field read off the paper:
--      SU-8001, "SU 8001", "Su13470", "Wawa 8659", "Sheetz 259", "CPG 1600", a bare 5-digit store number.
--      Numbers written as a PO ("PO 24296") are not sites.
--   2. Among that site's jobs: the job whose PO number is on the paper; else a job from the paper's own year
--      (33453-26 for a 2026 receipt, never 33453-16); else a job that was open on the paper's
--      date (received on or before it, not completed more than two weeks earlier), working jobs ahead of ones
--      still being quoted, newest first; else the newest job received before that date; else the newest job.
--   3. No site at all: the job that carries the PO number, or the job other paperwork with the same PO went to
--      ("ICON PACKING SLIP" with PO 24263 follows the SU-12080 invoice with PO 24263).

alter table billing_inbox_documents
  add column if not exists con_job_id uuid references con_jobs(id) on delete set null,
  add column if not exists job_link_source text;

create index if not exists billing_inbox_documents_con_job_idx on billing_inbox_documents (con_job_id) where con_job_id is not null;

-- One spelling per site: "SU -1800 (80015635)" / "SU-1800" / "su 1800" -> SU1800, "1600-CPG" -> CPG1600, "Wawa 8659" -> WAWA8659.
create or replace function con_site_key(site text) returns text
language sql immutable parallel safe
set search_path = public
as $$
  select case
    when s ~ '^SU\s*-?\s*\d' then 'SU' || substring(s from '^SU\s*-?\s*(\d+[A-Z]?)')
    when s ~ '^\d+\s*-\s*CPG$' then 'CPG' || substring(s from '^(\d+)')
    when s ~ '^\d{3,5}\s*/\s*\d{5}$' then substring(s from '(\d{5})$')
    else nullif(regexp_replace(s, '[^A-Z0-9]', '', 'g'), '')
  end
  from (select upper(btrim(coalesce(site, ''))) as s) x
$$;

create index if not exists con_jobs_site_key_idx on con_jobs (company_id, con_site_key(site_number));

-- Site keys named in a piece of text, most certain first.
create or replace function con_doc_site_keys(txt text, careful boolean default false) returns text[]
language plpgsql immutable parallel safe
set search_path = public
as $$
declare
  t text := replace(replace(coalesce(txt, ''), '&amp;', '&'), '&#39;', '''');
  keys text[] := '{}';
  m text[];
begin
  -- A purchase-order number is not a site.
  t := regexp_replace(t, '\mP\.?\s*O\.?\s*(?:number|no\.?|#)?\s*:?\s*#?\s*\d{4,6}\M', ' ', 'gi');
  t := regexp_replace(t, '\m(?:cust(?:omer)?\s+order|sales\s+order|S\.?\s*O\.?)\s*(?:number|no\.?|#)?\s*:?\s*#?\s*\d{4,8}\M', ' ', 'gi');

  for m in select regexp_matches(t, '\mSU\s*-?\s*(\d{2,6}[A-Z]?)\M', 'gi') loop
    keys := keys || ('SU' || upper(m[1]));
  end loop;

  for m in select regexp_matches(t, '\m(wawa|sheetz|speedway|global|bp|cpg|handy\s*mart)[\s#:-]*(\d{1,5})\M', 'gi') loop
    keys := keys || (upper(regexp_replace(m[1], '\s', '', 'g')) || m[2]);
    if length(m[2]) >= 3 then keys := keys || m[2]; end if;
  end loop;

  for m in select regexp_matches(t, '\m(?:7-?eleven|7-?11|store|site|job)\s*#?\s*:?\s*(\d{4,5})\M', 'gi') loop
    keys := keys || m[1];
  end loop;

  -- A bare five-digit store number. "TEC 14765" is how the crews write SU-14765, so it is tried both ways.
  -- careful = the PO / job box read off the paper, which often holds a whole address: a street number or ZIP
  -- code there is not a store number, so bare numbers only count when the box is short.
  if careful and length(btrim(t)) > 24 then return keys; end if;
  for m in select regexp_matches(t, '(?<![\w./$])(\d{5})(?![\w/]|\.\d)', 'g') loop
    keys := keys || m[1] || ('SU' || m[1]);
  end loop;

  return keys;
end
$$;

create or replace function con_pick_job_for_doc(p_company uuid, p_subject text, p_po text, p_day date, p_self uuid default null)
returns uuid
language plpgsql stable
set search_path = public
as $$
declare
  subj_keys text[] := con_doc_site_keys(p_subject);
  po_keys   text[] := con_doc_site_keys(p_po, true);
  keys text[];
  k text;
  job uuid;
  po_text text := coalesce(p_subject, '') || ' ' || coalesce(p_po, '');
  po text;
begin
  keys := subj_keys || po_keys;
  foreach k in array keys loop
    select j.id into job
    from con_jobs j
    left join lateral (
      select max(h.changed_at)::date as done_on from con_job_stage_history h where h.job_id = j.id and h.to_stage = 'complete'
    ) c on true
    where j.company_id = p_company and con_site_key(j.site_number) = k
    order by
      -- the job's own PO number is on the paper
      (j.po_number is not null and length(btrim(j.po_number)) >= 4 and po_text ~ ('\m' || regexp_replace(btrim(j.po_number), '\D', '', 'g') || '\M')) desc,
      -- a job from the paper's own year: 33453-26 for a 2026 receipt, never 33453-16
      (coalesce(extract(year from j.date_received)::int,
                2000 + substring(j.job_number from '-(\d\d)[A-Z]*$')::int,
                extract(year from j.created_at)::int) = extract(year from p_day)::int) desc,
      -- it was open on the paper's date
      ((j.date_received is null or j.date_received <= p_day + 2)
        and (j.stage <> 'complete' or c.done_on is null or c.done_on >= p_day - 14)) desc,
      -- received before the paper's date at all
      (j.date_received is not null and j.date_received <= p_day + 2) desc,
      -- real work ahead of a quote request
      (j.stage not in ('quoting', 'on_hold')) desc,
      j.date_received desc nulls last,
      c.done_on desc nulls first,
      j.created_at desc
    limit 1;
    if job is not null then return job; end if;
  end loop;

  -- No site on it: follow the PO number.
  for po in select distinct (regexp_matches(po_text, '\m(2\d{4})\M', 'g'))[1] loop
    select j.id into job from con_jobs j
     where j.company_id = p_company and regexp_replace(coalesce(j.po_number, ''), '\D', '', 'g') = po
     order by j.date_received desc nulls last limit 1;
    if job is not null then return job; end if;

    select d.con_job_id into job
      from billing_inbox_documents d
     where d.company_id = p_company and d.con_job_id is not null
       and (p_self is null or d.id <> p_self)
       and (d.extracted->>'po_or_job') ~ ('\m' || po || '\M')
       and cardinality(con_doc_site_keys(d.subject)) > 0
     group by d.con_job_id
     order by count(*) desc
     limit 1;
    if job is not null then return job; end if;
  end loop;

  return null;
end
$$;

-- The paper's own date when it is believable, else the day it was emailed (Eastern time).
create or replace function billing_inbox_doc_day(p_received timestamptz, p_document date, p_extracted jsonb) returns date
language plpgsql immutable
set search_path = public
as $$
declare
  emailed date := (p_received at time zone 'America/New_York')::date;
  read date;
begin
  begin
    read := coalesce(nullif(p_extracted->>'document_date', '')::date, p_document);
  exception when others then
    read := p_document;
  end;
  if read is not null and read between emailed - 120 and emailed + 2 then return read; end if;
  return emailed;
end
$$;

create or replace function billing_inbox_link_job() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.job_link_source = 'manual' then return new; end if;
  new.con_job_id := con_pick_job_for_doc(
    new.company_id, new.subject, new.extracted->>'po_or_job',
    billing_inbox_doc_day(new.received_at, new.document_date, new.extracted), new.id);
  new.job_link_source := case when new.con_job_id is null then null else 'auto' end;
  return new;
exception when others then
  -- Working out the job must never stop an email from being filed.
  return new;
end
$$;

drop trigger if exists billing_inbox_link_job_trg on billing_inbox_documents;
create trigger billing_inbox_link_job_trg
  before insert or update of subject, extracted, document_date on billing_inbox_documents
  for each row execute function billing_inbox_link_job();

-- These are called by the trigger and by the app's service role only.
revoke all on function con_pick_job_for_doc(uuid, text, text, date, uuid) from public, anon, authenticated;
revoke all on function billing_inbox_link_job() from public, anon, authenticated;

-- What an hour of crew labor costs the company (wages + burden), used by the job Cost Summary.
-- NULL = not set yet: the page then figures labor at the customer's billing rate and says so.
alter table companies add column if not exists labor_cost_rate numeric;
