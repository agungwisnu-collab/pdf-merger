/** ============================================================
 *  rotate-pdf.js — Visual PDF Page Rotator Controller
 * ============================================================ */

let pdfFile  = null;
let pdfDocJs = null;
let pages    = []; // { origIndex: 0, rotation: 0, thumbUrl: '' }

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

async function handleFileSelect(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        alert('Harap pilih file berformat PDF.');
        return;
    }

    pdfFile = file;
    document.getElementById('docTitle').textContent = `📄 ${file.name}`;
    document.getElementById('outputName').value = file.name.replace(/\.pdf$/i, '') + '_rotated';

    showProgress(15, 'Membaca dokumen PDF...');
    hideStatus();

    try {
        const arrayBuf = await file.arrayBuffer();
        pdfDocJs = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        const total = pdfDocJs.numPages;

        document.getElementById('docMeta').textContent = `${total} Halaman · ${formatSize(file.size)}`;
        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');

        pages = [];
        for (let i = 0; i < total; i++) {
            pages.push({ origIndex: i, rotation: 0, thumbUrl: '' });
        }

        await renderRotateGrid();
        hideProgress();
    } catch (err) {
        hideProgress();
        alert('Gagal memuat PDF: ' + err.message);
    }
}

function clearFile() {
    pdfFile = null;
    pdfDocJs = null;
    pages = [];
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('rotateGrid').innerHTML = '';
    hideStatus();
    hideProgress();
}

async function renderRotateGrid() {
    const grid = document.getElementById('rotateGrid');
    grid.innerHTML = '';

    for (let i = 0; i < pages.length; i++) {
        const item = pages[i];

        if (!item.thumbUrl) {
            const page = await pdfDocJs.getPage(item.origIndex + 1);
            const viewport = page.getViewport({ scale: 0.35 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            item.thumbUrl = canvas.toDataURL('image/jpeg', 0.85);
        }

        const card = document.createElement('div');
        card.className = 'doc-page-card';
        card.innerHTML = `
            <div class="doc-page-thumb-wrap">
                <img src="${item.thumbUrl}" class="doc-page-thumb" style="transform: rotate(${item.rotation}deg); transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);" alt="Hal ${item.origIndex + 1}">
            </div>
            <div class="doc-page-footer">
                <span>Hal. ${item.origIndex + 1}</span>
                <div class="doc-page-actions">
                    <button class="doc-mini-btn" title="Putar Kiri 90°" onclick="rotateSinglePage(${i}, -90)">↺</button>
                    <button class="doc-mini-btn" title="Putar Kanan 90°" onclick="rotateSinglePage(${i}, 90)">↻</button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    }
}

function rotateSinglePage(index, deltaAngle) {
    pages[index].rotation = (pages[index].rotation + deltaAngle + 360) % 360;
    renderRotateGrid();
}

function rotateAllPages(deltaAngle) {
    pages.forEach(p => {
        p.rotation = (p.rotation + deltaAngle + 360) % 360;
    });
    renderRotateGrid();
}

function resetAllRotations() {
    pages.forEach(p => { p.rotation = 0; });
    renderRotateGrid();
}

// ─── Save & Download Rotated PDF ───────────────────────────────
async function saveRotatedPDF() {
    if (!pdfFile || pages.length === 0) return;

    const rawName = document.getElementById('outputName').value.trim() || 'rotated_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const saveBtn = document.getElementById('savePdfBtn');
    saveBtn.disabled = true;

    showProgress(10, 'Menyusun rotasi halaman PDF...');

    try {
        const { PDFDocument, degrees } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const srcDoc = await PDFDocument.load(arrayBuf);
        const newDoc = await PDFDocument.create();

        for (let i = 0; i < pages.length; i++) {
            const item = pages[i];
            const pct = Math.round(10 + (i / pages.length) * 75);
            showProgress(pct, `Memutar lembar #${i + 1}...`);

            const [copiedPage] = await newDoc.copyPages(srcDoc, [item.origIndex]);
            if (item.rotation !== 0) {
                const currentRot = copiedPage.getRotation().angle;
                copiedPage.setRotation(degrees((currentRot + item.rotation) % 360));
            }
            newDoc.addPage(copiedPage);
        }

        showProgress(90, 'Menyimpan dokumen PDF...');
        const pdfBytes = await newDoc.save();
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
        showStatus(`✅ Berhasil! Dokumen PDF telah diputar dan diunduh sebagai "${outputName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

// ─── Save Rotated PDF to Google Drive ──────────────────────────
async function saveRotatedToGDrive() {
    if (!pdfFile || pages.length === 0) return;

    const rawName = document.getElementById('outputName').value.trim() || 'rotated_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const saveBtn = document.getElementById('savePdfBtn');
    const gdriveBtn = document.getElementById('saveGDriveBtn');
    saveBtn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(10, 'Menyusun rotasi halaman PDF...');

    try {
        const { PDFDocument, degrees } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const srcDoc = await PDFDocument.load(arrayBuf);
        const newDoc = await PDFDocument.create();

        for (let i = 0; i < pages.length; i++) {
            const item = pages[i];
            const pct = Math.round(10 + (i / pages.length) * 70);
            showProgress(pct, `Memutar lembar #${i + 1}...`);

            const [copiedPage] = await newDoc.copyPages(srcDoc, [item.origIndex]);
            if (item.rotation !== 0) {
                const currentRot = copiedPage.getRotation().angle;
                copiedPage.setRotation(degrees((currentRot + item.rotation) % 360));
            }
            newDoc.addPage(copiedPage);
        }

        showProgress(80, 'Menyimpan dokumen PDF...');
        const pdfBytes = await newDoc.save();
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
        saveBtn.disabled = false;
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
