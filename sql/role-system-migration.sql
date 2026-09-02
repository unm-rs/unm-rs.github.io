-- ============================================================
-- 1. Add role column to user_profiles
-- ============================================================
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS role TEXT CHECK (role IN ('mod', 'owner'));

-- ============================================================
-- 2. Promote your account to owner (run once — replace the email
--    if the account you use for admin work isn't this one)
-- ============================================================
UPDATE public.user_profiles
SET role = 'owner'
WHERE id = (SELECT id FROM auth.users WHERE email = 'randyngui08@gmail.com');

-- ============================================================
-- 3. Helper functions — use these in RLS policies instead of
--    checking auth.jwt() -> app_metadata directly. SECURITY
--    DEFINER lets them read user_profiles regardless of the
--    caller's own RLS visibility, without recursion issues.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('mod', 'owner')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'owner'
  );
$$;

-- ============================================================
-- 4. Protect the role column — only an owner can change it,
--    and an owner can't change their own role by accident
--    (prevents locking everyone out of appointing mods)
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_role_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT public.is_owner() THEN
      RAISE EXCEPTION 'Only an owner can change roles';
    END IF;
    IF NEW.id = auth.uid() THEN
      RAISE EXCEPTION 'Owners cannot change their own role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_role ON public.user_profiles;
CREATE TRIGGER trg_protect_role
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_role_column();

-- ============================================================
-- 5. Let an owner update ANY profile row (needed to appoint/
--    demote mods — the default self-update policy only lets
--    someone edit their own row)
-- ============================================================
DROP POLICY IF EXISTS "Owners can update any profile" ON public.user_profiles;
CREATE POLICY "Owners can update any profile"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_owner())
  WITH CHECK (true);

-- ============================================================
-- 6. Replace old app_metadata-based admin policies with the
--    new helper. These are the ones given earlier in this
--    project for applications/categories — re-run them here.
--    IMPORTANT: go through every other table's policies in the
--    Supabase dashboard (events, forum_threads, forum_replies,
--    storage buckets, etc.) and swap any condition that reads
--    `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'` for
--    `public.is_admin()` — otherwise newly appointed mods will
--    see the mod UI but get silently blocked by RLS.
-- ============================================================

DROP POLICY IF EXISTS "Admins can delete applications" ON public.applications;
CREATE POLICY "Admins can delete applications"
  ON public.applications FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update applications" ON public.applications;
CREATE POLICY "Admins can update applications"
  ON public.applications FOR UPDATE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete categories" ON public.forum_categories;
CREATE POLICY "Admins can delete categories"
  ON public.forum_categories FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert categories" ON public.forum_categories;
CREATE POLICY "Admins can insert categories"
  ON public.forum_categories FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can rename categories" ON public.forum_categories;
CREATE POLICY "Admins can rename categories"
  ON public.forum_categories FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- 7. Add event_time column (event_date already existed as a
--    date-only field — this stores the time separately, e.g. "19:00")
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_time TEXT;

-- ============================================================
-- 8. Add event_type column (single-day / multi-day / weekly)
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_type TEXT DEFAULT 'single-day'
    CHECK (event_type IN ('single-day', 'multi-day', 'weekly'));

-- ============================================================
-- 9. Add event_end_date column (only used when event_type is
--    'multi-day' or 'weekly')
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_end_date DATE;

-- ============================================================
-- 10. Add "competition" as a valid event_type, plus event_end_time
-- ============================================================
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_event_type_check
    CHECK (event_type IN ('single-day', 'multi-day', 'weekly', 'competition'));

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_end_time TEXT;

-- ============================================================
-- 11. Link committee_members to real profiles, so the owner/mod
--     can pick an existing member instead of typing name+photo.
--     Legacy rows (typed in manually, no linked account) keep
--     working via their existing name/image_url columns.
-- ============================================================
ALTER TABLE public.committee_members
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Prevent adding the same profile twice (multiple NULLs are still allowed for legacy rows)
ALTER TABLE public.committee_members DROP CONSTRAINT IF EXISTS committee_members_user_id_key;
ALTER TABLE public.committee_members
  ADD CONSTRAINT committee_members_user_id_key UNIQUE (user_id);

-- New profile-linked members don't need their own name/photo columns filled in
ALTER TABLE public.committee_members ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.committee_members ALTER COLUMN image_url DROP NOT NULL;

-- ============================================================
-- 12. Reply-to-reply nesting (one level deep) + a safe view
--     counter RPC (the old plain UPDATE was blocked by RLS for
--     everyone except admins, so view counts never went up for
--     regular visitors).
--
--     forum_replies.id / forum_threads.id are uuid.
-- ============================================================
ALTER TABLE public.forum_replies
  ADD COLUMN IF NOT EXISTS parent_reply_id uuid REFERENCES public.forum_replies(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.increment_thread_views(thread_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.forum_threads
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = thread_id;
$$;

GRANT EXECUTE ON FUNCTION public.increment_thread_views(uuid) TO authenticated, anon;

-- ============================================================
-- 13. Likes for threads and replies
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forum_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('thread', 'reply')),
  target_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, user_id)
);

ALTER TABLE public.forum_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view likes" ON public.forum_likes;
CREATE POLICY "Anyone can view likes"
  ON public.forum_likes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can like as themselves" ON public.forum_likes;
CREATE POLICY "Users can like as themselves"
  ON public.forum_likes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can remove their own like" ON public.forum_likes;
CREATE POLICY "Users can remove their own like"
  ON public.forum_likes FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 14. Let signed-out visitors view profiles too (public.js was
--     just changed to not require sign-in, but the SELECT policy
--     on user_profiles was likely restricted to `authenticated`
--     only, which made every profile silently look "not found"
--     for anon requests).
-- ============================================================
DROP POLICY IF EXISTS "Public can view profiles" ON public.user_profiles;
CREATE POLICY "Public can view profiles"
  ON public.user_profiles FOR SELECT
  TO anon, authenticated
  USING (true);

