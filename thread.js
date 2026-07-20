(async function () {
    if (typeof db === 'undefined') return;

    const params   = new URLSearchParams(window.location.search);
    const threadId = params.get('id');
    if (!threadId) { window.location.href = '/forum.html'; return; }

    const root = document.getElementById('js-thread-root');

    const [
        { session, isAdmin, isOwner },
        { data: thread, error: threadErr },
        { data: replies },
    ] = await Promise.all([
        window.roleReady,
        db.from('forum_threads').select('*, forum_categories(name,slug)').eq('id', threadId).single(),
        db.from('forum_replies').select('*').eq('thread_id', threadId).order('created_at'),
    ]);

    if (threadErr || !thread) {
        root.innerHTML = `<div class="fr-thread-detail"><a class="fr-back-link" href="/forum.html">Forum</a><p style="color:hsl(0,0%,45%);margin-top:32px">Thread not found.</p></div>`;
        return;
    }

    document.title = `${thread.title}`;

    // Increment view count once per unique visitor. Deduped client-side via
    // localStorage — good enough in practice, and far simpler than trying
    // to track it per-account server-side.
    if (!hasViewedLocally(threadId)) {
        db.rpc('increment_thread_views', { thread_id: threadId }).then(({ error }) => {
            if (error) { console.error('increment_thread_views failed:', error.message); return; }
            markViewedLocally(threadId);
        });
    }

    const myRole   = isOwner ? 'owner' : (isAdmin ? 'mod' : null);
    let replyArr   = replies || [];

    // Fetch live avatars so profile picture changes are reflected
    let avatarMap = {};
    const postAuthorIds = [...new Set([thread.author_id, ...replyArr.map(r => r.author_id)].filter(Boolean))];
    if (postAuthorIds.length) {
        const { data: profiles } = await db
            .from('user_profiles').select('id, avatar_url').in('id', postAuthorIds);
        if (profiles) avatarMap = Object.fromEntries(profiles.map(p => [p.id, p.avatar_url]));
    }

    let committeeMap = {};
    if (postAuthorIds.length) {
        const { data: committee } = await db
            .from('committee_members').select('user_id, position').in('user_id', postAuthorIds);
        if (committee) committeeMap = Object.fromEntries(committee.map(c => [c.user_id, c.position]));
    }

    let likeMap = {};
    {
        const allIds = [threadId, ...replyArr.map(r => r.id)];
        const { data: likes } = await db
            .from('forum_likes').select('target_id, user_id').in('target_id', allIds);
        (likes || []).forEach(l => {
            const entry = likeMap[l.target_id] || (likeMap[l.target_id] = { count: 0, mine: false });
            entry.count++;
            if (session && l.user_id === session.user.id) entry.mine = true;
        });
    }

    render();

    function render() {
        const topLevel = replyArr.filter(r => !r.parent_reply_id);
        const childrenOf = pid => replyArr.filter(r => String(r.parent_reply_id) === String(pid));

        root.innerHTML = `
            <div class="fr-thread-detail">
                <a class="fr-back-link" href="/forum.html">Back to Forum</a>

                <div class="fr-thread-detail__meta">
                    ${thread.forum_categories ? `<span class="fr-cat-chip" style="${catChipStyle(thread.forum_categories.name)}">${esc(thread.forum_categories.name)}</span>` : ''}
                    ${thread.is_locked ? `<span class="fr-thread-badge fr-thread-badge--locked">Locked</span>` : ''}
                    ${thread.is_pinned ? `<span class="fr-thread-badge fr-thread-badge--pinned">Pinned</span>` : ''}
                </div>

                <h1 class="fr-thread-detail__title">${esc(thread.title)}</h1>

                ${buildPost(thread, true)}

                ${buildModerationBar()}

                <p class="fr-replies-heading">${replyArr.length} ${replyArr.length === 1 ? 'Reply' : 'Replies'}</p>

                ${topLevel.map(r => buildReplyThread(r, childrenOf(r.id))).join('')}

                ${buildCompose()}
            </div>`;

        root.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', () => {
                const { del: type, id } = btn.dataset;
                if (type === 'reply')  deleteReply(id);
                if (type === 'thread') deleteThread();
            });
        });

        root.querySelectorAll('[data-reply-for]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!session) { document.dispatchEvent(new CustomEvent('ua:open-login')); return; }
                const target = btn.dataset.replyFor;
                if (target === '__main__') {
                    const mainForm = root.querySelector('#fr-reply-form');
                    if (!mainForm) return;
                    mainForm.hidden = !mainForm.hidden;
                    if (!mainForm.hidden) {
                        mainForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        mainForm.querySelector('textarea').focus();
                    }
                    return;
                }
                const form = root.querySelector(`#fr-nested-form-${target}`);
                if (!form) return;
                form.hidden = !form.hidden;
                if (!form.hidden) form.querySelector('textarea').focus();
            });
        });

        root.querySelectorAll('[data-like-id]').forEach(btn => {
            btn.addEventListener('click', () => toggleLike(btn.dataset.likeType, btn.dataset.likeId));
        });

        root.querySelectorAll('.fr-compose--nested').forEach(form => {
            form.addEventListener('submit', e => submitNestedReply(e, form.dataset.parent));
        });

        root.querySelector('#fr-reply-form')?.addEventListener('submit', submitReply);
        root.querySelector('#fr-signin-link')?.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('ua:open-login'));
        });

        root.querySelector('#fr-mod-approve')?.addEventListener('click', approveThisThread);
        root.querySelector('#fr-mod-reject')?.addEventListener('click', rejectThisThread);
    }

    function buildModerationBar() {
        if (!isAdmin || thread.status === 'approved') return '';
        const isRejected = thread.status === 'rejected';

        return `
            <div class="fr-mod-bar">
                <div class="fr-mod-bar__head">
                    <span class="fr-thread-badge fr-thread-badge--${isRejected ? 'rejected' : 'pinned'}">
                        ${isRejected ? 'Rejected' : 'Pending Approval'}
                    </span>
                </div>
                ${isRejected ? `
                <div class="apply-verdict apply-verdict--rejected fr-mod-bar__verdict">
                    <div class="apply-verdict__left">
                        <span class="apply-verdict__label">Rejected</span>
                        <span class="apply-verdict__icon">✕</span>
                    </div>
                    <div class="apply-verdict__divider"></div>
                    <div class="apply-verdict__right">
                        <p class="apply-verdict__right-title">Reason</p>
                        ${thread.rejection_reason
                            ? `<p class="apply-verdict__reason">${esc(thread.rejection_reason)}</p>`
                            : `<p class="apply-verdict__no-reason">No reason was provided.</p>`}
                    </div>
                </div>` : ''}
                <div class="fr-mod-bar__actions">
                    <button class="fr-pending-btn fr-pending-btn--approve" id="fr-mod-approve">Approve</button>
                    ${!isRejected ? `<button class="fr-pending-btn fr-pending-btn--reject" id="fr-mod-reject">Reject</button>` : ''}
                </div>
            </div>`;
    }

    async function approveThisThread() {
        const btn = root.querySelector('#fr-mod-approve');
        if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }

        const { error } = await db.from('forum_threads')
            .update({ status: 'approved', rejection_reason: null }).eq('id', threadId);
        if (error) { alert(error.message); return; }

        thread.status = 'approved';
        thread.rejection_reason = null;
        render();
    }

    async function rejectThisThread() {
        const reason = prompt('Reason for rejection (optional):\nThe author will see this message.');
        if (reason === null) return;

        const btn = root.querySelector('#fr-mod-reject');
        if (btn) { btn.disabled = true; btn.textContent = 'Rejecting…'; }

        const { error } = await db.from('forum_threads')
            .update({ status: 'rejected', rejection_reason: reason.trim() || null }).eq('id', threadId);
        if (error) { alert(error.message); return; }

        thread.status = 'rejected';
        thread.rejection_reason = reason.trim() || null;
        render();
    }

    function buildReplyThread(reply, children) {
        return `
            <div class="fr-reply-wrap">
                ${buildPost(reply, false, false, reply.id)}
                ${children.length ? `
                <div class="fr-nested-replies">
                    ${children.map(c => buildPost(c, false, true, reply.id)).join('')}
                </div>` : ''}
                ${!thread.is_locked && session ? `
                <form class="fr-compose fr-compose--nested" id="fr-nested-form-${esc(reply.id)}" data-parent="${esc(reply.id)}" hidden>
                    <textarea class="fr-compose__textarea" placeholder="Reply to ${esc(reply.author_name)}…" required></textarea>
                    <div class="fr-compose__footer">
                        <p class="fr-compose__err" hidden></p>
                        <button type="submit" class="fr-compose__submit">Post Reply</button>
                    </div>
                </form>` : ''}
            </div>`;
    }

    function buildPost(post, isOp, isNested = false, replyTargetId = null) {
        const initials = getInitials(post.author_name || '?');
        const dateStr  = new Date(post.created_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
        const canDelete = isAdmin || (session?.user?.id === post.author_id);
        const avatar    = avatarMap[post.author_id] ?? post.author_avatar;
        const profUrl   = post.author_id ? `/profile.html?id=${esc(post.author_id)}` : null;
        const avatarEl  = `<div class="fr-post__avatar">${avatar ? `<img src="${esc(avatar)}" alt="${esc(post.author_name)}">` : `<span>${initials}</span>`}</div>`;
        const isByOp    = !!post.author_id && post.author_id === thread.author_id;

        const like     = likeMap[post.id] || { count: 0, mine: false };
        const likeType = isOp ? 'thread' : 'reply';
        const replyFor = isOp ? '__main__' : replyTargetId;

        return `
            <div class="fr-post${isOp ? ' fr-post--op' : ''}${isNested ? ' fr-post--nested' : ''}">
                <div class="fr-post__head">
                    ${profUrl ? `<a class="fr-author-link" href="${profUrl}">${avatarEl}</a>` : avatarEl}
                    <div class="fr-post__head-info">
                        <p class="fr-post__author">
                            ${profUrl ? `<a class="fr-author-link" href="${profUrl}">${esc(post.author_name)}</a>` : esc(post.author_name)}
                            ${post.author_role === 'owner' ? `<span class="fr-mod-badge fr-mod-badge--owner">Owner</span>`
                              : post.author_role === 'mod' || post.author_role === 'admin' ? `<span class="fr-mod-badge">Mod</span>` : ''}
                            ${committeeMap[post.author_id] ? `<span class="cm-pos-badge">${esc(committeeMap[post.author_id])}</span>` : ''}
                            ${isByOp ? `<span class="fr-op-chip">OP</span>` : ''}
                        </p>
                        <p class="fr-post__date">${dateStr}</p>
                    </div>
                    ${canDelete && !isOp ? `
                    <button class="fr-admin-btn fr-admin-btn--del" style="margin-inline-start:auto"
                            data-del="reply" data-id="${esc(post.id)}">Delete</button>` : ''}
                    ${isOp && isAdmin ? `
                    <button class="fr-admin-btn fr-admin-btn--del" style="margin-inline-start:auto"
                            data-del="thread" data-id="${esc(post.id)}">Delete Thread</button>` : ''}
                </div>
                <div class="fr-post__body">${esc(post.body)}</div>
                <div class="fr-post__actions">
                    <button class="fr-action-btn${like.mine ? ' fr-action-btn--active' : ''}"
                            data-like-id="${esc(post.id)}" data-like-type="${likeType}">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="${like.mine ? 'currentColor' : 'none'}"
                             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                        </svg>
                        ${like.count > 0 ? like.count : ''} Like${like.count === 1 ? '' : 's'}
                    </button>
                    ${!thread.is_locked && session ? `
                    <button class="fr-action-btn" data-reply-for="${esc(replyFor)}">Reply</button>` : ''}
                </div>
            </div>`;
    }

    function buildCompose() {
        if (thread.is_locked) {
            return `<div class="fr-compose-notice">🔒 This thread is locked.</div>`;
        }
        if (!session) {
            return `
                <div class="fr-compose-notice">
                    <button class="fr-inline-link" id="fr-signin-link">Sign in</button> to reply.
                </div>`;
        }
        return `
            <form class="fr-compose" id="fr-reply-form" hidden>
                <div class="fr-compose__head">Write a reply</div>
                <textarea class="fr-compose__textarea" id="fr-reply-body"
                          placeholder="Share your thoughts…" required></textarea>
                <div class="fr-compose__footer">
                    <p id="fr-reply-err" class="fr-compose__err" hidden></p>
                    <button type="submit" class="fr-compose__submit" id="fr-reply-submit">Post Reply</button>
                </div>
            </form>`;
    }

    async function submitReply(e) {
        e.preventDefault();
        const btn   = root.querySelector('#fr-reply-submit');
        const errEl = root.querySelector('#fr-reply-err');
        const body  = root.querySelector('#fr-reply-body').value.trim();
        if (!body) return;

        errEl.hidden    = true;
        btn.disabled    = true;
        btn.textContent = 'Posting…';

        const { data: newReply, error } = await db.from('forum_replies').insert({
            thread_id:    threadId,
            body,
            author_id:    session.user.id,
            author_name:  window.userProfile?.nickname || window.userProfile?.full_name || session.user.email,
            author_avatar: window.userProfile?.avatar_url || null,
            author_role:  myRole,
        }).select().single();

        if (error) {
            errEl.textContent = error.message;
            errEl.hidden      = false;
            btn.disabled      = false;
            btn.textContent   = 'Post Reply';
            return;
        }

        thread.reply_count = (thread.reply_count || 0) + 1;
        await db.from('forum_threads').update({
            reply_count:   thread.reply_count,
            last_reply_at: new Date().toISOString(),
        }).eq('id', threadId);

        replyArr.push(newReply);
        render();
    }

    async function submitNestedReply(e, parentId) {
        e.preventDefault();
        const form  = e.target;
        const btn   = form.querySelector('.fr-compose__submit');
        const errEl = form.querySelector('.fr-compose__err');
        const body  = form.querySelector('textarea').value.trim();
        if (!body) return;

        errEl.hidden    = true;
        btn.disabled    = true;
        btn.textContent = 'Posting…';

        const { data: newReply, error } = await db.from('forum_replies').insert({
            thread_id:       threadId,
            parent_reply_id: parentId,
            body,
            author_id:       session.user.id,
            author_name:     window.userProfile?.nickname || window.userProfile?.full_name || session.user.email,
            author_avatar:   window.userProfile?.avatar_url || null,
            author_role:     myRole,
        }).select().single();

        if (error) {
            errEl.textContent = error.message;
            errEl.hidden      = false;
            btn.disabled      = false;
            btn.textContent   = 'Post Reply';
            return;
        }

        thread.reply_count = (thread.reply_count || 0) + 1;
        await db.from('forum_threads').update({
            reply_count:   thread.reply_count,
            last_reply_at: new Date().toISOString(),
        }).eq('id', threadId);

        replyArr.push(newReply);
        render();
    }

    async function deleteReply(replyId) {
        if (!confirm('Delete this reply?')) return;
        const { error } = await db.from('forum_replies').delete().eq('id', replyId);
        if (error) { alert(error.message); return; }

        const children     = replyArr.filter(r => String(r.parent_reply_id) === String(replyId));
        const removedCount = 1 + children.length;

        replyArr = replyArr.filter(r => r.id !== replyId && String(r.parent_reply_id) !== String(replyId));

        thread.reply_count = Math.max(0, (thread.reply_count || removedCount) - removedCount);
        await db.from('forum_threads')
            .update({ reply_count: thread.reply_count }).eq('id', threadId);
        render();
    }

    async function deleteThread() {
        if (!confirm('Delete this entire thread?\n\nThis cannot be undone.')) return;
        await db.from('forum_threads').delete().eq('id', threadId);
        window.location.href = '/forum.html';
    }

    async function toggleLike(targetType, targetId) {
        if (!session) { document.dispatchEvent(new CustomEvent('ua:open-login')); return; }

        const existing = likeMap[targetId] || { count: 0, mine: false };

        if (existing.mine) {
            const { error } = await db.from('forum_likes').delete()
                .eq('target_type', targetType).eq('target_id', targetId).eq('user_id', session.user.id);
            if (error) { alert(error.message); return; }
            likeMap[targetId] = { count: Math.max(0, existing.count - 1), mine: false };
        } else {
            const { error } = await db.from('forum_likes').insert({
                target_type: targetType, target_id: targetId, user_id: session.user.id,
            });
            if (error) { alert(error.message); return; }
            likeMap[targetId] = { count: existing.count + 1, mine: true };
        }
        render();
    }

    function catChipStyle(name) {
        const h = stringToHue(name);
        return `background:hsl(${h},55%,93%);color:hsl(${h},45%,32%)`;
    }

    function stringToHue(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
        return h % 360;
    }

    function getInitials(name) {
        return name.split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function hasViewedLocally(id) {
        try { return JSON.parse(localStorage.getItem('rs-viewed-threads') || '[]').includes(id); }
        catch { return false; }
    }

    function markViewedLocally(id) {
        try {
            const seen = JSON.parse(localStorage.getItem('rs-viewed-threads') || '[]');
            if (seen.includes(id)) return;
            seen.push(id);
            if (seen.length > 500) seen.shift();
            localStorage.setItem('rs-viewed-threads', JSON.stringify(seen));
        } catch {}
    }

})();
