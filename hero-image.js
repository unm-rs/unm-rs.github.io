/**
 * hero-image.js — admin-editable hero background image, shared by every
 * page hero that isn't tied to its own record (event detail pages keep
 * their own per-event image_url and don't use this).
 *
 * Pass `dualCrop` to opt a page into the desktop+mobile dual-crop flow
 * (see image-crop.js) instead of a single uncropped upload — e.g. the
 * home page hero. Pages that don't pass it keep the original single-image
 * behavior unchanged.
 */
(function () {
    window.initHeroImage = async function (pageKey, dualCrop) {
        if (typeof db === 'undefined') return;

        const bgEl    = document.getElementById('js-hero-bg');
        const btnEl   = document.getElementById('js-img-btn');
        const inputEl = document.getElementById('js-img-input');
        if (!bgEl) return;

        const { data } = await db
            .from('site_hero_images').select('image_url, image_url_mobile').eq('page_key', pageKey).maybeSingle();
        if (data?.image_url) {
            bgEl.style.setProperty('--hero-bg-desktop', `url('${data.image_url.replace(/'/g, '%27')}')`);
        }
        if (data?.image_url_mobile) {
            bgEl.style.setProperty('--hero-bg-mobile', `url('${data.image_url_mobile.replace(/'/g, '%27')}')`);
        }

        const { isAdmin } = await window.roleReady;
        if (!isAdmin || !btnEl || !inputEl) return;

        btnEl.hidden = false;

        // On pages with the overlay topnav (e.g. the home hero) the nav
        // floats on top of the hero, so this button needs to sit below it
        // instead of at its normal fixed offset from the hero's own top edge.
        if (document.body.classList.contains('has-overlay-nav')) {
            const positionBtn = () => {
                const nav = document.querySelector('.topnav');
                if (nav) btnEl.style.top = `${nav.getBoundingClientRect().height + 12}px`;
            };
            positionBtn();
            window.addEventListener('resize', positionBtn);
        }

        inputEl.addEventListener('change', async e => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;

            const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
            if (!allowed.includes(file.type)) {
                alert('Please choose a PNG, JPEG, WEBP, or GIF image.');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                alert('Image must be under 5MB.');
                return;
            }

            if (dualCrop) {
                const crops = await window.openDualImageCropper(file, dualCrop);
                if (!crops) return;

                bgEl.style.setProperty('--hero-bg-desktop', `url('${URL.createObjectURL(crops.desktop)}')`);
                bgEl.style.setProperty('--hero-bg-mobile',  `url('${URL.createObjectURL(crops.mobile)}')`);

                const stamp = Date.now();
                const [desktopUp, mobileUp] = await Promise.all([
                    db.storage.from('event-images').upload(`hero/${pageKey}-${stamp}.jpg`, crops.desktop, { upsert: true }),
                    db.storage.from('event-images').upload(`hero/${pageKey}-${stamp}-mobile.jpg`, crops.mobile, { upsert: true }),
                ]);

                if (desktopUp.error || mobileUp.error) {
                    alert('Image upload failed: ' + (desktopUp.error || mobileUp.error).message);
                    return;
                }

                const { data: { publicUrl: desktopUrl } } = db.storage.from('event-images').getPublicUrl(desktopUp.data.path);
                const { data: { publicUrl: mobileUrl } }  = db.storage.from('event-images').getPublicUrl(mobileUp.data.path);
                const { error: dbErr } = await db.from('site_hero_images')
                    .upsert({ page_key: pageKey, image_url: desktopUrl, image_url_mobile: mobileUrl });

                if (dbErr) alert('Save failed: ' + dbErr.message);
                return;
            }

            bgEl.style.setProperty('--hero-bg-desktop', `url('${URL.createObjectURL(file)}')`);

            const ext  = file.name.split('.').pop().toLowerCase();
            const path = `hero/${pageKey}-${Date.now()}.${ext}`;
            const { data: up, error: upErr } = await db.storage
                .from('event-images').upload(path, file, { upsert: true });

            if (upErr) { alert('Image upload failed: ' + upErr.message); return; }

            const { data: { publicUrl } } = db.storage.from('event-images').getPublicUrl(up.path);
            const { error: dbErr } = await db
                .from('site_hero_images').upsert({ page_key: pageKey, image_url: publicUrl });

            if (dbErr) alert('Save failed: ' + dbErr.message);
        });
    };
})();
