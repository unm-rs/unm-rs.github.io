(function () {
    function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

    window.openImageCropper = function (file, opts) {
        const { aspect, circle = false, outputWidth, outputHeight } = opts;

        return new Promise(resolve => {
            const viewportW = 320;
            const viewportH = Math.round(viewportW / aspect);
            const objectUrl = URL.createObjectURL(file);

            const overlay = document.createElement('div');
            overlay.className = 'ab-overlay';
            overlay.innerHTML = `
                <div class="ab-modal ic-modal">
                    <div class="ab-modal__head">
                        <h2 class="ab-modal__title">Crop Image</h2>
                        <button class="ab-modal__close" id="ic-close">✕</button>
                    </div>
                    <div class="ic-frame${circle ? ' ic-frame--circle' : ''}" id="ic-frame"
                         style="width:${viewportW}px;height:${viewportH}px">
                        <div class="ic-bg" id="ic-bg"></div>
                    </div>
                    <input type="range" id="ic-zoom" class="ic-zoom" min="1" max="3" step="0.01" value="1">
                    <div class="ab-form-actions">
                        <button class="ab-form-btn ab-form-btn--ghost" id="ic-cancel">Cancel</button>
                        <button class="ab-form-btn ab-form-btn--primary" id="ic-confirm">Use This Crop</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const frame  = overlay.querySelector('#ic-frame');
            const bg     = overlay.querySelector('#ic-bg');
            const zoomEl = overlay.querySelector('#ic-zoom');

            const finish = result => {
                overlay.remove();
                URL.revokeObjectURL(objectUrl);
                resolve(result);
            };
            overlay.querySelector('#ic-close').addEventListener('click', () => finish(null));
            overlay.querySelector('#ic-cancel').addEventListener('click', () => finish(null));
            overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });

            const img = new Image();
            let naturalW, naturalH, baseScale, scale, offsetX, offsetY;

            img.onload = () => {
                naturalW  = img.naturalWidth;
                naturalH  = img.naturalHeight;
                baseScale = Math.max(viewportW / naturalW, viewportH / naturalH);
                scale     = baseScale;
                offsetX   = (viewportW - naturalW * scale) / 2;
                offsetY   = (viewportH - naturalH * scale) / 2;
                bg.style.backgroundImage = `url('${objectUrl}')`;
                render();
            };
            img.src = objectUrl;

            function render() {
                bg.style.backgroundSize     = `${naturalW * scale}px ${naturalH * scale}px`;
                bg.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
            }

            function clampOffsets() {
                const scaledW = naturalW * scale;
                const scaledH = naturalH * scale;
                offsetX = clamp(offsetX, viewportW - scaledW, 0);
                offsetY = clamp(offsetY, viewportH - scaledH, 0);
            }

            let dragging = false, lastX = 0, lastY = 0;
            frame.addEventListener('pointerdown', e => {
                if (!naturalW) return;
                dragging = true;
                lastX = e.clientX;
                lastY = e.clientY;
                frame.setPointerCapture(e.pointerId);
            });
            frame.addEventListener('pointermove', e => {
                if (!dragging) return;
                offsetX += e.clientX - lastX;
                offsetY += e.clientY - lastY;
                lastX = e.clientX;
                lastY = e.clientY;
                clampOffsets();
                render();
            });
            frame.addEventListener('pointerup', () => { dragging = false; });
            frame.addEventListener('pointercancel', () => { dragging = false; });

            zoomEl.addEventListener('input', () => {
                if (!naturalW) return;
                scale = baseScale * Number(zoomEl.value);
                clampOffsets();
                render();
            });

            overlay.querySelector('#ic-confirm').addEventListener('click', () => {
                if (!naturalW) return;
                const canvas = document.createElement('canvas');
                canvas.width  = outputWidth;
                canvas.height = outputHeight;
                const ctx = canvas.getContext('2d');
                const sx = -offsetX / scale;
                const sy = -offsetY / scale;
                const sW = viewportW / scale;
                const sH = viewportH / scale;
                ctx.drawImage(img, sx, sy, sW, sH, 0, 0, outputWidth, outputHeight);
                canvas.toBlob(blob => {
                    finish(blob ? new File([blob], 'crop.jpg', { type: 'image/jpeg' }) : null);
                }, 'image/jpeg', 0.9);
            });
        });
    };
})();
