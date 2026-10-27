-- RoyalChat V4 COMPLETE SETUP. Run in Supabase SQL Editor.
-- Creates tables, permissions, RLS, Realtime and unique display names.
-- Does not erase existing messages or profiles.
-- Separate rc_ tables avoid colliding with your previous General Chat.
create table if not exists public.rc_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(trim(display_name)) between 1 and 40),
 created_at timestamptz not null default now()
);
create table if not exists public.rc_conversations (
 id uuid primary key default gen_random_uuid(),
 user_a uuid not null references public.rc_profiles(id) on delete cascade,
 user_b uuid not null references public.rc_profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 constraint rc_different_users check (user_a < user_b),
 constraint rc_unique_pair unique(user_a,user_b)
);
create table if not exists public.rc_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.rc_conversations(id) on delete cascade,
 sender_id uuid not null references public.rc_profiles(id) on delete cascade,
 body text not null check(char_length(trim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists rc_messages_conversation_idx on public.rc_messages(conversation_id,created_at desc);
create index if not exists rc_conversations_a_idx on public.rc_conversations(user_a);
create index if not exists rc_conversations_b_idx on public.rc_conversations(user_b);
alter table public.rc_profiles enable row level security;
alter table public.rc_conversations enable row level security;
alter table public.rc_messages enable row level security;
revoke all on public.rc_profiles, public.rc_conversations, public.rc_messages from anon, authenticated;
grant select,insert on public.rc_profiles, public.rc_conversations, public.rc_messages to authenticated;
grant update(display_name) on public.rc_profiles to authenticated;
-- Names are visible to signed-in users. No updates needed in this demo.
drop policy if exists "rc profiles visible" on public.rc_profiles;
create policy "rc profiles visible" on public.rc_profiles for select to authenticated using(true);
drop policy if exists "rc create own profile" on public.rc_profiles;
create policy "rc create own profile" on public.rc_profiles for insert to authenticated with check(id = (select auth.uid()));
drop policy if exists "rc participants see conversation" on public.rc_conversations;
create policy "rc participants see conversation" on public.rc_conversations for select to authenticated using ((select auth.uid()) in (user_a,user_b));
drop policy if exists "rc participants create conversation" on public.rc_conversations;
create policy "rc participants create conversation" on public.rc_conversations for insert to authenticated with check ((select auth.uid()) in (user_a,user_b));
drop policy if exists "rc participants read messages" on public.rc_messages;
create policy "rc participants read messages" on public.rc_messages for select to authenticated using (exists(select 1 from public.rc_conversations c where c.id = conversation_id and (select auth.uid()) in (c.user_a,c.user_b)));
drop policy if exists "rc participants send own messages" on public.rc_messages;
create policy "rc participants send own messages" on public.rc_messages for insert to authenticated with check(sender_id = (select auth.uid()) and exists(select 1 from public.rc_conversations c where c.id = conversation_id and (select auth.uid()) in (c.user_a,c.user_b)));
do $$
begin
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rc_messages') then
  alter publication supabase_realtime add table public.rc_messages;
 end if;
 if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rc_profiles') then
  alter publication supabase_realtime add table public.rc_profiles;
 end if;
end $$;

-- V4: Profiles can be updated only by their owners.
drop policy if exists "rc update own profile" on public.rc_profiles;
create policy "rc update own profile" on public.rc_profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Unique names, ignoring leading/trailing spaces and letter case.
-- If older records have duplicate names, this statement will fail.
-- Review duplicates first; do not delete all records unless test data is disposable.
create unique index if not exists rc_unique_display_name
on public.rc_profiles (lower(btrim(display_name)));
