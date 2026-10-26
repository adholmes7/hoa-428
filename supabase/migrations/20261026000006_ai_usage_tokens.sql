-- Token counts per owner per day, so admins can see what the assistant costs.
-- Question text is never stored.

alter table public.ai_usage
  add column input_tokens bigint not null default 0,
  add column output_tokens bigint not null default 0,
  add column cache_read_tokens bigint not null default 0,
  add column cache_write_tokens bigint not null default 0;

create policy ai_usage_admin on public.ai_usage for select using (is_admin());
