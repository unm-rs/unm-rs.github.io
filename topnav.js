/**
 * topnav.js — shared by every page. The topnav is `position: fixed` (see
 * styles.css), so this is responsible for two things every page needs:
 *
 * 1. Measuring the nav's real rendered height into --topnav-height, which
 *    body's padding-top formula uses to keep content from starting out
 *    hidden underneath the nav (skipped on has-overlay-nav pages, which
 *    want the nav floating over their hero on purpose).
 * 2. SpaceX-style hide-on-scroll-down / reveal-on-scroll-up, everywhere.
 */
(function () {
    const nav = document.querySelector('.topnav');
    if (!nav) return;

    function measure() {
        document.documentElement.style.setProperty('--topnav-height', `${nav.getBoundingClientRect().height}px`);
    }
    measure();
    window.addEventListener('resize', measure);
    // Fonts/logo loading can shift the nav's height slightly after first paint.
    window.addEventListener('load', measure);

    const REVEAL_ZONE = 80; // never hide it while still near the top of the page
    let lastY = window.scrollY;
    let ticking = false;

    function onScroll() {
        const y = Math.max(0, window.scrollY);
        if (y <= REVEAL_ZONE || y < lastY) {
            nav.classList.remove('topnav--hidden');
        } else if (y > lastY) {
            nav.classList.add('topnav--hidden');
        }
        lastY = y;
        ticking = false;
    }

    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(onScroll);
    }, { passive: true });
})();
