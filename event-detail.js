(async function () {
    document.getElementById('js-hero-scroll')?.addEventListener('click', () => {
        document.querySelector('.event-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const params = new URLSearchParams(window.location.search);
    // Every event has a stable "temporary" URL keyed off its id
    // (/event/?id=…) that always works from the moment it's created.
    // A page can also hardcode its slug via <body data-slug="…"> instead
    // of a ?slug= query param — used for unlisted event pages (e.g. /step)
    // that aren't linked from anywhere and shouldn't need a query string.
    // Precedence: hardcoded slug > ?slug= > ?id= (the id fallback only
    // applies once no slug is in play at all).
    const bodySlug  = document.body.dataset.slug || null;
    const paramSlug = params.get('slug');
    const paramId   = params.get('id');

    let lookupCol, lookupVal;
    if (bodySlug)       { lookupCol = 'slug'; lookupVal = bodySlug; }
    else if (paramSlug) { lookupCol = 'slug'; lookupVal = paramSlug; }
    else if (paramId)   { lookupCol = 'id';   lookupVal = paramId; }

    if (!lookupVal) { window.location.href = '/'; return; }

    const [{ data: event }, { session, isAdmin }] = await Promise.all([
        db.from('events').select('*').eq(lookupCol, lookupVal).maybeSingle(),
        window.roleReady,
    ]);

    const isLoggedIn = !!session && !isAdmin;

    const RICH_TEXT_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN']);
    function sanitizeHtml(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;

        // Iterative (not recursive) — contenteditable output can nest arbitrarily
        // deep (Chrome quirk with repeated Enter/list toggles), and a recursive
        // walk here previously blew the call stack on that content, silently
        // killing the rest of the page render.
        const stack = [tpl.content];
        while (stack.length) {
            const node = stack.pop();
            [...node.childNodes].forEach(child => {
                if (child.nodeType !== Node.ELEMENT_NODE) return;
                if (!RICH_TEXT_TAGS.has(child.tagName)) {
                    child.replaceWith(...child.childNodes);
                    stack.push(node); // re-scan: its children just changed
                    return;
                }
                [...child.attributes].forEach(attr => child.removeAttribute(attr.name));
                stack.push(child);
            });
        }
        return tpl.innerHTML;
    }

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

    // An event whose (end) date is before today is over — it can't be joined
    // any more, and the apply form is swapped for the photo gallery below.
    const isPast = (() => {
        const ref = (event.event_type && event.event_type !== 'single-day')
            ? (event.event_end_date || event.event_date)
            : event.event_date;
        if (!ref) return false;
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return String(ref).slice(0, 10) < todayStr;
    })();
    try {
        descEl.innerHTML     = sanitizeHtml(event.description       || '');
        outcomesEl.innerHTML = sanitizeHtml(event.learning_outcomes || '');
    } catch (err) {
        console.error('Failed to render formatted event text, falling back to plain text:', err);
        descEl.textContent     = event.description       || '';
        outcomesEl.textContent = event.learning_outcomes || '';
    }

    if (event.image_url) {
        bgEl.style.setProperty('--hero-bg-desktop', `url('${event.image_url.replace(/'/g, '%27')}')`);
    }
    if (event.image_url_mobile) {
        bgEl.style.setProperty('--hero-bg-mobile', `url('${event.image_url_mobile.replace(/'/g, '%27')}')`);
    }

    const datetimeEl  = document.getElementById('js-datetime');
    let typeValueEl    = document.getElementById('js-type-value');
    let dateValueEl     = document.getElementById('js-date-value');
    let endDateValueEl  = document.getElementById('js-enddate-value');
    let timeValueEl     = document.getElementById('js-time-value');
    let endTimeValueEl  = document.getElementById('js-endtime-value');
    let venueValueEl    = document.getElementById('js-venue-value');
    let priceValueEl    = document.getElementById('js-price-value');

    const TYPE_LABELS = {
        'single-day': 'Single Day',
        'multi-day':  'Multi-Day',
        'weekly':     'Weekly',
        'competition': 'Competition',
    };

    // Fields shown unconditionally once the meta row is visible at all.
    const CORE_KINDS = ['type', 'date', 'time'];
    // Fields that only take up space in the row when they're actually set
    // (or an admin is editing, so there's still something to click on).
    const OPTIONAL_KINDS = ['enddate', 'endtime', 'venue', 'price'];
    const ALL_KINDS = [...CORE_KINDS, ...OPTIONAL_KINDS];

    const DATE_KINDS = { date: 'currentEventDate', enddate: 'currentEventEndDate' };
    const TIME_KINDS = { time: 'currentEventTime', endtime: 'currentEventEndTime' };

    let currentEventType     = event.event_type || 'single-day';
    let currentEventDate     = event.event_date || '';
    let currentEventEndDate  = event.event_end_date || '';
    let currentEventTime     = event.event_time || '';
    let currentEventEndTime  = event.event_end_time || '';
    let currentEventVenue    = event.venue || '';
    let currentEventPrice    = event.price || '';

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
        if (kind === 'venue')   return currentEventVenue;
        if (kind === 'price')   return currentEventPrice;
        if (kind in DATE_KINDS) return kind === 'date' ? currentEventDate : currentEventEndDate;
        return kind === 'time' ? currentEventTime : currentEventEndTime;
    }
    function displayFor(kind) {
        if (kind === 'type')    return TYPE_LABELS[currentEventType] || TYPE_LABELS['single-day'];
        if (kind === 'venue')   return currentEventVenue || 'Click to add a venue';
        if (kind === 'price')   return currentEventPrice || 'Click to add a price';
        if (kind in DATE_KINDS) return formatDateDisplay(valueFor(kind));
        return formatTimeDisplay(valueFor(kind));
    }
    function elFor(kind) {
        if (kind === 'type')    return typeValueEl;
        if (kind === 'date')    return dateValueEl;
        if (kind === 'enddate') return endDateValueEl;
        if (kind === 'time')    return timeValueEl;
        if (kind === 'venue')   return venueValueEl;
        if (kind === 'price')   return priceValueEl;
        return endTimeValueEl;
    }
    function setEl(kind, span) {
        if (kind === 'type')    typeValueEl    = span;
        if (kind === 'date')    dateValueEl    = span;
        if (kind === 'enddate') endDateValueEl = span;
        if (kind === 'time')    timeValueEl    = span;
        if (kind === 'endtime') endTimeValueEl = span;
        if (kind === 'venue')   venueValueEl   = span;
        if (kind === 'price')   priceValueEl   = span;
    }
    function titleFor(kind) {
        if (kind === 'venue') return 'Click to change the venue';
        if (kind === 'price') return 'Click to change the price';
        return `Click to change ${kind}`;
    }

    // Whether an optional field earns a spot in the compact meta row —
    // hidden once it's empty and nobody can edit it, so a mostly-unset
    // event doesn't read as a wall of "TBC"s.
    function isOptionalVisible(kind) {
        if (kind === 'enddate') return currentEventType !== 'single-day' && (isAdmin || !!currentEventEndDate);
        if (kind === 'endtime') return isAdmin || !!currentEventEndTime;
        if (kind === 'venue')   return isAdmin || !!currentEventVenue;
        if (kind === 'price')   return isAdmin || !!currentEventPrice;
        return true;
    }

    // Each optional value has its own separator span right before it (a
    // "–" for enddate/endtime, since they read as a range with the value
    // before them, otherwise a "·") — keep the two in sync so hiding one
    // never leaves a stray dot dangling in the row.
    function refreshMetaVisibility() {
        OPTIONAL_KINDS.forEach(kind => {
            const show = isOptionalVisible(kind);
            elFor(kind).hidden = !show;
            const sep = document.getElementById(`js-${kind}-sep`);
            if (sep) sep.hidden = !show;
        });
    }

    if (datetimeEl) {
        if (isAdmin || currentEventDate || currentEventTime || currentEventVenue || currentEventPrice) datetimeEl.hidden = false;

        ALL_KINDS.forEach(kind => { elFor(kind).textContent = displayFor(kind); });
        refreshMetaVisibility();

        if (isAdmin) {
            ALL_KINDS.forEach(kind => {
                const el = elFor(kind);
                el.classList.add('event-hero__meta-item--editable');
                el.title = titleFor(kind);
                el.addEventListener('click', () => editField(kind));
            });
        }
    }

    function editField(kind) {
        const el = elFor(kind);
        let input;

        if (kind === 'type') {
            input = document.createElement('select');
            input.className = 'event-hero__meta-input';
            input.innerHTML = Object.entries(TYPE_LABELS)
                .map(([val, label]) => `<option value="${val}"${val === currentEventType ? ' selected' : ''}>${label}</option>`)
                .join('');
        } else if (kind === 'venue' || kind === 'price') {
            input = document.createElement('input');
            input.type        = 'text';
            input.value        = valueFor(kind);
            input.placeholder  = kind === 'venue' ? 'e.g. Engineering Building, Room 204' : 'e.g. RM100000';
            input.className    = `event-hero__meta-input event-hero__meta-input--${kind}`;
        } else {
            input = document.createElement('input');
            input.type  = kind in DATE_KINDS ? 'date' : 'time';
            input.value = valueFor(kind);
            input.className = 'event-hero__meta-input';
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
            if (kind === 'venue')    currentEventVenue   = input.value.trim();
            if (kind === 'price')    currentEventPrice   = input.value.trim();

            const span = document.createElement('span');
            span.className = 'event-hero__meta-item event-hero__meta-item--editable';
            span.id        = input.id;
            span.title     = titleFor(kind);
            span.textContent = displayFor(kind);
            span.addEventListener('click', () => editField(kind));
            input.replaceWith(span);
            setEl(kind, span);

            refreshMetaVisibility();
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
    const joinBtn      = document.querySelector('.event-hero__join-btn');

    if (isAdmin) {
        if (applySection) applySection.hidden = true;
        showApprovalsPanel();
    } else if (isPast) {
        // Past events can't be joined — drop the apply form entirely; the
        // gallery below takes its place.
        if (applySection) applySection.hidden = true;
    } else {
        setupApplyForm(session, isLoggedIn);
    }

    setupGallery();
    setupEventDocuments();

    async function setupApplyForm(session, isLoggedIn) {
        const applyForm  = document.getElementById('js-apply-form');
        const successEl  = document.getElementById('af-success');
        if (!applyForm) return;

        // Mods control optional-vs-mandatory per event; the field itself
        // always shows.
        const fileRequired = !!event.application_file_required;
        const fileLabelEl  = document.getElementById('af-file-label');
        const staticFileEl = document.getElementById('af-file');
        if (fileLabelEl)  fileLabelEl.textContent = fileRequired ? 'Attachment (required)' : 'Attachment (optional)';
        if (staticFileEl) staticFileEl.required = fileRequired;

        const MAX_ATTACHMENT_BYTES     = 20 * 1024 * 1024;
        const ALLOWED_ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
                                           'video/mp4', 'video/quicktime', 'video/webm'];

        function validateAttachment(file) {
            if (!file) return null;
            if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) return 'Please attach a PDF, image, or video file.';
            if (file.size > MAX_ATTACHMENT_BYTES) return 'Attachment must be under 20MB.';
            return null;
        }

        async function uploadAttachment(file) {
            const ext  = (file.name.split('.').pop() || 'bin').toLowerCase();
            const path = `applications/${event.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const { error } = await db.storage.from('application-files').upload(path, file);
            if (error) throw error;
            return { path, name: file.name };
        }

        function renderConfirmation(details, status) {
            // Tailor the success screen to how the application landed.
            successEl.classList.toggle('apply-success--waitlisted', status === 'waitlisted');
            const h3 = successEl.querySelector('h3');
            const p  = successEl.querySelector('p');
            if (status === 'waitlisted') {
                if (h3) h3.textContent = "You're on the waitlist";
                if (p)  p.textContent  = "This event is currently full. If a spot opens up you'll be moved in automatically.";
            } else if (status === 'approved') {
                if (h3) h3.textContent = "You're in!";
                if (p)  p.textContent  = "Your place is confirmed. See you there!";
            }

            const summaryEl = document.getElementById('af-summary');
            if (!summaryEl) return;
            const rows = [
                ['Name', details.name],
                ['Student ID', details.studentId],
                ['OWA', details.owa],
                ['Year', details.year],
                ['Course', details.course],
            ];
            if (details.attachmentName) rows.push(['Attachment', details.attachmentName]);
            if (status === 'waitlisted' && details.waitlistPosition) {
                rows.unshift(['Position', `#${details.waitlistPosition} in line`]);
            }
            summaryEl.innerHTML = rows.map(([k, v]) => `
                <div class="apply-success__row">
                    <span class="apply-success__k">${esc(k)}</span>
                    <span class="apply-success__v">${esc(v)}</span>
                </div>`).join('');
        }

        // Data-protection notice + explicit, un-ticked consent — shown at the
        // point of submission on every path that records personal data.
        function privacyNoticeHtml(prefix) {
            return `
                <div class="apply-privacy">
                    <p class="apply-privacy__notice">
                        Your details will be recorded in our database. Please note we will not disclose
                        your data to third parties outside The University of Nottingham and the information
                        will only be used to send you relevant information relating to your enquiry. You can
                        obtain a copy of your data or ask for your record to be removed by contacting
                        <a href="mailto:data-protection@nottingham.ac.uk">data-protection@nottingham.ac.uk</a>.
                        You can also view our data protection policies for the United Kingdom, China and Malaysia.
                    </p>
                    <label class="apply-privacy__consent">
                        <input type="checkbox" id="${prefix}-consent">
                        <span>I have read and understood the above and consent to my details being recorded and used as described.</span>
                    </label>
                </div>`;
        }
        const CONSENT_ERR = 'Please tick the box to consent to your details being recorded.';

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
                .select('id, status, reviewed_by, rejection_reason, submitted_at')
                .eq('user_id', session.user.id)
                .eq('event_id', event.id)
                .maybeSingle();

            if (existing) {
                const s        = existing.status || 'pending';
                const reviewer = existing.reviewed_by;
                const reason   = existing.rejection_reason;

                if (s === 'waitlisted') {
                    const { data: pos } = await db.rpc('my_waitlist_position', { p_event_id: event.id });
                    const rows = [];
                    if (pos) rows.push(['Position', `#${pos} in line`]);
                    rows.push(
                        ['Name', profile.full_name],
                        ['Student ID', profile.student_id],
                        ['OWA', profile.owa],
                        ['Year', profile.year_of_study],
                        ['Course', profile.course_of_study],
                    );

                    oneClick.innerHTML = `
                        <div class="apply-success apply-success--waitlisted">
                            <svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 7 12 12 15 14"/></svg>
                            <h3>You're on the waitlist</h3>
                            <p>This event is full for now. If a place opens up you'll be moved in automatically — first come, first served.</p>
                            <div class="apply-success__summary">
                                ${rows.map(([k, v]) => `
                                    <div class="apply-success__row">
                                        <span class="apply-success__k">${esc(k)}</span>
                                        <span class="apply-success__v">${esc(v)}</span>
                                    </div>`).join('')}
                            </div>
                        </div>`;
                } else if (s === 'approved' || s === 'rejected') {
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
                    <div class="apply-identity">
                        <span class="apply-identity__label">You're applying as</span>
                        <span class="apply-identity__name">${esc(profile.full_name)}</span>
                        <span class="apply-identity__meta">${esc(profile.student_id)} · ${esc(profile.owa)}</span>
                        <span class="apply-identity__meta">${esc(profile.year_of_study)} · ${esc(profile.course_of_study)}</span>
                    </div>
                    <div class="apply-field">
                        <label class="apply-label" for="af-oc-file">Attachment${fileRequired ? ' (required)' : ' (optional)'}</label>
                        <input class="apply-input apply-file-input" type="file" id="af-oc-file" accept="application/pdf,image/*,video/*">
                        <p class="apply-hint">PDF, image, or video — up to 20MB.</p>
                    </div>
                    ${privacyNoticeHtml('af-oc')}
                    <div id="af-err" class="apply-error" hidden></div>
                    <button class="apply-submit" id="af-btn">Apply as ${esc(profile.full_name)}</button>`;

                oneClick.querySelector('#af-btn').addEventListener('click', async () => {
                    const btn    = oneClick.querySelector('#af-btn');
                    const errEl  = oneClick.querySelector('#af-err');
                    const file   = oneClick.querySelector('#af-oc-file').files[0] || null;
                    errEl.hidden = true;

                    if (!oneClick.querySelector('#af-oc-consent').checked) {
                        errEl.textContent = CONSENT_ERR;
                        errEl.hidden      = false;
                        return;
                    }
                    if (fileRequired && !file) {
                        errEl.textContent = 'Please attach a file to apply.';
                        errEl.hidden      = false;
                        return;
                    }
                    const fileErr = validateAttachment(file);
                    if (fileErr) { errEl.textContent = fileErr; errEl.hidden = false; return; }

                    btn.disabled    = true;
                    btn.textContent = 'Applying…';

                    let attachment = null;
                    if (file) {
                        try {
                            attachment = await uploadAttachment(file);
                        } catch (uploadErr) {
                            errEl.textContent = 'File upload failed: ' + uploadErr.message;
                            errEl.hidden      = false;
                            btn.disabled      = false;
                            btn.textContent   = `Apply as ${profile.full_name}`;
                            return;
                        }
                    }

                    const { data: created, error } = await db.from('applications').insert({
                        event_id:        event.id,
                        event_slug:      event.slug || null,
                        full_name:       profile.full_name,
                        student_id:      profile.student_id,
                        owa:             profile.owa,
                        year_of_study:   profile.year_of_study,
                        course_of_study: profile.course_of_study,
                        user_id:         session.user.id,
                        status:          'pending',
                        attachment_path: attachment?.path || null,
                        attachment_name: attachment?.name || null,
                    }).select('status').single();

                    if (error) {
                        errEl.textContent = error.message;
                        errEl.hidden      = false;
                        btn.disabled      = false;
                        btn.textContent   = `Apply as ${profile.full_name}`;
                    } else {
                        oneClick.hidden  = true;
                        let waitlistPosition = null;
                        if (created?.status === 'waitlisted') {
                            const { data: pos } = await db.rpc('my_waitlist_position', { p_event_id: event.id });
                            waitlistPosition = pos || null;
                        }
                        renderConfirmation({
                            name: profile.full_name, studentId: profile.student_id, owa: profile.owa,
                            year: profile.year_of_study, course: profile.course_of_study,
                            attachmentName: attachment?.name || null,
                            waitlistPosition,
                        }, created?.status);
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

        document.getElementById('af-error').insertAdjacentHTML('beforebegin', privacyNoticeHtml('af'));

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
            const file   = document.getElementById('af-file').files[0] || null;

            const fail = msg => {
                errEl.textContent  = msg;
                errEl.hidden       = false;
                submit.disabled    = false;
                submit.textContent = 'Submit Application';
            };

            if (!name || !sid || !owa || !year || !course) { fail('Please fill in all fields.'); return; }
            if (!document.getElementById('af-consent')?.checked) { fail(CONSENT_ERR); return; }
            if (fileRequired && !file) { fail('Please attach a file to apply.'); return; }
            const fileErr = validateAttachment(file);
            if (fileErr) { fail(fileErr); return; }

            let attachment = null;
            if (file) {
                try {
                    attachment = await uploadAttachment(file);
                } catch (uploadErr) {
                    fail('File upload failed: ' + uploadErr.message);
                    return;
                }
            }

            const { data: created, error: submitErr } = await db.from('applications').insert({
                event_id:        event.id,
                event_slug:      event.slug || null,
                full_name:       name,
                student_id:      sid,
                owa,
                year_of_study:   year,
                course_of_study: course,
                user_id:         null,
                status:          'pending',
                attachment_path: attachment?.path || null,
                attachment_name: attachment?.name || null,
            }).select('status').single();

            if (submitErr) {
                fail(submitErr.message);
            } else {
                applyForm.hidden = true;
                banner.remove();
                renderConfirmation({ name, studentId: sid, owa, year, course, attachmentName: attachment?.name || null }, created?.status);
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
                    <div class="ap-settings">
                        <label class="ap-file-toggle">
                            <input type="checkbox" id="ap-file-required"${event.application_file_required ? ' checked' : ''}>
                            Require an attachment to apply
                        </label>
                        <label class="ap-cap-field">
                            Max participants
                            <input type="number" id="ap-max" min="0" inputmode="numeric"
                                   value="${event.max_participants ?? ''}" placeholder="∞">
                        </label>
                    </div>
                    <div class="approvals-panel__counts" id="ap-counts"></div>
                </div>
                <div id="ap-list" class="ap-list">Loading…</div>
            </div>`;

        document.querySelector('.event-detail')?.after(panel);

        panel.querySelector('#ap-file-required').addEventListener('change', async e => {
            const checked = e.target.checked;
            const { error } = await db.from('events').update({ application_file_required: checked }).eq('id', event.id);
            if (error) { alert(error.message); e.target.checked = !checked; return; }
            event.application_file_required = checked;
        });

        panel.querySelector('#ap-max').addEventListener('change', async e => {
            const raw = e.target.value.trim();
            const val = raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0);
            e.target.value = val ?? '';
            const { error } = await db.from('events').update({ max_participants: val }).eq('id', event.id);
            if (error) { alert(error.message); e.target.value = event.max_participants ?? ''; return; }
            event.max_participants = val;
            // the DB trigger may have promoted people off the waitlist
            await refreshApprovals(panel);
        });

        window.__apAdmin = {
            remove:     (id) => removeApplication(id, panel),
            approve:    (id) => setStatus(id, 'approved', panel, null),
            reject:     (id) => rejectWithReason(id, panel),
            viewAttach: (id) => viewAttachment(id),
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
            window.location.href = '/eventspage/';
        });
    }

    async function refreshApprovals(panel) {
        const list   = panel.querySelector('#ap-list');
        const counts = panel.querySelector('#ap-counts');

        const { data: apps, error } = await db
            .from('applications')
            .select('*')
            .eq('event_id', event.id)
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

        const byStatus = s => apps.filter(a => a.status === s);
        const pending     = byStatus('pending');
        const approved    = byStatus('approved');
        const waitlisted  = byStatus('waitlisted');
        const rejected    = byStatus('rejected');

        const cap = event.max_participants;
        counts.innerHTML = `
            <span class="ap-count">${apps.length} total</span>
            ${cap != null ? `<span class="ap-count ap-count--seats">${approved.length} / ${cap} seats filled</span>` : ''}
            ${pending.length ? `<span class="ap-count ap-count--pending">${pending.length} pending</span>` : ''}
            <span class="ap-count ap-count--approved">${approved.length} approved</span>
            ${waitlisted.length ? `<span class="ap-count ap-count--waitlisted">${waitlisted.length} waitlisted</span>` : ''}
            <span class="ap-count ap-count--rejected">${rejected.length} rejected</span>`;

        const card = app => {
            const avatarUrl  = avatarMap[app.user_id] || null;
            const initials   = (app.full_name || '?').split(' ').map(n => n[0] || '').slice(0, 2).join('').toUpperCase();
            const avatarHtml = avatarUrl
                ? `<img class="ap-avatar" src="${esc(avatarUrl)}" alt="">`
                : `<div class="ap-avatar ap-avatar--initials">${esc(initials)}</div>`;
            const id = esc(String(app.id));
            const label = app.status === 'waitlisted' ? 'Waitlist' : capitalize(app.status);

            const actions =
                app.status === 'pending' ? `
                    <button class="ap-btn ap-btn--approve" data-id="${id}" onclick="window.__apAdmin.approve(this.dataset.id)">Approve</button>
                    <button class="ap-btn ap-btn--reject"  data-id="${id}" onclick="window.__apAdmin.reject(this.dataset.id)">Reject</button>`
              : app.status === 'waitlisted' ? `
                    <button class="ap-btn ap-btn--approve" data-id="${id}" onclick="window.__apAdmin.approve(this.dataset.id)">Approve now</button>
                    <button class="ap-btn ap-btn--reject"  data-id="${id}" onclick="window.__apAdmin.reject(this.dataset.id)">Reject</button>`
              : app.status === 'rejected' ? `
                    <button class="ap-btn ap-btn--approve" data-id="${id}" onclick="window.__apAdmin.approve(this.dataset.id)">Approve</button>`
              : app.status === 'approved' ? `
                    <button class="ap-btn ap-btn--reject"  data-id="${id}" onclick="window.__apAdmin.reject(this.dataset.id)">Reject</button>`
              : '';

            return `
                <div class="ap-card ap-card--${app.status}">
                    <div class="ap-card__top">
                        ${avatarHtml}
                        <span class="ap-status ap-status--${app.status}">${label}</span>
                    </div>
                    <strong class="ap-card__name">${esc(app.full_name)}</strong>
                    <span class="ap-card__meta">${esc(app.student_id)}</span>
                    <span class="ap-card__meta">${esc(app.owa)}</span>
                    <span class="ap-card__meta">${esc(app.year_of_study)} · ${esc(app.course_of_study)}</span>
                    ${app.attachment_path ? `
                        <button type="button" class="ap-card__attachment" data-id="${id}" onclick="window.__apAdmin.viewAttach(this.dataset.id)">
                            📎 ${esc(app.attachment_name || 'Attachment')}
                        </button>` : ''}
                    <div class="ap-card__actions">
                        ${actions}
                        <button class="ap-btn ap-btn--remove" data-id="${id}" onclick="window.__apAdmin.remove(this.dataset.id)">Remove</button>
                    </div>
                </div>`;
        };

        // Waitlist is a queue — show it oldest-first (next in line at the top).
        const section = (title, rows) => rows.length ? `
            <div class="ap-section">
                <h3 class="ap-section__title">${title} <span>${rows.length}</span></h3>
                <div class="ap-grid">${rows.map(card).join('')}</div>
            </div>` : '';

        list.className = 'ap-sections';
        list.innerHTML =
            section('Pending review', pending) +
            section('Waitlist', [...waitlisted].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at))) +
            section('Approved', approved) +
            section('Rejected', rejected);
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

    async function viewAttachment(id) {
        const { data: app, error: fetchErr } = await db
            .from('applications').select('attachment_path').eq('id', id).single();
        if (fetchErr || !app?.attachment_path) { alert('Could not find that attachment.'); return; }

        const { data, error } = await db.storage
            .from('application-files').createSignedUrl(app.attachment_path, 60);
        if (error) { alert('Could not open attachment: ' + error.message); return; }
        window.open(data.signedUrl, '_blank', 'noopener');
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

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ---- Photo gallery -------------------------------------------------
    // Shown when the event is over (for everyone) or to an admin at any
    // time, so photos can be added right after the event runs. Admins
    // upload/remove; visitors click a thumbnail to open the full image.
    function openLightbox(url) {
        if (!url) return;
        const box = document.createElement('div');
        box.className = 'lightbox';
        box.innerHTML = `
            <button type="button" class="lightbox__close" aria-label="Close">&times;</button>
            <img class="lightbox__img" src="${esc(url)}" alt="">`;
        document.body.appendChild(box);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const close = () => {
            box.remove();
            document.body.style.overflow = prevOverflow;
            document.removeEventListener('keydown', onKey);
        };
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        box.addEventListener('click', e => {
            // click the backdrop or the close button, but not the image itself
            if (e.target === box || e.target.closest('.lightbox__close')) close();
        });
    }

    async function setupGallery() {
        if (!(isPast || isAdmin)) return;

        const anchor = document.getElementById('apply-form') || document.querySelector('.event-detail');
        if (!anchor) return;

        const section = document.createElement('section');
        section.className = 'event-gallery';
        section.id        = 'event-gallery';
        section.innerHTML = `
            <div class="event-gallery__inner">
                <div class="event-gallery__head">
                    <h2 class="event-gallery__title">Gallery</h2>
                    ${isAdmin ? `
                        <button type="button" class="event-gallery__add" id="js-gallery-add">Add Photos</button>
                        <input type="file" id="js-gallery-input" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>` : ''}
                </div>
                <div class="event-gallery__grid" id="js-gallery-grid"></div>
                <p class="event-gallery__empty" id="js-gallery-empty" hidden></p>
            </div>`;
        anchor.after(section);

        const grid    = section.querySelector('#js-gallery-grid');
        const emptyEl = section.querySelector('#js-gallery-empty');
        let items = [];

        function render() {
            grid.innerHTML = items.map(row => `
                <div class="event-gallery__cell">
                    <button type="button" class="event-gallery__item" data-full="${esc(row.image_url)}" aria-label="View photo">
                        <img src="${esc(row.image_url)}" alt="" loading="lazy">
                    </button>
                    ${isAdmin ? `<button type="button" class="event-gallery__del" data-id="${esc(String(row.id))}" title="Remove photo" aria-label="Remove photo">&times;</button>` : ''}
                </div>`).join('');

            if (items.length) {
                emptyEl.hidden = true;
            } else {
                emptyEl.hidden = false;
                emptyEl.textContent = isAdmin
                    ? 'No photos yet.'
                    : 'Photos will be posted here soon.';
            }

            if (isPast && joinBtn) {
                if (items.length || isAdmin) {
                    joinBtn.textContent = 'View Photos';
                    joinBtn.setAttribute('href', '#event-gallery');
                    joinBtn.hidden = false;
                } else {
                    joinBtn.hidden = true;
                }
            }
        }

        grid.addEventListener('click', async e => {
            const del = e.target.closest('.event-gallery__del');
            if (del) {
                if (!confirm('Remove this photo?')) return;
                const id = del.dataset.id;
                const { error } = await db.from('event_gallery').delete().eq('id', id);
                if (error) { alert('Could not remove photo: ' + error.message); return; }
                items = items.filter(r => String(r.id) !== String(id));
                render();
                return;
            }
            const item = e.target.closest('.event-gallery__item');
            if (item) openLightbox(item.dataset.full);
        });

        if (isAdmin) {
            const addBtn = section.querySelector('#js-gallery-add');
            const input  = section.querySelector('#js-gallery-input');
            addBtn.addEventListener('click', () => input.click());
            input.addEventListener('change', async e => {
                const files = [...e.target.files];
                e.target.value = '';
                if (!files.length) return;

                const label = addBtn.textContent;
                addBtn.disabled = true;
                let n = 0;
                for (const file of files) {
                    if (!validateImageFile(file, input)) continue; // 5MB + image type, alerts itself
                    addBtn.textContent = `Uploading ${++n}/${files.length}…`;
                    const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
                    const path = `gallery/${event.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                    const { error: upErr } = await db.storage.from('event-images').upload(path, file, { upsert: true });
                    if (upErr) { alert('Upload failed: ' + upErr.message); continue; }
                    const url = db.storage.from('event-images').getPublicUrl(path).data.publicUrl;
                    const nextOrder = items.length ? Math.max(...items.map(r => r.sort_order || 0)) + 1 : 0;
                    const { data: inserted, error: insErr } = await db.from('event_gallery')
                        .insert({ event_id: event.id, image_url: url, sort_order: nextOrder })
                        .select().single();
                    if (insErr) { alert('Could not save photo: ' + insErr.message); continue; }
                    items.push(inserted);
                }
                addBtn.disabled    = false;
                addBtn.textContent = label;
                render();
            });
        }

        const { data, error } = await db.from('event_gallery')
            .select('*').eq('event_id', event.id)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });
        if (error) console.error('Gallery load failed:', error.message);
        items = data || [];
        render();
    }

    // ---- Downloadable documents --------------------------------------
    // Admin-uploaded files (consent / indemnity / registration forms —
    // things to print, sign and return) shown as a prominent card just
    // above the apply form. Public bucket, so anyone can download.
    async function setupEventDocuments() {
        const DOC_BUCKET  = 'event-documents';
        const DOC_MAX     = 20 * 1024 * 1024;
        const DOC_EXTS    = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'png', 'jpg', 'jpeg'];

        const { data, error } = await db.from('event_documents')
            .select('*').eq('event_id', event.id)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });
        if (error && !/does not exist|schema cache/i.test(error.message)) {
            console.error('Event documents load failed:', error.message);
        }
        let docs = data || [];

        if (!isAdmin && !docs.length) return;

        const detail       = document.querySelector('.event-detail');
        const applySection = document.getElementById('apply-form');
        if (!detail && !applySection) return;

        const section = document.createElement('section');
        section.className = 'event-docs';
        section.id        = 'event-docs';
        section.innerHTML = `
            <div class="event-docs__inner">
                <div class="event-docs__banner">
                    <span class="event-docs__icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="11" x2="12" y2="11"/></svg>
                    </span>
                    <div class="event-docs__banner-text">
                        <h2 class="event-docs__title">Required Documents</h2>
                        <p class="event-docs__sub">Download, read and sign these before the event. Attach the signed copy to your application or bring it with you.</p>
                    </div>
                </div>
                <ul class="event-docs__list" id="js-docs-list"></ul>
                ${isAdmin ? `
                <div class="event-docs__admin">
                    <button type="button" class="event-docs__add" id="js-docs-add">Upload a document</button>
                    <input type="file" id="js-docs-input" hidden
                           accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf,image/png,image/jpeg">
                </div>` : ''}
            </div>`;
        // Sits right under the event description, above the apply form —
        // "complete these before you apply".
        if (detail) detail.after(section);
        else applySection.before(section);

        const list = section.querySelector('#js-docs-list');

        function urlFor(d) {
            return db.storage.from(DOC_BUCKET)
                .getPublicUrl(d.file_path, { download: d.file_name }).data.publicUrl;
        }

        function render() {
            if (!docs.length && !isAdmin) { section.remove(); return; }
            list.innerHTML = docs.map(d => `
                <li class="event-docs__item">
                    <span class="event-docs__file-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </span>
                    <span class="event-docs__meta">
                        <span class="event-docs__name">${esc(d.file_name)}</span>
                        ${d.description ? `<span class="event-docs__desc">${esc(d.description)}</span>` : ''}
                    </span>
                    <a class="event-docs__dl" href="${esc(urlFor(d))}" target="_blank" rel="noopener">Download</a>
                    ${isAdmin ? `<button type="button" class="event-docs__del" data-id="${esc(String(d.id))}" title="Remove" aria-label="Remove document">&times;</button>` : ''}
                </li>`).join('') || `<li class="event-docs__empty">No documents yet.</li>`;
        }
        render();

        if (isAdmin) {
            list.addEventListener('click', async e => {
                const del = e.target.closest('.event-docs__del');
                if (!del) return;
                if (!confirm('Remove this document?')) return;
                const id  = del.dataset.id;
                const doc = docs.find(d => String(d.id) === String(id));
                const { error: delErr } = await db.from('event_documents').delete().eq('id', id);
                if (delErr) { alert('Could not remove: ' + delErr.message); return; }
                if (doc) db.storage.from(DOC_BUCKET).remove([doc.file_path]); // best-effort
                docs = docs.filter(d => String(d.id) !== String(id));
                render();
            });

            const addBtn = section.querySelector('#js-docs-add');
            const input  = section.querySelector('#js-docs-input');
            addBtn.addEventListener('click', () => input.click());
            input.addEventListener('change', async e => {
                const file = e.target.files[0];
                e.target.value = '';
                if (!file) return;

                const ext = (file.name.split('.').pop() || '').toLowerCase();
                if (!DOC_EXTS.includes(ext)) { alert('Allowed types: PDF, Word, Excel, TXT, PNG, JPG.'); return; }
                if (file.size > DOC_MAX)     { alert('File must be under 20MB.'); return; }

                const note = (prompt('Short note for this document (optional) e.g. "requires guardian signature"') || '').trim();

                const label = addBtn.textContent;
                addBtn.disabled = true;
                addBtn.textContent = 'Uploading…';

                const path = `documents/${event.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                const { error: upErr } = await db.storage.from(DOC_BUCKET).upload(path, file, { upsert: true });
                if (upErr) {
                    alert('Upload failed: ' + upErr.message);
                } else {
                    const nextOrder = docs.length ? Math.max(...docs.map(d => d.sort_order || 0)) + 1 : 0;
                    const { data: inserted, error: insErr } = await db.from('event_documents')
                        .insert({ event_id: event.id, file_path: path, file_name: file.name, description: note || null, sort_order: nextOrder })
                        .select().single();
                    if (insErr) alert('Could not save document: ' + insErr.message);
                    else { docs.push(inserted); render(); }
                }
                addBtn.disabled = false;
                addBtn.textContent = label;
            });
        }
    }

    if (!isAdmin) return;

    titleEl.contentEditable    = 'true';
    descEl.contentEditable     = 'true';
    outcomesEl.contentEditable = 'true';

    descEl.dataset.placeholder     = 'Click to add a description…';
    outcomesEl.dataset.placeholder = 'Click to add learning outcomes…';

    const imgBtn = document.getElementById('js-img-btn');
    imgBtn.hidden = false;

    // The overlay topnav floats on top of the hero, so this button needs to
    // sit below it (plus the admin bar, when present) instead of at a fixed
    // 16px from the hero's own top edge.
    function positionImgBtn() {
        const nav = document.querySelector('.topnav');
        if (nav) imgBtn.style.top = `${nav.getBoundingClientRect().height + 12}px`;
    }
    positionImgBtn();
    window.addEventListener('resize', positionImgBtn);

    // Let mods change the event's slug — which is what actually forms the
    // page's URL (/event/?slug=…) — right from the hero. Not offered on the
    // unlisted /step page (no #js-slug there): that page's URL is a
    // hardcoded folder, not a query param, so renaming the underlying row's
    // slug would just break its own lookup.
    let currentSlug = event.slug || '';
    const slugEl = document.getElementById('js-slug');

    function slugify(str) {
        return String(str || '').toLowerCase().trim()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    if (slugEl) {
        slugEl.hidden = false;
        renderSlugDisplay();
    }

    function renderSlugDisplay() {
        if (currentSlug) {
            slugEl.innerHTML = `URL: /event/?slug=<span class="event-hero__slug--editable" id="js-slug-edit" title="Click to change this event's URL"></span>`;
            slugEl.querySelector('#js-slug-edit').textContent = currentSlug;
        } else {
            slugEl.innerHTML = `Temporary URL: /event/?id=${esc(event.id)} — <span class="event-hero__slug--editable" id="js-slug-edit" title="Click to set a custom URL">set a custom URL</span>`;
        }
        slugEl.querySelector('#js-slug-edit').addEventListener('click', startSlugEdit);
    }

    function startSlugEdit() {
        const input = document.createElement('input');
        input.type      = 'text';
        input.className = 'event-hero__slug-input';
        input.value     = currentSlug;
        slugEl.textContent = 'URL: /event/?slug=';
        slugEl.appendChild(input);
        input.focus();
        input.select();

        let done = false;
        const commit = () => {
            if (done) return;
            done = true;
            const normalized = slugify(input.value); // '' clears back to the temporary id-based URL
            if (normalized !== currentSlug) {
                currentSlug = normalized;
                markDirty();
            }
            renderSlugDisplay();
        };
        input.addEventListener('blur', commit, { once: true });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') { done = true; renderSlugDisplay(); }
        });
    }

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
    let isDirty         = false;
    let pendingImgFiles = null; // [desktop, square, portrait] Files once a new crop is chosen
    let currentImgUrl         = event.image_url          || null;
    let currentImgUrlMobile   = event.image_url_mobile    || null;
    let currentImgUrlPortrait = event.image_url_portrait  || null;

    function markDirty() {
        if (isDirty) return;
        isDirty = true;
        saveBar.hidden = false;
        document.body.style.paddingBottom = '72px';
    }

    titleEl.addEventListener('input',    markDirty);
    descEl.addEventListener('input',     markDirty);
    outcomesEl.addEventListener('input', markDirty);

    document.getElementById('js-img-input').addEventListener('change', async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file || !validateImageFile(file, e.target)) return;

        // Three crops, not two — the event's own hero (desktop 16:9, mobile
        // square) plus a dedicated portrait crop for wherever this event
        // shows up 9:16, namely the home page carousel's mobile slides.
        // That used to just reuse the square crop there, cover-fit into a
        // much narrower box — cropping further in an unpredictable way the
        // person setting the image never actually saw or chose.
        const crops = await window.openMultiImageCropper(file, [
            { aspect: 1920 / 1080, outputWidth: 1920, outputHeight: 1080, label: 'Desktop (16:9)' },
            { aspect: 1,           outputWidth: 1080, outputHeight: 1080, label: 'Mobile square (event page)' },
            { aspect: 9 / 16,      outputWidth: 1080, outputHeight: 1920, label: 'Mobile portrait (home page carousel)' },
        ]);
        if (!crops) return;

        pendingImgFiles = crops;
        bgEl.style.setProperty('--hero-bg-desktop', `url('${URL.createObjectURL(crops[0])}')`);
        bgEl.style.setProperty('--hero-bg-mobile',  `url('${URL.createObjectURL(crops[1])}')`);
        markDirty();
    });

    titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });

    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        if (slugEl && currentSlug && currentSlug !== event.slug) {
            const { data: clash } = await db
                .from('events').select('id').eq('slug', currentSlug).neq('id', event.id).maybeSingle();
            if (clash) {
                alert(`The URL "/event/?slug=${currentSlug}" is already taken by another event. Choose a different one.`);
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save Changes';
                return;
            }
        }

        if (pendingImgFiles) {
            const stamp = Date.now();
            const [desktopUp, squareUp, portraitUp] = await Promise.all([
                db.storage.from('event-images').upload(`${stamp}-${event.id}.jpg`, pendingImgFiles[0], { upsert: true }),
                db.storage.from('event-images').upload(`${stamp}-${event.id}-mobile.jpg`, pendingImgFiles[1], { upsert: true }),
                db.storage.from('event-images').upload(`${stamp}-${event.id}-portrait.jpg`, pendingImgFiles[2], { upsert: true }),
            ]);

            if (desktopUp.error || squareUp.error || portraitUp.error) {
                alert('Image upload failed: ' + (desktopUp.error || squareUp.error || portraitUp.error).message);
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save Changes';
                return;
            }
            currentImgUrl         = db.storage.from('event-images').getPublicUrl(desktopUp.data.path).data.publicUrl;
            currentImgUrlMobile   = db.storage.from('event-images').getPublicUrl(squareUp.data.path).data.publicUrl;
            currentImgUrlPortrait = db.storage.from('event-images').getPublicUrl(portraitUp.data.path).data.publicUrl;
            pendingImgFiles = null;
        }

        const { error } = await db.from('events').update({
            title:             titleEl.textContent.trim(),
            slug:              currentSlug || null,
            description:       descEl.innerHTML.trim()     || null,
            learning_outcomes: outcomesEl.innerHTML.trim() || null,
            image_url:          currentImgUrl,
            image_url_mobile:   currentImgUrlMobile,
            image_url_portrait: currentImgUrlPortrait,
            event_type:        currentEventType || 'single-day',
            event_date:        currentEventDate || null,
            event_end_date:    currentEventType !== 'single-day' ? (currentEventEndDate || null) : null,
            event_time:        currentEventTime || null,
            event_end_time:    currentEventEndTime || null,
            venue:             currentEventVenue || null,
            price:             currentEventPrice || null,
        }).eq('id', event.id);

        if (error) {
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save Changes';
            alert('Save failed: ' + error.message);
            return;
        }

        // If the URL this event lives at just changed (slug set, changed,
        // or cleared back to the temporary id-based one), jump there
        // instead of showing "Saved" on a page whose own address bar no
        // longer matches what's actually loaded. Not relevant on /step,
        // which doesn't offer this editor at all (no slugEl).
        if (slugEl) {
            const newUrl = currentSlug
                ? `/event/?slug=${encodeURIComponent(currentSlug)}`
                : `/event/?id=${encodeURIComponent(event.id)}`;
            if (newUrl !== window.location.pathname + window.location.search) {
                window.location.href = newUrl;
                return;
            }
        }

        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Changes';
        isDirty = false;
        saveBar.querySelector('.edit-savebar__msg').textContent = 'Saved ✓';
        document.title = `${titleEl.textContent.trim()}`;
        setTimeout(() => {
            saveBar.hidden = true;
            saveBar.querySelector('.edit-savebar__msg').textContent = 'Unsaved changes';
            document.body.style.paddingBottom = '';
            isDirty = false;
        }, 2000);
    });

})();
