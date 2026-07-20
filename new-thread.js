(async function () {
    if (typeof db === 'undefined') return;

    const { session, isAdmin, isOwner } = await window.roleReady;

    if (!session) {
        window.location.href = '/forum.html';
        return;
    }

    const myRole = isOwner ? 'owner' : (isAdmin ? 'mod' : null);

    const { data: categories } = await db
        .from('forum_categories')
        .select('*')
        .order('sort_order');

    const catList = categories || [];
    const root    = document.getElementById('js-nt-root');

    renderForm();

    function renderForm() {
        root.innerHTML = `
            <form class="nt-form" id="nt-form" novalidate>
                <div class="nt-field">
                    <label class="nt-label" for="nt-cat">Category</label>
                    <select class="nt-select" id="nt-cat" required>
                        <option value="">Select a category…</option>
                        ${catList.map(c =>
                            `<option value="${esc(c.id)}" data-slug="${esc(c.slug)}">${esc(c.name)}</option>`
                        ).join('')}
                    </select>
                </div>

                <div class="nt-field">
                    <label class="nt-label" for="nt-title">Title</label>
                    <input class="nt-input" id="nt-title" type="text"
                           maxlength="200" placeholder="What's your thread about?" required>
                </div>

                <div class="nt-field">
                    <label class="nt-label" for="nt-body">Body</label>
                    <textarea class="nt-textarea" id="nt-body" rows="8"
                              placeholder="Write your post here…" required></textarea>
                </div>

                <p class="nt-error" id="nt-error" hidden></p>

                <div class="nt-form-footer">
                    <a href="/forum.html" class="nt-cancel">Cancel</a>
                    <button type="submit" class="nt-submit" id="nt-submit">Submit Thread</button>
                </div>
            </form>`;

        root.querySelector('#nt-form').addEventListener('submit', handleSubmit);
        root.querySelector('#nt-cat').focus();
    }

    async function handleSubmit(e) {
        e.preventDefault();

        const errEl  = root.querySelector('#nt-error');
        const btn    = root.querySelector('#nt-submit');
        const catSel = root.querySelector('#nt-cat');

        errEl.hidden    = true;
        btn.disabled    = true;
        btn.textContent = 'Submitting…';

        const catId   = parseInt(catSel.value);
        const catSlug = catSel.options[catSel.selectedIndex]?.dataset.slug || '';
        const title   = root.querySelector('#nt-title').value.trim();
        const body    = root.querySelector('#nt-body').value.trim();

        if (!catId || !title || !body) {
            errEl.textContent = 'Please fill in all fields.';
            errEl.hidden      = false;
            btn.disabled      = false;
            btn.textContent   = 'Submit Thread';
            return;
        }

        const status = isAdmin ? 'approved' : 'pending';

        const { data: newThread, error } = await db.from('forum_threads').insert({
            category_id:   catId,
            category_slug: catSlug,
            title,
            body,
            status,
            author_id:    session.user.id,
            author_name:  window.userProfile?.nickname || window.userProfile?.full_name || session.user.email,
            author_avatar: window.userProfile?.avatar_url || null,
            author_role:  myRole,
            last_reply_at: new Date().toISOString(),
        }).select().single();

        if (error) {
            errEl.textContent = error.message;
            errEl.hidden      = false;
            btn.disabled      = false;
            btn.textContent   = 'Submit Thread';
            return;
        }

        showSuccess(newThread, status);
    }

    function showSuccess(thread, status) {
        if (status === 'approved') {
            window.location.href = `/thread.html?id=${thread.id}`;
            return;
        }

        root.innerHTML = `
            <div class="nt-success">
                <div class="nt-success__icon">📬</div>
                <h2 class="nt-success__title">Thread submitted!</h2>
                <p class="nt-success__sub">
                    Your thread is pending review. An admin will approve it before it appears publicly.
                    You'll be able to see it once it's approved.
                </p>
                <a href="/forum.html" class="nt-success__back">Back to Forum</a>
            </div>`;
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

})();
