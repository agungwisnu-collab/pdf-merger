/** ============================================================
 *  unlock-pdf.js — PDF Password Unlocker Controller
 * ============================================================ */

let pdfFile = null;

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

function togglePasswordVisibility() {
    const passInput = document.getElementById('pdfPassword');
    passInput.type = passInput.type === 'password' ? 'text' : 'password';
}

async function handleFileSelect(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert('Harap pilih file berformat PDF.');
        return;
    }

    pdfFile = file;
    document.getElementById('docTitle').textContent = `📄 ${file.name}`;
    document.getElementById('docMeta').textContent = `Ukuran: ${formatSize(file.size)}`;
    document.getElementById('outputName').value = file.name.replace(/\.pdf$/i, '') + '_unlocked';

    document.getElementById('uploadSection').classList.add('hidden');
    document.getElementById('workspaceSection').classList.remove('hidden');
    hideStatus();
    hideProgress();
}

function clearFile() {
    pdfFile = null;
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('pdfPassword').value = '';
    hideStatus();
    hideProgress();
}

// ─── Unlock & Download PDF ─────────────────────────────────────
async function unlockAndDownload() {
    if (!pdfFile) return;

    const password = document.getElementById('pdfPassword').value;
    const rawName = document.getElementById('outputName').value.trim() || 'unlocked_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('unlockBtn');
    btn.disabled = true;

    showProgress(20, 'Mendekripsi dokumen PDF...');

    try {
        const arrayBuf = await pdfFile.arrayBuffer();

        // 1. Coba dekripsi dengan pdf.js (bisa membaca dokumen yang diproteksi password)
        const loadingTask = pdfjsLib.getDocument({
            data: arrayBuf,
            password: password,
        });

        const pdfDocJs = await loadingTask.promise;
        const total = pdfDocJs.numPages;

        showProgress(50, `Membuat dokumen PDF baru tanpa password (${total} halaman)...`);

        const { PDFDocument } = PDFLib;
        const newPdfDoc = await PDFDocument.create();

        for (let i = 1; i <= total; i++) {
            const pct = Math.round(50 + (i / total) * 40);
            showProgress(pct, `Merender lembar ${i} dari ${total}...`);

            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport }).promise;

            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
            const imgBytes = new Uint8Array(await blob.arrayBuffer());
            const embedded = await newPdfDoc.embedJpg(imgBytes);

            const origVp = page.getViewport({ scale: 1.0 });
            const newPage = newPdfDoc.addPage([origVp.width, origVp.height]);
            newPage.drawImage(embedded, { x: 0, y: 0, width: origVp.width, height: origVp.height });
        }

        showProgress(95, 'Menyimpan dokumen PDF terbuka...');
        const pdfBytes = await newPdfDoc.save();
        const unlockedBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(unlockedBlob);

        const a = document.createElement('a');
        a.href = url;
        a.download = outputName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showProgress(100, 'Selesai!');
        showStatus(`✅ Berhasil! Proteksi password berhasil dihilangkan dan dokumen diunduh sebagai "${outputName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Gagal membuka password: ' + (err.name === 'PasswordException' ? 'Kata sandi salah atau tidak cocok.' : err.message), 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Unlock & Save Directly to Google Drive ────────────────────
async function unlockAndSaveToGDrive() {
    if (!pdfFile) return;

    const password = document.getElementById('pdfPassword').value;
    const rawName = document.getElementById('outputName').value.trim() || 'unlocked_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('unlockBtn');
    const gdriveBtn = document.getElementById('unlockGDriveBtn');
    btn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(20, 'Mendekripsi dokumen PDF...');

    try {
        const arrayBuf = await pdfFile.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({
            data: arrayBuf,
            password: password,
        });

        const pdfDocJs = await loadingTask.promise;
        const total = pdfDocJs.numPages;

        showProgress(40, `Membuat dokumen PDF tanpa password (${total} halaman)...`);

        const { PDFDocument } = PDFLib;
        const newPdfDoc = await PDFDocument.create();

        for (let i = 1; i <= total; i++) {
            const pct = Math.round(40 + (i / total) * 40);
            showProgress(pct, `Merender lembar ${i} dari ${total}...`);

            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport }).promise;

            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95));
            const imgBytes = new Uint8Array(await blob.arrayBuffer());
            const embedded = await newPdfDoc.embedJpg(imgBytes);

            const origVp = page.getViewport({ scale: 1.0 });
            const newPage = newPdfDoc.addPage([origVp.width, origVp.height]);
            newPage.drawImage(embedded, { x: 0, y: 0, width: origVp.width, height: origVp.height });
        }

        showProgress(85, 'Menyimpan dokumen PDF...');
        const pdfBytes = await newPdfDoc.save();
        const unlockedBlob = new Blob([pdfBytes], { type: 'application/pdf' });

        uploadBlobToGDrive({
            blob: unlockedBlob,
            filename: outputName,
            mimeType: 'application/pdf',
            onProgress: showProgress,
            onSuccess: (res) => {
                showProgress(100, 'Selesai!');
                const loc = res.folderName ? `di folder <strong>"${res.folderName}"</strong>` : 'di Google Drive Anda';
                showStatus(
                    `✅ Dokumen terbuka <strong>"${res.name}"</strong> berhasil disimpan ${loc}! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka di Google Drive</a>`,
                    'success'
                );
            },
            onError: (err) => {
                showStatus('❌ Gagal mengunggah ke Google Drive: ' + err.message, 'error');
            },
        });
    } catch (err) {
        hideProgress();
        showStatus('❌ Gagal membuka password: ' + (err.name === 'PasswordException' ? 'Kata sandi salah atau tidak cocok.' : err.message), 'error');
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
