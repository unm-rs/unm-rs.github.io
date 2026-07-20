(async function () {
    if (typeof db === 'undefined') return;

    window.initHeroImage?.('forum');

    // Session must resolve before we know the role
    const { session, isAdmin } = await window.roleReady;

    const [catResult, threadResult] = await Promise.all([
        db.from('forum_categories').select('*').order('sort_order'),
        db.from('forum_threads')
            .select('*')
            .eq('status', 'approved')
            .order('is_pinned', { ascending: false })
            .order('last_reply_at', { ascending: false }),
    ]);

    const catList   = catResult.data   || [];
    const catMap    = Object.fromEntries(catList.map(c => [c.id, c]));
    const threadArr = threadResult.data || [];

    // Admins also load pending + rejected threads (rejected threads stay
    // visible here with their reason, instead of just vanishing)
    let pendingArr = [];
    if (isAdmin) {
        const { data } = await db.from('forum_threads')
            .select('*')
            .in('status', ['pending', 'rejected'])
            .order('created_at', { ascending: false });
        pendingArr = data || [];
    }

    // Fetch live avatars so profile picture changes are reflected
    let avatarMap = {};
    const allAuthorIds = [...new Set([...threadArr, ...pendingArr].map(t => t.author_id).filter(Boolean))];
    if (allAuthorIds.length) {
        const { data: profiles } = await db
            .from('user_profiles').select('id, avatar_url').in('id', allAuthorIds);
        if (profiles) avatarMap = Object.fromEntries(profiles.map(p => [p.id, p.avatar_url]));
    }

    let likeCountMap = {};
    if (threadArr.length) {
        const { data: likes } = await db
            .from('forum_likes').select('target_id')
            .eq('target_type', 'thread').in('target_id', threadArr.map(t => t.id));
        (likes || []).forEach(l => { likeCountMap[l.target_id] = (likeCountMap[l.target_id] || 0) + 1; });
    }

    let selectedCat = 'all';

    const pendingEl = document.getElementById('js-fr-pending');
    const catsEl    = document.getElementById('js-fr-cats');
    const threadsEl = document.getElementById('js-fr-threads');
    const actionsEl = document.getElementById('js-fr-actions');

    if (isAdmin) renderPendingPanel();
    renderCats();
    renderActions();
    renderThreads();

    function renderPendingPanel() {
        if (!pendingEl) return;

        if (pendingArr.length === 0) {
            pendingEl.innerHTML = '';
            return;
        }

        const pendingCount = pendingArr.filter(t => t.status === 'pending').length;

        pendingEl.innerHTML = `
            <section class="fr-pending-panel">
                <div class="wrapper fr-wrapper">
                    <div class="fr-pending-head">
                        <h2 class="fr-pending-title">Pending Approval</h2>
                        <span class="fr-pending-count">${pendingCount}</span>
                    </div>
                    <div class="fr-thread-list">
                        ${pendingArr.map(buildPendingRow).join('')}
                    </div>
                </div>
            </section>`;

        pendingEl.querySelectorAll('.fr-thread-row').forEach(row => {
            row.addEventListener('click', e => {
                if (e.target.closest('.fr-author-link')) return;
                window.location.href = `/thread.html?id=${row.dataset.id}`;
            });
            row.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    window.location.href = `/thread.html?id=${row.dataset.id}`;
                }
            });
        });
    }

    function buildPendingRow(t) {
        const cat        = catMap[t.category_id];
        const initials   = getInitials(t.author_name || '?');
        const dateStr    = relativeTime(t.created_at);
        const avatar     = avatarMap[t.author_id] ?? t.author_avatar;
        const profUrl    = t.author_id ? `/profile.html?id=${esc(t.author_id)}` : null;
        const avatarEl   = `<div class="fr-thread-avatar">${avatar ? `<img src="${esc(avatar)}" alt="${esc(t.author_name)}">` : `<span>${initials}</span>`}</div>`;
        const isRejected = t.status === 'rejected';

        return `
            <div class="fr-thread-row" role="button" tabindex="0" data-id="${esc(t.id)}">
                ${profUrl ? `<a class="fr-author-link" href="${profUrl}">${avatarEl}</a>` : avatarEl}
                <div class="fr-thread-main">
                    <div class="fr-thread-title-row">
                        <span class="fr-thread-title">${esc(t.title)}</span>
                        ${cat ? `<span class="fr-cat-chip" style="${catChipStyle(cat.name)}">${esc(cat.name)}</span>` : ''}
                    </div>
                    <p class="fr-thread-meta">${profUrl ? `<a class="fr-author-link" href="${profUrl}">${esc(t.author_name)}</a>` : esc(t.author_name)} &middot; ${dateStr}</p>
                </div>
                <div class="fr-thread-stats">
                    <span class="fr-thread-badge fr-thread-badge--${isRejected ? 'rejected' : 'pinned'}">${isRejected ? 'Rejected' : 'Pending'}</span>
                </div>
            </div>`;
    }

    function renderCats() {
        const all = [{ id: 'all', name: 'All', slug: 'all' }, ...catList];
        catsEl.innerHTML = all.map(c => `
            <span class="fr-cat-tab-wrap">
                <button class="fr-cat-tab${c.slug === selectedCat ? ' fr-cat-tab--active' : ''}"
                        data-slug="${esc(c.slug)}">
                    ${esc(c.name)}
                </button>
                ${isAdmin && c.slug !== 'all' ? `
                <button class="fr-cat-edit" data-catid="${esc(String(c.id))}"
                        aria-label="Rename category ${esc(c.name)}" title="Rename category">✎</button>
                <button class="fr-cat-del" data-catid="${esc(String(c.id))}" data-catname="${esc(c.name)}"
                        aria-label="Delete category ${esc(c.name)}" title="Delete category">✕</button>` : ''}
            </span>`).join('');

        if (isAdmin) {
            catsEl.innerHTML += `
                <button class="fr-cat-tab fr-cat-tab--muted" id="js-fr-addcat">+ Category</button>`;
        }

        catsEl.querySelectorAll('.fr-cat-tab[data-slug]').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedCat = btn.dataset.slug;
                renderCats();
                renderThreads();
            });
        });

        catsEl.querySelectorAll('.fr-cat-del').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                deleteCategory(btn.dataset.catid, btn.dataset.catname);
            });
        });

        catsEl.querySelectorAll('.fr-cat-edit').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                openRenameCategory(btn.dataset.catid);
            });
        });

        document.getElementById('js-fr-addcat')?.addEventListener('click', openAddCategory);
    }

    async function deleteCategory(catId, catName) {
        const threadCount = threadArr.filter(t => String(t.category_id) === String(catId)).length
            + pendingArr.filter(t => String(t.category_id) === String(catId)).length;

        const warning = threadCount > 0
            ? `Delete "${catName}"?\n\nThis category has ${threadCount} thread${threadCount === 1 ? '' : 's'}. They will NOT be deleted, but will lose their category.\n\nThis cannot be undone.`
            : `Delete "${catName}"?\n\nThis cannot be undone.`;
        if (!confirm(warning)) return;

        const { error } = await db.from('forum_categories').delete().eq('id', catId);
        if (error) { alert('Delete failed: ' + error.message); return; }

        const idx = catList.findIndex(c => String(c.id) === String(catId));
        if (idx !== -1) catList.splice(idx, 1);
        delete catMap[catId];

        if (selectedCat !== 'all') {
            const stillExists = catList.some(c => c.slug === selectedCat);
            if (!stillExists) selectedCat = 'all';
        }

        renderCats();
        renderThreads();
    }

    function renderActions() {
        if (!session) { actionsEl.innerHTML = ''; return; }
        actionsEl.innerHTML = `
            <a href="/new-thread.html" class="fr-new-btn">New Thread</a>`;
    }

    function renderThreads() {
        const filtered = threadArr.filter(t =>
            selectedCat === 'all' || t.category_slug === selectedCat
        );

        if (filtered.length === 0) {
            threadsEl.innerHTML = `
                <div class="fr-thread-list">
                    <p class="fr-empty">No threads yet${selectedCat !== 'all' ? ' in this category' : ''}.
                        ${session
                            ? `<a class="fr-inline-link" href="/new-thread.html"> Start one.</a>`
                            : `<button class="fr-inline-link" id="fr-empty-login"> Sign in</button> to start one.`}
                    </p>
                </div>`;
            document.getElementById('fr-empty-login')?.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('ua:open-login'));
            });
            return;
        }

        threadsEl.innerHTML = `
            <div class="fr-thread-list">
                ${filtered.map(buildRow).join('')}
            </div>`;

        threadsEl.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const { action, id } = btn.dataset;
                const thread = threadArr.find(t => t.id === id);
                if (!thread) return;
                if (action === 'pin')    togglePin(thread);
                if (action === 'lock')   toggleLock(thread);
                if (action === 'delete') deleteThread(thread);
            });
        });

        threadsEl.querySelectorAll('.fr-thread-row').forEach(row => {
            row.addEventListener('click', e => {
                if (e.target.closest('.fr-author-link')) return;
                window.location.href = `/thread.html?id=${row.dataset.id}`;
            });
            row.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    window.location.href = `/thread.html?id=${row.dataset.id}`;
                }
            });
        });
    }

    function buildRow(t) {
        const cat      = catMap[t.category_id];
        const initials = getInitials(t.author_name || '?');
        const dateStr  = relativeTime(t.last_reply_at || t.created_at);
        const avatar   = avatarMap[t.author_id] ?? t.author_avatar;
        const profUrl  = t.author_id ? `/profile.html?id=${esc(t.author_id)}` : null;
        const avatarEl = `<div class="fr-thread-avatar">${avatar ? `<img src="${esc(avatar)}" alt="${esc(t.author_name)}">` : `<span>${initials}</span>`}</div>`;
        const excerpt  = (t.body || '').slice(0, 160).trim() + ((t.body || '').length > 160 ? '…' : '');

        return `
            <div class="fr-thread-row${t.is_pinned ? ' fr-thread-row--pinned' : ''}"
                 role="button" tabindex="0" data-id="${esc(t.id)}">
                ${profUrl ? `<a class="fr-author-link" href="${profUrl}">${avatarEl}</a>` : avatarEl}
                <div class="fr-thread-main">
                    <div class="fr-thread-title-row">
                        <span class="fr-thread-title">${esc(t.title)}</span>
                        ${t.is_pinned ? `<span class="fr-thread-badge fr-thread-badge--pinned">Pinned</span>` : ''}
                        ${t.is_locked ? `<span class="fr-thread-badge fr-thread-badge--locked">Locked</span>` : ''}
                        ${cat ? `<span class="fr-cat-chip" style="${catChipStyle(cat.name)}">${esc(cat.name)}</span>` : ''}
                    </div>
                    <p class="fr-thread-meta">${profUrl ? `<a class="fr-author-link" href="${profUrl}">${esc(t.author_name)}</a>` : esc(t.author_name)} &middot; ${dateStr}</p>
                    ${excerpt ? `<p class="fr-thread-excerpt">${esc(excerpt)}</p>` : ''}
                    ${isAdmin ? `
                    <div class="fr-thread-admin">
                        <button class="fr-admin-btn" data-action="pin"    data-id="${esc(t.id)}">${t.is_pinned ? 'Unpin' : 'Pin'}</button>
                        <button class="fr-admin-btn" data-action="lock"   data-id="${esc(t.id)}">${t.is_locked ? 'Unlock' : 'Lock'}</button>
                        <button class="fr-admin-btn fr-admin-btn--del" data-action="delete" data-id="${esc(t.id)}">Delete</button>
                    </div>` : ''}
                </div>
                <div class="fr-thread-stats">
                    <span class="fr-thread-stat"><strong>${t.view_count ?? 0}</strong> views</span>
                    <span class="fr-thread-stat"><strong>${likeCountMap[t.id] || 0}</strong> likes</span>
                    <span class="fr-thread-stat"><strong>${t.reply_count ?? 0}</strong> replies</span>
                </div>
            </div>`;
    }

    function openAddCategory() {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:400px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Add Category</h2>
                    <button class="ab-modal__close" id="fr-cc">✕</button>
                </div>
                <form class="ab-form" id="fr-cat-form">
                    <div class="ab-field">
                        <label class="ab-label">Name</label>
                        <input class="ab-input" id="fr-cat-name" type="text" required placeholder="e.g. Projects">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Description <span style="font-weight:400;color:hsl(0 0% 50%)">(optional)</span></label>
                        <input class="ab-input" id="fr-cat-desc" type="text" placeholder="Short description">
                    </div>
                    <div id="fr-cat-err" class="ab-error" hidden></div>
                    <div class="ab-form-actions">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="fr-cat-submit">Add Category</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('#fr-cat-name').focus();

        const close = () => overlay.remove();
        overlay.querySelector('#fr-cc').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        overlay.querySelector('#fr-cat-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errEl = overlay.querySelector('#fr-cat-err');
            const btn   = overlay.querySelector('#fr-cat-submit');
            errEl.hidden    = true;
            btn.disabled    = true;
            btn.textContent = 'Adding…';

            const name = overlay.querySelector('#fr-cat-name').value.trim();
            const desc = overlay.querySelector('#fr-cat-desc').value.trim();
            const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

            const { data: newCat, error } = await db.from('forum_categories').insert({
                name, slug,
                description: desc || null,
                sort_order:  catList.length,
            }).select().single();

            if (error) {
                errEl.textContent = error.message;
                errEl.hidden      = false;
                btn.disabled      = false;
                btn.textContent   = 'Add Category';
                return;
            }

            catList.push(newCat);
            catMap[newCat.id] = newCat;
            close();
            renderCats();
        });
    }

    function openRenameCategory(catId) {
        const cat = catMap[catId];
        if (!cat) return;

        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:400px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Rename Category</h2>
                    <button class="ab-modal__close" id="fr-rc">✕</button>
                </div>
                <form class="ab-form" id="fr-cat-rename-form">
                    <div class="ab-field">
                        <label class="ab-label">Name</label>
                        <input class="ab-input" id="fr-cat-rename-name" type="text" required
                               value="${esc(cat.name)}">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Description <span style="font-weight:400;color:hsl(0 0% 50%)">(optional)</span></label>
                        <input class="ab-input" id="fr-cat-rename-desc" type="text"
                               value="${esc(cat.description || '')}" placeholder="Short description">
                    </div>
                    <div id="fr-cat-rename-err" class="ab-error" hidden></div>
                    <div class="ab-form-actions">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="fr-cat-rename-submit">Save</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);
        const nameInput = overlay.querySelector('#fr-cat-rename-name');
        nameInput.focus();
        nameInput.select();

        const close = () => overlay.remove();
        overlay.querySelector('#fr-rc').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        overlay.querySelector('#fr-cat-rename-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errEl = overlay.querySelector('#fr-cat-rename-err');
            const btn   = overlay.querySelector('#fr-cat-rename-submit');
            errEl.hidden    = true;
            btn.disabled    = true;
            btn.textContent = 'Saving…';

            const name = overlay.querySelector('#fr-cat-rename-name').value.trim();
            const desc = overlay.querySelector('#fr-cat-rename-desc').value.trim();
            const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

            const { data: updated, error } = await db.from('forum_categories')
                .update({ name, slug, description: desc || null })
                .eq('id', catId)
                .select()
                .single();

            if (error) {
                errEl.textContent = error.message;
                errEl.hidden      = false;
                btn.disabled      = false;
                btn.textContent   = 'Save';
                return;
            }

            catMap[catId] = updated;
            const idx = catList.findIndex(c => String(c.id) === String(catId));
            if (idx !== -1) catList[idx] = updated;

            // Threads keep the old category_slug — refresh it so filtering still works
            threadArr.forEach(t => { if (String(t.category_id) === String(catId)) t.category_slug = updated.slug; });
            pendingArr.forEach(t => { if (String(t.category_id) === String(catId)) t.category_slug = updated.slug; });

            if (selectedCat !== 'all' && selectedCat !== updated.slug) {
                const wasSelected = String(cat.id) === String(catId) && selectedCat === cat.slug;
                if (wasSelected) selectedCat = updated.slug;
            }

            close();
            renderCats();
            renderThreads();
        });
    }

    async function togglePin(thread) {
        const { error } = await db.from('forum_threads')
            .update({ is_pinned: !thread.is_pinned }).eq('id', thread.id);
        if (error) { alert(error.message); return; }
        thread.is_pinned = !thread.is_pinned;
        renderThreads();
    }

    async function toggleLock(thread) {
        const { error } = await db.from('forum_threads')
            .update({ is_locked: !thread.is_locked }).eq('id', thread.id);
        if (error) { alert(error.message); return; }
        thread.is_locked = !thread.is_locked;
        renderThreads();
    }

    async function deleteThread(thread) {
        if (!confirm(`Delete "${thread.title}"?\n\nThis cannot be undone.`)) return;
        const { error } = await db.from('forum_threads').delete().eq('id', thread.id);
        if (error) { alert(error.message); return; }
        threadArr.splice(threadArr.indexOf(thread), 1);
        renderThreads();
    }

    function relativeTime(iso) {
        const diff = Date.now() - new Date(iso).getTime();
        const m = Math.floor(diff / 60000);
        const h = Math.floor(diff / 3600000);
        const d = Math.floor(diff / 86400000);
        if (m < 1)  return 'just now';
        if (m < 60) return `${m}m ago`;
        if (h < 24) return `${h}h ago`;
        if (d < 7)  return `${d}d ago`;
        return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

    function makeOverlay() {
        const el = document.createElement('div');
        el.className = 'ab-overlay';
        return el;
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

})();
