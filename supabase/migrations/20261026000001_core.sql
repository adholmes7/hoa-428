-- 428 Hill Street owners portal: core schema.
-- Every table is behind row-level security. Nothing is readable until a signed-in
-- user has claimed a unit with a valid invite code (see claim_invite below).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Units, owners, invites
-- ---------------------------------------------------------------------------

create table public.units (
  id int primary key,
  label text not null,
  bedrooms int,
  floor int
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  unit_id int not null references public.units,
  display_name text not null check (length(display_name) between 1 and 80),
  role text not null default 'owner' check (role in ('owner', 'admin')),
  active boolean not null default true,
  chat_opt_in boolean not null default false,
  directory_opt_in boolean not null default false,
  contact_email text,
  phone text,
  -- Mailing address used as the return address on letters
  mailing_address text,
  email_consent_on_file boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.unit_invites (
  id bigserial primary key,
  unit_id int not null references public.units,
  code_hash text not null unique,
  max_uses int not null default 3,
  uses int not null default 0,
  revoked boolean not null default false,
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);

create table public.invite_attempts (
  id bigserial primary key,
  user_id uuid not null,
  at timestamptz not null default now(),
  ok boolean not null
);

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'admin');
$$;

create or replace function public.my_unit() returns int
language sql stable security definer set search_path = public as $$
  select unit_id from profiles where id = auth.uid() and active;
$$;

create or replace function public.chat_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and chat_opt_in);
$$;

create or replace function public.normalize_code(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Claim a unit with the code from the hand-delivered letter.
create or replace function public.claim_invite(p_unit int, p_code text, p_display_name text)
returns public.profiles
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_inv unit_invites;
  v_profile profiles;
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'This account is already linked to a unit';
  end if;

  select count(*) into v_recent from invite_attempts
   where user_id = auth.uid() and not ok and at > now() - interval '1 hour';
  if v_recent >= 8 then
    raise exception 'Too many attempts. Try again in an hour.';
  end if;

  select * into v_inv from unit_invites
   where unit_id = p_unit
     and code_hash = encode(digest(normalize_code(p_code), 'sha256'), 'hex')
     and not revoked
   for update;

  if v_inv.id is null or v_inv.uses >= v_inv.max_uses then
    insert into invite_attempts (user_id, ok) values (auth.uid(), false);
    raise exception 'That unit number and code do not match an active invite';
  end if;

  update unit_invites set uses = uses + 1 where id = v_inv.id;
  insert into invite_attempts (user_id, ok) values (auth.uid(), true);

  insert into profiles (id, unit_id, display_name, contact_email)
  values (auth.uid(), p_unit, trim(p_display_name), (select email from auth.users where id = auth.uid()))
  returning * into v_profile;
  return v_profile;
end;
$$;

-- Admin: create (or replace) the invite for a unit. Returns the plain code once;
-- only its hash is stored.
create or replace function public.admin_create_invite(p_unit int, p_max_uses int default 3)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i int;
begin
  if not is_admin() then
    raise exception 'Admins only';
  end if;
  for i in 1..12 loop
    v_code := v_code || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
  end loop;
  update unit_invites set revoked = true where unit_id = p_unit and not revoked;
  insert into unit_invites (unit_id, code_hash, max_uses, created_by)
  values (p_unit, encode(digest(v_code, 'sha256'), 'hex'), p_max_uses, auth.uid());
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end;
$$;

-- Directory of owners, without private contact fields unless the owner opted in.
create or replace view public.owner_directory with (security_barrier) as
  select p.id, p.display_name, p.unit_id, p.chat_opt_in, p.role,
         case when p.directory_opt_in then p.contact_email end as contact_email,
         case when p.directory_opt_in then p.phone end as phone
    from public.profiles p
   where p.active and public.is_owner();

alter table public.units enable row level security;
alter table public.profiles enable row level security;
alter table public.unit_invites enable row level security;
alter table public.invite_attempts enable row level security;

create policy units_read on public.units for select using (auth.uid() is not null);
create policy profiles_self on public.profiles for select using (id = auth.uid() or is_admin());
create policy profiles_update_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on public.profiles for update using (is_admin()) with check (is_admin());

-- Owners can edit their own profile, but only admins can change unit, role or active.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role, new.unit_id, new.active) is distinct from (old.role, old.unit_id, old.active)
     and auth.uid() is not null and not is_admin() then
    raise exception 'Only an admin can change unit, role or active status';
  end if;
  if new.id = auth.uid() and old.role = 'admin' and new.role <> 'admin'
     and not exists (select 1 from profiles where role = 'admin' and active and id <> old.id) then
    raise exception 'The site needs at least one admin';
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();
create policy invites_admin on public.unit_invites for select using (is_admin());

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
create policy settings_read on public.site_settings for select using (is_owner());
create policy settings_admin on public.site_settings for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- CC&Rs and documents
-- ---------------------------------------------------------------------------

