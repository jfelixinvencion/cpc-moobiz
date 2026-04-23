create table if not exists public.moobiz_services_history (
  id text primary key,
  service_id text,
  date_finalized timestamptz,
  date_scheduled timestamptz,
  status text,
  user_name text,
  amount numeric,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_moobiz_services_history_date_finalized
  on public.moobiz_services_history (date_finalized desc);

create index if not exists idx_moobiz_services_history_user_name
  on public.moobiz_services_history (user_name);

create or replace function public.set_updated_at_moobiz_services_history()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_updated_at_moobiz_services_history on public.moobiz_services_history;
create trigger trg_set_updated_at_moobiz_services_history
before update on public.moobiz_services_history
for each row
execute function public.set_updated_at_moobiz_services_history();
