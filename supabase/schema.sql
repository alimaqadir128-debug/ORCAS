-- ORCAS optional Supabase schema. Run once in the Supabase SQL editor.
-- The app works without Supabase (it keeps a local JSON history). If you set SUPABASE_URL and
-- SUPABASE_SERVICE_KEY, reports and periodic telemetry are mirrored here in the background.

create table if not exists public.orcas_reports (
  id          bigint generated always as identity primary key,
  report_id   text not null,
  report_type text not null,
  title       text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.orcas_telemetry (
  id          bigint generated always as identity primary key,
  unit_id     text not null,
  product     text,
  temp_c      numeric,
  rh          numeric,
  risk        integer,
  battery_pct numeric,
  solar_w     integer,
  source      text,
  created_at  timestamptz not null default now()
);

create index if not exists orcas_telemetry_unit_time on public.orcas_telemetry (unit_id, created_at desc);

-- Server writes use the service key (bypasses RLS). Keep RLS on so the public anon key cannot read or write.
alter table public.orcas_reports   enable row level security;
alter table public.orcas_telemetry enable row level security;
