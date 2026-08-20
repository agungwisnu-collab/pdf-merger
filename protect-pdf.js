/** ============================================================
 *  protect-pdf.js — PDF Password Encryption & Protection Controller
 *  Libraries: pdf-lib (encryption), PDF.js (preview)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfFile     = null;
let pdfDocJs    = null;
let totalPages  = 0;

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
    document.getElementById('pdfPassword').value = '';
    document.getElementById('pdfPasswordConfirm').value = '';
    hideStatus();
    hideProgress();
}

// ─── Encrypt & Download PDF ────────────────────────────────────
async function protectAndDownload() {
    if (!pdfFile) return;

    const pass = document.getElementById('pdfPassword').value;
    const confirmPass = document.getElementById('pdfPasswordConfirm').value;

    if (!pass) {
        alert('Harap masukkan kata sandi (password).');
        return;
    }
    if (pass !== confirmPass) {
        alert('Konfirmasi kata sandi tidak cocok. Harap periksa kembali.');
        return;
    }

    const rawName = document.getElementById('outputName').value.trim() || 'protected_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('protectBtn');
    btn.disabled = true;

    showProgress(15, 'Menerapkan enkripsi password...');

    try {
        const { PDFDocument } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuf);

        showProgress(50, 'Mengunci dokumen dengan algoritma keamanan AES-256...');

        const rawBytes = await pdfDoc.save();
        let encryptedBytes;

        if (typeof PDFEncrypt !== 'undefined' && typeof PDFEncrypt.encryptPDF === 'function') {
            try {
                encryptedBytes = await PDFEncrypt.encryptPDF(rawBytes, pass, {
                    ownerPassword: pass,
                    userPassword: pass,
                    algorithm: 'AES-256',
                    allowPrinting: true,
                    allowModifying: false,
                    allowCopying: false,
                    allowAnnotating: false,
                    allowFillingForms: false,
                });
            } catch (aesErr) {
                console.warn('AES-256 fallback to RC4:', aesErr);
                encryptedBytes = await PDFEncrypt.encryptPDF(rawBytes, pass, {
                    ownerPassword: pass,
                    userPassword: pass,
                    algorithm: 'RC4',
                });
            }
        } else {
            throw new Error('Modul enkripsi PDFEncrypt tidak tersedia.');
        }

        showProgress(90, 'Menyimpan file PDF terenkripsi...');
        const blob = new Blob([encryptedBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = outputName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showProgress(100, 'Selesai!');
        showStatus(`✅ Berhasil! Dokumen "${outputName}" telah dikunci dengan password.`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Encrypt & Save Directly to Google Drive ───────────────────
async function protectAndSaveToGDrive() {
    if (!pdfFile) return;

    const pass = document.getElementById('pdfPassword').value;
    const confirmPass = document.getElementById('pdfPasswordConfirm').value;

    if (!pass) {
        alert('Harap masukkan kata sandi (password).');
        return;
    }
    if (pass !== confirmPass) {
        alert('Konfirmasi kata sandi tidak cocok. Harap periksa kembali.');
        return;
    }

    const rawName = document.getElementById('outputName').value.trim() || 'protected_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('protectBtn');
    const gdriveBtn = document.getElementById('protectGDriveBtn');
    btn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(15, 'Menerapkan enkripsi password...');

    try {
        const { PDFDocument } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const pdfDoc = await PDFDocument.load(arrayBuf);

        showProgress(50, 'Mengunci dokumen dengan algoritma keamanan AES-256...');

        const rawBytes = await pdfDoc.save();
        let encryptedBytes;

        if (typeof PDFEncrypt !== 'undefined' && typeof PDFEncrypt.encryptPDF === 'function') {
            try {
                encryptedBytes = await PDFEncrypt.encryptPDF(rawBytes, pass, {
                    ownerPassword: pass,
                    userPassword: pass,
                    algorithm: 'AES-256',
                    allowPrinting: true,
                    allowModifying: false,
                    allowCopying: false,
                    allowAnnotating: false,
                    allowFillingForms: false,
                });
            } catch (aesErr) {
                console.warn('AES-256 fallback to RC4:', aesErr);
                encryptedBytes = await PDFEncrypt.encryptPDF(rawBytes, pass, {
                    ownerPassword: pass,
                    userPassword: pass,
                    algorithm: 'RC4',
                });
            }
        } else {
            throw new Error('Modul enkripsi PDFEncrypt tidak tersedia.');
        }

        showProgress(80, 'Menyimpan file PDF...');
        const blob = new Blob([encryptedBytes], { type: 'application/pdf' });

        uploadBlobToGDrive({
            blob,
            filename: outputName,
            mimeType: 'application/pdf',
            onProgress: showProgress,
            onSuccess: (res) => {
                showProgress(100, 'Selesai!');
                showStatus(
                    `✅ Dokumen terenkripsi <strong>"${res.name}"</strong> berhasil disimpan di Google Drive! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka di Google Drive</a>`,
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
