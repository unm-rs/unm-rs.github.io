(async function () {
    if (typeof db === 'undefined') return;

    const BUCKET = 'event-images';

    const ALLOWED_TAGS = new Set([
        'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'UL', 'OL', 'LI', 'BR', 'P', 'DIV', 'SPAN',
        'H1', 'H2', 'H3', 'H4', 'A', 'IMG', 'BLOCKQUOTE', 'HR',
    ]);
    const ALLOWED_ATTRS = {
        A:   new Set(['href', 'target', 'rel']),
        IMG: new Set(['src', 'alt', 'style']),
        '*': new Set(['style', 'class']),
    };

    // Iterative (not recursive) DOM walk — a recursive version of this exact
    // kind of sanitizer previously blew the call stack on deeply nested
    // contenteditable output and silently killed the whole page render.
    function sanitizeHtml(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html || '';

        const stack = [tpl.content];
        while (stack.length) {
            const node = stack.pop();
            [...node.childNodes].forEach(child => {
                if (child.nodeType !== Node.ELEMENT_NODE) return;
                if (!ALLOWED_TAGS.has(child.tagName)) {
                    child.replaceWith(...child.childNodes);
                    stack.push(node);
                    return;
                }
                const allowed = ALLOWED_ATTRS[child.tagName] || ALLOWED_ATTRS['*'];
                [...child.attributes].forEach(attr => {
                    if (!allowed.has(attr.name)) child.removeAttribute(attr.name);
                });
                if (child.tagName === 'A') {
                    child.setAttribute('target', '_blank');
                    child.setAttribute('rel', 'noopener noreferrer');
                }
                stack.push(child);
            });
        }
        return tpl.innerHTML;
    }

    const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    function validateImageFile(file) {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) { alert('Please choose a PNG, JPEG, WEBP, or GIF image.'); return false; }
        if (file.size > MAX_IMAGE_BYTES) { alert('Image must be under 5MB.'); return false; }
        return true;
    }

    // Native CSS `resize` and execCommand('justify*') both behave unreliably on
    // a contenteditable=false island nested inside a contenteditable=true
    // region (browsers treat these atomic islands specially for drag/selection),
    // so resize + alignment are done here with plain pointer events and direct
    // style writes instead of relying on either.
    function setAlignment(frame, align) {
        frame.style.float          = '';
        frame.style.display        = '';
        frame.style.marginInline   = '';
        frame.style.marginInlineEnd   = '';
        frame.style.marginInlineStart = '';
        if (align === 'left') {
            frame.style.float = 'left';
            frame.style.marginInlineEnd = '14px';
        } else if (align === 'right') {
            frame.style.float = 'right';
            frame.style.marginInlineStart = '14px';
        } else if (align === 'center') {
            frame.style.display      = 'block';
            frame.style.marginInline = 'auto';
        } else {
            frame.style.display = 'inline-block';
        }
    }

    function wrapImageForResize(img) {
        // A frame can already exist around this image (loaded from saved
        // content) but be missing its handle/align controls, since those
        // are deliberately stripped out before saving — don't bail out just
        // because the frame itself survived, or the controls never come back.
        let frame = img.parentElement?.classList.contains('about-img-frame') ? img.parentElement : null;
        const hadFrame = !!frame;
        if (!frame) {
            frame = document.createElement('span');
            frame.className = 'about-img-frame';
            img.replaceWith(frame);
            frame.appendChild(img);
        }
        frame.contentEditable = 'false';
        img.style.width  = '100%';
        img.style.height = '100%';
        img.style.display = 'block';
        img.style.objectFit = 'cover';

        if (!frame.querySelector('.about-img-align')) {
            const align = document.createElement('span');
            align.className = 'about-img-align';
            align.innerHTML = `
                <button type="button" data-align="left"   title="Float left">◧</button>
                <button type="button" data-align="center" title="Center">▣</button>
                <button type="button" data-align="right"  title="Float right">◨</button>
                <button type="button" data-align="inline"  title="Inline with text">≡</button>`;
            frame.appendChild(align);
            align.querySelectorAll('[data-align]').forEach(btn => {
                btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
                btn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAlignment(frame, btn.dataset.align);
                    markDirty();
                });
            });
        }

        if (!frame.querySelector('.about-img-handle')) {
            const handle = document.createElement('span');
            handle.className = 'about-img-handle';
            frame.appendChild(handle);

            let resizing = false, startX, startY, startW, startH;
            handle.addEventListener('pointerdown', e => {
                e.preventDefault();
                e.stopPropagation();
                resizing = true;
                startX = e.clientX; startY = e.clientY;
                startW = frame.offsetWidth; startH = frame.offsetHeight;
                handle.setPointerCapture(e.pointerId);
            });
            handle.addEventListener('pointermove', e => {
                if (!resizing) return;
                frame.style.width  = `${Math.max(40, startW + (e.clientX - startX))}px`;
                frame.style.height = `${Math.max(40, startH + (e.clientY - startY))}px`;
            });
            handle.addEventListener('pointerup', () => {
                if (!resizing) return;
                resizing = false;
                markDirty();
            });
            handle.addEventListener('pointercancel', () => { resizing = false; });
        }

        // Only auto-size a brand new image — a frame loaded from saved
        // content already has its previously-chosen size and re-applying
        // the natural-size default here would silently undo every resize
        // as soon as the page is reloaded.
        if (!hadFrame) {
            const applySize = () => {
                const maxW = 420;
                const w = Math.min(img.naturalWidth || maxW, maxW);
                const h = img.naturalWidth ? w * (img.naturalHeight / img.naturalWidth) : w * 0.6;
                frame.style.width  = `${w}px`;
                frame.style.height = `${h}px`;
            };
            if (img.complete && img.naturalWidth) applySize();
            else img.addEventListener('load', applySize, { once: true });
        }
    }

    const root = document.getElementById('js-about-root');
    const [{ isAdmin }, { data: row }] = await Promise.all([
        window.roleReady,
        db.from('about_page').select('content').eq('id', true).maybeSingle(),
    ]);

    const savedContent = row?.content || '';
    document.title = 'About';

    root.innerHTML = `
        <div class="about-wrap">
            ${isAdmin ? `
            <div class="fmt-toolbar about-toolbar" id="ab-toolbar">
                <select class="fmt-btn about-block-select" id="ab-block" title="Paragraph style">
                    <option value="p">Paragraph</option>
                    <option value="h1">Heading 1</option>
                    <option value="h2">Heading 2</option>
                    <option value="h3">Heading 3</option>
                    <option value="blockquote">Quote</option>
                </select>
                <span class="fmt-sep"></span>
                <button type="button" class="fmt-btn" data-cmd="bold" title="Bold"><b>B</b></button>
                <button type="button" class="fmt-btn" data-cmd="italic" title="Italic"><i>I</i></button>
                <button type="button" class="fmt-btn" data-cmd="underline" title="Underline"><u>U</u></button>
                <button type="button" class="fmt-btn" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
                <span class="fmt-sep"></span>
                <button type="button" class="fmt-btn" data-cmd="justifyLeft" title="Align left">◧</button>
                <button type="button" class="fmt-btn" data-cmd="justifyCenter" title="Align center">▣</button>
                <button type="button" class="fmt-btn" data-cmd="justifyRight" title="Align right">◨</button>
                <span class="fmt-sep"></span>
                <button type="button" class="fmt-btn" data-cmd="insertUnorderedList" title="Bullet list">&#8226; List</button>
                <button type="button" class="fmt-btn" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
                <span class="fmt-sep"></span>
                <input type="color" class="about-color-input" id="ab-text-color" title="Text color" value="#1a1a1a">
                <input type="color" class="about-color-input" id="ab-bg-color" title="Highlight color" value="#fff59d">
                <span class="fmt-sep"></span>
                <button type="button" class="fmt-btn" id="ab-link" title="Insert link">Link</button>
                <button type="button" class="fmt-btn" id="ab-image" title="Insert image">Image</button>
                <button type="button" class="fmt-btn" data-cmd="removeFormat" title="Clear formatting">✕ Clear</button>
                <input type="file" id="ab-image-input" accept="image/*" hidden>
            </div>` : ''}
            <div class="about-canvas${isAdmin ? ' about-canvas--editing' : ''}" id="about-canvas"
                 ${isAdmin ? 'contenteditable="true"' : ''}>${sanitizeHtml(savedContent)}</div>
        </div>`;

    if (!isAdmin) return;

    document.execCommand('styleWithCSS', false, true);

    const canvas   = document.getElementById('about-canvas');
    const toolbar  = document.getElementById('ab-toolbar');
    const saveBar  = document.getElementById('js-savebar');
    const saveBtn  = document.getElementById('js-savebtn');
    let isDirty = false;

    canvas.querySelectorAll('img').forEach(wrapImageForResize);

    function markDirty() {
        if (isDirty) return;
        isDirty = true;
        saveBar.hidden = false;
        document.body.style.paddingBottom = '72px';
    }

    canvas.addEventListener('input', markDirty);

    toolbar.addEventListener('mousedown', e => {
        const btn = e.target.closest('[data-cmd]');
        if (!btn) return;
        e.preventDefault();
        canvas.focus();
        document.execCommand(btn.dataset.cmd, false, null);
        markDirty();
    });

    document.getElementById('ab-block').addEventListener('change', e => {
        canvas.focus();
        document.execCommand('formatBlock', false, e.target.value);
        markDirty();
    });

    document.getElementById('ab-text-color').addEventListener('input', e => {
        canvas.focus();
        document.execCommand('foreColor', false, e.target.value);
        markDirty();
    });

    document.getElementById('ab-bg-color').addEventListener('input', e => {
        canvas.focus();
        document.execCommand('hiliteColor', false, e.target.value);
        markDirty();
    });

    document.getElementById('ab-link').addEventListener('click', () => {
        const url = prompt('Link URL:', 'https://');
        if (!url) return;
        canvas.focus();
        document.execCommand('createLink', false, url);
        markDirty();
    });

    const imageInput = document.getElementById('ab-image-input');
    document.getElementById('ab-image').addEventListener('click', () => imageInput.click());

    imageInput.addEventListener('change', async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file || !validateImageFile(file)) return;

        const ext  = file.name.split('.').pop().toLowerCase();
        const path = `about/${Date.now()}.${ext}`;
        const { data: up, error: upErr } = await db.storage.from(BUCKET).upload(path, file, { upsert: true });
        if (upErr) { alert('Image upload failed: ' + upErr.message); return; }

        const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(up.path);
        canvas.focus();
        document.execCommand('insertImage', false, publicUrl);
        canvas.querySelectorAll(`img[src="${publicUrl}"]`).forEach(wrapImageForResize);
        markDirty();
    });

    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        const clone = canvas.cloneNode(true);
        clone.querySelectorAll('.about-img-handle, .about-img-align').forEach(el => el.remove());
        const { error } = await db.from('about_page').update({ content: clone.innerHTML }).eq('id', true);

        if (error) {
            alert('Save failed: ' + error.message);
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save Changes';
            return;
        }

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
