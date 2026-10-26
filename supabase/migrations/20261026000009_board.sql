-- Bulletin board: posts any owner can make (notices, questions, events), replies, optional polls,
-- and emoji reactions on posts, replies and chat messages.
-- Open to every active owner; it doesn't depend on the chat opt-in.

create table public.board_posts (
  id bigserial primary key,
  author_id uuid not null references auth.users on delete cascade default auth.uid(),
  category text not null default 'general' check (category in ('general', 'notice', 'question', 'event', 'poll')),
  title text not null check (length(title) between 1 and 140),
  body text not null default '' check (length(body) <= 10000),
  pinned boolean not null default false,
  -- Poll settings (only used when the post has options)
  poll_multi boolean not null default false,
  poll_per_unit boolean not null default true,
  poll_show_voters boolean not null default false,
  poll_closes_at timestamptz,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  last_activity_at timestamptz not null default now()
);
create index board_posts_activity on public.board_posts (pinned desc, last_activity_at desc);

create table public.board_replies (
  id bigserial primary key,
  post_id bigint not null references public.board_posts on delete cascade,
  author_id uuid not null references auth.users on delete cascade default auth.uid(),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted boolean not null default false
);
create index board_replies_post on public.board_replies (post_id, created_at);

create table public.board_poll_options (
  id bigserial primary key,
  post_id bigint not null references public.board_posts on delete cascade,
  label text not null check (length(label) between 1 and 120),
  position int not null default 0
);
create index board_poll_options_post on public.board_poll_options (post_id, position);

create table public.board_poll_votes (
  post_id bigint not null references public.board_posts on delete cascade,
  option_id bigint not null references public.board_poll_options on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  unit_id int not null references public.units,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, option_id)
);

-- One table for reactions on board posts, board replies and chat messages; exactly one target is set.
create table public.reactions (
  id bigserial primary key,
  post_id bigint references public.board_posts on delete cascade,
  reply_id bigint references public.board_replies on delete cascade,
  message_id bigint references public.messages on delete cascade,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '🙏', '👀', '✅', '🎉')),
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id, reply_id, message_id) = 1)
);
create unique index reactions_post_unique on public.reactions (post_id, user_id, emoji) where post_id is not null;
create unique index reactions_reply_unique on public.reactions (reply_id, user_id, emoji) where reply_id is not null;
create unique index reactions_message_unique on public.reactions (message_id, user_id, emoji) where message_id is not null;
create index reactions_message on public.reactions (message_id) where message_id is not null;

