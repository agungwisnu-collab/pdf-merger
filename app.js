/** ============================================================
 *  PDF Merger — app.js
 *  Libraries: pdf-lib (merge), PDF.js (thumbnail + page count)
 * ============================================================ */

// ─── PDF.js Worker Setup ───────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/**
 * pdfItems: array of {
 *   file        : File,
 *   totalPages  : number,
 *   selectedPages: Set<number>,   // 1-based
 *   thumbnail   : string | null,  // data URL canvas
 *   pageInput   : string,         // raw text input for page range
 *   expanded    : boolean,        // page selector panel open?
 * }
 */
let pdfItems     = [];
let dragSrcIndex = null;

// ─── File Input ────────────────────────────────────────────────
document.getElementById('fileInput').addEventListener('change', function (e) {
    handleFiles(Array.from(e.target.files));
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
    pdfOnly.forEach(file => loadPdfItem(file));
}

// ─── Load PDF Item (async: thumbnail + page count) ─────────────
async function loadPdfItem(file) {
    const item = {
        file,
        totalPages: 0,
        selectedPages: new Set(),
        thumbnail: null,
        pageInput: '',
        expanded: false,
    };

    const index = pdfItems.length;
    pdfItems.push(item);
    renderFileList(); // render placeholder dulu

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        item.totalPages = pdfDoc.numPages;
        // default: semua halaman dipilih
        item.selectedPages = new Set(Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1));
        item.pageInput = pdfDoc.numPages > 1 ? `1-${pdfDoc.numPages}` : '1';

        // render thumbnail halaman pertama
        const page    = await pdfDoc.getPage(1);
        const scale   = 0.3;
        const viewport = page.getViewport({ scale });
        const canvas  = document.createElement('canvas');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        item.thumbnail = canvas.toDataURL('image/jpeg', 0.7);

    } catch {
        item.totalPages = 0;
        item.thumbnail = null;
    }

    renderFileList();
}

// ─── Parse Page Range String ───────────────────────────────────
// Input: "1-3, 5, 7-9"  →  Set { 1, 2, 3, 5, 7, 8, 9 }
function parsePageRange(input, total) {
    const result = new Set();
    if (!input.trim()) return result;

    const parts = input.split(',');
    for (const part of parts) {
        const trimmed = part.trim();
        const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
        const singleMatch = trimmed.match(/^(\d+)$/);

        if (rangeMatch) {
            const from = parseInt(rangeMatch[1]);
            const to   = Math.min(parseInt(rangeMatch[2]), total);
            for (let p = from; p <= to; p++) {
                if (p >= 1 && p <= total) result.add(p);
            }
        } else if (singleMatch) {
            const p = parseInt(singleMatch[1]);
            if (p >= 1 && p <= total) result.add(p);
        }
    }
    return result;
}

// ─── Render File List ──────────────────────────────────────────
function renderFileList() {
    const list          = document.getElementById('fileList');
    const mergeBtn      = document.getElementById('mergeBtn');
    const fileSection   = document.getElementById('fileSection');
    const fileCount     = document.getElementById('fileCount');
    const outputSection = document.getElementById('outputSection');

    if (pdfItems.length === 0) {
        fileSection.classList.add('hidden');
        outputSection.classList.add('hidden');
        mergeBtn.disabled = true;
        return;
    }

    fileSection.classList.remove('hidden');
    outputSection.classList.remove('hidden');
    fileCount.textContent = pdfItems.length;
    mergeBtn.disabled = pdfItems.length < 2;

    list.innerHTML = pdfItems.map((item, index) => {
        const thumb = item.thumbnail
            ? `<img src="${item.thumbnail}" class="pdf-thumb" alt="preview">`
            : `<div class="pdf-thumb pdf-thumb-placeholder">${item.totalPages === 0 ? '⏳' : '📄'}</div>`;

        const pageLabel = item.totalPages > 0
            ? `${item.selectedPages.size}/${item.totalPages} hal.`
            : 'Memuat...';

        const pageBadgeClass = (item.totalPages > 0 && item.selectedPages.size < item.totalPages)
            ? 'page-badge page-badge-partial'
            : 'page-badge';

        return `
        <li
            draggable="true"
            data-index="${index}"
            ondragstart="onDragStart(event, ${index})"
            ondragover="onDragOver(event)"
            ondrop="onDropItem(event, ${index})"
            ondragend="onDragEnd()"
        >
            <span class="drag-handle">⠿</span>
            ${thumb}
            <div class="file-info">
                <div class="file-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</div>
                <div class="file-meta">
                    <span class="file-size">${formatSize(item.file.size)}</span>
                    <span class="${pageBadgeClass}">${pageLabel}</span>
                </div>
            </div>
            <button
                class="page-btn ${item.expanded ? 'page-btn-active' : ''}"
                onclick="togglePageSelector(${index})"
                title="Pilih Halaman"
                ${item.totalPages === 0 ? 'disabled' : ''}
            >🗂️ Halaman</button>
            <button class="remove-btn" onclick="removeFile(${index})" title="Hapus">✕</button>
        </li>
        ${item.expanded ? renderPagePanel(index) : ''}
        `;
    }).join('');

    hideStatus();
}

