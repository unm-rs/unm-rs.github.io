(async function () {
    window.initHeroImage?.('home', {
        top:    { aspect: 16 / 9, outputWidth: 1920, outputHeight: 1080, label: 'Desktop (16:9)' },
        bottom: { aspect: 9 / 16, outputWidth: 1080, outputHeight: 1920, label: 'Mobile (9:16)' },
    });

    const collage = document.getElementById('js-events-collage');
    if (!collage) return;

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const { data: events, error } = await db
        .from('events')
        .select('id, title, slug, image_url, image_url_mobile, event_date, scpd_points, is_major')
        .or(`event_date.is.null,event_date.gte.${todayStr}`)
        .order('event_date', { ascending: true });

    if (error) {
        collage.innerHTML = '<p style="color:hsl(0 0% 70%);padding:40px 24px">Failed to load events.</p>';
        console.error(error);
        return;
    }

    if (!events || events.length === 0) {
        collage.innerHTML = '<p style="color:hsl(0 0% 70%);padding:40px 24px;text-align:center;">hang tight lil bro, more coming soon</p>';
        return;
    }

    // Build repeating "small, small, big" groups, giving is_major events
    // first dibs on the big slot. Whatever's left over (fewer than 3, not
    // enough to justify another full repetition of the pattern) is just
    // shown as a plain row of small tiles instead of forcing an empty gap.
    const majors = events.filter(ev => ev.is_major);
    const minors = events.filter(ev => !ev.is_major);
    let mi = 0, ni = 0; // pointers into majors / minors

    function nextBig()   { return mi < majors.length ? majors[mi++] : (ni < minors.length ? minors[ni++] : null); }
    function nextSmall()  { return ni < minors.length ? minors[ni++] : (mi < majors.length ? majors[mi++] : null); }
    function remaining() { return (majors.length - mi) + (minors.length - ni); }

    const groups = [];
    let groupIndex = 0;
    while (remaining() >= 3) {
        groups.push({
            type: 'full',
            reverse: groupIndex % 2 === 1,
            small: [nextSmall(), nextSmall()],
            big: nextBig(),
        });
        groupIndex++;
    }
    if (remaining() > 0) {
        const leftovers = [];
        while (remaining() > 0) leftovers.push(nextSmall());
        groups.push({ type: 'solo', items: leftovers });
    }

    collage.innerHTML = groups.map(group => {
        if (group.type === 'solo') {
            return `<div class="collage__solo">${group.items.map(ev => tile(ev, 'small')).join('')}</div>`;
        }
        return `
            <div class="collage__group${group.reverse ? ' collage__group--reverse' : ''}">
                <div class="collage__stack">
                    ${tile(group.small[0], 'small')}
                    ${tile(group.small[1], 'small')}
                </div>
                ${tile(group.big, 'big')}
            </div>`;
    }).join('');

    function tile(ev, size) {
        const isBig = size === 'big';
        const img = isBig ? ev.image_url : (ev.image_url_mobile || ev.image_url);
        return `
            <a href="/event.html?slug=${encodeURIComponent(ev.slug)}" class="collage-tile collage-tile--${size}" data-event-id="${esc(ev.id)}">
                <div class="collage-tile__img-wrap">
                    ${img ? `<img src="${esc(img)}" alt="" class="collage-tile__img" loading="lazy">`
                          : `<div class="collage-tile__img-placeholder" aria-hidden="true"></div>`}
                </div>
                <div class="collage-tile__body">
                    <h3 class="collage-tile__title">${esc(ev.title)}</h3>
                    <span class="ep-card__scpd">
                        <span class="ep-card__scpd-label">S-CPD points</span><span class="ep-card__scpd-value">${ev.scpd_points ?? 0}</span>
                    </span>
                </div>
            </a>`;
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
})();
