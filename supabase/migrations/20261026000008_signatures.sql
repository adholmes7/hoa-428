-- Each owner's saved signature (a small PNG data URL) for signing letters. Only the owner can read or change it,
-- not even admins, so it can't be copied onto someone else's letter.
create table public.signatures (
  user_id uuid primary key references auth.users on delete cascade,
  image text not null check (image like 'data:image/png;base64,%' and length(image) < 200000),
  updated_at timestamptz not null default now()
);
alter table public.signatures enable row level security;
create policy signatures_own on public.signatures for all
  using (user_id = auth.uid() and is_owner()) with check (user_id = auth.uid() and is_owner());