-- ============================================================
-- 15. Generic hero background images for pages that don't have
--     their own record to attach an image to (home, events list,
--     forum, cart, products, committee, new-thread). The event
--     detail page keeps its own existing per-event image_url —
--     this is separate and only for the "static" page heroes.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.site_hero_images (
  page_key text PRIMARY KEY,
  image_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.site_hero_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view hero images" ON public.site_hero_images;
CREATE POLICY "Anyone can view hero images"
  ON public.site_hero_images FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins can insert hero images" ON public.site_hero_images;
CREATE POLICY "Admins can insert hero images"
  ON public.site_hero_images FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update hero images" ON public.site_hero_images;
CREATE POLICY "Admins can update hero images"
  ON public.site_hero_images FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- 16. Only count a view once per unique account. Anonymous
--     visitors are deduped client-side (localStorage) since
--     there's no durable identity to key on server-side.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.forum_thread_views (
  thread_id uuid NOT NULL REFERENCES public.forum_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

ALTER TABLE public.forum_thread_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can record their own view" ON public.forum_thread_views;
CREATE POLICY "Users can record their own view"
  ON public.forum_thread_views FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can see their own view records" ON public.forum_thread_views;
CREATE POLICY "Users can see their own view records"
  ON public.forum_thread_views FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.increment_thread_views(thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.forum_thread_views (thread_id, user_id)
    VALUES (thread_id, auth.uid())
    ON CONFLICT (thread_id, user_id) DO NOTHING;

    IF FOUND THEN
      UPDATE public.forum_threads
      SET view_count = COALESCE(view_count, 0) + 1
      WHERE id = thread_id;
    END IF;
  ELSE
    UPDATE public.forum_threads
    SET view_count = COALESCE(view_count, 0) + 1
    WHERE id = thread_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_thread_views(uuid) TO authenticated, anon;

-- ============================================================
-- 17. Rejection reason for forum threads (mirrors applications)
-- ============================================================
ALTER TABLE public.forum_threads
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ============================================================
-- 19. DIAGNOSTIC — run this to find every foreign key that
--     references auth.users(id). Any row with delete_rule =
--     'NO ACTION' is a candidate for why deleting a user fails
--     with "Database error deleting user" (Postgres blocks the
--     delete rather than leave orphaned rows in that table).
-- ============================================================
SELECT
    tc.table_schema,
    tc.table_name,
    kcu.column_name,
    rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu
    ON rc.unique_constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name = 'users'
  AND ccu.table_schema = 'auth';

-- ============================================================
-- 20. DIAGNOSTIC — list every function named increment_thread_views
--     and its exact parameter signature, to see what's actually
--     in the database (the DROP in step 18/before doesn't seem
--     to be taking effect before the CREATE runs).
-- ============================================================
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname = 'increment_thread_views';

-- ============================================================
-- 21. DIAGNOSTIC (more reliable than #19) — every FK that
--     references auth.users, straight from the pg_constraint
--     catalog instead of information_schema.
-- ============================================================
SELECT
    conrelid::regclass AS referencing_table,
    conname AS constraint_name,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE confrelid = 'auth.users'::regclass
  AND contype = 'f';

-- ============================================================
-- 22. DIAGNOSTIC — any trigger sitting directly on auth.users
--     (wouldn't show up in an FK search at all).
-- ============================================================
SELECT tgname, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass
  AND NOT tgisinternal;

-- ============================================================
-- 23. Fix: applications.user_id blocks deleting a user because
--     its FK has no ON DELETE behavior. Applications keep their
--     own snapshot of the applicant's info (name, student_id,
--     owa, etc.), so SET NULL preserves the historical
--     application record instead of deleting it outright.
-- ============================================================
ALTER TABLE public.applications DROP CONSTRAINT applications_user_id_fkey;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- 24. REVERT steps 16 + 18 — the per-account view dedup layer
--     never successfully applied and isn't needed; the
--     client-side localStorage guard in thread.js already
--     handles "once per unique visitor" on its own.
--
--     Run the DROP and the CREATE as two separate executions
--     (paste + run one, then the other) — running them together
--     has been unreliable in the SQL editor for this function.
-- ============================================================
DROP TABLE IF EXISTS public.forum_thread_views;
DROP FUNCTION IF EXISTS public.increment_thread_views(uuid);
-- ---- run the line above by itself, then run everything below ----
CREATE FUNCTION public.increment_thread_views(thread_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.forum_threads
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = thread_id;
$$;

GRANT EXECUTE ON FUNCTION public.increment_thread_views(uuid) TO authenticated, anon;

-- ============================================================
-- 25. forum_threads still had two legacy admin policies reading
--     the old JWT user_metadata/app_metadata role, which nothing
--     sets anymore now that admin status lives in user_profiles.role.
--     Neither ever matches, so:
--       - an admin's thread insert (status='approved') had no
--         matching policy and was rejected ("new row violates RLS")
--       - the moderation bar's Approve/Reject UPDATE would have
--         hit the same wall
--     Replace both with a single public.is_admin() policy, and let
--     Members post admit status='approved' when the poster is an
--     admin (regular members are still forced to 'pending').
-- ============================================================
DROP POLICY IF EXISTS "Admin manage" ON public.forum_threads;
DROP POLICY IF EXISTS "Admins manage threads" ON public.forum_threads;
DROP POLICY IF EXISTS "Members post" ON public.forum_threads;

CREATE POLICY "Admins manage threads"
  ON public.forum_threads FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Members post"
  ON public.forum_threads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id AND (status = 'pending' OR public.is_admin()));

-- ============================================================
-- 26. Full policy audit before deployment turned up the same
--     legacy-JWT problem on more tables, plus two policies that
--     are flat-out wrong (named "Admin ___" but actually USING
--     (true) — open to every signed-in member, not just admins):
--
--       - events: the only write policy is USING(true)/WITH CHECK(true)
--         for authenticated — any member can add/edit/delete any
--         event right now.
--       - committee_members: same pattern on insert/update/delete.
--       - applications: "Admins can view applications" is USING(true),
--         so every member can read every applicant's name/student
--         id/OWA email, not just their own — a real PII leak.
--       - event_years / forum_replies / products: admin writes are
--         gated only by the dead app_metadata/user_metadata JWT
--         check, so those buttons currently fail silently for admins,
--         same bug class as step 25.
-- ============================================================

-- events: lock writes down to admins only
DROP POLICY IF EXISTS "Authenticated users can manage events" ON public.events;
CREATE POLICY "Admins manage events"
  ON public.events FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- committee_members: the existing policies claimed to be admin-only
-- but weren't actually checking anything
DROP POLICY IF EXISTS "Admin delete" ON public.committee_members;
DROP POLICY IF EXISTS "Admin insert" ON public.committee_members;
DROP POLICY IF EXISTS "Admin update" ON public.committee_members;
CREATE POLICY "Admins manage committee members"
  ON public.committee_members FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- applications: close the PII leak, keep everything else as-is
DROP POLICY IF EXISTS "Admins can view applications" ON public.applications;
DROP POLICY IF EXISTS "Admins view all" ON public.applications;
DROP POLICY IF EXISTS "Admins update status" ON public.applications;
CREATE POLICY "Admins view applications"
  ON public.applications FOR SELECT TO authenticated
  USING (public.is_admin());

-- applications: also stop a signed-in member from submitting an
-- application under someone else's user_id (guest applications with
-- user_id = null still need to keep working)
DROP POLICY IF EXISTS "Anyone can submit" ON public.applications;
CREATE POLICY "Anyone can submit"
  ON public.applications FOR INSERT
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- event_years: same dead-JWT bug as step 25
DROP POLICY IF EXISTS "Admins manage years" ON public.event_years;
CREATE POLICY "Admins manage years"
  ON public.event_years FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- forum_replies: same dead-JWT bug as step 25
DROP POLICY IF EXISTS "Admins manage replies" ON public.forum_replies;
DROP POLICY IF EXISTS "Admin manage" ON public.forum_replies;
CREATE POLICY "Admins manage replies"
  ON public.forum_replies FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- products: same dead-JWT bug as step 25
DROP POLICY IF EXISTS "admin delete products" ON public.products;
DROP POLICY IF EXISTS "admin insert products" ON public.products;
DROP POLICY IF EXISTS "admin update products" ON public.products;
CREATE POLICY "Admins manage products"
  ON public.products FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- 27. Storage cleanup for avatars/banners.
--
--     (a) Let a user delete their OWN previously-uploaded avatar/
--         banner file — needed for profile.js's new "delete the old
--         image after uploading a replacement" cleanup to actually
--         work instead of silently failing on RLS.
--
--     (b) When a user_profiles row is deleted (via the ON DELETE
--         CASCADE from auth.users), call the real Storage delete
--         API — via pg_net, authenticated with the service_role key
--         — so the avatar/banner file doesn't become an orphan.
--         Deleting rows straight out of storage.objects does NOT
--         reliably free the underlying file, which is why this goes
--         through the actual API instead.
--
--     Before running the trigger below:
--       1. Enable the extension:  CREATE EXTENSION IF NOT EXISTS pg_net;
--       2. Store your service_role key in Vault yourself (run with
--          your own key substituted in — don't paste the key or the
--          result anywhere, including back to Claude):
--            SELECT vault.create_secret('YOUR_SERVICE_ROLE_KEY', 'service_role_key');
--       3. Then run everything below.
-- ============================================================

-- (a) self-delete policy for avatars/banners
DROP POLICY IF EXISTS "Users delete own avatar or banner" ON storage.objects;
CREATE POLICY "Users delete own avatar or banner"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'event-images'
    AND (
      name LIKE 'avatars/' || auth.uid()::text || '_%'
      OR name LIKE 'banners/' || auth.uid()::text || '_%'
    )
  );

-- (b) delete the files via the Storage API when the profile row goes away
CREATE OR REPLACE FUNCTION public.cleanup_profile_images()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_key text;
  paths       text[] := '{}';
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF service_key IS NULL THEN
    RETURN OLD; -- Vault secret not set up yet — skip cleanup rather than error
  END IF;

  IF OLD.avatar_url IS NOT NULL AND OLD.avatar_url LIKE '%/event-images/%' THEN
    paths := paths || regexp_replace(OLD.avatar_url, '^.*/event-images/', '');
  END IF;
  IF OLD.banner_url IS NOT NULL AND OLD.banner_url LIKE '%/event-images/%' THEN
    paths := paths || regexp_replace(OLD.banner_url, '^.*/event-images/', '');
  END IF;

  IF array_length(paths, 1) > 0 THEN
    PERFORM net.http_delete(
      url     := 'https://kmiitfsvnchqipohypsl.supabase.co/storage/v1/object/event-images',
      headers := jsonb_build_object('Authorization', 'Bearer ' || service_key, 'Content-Type', 'application/json'),
      body    := jsonb_build_object('prefixes', paths)
    );
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_profile_images ON public.user_profiles;
CREATE TRIGGER trg_cleanup_profile_images
  BEFORE DELETE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_profile_images();

-- ============================================================
-- 28. The event-images bucket accepted literally any file type at
--     any size — client-side <input accept="image/*"> is just a UI
--     hint and was never actually enforced anywhere, so members have
--     already uploaded non-image files (zip, txt, etc). New JS-side
--     checks (image/png|jpeg|webp|gif, 5MB cap) now reject bad files
--     before upload, but that alone doesn't stop someone bypassing
--     the UI and calling the Storage API directly — the bucket
--     itself needs to enforce this so it holds regardless of client.
-- ============================================================
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    file_size_limit     = 5242880 -- 5MB, in bytes
WHERE id = 'event-images';

-- Find what's already in there that shouldn't be, so you can review
-- and delete it (run this to see the list first):
--
-- SELECT name, metadata->>'mimetype' AS mimetype,
--        (metadata->>'size')::bigint AS size_bytes, created_at
-- FROM storage.objects
-- WHERE bucket_id = 'event-images'
--   AND (metadata->>'mimetype' IS NULL OR metadata->>'mimetype' NOT LIKE 'image/%')
-- ORDER BY created_at DESC;
--
-- Delete the flagged files through the Storage tab in the dashboard
-- (select each one, Delete) rather than a raw SQL DELETE on this
-- table — deleting the storage.objects row directly does not
-- reliably free the underlying file, same reasoning as step 27.

-- ============================================================
-- 29. Committee photo is now independent of the profile picture —
--     a linked member can change their own committee_members.image_url
--     without touching user_profiles.avatar_url, and vice versa.
--
--     committee_members writes are currently is_admin()-only (step 26),
--     so a member's own photo upload would be silently blocked. Add a
--     self-update policy, but lock it down with a trigger so a member
--     can ONLY change their own image_url — not position/bio/name/
--     user_id (which would otherwise let someone self-promote to
--     President via a raw API call, bypassing the UI entirely).
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_committee_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.position IS DISTINCT FROM OLD.position
       OR NEW.bio IS DISTINCT FROM OLD.bio
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'You can only change your own photo here';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_committee_columns ON public.committee_members;
CREATE TRIGGER trg_protect_committee_columns
  BEFORE UPDATE ON public.committee_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_committee_columns();

DROP POLICY IF EXISTS "Members update own photo" ON public.committee_members;
CREATE POLICY "Members update own photo"
  ON public.committee_members FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 30. Custom owner-defined tags (a reusable library, like "Alumni"
--     or "Sponsor") that can be assigned to any number of members.
--     Each tag has a name + color and a visible flag the owner can
--     flip to hide it everywhere without deleting the assignments.
--     Only the owner can create/assign/hide tags — same scope as
--     moderator appointment.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  color      text NOT NULL,
  visible    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read tags" ON public.tags;
CREATE POLICY "Public read tags"
  ON public.tags FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Owner inserts tags" ON public.tags;
CREATE POLICY "Owner inserts tags"
  ON public.tags FOR INSERT TO authenticated
  WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS "Owner updates tags" ON public.tags;
CREATE POLICY "Owner updates tags"
  ON public.tags FOR UPDATE TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS "Owner deletes tags" ON public.tags;
CREATE POLICY "Owner deletes tags"
  ON public.tags FOR DELETE TO authenticated
  USING (public.is_owner());

CREATE TABLE IF NOT EXISTS public.user_tags (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tag_id     uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tag_id)
);

