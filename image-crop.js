(function () {
    function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

    const STAGE_MAX = 420;
    const MIN_BOX   = 40;
    const HANDLES   = ['nw', 'ne', 'sw', 'se'];

    function stageMarkup(circle) {
        return `
            <div class="ic-stage">
                <img class="ic-img" alt="" draggable="false">
                <div class="ic-mask ic-mask--top"></div>
                <div class="ic-mask ic-mask--bottom"></div>
                <div class="ic-mask ic-mask--left"></div>
                <div class="ic-mask ic-mask--right"></div>
                <div class="ic-cropbox${circle ? ' ic-cropbox--circle' : ''}">
                    <div class="ic-grid-line ic-grid-line--v1"></div>
                    <div class="ic-grid-line ic-grid-line--v2"></div>
                    <div class="ic-grid-line ic-grid-line--h1"></div>
                    <div class="ic-grid-line ic-grid-line--h2"></div>
                    ${HANDLES.map(h => `<div class="ic-handle ic-handle--${h}" data-handle="${h}"></div>`).join('')}
                </div>
            </div>`;
    }

    // Wires one drag/resize crop box against `img` (already loaded) into the
    // given container, at at most `stageMax` px. Shared by the single- and
    // dual-frame croppers so their drag/resize math can't drift apart.
    function initCropStage(container, img, aspect, stageMax) {
        const stage = container.querySelector('.ic-stage');
        const imgEl = container.querySelector('.ic-img');
        const boxEl = container.querySelector('.ic-cropbox');
        const masks = {
            top:    container.querySelector('.ic-mask--top'),
            bottom: container.querySelector('.ic-mask--bottom'),
            left:   container.querySelector('.ic-mask--left'),
            right:  container.querySelector('.ic-mask--right'),
        };

        const naturalW = img.naturalWidth;
        const naturalH = img.naturalHeight;
        const displayScale = Math.min(stageMax / naturalW, stageMax / naturalH, 1);
        const displayW = naturalW * displayScale;
        const displayH = naturalH * displayScale;

        stage.style.width  = `${displayW}px`;
        stage.style.height = `${displayH}px`;
        imgEl.src = img.src;
        imgEl.style.width  = `${displayW}px`;
        imgEl.style.height = `${displayH}px`;

        const boxW = Math.min(displayW, displayH * aspect);
        const boxH = boxW / aspect;
        let box = {
            left: (displayW - boxW) / 2,
            top:  (displayH - boxH) / 2,
            width: boxW,
            height: boxH,
        };

        function render() {
            boxEl.style.left   = `${box.left}px`;
            boxEl.style.top    = `${box.top}px`;
            boxEl.style.width  = `${box.width}px`;
            boxEl.style.height = `${box.height}px`;

            masks.top.style.cssText    = `left:0;top:0;width:100%;height:${box.top}px`;
            masks.bottom.style.cssText = `left:0;top:${box.top + box.height}px;width:100%;height:${displayH - box.top - box.height}px`;
            masks.left.style.cssText   = `left:0;top:${box.top}px;width:${box.left}px;height:${box.height}px`;
            masks.right.style.cssText  = `left:${box.left + box.width}px;top:${box.top}px;width:${displayW - box.left - box.width}px;height:${box.height}px`;
        }
        render();

        function stagePoint(e) {
            const rect = stage.getBoundingClientRect();
            return { x: clamp(e.clientX - rect.left, 0, displayW), y: clamp(e.clientY - rect.top, 0, displayH) };
        }

        // ---- Move ----
        let moving = false, moveStart = null, boxStart = null;
        boxEl.addEventListener('pointerdown', e => {
            if (e.target.closest('[data-handle]')) return;
            moving = true;
            moveStart = { x: e.clientX, y: e.clientY };
            boxStart  = { ...box };
            boxEl.setPointerCapture(e.pointerId);
        });
        boxEl.addEventListener('pointermove', e => {
            if (!moving) return;
            const dx = e.clientX - moveStart.x;
            const dy = e.clientY - moveStart.y;
            box.left = clamp(boxStart.left + dx, 0, displayW - box.width);
            box.top  = clamp(boxStart.top  + dy, 0, displayH - box.height);
            render();
        });
        boxEl.addEventListener('pointerup',     () => { moving = false; });
        boxEl.addEventListener('pointercancel', () => { moving = false; });

        // ---- Resize via corner handles ----
        let resizing = null, anchor = null;
        boxEl.querySelectorAll('[data-handle]').forEach(handle => {
            handle.addEventListener('pointerdown', e => {
                e.stopPropagation();
                resizing = handle.dataset.handle;
                const isEast  = resizing.includes('e');
                const isSouth = resizing.includes('s');
                anchor = {
                    x: isEast  ? box.left : box.left + box.width,
                    y: isSouth ? box.top  : box.top + box.height,
                    isEast, isSouth,
                };
                handle.setPointerCapture(e.pointerId);
            });
            handle.addEventListener('pointermove', e => {
                if (!resizing) return;
                const p = stagePoint(e);
                const dx = Math.abs(p.x - anchor.x);
                const dy = Math.abs(p.y - anchor.y);

                const maxW = anchor.isEast  ? displayW - anchor.x : anchor.x;
                const maxH = anchor.isSouth ? displayH - anchor.y : anchor.y;

                let w = Math.max(MIN_BOX, dx, dy * aspect);
                w = Math.min(w, maxW, maxH * aspect);
                const h = w / aspect;

                box = {
                    left:   anchor.isEast  ? anchor.x : anchor.x - w,
                    top:    anchor.isSouth ? anchor.y : anchor.y - h,
                    width:  w,
                    height: h,
                };
                render();
            });
            handle.addEventListener('pointerup',     () => { resizing = null; });
            handle.addEventListener('pointercancel', () => { resizing = null; });
        });

        return {
            getCropRect() {
                return {
                    sx: box.left / displayScale,
                    sy: box.top / displayScale,
                    sW: box.width / displayScale,
                    sH: box.height / displayScale,
                };
            },
        };
    }

    function cropToFile(img, rect, outputWidth, outputHeight) {
        return new Promise(resolve => {
            const canvas = document.createElement('canvas');
            canvas.width  = outputWidth;
            canvas.height = outputHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, rect.sx, rect.sy, rect.sW, rect.sH, 0, 0, outputWidth, outputHeight);
            canvas.toBlob(blob => resolve(blob ? new File([blob], 'crop.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.9);
        });
    }

    window.openImageCropper = function (file, opts) {
        const { aspect, circle = false, outputWidth, outputHeight } = opts;

        return new Promise(resolve => {
            const objectUrl = URL.createObjectURL(file);

            const overlay = document.createElement('div');
            overlay.className = 'ab-overlay';
            overlay.innerHTML = `
                <div class="ab-modal ic-modal">
                    <div class="ab-modal__head">
                        <h2 class="ab-modal__title">Crop Image</h2>
                        <button class="ab-modal__close" id="ic-close">✕</button>
                    </div>
                    <div id="ic-container">${stageMarkup(circle)}</div>
                    <div class="ab-form-actions">
                        <button class="ab-form-btn ab-form-btn--ghost" id="ic-cancel">Cancel</button>
                        <button class="ab-form-btn ab-form-btn--primary" id="ic-confirm">Use This Crop</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const finish = result => {
                overlay.remove();
                URL.revokeObjectURL(objectUrl);
                resolve(result);
            };
            overlay.querySelector('#ic-close').addEventListener('click', () => finish(null));
            overlay.querySelector('#ic-cancel').addEventListener('click', () => finish(null));
            overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });

            let stageApi = null;
            const img = new Image();
            img.onload = () => {
                stageApi = initCropStage(overlay.querySelector('#ic-container'), img, aspect, STAGE_MAX);
            };
            img.src = objectUrl;

            overlay.querySelector('#ic-confirm').addEventListener('click', async () => {
                if (!stageApi) return;
                const fileOut = await cropToFile(img, stageApi.getCropRect(), outputWidth, outputHeight);
                finish(fileOut);
            });
        });
    };

    // Two independently pannable/zoomable crop frames against the SAME
    // source image in one modal — e.g. a desktop (16:9) crop stacked above
    // a mobile (1:1) crop. Resolves { desktop: File, mobile: File } | null.
    window.openDualImageCropper = function (file, opts) {
        const { top, bottom } = opts; // each: { aspect, outputWidth, outputHeight, label, circle }

        return new Promise(resolve => {
            const objectUrl = URL.createObjectURL(file);

            const overlay = document.createElement('div');
            overlay.className = 'ab-overlay';
            overlay.innerHTML = `
                <div class="ab-modal ic-modal ic-modal--dual">
                    <div class="ab-modal__head">
                        <h2 class="ab-modal__title">Crop Image</h2>
                        <button class="ab-modal__close" id="ic-close">✕</button>
                    </div>
                    <p class="ic-dual-label">${esc(top.label)}</p>
                    <div id="ic-container-top">${stageMarkup(top.circle)}</div>
                    <p class="ic-dual-label">${esc(bottom.label)}</p>
                    <div id="ic-container-bottom">${stageMarkup(bottom.circle)}</div>
                    <div class="ab-form-actions">
                        <button class="ab-form-btn ab-form-btn--ghost" id="ic-cancel">Cancel</button>
                        <button class="ab-form-btn ab-form-btn--primary" id="ic-confirm">Use These Crops</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const finish = result => {
                overlay.remove();
                URL.revokeObjectURL(objectUrl);
                resolve(result);
            };
            overlay.querySelector('#ic-close').addEventListener('click', () => finish(null));
            overlay.querySelector('#ic-cancel').addEventListener('click', () => finish(null));
            overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });

            let topApi = null, bottomApi = null;
            const img = new Image();
            img.onload = () => {
                const stageMax = 380;
                topApi    = initCropStage(overlay.querySelector('#ic-container-top'),    img, top.aspect,    stageMax);
                bottomApi = initCropStage(overlay.querySelector('#ic-container-bottom'), img, bottom.aspect, stageMax);
            };
            img.src = objectUrl;

            overlay.querySelector('#ic-confirm').addEventListener('click', async () => {
                if (!topApi || !bottomApi) return;
                const [desktop, mobile] = await Promise.all([
                    cropToFile(img, topApi.getCropRect(),    top.outputWidth,    top.outputHeight),
                    cropToFile(img, bottomApi.getCropRect(), bottom.outputWidth, bottom.outputHeight),
                ]);
                finish(desktop && mobile ? { desktop, mobile } : null);
            });
        });
    };

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
})();
