/**
 * tags-ui.js — shared owner-assignable tag badges, used on the profile
 * page and in the forum (thread posts). Kept in one place so the picker
 * modal and removal logic don't drift between the two call sites.
 */
(function () {
    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    window.fetchUserTags = async function (userId) {
        const { data } = await db
            .from('user_tags')
            .select('tags(id, name, color, bg_color, visible)')
            .eq('user_id', userId);
        return (data || []).map(r => r.tags).filter(t => t && t.visible);
    };

    window.tagBadges = function (tags, isOwner, userId) {
        return (tags || [])
            .map(t => `
                <span class="pf-tag-badge" style="--tag-color:${esc(t.color)};--tag-bg:${esc(t.bg_color)}">
                    ${esc(t.name)}
                    ${isOwner ? `<button type="button" class="pf-tag-remove-btn" data-remove-tag="${esc(t.id)}"
                        data-remove-user="${esc(userId)}" title="Remove tag" aria-label="Remove ${esc(t.name)} tag">×</button>` : ''}
                </span>`)
            .join('');
    };

    window.tagAddButton = function (userId) {
        return `<button type="button" class="pf-tag-add-btn" data-tag-add="${esc(userId)}"
            title="Manage tags" aria-label="Manage tags">+</button>`;
    };

    // Wires every remove (×) and add (+) tag control found within `root`.
    // `onChanged(userId)` fires after any change so the caller can refresh that person's badges.
    window.wireTagUI = function (root, onChanged) {
        root.querySelectorAll('[data-remove-tag]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                e.stopPropagation();
                const userId = btn.dataset.removeUser;
                btn.disabled = true;
                const { error } = await db
                    .from('user_tags').delete().eq('user_id', userId).eq('tag_id', btn.dataset.removeTag);
                if (error) { alert('Failed: ' + error.message); btn.disabled = false; return; }
                onChanged(userId);
            });
        });

        root.querySelectorAll('[data-tag-add]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                const userId = btn.dataset.tagAdd;
                window.openTagPicker(userId, () => onChanged(userId));
            });
        });
    };

    window.openTagPicker = async function (userId, onChange) {
        const overlay = document.createElement('div');
        overlay.className = 'ab-overlay';
        overlay.innerHTML = `
            <div class="ab-modal" style="max-width:360px">
                <div class="ab-modal__head">
                    <h2 class="ab-modal__title">Manage Tags</h2>
                    <button class="ab-modal__close" id="tp-close">✕</button>
                </div>
                <div id="tp-list" class="st-mods-list">Loading…</div>
            </div>`;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('#tp-close').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        const listEl = overlay.querySelector('#tp-list');

        const [{ data: allTags }, { data: assignedRows }] = await Promise.all([
            db.from('tags').select('*').order('name'),
            db.from('user_tags').select('tag_id').eq('user_id', userId),
        ]);

        if (!allTags || allTags.length === 0) {
            listEl.innerHTML = `<p class="st-mods-empty">No tags yet — create one in Settings.</p>`;
            return;
        }

        const assignedIds = new Set((assignedRows || []).map(r => r.tag_id));

        listEl.innerHTML = allTags.map(t => `
            <label class="st-mods-row pf-tag-picker-row">
                <span class="pf-tag-badge" style="--tag-color:${esc(t.color)};--tag-bg:${esc(t.bg_color)}">${esc(t.name)}</span>
                <span class="st-mods-row__name">${t.visible ? '' : 'Hidden'}</span>
                <input type="checkbox" data-tag-id="${esc(t.id)}" ${assignedIds.has(t.id) ? 'checked' : ''}>
            </label>`).join('');

        listEl.querySelectorAll('[data-tag-id]').forEach(input => {
            input.addEventListener('change', async () => {
                input.disabled = true;
                if (input.checked) {
                    const { error } = await db.from('user_tags').insert({ user_id: userId, tag_id: input.dataset.tagId });
                    if (error) { alert('Failed: ' + error.message); input.checked = false; }
                } else {
                    const { error } = await db
                        .from('user_tags').delete().eq('user_id', userId).eq('tag_id', input.dataset.tagId);
                    if (error) { alert('Failed: ' + error.message); input.checked = true; }
                }
                input.disabled = false;
                onChange?.();
            });
        });
    };
})();