ALTER TABLE public.user_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read user tags" ON public.user_tags;
CREATE POLICY "Public read user tags"
  ON public.user_tags FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Owner assigns user tags" ON public.user_tags;
CREATE POLICY "Owner assigns user tags"
  ON public.user_tags FOR INSERT TO authenticated
  WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS "Owner removes user tags" ON public.user_tags;
CREATE POLICY "Owner removes user tags"
  ON public.user_tags FOR DELETE TO authenticated
  USING (public.is_owner());

-- ============================================================
-- 31. Tags need an independent background color, not just text
--     color, to actually match the look of the existing mod/
--     committee badges (solid dark background + bright text)
--     instead of a generic light outlined pill.
-- ============================================================
ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS bg_color text NOT NULL DEFAULT '#2a1d05';

-- ============================================================
-- 32. forum_threads.reply_count was only ever bumped by a manual
--     client-side UPDATE in thread.js, which silently failed for
--     anyone but an admin — forum_threads writes are admin-only
--     (step 25/26), so a regular member's reply never actually
--     updated the counter (no error was ever checked). The thread
--     page itself always showed the right number because it counts
--     the fetched replies live instead of trusting this column —
--     forum.js and profile.js trust the column, which is why they
--     drifted out of sync.
--
--     Fix: maintain reply_count server-side via a trigger, so it's
--     always accurate and never depends on the replier's own RLS
--     permissions. Also backfills every thread's count right now.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_thread_reply_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_thread uuid;
BEGIN
  affected_thread := COALESCE(NEW.thread_id, OLD.thread_id);

  UPDATE public.forum_threads
  SET reply_count = (SELECT COUNT(*) FROM public.forum_replies WHERE thread_id = affected_thread),
      last_reply_at = CASE WHEN TG_OP = 'INSERT' THEN now() ELSE last_reply_at END
  WHERE id = affected_thread;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_reply_count ON public.forum_replies;
