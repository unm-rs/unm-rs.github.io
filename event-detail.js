(async function () {
    const params = new URLSearchParams(window.location.search);
    const slug   = params.get('slug');
    if (!slug) { window.location.href = '/'; return; }

    const [{ data: event }, { data: { session } }] = await Promise.all([
        db.from('events').select('*').eq('slug', slug).single(),
        db.auth.getSession(),
    ]);

    const isAdmin = !!session;

    const titleEl    = document.getElementById('js-title');
    const descEl     = document.getElementById('js-desc');
    const outcomesEl = document.getElementById('js-outcomes');
    const bgEl       = document.getElementById('js-hero-bg');
    const divider    = document.getElementById('js-divider');
    const outBlock   = document.getElementById('js-outcomes-block');

    if (!event) {
        titleEl.textContent = 'Event not found';
        descEl.textContent  = 'This event could not be loaded.';
        return;
    }

    // Populate — desc/outcomes stored as HTML, title as plain text
    document.title      = `${event.title} — UNM Robotics`;
    titleEl.textContent = event.title;
    descEl.innerHTML     = event.description       || '';
    outcomesEl.innerHTML = event.learning_outcomes || '';

    if (event.image_url) {
        bgEl.style.backgroundImage = `url('${event.image_url}')`;
    }

    if (event.learning_outcomes || isAdmin) {
        divider.hidden  = false;
        outBlock.hidden = false;
    }

    // =========================================================
    // APPLICATION FORM  (visible to all users)
    // =========================================================

    const applyHeading = document.getElementById('js-apply-heading');
    if (applyHeading) applyHeading.textContent = `${event.title} Application Form`;

    const applyForm = document.getElementById('js-apply-form');
    if (applyForm) {
        applyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errEl     = document.getElementById('af-error');
            const submitBtn = document.getElementById('af-submit');
            errEl.hidden          = true;
            submitBtn.disabled    = true;
            submitBtn.textContent = 'Submitting…';

            const name   = document.getElementById('af-name').value.trim();
            const sid    = document.getElementById('af-sid').value.trim();
            const owa    = document.getElementById('af-owa').value.trim();
            const year   = document.getElementById('af-year').value;
            const course = document.getElementById('af-course').value.trim();

            if (!name || !sid || !owa || !year || !course) {
                errEl.textContent     = 'Please fill in all fields.';
                errEl.hidden          = false;
                submitBtn.disabled    = false;
                submitBtn.textContent = 'Submit Application';
                return;
            }

            const { error: submitErr } = await db.from('applications').insert({
                event_id:        event.id,
                event_slug:      slug,
                full_name:       name,
                student_id:      sid,
                owa,
                year_of_study:   year,
                course_of_study: course,
            });

            if (submitErr) {
                errEl.textContent     = submitErr.message;
                errEl.hidden          = false;
                submitBtn.disabled    = false;
                submitBtn.textContent = 'Submit Application';
            } else {
                applyForm.hidden                                    = true;
                document.getElementById('af-success').hidden       = false;
            }
        });
    }

    if (!isAdmin) return;

    // =========================================================
    // INLINE EDITING
    // =========================================================

    titleEl.contentEditable    = 'true';
    descEl.contentEditable     = 'true';
    outcomesEl.contentEditable = 'true';

    descEl.dataset.placeholder     = 'Click to add a description…';
    outcomesEl.dataset.placeholder = 'Click to add learning outcomes…';

    document.getElementById('js-img-btn').hidden = false;

    // ---- Formatting toolbar ---------------------------------

    const toolbar = document.createElement('div');
    toolbar.className = 'fmt-toolbar';
    toolbar.innerHTML = `
        <button class="fmt-btn" data-cmd="bold"                 title="Bold (Ctrl+B)"><b>B</b></button>
        <button class="fmt-btn" data-cmd="italic"               title="Italic (Ctrl+I)"><i>I</i></button>
        <button class="fmt-btn" data-cmd="underline"            title="Underline (Ctrl+U)"><u>U</u></button>
        <span class="fmt-sep"></span>
        <button class="fmt-btn" data-cmd="insertUnorderedList"  title="Bullet list">&#8226; List</button>
        <button class="fmt-btn" data-cmd="insertOrderedList"    title="Numbered list">1. List</button>
        <span class="fmt-sep"></span>
        <button class="fmt-btn" data-cmd="removeFormat"         title="Clear formatting">✕ Clear</button>`;
    document.body.appendChild(toolbar);

    let activeField = null;

    function positionToolbar(el) {
        const rect = el.getBoundingClientRect();
        toolbar.style.top  = `${rect.top + window.scrollY - toolbar.offsetHeight - 8}px`;
        toolbar.style.left = `${rect.left + window.scrollX}px`;
        toolbar.hidden = false;
    }

    [descEl, outcomesEl].forEach(el => {
        el.addEventListener('focus', () => { activeField = el; positionToolbar(el); });
        el.addEventListener('blur',  (e) => {
            // Keep toolbar open if focus moves to a toolbar button
            if (!toolbar.contains(e.relatedTarget)) {
                toolbar.hidden = true;
                activeField = null;
            }
        });
        el.addEventListener('keyup', () => { if (activeField === el) positionToolbar(el); });
    });

    toolbar.addEventListener('mousedown', (e) => {
        const btn = e.target.closest('[data-cmd]');
        if (!btn) return;
        e.preventDefault(); // keep focus on contenteditable
        document.execCommand(btn.dataset.cmd, false, null);
        markDirty();
    });

    // ---- Save bar -------------------------------------------

    const saveBar = document.getElementById('js-savebar');
    const saveBtn = document.getElementById('js-savebtn');
    let isDirty        = false;
    let pendingImgFile = null;
    let currentImgUrl  = event.image_url || null;

    function markDirty() {
        if (isDirty) return;
        isDirty = true;
        saveBar.hidden = false;
        document.body.style.paddingBottom = '72px';
    }

    titleEl.addEventListener('input',    markDirty);
    descEl.addEventListener('input',     markDirty);
    outcomesEl.addEventListener('input', markDirty);

    document.getElementById('js-img-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        pendingImgFile = file;
        bgEl.style.backgroundImage = `url('${URL.createObjectURL(file)}')`;
        markDirty();
    });

    titleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') e.preventDefault();
    });

    // ---- Save -----------------------------------------------

    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        if (pendingImgFile) {
            const ext  = pendingImgFile.name.split('.').pop().toLowerCase();
            const path = `${Date.now()}-${slug}.${ext}`;
            const { data: up, error: upErr } = await db.storage
                .from('event-images')
                .upload(path, pendingImgFile, { upsert: true });

            if (upErr) {
                alert('Image upload failed: ' + upErr.message);
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save Changes';
                return;
            }

            const { data: { publicUrl } } = db.storage
                .from('event-images')
                .getPublicUrl(up.path);
            currentImgUrl  = publicUrl;
            pendingImgFile = null;
        }

        const { error } = await db.from('events').update({
            title:             titleEl.textContent.trim(),
            description:       descEl.innerHTML.trim()     || null,
            learning_outcomes: outcomesEl.innerHTML.trim() || null,
            image_url:         currentImgUrl,
        }).eq('id', event.id);

        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Changes';

        if (error) {
            alert('Save failed: ' + error.message);
        } else {
            isDirty = false;
            saveBar.querySelector('.edit-savebar__msg').textContent = 'Saved ✓';
            document.title = `${titleEl.textContent.trim()} — UNM Robotics`;
            setTimeout(() => {
                saveBar.hidden = true;
                saveBar.querySelector('.edit-savebar__msg').textContent = 'Unsaved changes';
                document.body.style.paddingBottom = '';
                isDirty = false;
            }, 2000);
        }
    });

})();
