(async function () {
    const params = new URLSearchParams(window.location.search);
    const slug   = params.get('slug');
    if (!slug) { window.location.href = '/'; return; }

    const [{ data: event }, { session, isAdmin }] = await Promise.all([
        db.from('events').select('*').eq('slug', slug).single(),
        window.roleReady,
    ]);

    const isLoggedIn = !!session && !isAdmin;

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

    document.title      = `${event.title}`;
    titleEl.textContent = event.title;
    descEl.innerHTML     = sanitizeHtml(event.description       || '');
    outcomesEl.innerHTML = sanitizeHtml(event.learning_outcomes || '');

    if (event.image_url) bgEl.style.backgroundImage = `url('${event.image_url.replace(/'/g, '%27')}')`;

    const datetimeEl     = document.getElementById('js-datetime');
    const dateLabelEl    = document.getElementById('js-date-label');
    const endDateBlockEl = document.getElementById('js-enddate-block');
    let typeValueEl    = document.getElementById('js-type-value');
    let dateValueEl     = document.getElementById('js-date-value');
    let endDateValueEl  = document.getElementById('js-enddate-value');
    let timeValueEl     = document.getElementById('js-time-value');
    let endTimeValueEl  = document.getElementById('js-endtime-value');

    const TYPE_LABELS = {
        'single-day': 'Single Day',
        'multi-day':  'Multi-Day',
        'weekly':     'Weekly',
        'competition': 'Competition',
    };

    const DATE_KINDS = { date: 'currentEventDate', enddate: 'currentEventEndDate' };
    const TIME_KINDS = { time: 'currentEventTime', endtime: 'currentEventEndTime' };

    let currentEventType     = event.event_type || 'single-day';
    let currentEventDate     = event.event_date || '';
    let currentEventEndDate  = event.event_end_date || '';
    let currentEventTime     = event.event_time || '';
    let currentEventEndTime  = event.event_end_time || '';

    function formatDateDisplay(d) {
        return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBC';
    }
    function formatTime(t) {
        const [h, m] = t.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        const h12    = h % 12 === 0 ? 12 : h % 12;
        return `${h12}:${String(m).padStart(2, '0')} ${period}`;
    }
    function formatTimeDisplay(t) { return t ? formatTime(t) : 'TBC'; }

    function valueFor(kind) {
        if (kind === 'type')    return currentEventType;
        if (kind in DATE_KINDS) return kind === 'date' ? currentEventDate : currentEventEndDate;
        return kind === 'time' ? currentEventTime : currentEventEndTime;
    }
    function displayFor(kind) {
        if (kind === 'type')    return TYPE_LABELS[currentEventType] || TYPE_LABELS['single-day'];
        if (kind in DATE_KINDS) return formatDateDisplay(valueFor(kind));
        return formatTimeDisplay(valueFor(kind));
    }
    function elFor(kind) {
        if (kind === 'type')    return typeValueEl;
        if (kind === 'date')    return dateValueEl;
        if (kind === 'enddate') return endDateValueEl;
        if (kind === 'time')    return timeValueEl;
        return endTimeValueEl;
    }
    function setEl(kind, span) {
        if (kind === 'type')    typeValueEl    = span;
        if (kind === 'date')    dateValueEl    = span;
        if (kind === 'enddate') endDateValueEl = span;
        if (kind === 'time')    timeValueEl    = span;
        if (kind === 'endtime') endTimeValueEl = span;
    }

    function updateForType() {
        const isRange = currentEventType !== 'single-day';
        if (dateLabelEl) dateLabelEl.textContent = isRange ? 'Starting Date' : 'Date';
        if (endDateBlockEl) endDateBlockEl.hidden = !isRange;
    }

    if (datetimeEl) {
        if (isAdmin || currentEventDate || currentEventTime) datetimeEl.hidden = false;

        ['type', 'date', 'enddate', 'time', 'endtime'].forEach(kind => {
            elFor(kind).textContent = displayFor(kind);
        });
        updateForType();

        if (isAdmin) {
            ['type', 'date', 'enddate', 'time', 'endtime'].forEach(kind => {
                const el = elFor(kind);
                el.classList.add('event-hero__dt-value--editable');
                el.title = `Click to change ${kind}`;
                el.addEventListener('click', () => editField(kind));
            });
        }
    }

    function editField(kind) {
        const el = elFor(kind);
        let input;

        if (kind === 'type') {
            input = document.createElement('select');
            input.className = 'event-hero__dt-input';
            input.innerHTML = Object.entries(TYPE_LABELS)
                .map(([val, label]) => `<option value="${val}"${val === currentEventType ? ' selected' : ''}>${label}</option>`)
                .join('');
        } else {
            input = document.createElement('input');
            input.type  = kind in DATE_KINDS ? 'date' : 'time';
            input.value = valueFor(kind);
            input.className = 'event-hero__dt-input';
        }
        input.id = el.id;
        el.replaceWith(input);
        input.focus();
        if (input.showPicker) { try { input.showPicker(); } catch {} }

        let committed = false;
        const commit = () => {
            if (committed) return;
            committed = true;

            if (kind === 'type')     currentEventType    = input.value;
            if (kind === 'date')     currentEventDate    = input.value;
            if (kind === 'enddate')  currentEventEndDate = input.value;
            if (kind === 'time')     currentEventTime    = input.value;
            if (kind === 'endtime')  currentEventEndTime = input.value;

            const span = document.createElement('span');
            span.className = 'event-hero__dt-value event-hero__dt-value--editable';
            span.id        = input.id;
            span.title     = `Click to change ${kind}`;
            span.textContent = displayFor(kind);
            span.addEventListener('click', () => editField(kind));
            input.replaceWith(span);
            setEl(kind, span);

            if (kind === 'type') updateForType();
            markDirty();
        };
        input.addEventListener('blur',   commit, { once: true });
        input.addEventListener('change', commit, { once: true });
    }

    if (event.learning_outcomes || isAdmin) {
        divider.hidden  = false;
        outBlock.hidden = false;
    }

    const applyHeading = document.getElementById('js-apply-heading');
    if (applyHeading) applyHeading.textContent = `${event.title} Application`;

    const applySection = document.getElementById('apply-form');

    if (isAdmin) {
        if (applySection) applySection.hidden = true;
        showApprovalsPanel();
    } else {
        setupApplyForm(session, isLoggedIn);
    }

    async function setupApplyForm(session, isLoggedIn) {
        const applyForm  = document.getElementById('js-apply-form');
        const successEl  = document.getElementById('af-success');
        if (!applyForm) return;

        if (isLoggedIn) {
            const { data: profile } = await db
                .from('user_profiles')
                .select('*')
                .eq('id', session.user.id)
                .single();

            applyForm.hidden = true;

            const oneClick = document.createElement('div');
            oneClick.className = 'apply-oneclick';

            const incomplete = !profile?.full_name || !profile?.student_id || !profile?.owa || !profile?.year_of_study || !profile?.course_of_study;

            const { data: existing } = await db
                .from('applications')
                .select('id, status, reviewed_by, rejection_reason')
                .eq('user_id', session.user.id)
                .eq('event_slug', slug)
                .maybeSingle();

            if (existing) {
                const s        = existing.status || 'pending';
                const reviewer = existing.reviewed_by;
                const reason   = existing.rejection_reason;

                if (s === 'approved' || s === 'rejected') {
                    const isApproved = s === 'approved';
                    const icon       = isApproved ? '✓' : '✕';
                    const label      = isApproved ? 'Approved' : 'Rejected';
                    const rightContent = isApproved
                        ? `<p class="apply-verdict__right-title">Reason</p>
                           <p class="apply-verdict__congrats">Hope you enjoy the event!</p>`
                        : `<p class="apply-verdict__right-title">Reason</p>
                           ${reason ? `<p class="apply-verdict__reason">${esc(reason)}</p>`
                                    : `<p class="apply-verdict__no-reason">No reason was provided.</p>`}`;
                    oneClick.innerHTML = `
                        <p class="apply-oneclick__info">You've already applied to this event.</p>
                        <div class="apply-verdict apply-verdict--${s}">
                            <div class="apply-verdict__left">
                                <span class="apply-verdict__label">${label}</span>
                                <span class="apply-verdict__icon">${icon}</span>
                            </div>
                            <div class="apply-verdict__divider"></div>
                            <div class="apply-verdict__right">${rightContent}</div>
                        </div>
                        ${reviewer ? `<p class="apply-reviewed-by">Reviewed by ${esc(reviewer)}</p>` : ''}`;
                } else {
                    oneClick.innerHTML = `
                        <p class="apply-oneclick__info">You've already applied to this event.</p>
                        <span class="ap-status ap-status--pending">Pending</span>`;
                }
            } else if (incomplete) {
                oneClick.innerHTML = `
                    <p class="apply-oneclick__info">Your profile is incomplete. Please fill in your details before applying.</p>
                    <button class="apply-submit apply-submit--outline" id="af-goto-profile">Complete Profile</button>`;
                oneClick.querySelector('#af-goto-profile').addEventListener('click', () => {
                    document.dispatchEvent(new CustomEvent('ua:open-account'));
                });
            } else {
                oneClick.innerHTML = `
                    <p class="apply-oneclick__info">
                        Applying as <strong>${esc(profile.full_name)}</strong>
                        &nbsp;·&nbsp; ${esc(profile.student_id)}
                    </p>
                    <div id="af-err" class="apply-error" hidden></div>
                    <button class="apply-submit" id="af-btn">Apply as ${esc(profile.full_name)}</button>`;

                oneClick.querySelector('#af-btn').addEventListener('click', async () => {
                    const btn   = oneClick.querySelector('#af-btn');
                    const errEl = oneClick.querySelector('#af-err');
                    errEl.hidden    = true;
                    btn.disabled    = true;
                    btn.textContent = 'Applying…';

                    const { error } = await db.from('applications').insert({
                        event_id:        event.id,
                        event_slug:      slug,
                        full_name:       profile.full_name,
                        student_id:      profile.student_id,
                        owa:             profile.owa,
                        year_of_study:   profile.year_of_study,
                        course_of_study: profile.course_of_study,
                        user_id:         session.user.id,
                        status:          'pending',
                    });

                    if (error) {
                        errEl.textContent = error.message;
                        errEl.hidden      = false;
                        btn.disabled      = false;
                        btn.textContent   = `Apply as ${profile.full_name}`;
                    } else {
                        oneClick.hidden  = true;
                        successEl.hidden = false;
                    }
                });
            }

            applyForm.after(oneClick);
            return;
        }

        const banner = document.createElement('div');
        banner.className = 'apply-signin-banner';
        banner.innerHTML = `
            <p>Sign in to apply with your saved profile details.</p>
            <button class="apply-signin-link" id="af-signin-link">Sign In</button>`;
        applyForm.before(banner);
        banner.querySelector('#af-signin-link').addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('ua:open-login'));
        });

        applyForm.addEventListener('submit', async e => {
            e.preventDefault();
            const errEl  = document.getElementById('af-error');
            const submit = document.getElementById('af-submit');
            errEl.hidden       = true;
            submit.disabled    = true;
            submit.textContent = 'Submitting…';

            const name   = document.getElementById('af-name').value.trim();
            const sid    = document.getElementById('af-sid').value.trim();
            const owa    = document.getElementById('af-owa').value.trim();
            const year   = document.getElementById('af-year').value;
            const course = document.getElementById('af-course').value.trim();

            if (!name || !sid || !owa || !year || !course) {
                errEl.textContent  = 'Please fill in all fields.';
                errEl.hidden       = false;
                submit.disabled    = false;
                submit.textContent = 'Submit Application';
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
                user_id:         null,
                status:          'pending',
            });

            if (submitErr) {
                errEl.textContent  = submitErr.message;
                errEl.hidden       = false;
                submit.disabled    = false;
                submit.textContent = 'Submit Application';
            } else {
                applyForm.hidden = true;
                banner.remove();
                successEl.hidden = false;
            }
        });
    }

    async function showApprovalsPanel() {
        const panel = document.createElement('section');
        panel.className = 'approvals-panel';
        panel.id        = 'js-approvals-panel';
        panel.innerHTML = `
            <div class="approvals-panel__inner">
                <div class="approvals-panel__head">
                    <h2 class="approvals-panel__title">Applications</h2>
                    <div class="approvals-panel__counts" id="ap-counts"></div>
                </div>
                <div id="ap-list" class="ap-list">Loading…</div>
            </div>`;

        document.querySelector('.event-detail')?.after(panel);

        window.__apAdmin = {
            remove:  (id) => removeApplication(id, panel),
            approve: (id) => setStatus(id, 'approved', panel, null),
            reject:  (id) => rejectWithReason(id, panel),
        };

        await refreshApprovals(panel);

        const deleteZone = document.createElement('div');
        deleteZone.className = 'event-delete-zone';
        deleteZone.innerHTML = `<button class="event-delete-btn" id="js-delete-event">Delete this event</button>`;
        panel.after(deleteZone);

        deleteZone.querySelector('#js-delete-event').addEventListener('click', async () => {
            if (!confirm(`Delete "${event.title}"?\n\nThis cannot be undone.`)) return;
            const { error } = await db.from('events').delete().eq('id', event.id);
            if (error) { alert('Delete failed: ' + error.message); return; }
            window.location.href = '/eventspage.html';
        });
    }

    async function refreshApprovals(panel) {
        const list   = panel.querySelector('#ap-list');
        const counts = panel.querySelector('#ap-counts');

        const { data: apps, error } = await db
            .from('applications')
            .select('*')
            .eq('event_slug', slug)
            .order('submitted_at', { ascending: false });

        if (error) { list.textContent = 'Failed to load applications.'; return; }
        if (!apps || apps.length === 0) {
            list.className = 'ap-list';
            list.innerHTML = '<p class="ap-empty">No applications yet.</p>';
            counts.textContent = '';
            return;
        }

        const userIds = [...new Set(apps.map(a => a.user_id).filter(Boolean))];
        let avatarMap = {};
        if (userIds.length) {
            const { data: profiles } = await db
                .from('user_profiles').select('id, avatar_url').in('id', userIds);
            if (profiles) avatarMap = Object.fromEntries(profiles.map(p => [p.id, p.avatar_url]));
        }

        const pending  = apps.filter(a => a.status === 'pending').length;
        const approved = apps.filter(a => a.status === 'approved').length;
        const rejected = apps.filter(a => a.status === 'rejected').length;

        counts.innerHTML = `
            <span class="ap-count">${apps.length} total</span>
            <span class="ap-count ap-count--pending">${pending} pending</span>
            <span class="ap-count ap-count--approved">${approved} approved</span>
            <span class="ap-count ap-count--rejected">${rejected} rejected</span>`;

        list.className = 'ap-grid';
        list.innerHTML = apps.map(app => {
            const avatarUrl  = avatarMap[app.user_id] || null;
            const initials   = (app.full_name || '?').split(' ').map(n => n[0] || '').slice(0, 2).join('').toUpperCase();
            const avatarHtml = avatarUrl
                ? `<img class="ap-avatar" src="${esc(avatarUrl)}" alt="">`
                : `<div class="ap-avatar ap-avatar--initials">${esc(initials)}</div>`;

            return `
                <div class="ap-card ap-card--${app.status}">
                    <div class="ap-card__top">
                        ${avatarHtml}
                        <span class="ap-status ap-status--${app.status}">${capitalize(app.status)}</span>
                    </div>
                    <strong class="ap-card__name">${esc(app.full_name)}</strong>
                    <span class="ap-card__meta">${esc(app.student_id)}</span>
                    <span class="ap-card__meta">${esc(app.owa)}</span>
                    <span class="ap-card__meta">${esc(app.year_of_study)} · ${esc(app.course_of_study)}</span>
                    <div class="ap-card__actions">
                        ${app.status === 'pending' ? `
                            <button class="ap-btn ap-btn--approve" data-id="${esc(String(app.id))}" onclick="window.__apAdmin.approve(this.dataset.id)">Approve</button>
                            <button class="ap-btn ap-btn--reject"  data-id="${esc(String(app.id))}" onclick="window.__apAdmin.reject(this.dataset.id)">Reject</button>`
                        : app.status === 'rejected' ? `
                            <button class="ap-btn ap-btn--approve" data-id="${esc(String(app.id))}" onclick="window.__apAdmin.approve(this.dataset.id)">Approve</button>`
                        : app.status === 'approved' ? `
                            <button class="ap-btn ap-btn--reject"  data-id="${esc(String(app.id))}" onclick="window.__apAdmin.reject(this.dataset.id)">Reject</button>`
                        : ''}
                        <button class="ap-btn ap-btn--remove" data-id="${esc(String(app.id))}" onclick="window.__apAdmin.remove(this.dataset.id)">Remove</button>
                    </div>
                </div>`;
        }).join('');
    }

    async function rejectWithReason(id, panel) {
        const reason = prompt('Reason for rejection (optional):\nThe applicant will see this message.');
        if (reason === null) return;
        await setStatus(id, 'rejected', panel, reason.trim() || null);
    }

    async function setStatus(id, status, panel, reason = undefined) {
        const profile    = window.userProfile;
        const reviewedBy = profile?.nickname || profile?.full_name?.split(' ')[0] || 'Admin';
        const updates    = { status, reviewed_by: reviewedBy };
        if (status === 'rejected') updates.rejection_reason = reason ?? null;
        if (status === 'approved') updates.rejection_reason = null;
        const { error } = await db.from('applications').update(updates).eq('id', id);
        if (error) { alert('Update failed: ' + error.message); return; }
        await refreshApprovals(panel);
    }

    async function removeApplication(id, panel) {
        if (!confirm('Remove this application? This cannot be undone.')) return;
        const { data: deleted, error } = await db
            .from('applications').delete().eq('id', id).select();
        if (error) {
            alert('Delete error: ' + error.message + ' (code: ' + error.code + ')');
            return;
        }
        if (!deleted || deleted.length === 0) {
            alert('Nothing was deleted — an RLS policy is blocking this. Run the SQL fix in Supabase.');
            return;
        }
        await refreshApprovals(panel);
    }

    function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

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

    const RICH_TEXT_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN']);
    function sanitizeHtml(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        (function clean(node) {
            [...node.childNodes].forEach(child => {
                if (child.nodeType !== Node.ELEMENT_NODE) return;
                if (!RICH_TEXT_TAGS.has(child.tagName)) { child.replaceWith(...child.childNodes); return; }
                [...child.attributes].forEach(attr => child.removeAttribute(attr.name));
                clean(child);
            });
        })(tpl.content);
        return tpl.innerHTML;
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    if (!isAdmin) return;

    titleEl.contentEditable    = 'true';
    descEl.contentEditable     = 'true';
    outcomesEl.contentEditable = 'true';

    descEl.dataset.placeholder     = 'Click to add a description…';
    outcomesEl.dataset.placeholder = 'Click to add learning outcomes…';

    document.getElementById('js-img-btn').hidden = false;

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
    toolbar.hidden = true;
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
        el.addEventListener('blur',  e  => {
            if (!toolbar.contains(e.relatedTarget)) { toolbar.hidden = true; activeField = null; }
        });
        el.addEventListener('keyup', () => { if (activeField === el) positionToolbar(el); });
    });

    toolbar.addEventListener('mousedown', e => {
        const btn = e.target.closest('[data-cmd]');
        if (!btn) return;
        e.preventDefault();
        document.execCommand(btn.dataset.cmd, false, null);
        markDirty();
    });

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

    document.getElementById('js-img-input').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file || !validateImageFile(file, e.target)) return;
        pendingImgFile = file;
        bgEl.style.backgroundImage = `url('${URL.createObjectURL(file)}')`;
        markDirty();
    });

    titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });

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
            const { data: { publicUrl } } = db.storage.from('event-images').getPublicUrl(up.path);
            currentImgUrl  = publicUrl;
            pendingImgFile = null;
        }

        const { error } = await db.from('events').update({
            title:             titleEl.textContent.trim(),
            description:       descEl.innerHTML.trim()     || null,
            learning_outcomes: outcomesEl.innerHTML.trim() || null,
            image_url:         currentImgUrl,
            event_type:        currentEventType || 'single-day',
            event_date:        currentEventDate || null,
            event_end_date:    currentEventType !== 'single-day' ? (currentEventEndDate || null) : null,
            event_time:        currentEventTime || null,
            event_end_time:    currentEventEndTime || null,
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
