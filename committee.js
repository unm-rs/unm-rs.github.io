(async function () {
    const grid = document.getElementById('js-committee-grid');
    if (!grid) return;

    const [{ data: members, error }, { data: { session } }] = await Promise.all([
        db.from('committee_members').select('*').order('created_at', { ascending: true }),
        db.auth.getSession(),
    ]);

    const isAdmin = !!session;

    document.getElementById('js-committee-loading')?.remove();

    if (error) {
        grid.innerHTML = '<p class="committee-empty">Failed to load committee members.</p>';
        return;
    }

    const list = members || [];

    list.forEach(m => grid.appendChild(buildCard(m)));
    if (isAdmin) grid.appendChild(buildAddCard());

    // =========================================================
    // VIEW CARD
    // =========================================================

    function buildCard(member) {
        const card = document.createElement('article');
        card.className = 'committee-card';
        card.dataset.id = member.id;

        const initials = member.name
            .split(' ')
            .map(w => w[0] || '')
            .slice(0, 2)
            .join('')
            .toUpperCase();

        card.innerHTML = `
            <div class="committee-card__photo-wrap">
                ${member.image_url
                    ? `<img class="committee-card__photo" src="${esc(member.image_url)}" alt="${esc(member.name)}">`
                    : `<span class="committee-card__initials" aria-hidden="true">${initials}</span>`
                }
            </div>
            <div class="committee-card__body">
                <p class="committee-card__name">${esc(member.name)}</p>
                <p class="committee-card__role">${esc(member.position)}</p>
                ${member.bio ? `<p class="committee-card__bio">${esc(member.bio)}</p>` : ''}
            </div>`;

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

    // =========================================================
    // ADD CARD
    // =========================================================

    function buildAddCard() {
        const card = document.createElement('div');
        card.className = 'committee-card committee-card--add';
        card.id = 'js-add-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.innerHTML = `
            <span class="committee-card__add-plus">+</span>
            <span class="committee-card__add-label">Add Member</span>`;

        const activate = () => openInlineAdd(card);
        card.addEventListener('click', activate);
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });

        return card;
    }

    // =========================================================
    // SHARED: editable card HTML + photo wiring
    // =========================================================

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
                <div class="committee-card__role committee-card__role--edit"
                     contenteditable="true" data-placeholder="Position / Role"
                     role="textbox" aria-label="Position">${esc(member.position || '')}</div>
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
            if (!file) return;
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

    // =========================================================
    // INLINE ADD
    // =========================================================

    function openInlineAdd(addCard) {
        const blank = document.createElement('article');
        blank.className = 'committee-card committee-card--new';
        blank.innerHTML = buildEditableHTML({});
        grid.insertBefore(blank, addCard);

        const { getPending } = wirePhoto(blank);

        blank.querySelector('#ec-cancel').addEventListener('click', () => blank.remove());
        blank.querySelector('#ec-save').addEventListener('click', () => saveEditable(blank, null, getPending));
        blank.querySelector('.committee-card__name--edit').focus();
    }

    // =========================================================
    // INLINE EDIT  (no modal — card transforms in place)
    // =========================================================

    function enterEditMode(member, card) {
        card.classList.add('committee-card--new');
        card.innerHTML = buildEditableHTML(member);

        const { getPending } = wirePhoto(card);

        card.querySelector('#ec-cancel').addEventListener('click', () => {
            const fresh = buildCard(member);
            card.replaceWith(fresh);
        });

        card.querySelector('#ec-save').addEventListener('click', () => saveEditable(card, member, getPending));
    }

    // =========================================================
    // SHARED SAVE
    // =========================================================

    async function saveEditable(card, member, getPending) {
        const name     = card.querySelector('.committee-card__name--edit').textContent.trim();
        const position = card.querySelector('.committee-card__role--edit').textContent.trim();
        const bio      = card.querySelector('.committee-card__bio--edit').textContent.trim();

        if (!name) { card.querySelector('.committee-card__name--edit').focus(); return; }
        if (!position) { card.querySelector('.committee-card__role--edit').focus(); return; }

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

        if (member) {
            // Update existing
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
        } else {
            // Insert new
            const { data: newMember, error: insertErr } = await db
                .from('committee_members')
                .insert(payload)
                .select()
                .single();

            if (insertErr) {
                alert('Save failed: ' + insertErr.message);
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save';
                return;
            }
            list.push(newMember);
            const addCard = document.getElementById('js-add-card');
            grid.insertBefore(buildCard(newMember), addCard || null);
            card.remove();
        }
    }

    // =========================================================
    // DELETE
    // =========================================================

    async function deleteMember(member, card) {
        if (!confirm(`Remove "${member.name}" from the committee?\n\nThis cannot be undone.`)) return;
        const { error: deleteErr } = await db.from('committee_members').delete().eq('id', member.id);
        if (deleteErr) { alert('Delete failed: ' + deleteErr.message); return; }
        const idx = list.findIndex(m => m.id === member.id);
        if (idx !== -1) list.splice(idx, 1);
        card.remove();
    }

    // =========================================================
    // HELPERS
    // =========================================================

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

})();