CREATE TRIGGER trg_sync_reply_count
  AFTER INSERT OR DELETE ON public.forum_replies
  FOR EACH ROW EXECUTE FUNCTION public.sync_thread_reply_count();

-- One-time backfill: fix every thread's count right now
UPDATE public.forum_threads t
SET reply_count = sub.cnt
FROM (SELECT thread_id, COUNT(*) AS cnt FROM public.forum_replies GROUP BY thread_id) sub
WHERE t.id = sub.thread_id AND t.reply_count IS DISTINCT FROM sub.cnt;

UPDATE public.forum_threads
SET reply_count = 0
WHERE reply_count IS DISTINCT FROM 0
  AND id NOT IN (SELECT DISTINCT thread_id FROM public.forum_replies);

-- ============================================================
-- 33. Let the owner rename the "Mod" / "Owner" badge text
--     site-wide (Settings), instead of it being hardcoded.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.role_labels (
  role  text PRIMARY KEY CHECK (role IN ('mod', 'owner')),
  label text NOT NULL
);

INSERT INTO public.role_labels (role, label) VALUES ('mod', 'Mod'), ('owner', 'Owner')
  ON CONFLICT (role) DO NOTHING;

ALTER TABLE public.role_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read role labels" ON public.role_labels;
CREATE POLICY "Public read role labels"
  ON public.role_labels FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Owner updates role labels" ON public.role_labels;
CREATE POLICY "Owner updates role labels"
  ON public.role_labels FOR UPDATE TO authenticated
  USING (public.is_owner())
  WITH CHECK (public.is_owner());

-- ============================================================
-- 34. S-CPD points shown on each event card, admin-editable inline.
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS scpd_points integer NOT NULL DEFAULT 0;

-- ============================================================
-- 35. Let a member delete their OWN thread or reply, not just
--     admins. Both forum_threads and forum_replies DELETE were
--     only ever granted via their is_admin()-gated "manage"
--     policies — the client already shows a Delete button to the
--     post's own author (canDelete in thread.js), but clicking it
--     had no matching RLS policy and silently failed. Same bug
--     class as step 25/32.
-- ============================================================
DROP POLICY IF EXISTS "Authors delete own thread" ON public.forum_threads;
CREATE POLICY "Authors delete own thread"
  ON public.forum_threads FOR DELETE TO authenticated
  USING (auth.uid() = author_id);

DROP POLICY IF EXISTS "Authors delete own reply" ON public.forum_replies;
CREATE POLICY "Authors delete own reply"
  ON public.forum_replies FOR DELETE TO authenticated
  USING (auth.uid() = author_id);

-- ============================================================
-- 36. About page: a single free-form rich-content canvas mods can
--     edit (images, full text formatting, no fixed fields) — a
--     singleton row rather than a normal table since there's only
--     ever one About page.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.about_page (
  id      boolean PRIMARY KEY DEFAULT true CHECK (id),
  content text
);

INSERT INTO public.about_page (id, content) VALUES (true, null)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.about_page ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read about page" ON public.about_page;
CREATE POLICY "Public read about page"
  ON public.about_page FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins update about page" ON public.about_page;
CREATE POLICY "Admins update about page"
  ON public.about_page FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- 37. Events page: replace year-number tabs with mod-named groups.
--     Renaming the table/column preserves its existing RLS policies
--     and data automatically. events.year (int, matched by value)
--     becomes events.group_id (uuid FK, matched by id) — safer once
--     names are freeform and mods can rename them, since a value-
--     match would silently break every event's grouping on rename.
--
--     This assumes event_years.id is uuid, matching every other
--     table in this schema — if this step errors on a type mismatch,
--     tell me the actual column type and I'll adjust it.
-- ============================================================
ALTER TABLE public.event_years RENAME TO event_groups;
ALTER TABLE public.event_groups RENAME COLUMN year TO name;
ALTER TABLE public.event_groups ALTER COLUMN name TYPE text USING name::text;

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.event_groups(id) ON DELETE SET NULL;

