-- OPTIONAL / DESTRUCTIVE: clears ALL old RoyalChat test chats and profiles.
-- ONLY run if old data is disposable. NOT necessary to use V4 unless the
-- unique name index fails because old names are already duplicated.
-- This does not delete Supabase auth.users; anonymous identities from V3
-- remain there but no longer appear in RoyalChat contacts.
BEGIN;
DELETE FROM public.rc_messages;
DELETE FROM public.rc_conversations;
DELETE FROM public.rc_profiles;
COMMIT;
-- Afterwards run setup.sql, then create two fresh EMAIL/PASSWORD users.
