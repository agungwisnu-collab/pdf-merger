/** ============================================================
 *  crop-pdf.js — PDF Page Margin Cropper Controller
 *  Features:
 *  - Freeform custom cropping with 8 drag & resize handles
 *  - Click & drag on canvas to draw a brand new crop box
 *  - Aspect ratio presets (Freeform, 1:1, 4:3, 16:9, A4, Letter)
 *  - Apply crop to All Pages or Current Page
 *  - In-browser PDF clipping via pdf-lib
 * ============================================================ */

let pdfFile     = null;
let pdfDocJs    = null;
let currentPage = 1;
let totalPages  = 1;
let cropBox     = { x: 30, y: 30, w: 240, h: 340 }; // In canvas relative pixels
let currentRatio = 'free'; // 'free' | '1:1' | '4:3' | '16:9' | 'a4_v' | 'a4_h' | 'letter'

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadSection');
    const fileInput  = document.getElementById('pdfInput');

    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
    });

    initCropInteractions();
});

function pickPDFFromGDrive() {
    openGDrivePicker({
        mimeTypes: ['application/pdf'],
        multiSelect: false,
        onFilesSelected: (files) => {
            if (files.length > 0) handleFileSelect(files[0]);
        },
    });
}

async function handleFileSelect(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert('Harap pilih file berformat PDF.');
        return;
    }

    pdfFile = file;
    currentPage = 1;
    document.getElementById('docTitle').textContent = `📄 ${file.name}`;
    document.getElementById('outputName').value = file.name.replace(/\.pdf$/i, '') + '_cropped';

    showProgress(15, 'Memuat dokumen PDF...');
    hideStatus();

    try {
        const arrayBuf = await file.arrayBuffer();
        pdfDocJs = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        totalPages = pdfDocJs.numPages;

        document.getElementById('docMeta').textContent = `${totalPages} Halaman · ${formatSize(file.size)}`;
        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');

        await renderCurrentPage();
        resetCropBox();
        hideProgress();
    } catch (err) {
        hideProgress();
        alert('Gagal memuat PDF: ' + err.message);
    }
}

function clearFile() {
    pdfFile = null;
    pdfDocJs = null;
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    hideStatus();
    hideProgress();
}

async function renderCurrentPage() {
    if (!pdfDocJs) return;

    document.getElementById('pageNavText').textContent = `Halaman ${currentPage} / ${totalPages}`;
    const page = await pdfDocJs.getPage(currentPage);
    const viewport = page.getViewport({ scale: 0.65 });

    const canvas = document.getElementById('cropCanvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;
    updateOverlayStyle();
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderCurrentPage();
    }
}

function nextPage() {
    if (currentPage < totalPages) {
        currentPage++;
        renderCurrentPage();
    }
}

function resetCropBox() {
    const canvas = document.getElementById('cropCanvas');
    if (!canvas || canvas.width === 0) return;

    const pad = 24;
    cropBox = {
        x: pad,
        y: pad,
        w: Math.max(80, canvas.width - pad * 2),
        h: Math.max(80, canvas.height - pad * 2),
    };

    applyCurrentRatio();
    updateOverlayStyle();
}

function maximizeCropBox() {
    const canvas = document.getElementById('cropCanvas');
    if (!canvas || canvas.width === 0) return;

    cropBox = {
        x: 0,
        y: 0,
        w: canvas.width,
        h: canvas.height,
    };
    updateOverlayStyle();
}

function onRatioChange(ratio) {
    currentRatio = ratio;
    applyCurrentRatio();
    updateOverlayStyle();
}

function getRatioValue() {
    if (currentRatio === '1:1') return 1;
    if (currentRatio === '4:3') return 4 / 3;
    if (currentRatio === '16:9') return 16 / 9;
    if (currentRatio === 'a4_v') return 1 / 1.414;
    if (currentRatio === 'a4_h') return 1.414;
    if (currentRatio === 'letter') return 8.5 / 11;
    return null;
}

function applyCurrentRatio() {
    const r = getRatioValue();
    if (!r) return;

    const canvas = document.getElementById('cropCanvas');
    if (!canvas) return;

    let newH = cropBox.w / r;
    if (newH > canvas.height - cropBox.y) {
        newH = canvas.height - cropBox.y;
        cropBox.w = newH * r;
    }
    cropBox.h = newH;
}

