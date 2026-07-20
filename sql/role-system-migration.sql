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
