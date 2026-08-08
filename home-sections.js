/**
 * home-sections.js — the two full-screen editable sections below the home
 * hero (SpaceX-style), alternating left/right text alignment. Fixed at
 * exactly two rows (feature-1, feature-2) in home_feature_sections.
 * Image cropping reuses the same dual desktop/mobile flow as the hero
 * (see image-crop.js); title/description/CTA label are plain contenteditable
 * text, saved together with any pending image through one shared savebar.
 */
(async function () {
    if (typeof db === 'undefined') return;

    const IDS   = ['feature-1', 'feature-2'];
    const ALIGN = { 'feature-1': 'left', 'feature-2': 'right' };

    const [{ data: rows }, { isAdmin }] = await Promise.all([
        db.from('home_feature_sections').select('*').in('id', IDS),
        window.roleReady,
    ]);

    const dataById = Object.fromEntries((rows || []).map(r => [r.id, r]));
    const pendingImages = {};
    const dirtyIds = new Set();
    let isDirty = false;

    const saveBar = document.getElementById('js-feature-savebar');
    const saveBtn = document.getElementById('js-feature-savebtn');

    function markDirty(id) {
        dirtyIds.add(id);
        if (isDirty) return;
        isDirty = true;
        saveBar.hidden = false;
        document.body.style.paddingBottom = '72px';
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function validateImageFile(file) {
        const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
        if (!allowed.includes(file.type)) { alert('Please choose a PNG, JPEG, WEBP, or GIF image.'); return false; }
        if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5MB.'); return false; }
        return true;
    }

    function startCtaUrlEdit(ctaUrlEl, id) {
        const input = document.createElement('input');
        input.type      = 'text';
        input.className = 'feature-hero__cta-url-input';
        input.value     = ctaUrlEl.dataset.href || '';
        input.placeholder = '/eventspage/, https://example.com, …';
        ctaUrlEl.replaceWith(input);
        input.focus();
        input.select();

        let done = false;
        const commit = () => {
            if (done) return;
            done = true;
            const next = input.value.trim();
            if (next !== (ctaUrlEl.dataset.href || '')) {
                ctaUrlEl.dataset.href = next;
                markDirty(id);
            }
            ctaUrlEl.textContent = `→ ${next || '(no link set)'}`;
            input.replaceWith(ctaUrlEl);
        };
        input.addEventListener('blur', commit, { once: true });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter')  input.blur();
            if (e.key === 'Escape') { done = true; input.replaceWith(ctaUrlEl); }
        });
    }

    IDS.forEach(renderSection);

    function renderSection(id) {
        const el    = document.getElementById(`js-${id}`);
        const row   = dataById[id] || {};
        const align = ALIGN[id];

        el.className = `feature-hero feature-hero--${align}`;
        el.innerHTML = `
            <div class="feature-hero__bg"></div>
            <div class="feature-hero__overlay"></div>
            ${isAdmin ? `
            <label class="hero-img-btn" data-role="imgbtn">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Change Image
                <input type="file" accept="image/*" hidden data-role="imginput">
            </label>` : ''}
            <div class="feature-hero__content">
                <h2 class="feature-hero__title" data-role="title"${isAdmin ? ' contenteditable="true"' : ''}>${esc(row.title || '')}</h2>
                <p class="feature-hero__desc" data-role="desc"${isAdmin ? ' contenteditable="true"' : ''}>${esc(row.description || '')}</p>
                ${isAdmin
                    ? `<span class="feature-hero__cta" data-role="cta" contenteditable="true" tabindex="0" role="button">${esc(row.cta_label || '')}</span>
                       <p class="feature-hero__cta-url" data-role="ctaurl" data-href="${esc(row.cta_href || '')}" title="Click to change where this button links to">→ ${esc(row.cta_href || '(no link set)')}</p>`
                    : `<a class="feature-hero__cta" data-role="cta" href="${esc(row.cta_href || '#')}">${esc(row.cta_label || '')}</a>`}
            </div>`;

        if (row.image_url) {
            el.style.setProperty('--hero-bg-desktop', `url('${row.image_url.replace(/'/g, '%27')}')`);
        }
        if (row.image_url_mobile) {
            el.style.setProperty('--hero-bg-mobile', `url('${row.image_url_mobile.replace(/'/g, '%27')}')`);
        }

        if (!isAdmin) return;

        el.querySelector('[data-role="title"]').addEventListener('input', () => markDirty(id));
        el.querySelector('[data-role="desc"]').addEventListener('input', () => markDirty(id));
        el.querySelector('[data-role="cta"]').addEventListener('input', () => markDirty(id));

        const ctaUrlEl = el.querySelector('[data-role="ctaurl"]');
        ctaUrlEl.addEventListener('click', () => startCtaUrlEdit(ctaUrlEl, id));

        const imgInput = el.querySelector('[data-role="imginput"]');
        imgInput.addEventListener('change', async e => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file || !validateImageFile(file)) return;

            const crops = await window.openDualImageCropper(file, {
                top:    { aspect: 16 / 9, outputWidth: 1920, outputHeight: 1080, label: 'Desktop (16:9)' },
                bottom: { aspect: 9 / 16, outputWidth: 1080, outputHeight: 1920, label: 'Mobile (9:16)' },
            });
            if (!crops) return;

            pendingImages[id] = crops;
            el.style.setProperty('--hero-bg-desktop', `url('${URL.createObjectURL(crops.desktop)}')`);
            el.style.setProperty('--hero-bg-mobile',  `url('${URL.createObjectURL(crops.mobile)}')`);
            markDirty(id);
        });
    }

    if (!isAdmin) return;

    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        for (const id of dirtyIds) {
            const el = document.getElementById(`js-${id}`);
            const update = {
                title:       el.querySelector('[data-role="title"]').textContent.trim(),
                description: el.querySelector('[data-role="desc"]').textContent.trim(),
                cta_label:   el.querySelector('[data-role="cta"]').textContent.trim(),
                cta_href:    el.querySelector('[data-role="ctaurl"]').dataset.href.trim() || null,
            };

            if (pendingImages[id]) {
                const stamp = Date.now();
                const [desktopUp, mobileUp] = await Promise.all([
                    db.storage.from('event-images').upload(`hero/${id}-${stamp}.jpg`, pendingImages[id].desktop, { upsert: true }),
                    db.storage.from('event-images').upload(`hero/${id}-${stamp}-mobile.jpg`, pendingImages[id].mobile, { upsert: true }),
                ]);
                if (desktopUp.error || mobileUp.error) {
                    alert('Image upload failed: ' + (desktopUp.error || mobileUp.error).message);
                    saveBtn.disabled    = false;
                    saveBtn.textContent = 'Save Changes';
                    return;
                }
                update.image_url        = db.storage.from('event-images').getPublicUrl(desktopUp.data.path).data.publicUrl;
                update.image_url_mobile = db.storage.from('event-images').getPublicUrl(mobileUp.data.path).data.publicUrl;
            }

            const { error } = await db.from('home_feature_sections').update(update).eq('id', id);
            if (error) {
                alert('Save failed: ' + error.message);
                saveBtn.disabled    = false;
                saveBtn.textContent = 'Save Changes';
                return;
            }
        }

        dirtyIds.clear();
        isDirty = false;
        saveBar.querySelector('.edit-savebar__msg').textContent = 'Saved ✓';
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Changes';
        setTimeout(() => {
            saveBar.hidden = true;
            document.body.style.paddingBottom = '';
            saveBar.querySelector('.edit-savebar__msg').textContent = 'Unsaved changes';
        }, 1500);
    });
})();