function updateOverlayStyle() {
    const canvas = document.getElementById('cropCanvas');
    const overlay = document.getElementById('cropBoxOverlay');
    if (!canvas || !overlay) return;

    const canvasOffsetLeft = canvas.offsetLeft;
    const canvasOffsetTop = canvas.offsetTop;

    overlay.style.left   = (canvasOffsetLeft + cropBox.x) + 'px';
    overlay.style.top    = (canvasOffsetTop + cropBox.y) + 'px';
    overlay.style.width  = cropBox.w + 'px';
    overlay.style.height = cropBox.h + 'px';
}

// ─── Freeform Crop Drag, Resize & Draw Handlers ─────────────────
function initCropInteractions() {
    const overlay = document.getElementById('cropBoxOverlay');
    const canvas  = document.getElementById('cropCanvas');
    let mode = null; // 'move' | 'resize' | 'draw'
    let resizeDir = null;
    let startX = 0, startY = 0;
    let origBox = { x: 0, y: 0, w: 0, h: 0 };

    // 1. Move Crop Box
    overlay.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('crop-handle')) return;
        mode = 'move';
        startX = e.clientX;
        startY = e.clientY;
        origBox = { ...cropBox };
        e.preventDefault();
    });

    // 2. Resize via 8 Handles
    overlay.querySelectorAll('.crop-handle').forEach(h => {
        h.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            mode = 'resize';
            resizeDir = h.dataset.dir;
            startX = e.clientX;
            startY = e.clientY;
            origBox = { ...cropBox };
        });
    });

    // 3. Draw New Crop Box by Dragging on Canvas
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        mode = 'draw';
        startX = e.clientX;
        startY = e.clientY;
        origBox = { x: clickX, y: clickY, w: 0, h: 0 };
        cropBox = { x: clickX, y: clickY, w: 10, h: 10 };
        updateOverlayStyle();
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!mode) return;
        const canvasRect = canvas.getBoundingClientRect();
        const maxW = canvas.width;
        const maxH = canvas.height;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const ratio = getRatioValue();

        if (mode === 'move') {
            cropBox.x = Math.max(0, Math.min(maxW - origBox.w, origBox.x + dx));
            cropBox.y = Math.max(0, Math.min(maxH - origBox.h, origBox.y + dy));
        } else if (mode === 'draw') {
            const currentX = Math.max(0, Math.min(maxW, e.clientX - canvasRect.left));
            const currentY = Math.max(0, Math.min(maxH, e.clientY - canvasRect.top));

            let left = Math.min(origBox.x, currentX);
            let top  = Math.min(origBox.y, currentY);
            let w    = Math.abs(currentX - origBox.x);
            let h    = Math.abs(currentY - origBox.y);

            if (ratio) {
                h = w / ratio;
            }

            cropBox.x = left;
            cropBox.y = top;
            cropBox.w = Math.max(20, Math.min(maxW - left, w));
            cropBox.h = Math.max(20, Math.min(maxH - top, h));
        } else if (mode === 'resize') {
            let newX = origBox.x;
            let newY = origBox.y;
            let newW = origBox.w;
            let newH = origBox.h;

            if (resizeDir.includes('e')) {
                newW = Math.max(20, Math.min(maxW - origBox.x, origBox.w + dx));
            }
            if (resizeDir.includes('s')) {
                newH = Math.max(20, Math.min(maxH - origBox.y, origBox.h + dy));
            }
            if (resizeDir.includes('w')) {
                const proposedW = origBox.w - dx;
                if (proposedW >= 20 && origBox.x + dx >= 0) {
                    newW = proposedW;
                    newX = origBox.x + dx;
                }
            }
            if (resizeDir.includes('n')) {
                const proposedH = origBox.h - dy;
                if (proposedH >= 20 && origBox.y + dy >= 0) {
                    newH = proposedH;
                    newY = origBox.y + dy;
                }
            }

            if (ratio) {
                if (resizeDir === 'e' || resizeDir === 'w') {
                    newH = newW / ratio;
                } else {
                    newW = newH * ratio;
                }
            }

            cropBox.x = newX;
            cropBox.y = newY;
            cropBox.w = newW;
            cropBox.h = newH;
        }

        updateOverlayStyle();
    });

    document.addEventListener('mouseup', () => {
        if (mode === 'draw' && (cropBox.w < 30 || cropBox.h < 30)) {
            resetCropBox();
        }
        mode = null;
        resizeDir = null;
    });
}

