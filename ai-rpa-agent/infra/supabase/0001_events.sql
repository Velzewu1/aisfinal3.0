-- Append-only event store for AI RPA agent.
-- Events are immutable: no UPDATE / DELETE policies are created.

create table if not exists public.ai_rpa_events (
  id             text primary key,
  correlation_id text not null,
  type           text not null,
  ts             timestamptz not null,
  payload        jsonb not null,
  inserted_at    timestamptz not null default now()
);

create index if not exists ai_rpa_events_correlation_idx
  on public.ai_rpa_events (correlation_id);

create index if not exists ai_rpa_events_type_idx
  on public.ai_rpa_events (type);

create index if not exists ai_rpa_events_ts_idx
  on public.ai_rpa_events (ts desc);

alter table public.ai_rpa_events enable row level security;

-- Insert-only policy. No SELECT policy here by default; add tenant-scoped
-- SELECT policies in a follow-up migration that matches your org model.
create policy ai_rpa_events_insert_any
  on public.ai_rpa_events
  for insert
  to authenticated
  with check (true);
