/** ============================================================
 *  signature.js — PDF Signature Tool
 *  Libraries: pdf-lib (embed), PDF.js (preview & thumbnails)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ─── State ─────────────────────────────────────────────────────
const state = {
    pdfFile:        null,
    pdfJsDoc:       null,
    totalPages:     0,
    selectedPage:   1,
    signatureDataUrl: null,
    activeTab:      'draw',
    sigPos:  { x: 50, y: 50 },
    sigWidth: 150,
};

let isDrawing    = false;
let hasDrawn     = false;
let lastX = 0, lastY = 0;
let drawCtx      = null;
let drawCanvas   = null;

// ─── Upload PDF ─────────────────────────────────────────────────
document.getElementById('pdfInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await loadPDF(file);
    e.target.value = '';
});

const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') await loadPDF(file);
});

async function loadPDF(file) {
    try {
        state.pdfFile = file;
        document.getElementById('uploadedFileName').textContent = `📄 ${file.name}`;
        document.getElementById('uploadedFile').classList.remove('hidden');
        document.getElementById('dropZone').classList.add('hidden');

        const buf = await file.arrayBuffer();
        state.pdfJsDoc = await pdfjsLib.getDocument({ data: buf }).promise;
        state.totalPages = state.pdfJsDoc.numPages;

        enableStep('stepPage');
        await renderPageSelector();
        enableStep('stepSign');
        initDrawCanvas();
    } catch (err) {
        alert('Gagal memuat PDF: ' + err.message);
    }
}

function clearPDF() {
    state.pdfFile    = null;
    state.pdfJsDoc   = null;
    state.totalPages = 0;
    state.signatureDataUrl = null;

    document.getElementById('uploadedFile').classList.add('hidden');
    document.getElementById('dropZone').classList.remove('hidden');
    document.getElementById('pdfInput').value = '';
    document.getElementById('pageSelector').innerHTML =
        '<p class="placeholder-text">Upload PDF terlebih dahulu</p>';

    ['stepPage','stepSign','stepPosition','stepDownload'].forEach(disableStep);
    document.getElementById('signatureOverlay').classList.add('hidden');
    document.getElementById('downloadStatus').classList.add('hidden');
}

// ─── Page Selector ──────────────────────────────────────────────
async function renderPageSelector() {
    const container = document.getElementById('pageSelector');
    container.innerHTML = '';

    for (let i = 1; i <= state.totalPages; i++) {
        const page     = await state.pdfJsDoc.getPage(i);
        const viewport = page.getViewport({ scale: 0.22 });

        const canvas  = document.createElement('canvas');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const item = document.createElement('div');
        item.className = 'page-thumb-item' + (i === 1 ? ' selected' : '');
        item.id        = `pageThumb${i}`;
        item.onclick   = () => selectPage(i);

        const label = document.createElement('span');
        label.textContent = `Hal. ${i}`;

        item.appendChild(canvas);
        item.appendChild(label);
        container.appendChild(item);
    }

    state.selectedPage = 1;
}

function selectPage(num) {
    document.querySelectorAll('.page-thumb-item').forEach(el => el.classList.remove('selected'));
    document.getElementById(`pageThumb${num}`).classList.add('selected');
    state.selectedPage = num;
    if (state.signatureDataUrl) renderPDFPreview();
}

// ─── Drawing Canvas ─────────────────────────────────────────────
function initDrawCanvas() {
    drawCanvas = document.getElementById('signatureCanvas');
    drawCtx    = drawCanvas.getContext('2d');

    const wrapper = document.getElementById('canvasWrapper');

    function resize() {
        const ratio = window.devicePixelRatio || 1;
        const w = wrapper.clientWidth;
        drawCanvas.width  = w * ratio;
        drawCanvas.height = 180 * ratio;
        drawCanvas.style.width  = w + 'px';
        drawCanvas.style.height = '180px';
        drawCtx.scale(ratio, ratio);
        applyPenStyle();
        hasDrawn = false;
        document.getElementById('canvasHint').classList.remove('hidden');
    }

    resize();
    window.addEventListener('resize', resize);

    function getPos(e) {
        const rect = drawCanvas.getBoundingClientRect();
        const src  = e.touches ? e.touches[0] : e;
        return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }

    function start(e) {
        e.preventDefault();
        isDrawing = true;
        const p = getPos(e);
        [lastX, lastY] = [p.x, p.y];
        document.getElementById('canvasHint').classList.add('hidden');
    }

    function move(e) {
        e.preventDefault();
        if (!isDrawing) return;
        applyPenStyle();
        const p = getPos(e);
        drawCtx.beginPath();
        drawCtx.moveTo(lastX, lastY);
        drawCtx.lineTo(p.x, p.y);
        drawCtx.stroke();
        [lastX, lastY] = [p.x, p.y];
        hasDrawn = true;
        document.getElementById('useSignatureBtn').disabled = false;
    }

    function stop() { isDrawing = false; }

    drawCanvas.addEventListener('mousedown',  start);
    drawCanvas.addEventListener('mousemove',  move);
    drawCanvas.addEventListener('mouseup',    stop);
    drawCanvas.addEventListener('mouseleave', stop);
    drawCanvas.addEventListener('touchstart', start, { passive: false });
    drawCanvas.addEventListener('touchmove',  move,  { passive: false });
    drawCanvas.addEventListener('touchend',   stop);
}

function applyPenStyle() {
    if (!drawCtx) return;
    drawCtx.strokeStyle = document.getElementById('penColor').value;
    drawCtx.lineWidth   = parseInt(document.getElementById('penSize').value);
    drawCtx.lineCap     = 'round';
    drawCtx.lineJoin    = 'round';
}

function clearCanvas() {
    if (!drawCtx || !drawCanvas) return;
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    hasDrawn = false;
    document.getElementById('canvasHint').classList.remove('hidden');
    if (state.activeTab === 'draw')
        document.getElementById('useSignatureBtn').disabled = true;
}

document.getElementById('penSize').addEventListener('input', function () {
    document.getElementById('penSizeLabel').textContent = this.value + 'px';
});

// ─── Type Signature ─────────────────────────────────────────────
function updateTypeSignature() {
    const text  = document.getElementById('typeInput').value;
    const font  = document.getElementById('fontSelect').value;
    const color = document.getElementById('typeColor').value;
    const canvas = document.getElementById('typeCanvas');
    const ctx    = canvas.getContext('2d');

    canvas.width  = (canvas.parentElement?.clientWidth || 500);
    canvas.height = 140;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!text) {
        document.getElementById('useSignatureBtn').disabled = true;
        return;
    }

    ctx.fillStyle    = color;
    ctx.font         = `64px '${font}'`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    document.getElementById('useSignatureBtn').disabled = false;
}

// ─── Upload Signature Image ─────────────────────────────────────
document.getElementById('sigImageInput').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.getElementById('uploadCanvas');
            canvas.classList.remove('hidden');
            const ctx = canvas.getContext('2d');
            canvas.width  = canvas.parentElement?.clientWidth || 500;
            canvas.height = 150;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
            const w = img.width * scale, h = img.height * scale;
            ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
            document.getElementById('useSignatureBtn').disabled = false;
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

// ─── Tab Switch ─────────────────────────────────────────────────
function switchTab(tab, btnEl) {
    state.activeTab = tab;

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    btnEl.classList.add('active');
    document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');

    const btn = document.getElementById('useSignatureBtn');
    if      (tab === 'draw')   btn.disabled = !hasDrawn;
    else if (tab === 'type')   btn.disabled = !document.getElementById('typeInput').value.trim();
    else if (tab === 'upload') btn.disabled = document.getElementById('uploadCanvas').classList.contains('hidden');
}

// ─── Use Signature ──────────────────────────────────────────────
function useSignature() {
    let canvas;
    if      (state.activeTab === 'draw')   canvas = document.getElementById('signatureCanvas');
    else if (state.activeTab === 'type')   canvas = document.getElementById('typeCanvas');
    else                                   canvas = document.getElementById('uploadCanvas');

    state.signatureDataUrl = canvas.toDataURL('image/png');

    enableStep('stepPosition');
    enableStep('stepDownload');
    renderPDFPreview();

    document.getElementById('stepPosition').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── PDF Preview ─────────────────────────────────────────────────
async function renderPDFPreview() {
    if (!state.pdfJsDoc || !state.signatureDataUrl) return;

    const page     = await state.pdfJsDoc.getPage(state.selectedPage);
    const wrapper  = document.getElementById('preview-scroll-wrapper') ||
                     document.querySelector('.preview-scroll-wrapper');
    const container = document.getElementById('pdfPreviewContainer');
    const canvas   = document.getElementById('pdfPreviewCanvas');

    const maxW     = container.parentElement.clientWidth - 6;
    const vp1      = page.getViewport({ scale: 1 });
    const scale    = maxW / vp1.width;
    const viewport = page.getViewport({ scale });

    canvas.width  = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    // Signature overlay
    const overlay = document.getElementById('signatureOverlay');
    const img     = document.getElementById('signaturePreview');
    img.src = state.signatureDataUrl;

    overlay.style.left   = state.sigPos.x + 'px';
    overlay.style.top    = state.sigPos.y + 'px';
    overlay.style.width  = state.sigWidth + 'px';
    overlay.style.height = 'auto';
    overlay.classList.remove('hidden');

    document.getElementById('currentPageInfo').textContent =
        `${state.selectedPage} / ${state.totalPages}`;

    updatePosDisplay();
    initDrag();
}

// ─── Drag & Resize — stable module-level state ─────────────────
const drag = { mode: null, startX: 0, startY: 0, startL: 0, startT: 0, startW: 0 };

function _dragStart(e, mode) {
    const src = e.touches ? e.touches[0] : e;
    const overlay = document.getElementById('signatureOverlay');
    drag.mode   = mode;
    drag.startX = src.clientX;
    drag.startY = src.clientY;
    drag.startL = overlay.offsetLeft;
    drag.startT = overlay.offsetTop;
    drag.startW = overlay.offsetWidth;
    e.preventDefault();
    e.stopPropagation();
}

function _onOverlayDown(e) {
    if (e.target.id === 'resizeHandle') return;
    _dragStart(e, 'drag');
}

function _onHandleDown(e) {
    _dragStart(e, 'resize');
}

function _onDragMove(e) {
    if (!drag.mode) return;
    e.preventDefault();
    const src       = e.touches ? e.touches[0] : e;
    const dx        = src.clientX - drag.startX;
    const dy        = src.clientY - drag.startY;
    const overlay   = document.getElementById('signatureOverlay');
    const container = document.getElementById('pdfPreviewContainer');

    if (drag.mode === 'drag') {
        const maxL = Math.max(0, container.clientWidth  - overlay.offsetWidth);
        const maxT = Math.max(0, container.clientHeight - overlay.offsetHeight);
        const newL = Math.max(0, Math.min(drag.startL + dx, maxL));
        const newT = Math.max(0, Math.min(drag.startT + dy, maxT));
        overlay.style.left = newL + 'px';
        overlay.style.top  = newT + 'px';
        state.sigPos = { x: newL, y: newT };
    } else {
        const newW = Math.max(40, Math.min(drag.startW + dx, 600));
        overlay.style.width = newW + 'px';
        state.sigWidth = newW;
        document.getElementById('sigSize').value = Math.round(newW);
        document.getElementById('sigSizeLabel').textContent = Math.round(newW) + 'px';
    }
    updatePosDisplay();
}

function _onDragEnd() { drag.mode = null; }

// Attach global move/end once at module load
document.addEventListener('mousemove', _onDragMove);
document.addEventListener('mouseup',   _onDragEnd);
document.addEventListener('touchmove', _onDragMove, { passive: false });
document.addEventListener('touchend',  _onDragEnd);

function initDrag() {
    // Re-bind overlay & handle listeners (removing first to prevent duplicates)
    const overlay = document.getElementById('signatureOverlay');
    const handle  = document.getElementById('resizeHandle');

    overlay.removeEventListener('mousedown',  _onOverlayDown);
    overlay.removeEventListener('touchstart', _onOverlayDown);
    handle.removeEventListener('mousedown',   _onHandleDown);
    handle.removeEventListener('touchstart',  _onHandleDown);

    overlay.addEventListener('mousedown',  _onOverlayDown);
    overlay.addEventListener('touchstart', _onOverlayDown, { passive: false });
    handle.addEventListener('mousedown',   _onHandleDown);
    handle.addEventListener('touchstart',  _onHandleDown, { passive: false });
}

function updatePosDisplay() {
    const overlay = document.getElementById('signatureOverlay');
    document.getElementById('posX').textContent = Math.round(overlay?.offsetLeft ?? state.sigPos.x);
    document.getElementById('posY').textContent = Math.round(overlay?.offsetTop  ?? state.sigPos.y);
    document.getElementById('posW').textContent = Math.round(overlay?.offsetWidth ?? state.sigWidth);
}

function updateSigSize(val) {
    state.sigWidth = parseInt(val);
    document.getElementById('sigSizeLabel').textContent = val + 'px';
    const overlay = document.getElementById('signatureOverlay');
    overlay.style.width = val + 'px';
    updatePosDisplay();
}

function resetPosition() {
    state.sigPos = { x: 50, y: 50 };
    const overlay = document.getElementById('signatureOverlay');
    overlay.style.left = '50px';
    overlay.style.top  = '50px';
    updatePosDisplay();
}

// ─── Apply Signature & Download ─────────────────────────────────
async function applySignatureAndDownload() {
    const statusBox = document.getElementById('downloadStatus');
    statusBox.className = 'status-box';
    statusBox.textContent = '⏳ Memproses tanda tangan...';
    statusBox.classList.remove('hidden');

    try {
        const arrayBuffer = await state.pdfFile.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);

        // Convert PNG data URL → bytes
        const base64 = state.signatureDataUrl.split(',')[1];
        const binary = atob(base64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const sigImage = await pdfDoc.embedPng(bytes);

        // Page dimensions (PDF coordinate space)
        const pdfPage = pdfDoc.getPage(state.selectedPage - 1);
        const { width: pageW, height: pageH } = pdfPage.getSize();

        // Preview canvas dimensions
        const previewCanvas = document.getElementById('pdfPreviewCanvas');
        const scaleX = pageW / previewCanvas.width;
        const scaleY = pageH / previewCanvas.height;

        // Overlay position & size from DOM
        const overlay     = document.getElementById('signatureOverlay');
        const overlayLeft = overlay.offsetLeft;
        const overlayTop  = overlay.offsetTop;
        const overlayW    = overlay.offsetWidth;
        const overlayH    = overlay.offsetHeight;

        // PDF coordinates (Y axis is flipped in PDF)
        const pdfX = overlayLeft * scaleX;
        const pdfW = overlayW   * scaleX;
        const pdfH = overlayH   * scaleY;
        const pdfY = pageH - (overlayTop * scaleY) - pdfH;

        pdfPage.drawImage(sigImage, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });

        const pdfBytes = await pdfDoc.save();
        const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
        const url      = URL.createObjectURL(blob);

        let name = document.getElementById('outputName').value.trim() || 'signed_document';
        if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';

        const a   = document.createElement('a');
        a.href    = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        statusBox.className = 'status-box success';
        statusBox.textContent = `✅ "${name}" berhasil ditandatangani & didownload!`;

    } catch (err) {
        statusBox.className = 'status-box error';
        statusBox.textContent = '❌ Error: ' + err.message;
        console.error(err);
    }
}

// ─── Helpers ────────────────────────────────────────────────────
function enableStep(id)  { document.getElementById(id).classList.remove('step-disabled'); }
function disableStep(id) { document.getElementById(id).classList.add('step-disabled'); }
