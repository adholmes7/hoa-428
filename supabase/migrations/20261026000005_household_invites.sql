-- Owners can invite a co-owner or household member to their own unit with a
-- single-use code. Unlike admin_create_invite, this doesn't cancel the unit's
-- other codes. Capped so one unit can't add unlimited accounts.

alter table public.unit_invites add column kind text not null default 'admin' check (kind in ('admin', 'household'));

create or replace function public.create_household_invite()
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  max_accounts constant int := 4;
  v_unit int := my_unit();
  v_code text := '';
  i int;
begin
  if v_unit is null then
    raise exception 'Owners only';
  end if;
  if (select count(*) from profiles where unit_id = v_unit and active) >= max_accounts then
    raise exception 'Your unit already has % accounts. Ask the site admin if you need another.', max_accounts;
  end if;
  if (select count(*) from unit_invites
       where unit_id = v_unit and kind = 'household' and not revoked and uses < max_uses
         and created_at > now() - interval '30 days') >= 2 then
    raise exception 'Your unit already has 2 unused household codes. Use or cancel one first.';
  end if;
  for i in 1..12 loop
    v_code := v_code || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
  end loop;
  insert into unit_invites (unit_id, code_hash, max_uses, created_by, kind)
  values (v_unit, encode(digest(v_code, 'sha256'), 'hex'), 1, auth.uid(), 'household');
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
end;
$$;

-- Household codes expire after 30 days (checked at claim time)
create or replace function public.claim_invite(p_unit int, p_code text, p_display_name text)
returns public.profiles
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_inv unit_invites;
  v_profile profiles;
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'This account is already linked to a unit';
  end if;

  select count(*) into v_recent from invite_attempts
   where user_id = auth.uid() and not ok and at > now() - interval '1 hour';
  if v_recent >= 8 then
    raise exception 'Too many attempts. Try again in an hour.';
  end if;

  select * into v_inv from unit_invites
   where unit_id = p_unit
     and code_hash = encode(digest(normalize_code(p_code), 'sha256'), 'hex')
     and not revoked
     and (kind <> 'household' or created_at > now() - interval '30 days')
   for update;

  if v_inv.id is null or v_inv.uses >= v_inv.max_uses then
    insert into invite_attempts (user_id, ok) values (auth.uid(), false);
    raise exception 'That unit number and code do not match an active invite';
  end if;

  update unit_invites set uses = uses + 1 where id = v_inv.id;
  insert into invite_attempts (user_id, ok) values (auth.uid(), true);

  insert into profiles (id, unit_id, display_name, contact_email)
  values (auth.uid(), p_unit, trim(p_display_name), (select email from auth.users where id = auth.uid()))
  returning * into v_profile;
  return v_profile;
end;
$$;

-- Owners see their own unit's household codes (hashes only), so they can cancel unused ones
create policy invites_own_unit on public.unit_invites for select
  using (kind = 'household' and unit_id = my_unit());

create or replace function public.cancel_household_invite(p_id bigint)
returns void
language sql security definer set search_path = public as $$
  update unit_invites set revoked = true
   where id = p_id and kind = 'household' and unit_id = my_unit();
$$;
