-- D0-D2 foundation. Apply through Supabase migrations after reviewing in staging.
-- This file is versioned schema only; it has not been run against a Supabase project.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  phase text not null check (phase in ('机会验证', 'MVP 开发', '上线验收', '需求验证', '增长变现', '稳定运营')),
  strategy text not null check (strategy in ('推进', '观察', '低频维护', '暂停', '归档')),
  current_goal text not null default '',
  last_decision text not null default '',
  next_action text not null default '',
  asset_links text not null default '',
  next_checkpoint date,
  strategy_condition text,
  strategy_condition_due_on date,
  archive_reason text,
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  unique (owner_id, id),
  check (strategy <> '观察' or (length(btrim(coalesce(strategy_condition, ''))) > 0 and strategy_condition_due_on is not null)),
  check (strategy <> '暂停' or length(btrim(coalesce(strategy_condition, ''))) > 0),
  check (strategy <> '归档' or length(btrim(coalesce(archive_reason, ''))) > 0)
);

create table public.captures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (length(btrim(text)) > 0),
  status text not null default '待整理' check (status in ('待整理', '已处理')),
  destination_log_id uuid,
  destination_task_id uuid,
  destination_opportunity_id uuid,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  unique (owner_id, id),
  check (
    (status = '待整理' and destination_log_id is null and destination_task_id is null and destination_opportunity_id is null and processed_at is null)
    or (status = '已处理' and processed_at is not null and num_nonnulls(destination_log_id, destination_task_id, destination_opportunity_id) = 1)
  )
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  site_id uuid not null,
  title text not null check (length(btrim(title)) > 0),
  type text not null check (type in ('执行', '复盘', '固定维护', '硬截止')),
  due_on date not null,
  status text not null default '待处理' check (status in ('待处理', '完成', '已改期')),
  source text not null default '手动录入',
  capture_id uuid,
  created_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  unique (owner_id, id),
  foreign key (owner_id, site_id) references public.sites(owner_id, id) on delete cascade,
  foreign key (owner_id, capture_id) references public.captures(owner_id, id) deferrable initially deferred
);

create table public.logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  site_id uuid not null,
  observed_at timestamptz not null default now(),
  text text not null check (length(btrim(text)) > 0),
  source_type text not null default '手动粘贴',
  source_url text,
  observed_through date,
  finalized_through date,
  collected_at timestamptz not null default now(),
  confirmed boolean not null default false,
  capture_id uuid,
  unique (owner_id, id),
  foreign key (owner_id, site_id) references public.sites(owner_id, id) on delete cascade,
  foreign key (owner_id, capture_id) references public.captures(owner_id, id) deferrable initially deferred
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  site_id uuid not null,
  raw_text text not null check (length(btrim(raw_text)) > 0),
  completed text not null,
  evidence text not null,
  open_items text not null,
  next_step text not null,
  next_action_date date not null,
  review_date date not null,
  source_url text,
  confirmed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  unique (owner_id, id),
  foreign key (owner_id, site_id) references public.sites(owner_id, id) on delete cascade
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  problem text not null check (length(btrim(problem)) > 0),
  evidence text not null check (length(btrim(evidence)) > 0),
  validation text not null check (length(btrim(validation)) > 0),
  scope text not null check (length(btrim(scope)) > 0),
  budget text not null check (length(btrim(budget)) > 0),
  pass_condition text not null check (length(btrim(pass_condition)) > 0),
  stop_condition text not null check (length(btrim(stop_condition)) > 0),
  status text not null default '想法' check (status in ('想法', '验证中', '通过', '停止')),
  site_id uuid,
  capture_id uuid,
  created_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  unique (owner_id, id),
  foreign key (owner_id, site_id) references public.sites(owner_id, id),
  foreign key (owner_id, capture_id) references public.captures(owner_id, id) deferrable initially deferred
);

alter table public.captures
  add constraint captures_log_destination_fk foreign key (owner_id, destination_log_id) references public.logs(owner_id, id) deferrable initially deferred,
  add constraint captures_task_destination_fk foreign key (owner_id, destination_task_id) references public.tasks(owner_id, id) deferrable initially deferred,
  add constraint captures_opportunity_destination_fk foreign key (owner_id, destination_opportunity_id) references public.opportunities(owner_id, id) deferrable initially deferred;

create unique index tasks_capture_unique on public.tasks(owner_id, capture_id) where capture_id is not null;
create unique index logs_capture_unique on public.logs(owner_id, capture_id) where capture_id is not null;
create unique index opportunities_capture_unique on public.opportunities(owner_id, capture_id) where capture_id is not null;
create index tasks_owner_due_on on public.tasks(owner_id, due_on);
create index logs_owner_site_collected_at on public.logs(owner_id, site_id, collected_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger sites_set_updated_at before update on public.sites for each row execute function public.set_updated_at();

create or replace function public.require_next_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id or new.id is distinct from old.id then
    raise exception 'owner_id and id cannot be changed';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'version must increment from % to %', old.version, old.version + 1;
  end if;
  return new;
end;
$$;
create trigger sites_require_next_version before update on public.sites for each row execute function public.require_next_version();
create trigger tasks_require_next_version before update on public.tasks for each row execute function public.require_next_version();
create trigger reports_require_next_version before update on public.reports for each row execute function public.require_next_version();
create trigger opportunities_require_next_version before update on public.opportunities for each row execute function public.require_next_version();
create trigger captures_require_next_version before update on public.captures for each row execute function public.require_next_version();

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.tasks enable row level security;
alter table public.logs enable row level security;
alter table public.reports enable row level security;
alter table public.opportunities enable row level security;
alter table public.captures enable row level security;

create policy profiles_owner_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_owner_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_owner_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare table_name text;
begin
  foreach table_name in array array['sites', 'tasks', 'logs', 'reports', 'opportunities', 'captures'] loop
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))', table_name || '_owner_select', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))', table_name || '_owner_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', table_name || '_owner_update', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = (select auth.uid()))', table_name || '_owner_delete', table_name);
  end loop;
end $$;

revoke all on public.profiles, public.sites, public.tasks, public.logs, public.reports, public.opportunities, public.captures from public, anon;
grant select, insert, update, delete on public.profiles, public.sites, public.tasks, public.logs, public.reports, public.opportunities, public.captures to authenticated;
