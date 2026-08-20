/** ============================================================
 *  word-to-pdf.js — Word DOCX to PDF Converter Controller
 * ============================================================ */

let wordFile = null;
let renderedHtml = '';

document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadSection');
    const fileInput  = document.getElementById('wordInput');

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

function pickWordFromGDrive() {
    openGDrivePicker({
        mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
        multiSelect: false,
        onFilesSelected: (files) => {
            if (files.length > 0) handleFileSelect(files[0]);
        },
    });
}

async function handleFileSelect(file) {
    if (!file.name.toLowerCase().endsWith('.docx')) {
        alert('Harap pilih file berformat Word (.docx).');
        return;
    }

    wordFile = file;
    document.getElementById('docTitle').textContent = `📄 ${file.name}`;
    document.getElementById('docMeta').textContent = `Ukuran: ${formatSize(file.size)}`;
    document.getElementById('outputName').value = file.name.replace(/\.docx$/i, '');

    showProgress(25, 'Membaca dan mengonversi format Word (.docx)...');
    hideStatus();

    try {
        const arrayBuf = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuf });
        renderedHtml = result.value || '<p>Dokumen kosong</p>';

        const previewBox = document.getElementById('docPreviewContainer');
        previewBox.innerHTML = renderedHtml;

        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');
        hideProgress();
    } catch (err) {
        hideProgress();
        alert('Gagal membaca file Word: ' + err.message);
    }
}

function clearFile() {
    wordFile = null;
    renderedHtml = '';
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('docPreviewContainer').innerHTML = '';
    hideStatus();
    hideProgress();
}

// ─── Generate PDF Blob via html2pdf ────────────────────────────
async function generateWordPdfBlob() {
    const previewBox = document.getElementById('docPreviewContainer');
    const opt = {
        margin: [15, 15, 15, 15],
        filename: 'document.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    };

    return await html2pdf().set(opt).from(previewBox).outputPdf('blob');
}

// ─── Convert & Download PDF ────────────────────────────────────
async function convertAndDownload() {
    if (!wordFile || !renderedHtml) return;

    const rawName = document.getElementById('outputName').value.trim() || 'converted_word';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('convertBtn');
    btn.disabled = true;

    showProgress(40, 'Merender dokumen Word ke PDF...');

    try {
        const pdfBlob = await generateWordPdfBlob();

        showProgress(90, 'Menyimpan file PDF...');
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outputName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showProgress(100, 'Selesai!');
        showStatus(`✅ Berhasil! File Word berhasil dikonversi ke PDF dan diunduh sebagai "${outputName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error saat konversi: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Convert & Save to Google Drive ────────────────────────────
async function convertAndSaveToGDrive() {
    if (!wordFile || !renderedHtml) return;

    const rawName = document.getElementById('outputName').value.trim() || 'converted_word';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('convertBtn');
    const gdriveBtn = document.getElementById('convertGDriveBtn');
    btn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(40, 'Merender dokumen Word ke PDF...');

    try {
        const pdfBlob = await generateWordPdfBlob();

        uploadBlobToGDrive({
            blob: pdfBlob,
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
        showStatus('❌ Error saat konversi: ' + err.message, 'error');
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
