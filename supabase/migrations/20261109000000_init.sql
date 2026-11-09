-- ============================================================
-- Suporte TI · schema inicial
-- Rode este arquivo no SQL Editor do Supabase (ou via supabase db push)
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums
do $$ begin
  create type public.ticket_status as enum ('pending', 'in_progress', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- perfis
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'agent' check (role in ('admin', 'agent', 'viewer')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- categorias
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  color text not null default '#64748b',
  icon text not null default '📋',
  keywords text[] not null default '{}',
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- protocolo
create sequence if not exists public.ticket_protocol_seq start 1;

create or replace function public.next_protocol()
returns text
language plpgsql
as $$
declare
  n bigint;
begin
  n := nextval('public.ticket_protocol_seq');
  return 'TI-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
end $$;

-- ---------------------------------------------------------------- chamados
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  protocol text unique not null default public.next_protocol(),
  group_id text not null,
  group_name text,
  wa_message_id text,
  requester_id text,
  requester_name text,
  requester_phone text,
  content text not null,
  summary text,
  category_id uuid references public.categories(id) on delete set null,
  category_slug text,
  priority public.ticket_priority not null default 'medium',
  status public.ticket_status not null default 'pending',
  assignee_id uuid references auth.users(id) on delete set null,
  assignee_name text,
  ai_confidence numeric(4, 3),
  ai_reason text,
  source text not null default 'whatsapp',
  media jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  closed_at timestamptz,
  sla_due_at timestamptz
);

create index if not exists tickets_status_idx on public.tickets (status);
create index if not exists tickets_category_idx on public.tickets (category_id);
create index if not exists tickets_created_idx on public.tickets (created_at desc);
create index if not exists tickets_group_idx on public.tickets (group_id);
create index if not exists tickets_requester_idx on public.tickets (requester_id);
create index if not exists tickets_wa_message_idx on public.tickets (wa_message_id);

-- ---------------------------------------------------------------- mensagens brutas
create table if not exists public.raw_messages (
  id bigint generated always as identity primary key,
  group_id text not null,
  group_name text,
  wa_message_id text unique,
  sender_id text,
  sender_name text,
  sender_phone text,
  content text,
  media jsonb not null default '[]'::jsonb,
  ticket_id uuid references public.tickets(id) on delete set null,
  processed boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists raw_messages_created_idx on public.raw_messages (created_at desc);

-- ---------------------------------------------------------------- histórico
create table if not exists public.ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text,
  type text not null,
  from_value text,
  to_value text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);

-- ---------------------------------------------------------------- configurações
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  group_ids text[] not null default '{}',
  auto_create boolean not null default true,
  ai_enabled boolean not null default true,
  sla_hours int not null default 24,
  merge_window_minutes int not null default 15,
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tickets_touch on public.tickets;
create trigger tickets_touch
  before update on public.tickets
  for each row execute function public.touch_updated_at();

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch
  before update on public.settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- perfil automático
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.tickets enable row level security;
alter table public.raw_messages enable row level security;
alter table public.ticket_events enable row level security;
alter table public.settings enable row level security;

-- profiles
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- categories
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories
  for select to authenticated using (true);

drop policy if exists categories_admin on public.categories;
create policy categories_admin on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- tickets
drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets
  for select to authenticated using (true);

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets
  for insert to authenticated with check (true);

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update to authenticated using (true) with check (true);

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets
  for delete to authenticated using (public.is_admin());

-- raw messages
drop policy if exists raw_read on public.raw_messages;
create policy raw_read on public.raw_messages
  for select to authenticated using (true);

drop policy if exists raw_insert on public.raw_messages;
create policy raw_insert on public.raw_messages
  for insert to authenticated with check (true);

-- events
drop policy if exists events_read on public.ticket_events;
create policy events_read on public.ticket_events
  for select to authenticated using (true);

drop policy if exists events_insert on public.ticket_events;
create policy events_insert on public.ticket_events
  for insert to authenticated with check (true);

-- settings
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings
  for select to authenticated using (true);

drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------- estatísticas
create or replace function public.dashboard_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'done', count(*) filter (where status = 'done'),
    'cancelled', count(*) filter (where status = 'cancelled'),
    'total', count(*),
    'sla_breached', count(*) filter (
      where status in ('pending', 'in_progress')
        and sla_due_at is not null
        and sla_due_at < now()
    ),
    'avg_resolution_hours', coalesce(
      avg(extract(epoch from (closed_at - created_at)) / 3600)
        filter (where status = 'done' and closed_at is not null),
      0
    )
  )
  from public.tickets;
$$;

revoke all on function public.dashboard_stats() from public;
grant execute on function public.dashboard_stats() to authenticated;

-- ---------------------------------------------------------------- realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tickets'
  ) then
    alter publication supabase_realtime add table public.tickets;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ticket_events'
  ) then
    alter publication supabase_realtime add table public.ticket_events;
  end if;
end $$;