-- Who may see a reaction: any owner for board items; chat members for messages they can see
create or replace function public.can_see_reaction_target(p_post bigint, p_reply bigint, p_message bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_message is not null then exists (select 1 from messages m where m.id = p_message and can_see_channel(m.channel_id))
    else is_owner()
  end;
$$;

-- Reacting to a message needs channel membership (same as posting there)
create or replace function public.can_react(p_post bigint, p_reply bigint, p_message bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_message is not null then exists (
      select 1 from messages m where m.id = p_message and not m.deleted and chat_ok() and is_channel_member(m.channel_id))
    else is_owner()
  end;
$$;

alter table public.board_posts enable row level security;
alter table public.board_replies enable row level security;
alter table public.board_poll_options enable row level security;
alter table public.board_poll_votes enable row level security;
alter table public.reactions enable row level security;

create policy board_posts_read on public.board_posts for select using (is_owner());
create policy board_posts_create on public.board_posts for insert
  with check (is_owner() and author_id = auth.uid() and (not pinned or is_admin()));
create policy board_posts_edit on public.board_posts for update
  using (author_id = auth.uid() or is_admin()) with check (is_owner());
create policy board_posts_delete on public.board_posts for delete using (author_id = auth.uid() or is_admin());

-- Only admins can pin or unpin, and only the author can change the text
create or replace function public.guard_board_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.pinned is distinct from old.pinned and not is_admin() then
    raise exception 'Only an admin can pin posts';
  end if;
  if (new.title, new.body, new.category) is distinct from (old.title, old.body, old.category) and old.author_id <> auth.uid() then
    raise exception 'Only the author can edit a post';
  end if;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  return new;
end;
$$;
create trigger board_posts_guard before update on public.board_posts
  for each row execute function public.guard_board_post();

create policy board_replies_read on public.board_replies for select using (is_owner());
create policy board_replies_create on public.board_replies for insert with check (is_owner() and author_id = auth.uid());
create policy board_replies_edit on public.board_replies for update
  using (author_id = auth.uid() or is_admin()) with check (author_id = auth.uid() or is_admin());

-- New replies bump the post to the top of the board
create or replace function public.bump_board_post() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update board_posts set last_activity_at = now() where id = new.post_id;
  return new;
end;
$$;
create trigger board_replies_bump after insert on public.board_replies
  for each row execute function public.bump_board_post();

create policy board_poll_options_read on public.board_poll_options for select using (is_owner());
create policy board_poll_options_write on public.board_poll_options for insert
  with check (exists (select 1 from board_posts p where p.id = post_id and p.author_id = auth.uid()));

-- Votes are written only through cast_vote(); owners can read their own unit's rows directly,
-- and everyone gets totals (and names, if the poll shows voters) from poll_results()
create policy board_poll_votes_own on public.board_poll_votes for select using (unit_id = my_unit());

create policy reactions_read on public.reactions for select using (can_see_reaction_target(post_id, reply_id, message_id));
create policy reactions_add on public.reactions for insert
  with check (user_id = auth.uid() and can_react(post_id, reply_id, message_id));
create policy reactions_remove on public.reactions for delete using (user_id = auth.uid());

-- Replace the caller's vote on a poll. With one vote per unit, the household shares one ballot and the latest change wins.
create or replace function public.cast_vote(p_post bigint, p_options bigint[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_post board_posts;
  v_unit int := my_unit();
  v_valid int;
begin
  if not is_owner() then raise exception 'Not allowed'; end if;
  select * into v_post from board_posts where id = p_post;
  if v_post.id is null then raise exception 'Poll not found'; end if;
  if v_post.poll_closes_at is not null and v_post.poll_closes_at <= now() then raise exception 'This poll has closed'; end if;
  p_options := coalesce(p_options, '{}');
  if not v_post.poll_multi and cardinality(p_options) > 1 then raise exception 'Pick one option'; end if;
  select count(*) into v_valid from board_poll_options where post_id = p_post and id = any (p_options);
  if v_valid <> cardinality(p_options) then raise exception 'Unknown option'; end if;

  if v_post.poll_per_unit then
    delete from board_poll_votes where post_id = p_post and unit_id = v_unit;
  else
    delete from board_poll_votes where post_id = p_post and user_id = auth.uid();
  end if;
  insert into board_poll_votes (post_id, option_id, user_id, unit_id)
    select p_post, o, auth.uid(), v_unit from unnest(p_options) as o;
  update board_posts set last_activity_at = now() where id = p_post;
end;
$$;

-- Totals per option, which options the caller's ballot (or household's) chose, and voter names if the poll shows them
create or replace function public.poll_results(p_post bigint)
returns table (option_id bigint, votes int, mine boolean, voters text)
language sql stable security definer set search_path = public as $$
  select o.id,
         (select count(*)::int from board_poll_votes v where v.option_id = o.id),
         exists (select 1 from board_poll_votes v
                  where v.option_id = o.id
                    and (case when p.poll_per_unit then v.unit_id = my_unit() else v.user_id = auth.uid() end)),
         case when p.poll_show_voters then
           (select string_agg(case when p.poll_per_unit then 'Unit ' || v.unit_id
                                   else coalesce(pr.display_name, 'Former owner') || ' (Unit ' || v.unit_id || ')' end,
                              ', ' order by v.unit_id)
              from board_poll_votes v left join profiles pr on pr.id = v.user_id
             where v.option_id = o.id)
         end
    from board_poll_options o join board_posts p on p.id = o.post_id
   where o.post_id = p_post and is_owner()
   order by o.position;
$$;

-- Board list with reply counts and poll ballots in one call
create or replace function public.board_feed()
returns table (id bigint, author_id uuid, category text, title text, body text, pinned boolean, created_at timestamptz,
               edited_at timestamptz, last_activity_at timestamptz, replies int, is_poll boolean, ballots int, poll_closes_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.author_id, p.category, p.title, left(p.body, 400), p.pinned, p.created_at, p.edited_at, p.last_activity_at,
         (select count(*)::int from board_replies r where r.post_id = p.id and not r.deleted),
         exists (select 1 from board_poll_options o where o.post_id = p.id),
         (select count(distinct case when p.poll_per_unit then v.unit_id::text else v.user_id::text end)::int
            from board_poll_votes v where v.post_id = p.id),
         p.poll_closes_at
    from board_posts p
   where is_owner()
   order by p.pinned desc, p.last_activity_at desc
   limit 300;
$$;

alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.board_replies;