create table public.ccr_sections (
  id text primary key,
  article int not null,
  article_title text not null default '',
  title text not null,
  pdf_page int not null,
  pdf_page_end int not null,
  printed_page int not null,
  sort int not null,
  text text not null,
  fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(text, '')), 'B')
  ) stored
);
create index ccr_sections_fts on public.ccr_sections using gin (fts);
alter table public.ccr_sections enable row level security;
create policy ccr_read on public.ccr_sections for select using (is_owner());
create policy ccr_admin on public.ccr_sections for all using (is_admin()) with check (is_admin());

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other'
    check (category in ('governing', 'insurance', 'financial', 'minutes', 'correspondence', 'records_response', 'other')),
  doc_date date,
  source text,
  obtained_via text,
  storage_path text,
  file_name text,
  notes text,
  page_count int,
  uploaded_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.documents enable row level security;
create policy documents_read on public.documents for select using (is_owner());
create policy documents_insert on public.documents for insert with check (is_owner() and uploaded_by = auth.uid());
create policy documents_update on public.documents for update using (uploaded_by = auth.uid() or is_admin());
create policy documents_delete on public.documents for delete using (uploaded_by = auth.uid() or is_admin());

-- Page-level text for search and the assistant
create table public.document_pages (
  id bigserial primary key,
  document_id uuid not null references public.documents on delete cascade,
  page int not null,
  content text not null,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  unique (document_id, page)
);
create index document_pages_fts on public.document_pages using gin (fts);
alter table public.document_pages enable row level security;
create policy document_pages_read on public.document_pages for select using (is_owner());
create policy document_pages_write on public.document_pages for all
  using (exists (select 1 from public.documents d where d.id = document_id and (d.uploaded_by = auth.uid() or is_admin())))
  with check (exists (select 1 from public.documents d where d.id = document_id and (d.uploaded_by = auth.uid() or is_admin())));

-- ---------------------------------------------------------------------------
-- Requests to the Board and their history
-- ---------------------------------------------------------------------------

create sequence public.request_ref_seq;

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  ref_no int not null default nextval('public.request_ref_seq') unique,
  type text not null,
  title text not null,
  summary text,
  letter_body text,
  letter_fields jsonb not null default '{}',
  requester_id uuid not null references auth.users default auth.uid(),
  unit_id int not null references public.units,
  visibility text not null default 'owners' check (visibility in ('owners', 'private')),
  legal_basis text,
  day_type text check (day_type in ('business', 'calendar')),
  deadline_days int,
  deadline_kind text check (deadline_kind in ('statutory', 'ccr', 'followup')),
  if_missed text,
  method text check (method in ('personal', 'first_class', 'certified', 'certified_rr', 'online_certified', 'email_consent', 'email_copy')),
  sent_date date,
  received_date date,
  received_estimated boolean not null default false,
  due_date date,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'received', 'acknowledged', 'answered', 'deemed_denied', 'deemed_approved', 'closed', 'withdrawn')),
  carrier text,
  tracking_number text,
  tracking_status text,
  tracking_updated_at timestamptz,
  mail_provider text,
  mail_provider_id text,
  outcome text,
  answered_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_status on public.requests (status, due_date);

create or replace function public.can_see_request(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from requests r
     where r.id = p_id
       and is_owner()
       and (r.unit_id = my_unit() or (r.visibility = 'owners' and r.status <> 'draft'))
  );
$$;

create or replace function public.can_edit_request(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from requests r where r.id = p_id and is_owner() and r.unit_id = my_unit());
$$;

alter table public.requests enable row level security;
create policy requests_read on public.requests for select
  using (is_owner() and (unit_id = my_unit() or (visibility = 'owners' and status <> 'draft')));
create policy requests_insert on public.requests for insert
  with check (is_owner() and requester_id = auth.uid() and unit_id = my_unit());
create policy requests_update on public.requests for update
  using (is_owner() and unit_id = my_unit()) with check (unit_id = my_unit());
create policy requests_delete on public.requests for delete
  using (is_owner() and unit_id = my_unit() and status = 'draft');

create table public.request_events (
  id bigserial primary key,
  request_id uuid not null references public.requests on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  note text,
  created_by uuid references auth.users default auth.uid()
);
alter table public.request_events enable row level security;
create policy request_events_read on public.request_events for select using (can_see_request(request_id));
create policy request_events_insert on public.request_events for insert
  with check (can_edit_request(request_id) and created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- Maintenance & incident log
-- ---------------------------------------------------------------------------

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other'
    check (category in ('leak', 'plumbing', 'roof', 'electrical', 'pest', 'structural', 'safety', 'other')),
  location_type text not null default 'common' check (location_type in ('common', 'unit')),
  location text,
  occurred_on date,
  reported_on date,
  description text,
  reported_to text,
  hoa_response text,
  diagnosed boolean,
  diagnosis text,
  resolved boolean not null default false,
  cost numeric,
  fund text check (fund in ('operating', 'reserve', 'insurance', 'owner', 'unknown')),
  consent_confirmed boolean not null default false,
  unit_id int references public.units,
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Owners may log only what they have first-hand knowledge of and consent to share
  constraint incidents_consent check (consent_confirmed)
);
alter table public.incidents enable row level security;
create policy incidents_read on public.incidents for select using (is_owner());
create policy incidents_insert on public.incidents for insert with check (is_owner() and created_by = auth.uid());
create policy incidents_update on public.incidents for update using (created_by = auth.uid() or is_admin());
create policy incidents_delete on public.incidents for delete using (created_by = auth.uid() or is_admin());

