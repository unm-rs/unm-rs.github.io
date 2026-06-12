// --- DOM refs ---
const viewLogin     = document.getElementById('view-login');
const viewDashboard = document.getElementById('view-dashboard');
const formLogin     = document.getElementById('form-login');
const loginError    = document.getElementById('login-error');
const btnLogin      = document.getElementById('btn-login');
const btnLogout     = document.getElementById('btn-logout');
const eventsList    = document.getElementById('events-list');
const btnAdd        = document.getElementById('btn-add');
const modalOverlay  = document.getElementById('modal-overlay');
const modalHeading  = document.getElementById('modal-heading');
const modalClose    = document.getElementById('modal-close');
const formEvent     = document.getElementById('form-event');
const formError     = document.getElementById('form-error');
const btnCancel     = document.getElementById('btn-cancel');
const btnSave       = document.getElementById('btn-save');
const fId           = document.getElementById('f-id');
const fTitle        = document.getElementById('f-title');
const fSlug         = document.getElementById('f-slug');
const fDate         = document.getElementById('f-date');
const fDesc         = document.getElementById('f-desc');
const fImage        = document.getElementById('f-image');
const imagePreview  = document.getElementById('image-preview');
const previewImg    = document.getElementById('preview-img');
const btnRemoveImg  = document.getElementById('btn-remove-img');

let currentImageUrl = null;

// ---- Auth ----------------------------------------------------------------

async function init() {
    const { data: { session } } = await db.auth.getSession();
    if (session) enterDashboard();
    else enterLogin();
}

function enterLogin() {
    viewLogin.hidden   = false;
    viewDashboard.hidden = true;
}

async function enterDashboard() {
    viewLogin.hidden   = true;
    viewDashboard.hidden = false;
    await loadEvents();
}

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    btnLogin.disabled = true;
    btnLogin.textContent = 'Signing in…';

    const { error } = await db.auth.signInWithPassword({
        email:    document.getElementById('inp-email').value,
        password: document.getElementById('inp-password').value,
    });

    btnLogin.disabled = false;
    btnLogin.textContent = 'Sign in';

    if (error) {
        loginError.textContent = error.message;
        loginError.hidden = false;
    } else {
        enterDashboard();
    }
});

btnLogout.addEventListener('click', async () => {
    await db.auth.signOut();
    enterLogin();
});

// ---- Events list ---------------------------------------------------------

async function loadEvents() {
    eventsList.innerHTML = '<p class="loading">Loading…</p>';

    const { data: events, error } = await db
        .from('events')
        .select('*')
        .order('event_date', { ascending: true });

    if (error) {
        eventsList.innerHTML = `<p class="error-msg">Could not load events: ${error.message}</p>`;
        return;
    }

    if (!events.length) {
        eventsList.innerHTML = '<p class="empty">No events yet — add your first one above.</p>';
        return;
    }

    eventsList.innerHTML = events.map(ev => `
        <div class="event-row">
            <div class="event-row__thumb">
                ${ev.image_url
                    ? `<img src="${ev.image_url}" alt="">`
                    : '<div class="event-row__no-img"></div>'}
            </div>
            <div class="event-row__info">
                <p class="event-row__title">${escHtml(ev.title)}</p>
                <p class="event-row__meta">/event.html?slug=${escHtml(ev.slug)}${ev.event_date ? ' · ' + ev.event_date : ''}</p>
            </div>
            <div class="event-row__actions">
                <button class="btn btn--ghost btn--sm" data-edit="${ev.id}">Edit</button>
                <button class="btn btn--danger btn--sm" data-delete="${ev.id}" data-title="${escAttr(ev.title)}">Delete</button>
            </div>
        </div>
    `).join('');

    eventsList.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => openEdit(btn.dataset.edit));
    });
    eventsList.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => deleteEvent(btn.dataset.delete, btn.dataset.title));
    });
}

