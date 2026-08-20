/** ============================================================
 *  page-number-pdf.js — Automatic PDF Page Numbering Controller
 *  Libraries: pdf-lib (page number embedding), PDF.js (preview)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfFile     = null;
let pdfDocJs    = null;
let totalPages  = 0;
let position    = 'bottom-center';

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

        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');

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

function setPosition(pos) {
    position = pos;
    document.querySelectorAll('.pos-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('onclick')?.includes(pos)) btn.classList.add('active');
    });
}

// ─── Apply Page Numbers & Download ─────────────────────────────
async function applyPageNumbers() {
    if (!pdfFile) return;

    const rawName = document.getElementById('outputName').value.trim() || 'numbered_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const formatType = document.getElementById('numFormat').value;
    const startFromSheet = Math.max(1, parseInt(document.getElementById('startPage').value) || 1);

    const btn = document.getElementById('applyNumBtn');
    btn.disabled = true;

    showProgress(10, 'Menambahkan nomor halaman ke dokumen...');

    try {
        const { PDFDocument, rgb, StandardFonts } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuf);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const pages = pdfDoc.getPages();
        const fontSize = 10;
        const margin = 28; // points from edge

        for (let i = 0; i < pages.length; i++) {
            const pageIndex = i + 1;
            if (pageIndex < startFromSheet) continue; // Skip initial pages if configured

            const page = pages[i];
            const { width, height } = page.getSize();
            const currentNum = pageIndex - startFromSheet + 1;
            const totalCount = pages.length - startFromSheet + 1;

            let text = '';
            if (formatType === 'num-only') text = `${currentNum}`;
            else if (formatType === 'hal-x-dari-y') text = `Halaman ${currentNum} dari ${totalCount}`;
            else if (formatType === 'page-x-of-y') text = `Page ${currentNum} of ${totalCount}`;
            else if (formatType === 'dash') text = `- ${currentNum} -`;

            const textW = font.widthOfTextAtSize(text, fontSize);
            let x = 0;
            let y = 0;

            // Horizontal position
            if (position.includes('left')) x = margin;
            else if (position.includes('center')) x = (width - textW) / 2;
            else if (position.includes('right')) x = width - margin - textW;

            // Vertical position
            if (position.includes('top')) y = height - margin;
            else if (position.includes('bottom')) y = margin;

            page.drawText(text, {
                x,
                y,
                size: fontSize,
                font,
                color: rgb(0.3, 0.35, 0.4),
            });
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
        showStatus(`✅ Berhasil! Nomor halaman telah ditambahkan dan dokumen diunduh sebagai "${outputName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Apply Page Numbers & Save to Google Drive ─────────────────
async function applyPageNumbersAndSaveToGDrive() {
    if (!pdfFile) return;

    const rawName = document.getElementById('outputName').value.trim() || 'numbered_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const formatType = document.getElementById('numFormat').value;
    const startFromSheet = Math.max(1, parseInt(document.getElementById('startPage').value) || 1);

    const btn = document.getElementById('applyNumBtn');
    const gdriveBtn = document.getElementById('applyNumGDriveBtn');
    btn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(10, 'Menambahkan nomor halaman ke dokumen...');

    try {
        const { PDFDocument, rgb, StandardFonts } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuf);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const pages = pdfDoc.getPages();
        const fontSize = 10;
        const margin = 28;

        for (let i = 0; i < pages.length; i++) {
            const pageIndex = i + 1;
            if (pageIndex < startFromSheet) continue;

            const page = pages[i];
            const { width, height } = page.getSize();
            const currentNum = pageIndex - startFromSheet + 1;
            const totalCount = pages.length - startFromSheet + 1;

            let text = '';
            if (formatType === 'num-only') text = `${currentNum}`;
            else if (formatType === 'hal-x-dari-y') text = `Halaman ${currentNum} dari ${totalCount}`;
            else if (formatType === 'page-x-of-y') text = `Page ${currentNum} of ${totalCount}`;
            else if (formatType === 'dash') text = `- ${currentNum} -`;

            const textW = font.widthOfTextAtSize(text, fontSize);
            let x = 0;
            let y = 0;

            if (position.includes('left')) x = margin;
            else if (position.includes('center')) x = (width - textW) / 2;
            else if (position.includes('right')) x = width - margin - textW;

            if (position.includes('top')) y = height - margin;
            else if (position.includes('bottom')) y = margin;

            page.drawText(text, {
                x,
                y,
                size: fontSize,
                font,
                color: rgb(0.3, 0.35, 0.4),
            });
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
