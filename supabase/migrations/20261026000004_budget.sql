-- Operating budget line items and the reserve study's 30-year projection,
-- for the budget walkthrough. Loaded by scripts/seed.mjs from private-data/.

create table public.budget_lines (
  id bigserial primary key,
  year int not null,
  account text,
  name text not null,
  category text not null check (category in ('income', 'insurance', 'utilities', 'admin', 'maintenance', 'reserves', 'other')),
  annual numeric not null,
  sort int not null default 0,
  unique (year, account, name)
);
alter table public.budget_lines enable row level security;
create policy budget_read on public.budget_lines for select using (is_owner());
create policy budget_admin on public.budget_lines for all using (is_admin()) with check (is_admin());

create table public.reserve_projection (
  year int primary key,
  annual_expenses numeric not null,
  fully_funded numeric not null,
  current_contribution numeric not null,
  current_balance numeric not null,
  current_pct numeric not null,
  recommended_contribution numeric not null,
  recommended_balance numeric not null,
  recommended_pct numeric not null,
  threshold_contribution numeric not null,
  threshold_balance numeric not null,
  threshold_pct numeric not null
);
alter table public.reserve_projection enable row level security;
create policy reserve_projection_read on public.reserve_projection for select using (is_owner());
create policy reserve_projection_admin on public.reserve_projection for all using (is_admin()) with check (is_admin());
