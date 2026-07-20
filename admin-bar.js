(async function () {
    if (typeof db === 'undefined') return;

    const { isAdmin } = await window.roleReady;

    if (!isAdmin) return;

    activateAdminMode();

    function activateAdminMode() {
        document.body.style.paddingTop = '44px';
        injectAdminBar();
        injectEventModal();
    }

    function injectAdminBar() {
        const bar = document.createElement('div');
        bar.className = 'ab-bar';
        bar.innerHTML = `
            <div class="ab-bar__inner">
                <span class="ab-bar__label">
                    <span class="ab-bar__dot"></span>
                    <span style="color:hsl(45,95%,55%)">GOD Mode</span>
                </span>
                <div class="ab-bar__actions">
                    <button class="ab-btn ab-btn--add" id="ab-add">Add Event</button>
                    <button class="ab-btn ab-btn--logout" id="ab-logout">Sign Out</button>
                </div>
            </div>`;
        document.body.prepend(bar);

        document.getElementById('ab-add').addEventListener('click', openQuickAdd);
        document.getElementById('ab-logout').addEventListener('click', async () => {
            await db.auth.signOut();
            location.reload();
        });
    }

    function openQuickAdd() {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:360px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">New Event</h2>
                    <button class="ab-modal__close" id="ab-qclose">✕</button>
                </div>
                <form class="ab-form" id="ab-quick-form">
                    <div class="ab-field">
                        <label class="ab-label">Event Title</label>
                        <input class="ab-input" id="ab-qtitle" type="text" placeholder="e.g. Induction Night" required>
                    </div>
                    <div id="ab-qerr" class="ab-error" hidden></div>
                    <div class="ab-form-actions">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="ab-qsubmit">Come to life!</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);
        document.getElementById('ab-qtitle').focus();

        const close = () => overlay.remove();
        document.getElementById('ab-qclose').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        document.getElementById('ab-quick-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const title  = document.getElementById('ab-qtitle').value.trim();
            if (!title) return;
            const slug   = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
            const errEl  = document.getElementById('ab-qerr');
            const submit = document.getElementById('ab-qsubmit');
            errEl.hidden      = true;
            submit.disabled   = true;
            submit.textContent = 'Creating…';

            const { error } = await db.from('events').insert({ title, slug });

            if (error) {
                errEl.textContent  = error.message;
                errEl.hidden       = false;
                submit.disabled    = false;
                submit.textContent = 'Create & Edit';
            } else {
                window.location.href = `/event.html?slug=${encodeURIComponent(slug)}`;
            }
        });
    }

    let _overlay = null;
    let _editId  = null;
    let _currentImageUrl = null;

    function injectEventModal() {
        // Modal is created fresh each time openEventModal() is called
    }

    async function openEventModal(editId) {
        _editId = editId;
        _currentImageUrl = null;

        let prefill = { title: '', slug: '', event_date: '', description: '', image_url: '' };
        if (editId) {
            const { data: ev } = await db.from('events').select('*').eq('id', editId).single();
            if (ev) {
                prefill = ev;
                _currentImageUrl = ev.image_url || null;
            }
        }

        const overlay = makeOverlay();
        _overlay = overlay;
        overlay.innerHTML = `
            <div class="ab-modal">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">${editId ? 'Edit Event' : 'Add Event'}</h2>
                    <button class="ab-modal__close" id="ab-ec">✕</button>
                </div>
                <form class="ab-form" id="ab-event-form" novalidate>
                    <div class="ab-field">
                        <label class="ab-label">Title</label>
                        <input class="ab-input" id="ab-ftitle" type="text" value="${esc(prefill.title)}" placeholder="e.g. Induction Night" required>
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Slug <small>used in the URL — lowercase, hyphens only</small></label>
                        <input class="ab-input" id="ab-fslug" type="text" value="${esc(prefill.slug)}" placeholder="e.g. induction-night" required>
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Date</label>
                        <input class="ab-input" id="ab-fdate" type="date" value="${prefill.event_date || ''}">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Description</label>
                        <textarea class="ab-textarea" id="ab-fdesc" rows="5" placeholder="Describe the event…">${esc(prefill.description || '')}</textarea>
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Banner Image</label>
                        <input type="file" class="ab-file-input" id="ab-fimage" accept="image/*">
                        <div id="ab-imgpreview" class="ab-img-preview" ${_currentImageUrl ? '' : 'hidden'}>
                            <img id="ab-previewimg" src="${_currentImageUrl || ''}" alt="Preview">
                            <button type="button" class="ab-form-btn ab-form-btn--ghost" id="ab-removeimg" style="font-size:13px;padding:5px 12px">Remove image</button>
                        </div>
                    </div>
                    <div id="ab-ferr" class="ab-error" hidden></div>
                    <div class="ab-form-actions">
                        <button type="button" class="ab-form-btn ab-form-btn--ghost" id="ab-fcancel">Cancel</button>
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="ab-fsave">Save Event</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);

        const titleInput = document.getElementById('ab-ftitle');
        const slugInput  = document.getElementById('ab-fslug');
        titleInput.focus();

        document.getElementById('ab-ec').addEventListener('click', closeEventModal);
        document.getElementById('ab-fcancel').addEventListener('click', closeEventModal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEventModal(); });

        if (!editId) {
            titleInput.addEventListener('input', () => {
                slugInput.value = titleInput.value
                    .toLowerCase()
                    .replace(/[^a-z0-9\s-]/g, '')
                    .trim()
                    .replace(/\s+/g, '-');
            });
        }

        document.getElementById('ab-fimage').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            document.getElementById('ab-previewimg').src = URL.createObjectURL(file);
            document.getElementById('ab-imgpreview').hidden = false;
        });

        document.getElementById('ab-removeimg').addEventListener('click', () => {
            _currentImageUrl = null;
            document.getElementById('ab-fimage').value = '';
            document.getElementById('ab-imgpreview').hidden = true;
        });

        document.getElementById('ab-event-form').addEventListener('submit', submitEventForm);
    }

    function closeEventModal() {
        if (_overlay) { _overlay.remove(); _overlay = null; }
        _editId = null;
        _currentImageUrl = null;
    }

    async function submitEventForm(e) {
        e.preventDefault();
        const errEl = document.getElementById('ab-ferr');
        const save  = document.getElementById('ab-fsave');
        errEl.hidden = true;

        const title = document.getElementById('ab-ftitle').value.trim();
        const slug  = document.getElementById('ab-fslug').value.trim();
        if (!title || !slug) {
            errEl.textContent = 'Title and slug are required.';
            errEl.hidden = false;
            return;
        }

        save.disabled    = true;
        save.textContent = 'Saving…';

        let imageUrl = _currentImageUrl;
        const file = document.getElementById('ab-fimage').files[0];

        if (file) {
            const ext  = file.name.split('.').pop().toLowerCase();
            const path = `${Date.now()}-${slug}.${ext}`;
            const { data: up, error: upErr } = await db.storage
                .from('event-images')
                .upload(path, file, { upsert: true });

            if (upErr) {
                errEl.textContent = 'Image upload failed: ' + upErr.message;
                errEl.hidden = false;
                save.disabled    = false;
                save.textContent = 'Save Event';
                return;
            }

            const { data: { publicUrl } } = db.storage
                .from('event-images')
                .getPublicUrl(up.path);
            imageUrl = publicUrl;
        }

        const payload = {
            title,
            slug,
            event_date:  document.getElementById('ab-fdate').value  || null,
            description: document.getElementById('ab-fdesc').value.trim() || null,
            image_url:   imageUrl,
        };

        let error;
        if (_editId) {
            ({ error } = await db.from('events').update(payload).eq('id', _editId));
        } else {
            ({ error } = await db.from('events').insert(payload));
        }

        save.disabled    = false;
        save.textContent = 'Save Event';

        if (error) {
            errEl.textContent = error.message;
            errEl.hidden = false;
        } else {
            closeEventModal();
            if (_editId) {
                location.reload();
            } else {
                window.location.href = `/event.html?slug=${encodeURIComponent(payload.slug)}`;
            }
        }
    }

    function makeOverlay() {
        const el = document.createElement('div');
        el.className = 'ab-overlay';
        return el;
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

})();
