/**
 * role-utils.js — single source of truth for the current user's role.
 * Loaded on every page, right after supabase-client.js. Roles live in
 * user_profiles.role ('mod' | 'owner' | null), not in Supabase auth
 * metadata, so an owner can promote/demote from within the site.
 */
(function () {
    window.roleReady = (async () => {
        if (typeof db === 'undefined') {
            return { session: null, profile: null, isAdmin: false, isOwner: false };
        }

        const { data: { session } } = await db.auth.getSession();
        if (!session) {
            return { session: null, profile: null, isAdmin: false, isOwner: false };
        }

        const { data: profile } = await db
            .from('user_profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();

        const role = profile?.role || null;
        return {
            session,
            profile: profile || null,
            isAdmin: role === 'mod' || role === 'owner',
            isOwner: role === 'owner',
        };
    })();
})();
