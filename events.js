(async function () {
    window.initHeroImage?.('home', {
        top:    { aspect: 16 / 9, outputWidth: 1920, outputHeight: 1080, label: 'Desktop (16:9)' },
        bottom: { aspect: 9 / 16, outputWidth: 1080, outputHeight: 1920, label: 'Mobile (9:16)' },
    });

    const track   = document.getElementById('js-events-track');
    const dotsEl  = document.getElementById('js-events-dots');
    const prevBtn = document.getElementById('js-events-prev');
    const nextBtn = document.getElementById('js-events-next');
    if (!track) return;

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const { data: events, error } = await db
        .from('events')
        .select('id, title, slug, image_url, image_url_mobile, image_url_portrait, event_date, scpd_points')
        // Ungrouped events (the eventspage "catalogue") are never shown on
        // any public tab — this carousel shouldn't surface them either.
        .not('group_id', 'is', null)
        .or(`event_date.is.null,event_date.gte.${todayStr}`)
        .order('event_date', { ascending: true });

    if (error) {
        track.innerHTML = '<p style="color:hsl(0 0% 40%);padding:40px 24px">Failed to load events.</p>';
        console.error(error);
        return;
    }

    if (!events || events.length === 0) {
        track.innerHTML = '<p style="color:hsl(0 0% 40%);padding:40px 24px;text-align:center;width:100%;">hang tight lil bro, more coming soon</p>';
        if (dotsEl) dotsEl.hidden = true;
        return;
    }

    function formatEyebrow(ev) {
        if (ev.event_date) {
            return new Date(ev.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        }
        return `S-CPD points · ${ev.scpd_points ?? 0}`;
    }

    function slideHtml(ev, realIndex, isClone) {
        const href = ev.slug ? `/event/?slug=${encodeURIComponent(ev.slug)}` : `/event/?id=${encodeURIComponent(ev.id)}`;
        return `
            <a href="${href}" class="events__slide" data-real-index="${realIndex}"${isClone ? ' aria-hidden="true" tabindex="-1"' : ''}>
                <div class="events__slide-img-wrap">
                    ${ev.image_url
                        ? (() => {
                            // Slides are 9:16 on mobile, not the 1:1 square
                            // used elsewhere (event page, eventspage
                            // collage) — image_url_portrait is a crop made
                            // specifically for that; fall back to the
                            // square crop for events set up before that
                            // existed, rather than showing nothing.
                            const mobileSrc = ev.image_url_portrait || ev.image_url_mobile;
                            return `<picture>
                                ${mobileSrc ? `<source media="(max-width: 700px)" srcset="${esc(mobileSrc)}">` : ''}
                                <img class="events__slide-img" src="${esc(ev.image_url)}" alt="">
                               </picture>`;
                        })()
                        : `<div class="events__slide-img-placeholder" aria-hidden="true"></div>`}
                </div>
                <div class="events__slide-overlay"></div>
                <div class="events__slide-body">
                    <p class="events__slide-eyebrow">${esc(formatEyebrow(ev))}</p>
                    <h3 class="events__slide-title">${esc(ev.title)}</h3>
                    <span class="events__slide-cta">View Event</span>
                </div>
            </a>`;
    }

    const n = events.length;
    const loop = n > 1;

    // For a continuous loop, pad the real slides with a clone of the last
    // one at the very start and a clone of the first one at the very end.
    // Scrolling past a clone silently snaps back to its real counterpart
    // once the scroll settles — invisible since the clone looks identical.
    track.innerHTML = loop
        ? slideHtml(events[n - 1], n - 1, true)
          + events.map((ev, i) => slideHtml(ev, i, false)).join('')
          + slideHtml(events[0], 0, true)
        : events.map((ev, i) => slideHtml(ev, i, false)).join('');

    const slides = Array.from(track.querySelectorAll('.events__slide'));
    // DOM index of each real slide N is (loop ? N + 1 : N).
    const domOffset = loop ? 1 : 0;

    // Slide width is now derived from its height (see CSS), not a fixed
    // value, so the inline padding needed to center the first/last slide
    // has to be measured from the real rendered width instead of being a
    // hardcoded CSS calc().
    function updateTrackPadding() {
        if (!slides.length) return;
        const pad = Math.max(0, (track.clientWidth - slides[0].offsetWidth) / 2);
        track.style.paddingInline = `${pad}px`;
    }
    updateTrackPadding();

    if (dotsEl) {
        dotsEl.hidden = n <= 1;
        dotsEl.innerHTML = events
            .map((_, i) => `<button type="button" class="events__dot" data-index="${i}" aria-label="Go to event ${i + 1}"></button>`)
            .join('');
    }
    const dots = dotsEl ? Array.from(dotsEl.querySelectorAll('.events__dot')) : [];

    if (prevBtn) prevBtn.hidden = n <= 1;
    if (nextBtn) nextBtn.hidden = n <= 1;

    let currentDomIndex = domOffset;

    function highlightDot(domIndex) {
        const realIndex = Number(slides[domIndex]?.dataset.realIndex ?? 0);
        dots.forEach((d, idx) => d.classList.toggle('is-active', idx === realIndex));
    }

    function centerOf(slide) {
        return slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2;
    }

    // Instant, unanimated re-centering — used only to silently swap a
    // clone for its real counterpart, so the loop never shows a visible
    // jump.
    function snapTo(domIndex) {
        currentDomIndex = domIndex;
        track.style.scrollBehavior = 'auto';
        track.scrollLeft = centerOf(slides[domIndex]);
        requestAnimationFrame(() => { track.style.scrollBehavior = ''; });
        highlightDot(domIndex);
    }

    function goTo(domIndex) {
        domIndex = Math.max(0, Math.min(slides.length - 1, domIndex));
        slides[domIndex].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }

    function closestDomIndex() {
        const trackRect   = track.getBoundingClientRect();
        const trackCenter = trackRect.left + trackRect.width / 2;
        let closest = currentDomIndex, closestDist = Infinity;
        slides.forEach((s, i) => {
            const r      = s.getBoundingClientRect();
            const dist   = Math.abs((r.left + r.width / 2) - trackCenter);
            if (dist < closestDist) { closestDist = dist; closest = i; }
        });
        return closest;
    }

    let scrollTicking = false;
    function onScroll() {
        currentDomIndex = closestDomIndex();
        highlightDot(currentDomIndex);
    }

    function onScrollSettled() {
        const idx = closestDomIndex();
        if (loop && idx === 0)              { snapTo(slides.length - 2); return; } // clone-of-last -> real last
        if (loop && idx === slides.length - 1) { snapTo(1); return; }              // clone-of-first -> real first
        currentDomIndex = idx;
        highlightDot(idx);
    }

    let settleTimer = null;
    track.addEventListener('scroll', () => {
        if (!scrollTicking) {
            scrollTicking = true;
            requestAnimationFrame(() => { onScroll(); scrollTicking = false; });
        }
        clearTimeout(settleTimer);
        settleTimer = setTimeout(onScrollSettled, 120);
    }, { passive: true });
    track.addEventListener('scrollend', onScrollSettled);
    window.addEventListener('resize', () => { updateTrackPadding(); snapTo(currentDomIndex); });

    dots.forEach(d => d.addEventListener('click', () => goTo(Number(d.dataset.index) + domOffset)));

    if (prevBtn) prevBtn.addEventListener('click', () => goTo(currentDomIndex - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goTo(currentDomIndex + 1));

    // Land on the first real slide immediately, no animation.
    snapTo(domOffset);

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
})();