// ---- Modal ---------------------------------------------------------------

function openModal(title) {
    modalHeading.textContent = title;
    formError.hidden = true;
    modalOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    fTitle.focus();
}

function closeModal() {
    modalOverlay.hidden = true;
    document.body.style.overflow = '';
    formEvent.reset();
    fId.value = '';
    currentImageUrl = null;
    imagePreview.hidden = true;
}

modalClose.addEventListener('click', closeModal);
btnCancel.addEventListener('click',  closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

btnAdd.addEventListener('click', () => {
    currentImageUrl = null;
    imagePreview.hidden = true;
    openModal('Add Event');
});

async function openEdit(id) {
    const { data: ev, error } = await db.from('events').select('*').eq('id', id).single();
    if (error || !ev) return;

    fId.value    = ev.id;
    fTitle.value = ev.title;
    fSlug.value  = ev.slug;
    fDate.value  = ev.event_date || '';
    fDesc.value  = ev.description || '';
    currentImageUrl = ev.image_url || null;

    if (ev.image_url) {
        previewImg.src      = ev.image_url;
        imagePreview.hidden = false;
    } else {
        imagePreview.hidden = true;
    }

    openModal('Edit Event');
}

// Auto-generate slug from title (only when adding, not editing)
fTitle.addEventListener('input', () => {
    if (fId.value) return;
    fSlug.value = fTitle.value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');
});

fImage.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    previewImg.src      = URL.createObjectURL(file);
    imagePreview.hidden = false;
});

btnRemoveImg.addEventListener('click', () => {
    currentImageUrl = null;
    fImage.value    = '';
    imagePreview.hidden = true;
});

// ---- Save ----------------------------------------------------------------

formEvent.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.hidden = true;

    if (!fTitle.value.trim() || !fSlug.value.trim()) {
        showFormError('Title and slug are required.');
        return;
    }

    btnSave.disabled    = true;
    btnSave.textContent = 'Saving…';

    let imageUrl = currentImageUrl;

    const file = fImage.files[0];
    if (file) {
        const ext  = file.name.split('.').pop().toLowerCase();
        const path = `${Date.now()}-${fSlug.value.trim()}.${ext}`;

        const { data: uploadData, error: uploadErr } = await db.storage
            .from('event-images')
            .upload(path, file, { upsert: true });

        if (uploadErr) {
            showFormError('Image upload failed: ' + uploadErr.message);
            btnSave.disabled    = false;
            btnSave.textContent = 'Save Event';
            return;
        }

        const { data: { publicUrl } } = db.storage
            .from('event-images')
            .getPublicUrl(uploadData.path);

        imageUrl = publicUrl;
    }

    const payload = {
        title:       fTitle.value.trim(),
        slug:        fSlug.value.trim(),
        event_date:  fDate.value  || null,
        description: fDesc.value.trim() || null,
        image_url:   imageUrl,
    };

    const editId = fId.value;
    let error;

    if (editId) {
        ({ error } = await db.from('events').update(payload).eq('id', editId));
    } else {
        ({ error } = await db.from('events').insert(payload));
    }

    btnSave.disabled    = false;
    btnSave.textContent = 'Save Event';

    if (error) {
        showFormError(error.message);
    } else {
        closeModal();
        await loadEvents();
    }
});

function showFormError(msg) {
    formError.textContent = msg;
    formError.hidden      = false;
}

// ---- Delete --------------------------------------------------------------

async function deleteEvent(id, title) {
    if (!confirm(`Delete "${title}"?\n\nThis cannot be undone.`)) return;
    const { error } = await db.from('events').delete().eq('id', id);
    if (error) { alert('Delete failed: ' + error.message); return; }
    await loadEvents();
}

// ---- Helpers -------------------------------------------------------------

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escAttr(str) {
    return String(str).replace(/"/g, '&quot;');
}

// ---- Boot ----------------------------------------------------------------
init();