// ─── Page Selector Panel HTML ──────────────────────────────────
function renderPagePanel(index) {
    const item = pdfItems[index];
    return `
    <li class="page-panel" data-panel="${index}">
        <div class="page-panel-inner">
            <div class="page-panel-header">
                <span>📑 Pilih halaman dari <strong>${escapeHtml(item.file.name)}</strong> (Total: ${item.totalPages})</span>
            </div>
            <p class="page-panel-hint">Format: <code>1</code> · <code>1-3</code> · <code>1,3,5-8</code></p>
            <div class="page-panel-row">
                <input
                    type="text"
                    class="page-input"
                    id="pageInput_${index}"
                    value="${escapeHtml(item.pageInput)}"
                    placeholder="cth: 1-3, 5, 7"
                    oninput="onPageInputChange(${index}, this.value)"
                />
                <button class="btn btn-small btn-primary" onclick="selectAllPages(${index})">Semua</button>
                <button class="btn btn-small btn-secondary-sm" onclick="clearPageSelection(${index})">Reset</button>
            </div>
            <p id="pageStatus_${index}" class="page-status ${item.selectedPages.size === 0 ? 'page-status-warn' : ''}">
                ${item.selectedPages.size === 0
                    ? '⚠️ Tidak ada halaman dipilih (file akan dilewati)'
                    : `✅ ${item.selectedPages.size} halaman dipilih: ${getSortedPages(item.selectedPages).slice(0, 10).join(', ')}${item.selectedPages.size > 10 ? ' ...' : ''}`
                }
            </p>
        </div>
    </li>`;
}

function getSortedPages(set) {
    return Array.from(set).sort((a, b) => a - b);
}

// ─── Page Panel Actions ────────────────────────────────────────
function togglePageSelector(index) {
    pdfItems[index].expanded = !pdfItems[index].expanded;
    renderFileList();
    if (pdfItems[index].expanded) {
        setTimeout(() => document.getElementById(`pageInput_${index}`)?.focus(), 50);
    }
}

function onPageInputChange(index, value) {
    const item = pdfItems[index];
    item.pageInput = value;
    item.selectedPages = parsePageRange(value, item.totalPages);

    // update status label without full re-render
    const statusEl = document.getElementById(`pageStatus_${index}`);
    if (statusEl) {
        if (item.selectedPages.size === 0) {
            statusEl.className = 'page-status page-status-warn';
            statusEl.textContent = '⚠️ Tidak ada halaman dipilih (file akan dilewati)';
        } else {
            statusEl.className = 'page-status';
            statusEl.textContent = `✅ ${item.selectedPages.size} halaman dipilih: ${getSortedPages(item.selectedPages).slice(0, 10).join(', ')}${item.selectedPages.size > 10 ? ' ...' : ''}`;
        }
    }

    // update badge
    renderFileList();
}

function selectAllPages(index) {
    const item = pdfItems[index];
    item.selectedPages = new Set(Array.from({ length: item.totalPages }, (_, i) => i + 1));
    item.pageInput = item.totalPages > 1 ? `1-${item.totalPages}` : '1';
    renderFileList();
}

