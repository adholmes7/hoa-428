-- Opt-in owner chat: public channels, private group chats, and direct messages.
-- Only owners who switch on chat_opt_in can see or post anything here.

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  topic text,
  kind text not null default 'channel' check (kind in ('channel', 'group', 'dm')),
  created_by uuid references auth.users default auth.uid(),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.channel_members (
  channel_id uuid not null references public.channels on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table public.messages (
  id bigserial primary key,
  channel_id uuid not null references public.channels on delete cascade,
  user_id uuid not null references auth.users default auth.uid(),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted boolean not null default false
);
create index messages_channel_time on public.messages (channel_id, created_at desc);

create or replace function public.is_channel_member(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from channel_members where channel_id = p_channel and user_id = auth.uid());
$$;

create or replace function public.can_see_channel(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select chat_ok() and exists (
    select 1 from channels c
     where c.id = p_channel and (c.kind = 'channel' or is_channel_member(c.id))
  );
$$;

alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;

create policy channels_read on public.channels for select using (can_see_channel(id));
create policy channels_create on public.channels for insert
  with check (chat_ok() and created_by = auth.uid() and kind = 'channel');
create policy channels_update on public.channels for update
  using (chat_ok() and (created_by = auth.uid() or is_admin()));

create policy members_read on public.channel_members for select using (can_see_channel(channel_id));
-- Anyone opted in may join a public channel; leaving is always allowed
create policy members_join on public.channel_members for insert
  with check (user_id = auth.uid() and chat_ok()
              and exists (select 1 from public.channels c where c.id = channel_id and c.kind = 'channel'));
create policy members_update_self on public.channel_members for update using (user_id = auth.uid());
create policy members_leave on public.channel_members for delete using (user_id = auth.uid());

create policy messages_read on public.messages for select using (can_see_channel(channel_id));
create policy messages_post on public.messages for insert
  with check (user_id = auth.uid() and chat_ok() and is_channel_member(channel_id)
              and not (select archived from public.channels where id = channel_id));
create policy messages_edit on public.messages for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Create a private group with chosen members (all must have opted in).
create or replace function public.create_group(p_name text, p_members uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not chat_ok() then raise exception 'Turn on chat in your profile first'; end if;
  insert into channels (name, kind, created_by) values (p_name, 'group', auth.uid()) returning id into v_id;
  insert into channel_members (channel_id, user_id)
    select v_id, p.id from profiles p
     where p.active and p.chat_opt_in and (p.id = any (p_members) or p.id = auth.uid())
    on conflict do nothing;
  return v_id;
end;
$$;

-- Add people to a group you belong to.
create or replace function public.add_group_members(p_channel uuid, p_members uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (chat_ok() and is_channel_member(p_channel)
          and exists (select 1 from channels where id = p_channel and kind = 'group')) then
    raise exception 'Not allowed';
  end if;
  insert into channel_members (channel_id, user_id)
    select p_channel, p.id from profiles p where p.active and p.chat_opt_in and p.id = any (p_members)
    on conflict do nothing;
end;
$$;

-- Open (or reuse) a direct-message conversation.
create or replace function public.start_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not chat_ok() then raise exception 'Turn on chat in your profile first'; end if;
  if not exists (select 1 from profiles where id = p_other and active and chat_opt_in) then
    raise exception 'That owner has not turned on chat';
  end if;
  select c.id into v_id from channels c
   where c.kind = 'dm'
     and exists (select 1 from channel_members m where m.channel_id = c.id and m.user_id = auth.uid())
     and exists (select 1 from channel_members m where m.channel_id = c.id and m.user_id = p_other)
   limit 1;
  if v_id is null then
    insert into channels (name, kind, created_by) values ('dm', 'dm', auth.uid()) returning id into v_id;
    insert into channel_members (channel_id, user_id) values (v_id, auth.uid()), (v_id, p_other);
  end if;
  return v_id;
end;
$$;

-- Unread counts for the sidebar
create or replace function public.my_channels()
returns table (id uuid, name text, topic text, kind text, member boolean, unread int, last_at timestamptz, other_names text)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.topic, c.kind,
         m.user_id is not null,
         coalesce((select count(*)::int from messages x
                    where x.channel_id = c.id and not x.deleted and x.user_id <> auth.uid()
                      and x.created_at > m.last_read_at), 0),
         (select max(created_at) from messages x where x.channel_id = c.id),
         (select string_agg(p.display_name || ' (Unit ' || p.unit_id || ')', ', ' order by p.display_name)
            from channel_members cm join profiles p on p.id = cm.user_id
           where cm.channel_id = c.id and cm.user_id <> auth.uid())
    from channels c
    left join channel_members m on m.channel_id = c.id and m.user_id = auth.uid()
   where chat_ok() and not c.archived and (c.kind = 'channel' or m.user_id is not null)
   order by c.kind, c.name;
$$;

alter publication supabase_realtime add table public.messages;

-- ---------------------------------------------------------------------------
-- Assistant usage (written by the edge function with the service key)
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
create policy ai_usage_self on public.ai_usage for select using (user_id = auth.uid());
