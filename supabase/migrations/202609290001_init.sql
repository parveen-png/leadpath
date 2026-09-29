-- Leadpath schema. Run in the Supabase SQL editor or with the Supabase CLI.

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Toronto',
  meta_graph_version text,
  default_event_type text not null default 'General Inquiry',
  log_level text not null default 'info',
  max_delivery_attempts integer not null default 5,
  demo_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from public.profiles where id = auth.uid()
$$;

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider in ('meta', 'follow_up_boss')),
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  account_label text,
  encrypted_credentials text,
  public_config jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table public.meta_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  page_id text not null,
  name text not null,
  encrypted_access_token text,
  category text,
  subscribed boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, page_id)
);

create index meta_pages_page_id_idx on public.meta_pages (page_id);

create table public.meta_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  page_id text not null,
  form_id text not null,
  name text not null,
  status text,
  field_count integer not null default 0,
  meta_updated_time timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, form_id)
);

create table public.meta_form_fields (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  form_id text not null,
  field_key text not null,
  label text not null,
  field_type text,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, form_id, field_key)
);

create table public.fub_fields (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  fub_id text,
  label text not null,
  api_name text not null,
  field_type text not null,
  category text not null,
  is_custom boolean not null default false,
  is_recurring boolean,
  choices jsonb not null default '[]'::jsonb,
  choice_map jsonb not null default '{}'::jsonb,
  write_target text not null,
  removed_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (workspace_id, api_name)
);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  page_id text,
  page_name text,
  form_id text,
  form_name text,
  form_scope text not null default 'specific' check (form_scope in ('specific', 'any')),
  event_type text not null default 'General Inquiry',
  source_name text not null default 'Facebook',
  campaign_source text not null default 'Facebook',
  system_name text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workflows_match_idx on public.workflows (workspace_id, status, page_id);

create table public.workflow_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  source_key text not null,
  source_label text not null,
  source_group text not null,
  destination_api_name text,
  destination_label text,
  transform jsonb not null default '{"type":"none"}'::jsonb,
  ignored boolean not null default false,
  save_to_background boolean not null default false,
  sort_order integer not null default 0,
  unique (workflow_id, source_key)
);

create table public.workflow_static_values (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  destination_api_name text not null,
  destination_label text not null,
  value text not null,
  unique (workflow_id, destination_api_name)
);

create table public.workflow_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  kind text not null check (kind in ('static', 'dynamic')),
  value text not null
);

create table public.workflow_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  combinator text not null default 'and' check (combinator in ('and', 'or')),
  conditions jsonb not null default '[]'::jsonb,
  tag text not null,
  sort_order integer not null default 0
);

create table public.workflow_translations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  destination_api_name text not null,
  from_value text not null,
  to_value text not null,
  unique (workflow_id, destination_api_name, from_value)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  provider text not null default 'meta',
  external_id text,
  payload jsonb not null,
  signature_valid boolean not null default false,
  status text not null default 'received',
  correlation_id text not null,
  received_at timestamptz not null default now()
);

create index webhook_events_external_idx on public.webhook_events (external_id, received_at desc);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  workflow_id uuid references public.workflows (id) on delete set null,
  meta_lead_id text not null,
  page_id text,
  page_name text,
  form_id text,
  form_name text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  platform text,
  lead_created_at timestamptz,
  display_name text,
  email text,
  phone text,
  status text not null default 'received' check (status in (
    'received', 'queued', 'processing', 'delivered', 'delivered_with_warning', 'failed', 'retrying', 'ignored'
  )),
  fub_person_id text,
  fub_account_domain text,
  is_test boolean not null default false,
  is_demo boolean not null default false,
  is_duplicate boolean not null default false,
  last_error text,
  friendly_error text,
  correlation_id text not null,
  received_at timestamptz not null default now(),
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, meta_lead_id)
);

create index leads_workspace_received_idx on public.leads (workspace_id, received_at desc);
create index leads_status_idx on public.leads (workspace_id, status);

create table public.lead_payloads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null unique references public.leads (id) on delete cascade,
  facebook_raw jsonb not null default '{}'::jsonb,
  mapped jsonb not null default '{}'::jsonb,
  fub_event jsonb,
  fub_response jsonb,
  tags_request jsonb,
  tags_response jsonb,
  timeline jsonb not null default '[]'::jsonb
);

create table public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  status text not null default 'queued',
  stage text not null default 'fetch',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  last_http_status integer,
  safe_response_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index delivery_jobs_due_idx on public.delivery_jobs (status, next_run_at);

create table public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  job_id uuid not null references public.delivery_jobs (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  attempt_number integer not null,
  stage text not null,
  http_status integer,
  success boolean not null,
  error_summary text,
  safe_response jsonb,
  created_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_logs_workspace_idx on public.activity_logs (workspace_id, created_at desc);

create table public.duplicate_webhook_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meta_lead_id text not null,
  lead_id uuid references public.leads (id) on delete set null,
  correlation_id text not null,
  received_at timestamptz not null default now()
);

