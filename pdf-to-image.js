/** ============================================================
 *  pdf-to-image.js — PDF to JPG / PNG Converter
 *  Libraries: PDF.js (rendering), JSZip (ZIP archive)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfFile   = null;
let pdfDocJs  = null;
let totalPages = 0;
let pageCanvases = [];

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

        await renderAllPagesPreview();
        hideProgress();
    } catch (err) {
        hideProgress();
        alert('Gagal memuat PDF: ' + err.message);
    }
}

function clearFile() {
    pdfFile = null;
    pdfDocJs = null;
    totalPages = 0;
    pageCanvases = [];
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('imageGrid').innerHTML = '';
    hideStatus();
    hideProgress();
}

// ─── Render Extracted Image Previews ───────────────────────────
async function renderAllPagesPreview() {
    const grid = document.getElementById('imageGrid');
    grid.innerHTML = '';
    pageCanvases = [];

    const format = document.getElementById('imgFormat').value;
    const ext = format === 'image/png' ? 'png' : 'jpg';

    for (let i = 1; i <= totalPages; i++) {
        const page = await pdfDocJs.getPage(i);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const thumbUrl = canvas.toDataURL('image/jpeg', 0.85);

        const card = document.createElement('div');
        card.className = 'image-card';
        card.innerHTML = `
            <span class="image-badge-num">Hal ${i}</span>
            <div class="image-card-thumb-wrap">
                <img src="${thumbUrl}" class="image-card-thumb" alt="Halaman ${i}">
            </div>
            <div class="image-card-info">
                <div class="image-card-name">${pdfFile.name.replace(/\.pdf$/i, '')}_hal_${i}.${ext}</div>
                <div class="image-card-meta">${Math.round(viewport.width * 2)} × ${Math.round(viewport.height * 2)} px</div>
            </div>
            <div class="image-card-actions">
                <button class="image-btn-action" onclick="downloadSinglePage(${i})">
                    ⬇️ Download (${ext.toUpperCase()})
                </button>
            </div>
        `;
        grid.appendChild(card);
    }
}

// ─── Download Single Page Image ────────────────────────────────
async function downloadSinglePage(pageNum) {
    if (!pdfDocJs) return;
    const format = document.getElementById('imgFormat').value;
    const scale = parseFloat(document.getElementById('imgDpi').value);
    const ext = format === 'image/png' ? 'png' : 'jpg';
    const quality = format === 'image/jpeg' ? 0.92 : undefined;

    showProgress(30, `Merender halaman ${pageNum}...`);

    try {
        const page = await pdfDocJs.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Draw white background for JPEG
        const ctx = canvas.getContext('2d');
        if (format === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        await page.render({ canvasContext: ctx, viewport }).promise;

        canvas.toBlob((blob) => {
            const baseName = pdfFile.name.replace(/\.pdf$/i, '');
            const filename = `${baseName}_halaman_${pageNum}.${ext}`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            hideProgress();
        }, format, quality);
    } catch (err) {
        hideProgress();
        alert('Gagal mengunduh gambar: ' + err.message);
    }
}

// ─── Convert & Download All as ZIP ─────────────────────────────
async function convertAndDownloadAll() {
    if (!pdfDocJs) return;

    const format = document.getElementById('imgFormat').value;
    const scale = parseFloat(document.getElementById('imgDpi').value);
    const ext = format === 'image/png' ? 'png' : 'jpg';
    const quality = format === 'image/jpeg' ? 0.92 : undefined;
    const baseName = pdfFile.name.replace(/\.pdf$/i, '');

    const btn = document.getElementById('convertAllBtn');
    btn.disabled = true;
    showProgress(5, 'Memulai konversi seluruh halaman...');

    try {
        const zip = new JSZip();

        for (let i = 1; i <= totalPages; i++) {
            const pct = Math.round(5 + (i / totalPages) * 75);
            showProgress(pct, `Merender gambar halaman ${i} dari ${totalPages}...`);

            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const ctx = canvas.getContext('2d');
            if (format === 'image/jpeg') {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            await page.render({ canvasContext: ctx, viewport }).promise;

            const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, quality));
            zip.file(`${baseName}_halaman_${i}.${ext}`, blob);
        }

        showProgress(88, 'Mengompresi ke file ZIP...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        const zipName = `${baseName}_images.zip`;
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showProgress(100, 'Selesai!');
        showStatus(`✅ Berhasil! Seluruh ${totalPages} halaman dikonversi dan diunduh sebagai "${zipName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Convert & Save All to Google Drive as ZIP ─────────────────
async function convertAndSaveAllToGDrive() {
    if (!pdfDocJs) return;

    const format = document.getElementById('imgFormat').value;
    const scale = parseFloat(document.getElementById('imgDpi').value);
    const ext = format === 'image/png' ? 'png' : 'jpg';
    const quality = format === 'image/jpeg' ? 0.92 : undefined;
    const baseName = pdfFile.name.replace(/\.pdf$/i, '');

    const btn = document.getElementById('convertAllBtn');
    const gdriveBtn = document.getElementById('convertAllGDriveBtn');
    btn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(5, 'Memulai konversi gambar...');

    try {
        const zip = new JSZip();

        for (let i = 1; i <= totalPages; i++) {
            const pct = Math.round(5 + (i / totalPages) * 70);
            showProgress(pct, `Merender gambar halaman ${i} dari ${totalPages}...`);

            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const ctx = canvas.getContext('2d');
            if (format === 'image/jpeg') {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            await page.render({ canvasContext: ctx, viewport }).promise;

            const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, quality));
            zip.file(`${baseName}_halaman_${i}.${ext}`, blob);
        }

        showProgress(80, 'Mengompresi ke file ZIP...');
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        uploadBlobToGDrive({
            blob: zipBlob,
            filename: `${baseName}_images.zip`,
            mimeType: 'application/zip',
            onProgress: showProgress,
            onSuccess: (res) => {
                showProgress(100, 'Selesai!');
                showStatus(
                    `✅ Arsip <strong>"${res.name}"</strong> berhasil disimpan di Google Drive! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka di Google Drive</a>`,
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
