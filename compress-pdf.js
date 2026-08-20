/** ============================================================
 *  compress-pdf.js — PDF Compressor Controller
 *  Libraries: pdf-lib (document creation), PDF.js (rendering & resampling)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfFile     = null;
let pdfDocJs    = null;
let totalPages  = 0;
let compLevel   = 'recommended'; // 'extreme' | 'recommended' | 'low'

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

function setCompressionLevel(level) {
    compLevel = level;
    document.getElementById('levelExtremeCard').classList.toggle('active', level === 'extreme');
    document.getElementById('levelRecommendCard').classList.toggle('active', level === 'recommended');
    document.getElementById('levelLowCard').classList.toggle('active', level === 'low');
}

// ─── Compress & Download PDF ───────────────────────────────────
async function compressAndDownload() {
    if (!pdfFile || !pdfDocJs) return;

    const rawName = document.getElementById('outputName').value.trim() || 'compressed_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('compressBtn');
    btn.disabled = true;

    showProgress(5, 'Memulai proses optimasi kompresi...');

    // Set scale & quality based on level
    let scale = 1.3;
    let quality = 0.72;
    if (compLevel === 'extreme') {
        scale = 1.0;
        quality = 0.58;
    } else if (compLevel === 'low') {
        scale = 1.8;
        quality = 0.85;
    }

    try {
        const { PDFDocument } = PDFLib;
        const newPdfDoc = await PDFDocument.create();

        for (let i = 1; i <= totalPages; i++) {
            const pct = Math.round(5 + (i / totalPages) * 80);
            showProgress(pct, `Mengompresi lembar ${i} dari ${totalPages}...`);

            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport }).promise;

            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
            const imgBytes = new Uint8Array(await blob.arrayBuffer());
            const embedded = await newPdfDoc.embedJpg(imgBytes);

            // Add page matching original point dimensions
            const origVp = page.getViewport({ scale: 1.0 });
            const newPage = newPdfDoc.addPage([origVp.width, origVp.height]);
            newPage.drawImage(embedded, {
                x: 0,
                y: 0,
                width: origVp.width,
                height: origVp.height,
            });
        }

        showProgress(90, 'Menyimpan dokumen PDF hasil kompresi...');
        const pdfBytes = await newPdfDoc.save();
        const compressedBlob = new Blob([pdfBytes], { type: 'application/pdf' });

        const originalSize = pdfFile.size;
        const newSize = compressedBlob.size;
        const savingPct = Math.max(0, Math.round(((originalSize - newSize) / originalSize) * 100));

        const url = URL.createObjectURL(compressedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outputName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showProgress(100, 'Selesai!');
        showStatus(
            `✅ Berhasil! Ukuran berhasil dikurangi dari <strong>${formatSize(originalSize)}</strong> menjadi <strong>${formatSize(newSize)}</strong> (Hemat ${savingPct}%).`,
            'success'
        );
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Compress & Save Directly to Google Drive ──────────────────
async function compressAndSaveToGDrive() {
    if (!pdfDocJs || !pdfFile) return;

    const compLevel = currentLevel;
    const rawName = document.getElementById('outputName').value.trim() || 'compressed_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');

    const btn = document.getElementById('compressBtn');
    const gdriveBtn = document.getElementById('compressGDriveBtn');
    btn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(5, 'Mengoptimalkan kompresi dokumen...');

    let scale = 1.3;
    let quality = 0.72;

    if (compLevel === 'extreme') {
        scale = 1.0;
        quality = 0.58;
    } else if (compLevel === 'low') {
        scale = 1.8;
        quality = 0.85;
    }

    try {
        const { PDFDocument } = PDFLib;
        const newPdfDoc = await PDFDocument.create();

        for (let i = 1; i <= totalPages; i++) {
            const pct = Math.round(5 + (i / totalPages) * 70);
            showProgress(pct, `Mengompresi lembar ${i} dari ${totalPages}...`);

            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport }).promise;

            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
            const imgBytes = new Uint8Array(await blob.arrayBuffer());
            const embedded = await newPdfDoc.embedJpg(imgBytes);

            const origVp = page.getViewport({ scale: 1.0 });
            const newPage = newPdfDoc.addPage([origVp.width, origVp.height]);
            newPage.drawImage(embedded, {
                x: 0,
                y: 0,
                width: origVp.width,
                height: origVp.height,
            });
        }

        showProgress(80, 'Menyimpan dokumen PDF...');
        const pdfBytes = await newPdfDoc.save();
        const compressedBlob = new Blob([pdfBytes], { type: 'application/pdf' });

        const originalSize = pdfFile.size;
        const newSize = compressedBlob.size;
        const savingPct = Math.max(0, Math.round(((originalSize - newSize) / originalSize) * 100));

        uploadBlobToGDrive({
            blob: compressedBlob,
            filename: outputName,
            mimeType: 'application/pdf',
            onProgress: showProgress,
            onSuccess: (res) => {
                showProgress(100, 'Selesai!');
                showStatus(
                    `✅ Dokumen <strong>"${res.name}"</strong> berhasil dikompresi (Hemat ${savingPct}%) dan disimpan di Google Drive! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka di Google Drive</a>`,
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
