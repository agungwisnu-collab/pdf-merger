/** ============================================================
 *  PDF Merger — app.js
 *  Libraries: pdf-lib (merge), PDF.js (thumbnail + page count)
 *  Features:
 *  - Drag & Drop multi-file PDF merge
 *  - Page range selection per file
 *  - Password-protected PDF detection & inline unlock
 *  - Local download & Direct Google Drive sync
 * ============================================================ */

// ─── PDF.js Worker Setup ───────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/**
 * pdfItems: array of {
 *   file                 : File,
 *   totalPages           : number,
 *   selectedPages        : Set<number>,   // 1-based
 *   thumbnail            : string | null,  // data URL canvas
 *   pageInput            : string,         // raw text input for page range
 *   expanded             : boolean,        // page selector panel open?
 *   isEncrypted          : boolean,        // password protected?
 *   isUnlocked           : boolean,        // successfully unlocked?
 *   password             : string,         // user entered password
 *   decryptedArrayBuffer : ArrayBuffer | null // unlocked PDF bytes for merging
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

// ─── Google Drive Picker ───────────────────────────────────────
function pickFromGDrive() {
    openGDrivePicker({
        mimeTypes: ['application/pdf'],
        multiSelect: true,
        onFilesSelected: (files) => {
            handleFiles(files);
        },
    });
}

// ─── Load PDF Item (async: thumbnail + page count + encryption check) ─────────
async function loadPdfItem(file) {
    const item = {
        file,
        totalPages: 0,
        selectedPages: new Set(),
        thumbnail: null,
        pageInput: '',
        expanded: false,
        isEncrypted: false,
        isUnlocked: true,
        password: '',
        decryptedArrayBuffer: null
    };

    pdfItems.push(item);
    renderFileList();

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        item.totalPages = pdfDoc.numPages;
        item.selectedPages = new Set(Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1));
        item.pageInput = pdfDoc.numPages > 1 ? `1-${pdfDoc.numPages}` : '1';
        item.isEncrypted = false;
        item.isUnlocked = true;

        // render thumbnail halaman pertama
        const page     = await pdfDoc.getPage(1);
        const scale    = 0.5;
        const viewport = page.getViewport({ scale });
        const canvas   = document.createElement('canvas');
        canvas.width   = viewport.width;
        canvas.height  = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        item.thumbnail = canvas.toDataURL('image/jpeg', 0.85);

    } catch (err) {
        if (err.name === 'PasswordException' || err.message?.toLowerCase().includes('password') || err.code === 1) {
            item.isEncrypted = true;
            item.isUnlocked = false;
            item.totalPages = 0;
            item.thumbnail = null;
        } else {
            item.totalPages = 0;
            item.thumbnail = null;
        }
    }

    renderFileList();
}

// ─── Unlock Encrypted PDF Item ──────────────────────────────────
async function unlockPdfItem(index) {
    const item = pdfItems[index];
    const passInput = document.getElementById(`unlockPass_${index}`);
    const password = passInput ? passInput.value.trim() : item.password;

    if (!password) {
        alert('Harap masukkan kata sandi (password) untuk dokumen ini.');
        return;
    }

    showProgress(25, `Membuka password: ${item.file.name}...`);

    try {
        const arrayBuffer = await item.file.arrayBuffer();
        const pdfDocJs = await pdfjsLib.getDocument({ data: arrayBuffer, password }).promise;

        item.totalPages = pdfDocJs.numPages;
        item.selectedPages = new Set(Array.from({ length: pdfDocJs.numPages }, (_, i) => i + 1));
        item.pageInput = pdfDocJs.numPages > 1 ? `1-${pdfDocJs.numPages}` : '1';
        item.password = password;

        // Render thumbnail
        const page     = await pdfDocJs.getPage(1);
        const scale    = 0.5;
        const viewport = page.getViewport({ scale });
        const canvas   = document.createElement('canvas');
        canvas.width   = viewport.width;
        canvas.height  = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        item.thumbnail = canvas.toDataURL('image/jpeg', 0.85);

        // Convert encrypted PDF to clean unlocked PDF arrayBuffer for pdf-lib merging
        showProgress(55, `Menyiapkan halaman ${item.file.name} untuk digabungkan...`);
        const { PDFDocument } = PDFLib;
        const unlockedDoc = await PDFDocument.create();

        for (let p = 1; p <= item.totalPages; p++) {
            const pPage = await pdfDocJs.getPage(p);
            const pVp = pPage.getViewport({ scale: 2.0 });
            const pCanvas = document.createElement('canvas');
            pCanvas.width  = pVp.width;
            pCanvas.height = pVp.height;
            await pPage.render({ canvasContext: pCanvas.getContext('2d'), viewport: pVp }).promise;

            const imgBytes = await new Promise(res => {
                pCanvas.toBlob(async blob => {
                    res(new Uint8Array(await blob.arrayBuffer()));
                }, 'image/jpeg', 0.94);
            });

            const embedded = await unlockedDoc.embedJpg(imgBytes);
            const origVp = pPage.getViewport({ scale: 1.0 });
            const newPage = unlockedDoc.addPage([origVp.width, origVp.height]);
            newPage.drawImage(embedded, { x: 0, y: 0, width: origVp.width, height: origVp.height });
        }

        item.decryptedArrayBuffer = await unlockedDoc.save();
        item.isUnlocked = true;

        hideProgress();
        renderFileList();
        showStatus(`✅ Dokumen "${item.file.name}" berhasil dibuka dan siap digabungkan!`, 'success');
    } catch (err) {
        hideProgress();
        alert('Gagal membuka password: ' + (err.name === 'PasswordException' ? 'Kata sandi salah atau tidak cocok.' : err.message));
    }
}

