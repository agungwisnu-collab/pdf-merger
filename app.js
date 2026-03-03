/** ============================================================
 *  PDF Merger — app.js
 *  Library: pdf-lib (loaded via CDN in index.html)
 * ============================================================ */

let selectedFiles = [];   // array of File objects
let dragSrcIndex = null;  // for list-reorder drag

// ─── File Input ────────────────────────────────────────────────
document.getElementById('fileInput').addEventListener('change', function (e) {
    handleFiles(Array.from(e.target.files));
    // reset supaya file yang sama bisa dipilih lagi
    this.value = '';
});

// ─── Drop Zone ─────────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length) handleFiles(files);
});

// ─── Handle New Files ──────────────────────────────────────────
function handleFiles(files) {
    const pdfOnly = files.filter(f => f.type === 'application/pdf');

    if (pdfOnly.length !== files.length) {
        showStatus('⚠️ Beberapa file diabaikan karena bukan PDF.', 'error');
    }

    selectedFiles = [...selectedFiles, ...pdfOnly];
    renderFileList();
}

// ─── Render File List ──────────────────────────────────────────
function renderFileList() {
    const list        = document.getElementById('fileList');
    const mergeBtn    = document.getElementById('mergeBtn');
    const fileSection = document.getElementById('fileSection');
    const fileCount   = document.getElementById('fileCount');

    if (selectedFiles.length === 0) {
        fileSection.classList.add('hidden');
        mergeBtn.disabled = true;
        return;
    }

    fileSection.classList.remove('hidden');
    fileCount.textContent = selectedFiles.length;
    mergeBtn.disabled = selectedFiles.length < 2;

    list.innerHTML = selectedFiles.map((file, index) => `
        <li
            draggable="true"
            data-index="${index}"
            ondragstart="onDragStart(event, ${index})"
            ondragover="onDragOver(event)"
            ondrop="onDropItem(event, ${index})"
            ondragend="onDragEnd()"
        >
            <span class="drag-handle">⠿</span>
            <span class="file-icon">📄</span>
            <div class="file-info">
                <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                <div class="file-size">${formatSize(file.size)}</div>
            </div>
            <button class="remove-btn" onclick="removeFile(${index})" title="Hapus">✕</button>
        </li>
    `).join('');

    hideStatus();
}

// ─── Drag-to-Reorder ──────────────────────────────────────────
function onDragStart(e, index) {
    dragSrcIndex = index;
    setTimeout(() => {
        const items = document.querySelectorAll('#fileList li');
        if (items[index]) items[index].classList.add('dragging');
    }, 0);
}

function onDragOver(e) {
    e.preventDefault();
    document.querySelectorAll('#fileList li').forEach(li => li.classList.remove('drag-over'));
    e.currentTarget.classList.add('drag-over');
}

function onDropItem(e, targetIndex) {
    e.preventDefault();
    if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

    const moved = selectedFiles.splice(dragSrcIndex, 1)[0];
    selectedFiles.splice(targetIndex, 0, moved);
    dragSrcIndex = null;
    renderFileList();
}

function onDragEnd() {
    document.querySelectorAll('#fileList li').forEach(li => {
        li.classList.remove('dragging', 'drag-over');
    });
    dragSrcIndex = null;
}

// ─── Remove / Clear ────────────────────────────────────────────
function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
}

function clearAll() {
    selectedFiles = [];
    renderFileList();
    hideStatus();
    hideProgress();
}

// ─── Merge PDFs ────────────────────────────────────────────────
async function mergePDFs() {
    if (selectedFiles.length < 2) return;

    const mergeBtn = document.getElementById('mergeBtn');
    mergeBtn.disabled = true;
    showProgress(0, 'Memulai proses...');
    hideStatus();

    try {
        const { PDFDocument } = PDFLib;
        const mergedPdf = await PDFDocument.create();
        const total = selectedFiles.length;

        for (let i = 0; i < total; i++) {
            const file = selectedFiles[i];
            const pct  = Math.round(((i) / total) * 90);

            showProgress(pct, `Memproses: ${file.name} (${i + 1}/${total})`);

            const arrayBuffer = await file.arrayBuffer();
            let pdf;
            try {
                pdf = await PDFDocument.load(arrayBuffer);
            } catch {
                throw new Error(`File "${file.name}" rusak atau terproteksi password.`);
            }

            const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            pages.forEach(page => mergedPdf.addPage(page));
        }

        showProgress(95, 'Menyimpan file...');

        const mergedPdfBytes = await mergedPdf.save();
        const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
        const url  = URL.createObjectURL(blob);

        // Auto download
        const a      = document.createElement('a');
        a.href       = url;
        a.download   = `merged_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showProgress(100, 'Selesai!');
        showStatus(`✅ Berhasil menggabungkan ${total} file PDF! Download dimulai secara otomatis.`, 'success');

    } catch (error) {
        hideProgress();
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        mergeBtn.disabled = selectedFiles.length < 2;
    }
}

// ─── UI Helpers ────────────────────────────────────────────────
function showProgress(percent, text) {
    const section  = document.getElementById('progressSection');
    const bar      = document.getElementById('progressBar');
    const label    = document.getElementById('progressText');
    section.classList.remove('hidden');
    bar.style.width  = percent + '%';
    label.textContent = text;
}

function hideProgress() {
    document.getElementById('progressSection').classList.add('hidden');
    document.getElementById('progressBar').style.width = '0%';
}

function showStatus(msg, type) {
    const box = document.getElementById('statusBox');
    box.textContent = msg;
    box.className   = `status-box ${type}`;
    box.classList.remove('hidden');
}

function hideStatus() {
    const box = document.getElementById('statusBox');
    box.classList.add('hidden');
}

function formatSize(bytes) {
    if (bytes < 1024)         return bytes + ' B';
    if (bytes < 1024 * 1024)  return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
