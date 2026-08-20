/** ============================================================
 *  watermark-pdf.js — PDF Watermarking Controller
 *  Libraries: pdf-lib (watermark embedding), PDF.js (preview)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfFile     = null;
let pdfDocJs    = null;
let totalPages  = 0;
let wmType      = 'text'; // 'text' | 'image'
let wmImageFile = null;
let wmImageImg  = null;
let firstPageCanvas = null;

// ─── Input & Dropzone ───────────────────────────────────────────
document.getElementById('pdfInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await loadPDF(file);
    e.target.value = '';
});

const dropZone = document.getElementById('uploadSection');
dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') await loadPDF(file);
});

function pickPDFFromGDrive() {
    openGDrivePicker({
        mimeTypes: ['application/pdf'],
        multiSelect: false,
        onFilesSelected: async (files) => {
            if (files.length > 0) await loadPDF(files[0]);
        },
    });
}

// ─── Load PDF ──────────────────────────────────────────────────
async function loadPDF(file) {
    try {
        pdfFile = file;
        showProgress(20, 'Membaca dokumen PDF...');

        const buf = await file.arrayBuffer();
        pdfDocJs = await pdfjsLib.getDocument({ data: buf }).promise;
        totalPages = pdfDocJs.numPages;

        document.getElementById('docTitle').textContent = `📄 ${file.name}`;
        document.getElementById('docMeta').textContent = `${totalPages} Halaman · ${formatSize(file.size)}`;

        // Render base first page preview
        const page = await pdfDocJs.getPage(1);
        const viewport = page.getViewport({ scale: 0.55 });
        firstPageCanvas = document.createElement('canvas');
        firstPageCanvas.width = viewport.width;
        firstPageCanvas.height = viewport.height;
        await page.render({ canvasContext: firstPageCanvas.getContext('2d'), viewport }).promise;

        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');

        updateLivePreview();
        hideProgress();
    } catch (err) {
        hideProgress();
        alert('Gagal memuat PDF: ' + err.message);
    }
}

function clearFile() {
    pdfFile = null;
    pdfDocJs = null;
    firstPageCanvas = null;
    wmImageFile = null;
    wmImageImg = null;
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    hideStatus();
    hideProgress();
}

function setWatermarkType(type) {
    wmType = type;
    document.getElementById('modeTextCard').classList.toggle('active', type === 'text');
    document.getElementById('modeImageCard').classList.toggle('active', type === 'image');
    document.getElementById('textControls').classList.toggle('hidden', type !== 'text');
    document.getElementById('imageControls').classList.toggle('hidden', type !== 'image');
    updateLivePreview();
}

function onWatermarkImageLoaded(e) {
    const file = e.target.files[0];
    if (!file) return;
    wmImageFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            wmImageImg = img;
            updateLivePreview();
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

// ─── Live Preview ──────────────────────────────────────────────
function updateLivePreview() {
    if (!firstPageCanvas) return;
    const canvas = document.getElementById('previewCanvas');
    const ctx = canvas.getContext('2d');

    canvas.width = firstPageCanvas.width;
    canvas.height = firstPageCanvas.height;

    // Draw PDF page base
    ctx.drawImage(firstPageCanvas, 0, 0);

    const opacity = parseInt(document.getElementById('wmOpacity').value) / 100;
    const angle = parseInt(document.getElementById('wmRotation').value);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((angle * Math.PI) / 180);

    if (wmType === 'text') {
        const text = document.getElementById('wmText').value || 'CONFIDENTIAL';
        const color = document.getElementById('wmColor').value;
        const fontSize = parseInt(document.getElementById('wmFontSize').value) * (canvas.width / 500);

        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 0, 0);
    } else if (wmType === 'image' && wmImageImg) {
        const maxW = canvas.width * 0.5;
        const scale = maxW / wmImageImg.width;
        const w = wmImageImg.width * scale;
        const h = wmImageImg.height * scale;
        ctx.drawImage(wmImageImg, -w / 2, -h / 2, w, h);
    }

    ctx.restore();
}

// ─── Apply Watermark & Download PDF ────────────────────────────
async function applyWatermarkAndDownload() {
    if (!pdfFile) return;

    if (wmType === 'image' && !wmImageFile) {
        alert('Harap unggah gambar logo terlebih dahulu.');
        return;
    }

    const rawName = document.getElementById('outputName').value.trim() || 'watermarked_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('applyWmBtn');
    btn.disabled = true;

    showProgress(10, 'Menerapkan cap air ke dokumen...');

    try {
        const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuf);
        const pages = pdfDoc.getPages();

        const opacity = parseInt(document.getElementById('wmOpacity').value) / 100;
        const angle = parseInt(document.getElementById('wmRotation').value);

        let embeddedImg = null;
        if (wmType === 'image' && wmImageFile) {
            const imgBytes = new Uint8Array(await wmImageFile.arrayBuffer());
            if (wmImageFile.type === 'image/png') {
                embeddedImg = await pdfDoc.embedPng(imgBytes);
            } else {
                embeddedImg = await pdfDoc.embedJpg(imgBytes);
            }
        }

        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const text = document.getElementById('wmText').value || 'CONFIDENTIAL';
        const hexColor = document.getElementById('wmColor').value;
        const r = parseInt(hexColor.slice(1, 3), 16) / 255;
        const g = parseInt(hexColor.slice(3, 5), 16) / 255;
        const b = parseInt(hexColor.slice(5, 7), 16) / 255;
        const fontSize = parseInt(document.getElementById('wmFontSize').value);

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const { width, height } = page.getSize();
            const pct = Math.round(10 + (i / pages.length) * 80);
            showProgress(pct, `Memberi cap halaman ${i + 1} dari ${pages.length}...`);

            if (wmType === 'text') {
                const textW = font.widthOfTextAtSize(text, fontSize);
                const textH = font.heightAtSize(fontSize);
                // Center calculation taking rotation into account
                page.drawText(text, {
                    x: width / 2 - (textW / 2) * Math.cos((angle * Math.PI) / 180),
                    y: height / 2 - (textH / 2) * Math.sin((angle * Math.PI) / 180),
                    size: fontSize,
                    font,
                    color: rgb(r, g, b),
                    opacity,
                    rotate: degrees(angle),
                });
            } else if (embeddedImg) {
                const maxW = width * 0.45;
                const scale = maxW / embeddedImg.width;
                const w = embeddedImg.width * scale;
                const h = embeddedImg.height * scale;

                page.drawImage(embeddedImg, {
                    x: (width - w) / 2,
                    y: (height - h) / 2,
                    width: w,
                    height: h,
                    opacity,
                    rotate: degrees(angle),
                });
            }
        }

        showProgress(92, 'Menyimpan dokumen PDF...');
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
        showStatus(`✅ Berhasil! Seluruh halaman dokumen telah diberi watermark dan diunduh sebagai "${outputName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Apply Watermark & Save Directly to Google Drive ───────────
async function applyWatermarkAndSaveToGDrive() {
    if (!pdfFile) return;

    if (wmType === 'image' && !wmImageFile) {
        alert('Harap unggah gambar logo terlebih dahulu.');
        return;
    }

    const rawName = document.getElementById('outputName').value.trim() || 'watermarked_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('applyWmBtn');
    const gdriveBtn = document.getElementById('applyWmGDriveBtn');
    btn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(10, 'Menerapkan cap air ke dokumen...');

    try {
        const { PDFDocument, rgb, degrees, StandardFonts } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuf);
        const pages = pdfDoc.getPages();

        const opacity = parseInt(document.getElementById('wmOpacity').value) / 100;
        const angle = parseInt(document.getElementById('wmRotation').value);

        let embeddedImg = null;
        if (wmType === 'image' && wmImageFile) {
            const imgBytes = new Uint8Array(await wmImageFile.arrayBuffer());
            if (wmImageFile.type === 'image/png') {
                embeddedImg = await pdfDoc.embedPng(imgBytes);
            } else {
                embeddedImg = await pdfDoc.embedJpg(imgBytes);
            }
        }

        const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const text = document.getElementById('wmText').value || 'CONFIDENTIAL';
        const hexColor = document.getElementById('wmColor').value;
        const r = parseInt(hexColor.slice(1, 3), 16) / 255;
        const g = parseInt(hexColor.slice(3, 5), 16) / 255;
        const b = parseInt(hexColor.slice(5, 7), 16) / 255;
        const fontSize = parseInt(document.getElementById('wmFontSize').value);

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const { width, height } = page.getSize();
            const pct = Math.round(10 + (i / pages.length) * 70);
            showProgress(pct, `Memberi cap halaman ${i + 1} dari ${pages.length}...`);

            if (wmType === 'text') {
                const textW = font.widthOfTextAtSize(text, fontSize);
                const textH = font.heightAtSize(fontSize);
                page.drawText(text, {
                    x: width / 2 - (textW / 2) * Math.cos((angle * Math.PI) / 180),
                    y: height / 2 - (textH / 2) * Math.sin((angle * Math.PI) / 180),
                    size: fontSize,
                    font,
                    color: rgb(r, g, b),
                    opacity,
                    rotate: degrees(angle),
                });
            } else if (embeddedImg) {
                const maxW = width * 0.45;
                const scale = maxW / embeddedImg.width;
                const w = embeddedImg.width * scale;
                const h = embeddedImg.height * scale;

                page.drawImage(embeddedImg, {
                    x: (width - w) / 2,
                    y: (height - h) / 2,
                    width: w,
                    height: h,
                    opacity,
                    rotate: degrees(angle),
                });
            }
        }

        showProgress(80, 'Menyimpan dokumen PDF...');
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });

        uploadBlobToGDrive({
            blob,
            filename: outputName,
            mimeType: 'application/pdf',
            onProgress: showProgress,
            onSuccess: (res) => {
                showProgress(100, 'Selesai!');
                showStatus(
                    `✅ Dokumen <strong>"${res.name}"</strong> berhasil disimpan di Google Drive! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka di Google Drive</a>`,
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
    box.textContent = msg;
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