-- ---------------------------------------------------------------------------
-- Board meetings
-- ---------------------------------------------------------------------------

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,
  kind text not null default 'board' check (kind in ('board', 'annual', 'special', 'executive', 'committee')),
  title text,
  agenda_document_id uuid references public.documents on delete set null,
  minutes_document_id uuid references public.documents on delete set null,
  minutes_received_on date,
  decisions text,
  open_items text,
  created_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.meetings enable row level security;
create policy meetings_read on public.meetings for select using (is_owner());
create policy meetings_insert on public.meetings for insert with check (is_owner() and created_by = auth.uid());
create policy meetings_update on public.meetings for update using (created_by = auth.uid() or is_admin());
create policy meetings_delete on public.meetings for delete using (created_by = auth.uid() or is_admin());

-- ---------------------------------------------------------------------------
-- Finance figures (seeded from the budget packet; editable by admins)
-- ---------------------------------------------------------------------------

create table public.finance_facts (
  id bigserial primary key,
  metric text not null,
  label text not null,
  period text not null,
  value numeric not null,
  unit text not null default 'usd',
  source text,
  verified boolean not null default true,
  sort int not null default 0
);
alter table public.finance_facts enable row level security;
create policy finance_read on public.finance_facts for select using (is_owner());
create policy finance_admin on public.finance_facts for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Attachments (files on requests and incidents)
-- ---------------------------------------------------------------------------

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests on delete cascade,
  incident_id uuid references public.incidents on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  label text,
  uploaded_by uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now(),
  check (request_id is not null or incident_id is not null)
);
alter table public.attachments enable row level security;
create policy attachments_read on public.attachments for select
  using (is_owner() and (incident_id is not null or can_see_request(request_id)));
create policy attachments_insert on public.attachments for insert
  with check (is_owner() and uploaded_by = auth.uid()
              and (request_id is null or can_edit_request(request_id)));
create policy attachments_delete on public.attachments for delete using (uploaded_by = auth.uid());

-- Storage buckets (private)
insert into storage.buckets (id, name, public) values
  ('documents', 'documents', false),
  ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "documents bucket read" on storage.objects for select
  using (bucket_id = 'documents' and public.is_owner());
create policy "documents bucket write" on storage.objects for insert
  with check (bucket_id = 'documents' and public.is_owner() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments bucket read" on storage.objects for select
  using (bucket_id = 'attachments' and public.is_owner()
         and exists (select 1 from public.attachments a where a.storage_path = name));
create policy "attachments bucket write" on storage.objects for insert
  with check (bucket_id = 'attachments' and public.is_owner() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own objects delete" on storage.objects for delete
  using (bucket_id in ('documents', 'attachments') and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Search across CC&Rs, documents, requests and incidents
-- ---------------------------------------------------------------------------

create or replace function public.search_all(q text, max_results int default 20)
returns table (kind text, ref text, title text, snippet text, rank real, page int)
language sql stable security invoker set search_path = public as $$
  with query as (select websearch_to_tsquery('english', q) as tsq)
  select * from (
    select 'ccr'::text, s.id, 'CC&R §' || s.id || ' ' || s.title,
           ts_headline('english', s.text, query.tsq, 'MaxWords=40, MinWords=15, MaxFragments=2'),
           ts_rank(s.fts, query.tsq), s.pdf_page
      from ccr_sections s, query where s.fts @@ query.tsq
    union all
    select 'document', d.id::text, d.title,
           ts_headline('english', p.content, query.tsq, 'MaxWords=40, MinWords=15, MaxFragments=2'),
           ts_rank(p.fts, query.tsq), p.page
      from document_pages p join documents d on d.id = p.document_id, query
     where p.fts @@ query.tsq and d.category <> 'governing'  -- CC&Rs are searched by section above
    union all
    select 'request', r.id::text, 'Request #' || r.ref_no || ': ' || r.title,
           left(coalesce(r.summary, ''), 200), 0.5::real, null::int
      from requests r, query
     where to_tsvector('english', r.title || ' ' || coalesce(r.summary, '')) @@ query.tsq
    union all
    select 'incident', i.id::text, i.title, left(coalesce(i.description, ''), 200), 0.5::real, null::int
      from incidents i, query
     where to_tsvector('english', i.title || ' ' || coalesce(i.description, '') || ' ' || coalesce(i.location, '')) @@ query.tsq
  ) results
  order by 5 desc
  limit max_results;
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger requests_touch before update on public.requests for each row execute function public.touch_updated_at();
create trigger incidents_touch before update on public.incidents for each row execute function public.touch_updated_at();