// ─── Parse Page Range String ───────────────────────────────────
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
        const gdriveBtn = document.getElementById('mergeGDriveBtn');
        if (gdriveBtn) gdriveBtn.disabled = true;
        return;
    }

    fileSection.classList.remove('hidden');
    outputSection.classList.remove('hidden');
    fileCount.textContent = pdfItems.length;
    
    // Check if at least 2 files are present and all encrypted files are unlocked
    const hasLocked = pdfItems.some(item => item.isEncrypted && !item.isUnlocked);
    const isReady = pdfItems.length >= 2 && !hasLocked;
    mergeBtn.disabled = !isReady;
    const gdriveBtn = document.getElementById('mergeGDriveBtn');
    if (gdriveBtn) gdriveBtn.disabled = !isReady;

    list.innerHTML = pdfItems.map((item, index) => {
        const thumb = item.thumbnail
            ? `<img src="${item.thumbnail}" class="pdf-thumb" alt="preview">`
            : `<div class="pdf-thumb pdf-thumb-placeholder">${item.isEncrypted && !item.isUnlocked ? '🔒' : (item.totalPages === 0 ? '⏳' : '📄')}</div>`;

        let pageBadgeHtml = '';
        if (item.isEncrypted && !item.isUnlocked) {
            pageBadgeHtml = `<span class="encrypted-badge">🔒 Terkunci Password</span>`;
        } else if (item.isEncrypted && item.isUnlocked) {
            pageBadgeHtml = `<span class="encrypted-badge unlocked">🔓 Terbuka (${item.selectedPages.size}/${item.totalPages} hal.)</span>`;
        } else {
            const pageLabel = item.totalPages > 0
                ? `${item.selectedPages.size}/${item.totalPages} hal.`
                : 'Memuat...';
            const pageBadgeClass = (item.totalPages > 0 && item.selectedPages.size < item.totalPages)
                ? 'page-badge page-badge-partial'
                : 'page-badge';
            pageBadgeHtml = `<span class="${pageBadgeClass}">${pageLabel}</span>`;
        }

        const unlockRowHtml = (item.isEncrypted && !item.isUnlocked) ? `
            <div class="inline-unlock-row">
                <input
                    type="password"
                    class="inline-unlock-input"
                    id="unlockPass_${index}"
                    placeholder="Ketik password..."
                    onkeydown="if(event.key==='Enter') unlockPdfItem(${index})"
                />
                <button class="btn btn-small btn-primary" onclick="unlockPdfItem(${index})">🔓 Buka</button>
            </div>
        ` : '';

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
                    ${pageBadgeHtml}
                </div>
                ${unlockRowHtml}
            </div>
            <button
                class="page-btn ${item.expanded ? 'page-btn-active' : ''}"
                onclick="togglePageSelector(${index})"
                title="Pilih Halaman"
                ${(item.totalPages === 0 || (item.isEncrypted && !item.isUnlocked)) ? 'disabled' : ''}
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

// ─── Remove File ───────────────────────────────────────────────
function removeFile(index) {
    pdfItems.splice(index, 1);
    renderFileList();
}

// ─── Drag & Drop Reorder ───────────────────────────────────────
function onDragStart(e, index) {
    dragSrcIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging');
}

function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const li = e.currentTarget.closest('li[draggable="true"]');
    if (li) li.classList.add('drag-over');
}

function onDropItem(e, targetIndex) {
    e.stopPropagation();
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

    const [moved] = pdfItems.splice(dragSrcIndex, 1);
    pdfItems.splice(targetIndex, 0, moved);
    renderFileList();
}

function onDragEnd() {
    dragSrcIndex = null;
    document.querySelectorAll('.dragging, .drag-over').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
}

// ─── Merge & Download PDF ──────────────────────────────────────
async function mergePdfs() {
    if (pdfItems.length < 2) return;

    // Verify all files unlocked
    const lockedItem = pdfItems.find(item => item.isEncrypted && !item.isUnlocked);
    if (lockedItem) {
        alert(`Dokumen "${lockedItem.file.name}" terkunci dengan password. Harap buka kuncinya terlebih dahulu.`);
        return;
    }

    const rawName    = document.getElementById('outputName').value.trim();
    const outputName = (rawName || 'merged_output').replace(/\.pdf$/i, '') + '.pdf';

    const mergeBtn = document.getElementById('mergeBtn');
    mergeBtn.disabled = true;
    showProgress(0, 'Memulai proses penggabungan...');
    hideStatus();

    try {
        const { PDFDocument } = PDFLib;
        const mergedPdf = await PDFDocument.create();

        const activeItems = pdfItems.filter(item => item.selectedPages.size > 0);
        if (activeItems.length === 0) throw new Error('Tidak ada halaman yang dipilih untuk digabung.');
        if (activeItems.length < 2) throw new Error('Minimal 2 file harus memiliki halaman yang dipilih.');

        const total = activeItems.length;
        let totalPagesMerged = 0;

        for (let i = 0; i < total; i++) {
            const item = activeItems[i];
            const pct  = Math.round((i / total) * 90);
            showProgress(pct, `Memproses: ${item.file.name} (${i + 1}/${total})`);

            const arrayBuffer = item.decryptedArrayBuffer || await item.file.arrayBuffer();
            let pdf;
            try {
                pdf = await PDFDocument.load(arrayBuffer);
            } catch {
                throw new Error(`File "${item.file.name}" rusak atau gagal dimuat.`);
            }

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
        const isReady = pdfItems.length >= 2 && !pdfItems.some(item => item.isEncrypted && !item.isUnlocked);
        mergeBtn.disabled = !isReady;
        const gdriveBtn = document.getElementById('mergeGDriveBtn');
        if (gdriveBtn) gdriveBtn.disabled = !isReady;
    }
}

// ─── Merge & Save Directly to Google Drive ─────────────────────
async function mergeAndSaveToGDrive() {
    if (pdfItems.length < 2) return;

    const lockedItem = pdfItems.find(item => item.isEncrypted && !item.isUnlocked);
    if (lockedItem) {
        alert(`Dokumen "${lockedItem.file.name}" terkunci dengan password. Harap buka kuncinya terlebih dahulu.`);
        return;
    }

    const rawName    = document.getElementById('outputName').value.trim();
    const outputName = (rawName || 'merged_output').replace(/\.pdf$/i, '') + '.pdf';

    const mergeBtn   = document.getElementById('mergeBtn');
    const gdriveBtn  = document.getElementById('mergeGDriveBtn');
    mergeBtn.disabled  = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(0, 'Menyiapkan penggabungan PDF...');
    hideStatus();

    try {
        const { PDFDocument } = PDFLib;
        const mergedPdf = await PDFDocument.create();

        const activeItems = pdfItems.filter(item => item.selectedPages.size > 0);
        if (activeItems.length === 0) throw new Error('Tidak ada halaman yang dipilih untuk digabung.');
        if (activeItems.length < 2) throw new Error('Minimal 2 file harus memiliki halaman yang dipilih.');

        const total = activeItems.length;

        for (let i = 0; i < total; i++) {
            const item = activeItems[i];
            const pct  = Math.round((i / total) * 70);
            showProgress(pct, `Menggabungkan: ${item.file.name} (${i + 1}/${total})`);

            const arrayBuffer = item.decryptedArrayBuffer || await item.file.arrayBuffer();
            const pdf = await PDFDocument.load(arrayBuffer);

            const pageIndices = getSortedPages(item.selectedPages).map(p => p - 1);
            const pages = await mergedPdf.copyPages(pdf, pageIndices);
            pages.forEach(page => mergedPdf.addPage(page));
        }

        showProgress(75, 'Menyimpan dokumen PDF...');
        const mergedPdfBytes = await mergedPdf.save();
        const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });

        uploadBlobToGDrive({
            blob,
            filename: outputName,
            mimeType: 'application/pdf',
            onProgress: (p, text) => showProgress(p, text),
            onSuccess: (res) => {
                showProgress(100, 'Selesai!');
                const loc = res.folderName ? `di folder <strong>"${res.folderName}"</strong>` : 'di Google Drive Anda';
                showStatus(
                    `✅ Dokumen <strong>"${res.name}"</strong> berhasil disimpan ${loc}! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka File di Google Drive</a>`,
                    'success'
                );
            },
            onError: (err) => {
                showStatus('❌ Gagal mengunggah ke Google Drive: ' + err.message, 'error');
            },
        });

    } catch (error) {
        hideProgress();
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        const isReady = pdfItems.length >= 2 && !pdfItems.some(item => item.isEncrypted && !item.isUnlocked);
        mergeBtn.disabled = !isReady;
        if (gdriveBtn) gdriveBtn.disabled = !isReady;
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
    box.innerHTML = msg;
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