function clearPageSelection(index) {
    const item = pdfItems[index];
    item.selectedPages = new Set();
    item.pageInput = '';
    renderFileList();
}

// ─── Drag-to-Reorder ──────────────────────────────────────────
function onDragStart(e, index) {
    dragSrcIndex = index;
    setTimeout(() => {
        const items = document.querySelectorAll('#fileList li[data-index]');
        items.forEach(li => {
            if (parseInt(li.dataset.index) === index) li.classList.add('dragging');
        });
    }, 0);
}

function onDragOver(e) {
    e.preventDefault();
    document.querySelectorAll('#fileList li[data-index]').forEach(li => li.classList.remove('drag-over'));
    const li = e.currentTarget;
    if (li.dataset.index !== undefined) li.classList.add('drag-over');
}

function onDropItem(e, targetIndex) {
    e.preventDefault();
    if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
    const moved = pdfItems.splice(dragSrcIndex, 1)[0];
    pdfItems.splice(targetIndex, 0, moved);
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
    pdfItems.splice(index, 1);
    renderFileList();
}

function clearAll() {
    pdfItems = [];
    renderFileList();
    hideStatus();
    hideProgress();
}

// ─── Merge PDFs ────────────────────────────────────────────────
async function mergePDFs() {
    if (pdfItems.length < 2) return;

    // Ambil nama output dari input
    const rawName    = document.getElementById('outputName').value.trim();
    const outputName = (rawName || 'merged_output').replace(/\.pdf$/i, '') + '.pdf';

    const mergeBtn = document.getElementById('mergeBtn');
    mergeBtn.disabled = true;
    showProgress(0, 'Memulai proses...');
    hideStatus();

    try {
        const { PDFDocument } = PDFLib;
        const mergedPdf = await PDFDocument.create();

        // filter hanya item yang punya halaman terpilih
        const activeItems = pdfItems.filter(item => item.selectedPages.size > 0);
        if (activeItems.length === 0) throw new Error('Tidak ada halaman yang dipilih untuk digabung.');
        if (activeItems.length < 2) throw new Error('Minimal 2 file harus memiliki halaman yang dipilih.');

        const total = activeItems.length;
        let totalPagesMerged = 0;

        for (let i = 0; i < total; i++) {
            const item = activeItems[i];
            const pct  = Math.round((i / total) * 90);
            showProgress(pct, `Memproses: ${item.file.name} (${i + 1}/${total})`);

            const arrayBuffer = await item.file.arrayBuffer();
            let pdf;
            try {
                pdf = await PDFDocument.load(arrayBuffer);
            } catch {
                throw new Error(`File "${item.file.name}" rusak atau terproteksi password.`);
            }

            // konversi Set 1-based ke array 0-based index untuk pdf-lib
            const pageIndices = getSortedPages(item.selectedPages).map(p => p - 1);
            const pages = await mergedPdf.copyPages(pdf, pageIndices);
            pages.forEach(page => mergedPdf.addPage(page));
            totalPagesMerged += pages.length;
        }

        showProgress(95, 'Menyimpan file...');

        const mergedPdfBytes = await mergedPdf.save();
        const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
        const url  = URL.createObjectURL(blob);

        const a      = document.createElement('a');
        a.href       = url;
        a.download   = outputName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showProgress(100, 'Selesai!');
        showStatus(
            `✅ Berhasil! "${outputName}" — ${total} file, ${totalPagesMerged} halaman. Download dimulai.`,
            'success'
        );

    } catch (error) {
        hideProgress();
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        mergeBtn.disabled = pdfItems.length < 2;
    }
}

// ─── UI Helpers ────────────────────────────────────────────────
function showProgress(percent, text) {
    document.getElementById('progressSection').classList.remove('hidden');
    document.getElementById('progressBar').style.width  = percent + '%';
    document.getElementById('progressText').textContent = text;
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
    document.getElementById('statusBox').classList.add('hidden');
}

function formatSize(bytes) {
    if (bytes < 1024)         return bytes + ' B';
    if (bytes < 1024 * 1024)  return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

