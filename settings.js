(async function () {
    if (typeof db === 'undefined') return;

    const { session, isOwner, roleLabels } = await window.roleReady;

    if (!session) {
        window.location.href = '/';
        return;
    }

    document.title = 'Settings';
    const root = document.getElementById('js-settings-root');

    root.innerHTML = `
        <div class="st-wrap">
            <h1 class="st-page-title">Settings</h1>

            <section class="st-section">
                <h2 class="st-section__title">Account</h2>
                <p class="st-email">${esc(session.user.email)}</p>
            </section>

            <section class="st-section">
                <h2 class="st-section__title">Security</h2>
                <div id="st-2fa-status" class="st-2fa-box">Loading…</div>
            </section>

            ${isOwner ? `
            <section class="st-section" id="st-role-labels-section">
                <h2 class="st-section__title">Role Labels</h2>
                <div class="st-tag-add-form">
                    <label class="st-tag-color-label">Owner label
                        <input class="st-mods-search__input" id="st-label-owner" type="text"
                               maxlength="24" value="${esc(roleLabels.owner)}">
                    </label>
                    <label class="st-tag-color-label">Mod label
                        <input class="st-mods-search__input" id="st-label-mod" type="text"
                               maxlength="24" value="${esc(roleLabels.mod)}">
                    </label>
                    <button class="st-mods-row__btn st-mods-row__btn--promote" id="st-labels-save">Save</button>
                </div>
            </section>` : ''}

            ${isOwner ? `
            <section class="st-section" id="st-mods-section">
                <h2 class="st-section__title">Moderators</h2>
                <div id="st-mods-list" class="st-mods-list">Loading…</div>
                <div class="st-mods-search">
                    <input class="st-mods-search__input" id="st-mods-search" type="text"
                           placeholder="Search by name or student ID to appoint a mod…">
                    <div id="st-mods-results" class="st-mods-results" hidden></div>
                </div>
            </section>` : ''}

            ${isOwner ? `
            <section class="st-section" id="st-tags-section">
                <h2 class="st-section__title">Tags</h2>
                <div id="st-tags-list" class="st-mods-list">Loading…</div>
                <div class="st-tag-add-form" id="st-tags-form" hidden>
                    <input class="st-mods-search__input" id="st-tag-name" type="text"
                           placeholder="Tag name" maxlength="24">
                    <label class="st-tag-color-label">Text
                        <input class="st-tag-color-input" id="st-tag-color" type="color" value="#f2c14e">
                    </label>
                    <label class="st-tag-color-label">Background
                        <input class="st-tag-color-input" id="st-tag-bgcolor" type="color" value="#2a1d05">
                    </label>
                    <button class="st-mods-row__btn st-mods-row__btn--promote" id="st-tag-save">Save</button>
                    <button class="st-mods-row__btn" id="st-tag-cancel">Cancel</button>
                </div>
                <button class="st-mods-row__btn st-mods-row__btn--promote" id="st-tags-add-btn">Add Tag</button>
            </section>` : ''}

            <section class="st-section st-section--danger">
                <h2 class="st-section__title">Session</h2>
                <button class="pf-btn pf-btn--signout" id="st-signout">Sign Out</button>
            </section>
        </div>`;

    document.getElementById('st-signout').addEventListener('click', async () => {
        await db.auth.signOut();
        window.location.href = '/';
    });

    load2FAStatus(document.getElementById('st-2fa-status'));
    if (isOwner) initModerators();
    if (isOwner) initTags();
    if (isOwner) initRoleLabels();

    function initRoleLabels() {
        document.getElementById('st-labels-save').addEventListener('click', async () => {
            const ownerLabel = document.getElementById('st-label-owner').value.trim() || 'Owner';
            const modLabel   = document.getElementById('st-label-mod').value.trim() || 'Mod';
            const saveBtn    = document.getElementById('st-labels-save');
            saveBtn.disabled = true;

            const [{ error: e1 }, { error: e2 }] = await Promise.all([
                db.from('role_labels').update({ label: ownerLabel }).eq('role', 'owner'),
                db.from('role_labels').update({ label: modLabel }).eq('role', 'mod'),
            ]);

            saveBtn.disabled = false;
            if (e1 || e2) { alert('Failed: ' + (e1 || e2).message); return; }
            alert('Saved — reload the page to see the new labels everywhere.');
        });
    }

    async function load2FAStatus(container) {
        if (!container) return;
        const { data: factors } = await db.auth.mfa.listFactors();
        const factor = factors?.totp?.[0];

        if (factor?.status === 'verified') {
            container.className = 'st-2fa-box st-2fa-box--on';
            container.innerHTML = `
                <div class="st-2fa-box__text">
                    <span class="st-2fa-box__icon">✓</span>
                    <span class="st-2fa-box__label">Two-Factor Authentication (2FA) Enabled</span>
                </div>
                <button class="pf-btn pf-btn--ghost pf-btn--sm" id="st-2fa-remove">Remove</button>`;
            container.querySelector('#st-2fa-remove').addEventListener('click', async () => {
                if (!confirm('Remove 2FA? Your account will be less secure.')) return;
                const { error } = await db.auth.mfa.unenroll({ factorId: factor.id });
                if (error) { alert(error.message); return; }
                load2FAStatus(container);
            });
        } else {
            container.className = 'st-2fa-box';
            container.innerHTML = `
                <button class="st-2fa-box__btn" id="st-2fa-setup">Enable Two-Factor Authentication (2FA)</button>`;
            container.querySelector('#st-2fa-setup').addEventListener('click', () => open2FASetup(container));
        }
    }

    function open2FASetup(statusContainer) {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:380px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Set Up 2FA</h2>
                    <button class="ab-modal__close" id="st-2fc">✕</button>
                </div>
                <p style="font-size:13px;color:hsl(0 0% 50%);margin-block-end:16px">
                    Scan this QR code with <strong style="color:hsl(0 0% 80%)">Google Authenticator</strong>,
                    <strong style="color:hsl(0 0% 80%)">Authy</strong>, or any TOTP app.
                </p>
                <div id="st-qr" style="display:flex;flex-direction:column;align-items:center;gap:12px;margin-block:16px">
                    <div style="font-size:13px;color:hsl(0 0% 45%)">Generating…</div>
                </div>
                <form class="ab-form" id="st-2fa-form">
                    <div class="ab-field">
                        <label class="ab-label">Confirm with app code</label>
                        <input class="ab-input" id="st-2fa-code" type="text" inputmode="numeric"
                               maxlength="6" placeholder="000000" required>
                    </div>
                    <div id="st-2fa-err" class="ab-error" hidden></div>
                    <div class="ab-form-actions">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="st-2fa-verify" disabled>
                            Enable 2FA
                        </button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('#st-2fc').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        let factorId;
        (async () => {
            // Best-effort cleanup of leftover unverified factors from past abandoned attempts
            const { data: existing } = await db.auth.mfa.listFactors();
            for (const f of existing?.totp || []) {
                if (f.status !== 'verified') await db.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
            }

            // Unique friendly name every time sidesteps Supabase's "factor already exists" clash
            const { data: enroll, error } = await db.auth.mfa.enroll({
                factorType: 'totp', friendlyName: `Authenticator-${Date.now()}`,
            });

            if (error) {
                overlay.querySelector('#st-qr').innerHTML =
                    `<p style="color:hsl(5,68%,62%);font-size:13px">${error.message}</p>`;
                return;
            }
            factorId = enroll.id;
            const qrEl = overlay.querySelector('#st-qr');
            qrEl.innerHTML = `
                <p style="font-size:12px;color:hsl(0 0% 38%);word-break:break-all;text-align:center">
                    Manual key: ${enroll.totp.secret}
                </p>`;
            const img = document.createElement('img');
            img.alt = 'QR Code';
            img.style.cssText = 'width:180px;height:180px;border-radius:8px;background:#fff;padding:8px';
            img.src = enroll.totp.qr_code;
            qrEl.prepend(img);
            overlay.querySelector('#st-2fa-verify').disabled = false;
            overlay.querySelector('#st-2fa-code').focus();
        })();

        overlay.querySelector('#st-2fa-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errEl = overlay.querySelector('#st-2fa-err');
            const btn   = overlay.querySelector('#st-2fa-verify');
            errEl.hidden    = true;
            btn.disabled    = true;
            btn.textContent = 'Verifying…';

            const { data: challenge, error: cErr } = await db.auth.mfa.challenge({ factorId });
            if (cErr) {
                errEl.textContent = cErr.message; errEl.hidden = false;
                btn.disabled = false; btn.textContent = 'Enable 2FA';
                return;
            }
            const { error: vErr } = await db.auth.mfa.verify({
                factorId, challengeId: challenge.id,
                code: overlay.querySelector('#st-2fa-code').value.trim(),
            });
            if (vErr) {
                errEl.textContent = vErr.message; errEl.hidden = false;
                btn.disabled = false; btn.textContent = 'Enable 2FA';
                return;
            }
            close();
            load2FAStatus(statusContainer);
        });
    }

    async function initModerators() {
        const listEl   = document.getElementById('st-mods-list');
        const searchEl = document.getElementById('st-mods-search');
        const resultsEl = document.getElementById('st-mods-results');

        await loadMods();

        let debounce;
        searchEl.addEventListener('input', () => {
            clearTimeout(debounce);
            const q = searchEl.value.trim();
            if (q.length < 2) { resultsEl.hidden = true; resultsEl.innerHTML = ''; return; }
            debounce = setTimeout(() => searchMembers(q), 250);
        });

        async function loadMods() {
            const { data: mods } = await db
                .from('user_profiles')
                .select('id, full_name, nickname, avatar_url, role')
                .in('role', ['mod', 'owner'])
                .order('role');

            if (!mods || mods.length === 0) {
                listEl.innerHTML = '<p class="st-mods-empty">No moderators yet.</p>';
                return;
            }

            listEl.innerHTML = mods.map(m => modRow(m)).join('');
            listEl.querySelectorAll('[data-demote]').forEach(btn => {
                btn.addEventListener('click', () => demoteMod(btn.dataset.demote, btn.dataset.name));
            });
        }

        function modRow(m) {
            const name     = esc(m.nickname || m.full_name || 'Unnamed');
            const initials = esc((m.full_name || '?').split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase());
            const avatar   = m.avatar_url
                ? `<img class="st-mods-avatar" src="${esc(m.avatar_url)}" alt="">`
                : `<span class="st-mods-avatar st-mods-avatar--initials">${initials}</span>`;
            const badge    = m.role === 'owner'
                ? `<span class="ua-mod-badge ua-mod-badge--owner">Owner</span>`
                : `<span class="ua-mod-badge">Mod</span>`;

            return `
                <div class="st-mods-row">
                    ${avatar}
                    <span class="st-mods-row__name">${name}</span>
                    ${badge}
                    ${m.role === 'mod' ? `
                    <button class="st-mods-row__btn" data-demote="${esc(m.id)}" data-name="${name}">Remove</button>` : ''}
                </div>`;
        }

        async function searchMembers(query) {
            const safeQuery = query.replace(/[,().%*]/g, '');
            const { data: found } = await db
                .from('user_profiles')
                .select('id, full_name, nickname, student_id, avatar_url, role')
                .or(`full_name.ilike.%${safeQuery}%,nickname.ilike.%${safeQuery}%,student_id.ilike.%${safeQuery}%`)
                .limit(8);

            const list = found || [];
            resultsEl.hidden = false;

            if (list.length === 0) {
                resultsEl.innerHTML = '<p class="st-mods-empty">No members found.</p>';
                return;
            }

            resultsEl.innerHTML = list.map(m => {
                const name     = esc(m.nickname || m.full_name || 'Unnamed');
                const initials = esc((m.full_name || '?').split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase());
                const avatar   = m.avatar_url
                    ? `<img class="st-mods-avatar" src="${esc(m.avatar_url)}" alt="">`
                    : `<span class="st-mods-avatar st-mods-avatar--initials">${initials}</span>`;
                const action   = m.role === 'owner'
                    ? `<span class="ua-mod-badge ua-mod-badge--owner">Owner</span>`
                    : m.role === 'mod'
                        ? `<span class="ua-mod-badge">Already a Mod</span>`
                        : `<button class="st-mods-row__btn st-mods-row__btn--promote" data-promote="${esc(m.id)}" data-name="${name}">Make Mod</button>`;

                return `
                    <div class="st-mods-row">
                        ${avatar}
                        <span class="st-mods-row__name">${name}</span>
                        ${action}
                    </div>`;
            }).join('');

            resultsEl.querySelectorAll('[data-promote]').forEach(btn => {
                btn.addEventListener('click', () => promoteMod(btn.dataset.promote, btn.dataset.name));
            });
        }

        async function promoteMod(id, name) {
            if (!confirm(`Make ${name} a moderator? They'll get full mod access across the site.`)) return;
            const { error } = await db.from('user_profiles').update({ role: 'mod' }).eq('id', id);
            if (error) { alert('Failed: ' + error.message); return; }
            searchEl.value  = '';
            resultsEl.hidden = true;
            resultsEl.innerHTML = '';
            await loadMods();
        }

        async function demoteMod(id, name) {
            if (!confirm(`Remove ${name} as a moderator?`)) return;
            const { error } = await db.from('user_profiles').update({ role: null }).eq('id', id);
            if (error) { alert('Failed: ' + error.message); return; }
            await loadMods();
        }
    }

    async function initTags() {
        const listEl   = document.getElementById('st-tags-list');
        const addBtn    = document.getElementById('st-tags-add-btn');
        const form      = document.getElementById('st-tags-form');
        const nameInput = document.getElementById('st-tag-name');
        const colorInput = document.getElementById('st-tag-color');
        const bgColorInput = document.getElementById('st-tag-bgcolor');

        await loadTags();

        addBtn.addEventListener('click', () => {
            form.hidden = false;
            addBtn.hidden = true;
            nameInput.value = '';
            colorInput.value = '#f2c14e';
            bgColorInput.value = '#2a1d05';
            nameInput.focus();
        });

        document.getElementById('st-tag-cancel').addEventListener('click', () => {
            form.hidden = true;
            addBtn.hidden = false;
        });

        document.getElementById('st-tag-save').addEventListener('click', () => createTag());

        async function loadTags() {
            const { data: tags } = await db.from('tags').select('*').order('name');

            if (!tags || tags.length === 0) {
                listEl.innerHTML = '<p class="st-mods-empty">No tags yet.</p>';
                return;
            }

            listEl.innerHTML = tags.map(tagRow).join('');

            listEl.querySelectorAll('[data-visible-toggle]').forEach(input => {
                input.addEventListener('change', () => toggleVisible(input.dataset.visibleToggle, input.checked));
            });
            listEl.querySelectorAll('[data-delete-tag]').forEach(btn => {
                btn.addEventListener('click', () => deleteTag(btn.dataset.deleteTag, btn.dataset.name));
            });
            listEl.querySelectorAll('[data-edit-color]').forEach(input => {
                input.addEventListener('change', () =>
                    updateTagColor(input.dataset.editColor, input.dataset.field, input.value, input));
            });
        }

        function tagRow(t) {
            return `
                <div class="st-mods-row">
                    <span class="pf-tag-badge" style="--tag-color:${esc(t.color)};--tag-bg:${esc(t.bg_color)}">${esc(t.name)}</span>
                    <label class="st-tag-color-label">Text
                        <input class="st-tag-color-input st-tag-color-input--sm" type="color" value="${esc(t.color)}"
                               data-edit-color="${esc(t.id)}" data-field="color">
                    </label>
                    <label class="st-tag-color-label">Bg
                        <input class="st-tag-color-input st-tag-color-input--sm" type="color" value="${esc(t.bg_color)}"
                               data-edit-color="${esc(t.id)}" data-field="bg_color">
                    </label>
                    <label class="st-tag-visible-toggle">
                        <input type="checkbox" data-visible-toggle="${esc(t.id)}" ${t.visible ? 'checked' : ''}>
                        Visible
                    </label>
                    <button class="st-mods-row__btn" data-delete-tag="${esc(t.id)}" data-name="${esc(t.name)}">Delete</button>
                </div>`;
        }

        async function updateTagColor(id, field, value, input) {
            input.disabled = true;
            const { error } = await db.from('tags').update({ [field]: value }).eq('id', id);
            input.disabled = false;
            if (error) { alert('Failed: ' + error.message); return; }
            const badge = input.closest('.st-mods-row').querySelector('.pf-tag-badge');
            if (badge) badge.style.setProperty(field === 'color' ? '--tag-color' : '--tag-bg', value);
        }

        async function createTag() {
            const name     = nameInput.value.trim();
            const color    = colorInput.value;
            const bg_color = bgColorInput.value;
            if (!name) { nameInput.focus(); return; }

            const saveBtn = document.getElementById('st-tag-save');
            saveBtn.disabled = true;

            const { error } = await db.from('tags').insert({ name, color, bg_color });

            saveBtn.disabled = false;
            if (error) { alert('Failed to create tag: ' + error.message); return; }

            form.hidden = true;
            addBtn.hidden = false;
            await loadTags();
        }

        async function toggleVisible(id, visible) {
            const { error } = await db.from('tags').update({ visible }).eq('id', id);
            if (error) { alert('Failed: ' + error.message); await loadTags(); return; }
        }

        async function deleteTag(id, name) {
            if (!confirm(`Delete the "${name}" tag? This removes it from everyone who has it.`)) return;
            const { error } = await db.from('tags').delete().eq('id', id);
            if (error) { alert('Failed: ' + error.message); return; }
            await loadTags();
        }
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
