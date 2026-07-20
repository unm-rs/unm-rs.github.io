(async function () {
    if (typeof db === 'undefined') return;

    const { session, isOwner } = await window.roleReady;

    const urlParams  = new URLSearchParams(window.location.search);
    const viewUserId = urlParams.get('id');

    if (viewUserId) {
        if (session && viewUserId === session.user.id) {
            window.history.replaceState({}, '', '/profile.html');
        } else {
            await renderPublicProfile(viewUserId, isOwner);
            return;
        }
    }

    if (!session) {
        window.location.href = '/';
        return;
    }

    const root = document.getElementById('js-profile-root');

    let profile = {};
    const { data: p } = await db
        .from('user_profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
    if (p) profile = p;

    const { data: committeeRow } = await db
        .from('committee_members').select('position').eq('user_id', session.user.id).maybeSingle();
    const committeePosition = committeeRow?.position || null;

    const { data: myThreads } = await db
        .from('forum_threads')
        .select('id, title, status, created_at, view_count, reply_count, forum_categories(name)')
        .eq('author_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(10);
    const threads = myThreads || [];
    const threadLikeMap = await fetchThreadLikeCounts(threads);

    let myTags = await fetchUserTags(session.user.id);

    document.title = `${profile.full_name || 'My Profile'}`;

    let isEditing    = false;
    let pendingAvatar = null;
    let pendingBanner = null;

    render();

    function render() {
        const name     = profile.full_name || '';
        const initials = getInitials(name || session.user.email);

        root.innerHTML = `
            <!-- Banner -->
            <div class="pf-banner" id="pf-banner">
                ${profile.banner_url
                    ? `<img class="pf-banner__img" id="pf-banner-img" src="${esc(profile.banner_url)}" alt="">`
                    : `<div class="pf-banner__placeholder" id="pf-banner-img"></div>`}
                ${isEditing ? `
                    <label class="pf-banner__edit-btn" for="pf-banner-input" tabindex="0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                        </svg>
                        Change Banner
                        <input type="file" id="pf-banner-input" accept="image/*" hidden>
                    </label>` : ''}
            </div>

            <!-- Avatar row -->
            <div class="pf-meta-row">
                <div class="pf-avatar-wrap${isEditing ? ' pf-avatar-wrap--edit' : ''}">
                    ${profile.avatar_url
                        ? `<img class="pf-avatar" id="pf-avatar-img" src="${esc(profile.avatar_url)}" alt="${esc(name)}">`
                        : `<div class="pf-avatar pf-avatar--initials" id="pf-avatar-img" aria-hidden="true">${initials}</div>`}
                    ${isEditing ? `
                        <label class="pf-avatar__overlay" for="pf-avatar-input" tabindex="0">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                                <circle cx="12" cy="13" r="4"/>
                            </svg>
                            <input type="file" id="pf-avatar-input" accept="image/*" hidden>
                        </label>` : ''}
                </div>
                <div class="pf-meta-actions">
                    ${isEditing ? `
                        <button class="pf-btn pf-btn--cancel" id="pf-cancel">Cancel</button>
                        <button class="pf-btn pf-btn--save"   id="pf-save">Save</button>` :
                        `<button class="pf-btn pf-btn--edit"  id="pf-edit">Edit Profile</button>`}
                </div>
            </div>

            <!-- Identity -->
            <div class="pf-identity">
                ${isEditing
                    ? `<input class="pf-name-input" id="pf-name" type="text"
                              value="${esc(name)}" placeholder="Your full name">
                       <input class="pf-nickname-input" id="pf-nickname" type="text"
                              value="${esc(profile.nickname || '')}" placeholder="Nickname (optional)">`
                    : `<h1 class="pf-name">${esc(profile.nickname || name || 'No name set')}
                       ${roleBadge(profile.role)}
                       ${committeePosition ? `<span class="cm-pos-badge">${esc(committeePosition)}</span>` : ''}
                       ${tagBadges(myTags)}
                       ${isOwner ? `<button type="button" class="pf-tag-add-btn" id="pf-tag-add-btn" title="Manage tags" aria-label="Manage tags">+</button>` : ''}</h1>
                       ${name && profile.nickname ? `<p class="pf-nickname-display">${esc(name)}</p>` : ''}`}
                ${(profile.course_of_study || profile.year_of_study) && !isEditing
                    ? `<p class="pf-submeta">${[profile.course_of_study, profile.year_of_study].filter(Boolean).map(esc).join(' &middot; ')}</p>`
                    : ''}
                ${isEditing
                    ? `<label class="pf-bio-label">Bio</label>
                       <textarea class="pf-bio-input" id="pf-bio"
                                 placeholder="Tell us about yourself…" rows="3">${esc(profile.bio || '')}</textarea>`
                    : (profile.bio
                        ? `<p class="pf-bio">${esc(profile.bio)}</p>`
                        : `<p class="pf-bio pf-bio--empty">No bio yet.</p>`)}
                <div id="pf-save-err" class="pf-error" hidden></div>
            </div>

            ${buildThreadsSection(threads, { showStatus: true, likeMap: threadLikeMap })}

            <!-- Profile details -->
            <section class="pf-section">
                <h2 class="pf-section__title">Profile Details</h2>
                ${isEditing ? `
                    <div class="pf-fields">
                        <div class="pf-field">
                            <label class="pf-field__label" for="pf-sid">Student ID</label>
                            <input class="pf-field__input" id="pf-sid" type="text"
                                   value="${esc(profile.student_id || '')}" placeholder="e.g. 20123456">
                        </div>
                        <div class="pf-field">
                            <label class="pf-field__label" for="pf-owa">OWA Email</label>
                            <input class="pf-field__input" id="pf-owa" type="email"
                                   value="${esc(profile.owa || '')}" placeholder="yourOWA@nottingham.edu.my">
                        </div>
                        <div class="pf-field">
                            <label class="pf-field__label" for="pf-year">Year of Study</label>
                            <select class="pf-field__input" id="pf-year">
                                <option value="">Select year…</option>
                                ${['Foundation Year','Year 1','Year 2','Year 3','Year 4','Postgraduate'].map(y =>
                                    `<option${profile.year_of_study === y ? ' selected' : ''}>${y}</option>`
                                ).join('')}
                            </select>
                        </div>
                        <div class="pf-field">
                            <label class="pf-field__label" for="pf-course">Course of Study</label>
                            <input class="pf-field__input" id="pf-course" type="text"
                                   value="${esc(profile.course_of_study || '')}"
                                   placeholder="e.g. Bachelor of Computer Science">
                        </div>
                    </div>` : `
                    <dl class="pf-detail-grid">
                        ${detailRow('Student ID',   profile.student_id)}
                        ${detailRow('OWA Email',    profile.owa)}
                        ${detailRow('Year',         profile.year_of_study)}
                        ${detailRow('Course',       profile.course_of_study)}
                    </dl>
                    ${!profile.student_id && !profile.owa ? `<p class="pf-detail-empty">No details added yet.</p>` : ''}`}
            </section>

            `;

        wireEvents();
    }

    function wireEvents() {
        document.getElementById('pf-edit')?.addEventListener('click', () => {
            isEditing     = true;
            pendingAvatar = null;
            pendingBanner = null;
            render();
        });

        document.getElementById('pf-cancel')?.addEventListener('click', () => {
            isEditing = false;
            render();
        });

        document.getElementById('pf-save')?.addEventListener('click', saveProfile);

        document.getElementById('pf-tag-add-btn')?.addEventListener('click', () => {
            openTagPicker(session.user.id, myTags, async () => {
                myTags = await fetchUserTags(session.user.id);
                render();
            });
        });

        document.getElementById('pf-avatar-input')?.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file || !validateImageFile(file, e.target)) return;
            pendingAvatar = file;
            swapImagePreview('pf-avatar-img', file, 'pf-avatar');
        });

        document.getElementById('pf-banner-input')?.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file || !validateImageFile(file, e.target)) return;
            pendingBanner = file;
            swapImagePreview('pf-banner-img', file, 'pf-banner__img');
        });
    }

    function swapImagePreview(elId, file, imgClass) {
        const el  = document.getElementById(elId);
        const url = URL.createObjectURL(file);
        if (el.tagName === 'IMG') {
            el.src = url;
        } else {
            const img = document.createElement('img');
            img.className = imgClass;
            img.id        = elId;
            img.src       = url;
            el.replaceWith(img);
        }
    }

    async function saveProfile() {
        const saveBtn = document.getElementById('pf-save');
        const errEl   = document.getElementById('pf-save-err');
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';
        errEl.hidden        = true;

        let avatarUrl = profile.avatar_url || null;
        let bannerUrl = profile.banner_url || null;
        const oldAvatarUrl = profile.avatar_url || null;
        const oldBannerUrl = profile.banner_url || null;

        if (pendingAvatar) {
            const result = await uploadFile(pendingAvatar, `avatars/${session.user.id}`);
            if (result.error) { showErr(errEl, 'Photo upload failed: ' + result.error, saveBtn); return; }
            avatarUrl = result.url;
        }

        if (pendingBanner) {
            const result = await uploadFile(pendingBanner, `banners/${session.user.id}`);
            if (result.error) { showErr(errEl, 'Banner upload failed: ' + result.error, saveBtn); return; }
            bannerUrl = result.url;
        }

        const updates = {
            id:              session.user.id,
            full_name:       document.getElementById('pf-name')?.value.trim()     || null,
            nickname:        document.getElementById('pf-nickname')?.value.trim() || null,
            bio:             document.getElementById('pf-bio')?.value.trim()      || null,
            student_id:      document.getElementById('pf-sid')?.value.trim()      || null,
            owa:             document.getElementById('pf-owa')?.value.trim()      || null,
            year_of_study:   document.getElementById('pf-year')?.value            || null,
            course_of_study: document.getElementById('pf-course')?.value.trim()   || null,
            avatar_url:      avatarUrl,
            banner_url:      bannerUrl,
        };

        const { error } = await db.from('user_profiles').upsert(updates);

        if (error) {
            showErr(errEl, error.message, saveBtn);
            return;
        }

        // Keep forum posts in sync when avatar changes
        if (pendingAvatar && avatarUrl) {
            await Promise.all([
                db.from('forum_threads').update({ author_avatar: avatarUrl }).eq('author_id', session.user.id),
                db.from('forum_replies').update({ author_avatar: avatarUrl }).eq('author_id', session.user.id),
            ]);
        }

        if (pendingAvatar && oldAvatarUrl) deleteStorageFile(oldAvatarUrl);
        if (pendingBanner && oldBannerUrl) deleteStorageFile(oldBannerUrl);

        profile       = { ...profile, ...updates };
        isEditing     = false;
        pendingAvatar = null;
        pendingBanner = null;
        document.title = `${profile.full_name || 'My Profile'}`;
        render();
    }

    async function deleteStorageFile(publicUrl) {
        const marker = '/event-images/';
        const idx = publicUrl.indexOf(marker);
        if (idx === -1) return;
        const path = decodeURIComponent(publicUrl.slice(idx + marker.length));
        const { error } = await db.storage.from('event-images').remove([path]);
        if (error) console.error('Failed to clean up old image:', error.message);
    }

    const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    function validateImageFile(file, inputEl) {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            alert('Please choose a PNG, JPEG, WEBP, or GIF image.');
            inputEl.value = '';
            return false;
        }
        if (file.size > MAX_IMAGE_BYTES) {
            alert('Image must be under 5MB.');
            inputEl.value = '';
            return false;
        }
        return true;
    }

    async function uploadFile(file, pathPrefix) {
        const ext  = file.name.split('.').pop().toLowerCase();
        const path = `${pathPrefix}_${Date.now()}.${ext}`;
        const { data: up, error } = await db.storage
            .from('event-images')
            .upload(path, file, { upsert: true });
        if (error) return { error: error.message };
        const { data: { publicUrl } } = db.storage.from('event-images').getPublicUrl(up.path);
        return { url: publicUrl };
    }

    function showErr(errEl, msg, saveBtn) {
        errEl.textContent    = msg;
        errEl.hidden         = false;
        saveBtn.disabled     = false;
        saveBtn.textContent  = 'Save';
    }

    function detailRow(label, value) {
        if (!value) return '';
        return `
            <div class="pf-detail">
                <dt class="pf-detail__label">${label}</dt>
                <dd class="pf-detail__value">${esc(value)}</dd>
            </div>`;
    }

    function getInitials(str) {
        return str.split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
    }

    function makeOverlay() {
        const el = document.createElement('div');
        el.className = 'ab-overlay';
        return el;
    }

    async function renderPublicProfile(userId, isOwner) {
        const root = document.getElementById('js-profile-root');

        root.innerHTML = `<p style="padding:40px 24px;color:hsl(0,0%,50%)">Loading…</p>`;

        const { data: p } = await db
            .from('user_profiles')
            .select('full_name, avatar_url, banner_url, bio, owa, course_of_study, year_of_study, role')
            .eq('id', userId)
            .single();

        if (!p) {
            root.innerHTML = `<p style="padding:40px 24px;color:hsl(0,0%,50%)">Profile not found.</p>`;
            return;
        }

        const { data: committeeRow } = await db
            .from('committee_members').select('position').eq('user_id', userId).maybeSingle();
        const committeePosition = committeeRow?.position || null;

        const { data: theirThreads } = await db
            .from('forum_threads')
            .select('id, title, status, created_at, view_count, reply_count, forum_categories(name)')
            .eq('author_id', userId)
            .eq('status', 'approved')
            .order('created_at', { ascending: false })
            .limit(10);
        const threads = theirThreads || [];
        const threadLikeMap = await fetchThreadLikeCounts(threads);
        let theirTags = await fetchUserTags(userId);

        document.title = `${p.full_name || 'Profile'} — UNM Robotics`;

        const name     = p.full_name || '';
        const initials = getInitials(name || '?');

        root.innerHTML = `
            <div class="pf-banner">
                ${p.banner_url
                    ? `<img class="pf-banner__img" src="${esc(p.banner_url)}" alt="">`
                    : `<div class="pf-banner__placeholder"></div>`}
            </div>

            <div class="pf-meta-row">
                <div class="pf-avatar-wrap">
                    ${p.avatar_url
                        ? `<img class="pf-avatar" src="${esc(p.avatar_url)}" alt="${esc(name)}">`
                        : `<div class="pf-avatar pf-avatar--initials" aria-hidden="true">${initials}</div>`}
                </div>
            </div>

            <div class="pf-identity">
                <h1 class="pf-name">${esc(name || 'No name set')}
                ${roleBadge(p.role)}
                ${committeePosition ? `<span class="cm-pos-badge">${esc(committeePosition)}</span>` : ''}
                ${tagBadges(theirTags)}
                ${isOwner ? `<button type="button" class="pf-tag-add-btn" id="pf-tag-add-btn" title="Manage tags" aria-label="Manage tags">+</button>` : ''}</h1>
                ${(p.course_of_study || p.year_of_study)
                    ? `<p class="pf-submeta">${[p.course_of_study, p.year_of_study].filter(Boolean).map(esc).join(' &middot; ')}</p>`
                    : ''}
                ${p.bio ? `<p class="pf-bio">${esc(p.bio)}</p>` : ''}
            </div>

            ${buildThreadsSection(threads, { showStatus: false, likeMap: threadLikeMap })}

            <section class="pf-section">
                <h2 class="pf-section__title">Profile Details</h2>
                <dl class="pf-detail-grid">
                    ${detailRow('OWA Email', p.owa)}
                    ${detailRow('Year',      p.year_of_study)}
                    ${detailRow('Course',    p.course_of_study)}
                </dl>
                ${!p.owa && !p.year_of_study && !p.course_of_study ? `<p class="pf-detail-empty">No details added yet.</p>` : ''}
            </section>`;

        document.getElementById('pf-tag-add-btn')?.addEventListener('click', () => {
            openTagPicker(userId, theirTags, async () => {
                theirTags = await fetchUserTags(userId);
                renderPublicProfile(userId, isOwner);
            });
        });
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function roleBadge(role) {
        if (role === 'owner') return `<span class="ua-mod-badge ua-mod-badge--owner">Owner</span>`;
        if (role === 'mod')   return `<span class="ua-mod-badge">Mod</span>`;
        return '';
    }

    async function fetchUserTags(userId) {
        const { data } = await db
            .from('user_tags')
            .select('tags(id, name, color, visible)')
            .eq('user_id', userId);
        return (data || []).map(r => r.tags).filter(t => t && t.visible);
    }

    function tagBadges(tags) {
        return (tags || [])
            .map(t => `<span class="pf-tag-badge" style="--tag-color:${esc(t.color)}">${esc(t.name)}</span>`)
            .join('');
    }

    async function openTagPicker(userId, _currentTags, onChange) {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:360px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Manage Tags</h2>
                    <button class="ab-modal__close" id="tp-close">✕</button>
                </div>
                <div id="tp-list" class="st-mods-list">Loading…</div>
            </div>`;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('#tp-close').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        const listEl = overlay.querySelector('#tp-list');

        const [{ data: allTags }, { data: assignedRows }] = await Promise.all([
            db.from('tags').select('*').order('name'),
            db.from('user_tags').select('tag_id').eq('user_id', userId),
        ]);

        if (!allTags || allTags.length === 0) {
            listEl.innerHTML = `<p class="st-mods-empty">No tags yet.</p>`;
            return;
        }

        const assignedIds = new Set((assignedRows || []).map(r => r.tag_id));

        listEl.innerHTML = allTags.map(t => `
            <label class="st-mods-row pf-tag-picker-row">
                <span class="st-tag-swatch" style="background:${esc(t.color)}"></span>
                <span class="st-mods-row__name">${esc(t.name)}${t.visible ? '' : ' (hidden)'}</span>
                <input type="checkbox" data-tag-id="${esc(t.id)}" ${assignedIds.has(t.id) ? 'checked' : ''}>
            </label>`).join('');

        listEl.querySelectorAll('[data-tag-id]').forEach(input => {
            input.addEventListener('change', async () => {
                input.disabled = true;
                if (input.checked) {
                    const { error } = await db.from('user_tags').insert({ user_id: userId, tag_id: input.dataset.tagId });
                    if (error) { alert('Failed: ' + error.message); input.checked = false; }
                } else {
                    const { error } = await db
                        .from('user_tags').delete().eq('user_id', userId).eq('tag_id', input.dataset.tagId);
                    if (error) { alert('Failed: ' + error.message); input.checked = true; }
                }
                input.disabled = false;
                onChange?.();
            });
        });
    }

    async function fetchThreadLikeCounts(threads) {
        const map = {};
        if (!threads.length) return map;
        const { data: likes } = await db
            .from('forum_likes').select('target_id')
            .eq('target_type', 'thread').in('target_id', threads.map(t => t.id));
        (likes || []).forEach(l => { map[l.target_id] = (map[l.target_id] || 0) + 1; });
        return map;
    }

    function buildThreadsSection(threads, { showStatus, likeMap }) {
        return `
            <section class="pf-section">
                <h2 class="pf-section__title">Threads</h2>
                ${threads.length ? `
                <div class="pf-threads-list">
                    ${threads.map(t => {
                        const isPending = showStatus && t.status !== 'approved';
                        return `
                        <a href="/thread.html?id=${esc(t.id)}" class="pf-thread-row">
                            <div class="pf-thread-row__main">
                                <span class="pf-thread-row__title">${esc(t.title)}</span>
                                <span class="pf-thread-row__meta">
                                    ${t.forum_categories ? esc(t.forum_categories.name) + ' · ' : ''}${relativeTime(t.created_at)}
                                </span>
                            </div>
                            ${isPending
                                ? `<span class="ap-status ap-status--${esc(t.status)}">${esc(t.status)}</span>`
                                : `<div class="fr-thread-stats">
                                       <span class="fr-thread-stat"><strong>${t.view_count ?? 0}</strong> views</span>
                                       <span class="fr-thread-stat"><strong>${likeMap[t.id] || 0}</strong> likes</span>
                                       <span class="fr-thread-stat"><strong>${t.reply_count ?? 0}</strong> replies</span>
                                   </div>`}
                        </a>`;
                    }).join('')}
                </div>` : `<p class="pf-detail-empty">No threads yet.</p>`}
            </section>`;
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

})();
