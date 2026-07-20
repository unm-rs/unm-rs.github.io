(async function () {
    if (typeof db === 'undefined') return;

    window.initHeroImage?.('products');

    const { isAdmin } = await window.roleReady;

    const { data, error } = await db
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

    const grid    = document.getElementById('js-pr-grid');
    const loading = document.getElementById('js-pr-loading');
    if (loading) loading.remove();
    grid.hidden = false;

    if (error) {
        grid.innerHTML = `<p class="pr-empty" style="color:hsl(5,68%,56%)">${esc(error.message)}</p>`;
        return;
    }

    let products = data || [];
    renderGrid();

    function renderGrid() {
        grid.innerHTML = '';

        if (isAdmin) {
            const addBtn = document.createElement('button');
            addBtn.className = 'pr-add-btn';
            addBtn.innerHTML = `<span class="pr-add-btn__icon">+</span> Add Product`;
            addBtn.addEventListener('click', () => openModal(null));
            grid.appendChild(addBtn);
        }

        if (!products.length) {
            const msg = document.createElement('p');
            msg.className = 'pr-empty';
            msg.textContent = 'No products yet.';
            grid.appendChild(msg);
            return;
        }

        products.forEach(p => grid.appendChild(buildCard(p)));
    }

    function buildCard(p) {
        const card = document.createElement('article');
        card.className  = 'pr-card';
        card.dataset.id = p.id;

        card.innerHTML = `
            <div class="pr-card__img-wrap">
                ${p.image_url
                    ? `<img class="pr-card__img" src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">`
                    : `<div class="pr-card__img-placeholder" aria-hidden="true"></div>`}
            </div>
            <div class="pr-card__body">
                <h2 class="pr-card__name">${esc(p.name)}</h2>
                ${p.description ? `<p class="pr-card__desc">${esc(p.description)}</p>` : ''}
                <p class="pr-card__price">RM ${Number(p.price).toFixed(2)}</p>
            </div>
            <button class="pr-card__add-btn" aria-label="Add ${esc(p.name)} to cart">Add to Cart</button>
            ${isAdmin ? `
            <div class="pr-card__admin">
                <button class="pr-card__ctrl pr-card__ctrl--edit">Edit</button>
                <button class="pr-card__ctrl pr-card__ctrl--del">Delete</button>
            </div>` : ''}`;

        card.querySelector('.pr-card__add-btn').addEventListener('click', () => {
            window.cart?.addToCart({ id: p.id, name: p.name, price: p.price, image_url: p.image_url });
            const btn = card.querySelector('.pr-card__add-btn');
            btn.textContent = 'Added!';
            btn.classList.add('pr-card__add-btn--added');
            setTimeout(() => {
                btn.textContent = 'Add to Cart';
                btn.classList.remove('pr-card__add-btn--added');
            }, 1200);
        });

        if (isAdmin) {
            card.querySelector('.pr-card__ctrl--edit').addEventListener('click', () => openModal(p));
            card.querySelector('.pr-card__ctrl--del').addEventListener('click',  () => deleteProduct(p));
        }

        return card;
    }

    function openModal(product) {
        const isEdit = !!product;
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">${isEdit ? 'Edit Product' : 'Add Product'}</h2>
                    <button class="ab-modal__close" id="pr-mc">✕</button>
                </div>
                <form class="ab-form" id="pr-form" novalidate>
                    <div class="ab-field">
                        <label class="ab-label">Name</label>
                        <input class="ab-input" id="pr-fname" type="text"
                               value="${esc(product?.name || '')}" required placeholder="e.g. RS Hoodie">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Description <span style="font-weight:400;color:hsl(0 0% 50%)">(optional)</span></label>
                        <textarea class="ab-textarea" id="pr-fdesc" rows="3"
                                  placeholder="Brief description…">${esc(product?.description || '')}</textarea>
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Price (RM)</label>
                        <input class="ab-input" id="pr-fprice" type="number" min="0" step="0.01"
                               value="${product?.price ?? ''}" required placeholder="0.00">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Image</label>
                        <input type="file" class="ab-file-input" id="pr-fimage" accept="image/*">
                        ${product?.image_url
                            ? `<img src="${esc(product.image_url)}" id="pr-img-preview"
                                   style="margin-top:8px;max-height:80px;border-radius:6px;display:block" alt="">`
                            : ''}
                    </div>
                    <div id="pr-ferr" class="ab-error" hidden></div>
                    <div class="ab-form-actions">
                        <button type="button" class="ab-form-btn ab-form-btn--ghost" id="pr-fcancel">Cancel</button>
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="pr-fsave">
                            ${isEdit ? 'Save Changes' : 'Add Product'}
                        </button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('#pr-fname').focus();

        const close = () => overlay.remove();
        overlay.querySelector('#pr-mc').addEventListener('click', close);
        overlay.querySelector('#pr-fcancel').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        overlay.querySelector('#pr-fimage').addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            let preview = overlay.querySelector('#pr-img-preview');
            if (!preview) {
                preview = document.createElement('img');
                preview.id = 'pr-img-preview';
                preview.style.cssText = 'margin-top:8px;max-height:80px;border-radius:6px;display:block';
                overlay.querySelector('#pr-fimage').after(preview);
            }
            preview.src = URL.createObjectURL(file);
        });

        overlay.querySelector('#pr-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errEl = overlay.querySelector('#pr-ferr');
            const btn   = overlay.querySelector('#pr-fsave');
            errEl.hidden    = true;
            btn.disabled    = true;
            btn.textContent = 'Saving…';

            const name  = overlay.querySelector('#pr-fname').value.trim();
            const desc  = overlay.querySelector('#pr-fdesc').value.trim();
            const price = parseFloat(overlay.querySelector('#pr-fprice').value);
            const file  = overlay.querySelector('#pr-fimage').files[0];

            if (!name || isNaN(price) || price < 0) {
                errEl.textContent = 'Name and a valid price are required.';
                errEl.hidden = false;
                btn.disabled    = false;
                btn.textContent = isEdit ? 'Save Changes' : 'Add Product';
                return;
            }

            let imageUrl = product?.image_url || null;
            if (file) {
                const ext  = file.name.split('.').pop().toLowerCase();
                const path = `products/${Date.now()}.${ext}`;
                const { data: up, error: upErr } = await db.storage
                    .from('event-images').upload(path, file, { upsert: true });
                if (upErr) {
                    errEl.textContent = 'Image upload failed: ' + upErr.message;
                    errEl.hidden = false;
                    btn.disabled    = false;
                    btn.textContent = isEdit ? 'Save Changes' : 'Add Product';
                    return;
                }
                const { data: { publicUrl } } = db.storage.from('event-images').getPublicUrl(up.path);
                imageUrl = publicUrl;
            }

            const payload = { name, description: desc || null, price, image_url: imageUrl };

            let result, saveErr;
            if (isEdit) {
                ({ data: result, error: saveErr } = await db.from('products')
                    .update(payload).eq('id', product.id).select().single());
            } else {
                ({ data: result, error: saveErr } = await db.from('products')
                    .insert(payload).select().single());
            }

            if (saveErr) {
                errEl.textContent = saveErr.message;
                errEl.hidden = false;
                btn.disabled    = false;
                btn.textContent = isEdit ? 'Save Changes' : 'Add Product';
                return;
            }

            if (isEdit) {
                const idx = products.findIndex(p => p.id === product.id);
                if (idx !== -1) products[idx] = result;
            } else {
                products.unshift(result);
            }

            close();
            renderGrid();
        });
    }

    async function deleteProduct(product) {
        if (!confirm(`Delete "${product.name}"?\n\nThis cannot be undone.`)) return;
        const { error } = await db.from('products').delete().eq('id', product.id);
        if (error) { alert(error.message); return; }
        products = products.filter(p => p.id !== product.id);
        renderGrid();
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
