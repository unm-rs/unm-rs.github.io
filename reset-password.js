(async function () {
    if (typeof db === 'undefined') return;

    const root = document.getElementById('js-reset-root');
    let ready = false;

    function showForm() {
        if (ready) return;
        ready = true;
        render();
    }

    db.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') showForm();
    });

    // Fallback in case the PASSWORD_RECOVERY event already fired
    // before this script attached its listener
    const { data: { session } } = await db.auth.getSession();
    if (session) showForm();

    setTimeout(() => {
        if (!ready) {
            root.innerHTML = `<p class="pf-loading">This reset link is invalid or has expired — request a new one from the sign-in menu.</p>`;
        }
    }, 3000);

    function render() {
        root.innerHTML = `
            <div class="ab-modal" style="width:100%">
                <h1 class="ab-modal__title" style="margin-block-end:18px">Set New Password</h1>
                <form class="ab-form" id="rp-form">
                    <div class="ab-field">
                        <label class="ab-label">New Password</label>
                        <input class="ab-input" id="rp-pw" type="password" autocomplete="new-password" required>
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Confirm New Password</label>
                        <input class="ab-input" id="rp-pw2" type="password" autocomplete="new-password" required>
                    </div>
                    <div id="rp-err" class="ab-error" hidden></div>
                    <div class="ab-form-actions" style="flex-direction:column;gap:10px">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="rp-submit">Set Password</button>
                    </div>
                </form>
            </div>`;

        document.getElementById('rp-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errEl  = document.getElementById('rp-err');
            const submit = document.getElementById('rp-submit');
            const pw     = document.getElementById('rp-pw').value;
            const pw2    = document.getElementById('rp-pw2').value;

            errEl.hidden = true;

            if (pw.length < 6) {
                errEl.textContent = 'Password must be at least 6 characters.';
                errEl.hidden      = false;
                return;
            }
            if (pw !== pw2) {
                errEl.textContent = 'Passwords do not match.';
                errEl.hidden      = false;
                return;
            }

            submit.disabled    = true;
            submit.textContent = 'Saving…';

            const { error } = await db.auth.updateUser({ password: pw });

            if (error) {
                errEl.textContent  = error.message;
                errEl.hidden       = false;
                submit.disabled    = false;
                submit.textContent = 'Set Password';
                return;
            }

            root.innerHTML = `<p class="pf-loading">Password updated — redirecting…</p>`;
            setTimeout(() => { window.location.href = '/'; }, 1500);
        });
    }
})();
