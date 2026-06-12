(async function () {
    const track   = document.querySelector('.events__track');
    const prevBtn = document.querySelector('.events__btn--prev');
    const nextBtn = document.querySelector('.events__btn--next');
    if (!track) return;

    const { data: events, error } = await db
        .from('events')
        .select('id, title, slug, image_url')
        .order('event_date', { ascending: true });

    if (error) {
        track.innerHTML = '<p style="color:hsl(0 0% 70%);padding:40px 24px">Failed to load events.</p>';
        console.error(error);
        return;
    }

    if (!events || events.length === 0) {
        track.innerHTML = '<p style="color:hsl(0 0% 70%);padding:40px 24px;text-align:center;width:100%;">hang tight lil bro, more coming soon</p>';
        if (prevBtn) prevBtn.hidden = true;
        if (nextBtn) nextBtn.hidden = true;
        return;
    }

    track.innerHTML = events.map(ev => `
        <article class="event-card" data-event-id="${ev.id}" data-event-slug="${ev.slug}">
            <a href="/event.html?slug=${encodeURIComponent(ev.slug)}" class="event-card__link">
                <div class="event-card__img-wrap">
                    <img src="${ev.image_url || '/img/trans.png'}" alt="" class="event-card__img" loading="lazy">
                    <div class="event-card__body">
                        <h3 class="event-card__title">${ev.title}</h3>
                    </div>
                </div>
            </a>
        </article>
    `).join('');

    // Carousel
    const slider = document.querySelector('.events__slider');
    if (!slider || !prevBtn || !nextBtn) return;

    const cards    = Array.from(track.querySelectorAll('.event-card'));
    const GAP      = 24;
    const CARD_PCT = 0.25;
    let index = 0, cardWidth = 0;

    function setup() {
        const isMobile = window.innerWidth < 700;
        cardWidth = isMobile ? slider.offsetWidth : slider.offsetWidth * CARD_PCT;
        const pad = (slider.offsetWidth - cardWidth) / 2;
        track.style.paddingInline = `${pad}px`;
        cards.forEach(card => { card.style.width = `${cardWidth}px`; });
        index = Math.min(index, cards.length - 1);
        render();
    }

    function render() {
        const offset = index * (cardWidth + GAP);
        track.style.transform = `translateX(-${offset}px)`;
        cards.forEach((card, i) => {
            const dist = Math.abs(i - index);
            card.classList.toggle('is-active',   dist === 0);
            card.classList.toggle('is-adjacent', dist === 1);
        });
        prevBtn.disabled = index <= 0;
        nextBtn.disabled = index >= cards.length - 1;
    }

    prevBtn.addEventListener('click', () => { if (index > 0)                { index--; render(); } });
    nextBtn.addEventListener('click', () => { if (index < cards.length - 1) { index++; render(); } });

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(setup, 80);
    });

    setup();
})();
