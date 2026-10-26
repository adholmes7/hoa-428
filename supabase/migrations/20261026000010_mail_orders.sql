-- Card payments for letters mailed through the site. An order is created when an owner starts checkout; the
-- Stripe webhook mails the letter once the payment clears, or refunds it if Lob rejects the letter.
-- Only the server (service role) writes orders; owners can read their own unit's, admins all.

create table public.mail_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests on delete set null,
  user_id uuid not null references auth.users on delete cascade,
  unit_id int not null references public.units,
  service text not null check (service in ('first_class', 'certified', 'certified_rr')),
  email_copy boolean not null default true,
  to_addr jsonb not null,
  from_addr jsonb not null,
  pdf_path text not null,
  amount_cents int not null check (amount_cents > 0),
  lob_cost numeric not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'refunded', 'expired', 'cancelled')),
  stripe_session_id text unique,
  stripe_payment_intent text,
  checkout_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mail_orders_request on public.mail_orders (request_id, created_at desc);

alter table public.mail_orders enable row level security;
create policy mail_orders_read on public.mail_orders for select using (unit_id = my_unit() or is_admin());

-- What the owner paid by card for a mailed letter (null when the site paid, e.g. admin sends)
alter table public.requests add column mail_paid_cents int;
