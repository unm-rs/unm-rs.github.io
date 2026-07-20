(function () {
    const CART_KEY = 'rs-cart';

    function getCart() {
        try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
        catch { return []; }
    }

    function saveCart(cart) {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        updateBadge();
    }

    function addToCart(product) {
        const cart = getCart();
        const idx  = cart.findIndex(i => i.id === product.id);
        if (idx !== -1) {
            cart[idx].quantity++;
        } else {
            cart.push({ id: product.id, name: product.name, price: product.price, image_url: product.image_url || null, quantity: 1 });
        }
        saveCart(cart);
    }

    function removeFromCart(id) {
        saveCart(getCart().filter(i => i.id !== id));
    }

    function setQuantity(id, qty) {
        const cart = getCart();
        const idx  = cart.findIndex(i => i.id === id);
        if (idx === -1) return;
        if (qty <= 0) cart.splice(idx, 1);
        else cart[idx].quantity = qty;
        saveCart(cart);
    }

    function clearCart() {
        localStorage.removeItem(CART_KEY);
        updateBadge();
    }

    function getCount() {
        return getCart().reduce((sum, i) => sum + i.quantity, 0);
    }

    function updateBadge() {
        const badge = document.getElementById('cart-badge');
        if (!badge) return;
        const count = getCount();
        badge.textContent = count;
        badge.hidden = count === 0;
    }

    window.cart = { getCart, addToCart, removeFromCart, setQuantity, clearCart, getCount, updateBadge };

    // Inject cart nav link — runs immediately since this is a deferred script (DOM already parsed)
    const nav = document.querySelector('.topnav__links');
    if (nav) {
        const li = document.createElement('li');
        li.className = 'topnav__item';
        li.innerHTML = `
            <a href="/cart.html" class="topnav__link topnav__cart-link">
                Cart
                <span class="topnav__cart-badge" id="cart-badge" hidden>0</span>
            </a>`;
        nav.appendChild(li);
        updateBadge();
    }
})();