// ─── Crop & Download PDF ───────────────────────────────────────
async function cropAndDownload() {
    if (!pdfFile) return;

    const rawName = document.getElementById('outputName').value.trim() || 'cropped_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const scope = document.getElementById('cropScope').value;
    const btn = document.getElementById('cropBtn');
    btn.disabled = true;

    showProgress(15, 'Menerapkan pemotongan dokumen...');

    try {
        const { PDFDocument } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuf);
        const pages = pdfDoc.getPages();
        const canvas = document.getElementById('cropCanvas');

        for (let i = 0; i < pages.length; i++) {
            if (scope === 'current' && (i + 1) !== currentPage) continue;

            const page = pages[i];
            const { width, height } = page.getSize();

            // Transform canvas coordinates into PDF coordinates (PDF Y origin is bottom-left)
            const scaleX = width / canvas.width;
            const scaleY = height / canvas.height;

            const cropX = cropBox.x * scaleX;
            const cropW = cropBox.w * scaleX;
            const cropH = cropBox.h * scaleY;
            const cropY = height - (cropBox.y * scaleY) - cropH;

            page.setCropBox(cropX, Math.max(0, cropY), cropW, cropH);
        }

        showProgress(90, 'Menyimpan dokumen PDF...');
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = outputName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showProgress(100, 'Selesai!');
        showStatus(`✅ Berhasil! Halaman PDF telah dipotong dan diunduh sebagai "${outputName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Crop & Save to Google Drive ───────────────────────────────
async function cropAndSaveToGDrive() {
    if (!pdfFile) return;

    const rawName = document.getElementById('outputName').value.trim() || 'cropped_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const scope = document.getElementById('cropScope').value;
    const btn = document.getElementById('cropBtn');
    const gdriveBtn = document.getElementById('cropGDriveBtn');
    btn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(15, 'Menerapkan pemotongan dokumen...');

    try {
        const { PDFDocument } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuf);
        const pages = pdfDoc.getPages();
        const canvas = document.getElementById('cropCanvas');

        for (let i = 0; i < pages.length; i++) {
            if (scope === 'current' && (i + 1) !== currentPage) continue;

            const page = pages[i];
            const { width, height } = page.getSize();

            const scaleX = width / canvas.width;
            const scaleY = height / canvas.height;

            const cropX = cropBox.x * scaleX;
            const cropW = cropBox.w * scaleX;
            const cropH = cropBox.h * scaleY;
            const cropY = height - (cropBox.y * scaleY) - cropH;

            page.setCropBox(cropX, Math.max(0, cropY), cropW, cropH);
        }

        showProgress(70, 'Mengunggah ke Google Drive...');
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });

        uploadBlobToGDrive({
            blob,
            filename: outputName,
            mimeType: 'application/pdf',
            onProgress: showProgress,
            onSuccess: (res) => {
                showProgress(100, 'Selesai!');
                const loc = res.folderName ? `di folder <strong>"${res.folderName}"</strong>` : 'di Google Drive Anda';
                showStatus(
                    `✅ Dokumen <strong>"${res.name}"</strong> berhasil disimpan ${loc}! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka di Google Drive</a>`,
                    'success'
                );
            },
            onError: (err) => {
                showStatus('❌ Gagal mengunggah ke Google Drive: ' + err.message, 'error');
            },
        });
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        if (gdriveBtn) gdriveBtn.disabled = false;
    }
}

// ─── Helpers ────────────────────────────────────────────────────
function showProgress(percent, text) {
    document.getElementById('progressSection').classList.remove('hidden');
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('progressText').textContent = text;
}

function hideProgress() {
    document.getElementById('progressSection').classList.add('hidden');
    document.getElementById('progressBar').style.width = '0%';
}

function showStatus(msg, type) {
    const box = document.getElementById('statusBox');
    box.innerHTML = msg;
    box.className = `status-box ${type}`;
    box.classList.remove('hidden');
}

function hideStatus() {
    document.getElementById('statusBox').classList.add('hidden');
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