-- make sure every legacy year value has a matching named group (covers
-- events whose year was never in event_years to begin with)
INSERT INTO public.event_groups (name, sort_order)
SELECT DISTINCT year::text, 999
FROM public.events
WHERE year IS NOT NULL
  AND year::text NOT IN (SELECT name FROM public.event_groups);

UPDATE public.events e
SET group_id = g.id
FROM public.event_groups g
WHERE e.year IS NOT NULL AND g.name = e.year::text AND e.group_id IS NULL;

ALTER TABLE public.events DROP COLUMN IF EXISTS year;

-- ============================================================
-- 38. Standardized hero/card image sizes: events.image_url is now
--     always a 1920x1080 desktop crop, with a separate 1080x1080
--     square crop for mobile in this new column.
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS image_url_mobile text;

-- ============================================================
-- 39. Same dual desktop/mobile crop for the generic site_hero_images
--     table (used by the home page hero, and any other page hero
--     that isn't tied to its own record).
-- ============================================================
ALTER TABLE public.site_hero_images
  ADD COLUMN IF NOT EXISTS image_url_mobile text;

-- ============================================================
-- 40. Two more full-screen editable sections below the home hero
--     (SpaceX-style) — fixed at exactly two, alternating left/right
--     text alignment, each with its own image + editable title/
--     description/CTA label.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.home_feature_sections (
  id               text PRIMARY KEY CHECK (id IN ('feature-1', 'feature-2')),
  title            text,
  description      text,
  cta_label        text,
  cta_href         text,
  image_url        text,
  image_url_mobile text
);

INSERT INTO public.home_feature_sections (id, title, description, cta_label, cta_href) VALUES
  ('feature-1', 'Making Life Multiplanetary', 'Add a description for this section by clicking on it.', 'Explore', '/eventspage.html'),
  ('feature-2', 'Revolutionizing Space Technology', 'Add a description for this section by clicking on it.', 'Learn More', '/about.html')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.home_feature_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read home feature sections" ON public.home_feature_sections;
CREATE POLICY "Public read home feature sections"
  ON public.home_feature_sections FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins update home feature sections" ON public.home_feature_sections;
CREATE POLICY "Admins update home feature sections"
  ON public.home_feature_sections FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- 41. Mark an event "major" so the home page collage can give it
--     a big tile. Reuses the existing "Mods manage events" policy
--     (whatever already lets admins UPDATE events covers this too).
-- ============================================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_major boolean NOT NULL DEFAULT false;

-- ============================================================
-- 42. An unlisted "/step" event page — a normal events row, editable
--     by admins exactly like any other event (hero image, rich-text
--     description, S-CPD points, etc.) via /event.html?slug=step, and
--     also reachable at the bare URL /step (see step/index.html).
--     Deliberately left ungrouped (group_id null) so it never shows up
--     in any eventspage tab, and dated in the past so the home page's
--     "upcoming events" query skips it too — nothing links to it, it
--     only surfaces if you already know the URL.
-- ============================================================
INSERT INTO public.events (title, slug, event_date, description, group_id)
SELECT 'Step', 'step', '2000-01-01', 'This page is empty for now — edit it however you like.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.events WHERE slug = 'step');

-- ============================================================
-- 43. Application confirmation screen + optional/mandatory file
--     attachment (PDF or media) on the "Join Now" form.
--
--     application_file_required is per-event, admin-toggleable: the
--     attachment field always shows on the apply form, this only
--     controls whether it's optional or required for that event.
--
--     Files go in a new private bucket (not public like event-images,
--     since these can be personal documents) — only the uploader can
--     write, only admins can read/delete, matching who can already
--     see applications at all (see "Admins view applications" step 25).
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS application_file_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_name text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'application-files',
  'application-files',
  false,
  20971520, -- 20MB
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
        'video/mp4', 'video/quicktime', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types  = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Anyone can upload application files" ON storage.objects;
CREATE POLICY "Anyone can upload application files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'application-files');

DROP POLICY IF EXISTS "Admins read application files" ON storage.objects;
CREATE POLICY "Admins read application files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'application-files' AND public.is_admin());

DROP POLICY IF EXISTS "Admins delete application files" ON storage.objects;
CREATE POLICY "Admins delete application files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'application-files' AND public.is_admin());

-- ============================================================
-- 44. New events no longer get an auto-slugified-from-title slug.
--     They're reachable right away at a "temporary" URL keyed off
--     their id (/event/?id=…), which always works and never
--     collides. slug becomes an optional, mod-set upgrade to a
--     nicer URL (/event/?slug=…) — see event-detail.js's URL editor.
-- ============================================================
ALTER TABLE public.events ALTER COLUMN slug DROP NOT NULL;

-- ============================================================
-- 45. home_feature_sections.cta_href is now admin-editable from the
--     home page itself (the small "→ /wherever" line under each
--     button). The two rows seeded in step 40 still point at the old
--     .html paths from before the extension removal — fix those up
--     to the current URLs. Only touches rows still holding the exact
--     seeded values, so it won't clobber a link you've already
--     customized.
-- ============================================================
UPDATE public.home_feature_sections SET cta_href = '/eventspage/' WHERE id = 'feature-1' AND cta_href = '/eventspage.html';
UPDATE public.home_feature_sections SET cta_href = '/about/'      WHERE id = 'feature-2' AND cta_href = '/about.html';

-- ============================================================
-- 46. Optional venue field for events, editable inline in the hero's
--     date/time block exactly like type/date/time already are.
-- ============================================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue text;

-- ============================================================
-- 47. A third crop for events: image_url (16:9) and image_url_mobile
--     (1:1) already existed, but the home page carousel's mobile
--     slides are 9:16 — they were reusing the 1:1 crop, cover-fit into
--     a much narrower box, cropping further in a way whoever set the
--     image never actually chose. image_url_portrait is a real 9:16
--     crop for that specific spot; the carousel falls back to
--     image_url_mobile for events cropped before this existed.
-- ============================================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS image_url_portrait text;

-- ============================================================
-- 48. Price detail for events, shown/edited in the hero's compact meta
--     row exactly like venue already is. Free-form text (not numeric) so
--     it can hold "Free", "$10", "RM15", etc. instead of forcing one
--     currency/format — same reasoning as venue being plain text.
-- ============================================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS price text;

-- ============================================================
-- 49. About page: a SpaceX-mission-style stats strip below the
--     main editable canvas — a row of big numbers, each with a
--     label under it, all mod-editable inline. Stored as a JSON
--     array on the same about_page singleton row (no new table,
--     no new policy — the existing "Admins update about page"
--     UPDATE policy already covers every column). Defaults to an
--     empty array; the public page just hides the strip until a
--     mod fills something in.
--
--     Shape: [{ "num": "42", "label": "Projects Shipped" }, ...]
--     Free-form text for both (not numeric) so "42", "1,200+",
--     "∞" all work — same reasoning as events.price being text.
-- ============================================================
ALTER TABLE public.about_page
  ADD COLUMN IF NOT EXISTS stats jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================
-- 50. About page: a second free-form rich-content canvas that
--     sits BELOW the stats strip (same editor, same sanitizer,
--     same "Save Changes" bar as the top one). Just another text
--     column on the singleton row — the existing "Admins update
--     about page" policy already covers it. NULL until a mod
--     writes something; the public page omits the lower block
--     entirely while it's empty.
-- ============================================================
ALTER TABLE public.about_page
  ADD COLUMN IF NOT EXISTS content_below text;

-- ============================================================
-- 51. Per-event photo gallery. Once an event's date has passed it
--     can't be joined any more, so event-detail.js hides the apply
--     form and shows this gallery in its place: admins upload /
--     remove photos, everyone can view and click a thumbnail for
--     the full image. Photos live in the existing public
--     `event-images` bucket (its image-only + 5MB limits from step
--     28 already apply), so no new bucket or storage policy — just
--     this table.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_gallery (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  image_url  text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_gallery_event_idx
  ON public.event_gallery (event_id, sort_order, created_at);

ALTER TABLE public.event_gallery ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view event gallery" ON public.event_gallery;
CREATE POLICY "Anyone can view event gallery"
  ON public.event_gallery FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins manage event gallery" ON public.event_gallery;
CREATE POLICY "Admins manage event gallery"
  ON public.event_gallery FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- 52. About page: two full-screen feature sections below the
--     stats strip — the same SpaceX-style banner + editable
--     title/description/CTA blocks the home page has
--     (home_feature_sections, step 40), just for /about. Fixed at
--     two rows, alternating left/right text alignment. Dual
--     desktop/mobile crop stored the same way. The lower
--     free-text canvas (step 50, content_below) is retired — it's
--     replaced by these. `content_below` is left in place, just
--     unused, so no destructive change is needed.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.about_feature_sections (
  id               text PRIMARY KEY CHECK (id IN ('section-1', 'section-2')),
  title            text,
  description      text,
  cta_label        text,
  cta_href         text,
  image_url        text,
  image_url_mobile text
);

INSERT INTO public.about_feature_sections (id) VALUES ('section-1'), ('section-2')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.about_feature_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read about feature sections" ON public.about_feature_sections;
CREATE POLICY "Public read about feature sections"
  ON public.about_feature_sections FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins update about feature sections" ON public.about_feature_sections;
CREATE POLICY "Admins update about feature sections"
  ON public.about_feature_sections FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- 53. Per-event downloadable documents. Admins attach files
--     (consent / indemnity / registration forms — things people
--     print, sign and bring back) that show as a prominent card
--     above the apply form on the event page. Anyone can download
--     them; only admins upload / remove.
--
--     These are meant to be public (unlike application-files,
--     which hold personal submissions), so they get their own
--     PUBLIC bucket with a document-friendly MIME allowlist.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  file_path   text NOT NULL,
  file_name   text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_documents_event_idx
  ON public.event_documents (event_id, sort_order, created_at);

ALTER TABLE public.event_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view event documents" ON public.event_documents;
CREATE POLICY "Anyone can view event documents"
  ON public.event_documents FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins manage event documents" ON public.event_documents;
CREATE POLICY "Admins manage event documents"
  ON public.event_documents FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-documents',
  'event-documents',
  true,
  20971520, -- 20MB
  ARRAY['application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public              = true,
  file_size_limit     = EXCLUDED.file_size_limit,
  allowed_mime_types  = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Anyone can read event documents" ON storage.objects;
CREATE POLICY "Anyone can read event documents"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-documents');

DROP POLICY IF EXISTS "Admins upload event documents" ON storage.objects;
CREATE POLICY "Admins upload event documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'event-documents' AND public.is_admin());

DROP POLICY IF EXISTS "Admins delete event documents" ON storage.objects;
CREATE POLICY "Admins delete event documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'event-documents' AND public.is_admin());

-- ============================================================
-- 54. Event capacity + automatic waitlist.
--
--   * events.max_participants: NULL = unlimited (current behaviour —
--     applications stay 'pending' for manual review).
--   * With a cap set, a BEFORE INSERT trigger classifies each new
--     application: 'approved' while seats remain, else 'waitlisted'.
--     First come, first served by submitted_at.
--   * When an approved seat is later given up (application rejected,
--     removed, or moved back to the waitlist) OR the cap is raised,
--     the oldest waitlisted application(s) are promoted to 'approved'
--     to fill the freed seats.
--   * Admins keep full manual control — approve/reject still work, and
--     an admin approving past the cap is allowed (deliberate override).
--
--   A per-event advisory lock serialises all capacity changes so the
--   FCFS ordering holds even under concurrent submissions.
-- ============================================================

-- new status value
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'waitlisted'));

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS max_participants integer
  CHECK (max_participants IS NULL OR max_participants >= 0);

-- promote as many waitlisted as now fit under the cap (oldest first)
CREATE OR REPLACE FUNCTION public.promote_event_waitlist(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max      integer;
  v_approved integer;
  v_slots    integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('app-cap:' || p_event_id::text));

  SELECT max_participants INTO v_max FROM public.events WHERE id = p_event_id;

  -- no cap → unlimited room: everyone still waiting gets in
  IF v_max IS NULL THEN
    UPDATE public.applications
    SET status = 'approved'
    WHERE event_id = p_event_id AND status = 'waitlisted';
    RETURN;
  END IF;

  SELECT count(*) INTO v_approved
  FROM public.applications
  WHERE event_id = p_event_id AND status = 'approved';

  v_slots := v_max - v_approved;
  IF v_slots <= 0 THEN RETURN; END IF;

  UPDATE public.applications
  SET status = 'approved'
  WHERE id IN (
    SELECT id FROM public.applications
    WHERE event_id = p_event_id AND status = 'waitlisted'
    ORDER BY submitted_at ASC
    LIMIT v_slots
  );
END;
$$;

-- classify a fresh application against the cap
CREATE OR REPLACE FUNCTION public.assign_application_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max      integer;
  v_approved integer;
BEGIN
  -- only the normal applicant path (status left at its 'pending' default);
  -- if something inserts an explicit status, respect it
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT max_participants INTO v_max FROM public.events WHERE id = NEW.event_id;
  IF v_max IS NULL THEN
    RETURN NEW; -- no cap → stays 'pending' for manual review
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('app-cap:' || NEW.event_id::text));

  SELECT count(*) INTO v_approved
  FROM public.applications
  WHERE event_id = NEW.event_id AND status = 'approved';

  IF v_approved < v_max THEN
    NEW.status := 'approved';
  ELSE
    NEW.status := 'waitlisted';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_application_status ON public.applications;