create table public.rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits integer not null
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace uuid;
  workspace_name text;
begin
  workspace_name := coalesce(nullif(trim(new.raw_user_meta_data->>'workspace_name'), ''), 'My Workspace');
  insert into public.workspaces (name)
  values (workspace_name)
  returning id into new_workspace;

  insert into public.profiles (id, workspace_id, full_name, email)
  values (
    new.id,
    new_workspace,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    new.email
  );

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create trigger workspaces_touch before update on public.workspaces
for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
for each row execute function public.touch_updated_at();
create trigger connections_touch before update on public.connections
for each row execute function public.touch_updated_at();
create trigger meta_pages_touch before update on public.meta_pages
for each row execute function public.touch_updated_at();
create trigger meta_forms_touch before update on public.meta_forms
for each row execute function public.touch_updated_at();
create trigger workflows_touch before update on public.workflows
for each row execute function public.touch_updated_at();
create trigger leads_touch before update on public.leads
for each row execute function public.touch_updated_at();
create trigger delivery_jobs_touch before update on public.delivery_jobs
for each row execute function public.touch_updated_at();

create or replace function public.claim_delivery_jobs(batch_size integer)
returns setof public.delivery_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select jobs.id
    from public.delivery_jobs as jobs
    where jobs.status in ('queued', 'retrying')
      and jobs.next_run_at <= now()
      and (jobs.locked_at is null or jobs.locked_at < now() - interval '5 minutes')
    order by jobs.next_run_at
    limit batch_size
    for update skip locked
  )
  update public.delivery_jobs as job
  set status = 'processing',
      locked_at = now(),
      updated_at = now()
  from due
  where job.id = due.id
  returning job.*;
end;
$$;

revoke all on function public.claim_delivery_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_delivery_jobs(integer) to service_role;
grant execute on function public.current_workspace_id() to authenticated;

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_members enable row level security;
alter table public.connections enable row level security;
alter table public.meta_pages enable row level security;
alter table public.meta_forms enable row level security;
alter table public.meta_form_fields enable row level security;
alter table public.fub_fields enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_mappings enable row level security;
alter table public.workflow_static_values enable row level security;
alter table public.workflow_tags enable row level security;
alter table public.workflow_rules enable row level security;
alter table public.workflow_translations enable row level security;
alter table public.webhook_events enable row level security;
alter table public.leads enable row level security;
alter table public.lead_payloads enable row level security;
alter table public.delivery_jobs enable row level security;
alter table public.delivery_attempts enable row level security;
alter table public.activity_logs enable row level security;
alter table public.duplicate_webhook_attempts enable row level security;
alter table public.rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

grant select, update on public.workspaces to authenticated;
create policy workspaces_select on public.workspaces for select to authenticated
  using (id = public.current_workspace_id());
create policy workspaces_update on public.workspaces for update to authenticated
  using (id = public.current_workspace_id())
  with check (id = public.current_workspace_id());

grant select, update on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or workspace_id = public.current_workspace_id());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and workspace_id = public.current_workspace_id());

grant select on public.workspace_members to authenticated;
create policy members_select on public.workspace_members for select to authenticated
  using (workspace_id = public.current_workspace_id());

grant select (
  id, workspace_id, provider, status, account_label, public_config,
  last_tested_at, last_synced_at, last_error, created_at, updated_at
) on public.connections to authenticated;
create policy connections_select on public.connections for select to authenticated
  using (workspace_id = public.current_workspace_id());

grant select (
  id, workspace_id, page_id, name, category, subscribed, is_demo, created_at, updated_at
) on public.meta_pages to authenticated;
create policy meta_pages_select on public.meta_pages for select to authenticated
  using (workspace_id = public.current_workspace_id());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'meta_forms',
    'meta_form_fields',
    'fub_fields',
    'workflows',
    'workflow_mappings',
    'workflow_static_values',
    'workflow_tags',
    'workflow_rules',
    'workflow_translations',
    'leads',
    'lead_payloads',
    'delivery_jobs',
    'delivery_attempts',
    'duplicate_webhook_attempts'
  ]
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id())',
      table_name || '_workspace',
      table_name
    );
  end loop;
end $$;

grant select on public.webhook_events to authenticated;
create policy webhook_events_select on public.webhook_events for select to authenticated
  using (workspace_id = public.current_workspace_id());

grant select, insert on public.activity_logs to authenticated;
create policy activity_select on public.activity_logs for select to authenticated
  using (workspace_id = public.current_workspace_id());
create policy activity_insert on public.activity_logs for insert to authenticated
  with check (workspace_id = public.current_workspace_id());
