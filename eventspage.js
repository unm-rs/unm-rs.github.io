(async function () {
    if (typeof db === 'undefined') return;

    window.initHeroImage?.('events');

    const [groupsRes, eventsRes, { isAdmin }] = await Promise.all([
        db.from('event_groups').select('*').order('sort_order'),
        db.from('events').select('*').order('event_date', { ascending: false, nullsFirst: false }),
        window.roleReady,
    ]);

    let groups = groupsRes.data || [];
    let events = eventsRes.data || [];

    let selectedGroupId = groups[0]?.id ?? null;

    const STATUS_LABEL      = { upcoming: 'Upcoming', coming_soon: 'Coming Soon', completed: 'Completed' };
    const STATUS_NEXT       = { upcoming: 'coming_soon', coming_soon: 'completed', completed: 'upcoming' };
    const STATUS_NEXT_LABEL = { upcoming: 'Mark Coming Soon', coming_soon: 'Mark Completed', completed: 'Mark Upcoming' };

    document.getElementById('js-ep-loading')?.remove();

    renderGroupTabs();
    renderEvents();

    function renderGroupTabs() {
        const tabsEl = document.getElementById('js-years-tabs');
        tabsEl.innerHTML = '';

        groups.forEach((grp, idx) => {
            const tab = document.createElement('button');
            tab.className   = 'ep-year-tab' + (grp.id === selectedGroupId ? ' ep-year-tab--active' : '');
            tab.role        = 'tab';
            tab.setAttribute('aria-selected', grp.id === selectedGroupId);
            tab.dataset.idx = idx;

            if (isAdmin) {
                tab.draggable = true;
                tab.innerHTML = `
                    <span class="ep-year-tab__grip" aria-hidden="true">
                        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" opacity="0.4">
                            <circle cx="3" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/>
                            <circle cx="3" cy="7" r="1.5"/><circle cx="7" cy="7" r="1.5"/>
                            <circle cx="3" cy="12" r="1.5"/><circle cx="7" cy="12" r="1.5"/>
                        </svg>
                    </span>
                    <span class="ep-year-tab__label" data-role="label">${esc(grp.name)}</span>
                    <button class="ep-year-tab__del" aria-label="Remove ${esc(grp.name)}">×</button>`;

                tab.querySelector('.ep-year-tab__label').addEventListener('dblclick', e => {
                    e.stopPropagation();
                    renameGroup(grp, tab);
                });
                tab.querySelector('.ep-year-tab__del').addEventListener('click', e => {
                    e.stopPropagation();
                    removeGroup(grp);
                });

                setupDrag(tab, idx);
            } else {
                tab.textContent = grp.name;
            }

            tab.addEventListener('click', e => {
                if (e.target.closest('.ep-year-tab__del')) return;
                selectedGroupId = grp.id;
                renderGroupTabs();
                renderEvents();
            });

            tabsEl.appendChild(tab);
        });

        if (isAdmin) {
            const addBtn = document.createElement('button');
            addBtn.className   = 'ep-year-tab ep-year-tab--add';
            addBtn.textContent = '+ Group';
            addBtn.addEventListener('click', openAddGroup);
            tabsEl.appendChild(addBtn);
        }

        if (!groups.length) {
            tabsEl.insertAdjacentHTML('beforeend',
                '<p class="ep-catalogue-empty" style="padding-block:8px">Nothing here. Add a year to start organizing events.</p>');
        }
    }

    let dragSrcIdx = null;

    function setupDrag(tab, idx) {
        tab.addEventListener('dragstart', e => {
            dragSrcIdx = idx;
            tab.classList.add('ep-year-tab--dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', idx);
        });

        tab.addEventListener('dragend', () => {
            tab.classList.remove('ep-year-tab--dragging');
            document.querySelectorAll('.ep-year-tab--dragover').forEach(el => el.classList.remove('ep-year-tab--dragover'));
        });

        tab.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragSrcIdx !== idx) tab.classList.add('ep-year-tab--dragover');
        });

        tab.addEventListener('dragleave', () => tab.classList.remove('ep-year-tab--dragover'));

        tab.addEventListener('drop', async e => {
            e.preventDefault();
            tab.classList.remove('ep-year-tab--dragover');
            if (dragSrcIdx === null || dragSrcIdx === idx) return;

            const [moved] = groups.splice(dragSrcIdx, 1);
            groups.splice(idx, 0, moved);
            dragSrcIdx = null;

            renderGroupTabs();

            await Promise.all(
                groups.map((g, i) => db.from('event_groups').update({ sort_order: i }).eq('id', g.id))
            );
        });
    }

    function openAddGroup() {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:340px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Add Group</h2>
                    <button class="ab-modal__close" id="ep-ayclose">✕</button>
                </div>
                <form class="ab-form" id="ep-ay-form">
                    <div class="ab-field">
                        <label class="ab-label">Name</label>
                        <input class="ab-input" id="ep-ayname" type="text"
                               placeholder="e.g. Semester 1 2026" maxlength="60" required>
                    </div>
                    <div id="ep-ayerr" class="ab-error" hidden></div>
                    <div class="ab-form-actions">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary">Add Group</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('#ep-ayname').focus();

        const close = () => overlay.remove();
        overlay.querySelector('#ep-ayclose').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        overlay.querySelector('#ep-ay-form').addEventListener('submit', async e => {
            e.preventDefault();
            const name  = overlay.querySelector('#ep-ayname').value.trim();
            const errEl = overlay.querySelector('#ep-ayerr');
            if (!name) return;

            const { data: newGroup, error } = await db
                .from('event_groups')
                .insert({ name, sort_order: groups.length })
                .select()
                .single();

            if (error) {
                errEl.textContent = error.message;
                errEl.hidden = false;
                return;
            }

            groups.push(newGroup);
            selectedGroupId = newGroup.id;
            close();
            renderGroupTabs();
            renderEvents();
        });
    }

    function renameGroup(grp, tab) {
        const labelEl = tab.querySelector('[data-role="label"]');
        const input = document.createElement('input');
        input.type  = 'text';
        input.className = 'ep-year-tab__rename';
        input.value = grp.name;
        input.maxLength = 60;
        labelEl.replaceWith(input);
        input.focus();
        input.select();

        let done = false;
        const commit = async () => {
            if (done) return;
            done = true;
            const name = input.value.trim() || grp.name;
            grp.name = name;
            const { error } = await db.from('event_groups').update({ name }).eq('id', grp.id);
            if (error) alert(error.message);
            renderGroupTabs();
        };
        input.addEventListener('blur', commit, { once: true });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') { done = true; renderGroupTabs(); }
        });
        input.addEventListener('click', e => e.stopPropagation());
    }

    async function removeGroup(grp) {
        const count = getGroupEvents(grp.id).length;
        const msg   = count
            ? `Remove "${grp.name}"?\n\n${count} event(s) will become unassigned but won't be deleted.`
            : `Remove "${grp.name}"?`;

        if (!confirm(msg)) return;

        const { error } = await db.from('event_groups').delete().eq('id', grp.id);
        if (error) { alert(error.message); return; }

        groups = groups.filter(g => g.id !== grp.id);
        events.forEach(ev => { if (ev.group_id === grp.id) ev.group_id = null; });
        if (selectedGroupId === grp.id) selectedGroupId = groups[0]?.id ?? null;
        renderGroupTabs();
        renderEvents();
    }

    function getGroupEvents(groupId) {
        return events.filter(ev => ev.group_id === groupId);
    }

    function renderEvents() {
        const grid  = document.getElementById('js-events-grid');
        const items = selectedGroupId ? getGroupEvents(selectedGroupId) : [];

        const sorted = [...items].sort((a, b) => {
            if (a.event_date && b.event_date) return new Date(a.event_date) - new Date(b.event_date);
            if (a.event_date) return -1;
            if (b.event_date) return 1;
            return 0;
        });

        grid.innerHTML = '';

        if (!sorted.length && !isAdmin) {
            grid.style.display = 'block';
            grid.innerHTML = `
                <div class="ep-empty-state">
                    <p class="ep-empty">No events here yet.</p>
                </div>`;
            return;
        }

        grid.style.display = '';
        sorted.forEach(ev => grid.appendChild(buildCard(ev)));

        if (isAdmin && selectedGroupId) {
            const addCard = document.createElement('button');
            addCard.className = 'ep-add-card';
            addCard.innerHTML = `
                <span class="ep-add-card__icon">+</span>
                <span class="ep-add-card__label">Add from catalogue</span>`;
            addCard.addEventListener('click', openCatalogue);
            grid.appendChild(addCard);
        }
    }

    function buildCard(ev) {
        const status = ev.status || 'upcoming';

        const fmtDate = d => new Date(d).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric',
        });

        const isRange = ev.event_type && ev.event_type !== 'single-day';
        const dateStr = ev.event_date
            ? (isRange && ev.event_end_date
                ? `${fmtDate(ev.event_date)} - ${fmtDate(ev.event_end_date)}`
                : fmtDate(ev.event_date))
            : null;

        const card = document.createElement('article');
        card.className  = `ep-card ep-card--${status}`;
        card.dataset.id = ev.id;

        card.innerHTML = `
            <a href="/event.html?slug=${encodeURIComponent(ev.slug)}" class="ep-card__link">
                <div class="ep-card__img-wrap">
                    ${ev.image_url
                        ? `<img class="ep-card__img" src="${esc(ev.image_url)}" alt="${esc(ev.title)}" loading="lazy">`
                        : `<div class="ep-card__img-placeholder" aria-hidden="true"></div>`
                    }
                    <span class="ep-card__badge ep-card__badge--${status}">${STATUS_LABEL[status]}</span>
                </div>
                <div class="ep-card__body">
                    <h2 class="ep-card__title">${esc(ev.title)}</h2>
                    ${dateStr ? `<p class="ep-card__date">${dateStr}</p>` : ''}
                </div>
            </a>
            <span class="ep-card__scpd"${isAdmin ? ' tabindex="0" role="button"' : ''}>
                <span class="ep-card__scpd-label">S-CPD points</span><span class="ep-card__scpd-value">${ev.scpd_points ?? 0}</span>
            </span>`;

        if (isAdmin) {
            const ctrl = document.createElement('div');
            ctrl.className = 'ep-card__admin';
            ctrl.innerHTML = `
                <button class="ep-card__ctrl ep-card__ctrl--status">
                    ${STATUS_NEXT_LABEL[status]}
                </button>
                <select class="ep-card__ctrl ep-card__ctrl--year" aria-label="Move to group">
                    <option value="">— unassign —</option>
                    ${groups.map(g =>
                        `<option value="${esc(g.id)}"${g.id === ev.group_id ? ' selected' : ''}>${esc(g.name)}</option>`
                    ).join('')}
                </select>
                <button class="ep-card__ctrl ep-card__ctrl--del">Delete</button>`;

            ctrl.querySelector('.ep-card__ctrl--status').addEventListener('click', async () => {
                const next = STATUS_NEXT[status];
                const { error } = await db.from('events').update({ status: next }).eq('id', ev.id);
                if (error) { alert(error.message); return; }
                const idx = events.findIndex(e => e.id === ev.id);
                if (idx !== -1) events[idx].status = next;
                card.replaceWith(buildCard({ ...ev, status: next }));
            });

            ctrl.querySelector('.ep-card__ctrl--year').addEventListener('change', async e => {
                const val        = e.target.value;
                const newGroupId = val === '' ? null : val;
                const { error } = await db.from('events').update({ group_id: newGroupId }).eq('id', ev.id);
                if (error) { alert(error.message); e.target.value = ev.group_id ?? ''; return; }
                const idx = events.findIndex(e => e.id === ev.id);
                if (idx !== -1) events[idx].group_id = newGroupId;
                if (newGroupId !== selectedGroupId) {
                    card.remove();
                    const grid = document.getElementById('js-events-grid');
                    if (!grid.querySelector('.ep-card')) renderEvents();
                }
            });

            ctrl.querySelector('.ep-card__ctrl--del').addEventListener('click', async () => {
                if (!confirm(`Delete "${ev.title}"?\n\nThis cannot be undone.`)) return;
                const { error } = await db.from('events').delete().eq('id', ev.id);
                if (error) { alert(error.message); return; }
                events = events.filter(e => e.id !== ev.id);
                card.remove();
                const grid = document.getElementById('js-events-grid');
                if (!grid.querySelector('.ep-card')) renderEvents();
            });

            card.appendChild(ctrl);

            const scpdEl = card.querySelector('.ep-card__scpd');
            const editScpd = () => {
                const input = document.createElement('input');
                input.type  = 'number';
                input.min   = '0';
                input.className = 'ep-card__scpd-input';
                input.value = ev.scpd_points ?? 0;
                scpdEl.replaceWith(input);
                input.focus();
                input.select();

                let done = false;
                const commit = async () => {
                    if (done) return;
                    done = true;
                    const points = Math.max(0, parseInt(input.value, 10) || 0);
                    const { error } = await db.from('events').update({ scpd_points: points }).eq('id', ev.id);
                    if (error) { alert(error.message); card.replaceWith(buildCard(ev)); return; }
                    const idx = events.findIndex(e => e.id === ev.id);
                    if (idx !== -1) events[idx].scpd_points = points;
                    card.replaceWith(buildCard({ ...ev, scpd_points: points }));
                };
                input.addEventListener('blur', commit, { once: true });
                input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
            };
            scpdEl.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); editScpd(); });
            scpdEl.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editScpd(); }
            });
        }

        return card;
    }

    async function openCatalogue() {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal ep-cat-modal">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Event Catalogue</h2>
                    <button class="ab-modal__close" id="ep-cc">✕</button>
                </div>
                <div class="ep-catalogue-grid" id="ep-cat-grid">
                    <p class="ep-catalogue-empty">Loading…</p>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('#ep-cc').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        const { data: catItems, error } = await db
            .from('events')
            .select('*')
            .is('group_id', null)
            .order('title');

        const catGrid = overlay.querySelector('#ep-cat-grid');

        if (error) {
            catGrid.innerHTML = `<p class="ep-catalogue-empty" style="color:hsl(5,70%,50%)">${esc(error.message)}</p>`;
            return;
        }

        if (!catItems || catItems.length === 0) {
            catGrid.innerHTML = `
                <p class="ep-catalogue-empty">
                    No unassigned events.<br>
                    Use <strong>Add Event</strong> in the admin bar to create one first.
                </p>`;
            return;
        }

        catGrid.innerHTML = catItems.map(ev => `
            <button class="ep-cat-item" data-id="${esc(ev.id)}">
                ${ev.image_url
                    ? `<img class="ep-cat-item__thumb" src="${esc(ev.image_url)}" alt="${esc(ev.title)}">`
                    : `<div class="ep-cat-item__thumb ep-cat-item__thumb--empty"></div>`}
                <div class="ep-cat-item__info">
                    <p class="ep-cat-item__title">${esc(ev.title)}</p>
                    <p class="ep-cat-item__meta">${
                        ev.event_date
                            ? new Date(ev.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                            : 'No date set'
                    }</p>
                </div>
            </button>`).join('');

        catGrid.querySelectorAll('.ep-cat-item').forEach(btn => {
            btn.addEventListener('click', async () => {
                const evId = btn.dataset.id;
                btn.disabled = true;
                btn.classList.add('ep-cat-item--loading');

                const { data: updated, error } = await db.from('events')
                    .update({ group_id: selectedGroupId })
                    .eq('id', evId)
                    .select('id, group_id')
                    .single();

                if (error || !updated || updated.group_id !== selectedGroupId) {
                    alert(error ? error.message : `Assignment failed — the event group did not update. Check your Supabase RLS policy for the events table (UPDATE permission).`);
                    btn.disabled = false;
                    btn.classList.remove('ep-cat-item--loading');
                    return;
                }

                const idStr = String(evId);
                const catEv = catItems.find(e => String(e.id) === idStr);
                if (catEv) {
                    const existingIdx = events.findIndex(e => String(e.id) === idStr);
                    if (existingIdx !== -1) {
                        events[existingIdx].group_id = selectedGroupId;
                    } else {
                        events.push({ ...catEv, group_id: selectedGroupId });
                    }
                }

                close();
                renderEvents();
            });
        });
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