CREATE TRIGGER trg_assign_application_status
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.assign_application_status();

-- fill freed seats from the waitlist
CREATE OR REPLACE FUNCTION public.applications_waitlist_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' THEN
      PERFORM public.promote_event_waitlist(OLD.event_id);
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved' THEN
    PERFORM public.promote_event_waitlist(NEW.event_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_waitlist_sync ON public.applications;
CREATE TRIGGER trg_applications_waitlist_sync
  AFTER UPDATE OR DELETE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_waitlist_sync();

-- promote when the cap itself is raised
CREATE OR REPLACE FUNCTION public.events_capacity_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.max_participants IS DISTINCT FROM OLD.max_participants THEN
    PERFORM public.promote_event_waitlist(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_capacity_sync ON public.events;
CREATE TRIGGER trg_events_capacity_sync
  AFTER UPDATE OF max_participants ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_capacity_sync();

-- Let a waitlisted applicant see their own place in the queue. RLS hides
-- other people's applications, so this has to be SECURITY DEFINER.
-- Returns 0 when the caller isn't on this event's waitlist.
CREATE OR REPLACE FUNCTION public.my_waitlist_position(p_event_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.applications a
  WHERE a.event_id = p_event_id
    AND a.status = 'waitlisted'
    AND a.submitted_at <= (
      SELECT submitted_at FROM public.applications
      WHERE event_id = p_event_id AND user_id = auth.uid() AND status = 'waitlisted'
      LIMIT 1
    );
$$;

GRANT EXECUTE ON FUNCTION public.my_waitlist_position(uuid) TO authenticated;

-- ============================================================
-- 55. Payment info for events that charge a fee. Admin toggles
--     `payment_required`; when on, the event page shows a panel
--     with the treasurer's e-wallet QR on the left and free-text
--     instructions / contact on the right.
--
--     The QR image reuses the existing public `event-images`
--     bucket (5MB, image-only from step 28) — no new bucket or
--     storage policy. `events` UPDATE is already admin-only.
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS payment_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_qr_url   text,
  ADD COLUMN IF NOT EXISTS payment_details  text;

-- ============================================================
-- 56. Proof of payment. An approved applicant can attach a
--     screenshot / PDF of their transfer on the payment card,
--     view it back, and replace it if they sent the wrong file.
--
--     Files live in a new PRIVATE bucket (payment-proofs) keyed
--     by "<uid>/<event_id>/..." — the uploader and admins can
--     read; nobody else. The pointer is stored on the applicant's
--     own applications row.
--
--     applications UPDATE is admin-only, so a per-column guard
--     (same pattern as protect_role_column, step 4) lets the
--     applicant touch ONLY the three payment_proof_* fields on
--     their own row.
-- ============================================================
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS payment_proof_path        text,
  ADD COLUMN IF NOT EXISTS payment_proof_name        text,
  ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at timestamptz;

CREATE OR REPLACE FUNCTION public.protect_application_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  -- a non-admin may only change the payment-proof fields, nothing else
  IF (to_jsonb(NEW) - 'payment_proof_path' - 'payment_proof_name' - 'payment_proof_uploaded_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'payment_proof_path' - 'payment_proof_name' - 'payment_proof_uploaded_at') THEN
    RAISE EXCEPTION 'You can only update the payment proof on your own application';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_application_columns ON public.applications;
CREATE TRIGGER trg_protect_application_columns
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.protect_application_columns();

DROP POLICY IF EXISTS "Applicants update own payment proof" ON public.applications;
CREATE POLICY "Applicants update own payment proof"
  ON public.applications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  10485760, -- 10MB
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users upload own payment proof" ON storage.objects;
CREATE POLICY "Users upload own payment proof"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users read own payment proof" ON storage.objects;
CREATE POLICY "Users read own payment proof"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs'
         AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

DROP POLICY IF EXISTS "Users delete own payment proof" ON storage.objects;
CREATE POLICY "Users delete own payment proof"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'payment-proofs'
         AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin()));

-- ============================================================
-- 57. Separate member vs non-member event pricing. `price`
--     (step 48) stays as the single "everyone pays this" field;
--     these two are shown as their own meta cells when set.
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS price_member    text,
  ADD COLUMN IF NOT EXISTS price_nonmember text;

-- ============================================================
-- 58. WhatsApp contact link on the payment panel — a mod-set URL,
--     shown as a green "Contact via WhatsApp" button on the
--     payment card so an approved applicant can reach the
--     treasurer if something goes wrong. Same visibility rule as
--     the rest of the payment panel (event.payment_required,
--     applicant already approved), and sits above the
--     proof-of-payment upload so it's still there after they pay.
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS whatsapp_link text;

-- ============================================================
-- 59. Registration now asks "are you a UNM student?" up front.
--     Yes keeps the existing student_id/owa/year_of_study/
--     course_of_study fields; No collects school_name + region
--     instead. Existing rows default to true (they all came
--     through the student-only form up to this point) so nothing
--     currently "complete" becomes incomplete.
-- ============================================================
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS is_unm_student boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS school_name    text,
  ADD COLUMN IF NOT EXISTS region         text;

-- ============================================================
-- 60. Events can be toggled as "provides food" (mod-controlled,
--     same pattern as application_file_required). When on, the
--     application form additionally asks for dietary restrictions
--     / medical conditions the organizers should know about —
--     optional, free text, stored per-application.
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS provides_food boolean NOT NULL DEFAULT false;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS dietary_medical_info text;

-- ============================================================
-- 61. Guest (not-signed-in) applicants now get the same "are you a
--     UNM student?" branch the registration flow has — external
--     applicants give school_name/region instead of
--     student_id/course_of_study (owa is reused as a plain contact
--     email for both branches, no separate column needed).
-- ============================================================
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS school_name text,
  ADD COLUMN IF NOT EXISTS region      text;

-- ============================================================
-- 62. Events can be toggled to "include visitors" (mod-controlled,
--     same pattern as provides_food). When on, the application form
--     additionally asks how many visitors the applicant is bringing
--     along, not counting themselves.
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS include_visitors boolean NOT NULL DEFAULT false;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS visitor_count integer;

-- ============================================================
-- 63. student_id and course_of_study were NOT NULL from back when
--     every applicant was assumed to be a UNM student — external
--     (non-UNM) applicants legitimately leave both null now (they
--     carry school_name/region instead, see step 61), so the old
--     constraint was rejecting every external application with
--     "null value in column student_id violates not-null constraint".
-- ============================================================
ALTER TABLE public.applications
  ALTER COLUMN student_id      DROP NOT NULL,
  ALTER COLUMN course_of_study DROP NOT NULL;

-- ============================================================
-- 64. Root cause of the guest-application RLS error, found via the
--     Postgres logs: PostgREST implements `.insert().select()` as
--     `WITH pgrst_source AS (INSERT ... RETURNING ...) SELECT ... FROM
--     pgrst_source` — that trailing SELECT is a real SELECT against
--     "applications" and IS subject to its SELECT policies, even
--     though the INSERT's own WITH CHECK already passed. Both
--     existing SELECT policies ("Admins view applications", "Users
--     view own") are `TO authenticated` only, so an anon/guest
--     caller has no SELECT policy covering the row it just inserted
--     — the request fails with a row-level security error even
--     though the insert itself was perfectly allowed. This affected
--     BOTH the UNM and external guest branches identically, since
--     the failure has nothing to do with which fields were filled in
--     — only with the caller being anon.
--
--     Fixed by routing every application submission through this
--     function instead of a raw table insert. A plain `INSERT ...
--     RETURNING status` inside a function reads the status straight
--     off the just-inserted row — that's part of the INSERT command
--     itself, not a subsequent SELECT, so no SELECT policy is ever
--     consulted. Not SECURITY DEFINER — it runs as the calling role,
--     so the existing "Anyone can submit" INSERT policy still fully
--     governs who can write what (the p_user_id/auth.uid() check
--     below mirrors that policy defensively). No new SELECT policy
--     needed, so this doesn't reopen the applications PII leak that
--     was deliberately closed earlier in this log.
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_application(
  p_event_id uuid,
  p_event_slug text,
  p_full_name text,
  p_owa text,
  p_year_of_study text,
  p_user_id uuid DEFAULT NULL,
  p_student_id text DEFAULT NULL,
  p_course_of_study text DEFAULT NULL,
  p_school_name text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_attachment_path text DEFAULT NULL,
  p_attachment_name text DEFAULT NULL,
  p_dietary_medical_info text DEFAULT NULL,
  p_visitor_count integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only submit an application as yourself';
  END IF;

  INSERT INTO public.applications (
    event_id, event_slug, full_name, owa, year_of_study,
    student_id, course_of_study, school_name, region,
    user_id, status, attachment_path, attachment_name,
    dietary_medical_info, visitor_count
  ) VALUES (
    p_event_id, p_event_slug, p_full_name, p_owa, p_year_of_study,
    p_student_id, p_course_of_study, p_school_name, p_region,
    p_user_id, 'pending', p_attachment_path, p_attachment_name,
    p_dietary_medical_info, p_visitor_count
  )
  RETURNING status INTO v_status;

  RETURN v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_application(
  uuid, text, text, text, text, uuid, text, text, text, text, text, text, text, integer
) TO anon, authenticated;

-- ============================================================
-- 65. Step 64 didn't actually fix the guest RLS error — turns out
--     the rule is broader than "PostgREST wraps insert().select() in
--     a SELECT": ANY RETURNING clause on an INSERT is checked against
--     the table's SELECT policies too, not just the INSERT policy's
--     WITH CHECK — including a plain `RETURNING ... INTO` inside a
--     PL/pgSQL function. So the function hit the exact same wall the
--     raw table insert did.
--
--     Actual fix: SECURITY DEFINER, so the function (and its
--     RETURNING) runs under the function owner's privileges, which
--     bypass RLS entirely, instead of the caller's. That also means
--     RLS is no longer there to stop a malicious anon caller from
--     passing an arbitrary p_user_id to impersonate someone — the
--     p_user_id/auth.uid() check already in the function body is now
--     the real enforcement of that, not just a defensive extra.
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_application(
  p_event_id uuid,
  p_event_slug text,
  p_full_name text,
  p_owa text,
  p_year_of_study text,
  p_user_id uuid DEFAULT NULL,
  p_student_id text DEFAULT NULL,
  p_course_of_study text DEFAULT NULL,
  p_school_name text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_attachment_path text DEFAULT NULL,
  p_attachment_name text DEFAULT NULL,
  p_dietary_medical_info text DEFAULT NULL,
  p_visitor_count integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only submit an application as yourself';
  END IF;

  INSERT INTO public.applications (
    event_id, event_slug, full_name, owa, year_of_study,
    student_id, course_of_study, school_name, region,
    user_id, status, attachment_path, attachment_name,
    dietary_medical_info, visitor_count
  ) VALUES (
    p_event_id, p_event_slug, p_full_name, p_owa, p_year_of_study,
    p_student_id, p_course_of_study, p_school_name, p_region,
    p_user_id, 'pending', p_attachment_path, p_attachment_name,
    p_dietary_medical_info, p_visitor_count
  )
  RETURNING status INTO v_status;

  RETURN v_status;
END;
$$;

-- ============================================================
-- 66. Mods can also cap HOW MANY visitors an applicant may bring,
--     on top of the include_visitors toggle from step 62.
--     Defaults to 2 (the value the form was hardcoded to).
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS max_visitors integer NOT NULL DEFAULT 2
    CHECK (max_visitors >= 0);

-- ============================================================
-- 67. Mods can spell out WHAT to attach, not just whether an
--     attachment is required (step 43). Free text shown as a
--     callout right above the file picker on the apply form —
--     e.g. "Attach your signed indemnity form and a photo of
--     your student ID". NULL = no extra instructions.
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS attachment_hint text;
