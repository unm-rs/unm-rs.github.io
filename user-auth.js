/**
 * user-auth.js  —  member login / registration / account / 2FA
 * Mods/owners are role='mod'/'owner' in user_profiles (see role-utils.js).
 */
(async function () {
    if (typeof db === 'undefined') return;

    const { session, profile, isAdmin, isOwner } = await window.roleReady;
    let userProfile = profile;

    window.userSession  = session;
    window.userProfile  = userProfile;
    window.userIsAdmin  = isAdmin;
    window.userIsOwner  = isOwner;

    injectNavItem(session, userProfile);
    initMobileNav();

    // Let other scripts trigger the login modal or profile page
    document.addEventListener('ua:open-login',   () => openLoginModal());
    document.addEventListener('ua:open-account', () => { window.location.href = '/profile.html'; });

    function injectNavItem(session, profile) {
        const nav = document.querySelector('.topnav__links');
        if (!nav) return;

        const li = document.createElement('li');
        li.className = 'topnav__item';

        if (!session) {
            li.innerHTML = `<button class="topnav__link ua-nav-btn" id="ua-open-login">Sign In</button>`;
            li.querySelector('#ua-open-login').addEventListener('click', openLoginModal);
        } else if (isAdmin) {
            li.className = 'topnav__item ua-profile-wrap';
            const roleLabel = isOwner ? 'Owner' : 'Mod';
            li.innerHTML = `
                <button class="topnav__link ua-nav-btn ua-profile-btn" id="ua-profile-trigger"
                        aria-haspopup="true" aria-expanded="false">
                    ${roleLabel}
                    <svg class="ua-profile-caret" width="10" height="6" viewBox="0 0 10 6"
                         fill="none" aria-hidden="true">
                        <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.75"
                              stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <div class="ua-dropdown" id="ua-dropdown" hidden>
                    <div class="ua-dropdown-header">
                        <p class="ua-dropdown-header__name">${esc(profile?.full_name || 'Admin')}</p>
                        <p class="ua-dropdown-header__email">${esc(session.user.email)}</p>
                        <span class="ua-mod-badge${isOwner ? ' ua-mod-badge--owner' : ''}">${roleLabel}</span>
                    </div>
                    <button class="ua-dropdown-item" id="ua-dd-account">MY ACCOUNT</button>
                    <button class="ua-dropdown-item" id="ua-dd-settings">SETTINGS</button>
                    <div class="ua-dropdown-divider"></div>
                    <button class="ua-dropdown-item ua-dropdown-item--danger" id="ua-dd-signout">SIGN OUT</button>
                </div>`;

            const trigger = li.querySelector('#ua-profile-trigger');
            const menu    = li.querySelector('#ua-dropdown');
            trigger.addEventListener('click', e => {
                e.stopPropagation();
                const opening = menu.hidden;
                menu.hidden = !opening;
                trigger.setAttribute('aria-expanded', opening);
                trigger.classList.toggle('ua-profile-btn--open', opening);
            });
            li.querySelector('#ua-dd-account').addEventListener('click',  () => { window.location.href = '/profile.html'; });
            li.querySelector('#ua-dd-settings').addEventListener('click', () => { window.location.href = '/settings.html'; });
            li.querySelector('#ua-dd-signout').addEventListener('click', async () => {
                await db.auth.signOut();
                location.reload();
            });
            document.addEventListener('click', () => {
                menu.hidden = true;
                trigger.setAttribute('aria-expanded', 'false');
                trigger.classList.remove('ua-profile-btn--open');
            });
        } else {
            li.className = 'topnav__item ua-profile-wrap';
            const initials = getInitials(profile?.full_name || session.user.email);
            const avatarHtml = profile?.avatar_url
                ? `<img class="ua-profile-avatar" src="${esc(profile.avatar_url)}" alt="">`
                : `<span class="ua-profile-avatar ua-profile-avatar--initials">${esc(initials)}</span>`;
            li.innerHTML = `
                <button class="topnav__link ua-nav-btn ua-profile-btn ua-profile-btn--avatar" id="ua-profile-trigger"
                        aria-haspopup="true" aria-expanded="false">
                    ${avatarHtml}
                </button>
                <div class="ua-dropdown" id="ua-dropdown" hidden>
                    <div class="ua-dropdown-header">
                        <p class="ua-dropdown-header__name">${esc(profile?.full_name || 'Member')}</p>
                        <p class="ua-dropdown-header__email">${esc(session.user.email)}</p>
                    </div>
                    <button class="ua-dropdown-item" id="ua-dd-account">MY ACCOUNT</button>
                    <button class="ua-dropdown-item" id="ua-dd-settings">SETTINGS</button>
                    <div class="ua-dropdown-divider"></div>
                    <button class="ua-dropdown-item ua-dropdown-item--danger" id="ua-dd-signout">SIGN OUT</button>
                </div>`;

            const trigger = li.querySelector('#ua-profile-trigger');
            const menu    = li.querySelector('#ua-dropdown');

            trigger.addEventListener('click', e => {
                e.stopPropagation();
                const opening = menu.hidden;
                menu.hidden = !opening;
                trigger.setAttribute('aria-expanded', opening);
                trigger.classList.toggle('ua-profile-btn--open', opening);
            });

            li.querySelector('#ua-dd-account').addEventListener('click', () => {
                window.location.href = '/profile.html';
            });

            li.querySelector('#ua-dd-settings').addEventListener('click', () => {
                window.location.href = '/settings.html';
            });

            li.querySelector('#ua-dd-signout').addEventListener('click', async () => {
                await db.auth.signOut();
                location.reload();
            });

            document.addEventListener('click', () => {
                menu.hidden = true;
                trigger.setAttribute('aria-expanded', 'false');
                trigger.classList.remove('ua-profile-btn--open');
            });
        }

        nav.appendChild(li);
    }

    function openLoginModal() {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:400px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Member Sign In</h2>
                    <button class="ab-modal__close" id="ua-lc">✕</button>
                </div>

                <div id="ua-step-pw">
                    <form class="ab-form" id="ua-login-form">
                        <div class="ab-field">
                            <label class="ab-label">Email</label>
                            <input class="ab-input" id="ua-lemail" type="email" autocomplete="email" required>
                        </div>
                        <div class="ab-field">
                            <label class="ab-label">Password</label>
                            <input class="ab-input" id="ua-lpw" type="password" autocomplete="current-password" required>
                        </div>
                        <div id="ua-lerr" class="ab-error" hidden></div>
                        <div class="ab-form-actions" style="flex-direction:column;gap:10px">
                            <button type="submit" class="ab-form-btn ab-form-btn--primary" id="ua-lsubmit">Sign In</button>
                            <button type="button" class="ab-form-btn ab-form-btn--ghost" id="ua-to-register">
                                Create account
                            </button>
                        </div>
                    </form>
                </div>

                <div id="ua-step-totp" hidden>
                    <p style="font-size:13px;color:hsl(0 0% 55%);margin-block-end:18px">
                        Enter the 6-digit code from your authenticator app.
                    </p>
                    <form class="ab-form" id="ua-totp-form">
                        <div class="ab-field">
                            <label class="ab-label">Authenticator Code</label>
                            <input class="ab-input" id="ua-totp-code" type="text" inputmode="numeric"
                                   autocomplete="one-time-code" maxlength="6" placeholder="000000" required>
                        </div>
                        <div id="ua-totp-err" class="ab-error" hidden></div>
                        <div class="ab-form-actions">
                            <button type="submit" class="ab-form-btn ab-form-btn--primary" id="ua-totp-submit">Verify</button>
                        </div>
                    </form>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('#ua-lemail').focus();

        const close = () => overlay.remove();
        overlay.querySelector('#ua-lc').addEventListener('click', close);
        onOverlayClick(overlay, close);

        overlay.querySelector('#ua-to-register').addEventListener('click', () => {
            close(); openRegisterModal();
        });

        overlay.querySelector('#ua-login-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errEl  = overlay.querySelector('#ua-lerr');
            const submit = overlay.querySelector('#ua-lsubmit');
            errEl.hidden      = true;
            submit.disabled   = true;
            submit.textContent = 'Signing in…';

            const { data, error } = await db.auth.signInWithPassword({
                email:    overlay.querySelector('#ua-lemail').value,
                password: overlay.querySelector('#ua-lpw').value,
            });

            if (error) {
                errEl.textContent  = error.message;
                errEl.hidden       = false;
                submit.disabled    = false;
                submit.textContent = 'Sign In';
                return;
            }

            const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
            if (aal?.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
                overlay.querySelector('#ua-step-pw').hidden   = true;
                overlay.querySelector('#ua-step-totp').hidden = false;
                overlay.querySelector('#ua-totp-code').focus();

                const { data: factors } = await db.auth.mfa.listFactors();
                const factor = factors?.totp?.[0];
                if (!factor) { close(); location.reload(); return; }

                const { data: challenge } = await db.auth.mfa.challenge({ factorId: factor.id });

                overlay.querySelector('#ua-totp-form').addEventListener('submit', async e2 => {
                    e2.preventDefault();
                    const totpErr = overlay.querySelector('#ua-totp-err');
                    const totpBtn = overlay.querySelector('#ua-totp-submit');
                    totpErr.hidden   = true;
                    totpBtn.disabled = true;
                    totpBtn.textContent = 'Verifying…';

                    const { error: verifyErr } = await db.auth.mfa.verify({
                        factorId:    factor.id,
                        challengeId: challenge.id,
                        code:        overlay.querySelector('#ua-totp-code').value.trim(),
                    });

                    if (verifyErr) {
                        totpErr.textContent  = verifyErr.message;
                        totpErr.hidden       = false;
                        totpBtn.disabled     = false;
                        totpBtn.textContent  = 'Verify';
                        return;
                    }
                    close(); location.reload();
                });
            } else {
                close(); location.reload();
            }
        });
    }

    function openRegisterModal() {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Create Account</h2>
                    <button class="ab-modal__close" id="ua-rc">✕</button>
                </div>
                <form class="ab-form" id="ua-reg-form" novalidate>
                    <div class="ab-field">
                        <label class="ab-label">Full Name</label>
                        <input class="ab-input" id="ua-rfname" type="text" required placeholder="Your full name">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Email</label>
                        <input class="ab-input" id="ua-remail" type="email" autocomplete="email" required
                               placeholder="yourOWA@nottingham.edu.my">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Student ID</label>
                        <input class="ab-input" id="ua-rsid" type="text" required placeholder="e.g. 20123456">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Year of Study</label>
                        <select class="ab-input" id="ua-ryear" required>
                            <option value="" disabled selected>Select year…</option>
                            <option>Foundation Year</option>
                            <option>Year 1</option><option>Year 2</option>
                            <option>Year 3</option><option>Year 4</option>
                            <option>Postgraduate</option>
                        </select>
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Course of Study</label>
                        <input class="ab-input" id="ua-rcourse" type="text" required
                               placeholder="e.g. Electrical and Electronic Engineering">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Password</label>
                        <input class="ab-input" id="ua-rpw" type="password" autocomplete="new-password"
                               required placeholder="make sure it's the same as your google password 😋">
                    </div>
                    <div id="ua-rerr" class="ab-error" hidden></div>
                    <div class="ab-form-actions" style="flex-direction:column;gap:10px">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="ua-rsubmit">
                            Create Account
                        </button>
                        <button type="button" class="ab-form-btn ab-form-btn--ghost" id="ua-to-login">
                            Already have an account? Sign in
                        </button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);
        overlay.querySelector('#ua-rfname').focus();

        const close = () => overlay.remove();
        overlay.querySelector('#ua-rc').addEventListener('click', close);
        onOverlayClick(overlay, close);
        overlay.querySelector('#ua-to-login').addEventListener('click', () => { close(); openLoginModal(); });

        overlay.querySelector('#ua-reg-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errEl  = overlay.querySelector('#ua-rerr');
            const submit = overlay.querySelector('#ua-rsubmit');
            errEl.hidden      = true;
            submit.disabled   = true;
            submit.textContent = 'Creating…';

            const fname  = overlay.querySelector('#ua-rfname').value.trim();
            const email  = overlay.querySelector('#ua-remail').value.trim();
            const sid    = overlay.querySelector('#ua-rsid').value.trim();
            const year   = overlay.querySelector('#ua-ryear').value;
            const course = overlay.querySelector('#ua-rcourse').value.trim();
            const pw     = overlay.querySelector('#ua-rpw').value;

            if (!fname || !email || !sid || !year || !course || !pw) {
                errEl.textContent  = 'Please fill in all fields.';
                errEl.hidden       = false;
                submit.disabled    = false;
                submit.textContent = 'Create Account';
                return;
            }

            const { data: authData, error: signUpErr } = await db.auth.signUp({
                email, password: pw,
                options: { data: { role: 'member' } },
            });

            if (signUpErr) {
                errEl.textContent  = signUpErr.message;
                errEl.hidden       = false;
                submit.disabled    = false;
                submit.textContent = 'Create Account';
                return;
            }

            if (authData.user) {
                await db.from('user_profiles').upsert({
                    id:              authData.user.id,
                    full_name:       fname,
                    student_id:      sid,
                    owa:             email,
                    year_of_study:   year,
                    course_of_study: course,
                });
            }

            close();
            showConfirmation(authData.session);
        });
    }

    function showConfirmation(immediateSession) {
        const overlay = makeOverlay();
        if (immediateSession) {
            overlay.innerHTML = `
                <div class="ab-modal" style="max-width:340px;text-align:center">
                    <div class="ua-confirm-icon">✓</div>
                    <h2 class="ua-confirm-title">Account created!</h2>
                    <p class="ua-confirm-sub">You're signed in and ready to go.</p>
                    <button class="ab-form-btn ab-form-btn--primary" style="width:100%" id="ua-cok">Continue</button>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('#ua-cok').addEventListener('click', () => { overlay.remove(); location.reload(); });
        } else {
            overlay.innerHTML = `
                <div class="ab-modal" style="max-width:340px;text-align:center">
                    <div class="ua-confirm-icon">✉</div>
                    <h2 class="ua-confirm-title">Check your email</h2>
                    <p class="ua-confirm-sub">Click the verification link, then sign in.</p>
                    <button class="ab-form-btn ab-form-btn--primary" style="width:100%" id="ua-cok">Sign In</button>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('#ua-cok').addEventListener('click', () => { overlay.remove(); openLoginModal(); });
        }
        onOverlayClick(overlay, () => overlay.remove());
    }

    function openAccountModal() {
        if (!session) return;
        const p = userProfile || {};

        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">My Account</h2>
                    <button class="ab-modal__close" id="ua-ac">✕</button>
                </div>

                <p class="ua-account-email">${esc(session.user.email)}</p>

                <form class="ab-form" id="ua-profile-form" style="margin-block-start:16px">
                    <div class="ab-field">
                        <label class="ab-label">Full Name</label>
                        <input class="ab-input" id="ua-pfname" type="text" value="${esc(p.full_name || '')}">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Nickname <small>shown in forums &amp; reviews</small></label>
                        <input class="ab-input" id="ua-pnickname" type="text" value="${esc(p.nickname || '')}" placeholder="e.g. Randy">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Student ID</label>
                        <input class="ab-input" id="ua-psid" type="text" value="${esc(p.student_id || '')}">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">OWA</label>
                        <input class="ab-input" id="ua-powa" type="email" value="${esc(p.owa || session.user.email)}">
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Year of Study</label>
                        <select class="ab-input" id="ua-pyear">
                            <option value="">Select year…</option>
                            ${['Foundation Year','Year 1','Year 2','Year 3','Year 4','Postgraduate'].map(y =>
                                `<option${p.year_of_study === y ? ' selected' : ''}>${y}</option>`
                            ).join('')}
                        </select>
                    </div>
                    <div class="ab-field">
                        <label class="ab-label">Course of Study</label>
                        <input class="ab-input" id="ua-pcourse" type="text" value="${esc(p.course_of_study || '')}">
                    </div>
                    <div id="ua-perr" class="ab-error" hidden></div>
                    <p id="ua-pok" style="font-size:13px;color:hsl(140,60%,48%)" hidden>Saved ✓</p>
                    <div class="ab-form-actions">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="ua-psave">Save Profile</button>
                    </div>
                </form>

                <div class="ua-divider"></div>

                <div id="ua-2fa-section">
                    <h3 class="ua-section-heading">Two-Factor Authentication</h3>
                    <div id="ua-2fa-status">Loading…</div>
                </div>

                <div class="ua-divider"></div>

                <button class="ab-form-btn ab-form-btn--ghost" id="ua-signout" style="width:100%">Sign Out</button>
            </div>`;

        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('#ua-ac').addEventListener('click', close);
        onOverlayClick(overlay, close);

        overlay.querySelector('#ua-profile-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errEl = overlay.querySelector('#ua-perr');
            const okEl  = overlay.querySelector('#ua-pok');
            const btn   = overlay.querySelector('#ua-psave');
            errEl.hidden      = true;
            okEl.hidden       = true;
            btn.disabled      = true;
            btn.textContent   = 'Saving…';

            const updates = {
                id:              session.user.id,
                full_name:       overlay.querySelector('#ua-pfname').value.trim(),
                nickname:        overlay.querySelector('#ua-pnickname').value.trim() || null,
                student_id:      overlay.querySelector('#ua-psid').value.trim(),
                owa:             overlay.querySelector('#ua-powa').value.trim(),
                year_of_study:   overlay.querySelector('#ua-pyear').value,
                course_of_study: overlay.querySelector('#ua-pcourse').value.trim(),
            };

            const { error } = await db.from('user_profiles').upsert(updates);
            btn.disabled    = false;
            btn.textContent = 'Save Profile';

            if (error) {
                errEl.textContent = error.message;
                errEl.hidden = false;
            } else {
                userProfile = { ...userProfile, ...updates };
                window.userProfile = userProfile;
                okEl.hidden = false;
            }
        });

        overlay.querySelector('#ua-signout').addEventListener('click', async () => {
            await db.auth.signOut();
            location.reload();
        });

        load2FAStatus(overlay.querySelector('#ua-2fa-status'));
    }

    async function load2FAStatus(container) {
        const { data: factors } = await db.auth.mfa.listFactors();
        const factor = factors?.totp?.[0];

        if (factor?.status === 'verified') {
            container.innerHTML = `
                <p style="font-size:13px;color:hsl(140,60%,48%);margin-block-end:10px">
                    ✓ Authenticator app enabled
                </p>
                <button class="ab-form-btn ab-form-btn--ghost" id="ua-2fa-remove"
                        style="font-size:13px;padding:5px 14px">Remove 2FA</button>`;
            container.querySelector('#ua-2fa-remove').addEventListener('click', async () => {
                if (!confirm('Remove 2FA? Your account will be less secure.')) return;
                await db.auth.mfa.unenroll({ factorId: factor.id });
                load2FAStatus(container);
            });
        } else {
            container.innerHTML = `
                <p style="font-size:13px;color:hsl(0 0% 48%);margin-block-end:10px">
                    Not enabled — add an authenticator app for extra security.
                </p>
                <button class="ab-form-btn ab-form-btn--primary" id="ua-2fa-setup"
                        style="font-size:13px;padding:5px 14px">Set Up 2FA</button>`;
            container.querySelector('#ua-2fa-setup').addEventListener('click', () => open2FASetup());
        }
    }

    function open2FASetup() {
        const overlay = makeOverlay();
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:380px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Set Up 2FA</h2>
                    <button class="ab-modal__close" id="ua-2fc">✕</button>
                </div>
                <p style="font-size:13px;color:hsl(0 0% 50%);margin-block-end:16px">
                    Scan this QR code with <strong style="color:hsl(0 0% 80%)">Google Authenticator</strong>,
                    <strong style="color:hsl(0 0% 80%)">Authy</strong>, or any TOTP app.
                </p>
                <div id="ua-qr" style="display:flex;flex-direction:column;align-items:center;gap:12px;margin-block:16px">
                    <div style="font-size:13px;color:hsl(0 0% 45%)">Generating…</div>
                </div>
                <form class="ab-form" id="ua-2fa-form">
                    <div class="ab-field">
                        <label class="ab-label">Confirm with app code</label>
                        <input class="ab-input" id="ua-2fa-code" type="text" inputmode="numeric"
                               maxlength="6" placeholder="000000" required>
                    </div>
                    <div id="ua-2fa-err" class="ab-error" hidden></div>
                    <div class="ab-form-actions">
                        <button type="submit" class="ab-form-btn ab-form-btn--primary" id="ua-2fa-verify"
                                disabled>Enable 2FA</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('#ua-2fc').addEventListener('click', close);
        onOverlayClick(overlay, close);

        let factorId;

        (async () => {
            // Best-effort cleanup of leftover unverified factors from past abandoned attempts
            const { data: existing } = await db.auth.mfa.listFactors();
            for (const f of existing?.totp || []) {
                if (f.status !== 'verified') await db.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
            }

            // Unique friendly name every time sidesteps Supabase's "factor already exists" clash
            const { data: enroll, error } = await db.auth.mfa.enroll({
                factorType: 'totp', friendlyName: `Authenticator-${Date.now()}`,
            });
            if (error) {
                overlay.querySelector('#ua-qr').innerHTML =
                    `<p style="color:hsl(5,68%,62%);font-size:13px">${error.message}</p>`;
                return;
            }
            factorId = enroll.id;
            const qrEl = overlay.querySelector('#ua-qr');
            qrEl.innerHTML = `
                <p style="font-size:12px;color:hsl(0 0% 38%);word-break:break-all;text-align:center">
                    Manual key: ${enroll.totp.secret}
                </p>`;
            const img = document.createElement('img');
            img.alt = 'QR Code';
            img.style.cssText = 'width:180px;height:180px;border-radius:8px;background:#fff;padding:8px';
            img.src = enroll.totp.qr_code;
            qrEl.prepend(img);
            overlay.querySelector('#ua-2fa-verify').disabled = false;
            overlay.querySelector('#ua-2fa-code').focus();
        })();

        overlay.querySelector('#ua-2fa-form').addEventListener('submit', async e => {
            e.preventDefault();
            const errEl = overlay.querySelector('#ua-2fa-err');
            const btn   = overlay.querySelector('#ua-2fa-verify');
            errEl.hidden    = true;
            btn.disabled    = true;
            btn.textContent = 'Verifying…';

            const { data: challenge, error: cErr } = await db.auth.mfa.challenge({ factorId });
            if (cErr) {
                errEl.textContent = cErr.message;
                errEl.hidden = false;
                btn.disabled = false; btn.textContent = 'Enable 2FA';
                return;
            }

            const { error: vErr } = await db.auth.mfa.verify({
                factorId,
                challengeId: challenge.id,
                code: overlay.querySelector('#ua-2fa-code').value.trim(),
            });

            if (vErr) {
                errEl.textContent = vErr.message;
                errEl.hidden = false;
                btn.disabled = false; btn.textContent = 'Enable 2FA';
                return;
            }

            close();
            const done = makeOverlay();
            done.innerHTML = `
                <div class="ab-modal" style="max-width:320px;text-align:center">
                    <div class="ua-confirm-icon">🔐</div>
                    <h2 class="ua-confirm-title">2FA Enabled!</h2>
                    <p class="ua-confirm-sub">You'll be asked for a code each time you sign in.</p>
                    <button class="ab-form-btn ab-form-btn--primary" style="width:100%" id="ua-done">Done</button>
                </div>`;
            document.body.appendChild(done);
            done.querySelector('#ua-done').addEventListener('click', () => done.remove());
            onOverlayClick(done, () => done.remove());
        });
    }

    function initMobileNav() {
        const wrapper = document.querySelector('.topnav__wrapper');
        if (!wrapper) return;

        // Hamburger — appended to wrapper so it sits on the right
        const burger = document.createElement('button');
        burger.className = 'topnav__hamburger';
        burger.setAttribute('aria-label', 'Open menu');
        burger.setAttribute('aria-expanded', 'false');
        burger.innerHTML = `
            <span class="topnav__burger-bar"></span>
            <span class="topnav__burger-bar"></span>
            <span class="topnav__burger-bar"></span>`;
        wrapper.appendChild(burger);

        const veil = document.createElement('div');
        veil.className = 'mnd-overlay';
        document.body.appendChild(veil);

        const displayName = esc(userProfile?.nickname || userProfile?.full_name || session?.user?.email || '');
        const drawer = document.createElement('nav');
        drawer.className = 'mnd-drawer';
        drawer.setAttribute('aria-label', 'Mobile navigation');
        drawer.innerHTML = `
            <div class="mnd-head">
                <button class="mnd-close" aria-label="Close menu">✕</button>
            </div>
            <ul class="mnd-links">
                <li><a class="mnd-link" href="/eventspage.html">Events</a></li>
                <li><a class="mnd-link" href="/forum.html">Forum</a></li>
                <li><a class="mnd-link" href="/products.html">Products</a></li>
                <li><a class="mnd-link" href="/committee.html">Committee</a></li>
                <li><a class="mnd-link" href="/about.html">About</a></li>
            </ul>
            <div class="mnd-auth">
                ${!session
                    ? `<button class="mnd-auth-btn mnd-auth-btn--signin" id="mnd-signin">Sign In</button>`
                    : `<p class="mnd-auth-name">${displayName}</p>
                       <a class="mnd-auth-link" href="/profile.html">My Account</a>
                       <a class="mnd-auth-link" href="/settings.html">Settings</a>
                       <button class="mnd-auth-btn mnd-auth-btn--signout" id="mnd-signout">Sign Out</button>`}
            </div>`;
        document.body.appendChild(drawer);

        const open = () => {
            drawer.classList.add('mnd-drawer--open');
            veil.classList.add('mnd-overlay--on');
            document.body.style.overflow = 'hidden';
            burger.setAttribute('aria-expanded', 'true');
        };
        const close = () => {
            drawer.classList.remove('mnd-drawer--open');
            veil.classList.remove('mnd-overlay--on');
            document.body.style.overflow = '';
            burger.setAttribute('aria-expanded', 'false');
        };

        burger.addEventListener('click', open);
        veil.addEventListener('click', close);
        drawer.querySelector('.mnd-close').addEventListener('click', close);
        drawer.querySelectorAll('.mnd-link, .mnd-auth-link').forEach(a => a.addEventListener('click', close));

        drawer.querySelector('#mnd-signin')?.addEventListener('click', () => {
            close();
            openLoginModal();
        });
        drawer.querySelector('#mnd-signout')?.addEventListener('click', async () => {
            await db.auth.signOut();
            location.reload();
        });
    }

    function makeOverlay() {
        const el = document.createElement('div');
        el.className = 'ab-overlay';
        return el;
    }

    // Only close when the drag started AND ended on the overlay (not after selecting text in a field)
    function onOverlayClick(overlay, fn) {
        let downOnOverlay = false;
        overlay.addEventListener('mousedown', e => { downOnOverlay = e.target === overlay; });
        overlay.addEventListener('click',     e => { if (e.target === overlay && downOnOverlay) fn(); });
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function getInitials(str) {
        return String(str || '?').split(' ').map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
    }

})();
