/** ============================================================
 *  signature.js — PDF Signature Studio Controller
 *  Libraries: pdf-lib (embed), PDF.js (preview & rendering)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ─── State ─────────────────────────────────────────────────────
const state = {
    pdfFile:          null,
    pdfJsDoc:         null,
    totalPages:       0,
    selectedPage:     1,
    signatureDataUrl: null,
    activeTab:        'draw',
    sigPos:           { x: 50, y: 50 },
    sigWidth:         150,
    zoomScale:        1.0,
};

let isDrawing  = false;
let hasDrawn   = false;
let lastX = 0, lastY = 0;
let drawCtx    = null;
let drawCanvas = null;

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

// ─── Google Drive Picker ───────────────────────────────────────
function pickPDFFromGDrive() {
    openGDrivePicker({
        mimeTypes: ['application/pdf'],
        multiSelect: false,
        onFilesSelected: async (files) => {
            if (files.length > 0) {
                await loadPDF(files[0]);
            }
        },
    });
}

// ─── Load PDF ──────────────────────────────────────────────────
async function loadPDF(file) {
    try {
        state.pdfFile = file;
        const buf = await file.arrayBuffer();
        state.pdfJsDoc = await pdfjsLib.getDocument({ data: buf }).promise;
        state.totalPages = state.pdfJsDoc.numPages;
        state.selectedPage = 1;

        // Update Document Info
        document.getElementById('docName').textContent = file.name;
        document.getElementById('docName').title = file.name;
        document.getElementById('docMeta').textContent = `${formatSize(file.size)} · ${state.totalPages} Halaman`;
        document.getElementById('curPageNum').textContent = '1';
        document.getElementById('totalPageNum').textContent = state.totalPages;

        // Switch to Studio View
        document.getElementById('uploadView').classList.add('hidden');
        document.getElementById('studioView').classList.remove('hidden');

        initDrawCanvas();
        updatePageNavButtons();
        await renderPDFPreview();
    } catch (err) {
        alert('Gagal memuat PDF: ' + err.message);
    }
}

function clearPDF() {
    state.pdfFile         = null;
    state.pdfJsDoc        = null;
    state.totalPages      = 0;
    state.selectedPage    = 1;
    state.signatureDataUrl = null;

    document.getElementById('studioView').classList.add('hidden');
    document.getElementById('uploadView').classList.remove('hidden');
    document.getElementById('pdfInput').value = '';
    document.getElementById('downloadStatus').classList.add('hidden');
}

// ─── Page Navigation ───────────────────────────────────────────
function changePage(delta) {
    const target = state.selectedPage + delta;
    if (target >= 1 && target <= state.totalPages) {
        state.selectedPage = target;
        document.getElementById('curPageNum').textContent = target;
        updatePageNavButtons();
        renderPDFPreview();
    }
}

function updatePageNavButtons() {
    document.getElementById('prevPageBtn').disabled = state.selectedPage <= 1;
    document.getElementById('nextPageBtn').disabled = state.selectedPage >= state.totalPages;
}

// ─── Zoom Controls ─────────────────────────────────────────────
function zoomDoc(delta) {
    state.zoomScale = Math.max(0.4, Math.min(2.5, state.zoomScale + delta));
    document.getElementById('zoomVal').textContent = `${Math.round(state.zoomScale * 100)}%`;
    renderPDFPreview();
}

function zoomFit() {
    state.zoomScale = 1.0;
    document.getElementById('zoomVal').textContent = '100%';
    renderPDFPreview();
}

// ─── Render PDF Page Preview ───────────────────────────────────
async function renderPDFPreview() {
    if (!state.pdfJsDoc) return;

    const page      = await state.pdfJsDoc.getPage(state.selectedPage);
    const canvas    = document.getElementById('pdfPreviewCanvas');
    const container = document.getElementById('pdfPreviewContainer');

    // Base viewport calculation
    const baseVp = page.getViewport({ scale: 1.0 });
    // Optimal container width
    const wrapW = document.getElementById('canvasScrollWrap').clientWidth - 48;
    const baseFitScale = Math.min((wrapW / baseVp.width), 1.35);
    const renderScale = baseFitScale * state.zoomScale;

    const viewport = page.getViewport({ scale: renderScale });

    canvas.width  = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    // Position overlay
    const overlay = document.getElementById('signatureOverlay');
    if (state.signatureDataUrl) {
        overlay.classList.remove('hidden');
        document.getElementById('signaturePreview').src = state.signatureDataUrl;
    }

    updatePosDisplay();
    initDrag();
}

// ─── Drawing Canvas ─────────────────────────────────────────────
function initDrawCanvas() {
    drawCanvas = document.getElementById('signatureCanvas');
    drawCtx    = drawCanvas.getContext('2d');
    const wrapper = document.getElementById('canvasWrapper');

    function resize() {
        const ratio = window.devicePixelRatio || 1;
        const w = wrapper.clientWidth || 300;
        drawCanvas.width  = w * ratio;
        drawCanvas.height = 140 * ratio;
        drawCanvas.style.width  = w + 'px';
        drawCanvas.style.height = '140px';
        drawCtx.scale(ratio, ratio);
        applyPenStyle();
    }

    resize();

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
        document.getElementById('canvasHint')?.classList.add('hidden');
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

    drawCanvas.onmousedown  = start;
    drawCanvas.onmousemove  = move;
    drawCanvas.onmouseup    = stop;
    drawCanvas.onmouseleave = stop;
    drawCanvas.ontouchstart = start;
    drawCanvas.ontouchmove  = move;
    drawCanvas.ontouchend   = stop;
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
    document.getElementById('canvasHint')?.classList.remove('hidden');
    if (state.activeTab === 'draw') {
        document.getElementById('useSignatureBtn').disabled = true;
    }
}

document.getElementById('penColor').addEventListener('input', applyPenStyle);
document.getElementById('penSize').addEventListener('input', applyPenStyle);

// ─── Type Signature ─────────────────────────────────────────────
function updateTypeSignature() {
    const text   = document.getElementById('typeInput').value;
    const font   = document.getElementById('fontSelect').value;
    const color  = document.getElementById('typeColor').value;
    const canvas = document.getElementById('typeCanvas');
    const ctx    = canvas.getContext('2d');

    canvas.width  = (canvas.parentElement?.clientWidth || 300);
    canvas.height = 90;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!text.trim()) {
        document.getElementById('useSignatureBtn').disabled = true;
        return;
    }

    ctx.fillStyle    = color;
    ctx.font         = `46px '${font}'`;
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
            document.getElementById('magicCleanBtn').classList.remove('hidden');
            const ctx = canvas.getContext('2d');
            canvas.width  = canvas.parentElement?.clientWidth || 300;
            canvas.height = 120;
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

// ─── Magic Auto-Clean White Background ──────────────────────────
function autoCleanSignatureBackground() {
    const canvas = document.getElementById('uploadCanvas');
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114);

        // Kertas putih / abu-abu terang diubah menjadi transparan
        if (brightness > 185) {
            const alphaFactor = Math.max(0, (255 - brightness) / 70);
            data[i + 3] = Math.round(data[i + 3] * alphaFactor);
        } else {
            // Gelapkan goresan tinta agar kontras & jelas
            data[i]     = Math.max(0, r * 0.85);
            data[i + 1] = Math.max(0, g * 0.85);
            data[i + 2] = Math.max(0, b * 0.85);
        }
    }

    ctx.putImageData(imgData, 0, 0);
    useSignature();
}

// ─── Tab Switcher ───────────────────────────────────────────────
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

// ─── Apply Signature into Overlay ──────────────────────────────
function useSignature() {
    let canvas;
    if      (state.activeTab === 'draw')   canvas = document.getElementById('signatureCanvas');
    else if (state.activeTab === 'type')   canvas = document.getElementById('typeCanvas');
    else                                   canvas = document.getElementById('uploadCanvas');

    state.signatureDataUrl = canvas.toDataURL('image/png');

    const overlay = document.getElementById('signatureOverlay');
    const img = document.getElementById('signaturePreview');
    img.src = state.signatureDataUrl;
    overlay.classList.remove('hidden');

    updatePosDisplay();
}

// ─── Drag & Resize Overlay Logic ───────────────────────────────
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
        const newW = Math.max(40, Math.min(drag.startW + dx, container.clientWidth));
        overlay.style.width = newW + 'px';
        state.sigWidth = newW;
        document.getElementById('sigSize').value = Math.round(newW);
        document.getElementById('sigSizeLabel').textContent = Math.round(newW) + 'px';
    }
    updatePosDisplay();
}

function _onDragEnd() { drag.mode = null; }

document.addEventListener('mousemove', _onDragMove);
document.addEventListener('mouseup',   _onDragEnd);
document.addEventListener('touchmove', _onDragMove, { passive: false });
document.addEventListener('touchend',  _onDragEnd);

function initDrag() {
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
    if (overlay) {
        document.getElementById('posX').textContent = Math.round(overlay.offsetLeft);
        document.getElementById('posY').textContent = Math.round(overlay.offsetTop);
        document.getElementById('posW').textContent = Math.round(overlay.offsetWidth);
    }
}

function updateSigSize(val) {
    state.sigWidth = parseInt(val);
    document.getElementById('sigSizeLabel').textContent = val + 'px';
    const overlay = document.getElementById('signatureOverlay');
    if (overlay) overlay.style.width = val + 'px';
    updatePosDisplay();
}

function resetPosition() {
    state.sigPos = { x: 50, y: 50 };
    const overlay = document.getElementById('signatureOverlay');
    if (overlay) {
        overlay.style.left = '50px';
        overlay.style.top  = '50px';
    }
    updatePosDisplay();
}

// ─── Apply Signature into PDF & Download ────────────────────────
async function applySignatureAndDownload() {
    if (!state.pdfFile) {
        alert('Harap unggah dokumen PDF terlebih dahulu.');
        return;
    }
    if (!state.signatureDataUrl) {
        alert('Harap buat dan klik "Pasang Tanda Tangan" terlebih dahulu.');
        return;
    }

    const statusBox = document.getElementById('downloadStatus');
    statusBox.className = 'status-box';
    statusBox.textContent = '⏳ Memproses tanda tangan ke dokumen...';
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

        // Overlay position & size
        const overlay     = document.getElementById('signatureOverlay');
        const overlayLeft = overlay.offsetLeft;
        const overlayTop  = overlay.offsetTop;
        const overlayW    = overlay.offsetWidth;
        const overlayH    = overlay.offsetHeight;

        // PDF coordinates (Y origin is bottom-left in PDF)
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
        statusBox.innerHTML = `✅ Berhasil! Dokumen "${name}" telah ditandatangani. Unduhan dimulai.`;

    } catch (err) {
        statusBox.className = 'status-box error';
        statusBox.textContent = '❌ Error: ' + err.message;
        console.error(err);
    }
}

// ─── Helpers ────────────────────────────────────────────────────
function formatSize(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
