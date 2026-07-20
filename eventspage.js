(async function () {
    if (typeof db === 'undefined') return;

    window.initHeroImage?.('events');

    const [yearsRes, eventsRes, { isAdmin }] = await Promise.all([
        db.from('event_years').select('*').order('sort_order'),
        db.from('events').select('*').order('event_date', { ascending: false, nullsFirst: false }),
        window.roleReady,
    ]);

    let years     = yearsRes.data  || [];
    let events    = eventsRes.data || [];

    // Ensure every year present in events has a tab, even if missing from event_years
    // (handles: event_years has some rows but not all, or RLS hides the table from members)
    const dbYearSet = new Set(years.map(y => y.year));
    const eventDerivedYears = [...new Set(
        events
            .map(e => e.year ?? (e.event_date ? new Date(e.event_date).getFullYear() : null))
            .filter(Boolean)
    )];
    eventDerivedYears.forEach(y => {
        if (!dbYearSet.has(y)) years.push({ id: null, year: y, sort_order: years.length });
    });
    if (!years.length) {
        [2023, 2024, 2025, 2026].forEach((y, i) => years.push({ id: null, year: y, sort_order: i }));
    }
    years.sort((a, b) => a.year - b.year);

    const currentYear    = new Date().getFullYear();
    let selectedYear     = years.find(y => y.year === currentYear)?.year
                        || years[years.length - 1]?.year
                        || currentYear;

    const STATUS_LABEL      = { upcoming: 'Upcoming', coming_soon: 'Coming Soon', completed: 'Completed' };
    const STATUS_NEXT       = { upcoming: 'coming_soon', coming_soon: 'completed', completed: 'upcoming' };
    const STATUS_NEXT_LABEL = { upcoming: 'Mark Coming Soon', coming_soon: 'Mark Completed', completed: 'Mark Upcoming' };

    document.getElementById('js-ep-loading')?.remove();

    renderYearTabs();
    renderEvents();

    function renderYearTabs() {
        const tabsEl = document.getElementById('js-years-tabs');
        tabsEl.innerHTML = '';

        years.forEach((yr, idx) => {
            const tab = document.createElement('button');
            tab.className    = 'ep-year-tab' + (yr.year === selectedYear ? ' ep-year-tab--active' : '');
            tab.role         = 'tab';
            tab.setAttribute('aria-selected', yr.year === selectedYear);
            tab.dataset.year = yr.year;
            tab.dataset.idx  = idx;

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
                    <span class="ep-year-tab__label">${yr.year}</span>
                    <button class="ep-year-tab__del" data-year="${yr.year}" aria-label="Remove year ${yr.year}">×</button>`;

                tab.querySelector('.ep-year-tab__del').addEventListener('click', e => {
                    e.stopPropagation();
                    removeYear(yr);
                });

                setupDrag(tab, idx);
            } else {
                tab.textContent = yr.year;
            }

            tab.addEventListener('click', e => {
                if (e.target.classList.contains('ep-year-tab__del')) return;
                selectedYear = yr.year;
                renderYearTabs();
                renderEvents();
            });

            tabsEl.appendChild(tab);
        });

        if (isAdmin) {
            const addBtn = document.createElement('button');
            addBtn.className   = 'ep-year-tab ep-year-tab--add';
            addBtn.textContent = '+ Year';
            addBtn.addEventListener('click', openAddYear);
            tabsEl.appendChild(addBtn);
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

            const [moved] = years.splice(dragSrcIdx, 1);
            years.splice(idx, 0, moved);
            dragSrcIdx = null;

            renderYearTabs();

            await Promise.all(
                years.filter(y => y.id).map((y, i) =>
                    db.from('event_years').update({ sort_order: i }).eq('id', y.id)
                )
            );
        });
    }

    function openAddYear() {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:300px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Add Year</h2>
                    <button class="ab-modal__close" id="ep-ayclose">✕</button>
                </div>
                <form class="ab-form" id="ep-ay-form">
                    <div class="ab-field">
                        <label class="ab-label">Year</label>
                        <input class="ab-input" id="ep-ayyear" type="number"
                               min="2000" max="2099" value="${new Date().getFullYear() + 1}" required>
                    </div>
                    <div id="ep-ayerr" class="ab-error" hidden></div>
                    <div class="ab-form-actions">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary">Add Year</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('#ep-ayyear').focus();

        const close = () => overlay.remove();
        overlay.querySelector('#ep-ayclose').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        overlay.querySelector('#ep-ay-form').addEventListener('submit', async e => {
            e.preventDefault();
            const yr    = parseInt(overlay.querySelector('#ep-ayyear').value);
            const errEl = overlay.querySelector('#ep-ayerr');

            if (years.find(y => y.year === yr)) {
                errEl.textContent = 'That year already exists.';
                errEl.hidden = false;
                return;
            }

            const { data: newYear, error } = await db
                .from('event_years')
                .insert({ year: yr, sort_order: years.length })
                .select()
                .single();

            if (error) {
                errEl.textContent = error.message;
                errEl.hidden = false;
                return;
            }

            years.push(newYear);
            selectedYear = yr;
            close();
            renderYearTabs();
            renderEvents();
        });
    }

    async function removeYear(yr) {
        const count = getYearEvents(yr.year).length;
        const msg   = count
            ? `Remove year ${yr.year}?\n\n${count} event(s) will become unassigned but won't be deleted.`
            : `Remove year ${yr.year}?`;

        if (!confirm(msg)) return;

        if (yr.id) {
            const { error } = await db.from('event_years').delete().eq('id', yr.id);
            if (error) { alert(error.message); return; }
        }

        years = years.filter(y => y.year !== yr.year);
        if (selectedYear === yr.year) selectedYear = years[years.length - 1]?.year;
        renderYearTabs();
        renderEvents();
    }

    function getYearEvents(yr) {
        return events.filter(ev => {
            const evYear = ev.year ?? (ev.event_date ? new Date(ev.event_date).getFullYear() : null);
            return evYear === yr;
        });
    }

    function renderEvents() {
        const grid  = document.getElementById('js-events-grid');
        const items = getYearEvents(selectedYear);

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
                    <p class="ep-empty">No events for ${selectedYear} yet.</p>
                </div>`;
            return;
        }

        grid.style.display = '';
        sorted.forEach(ev => grid.appendChild(buildCard(ev)));

        if (isAdmin) {
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

        const evYear = ev.year ?? (ev.event_date ? new Date(ev.event_date).getFullYear() : null);

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
            </a>`;

        if (isAdmin) {
            const ctrl = document.createElement('div');
            ctrl.className = 'ep-card__admin';
            ctrl.innerHTML = `
                <button class="ep-card__ctrl ep-card__ctrl--status">
                    ${STATUS_NEXT_LABEL[status]}
                </button>
                <select class="ep-card__ctrl ep-card__ctrl--year" aria-label="Move to year">
                    <option value="">— unassign —</option>
                    ${years.map(y =>
                        `<option value="${y.year}"${y.year === evYear ? ' selected' : ''}>${y.year}</option>`
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
                const val     = e.target.value;
                const newYear = val === '' ? null : parseInt(val);
                const { error } = await db.from('events').update({ year: newYear }).eq('id', ev.id);
                if (error) { alert(error.message); e.target.value = evYear ?? ''; return; }
                if (newYear !== selectedYear) {
                    card.remove();
                    const grid = document.getElementById('js-events-grid');
                    if (!grid.querySelector('.ep-card')) renderEvents();
                }
                const { data: fresh } = await db
                    .from('events')
                    .select('*')
                    .order('event_date', { ascending: false, nullsFirst: false });
                if (fresh) events = fresh;
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
            .is('year', null)
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
                    .update({ year: selectedYear })
                    .eq('id', evId)
                    .select('id, year')
                    .single();

                if (error || !updated || updated.year !== selectedYear) {
                    alert(error ? error.message : `Assignment failed — the event year did not update. Check your Supabase RLS policy for the events table (UPDATE permission).`);
                    btn.disabled = false;
                    btn.classList.remove('ep-cat-item--loading');
                    return;
                }

                // Use String() so integer IDs from the DB match the string from dataset
                const idStr = String(evId);
                const catEv = catItems.find(e => String(e.id) === idStr);
                if (catEv) {
                    const existingIdx = events.findIndex(e => String(e.id) === idStr);
                    if (existingIdx !== -1) {
                        events[existingIdx].year = selectedYear;
                    } else {
                        events.push({ ...catEv, year: selectedYear });
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
