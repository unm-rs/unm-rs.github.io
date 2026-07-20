/**
 * hero-image.js — admin-editable hero background image, shared by every
 * page hero that isn't tied to its own record (event detail pages keep
 * their own per-event image_url and don't use this).
 */
(function () {
    window.initHeroImage = async function (pageKey) {
        if (typeof db === 'undefined') return;

        const bgEl    = document.getElementById('js-hero-bg');
        const btnEl   = document.getElementById('js-img-btn');
        const inputEl = document.getElementById('js-img-input');
        if (!bgEl) return;

        const { data } = await db
            .from('site_hero_images').select('image_url').eq('page_key', pageKey).maybeSingle();
        if (data?.image_url) bgEl.style.backgroundImage = `url('${data.image_url.replace(/'/g, '%27')}')`;

        const { isAdmin } = await window.roleReady;
        if (!isAdmin || !btnEl || !inputEl) return;

        btnEl.hidden = false;

        inputEl.addEventListener('change', async e => {
            const file = e.target.files[0];
            if (!file) return;

            const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
            if (!allowed.includes(file.type)) {
                alert('Please choose a PNG, JPEG, WEBP, or GIF image.');
                e.target.value = '';
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                alert('Image must be under 5MB.');
                e.target.value = '';
                return;
            }

            bgEl.style.backgroundImage = `url('${URL.createObjectURL(file)}')`;

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
