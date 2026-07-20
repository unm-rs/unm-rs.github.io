(async function () {
    window.initHeroImage?.('committee');

    const grid = document.getElementById('js-committee-grid');
    if (!grid) return;

    const POSITIONS = [
        'President', 'Vice President', 'Secretary', 'Treasurer', 'Event Manager',
        'Head of Technical', 'Head of Public Relations', 'Head of Marketing',
        'Technical Executive', 'Marketing Executive', 'Public Relations Executive',
        'Junior Secretary', 'Junior Events', 'Junior Technical', 'Junior Marketing',
    ];

    function positionOptions(current) {
        const opts = POSITIONS.includes(current) || !current ? POSITIONS : [current, ...POSITIONS];
        return `<option value="" disabled${current ? '' : ' selected'}>Select position…</option>` +
            opts.map(p => `<option value="${esc(p)}"${p === current ? ' selected' : ''}>${esc(p)}</option>`).join('');
    }

    const [{ data: members, error }, { isAdmin, session }] = await Promise.all([
        db.from('committee_members').select('*').order('created_at', { ascending: true }),
        window.roleReady,
    ]);

    document.getElementById('js-committee-loading')?.remove();

    if (error) {
        grid.innerHTML = '<p class="committee-empty">Failed to load committee members.</p>';
        return;
    }

    const list = members || [];
    list.sort((a, b) => {
        const ai = POSITIONS.indexOf(a.position);
        const bi = POSITIONS.indexOf(b.position);
        return (ai === -1 ? POSITIONS.length : ai) - (bi === -1 ? POSITIONS.length : bi);
    });

    // Live profile data for committee members linked to a real account
    let profileMap = {};
    const linkedIds = [...new Set(list.map(m => m.user_id).filter(Boolean))];
    if (linkedIds.length) {
        const { data: profiles } = await db
            .from('user_profiles').select('id, full_name, nickname, avatar_url').in('id', linkedIds);
        if (profiles) profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
    }

    function linkedProfile(member) { return member.user_id ? profileMap[member.user_id] : null; }
    function displayName(member) {
        // Committee is a formal listing — always show the real name, never the nickname
        const p = linkedProfile(member);
        return (p ? p.full_name : member.name) || 'Unnamed';
    }
    function displayPhoto(member) {
        // Committee photo is independent of the profile picture once set
        if (member.image_url) return member.image_url;
        const p = linkedProfile(member);
        return p ? p.avatar_url : null;
    }

    list.forEach(m => grid.appendChild(buildCard(m)));
    if (isAdmin) grid.appendChild(buildAddCard());

    function buildCard(member) {
        const card = document.createElement('article');
        card.className = 'committee-card' + (member.position === 'President' ? ' committee-card--president' : '');
        card.dataset.id = member.id;

        const name  = displayName(member);
        const photo = displayPhoto(member);
        const initials = name.split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
        const profileUrl = member.user_id ? `/profile.html?id=${esc(member.user_id)}` : null;
        const photoTag = profileUrl ? 'a' : 'div';
        const nameTag  = profileUrl ? 'a' : 'p';
        const isOwnCard = !!(member.user_id && session?.user?.id === member.user_id);

        card.innerHTML = `
            <${photoTag} class="committee-card__photo-wrap"${profileUrl ? ` href="${profileUrl}"` : ''}>
                ${photo
                    ? `<img class="committee-card__photo" src="${esc(photo)}" alt="${esc(name)}">`
                    : `<span class="committee-card__initials" aria-hidden="true">${initials}</span>`
                }
                ${isOwnCard && !isAdmin ? `
                    <button type="button" class="committee-card__self-photo-btn" data-self-photo-btn
                            title="Change your photo" aria-label="Change your photo">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                        </svg>
                    </button>
                    <input type="file" class="committee-card__self-photo-input" data-self-photo-input accept="image/*" hidden>`
                    : ''}
            </${photoTag}>
            <div class="committee-card__body">
                <${nameTag} class="committee-card__name"${profileUrl ? ` href="${profileUrl}"` : ''}>${esc(name)}</${nameTag}>
                ${member.position ? `<span class="cm-pos-badge">${esc(member.position)}</span>` : ''}
                ${member.bio ? `<p class="committee-card__bio">${esc(member.bio)}</p>` : ''}
            </div>`;

        if (isOwnCard && !isAdmin) {
            const btn   = card.querySelector('[data-self-photo-btn]');
            const input = card.querySelector('[data-self-photo-input]');
            btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); input.click(); });
            input.addEventListener('click', e => e.stopPropagation());
            input.addEventListener('change', e => {
                e.stopPropagation();
                const file = e.target.files[0];
                if (!file || !validateImageFile(file, e.target)) return;
                uploadSelfPhoto(member, card, file);
            });
        }

        if (isAdmin) {
            const controls = document.createElement('div');
            controls.className = 'committee-card__controls';
            controls.innerHTML = `
                <button class="cm-ctrl cm-ctrl--edit">Edit</button>
                <button class="cm-ctrl cm-ctrl--delete">Delete</button>`;

            controls.querySelector('.cm-ctrl--edit').addEventListener('click', () => enterEditMode(member, card));
            controls.querySelector('.cm-ctrl--delete').addEventListener('click', () => deleteMember(member, card));

            card.appendChild(controls);
        }

        return card;
    }

    async function uploadSelfPhoto(member, card, file) {
        const btn = card.querySelector('[data-self-photo-btn]');
        if (btn) btn.disabled = true;

        const ext  = file.name.split('.').pop().toLowerCase();
        const path = `committee/${member.id}-${Date.now()}.${ext}`;
        const { data: up, error: upErr } = await db.storage
            .from('event-images')
            .upload(path, file, { upsert: true });

        if (upErr) {
            alert('Photo upload failed: ' + upErr.message);
            if (btn) btn.disabled = false;
            return;
        }

        const { data: { publicUrl } } = db.storage.from('event-images').getPublicUrl(up.path);
        const { error: updateErr } = await db
            .from('committee_members').update({ image_url: publicUrl }).eq('id', member.id);

        if (updateErr) {
            alert('Save failed: ' + updateErr.message);
            if (btn) btn.disabled = false;
            return;
        }

        member.image_url = publicUrl;
        card.replaceWith(buildCard(member));
    }

    function buildAddCard() {
        const card = document.createElement('div');
        card.className = 'committee-card committee-card--add';
        card.id = 'js-add-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.innerHTML = `
            <span class="committee-card__add-plus">+</span>
            <span class="committee-card__add-label">Add Member</span>`;

        const activate = () => openMemberPicker();
        card.addEventListener('click', activate);
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });

        return card;
    }

    function openMemberPicker() {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:420px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Add Committee Member</h2>
                    <button class="ab-modal__close" id="cm-pc">✕</button>
                </div>
                <div class="ab-field">
                    <label class="ab-label">Search members</label>
                    <input class="ab-input" id="cm-pick-search" type="text"
                           placeholder="Search by name or student ID…" autocomplete="off">
                </div>
                <div id="cm-pick-results" class="st-mods-results" style="margin-block-start:12px"></div>
            </div>`;

        document.body.appendChild(overlay);
        const searchEl  = overlay.querySelector('#cm-pick-search');
        const resultsEl = overlay.querySelector('#cm-pick-results');
        searchEl.focus();

        const close = () => overlay.remove();
        overlay.querySelector('#cm-pc').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        const alreadyLinked = new Set(list.map(m => m.user_id).filter(Boolean));

        let debounce;
        searchEl.addEventListener('input', () => {
            clearTimeout(debounce);
            const q = searchEl.value.trim();
            if (q.length < 2) { resultsEl.innerHTML = ''; return; }
            debounce = setTimeout(() => search(q), 250);
        });

        async function search(q) {
            const safeQ = q.replace(/[,().%*]/g, '');
            const { data: found } = await db
                .from('user_profiles')
                .select('id, full_name, nickname, student_id, avatar_url')
                .or(`full_name.ilike.%${safeQ}%,nickname.ilike.%${safeQ}%,student_id.ilike.%${safeQ}%`)
                .limit(8);

            const results = (found || []).filter(p => !alreadyLinked.has(p.id));

            if (results.length === 0) {
                resultsEl.innerHTML = '<p class="st-mods-empty">No matching members.</p>';
                return;
            }

            resultsEl.innerHTML = results.map(p => {
                const name     = esc(p.nickname || p.full_name || 'Unnamed');
                const initials = esc((p.full_name || '?').split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase());
                const avatar   = p.avatar_url
                    ? `<img class="st-mods-avatar" src="${esc(p.avatar_url)}" alt="">`
                    : `<span class="st-mods-avatar st-mods-avatar--initials">${initials}</span>`;
                return `
                    <div class="st-mods-row">
                        ${avatar}
                        <span class="st-mods-row__name">${name}</span>
                        <button class="st-mods-row__btn st-mods-row__btn--promote" data-pick="${esc(p.id)}">Select</button>
                    </div>`;
            }).join('');

            resultsEl.querySelectorAll('[data-pick]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const profile = results.find(p => p.id === btn.dataset.pick);
                    close();
                    openMemberDetails(profile);
                });
            });
        }
    }

    function openMemberDetails(profile) {
        const overlay = makeOverlay();
        const name     = profile.nickname || profile.full_name || 'Unnamed';
        const initials = (profile.full_name || '?').split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
        const avatar   = profile.avatar_url
            ? `<img class="st-mods-avatar" style="width:44px;height:44px" src="${esc(profile.avatar_url)}" alt="">`
            : `<span class="st-mods-avatar st-mods-avatar--initials" style="width:44px;height:44px;font-size:15px">${esc(initials)}</span>`;

        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:420px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Add Committee Member</h2>
                    <button class="ab-modal__close" id="cm-dc">✕</button>
                </div>
                <div class="st-mods-row" style="margin-block-end:16px">
                    ${avatar}
                    <span class="st-mods-row__name">${esc(name)}</span>
                </div>
                <form class="ab-form" id="cm-details-form">
                    <div class="ab-field">
                        <label class="ab-label">Position</label>
                        <select class="ab-input" id="cm-d-position" required>${positionOptions('')}</select>
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Bio <span style="font-weight:400;color:hsl(0 0% 50%)">(optional)</span></label>
                        <textarea class="ab-textarea" id="cm-d-bio" rows="3" placeholder="Short bio for the committee page"></textarea>
                    </div>
                    <div id="cm-d-err" class="ab-error" hidden></div>
                    <div class="ab-form-actions">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="cm-d-save">Add to Committee</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('#cm-d-position').focus();

        const close = () => overlay.remove();
        overlay.querySelector('#cm-dc').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        overlay.querySelector('#cm-details-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errEl = overlay.querySelector('#cm-d-err');
            const btn   = overlay.querySelector('#cm-d-save');
            const position = overlay.querySelector('#cm-d-position').value.trim();
            const bio      = overlay.querySelector('#cm-d-bio').value.trim();

            if (!position) return;

            errEl.hidden    = true;
            btn.disabled    = true;
            btn.textContent = 'Adding…';

            const { data: newMember, error: insertErr } = await db
                .from('committee_members')
                .insert({ user_id: profile.id, position, bio: bio || null })
                .select()
                .single();

            if (insertErr) {
                errEl.textContent = insertErr.message;
                errEl.hidden      = false;
                btn.disabled      = false;
                btn.textContent   = 'Add to Committee';
                return;
            }

            list.push(newMember);
            profileMap[profile.id] = profile;
            const addCard = document.getElementById('js-add-card');
            grid.insertBefore(buildCard(newMember), addCard || null);
            close();
        });
    }

    function buildEditableHTML(member) {
        const hasPhoto = !!member.image_url;
        const initials = (member.name || '')
            .split(' ')
            .map(w => w[0] || '')
            .slice(0, 2)
            .join('')
            .toUpperCase();

        return `
            <div class="committee-card__photo-wrap committee-card__photo-wrap--editable ${hasPhoto ? 'has-photo' : ''}" id="ec-photo-wrap">
                ${hasPhoto
                    ? `<img class="committee-card__photo" src="${esc(member.image_url)}" alt="${esc(member.name || '')}">`
                    : (initials ? `<span class="committee-card__initials" aria-hidden="true">${initials}</span>` : '')
                }
                <div class="committee-card__photo-overlay" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                    </svg>
                    <span>${hasPhoto ? 'Change Photo' : 'Add Photo'}</span>
                </div>
                <input type="file" id="ec-img-input" accept="image/*" hidden>
            </div>
            <div class="committee-card__body">
                <div class="committee-card__name committee-card__name--edit"
                     contenteditable="true" data-placeholder="Full Name"
                     role="textbox" aria-label="Full Name">${esc(member.name || '')}</div>
                <select class="cm-pos-select" id="ec-position-select">${positionOptions(member.position || '')}</select>
                <div class="committee-card__bio committee-card__bio--edit"
                     contenteditable="true" data-placeholder="Add a short bio…"
                     role="textbox" aria-label="Bio">${esc(member.bio || '')}</div>
            </div>
            <div class="committee-card__new-actions">
                <button class="cm-new-btn cm-new-btn--save" id="ec-save">Save</button>
                <button class="cm-new-btn cm-new-btn--cancel" id="ec-cancel">Cancel</button>
            </div>`;
    }

    function wirePhoto(card) {
        let pendingFile = null;

        const photoWrap = card.querySelector('#ec-photo-wrap');
        const imgInput  = card.querySelector('#ec-img-input');
        if (!photoWrap || !imgInput) return { getPending: () => null };

        photoWrap.addEventListener('click', () => imgInput.click());

        imgInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file || !validateImageFile(file, e.target)) return;
            pendingFile = file;

            const previewUrl = URL.createObjectURL(file);
            photoWrap.querySelector('.committee-card__photo')?.remove();
            photoWrap.querySelector('.committee-card__initials')?.remove();

            const img = document.createElement('img');
            img.className = 'committee-card__photo';
            img.src = previewUrl;
            img.alt = 'Preview';
            photoWrap.prepend(img);

            photoWrap.classList.add('has-photo');
            const overlayLabel = photoWrap.querySelector('.committee-card__photo-overlay span');
            if (overlayLabel) overlayLabel.textContent = 'Change Photo';
        });

        return { getPending: () => pendingFile };
    }

    function enterEditMode(member, card) {
        card.classList.add('committee-card--new');

        if (member.user_id) {
            // Linked to a real profile — name comes from their account; photo/position/bio are ours to edit
            const name  = displayName(member);
            const photo = displayPhoto(member);
            const hasPhoto = !!photo;
            const initials = name.split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase();

            card.innerHTML = `
                <div class="committee-card__photo-wrap committee-card__photo-wrap--editable ${hasPhoto ? 'has-photo' : ''}" id="ec-photo-wrap">
                    ${hasPhoto
                        ? `<img class="committee-card__photo" src="${esc(photo)}" alt="${esc(name)}">`
                        : (initials ? `<span class="committee-card__initials" aria-hidden="true">${initials}</span>` : '')
                    }
                    <div class="committee-card__photo-overlay" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                        </svg>
                        <span>${hasPhoto ? 'Change Photo' : 'Add Photo'}</span>
                    </div>
                    <input type="file" id="ec-img-input" accept="image/*" hidden>
                </div>
                <div class="committee-card__body">
                    <p class="committee-card__name">${esc(name)}</p>
                    <select class="cm-pos-select" id="ec-position-select">${positionOptions(member.position || '')}</select>
                    <div class="committee-card__bio committee-card__bio--edit"
                         contenteditable="true" data-placeholder="Add a short bio…"
                         role="textbox" aria-label="Bio">${esc(member.bio || '')}</div>
                </div>
                <div class="committee-card__new-actions">
                    <button class="cm-new-btn cm-new-btn--save" id="ec-save">Save</button>
                    <button class="cm-new-btn cm-new-btn--cancel" id="ec-cancel">Cancel</button>
                </div>`;

            const { getPending } = wirePhoto(card);

            card.querySelector('#ec-cancel').addEventListener('click', () => card.replaceWith(buildCard(member)));
            card.querySelector('#ec-save').addEventListener('click', () => saveLinkedEditable(card, member, getPending));
            return;
        }

        // Legacy member (added before profile-linking existed) — full manual editing
        card.innerHTML = buildEditableHTML(member);

        const { getPending } = wirePhoto(card);

        card.querySelector('#ec-cancel').addEventListener('click', () => {
            const fresh = buildCard(member);
            card.replaceWith(fresh);
        });

        card.querySelector('#ec-save').addEventListener('click', () => saveEditable(card, member, getPending));
    }

    async function saveLinkedEditable(card, member, getPending) {
        const position = card.querySelector('#ec-position-select').value;
        const bio      = card.querySelector('.committee-card__bio--edit').textContent.trim();

        if (!position) { card.querySelector('#ec-position-select').focus(); return; }

        const saveBtn = card.querySelector('#ec-save');
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        const payload = { position, bio: bio || null };
        const file = getPending?.();

        if (file) {
            const ext  = file.name.split('.').pop().toLowerCase();
            const path = `committee/${member.id}-${Date.now()}.${ext}`;
            const { data: up, error: upErr } = await db.storage
                .from('event-images')
                .upload(path, file, { upsert: true });

            if (upErr) {
                alert('Image upload failed: ' + upErr.message);
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save';
                return;
            }
            const { data: { publicUrl } } = db.storage.from('event-images').getPublicUrl(up.path);
            payload.image_url = publicUrl;
        }

        const { error: updateErr } = await db.from('committee_members').update(payload).eq('id', member.id);

        if (updateErr) {
            alert('Save failed: ' + updateErr.message);
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save';
            return;
        }

        Object.assign(member, payload);
        card.replaceWith(buildCard(member));
    }

    async function saveEditable(card, member, getPending) {
        const name     = card.querySelector('.committee-card__name--edit').textContent.trim();
        const position = card.querySelector('#ec-position-select').value;
        const bio      = card.querySelector('.committee-card__bio--edit').textContent.trim();

        if (!name) { card.querySelector('.committee-card__name--edit').focus(); return; }
        if (!position) { card.querySelector('#ec-position-select').focus(); return; }

        const saveBtn = card.querySelector('#ec-save');
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        let imageUrl = member?.image_url || null;
        const file = getPending();

        if (file) {
            const ext  = file.name.split('.').pop().toLowerCase();
            const path = `committee/${Date.now()}-${(member?.id || name).toString().replace(/\s+/g, '-')}.${ext}`;
            const { data: up, error: upErr } = await db.storage
                .from('event-images')
                .upload(path, file, { upsert: true });

            if (upErr) {
                alert('Image upload failed: ' + upErr.message);
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save';
                return;
            }
            const { data: { publicUrl } } = db.storage.from('event-images').getPublicUrl(up.path);
            imageUrl = publicUrl;
        }

        const payload = { name, position, bio: bio || null, image_url: imageUrl };

        const { error: updateErr } = await db
            .from('committee_members')
            .update(payload)
            .eq('id', member.id);

        if (updateErr) {
            alert('Save failed: ' + updateErr.message);
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save';
            return;
        }
        Object.assign(member, payload);
        card.replaceWith(buildCard(member));
    }

    async function deleteMember(member, card) {
        if (!confirm(`Remove "${displayName(member)}" from the committee?\n\nThis cannot be undone.`)) return;
        const { error: deleteErr } = await db.from('committee_members').delete().eq('id', member.id);
        if (deleteErr) { alert('Delete failed: ' + deleteErr.message); return; }
        const idx = list.findIndex(m => m.id === member.id);
        if (idx !== -1) list.splice(idx, 1);
        card.remove();
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    function makeOverlay() {
        const el = document.createElement('div');
        el.className = 'ab-overlay';
        return el;
    }

})();
