(function () {
    window.initHeroImage?.('cart');

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const itemsEl   = document.getElementById('js-ct-items');
    const summaryEl = document.getElementById('js-ct-summary');
    const layoutEl  = document.querySelector('.ct-layout');

    function render() {
        const cart = window.cart?.getCart() ?? [];
        itemsEl.innerHTML   = '';
        summaryEl.innerHTML = '';

        if (!cart.length) {
            layoutEl?.classList.add('ct-layout--empty');
            itemsEl.innerHTML = `
                <div class="ct-empty">
                    <svg class="ct-empty__icon" xmlns="http://www.w3.org/2000/svg" width="48" height="48"
                         viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                    </svg>
                    <p class="ct-empty__msg">Your cart is empty.</p>
                    <a href="/products.html" class="ct-empty__link">Browse Products</a>
                </div>`;
            return;
        }

        layoutEl?.classList.remove('ct-layout--empty');

        cart.forEach(item => {
            const row = document.createElement('div');
            row.className = 'ct-row';
            row.dataset.id = item.id;
            row.innerHTML = `
                <div class="ct-row__img-wrap">
                    ${item.image_url
                        ? `<img class="ct-row__img" src="${esc(item.image_url)}" alt="${esc(item.name)}" loading="lazy">`
                        : `<div class="ct-row__img-placeholder" aria-hidden="true"></div>`}
                </div>
                <div class="ct-row__info">
                    <p class="ct-row__name">${esc(item.name)}</p>
                    <p class="ct-row__unit">RM ${Number(item.price).toFixed(2)} each</p>
                </div>
                <div class="ct-row__qty">
                    <button class="ct-qty-btn" data-dir="-1" aria-label="Decrease quantity">−</button>
                    <span class="ct-qty-val">${item.quantity}</span>
                    <button class="ct-qty-btn" data-dir="1" aria-label="Increase quantity">+</button>
                </div>
                <p class="ct-row__subtotal">RM ${(Number(item.price) * item.quantity).toFixed(2)}</p>
                <button class="ct-row__remove" aria-label="Remove ${esc(item.name)}">✕</button>`;

            row.querySelector('.ct-row__remove').addEventListener('click', () => {
                window.cart?.removeFromCart(item.id);
                render();
            });

            row.querySelectorAll('.ct-qty-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const dir = parseInt(btn.dataset.dir, 10);
                    window.cart?.setQuantity(item.id, item.quantity + dir);
                    render();
                });
            });

            itemsEl.appendChild(row);
        });

        const total = cart.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);

        summaryEl.innerHTML = `
            <div class="ct-summary__inner">
                <h2 class="ct-summary__title">Order Summary</h2>
                <div class="ct-summary__items">
                    ${cart.map(i => `
                        <div class="ct-summary__line">
                            <span>${esc(i.name)}${i.quantity > 1 ? ` &times; ${i.quantity}` : ''}</span>
                            <span>RM ${(Number(i.price) * i.quantity).toFixed(2)}</span>
                        </div>`).join('')}
                </div>
                <div class="ct-summary__line ct-summary__line--total">
                    <span>Total</span>
                    <span>RM ${total.toFixed(2)}</span>
                </div>
                <button class="ct-checkout-btn" disabled>Checkout</button>
                <button class="ct-clear-btn" id="js-ct-clear">Clear Cart</button>
            </div>`;

        document.getElementById('js-ct-clear').addEventListener('click', () => {
            if (!confirm('Remove all items from your cart?')) return;
            window.cart?.clearCart();
            render();
        });
    }

    render();
})();
