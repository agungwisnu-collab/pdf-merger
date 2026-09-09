/** ============================================================
 *  organize-pdf.js — Unified Page Organizer, Rotator & Merger
 *  Omni PDF (All-in-One Page Manipulation Engine)
 *  Libraries: pdf-lib (merging, copying, rotation), PDF.js (decryption & thumbnail rendering)
 * ============================================================ */

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/**
 * sourceFiles: array of {
 *   id          : string,
 *   file        : File,
 *   name        : string,
 *   size        : number,
 *   isEncrypted : boolean,
 *   isUnlocked  : boolean,
 *   password    : string,
 *   totalPages  : number,
 *   arrayBuffer : ArrayBuffer
 * }
 *
 * pages: array of {
 *   uid          : string,
 *   fileId       : string,
 *   fileName     : string,
 *   origPageIndex: number, // 0-based index in source doc
 *   thumbUrl     : string,
 *   rotation     : number  // degrees: 0, 90, 180, 270
 * }
 */
let sourceFiles   = [];
let pages         = [];
let originalPages = [];
let dragSrcIndex  = null;

// ─── DOM Event Listeners ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const pdfInput    = document.getElementById('pdfInput');
    const addPdfInput = document.getElementById('addPdfInput');
    const dropZone    = document.getElementById('uploadSection');

    if (pdfInput) {
        pdfInput.addEventListener('change', async (e) => {
            if (e.target.files?.length) {
                await loadFiles(Array.from(e.target.files));
            }
            e.target.value = '';
        });
    }

    if (addPdfInput) {
        addPdfInput.addEventListener('change', async (e) => {
            if (e.target.files?.length) {
                await loadFiles(Array.from(e.target.files));
            }
            e.target.value = '';
        });
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
            if (files.length) await loadFiles(files);
        });
    }
});

// ─── Google Drive Picker Integration ───────────────────────────
function pickPDFFromGDrive() {
    openGDrivePicker({
        mimeTypes: ['application/pdf'],
        multiSelect: true,
        onFilesSelected: async (files) => {
            if (files.length > 0) await loadFiles(files);
        },
    });
}

// ─── Load Files (Multi-file & Protection Handling) ─────────────
async function loadFiles(newFileList) {
    const pdfFiles = newFileList.filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfFiles.length) {
        alert('Harap pilih dokumen yang berformat PDF.');
        return;
    }

    showProgress(15, `Membaca ${pdfFiles.length} file PDF...`);
    hideStatus();

    for (let fIdx = 0; fIdx < pdfFiles.length; fIdx++) {
        const file = pdfFiles[fIdx];
        const fileId = 'f_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        const arrayBuffer = await file.arrayBuffer();

        const sfItem = {
            id: fileId,
            file,
            name: file.name,
            size: file.size,
            isEncrypted: false,
            isUnlocked: true,
            password: '',
            totalPages: 0,
            arrayBuffer
        };

        try {
            // Attempt to read with pdf.js to check password & page count
            const pdfDocJs = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            sfItem.totalPages = pdfDocJs.numPages;
            sourceFiles.push(sfItem);

            // Render thumbnails for this file
            const total = pdfDocJs.numPages;
            for (let pNum = 1; pNum <= total; pNum++) {
                const progPct = Math.round(20 + ((fIdx + (pNum / total)) / pdfFiles.length) * 70);
                showProgress(progPct, `Memuat ${file.name} (lembar ${pNum}/${total})...`);

                const page = await pdfDocJs.getPage(pNum);
                const viewport = page.getViewport({ scale: 0.35 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: ctx, viewport }).promise;

                pages.push({
                    uid: 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                    fileId: sfItem.id,
                    fileName: sfItem.name,
                    origPageIndex: pNum - 1,
                    thumbUrl: canvas.toDataURL('image/jpeg', 0.85),
                    rotation: 0
                });
            }
        } catch (err) {
            // Check if password protected
            if (err.name === 'PasswordException' || err.message?.toLowerCase().includes('password') || err.code === 1) {
                sfItem.isEncrypted = true;
                sfItem.isUnlocked = false;
                sourceFiles.push(sfItem);
            } else {
                console.error('Error loading PDF:', err);
                showStatus(`⚠️ Gagal memuat file "${file.name}": ${err.message}`, 'error');
            }
        }
    }

    originalPages = JSON.parse(JSON.stringify(pages));

    document.getElementById('uploadSection').classList.add('hidden');
    document.getElementById('workspaceSection').classList.remove('hidden');

    renderSourceFiles();
    renderUnlockBanners();
    renderOrganizeGrid();
    hideProgress();
}

// ─── Render Source Files Chips ─────────────────────────────────
function renderSourceFiles() {
    const listEl = document.getElementById('sourceFilesList');
    const countEl = document.getElementById('sourceFilesCount');
    if (!listEl) return;

    countEl.textContent = sourceFiles.length;

    if (sourceFiles.length === 0) {
        listEl.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-muted);">Belum ada file aktif.</span>';
        return;
    }

    listEl.innerHTML = sourceFiles.map(sf => {
        const encryptedClass = (sf.isEncrypted && !sf.isUnlocked) ? 'encrypted' : '';
        const countText = (sf.isEncrypted && !sf.isUnlocked)
            ? '🔒 Terkunci'
            : `${sf.totalPages} hal`;

        return `
            <div class="source-file-chip ${encryptedClass}" title="${sf.name} (${formatSize(sf.size)})">
                <span>📄</span>
                <span class="chip-name">${escapeHtml(sf.name)}</span>
                <span class="chip-count">${countText}</span>
                <button class="chip-remove" onclick="removeSourceFile('${sf.id}')" title="Hapus file ini beserta halamannya">✕</button>
            </div>
        `;
    }).join('');
}

// ─── Render Password Unlock Banners ────────────────────────────
function renderUnlockBanners() {
    const container = document.getElementById('unlockContainer');
    if (!container) return;

    const lockedFiles = sourceFiles.filter(sf => sf.isEncrypted && !sf.isUnlocked);
    if (!lockedFiles.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = lockedFiles.map(sf => `
        <div class="unlock-alert-card" id="unlockCard_${sf.id}">
            <div class="unlock-alert-header">
                <span>🔒</span>
                <span>Dokumen <u>${escapeHtml(sf.name)}</u> terproteksi kata sandi</span>
            </div>
            <p style="margin: 0; font-size: 0.82rem; color: var(--text-muted);">
                Masukkan kata sandi pembuka untuk menampilkan dan mengelola lembar halaman dokumen ini:
            </p>
            <div class="unlock-alert-form">
                <div class="unlock-input-wrap">
                    <input type="password" id="passInput_${sf.id}" class="unlock-input-field" placeholder="Masukkan kata sandi..." onkeydown="if(event.key==='Enter') unlockSourceFile('${sf.id}')">
                    <button type="button" class="unlock-eye-btn" onclick="togglePassEye('${sf.id}')" title="Tampilkan/Sembunyikan sandi">👁️</button>
                </div>
                <button type="button" class="unlock-submit-btn" onclick="unlockSourceFile('${sf.id}')">
                    🔓 Buka Kunci
                </button>
            </div>
        </div>
    `).join('');
}

function togglePassEye(fileId) {
    const input = document.getElementById(`passInput_${fileId}`);
    if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
    }
}

// ─── Unlock a Protected Source File ────────────────────────────
async function unlockSourceFile(fileId) {
    const sf = sourceFiles.find(f => f.id === fileId);
    if (!sf) return;

    const input = document.getElementById(`passInput_${fileId}`);
    const password = input ? input.value.trim() : '';

    if (!password) {
        alert('Harap masukkan kata sandi untuk membuka dokumen ini.');
        return;
    }

    showProgress(25, `Membuka proteksi ${sf.name}...`);

    try {
        const pdfDocJs = await pdfjsLib.getDocument({
            data: sf.arrayBuffer,
            password: password
        }).promise;

        sf.password = password;
        sf.isUnlocked = true;
        sf.totalPages = pdfDocJs.numPages;

        const total = pdfDocJs.numPages;
        for (let pNum = 1; pNum <= total; pNum++) {
            const progPct = Math.round(25 + (pNum / total) * 70);
            showProgress(progPct, `Memuat lembar ${pNum}/${total} dari ${sf.name}...`);

            const page = await pdfDocJs.getPage(pNum);
            const viewport = page.getViewport({ scale: 0.35 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;

            pages.push({
                uid: 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                fileId: sf.id,
                fileName: sf.name,
                origPageIndex: pNum - 1,
                thumbUrl: canvas.toDataURL('image/jpeg', 0.85),
                rotation: 0
            });
        }

        originalPages = JSON.parse(JSON.stringify(pages));

        renderSourceFiles();
        renderUnlockBanners();
        renderOrganizeGrid();
        hideProgress();
        showStatus(`🔓 Berhasil! Dokumen "${sf.name}" (${total} halaman) berhasil dibuka dan disisipkan.`, 'success');
    } catch (err) {
        hideProgress();
        if (err.name === 'PasswordException' || err.message?.toLowerCase().includes('password')) {
            alert('Kata sandi salah atau tidak cocok. Silakan coba lagi.');
        } else {
            alert('Gagal membuka file: ' + err.message);
        }
    }
}

// ─── Remove Source File & Associated Pages ─────────────────────
function removeSourceFile(fileId) {
    const sf = sourceFiles.find(f => f.id === fileId);
    if (!sf) return;

    if (!confirm(`Hapus dokumen "${sf.name}" beserta seluruh halamannya dari daftar?`)) return;

    sourceFiles = sourceFiles.filter(f => f.id !== fileId);
    pages = pages.filter(p => p.fileId !== fileId);
    originalPages = originalPages.filter(p => p.fileId !== fileId);

    if (sourceFiles.length === 0) {
        clearAllFiles();
        return;
    }

    renderSourceFiles();
    renderUnlockBanners();
    renderOrganizeGrid();
}

// ─── Clear All Files & Reset Workspace ─────────────────────────
function clearAllFiles() {
    sourceFiles = [];
    pages = [];
    originalPages = [];
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('organizeGrid').innerHTML = '';
    document.getElementById('unlockContainer').innerHTML = '';
    hideStatus();
    hideProgress();
}

// ─── Render Organize Grid ──────────────────────────────────────
function renderOrganizeGrid() {
    const grid = document.getElementById('organizeGrid');
    const docMeta = document.getElementById('docMeta');
    const saveBtn = document.getElementById('savePdfBtn');
    const saveGdriveBtn = document.getElementById('saveGDriveBtn');

    if (docMeta) docMeta.textContent = `${pages.length} Halaman aktif`;

    if (pages.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 48px 16px; color: var(--text-muted);">
                <p style="font-size: 1.1rem; margin-bottom: 8px;">📭 Belum ada lembar halaman aktif.</p>
                <p style="font-size: 0.85rem;">Buka file yang terkunci atau klik tombol <strong>"➕ Tambah File PDF"</strong> di atas.</p>
            </div>
        `;
        if (saveBtn) saveBtn.disabled = true;
        if (saveGdriveBtn) saveGdriveBtn.disabled = true;
        return;
    }

    if (saveBtn) saveBtn.disabled = false;
    if (saveGdriveBtn) saveGdriveBtn.disabled = false;

    grid.innerHTML = pages.map((item, index) => {
        return `
        <div
            class="doc-page-card"
            draggable="true"
            data-index="${index}"
            ondragstart="onDragStart(event, ${index})"
            ondragover="onDragOver(event)"
            ondrop="onDropItem(event, ${index})"
            ondragend="onDragEnd()"
        >
            <div class="doc-page-thumb-wrap">
                <span class="doc-page-file-badge" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}</span>
                <img src="${item.thumbUrl}" class="doc-page-thumb" style="transform: rotate(${item.rotation}deg);" alt="Hal ${index + 1}">
            </div>
            <div class="doc-page-footer">
                <span>#${index + 1}</span>
                <div class="doc-page-actions">
                    <button class="doc-mini-btn" onclick="rotateSinglePage(${index}, -90)" title="Putar Kiri 90°">↺</button>
                    <button class="doc-mini-btn" onclick="rotateSinglePage(${index}, 90)" title="Putar Kanan 90°">↻</button>
                    <button class="doc-mini-btn" onclick="duplicatePage(${index})" title="Duplikat Lembar Ini">📑</button>
                    <button class="doc-mini-btn del-btn" onclick="deletePage(${index})" title="Hapus Lembar Ini">🗑️</button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// ─── Single Page Actions ───────────────────────────────────────
function rotateSinglePage(index, deltaAngle) {
    if (!pages[index]) return;
    pages[index].rotation = (pages[index].rotation + deltaAngle + 360) % 360;
    renderOrganizeGrid();
}

function duplicatePage(index) {
    if (!pages[index]) return;
    const clone = {
        ...pages[index],
        uid: 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
    };
    pages.splice(index + 1, 0, clone);
    renderOrganizeGrid();
}

function deletePage(index) {
    pages.splice(index, 1);
    renderOrganizeGrid();
}

// ─── Batch Actions ─────────────────────────────────────────────
function rotateAllPages(deltaAngle) {
    if (!pages.length) return;
    pages.forEach(p => {
        p.rotation = (p.rotation + deltaAngle + 360) % 360;
    });
    renderOrganizeGrid();
}

function reverseAllPages() {
    if (!pages.length) return;
    pages.reverse();
    renderOrganizeGrid();
}

function resetAllChanges() {
    if (!originalPages.length) return;
    pages = JSON.parse(JSON.stringify(originalPages));
    renderOrganizeGrid();
}

// ─── Drag & Drop to Reorder ────────────────────────────────────
function onDragStart(e, index) {
    dragSrcIndex = index;
    setTimeout(() => {
        document.querySelectorAll('.doc-page-card[data-index]').forEach(card => {
            if (parseInt(card.dataset.index) === index) card.classList.add('dragging');
        });
    }, 0);
}

function onDragOver(e) {
    e.preventDefault();
    document.querySelectorAll('.doc-page-card').forEach(c => c.classList.remove('drag-over'));
    const card = e.currentTarget;
    if (card && card.dataset.index !== undefined) {
        card.classList.add('drag-over');
    }
}

function onDropItem(e, targetIndex) {
    e.preventDefault();
    if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
    const moved = pages.splice(dragSrcIndex, 1)[0];
    pages.splice(targetIndex, 0, moved);
    dragSrcIndex = null;
    renderOrganizeGrid();
}

function onDragEnd() {
    document.querySelectorAll('.doc-page-card').forEach(c => {
        c.classList.remove('dragging', 'drag-over');
    });
    dragSrcIndex = null;
}

// ─── Build Merged / Organized / Rotated PDF Blob via pdf-lib ───
async function buildOrganizedPdfBlob(onProgressCallback) {
    const { PDFDocument, degrees } = PDFLib;

    if (onProgressCallback) onProgressCallback(10, 'Menyiapkan dokumen sumber...');

    // 1. Preload each source document needed by the pages
    const neededFileIds = new Set(pages.map(p => p.fileId));
    const loadedDocs = new Map();

    for (const sf of sourceFiles) {
        if (!neededFileIds.has(sf.id)) continue;
        if (!sf.isUnlocked) {
            throw new Error(`Dokumen "${sf.name}" masih terproteksi password. Harap buka kunci terlebih dahulu sebelum menyimpan.`);
        }

        const options = sf.password ? { password: sf.password } : undefined;
        const doc = await PDFDocument.load(sf.arrayBuffer, options);
        loadedDocs.set(sf.id, doc);
    }

    // 2. Create target PDF document
    const newDoc = await PDFDocument.create();

    // 3. Copy each page in current visual order with rotation applied
    const totalPages = pages.length;
    for (let i = 0; i < totalPages; i++) {
        const item = pages[i];
        const pct = Math.round(15 + (i / totalPages) * 75);
        if (onProgressCallback) onProgressCallback(pct, `Menyalin lembar #${i + 1} dari ${totalPages}...`);

        const srcDoc = loadedDocs.get(item.fileId);
        if (!srcDoc) continue;

        const [copiedPage] = await newDoc.copyPages(srcDoc, [item.origPageIndex]);

        if (item.rotation !== 0) {
            const currentRot = copiedPage.getRotation().angle;
            copiedPage.setRotation(degrees((currentRot + item.rotation) % 360));
        }

        newDoc.addPage(copiedPage);
    }

    if (onProgressCallback) onProgressCallback(92, 'Mengompres dan merapikan struktur file...');
    const pdfBytes = await newDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
}

// ─── Save & Download PDF ───────────────────────────────────────
async function saveOrganizedPDF() {
    if (pages.length === 0) return;

    const rawName = document.getElementById('outputName').value.trim() || 'omni_combined_doc';
    const outputName = rawName.endsWith('.pdf') ? rawName : rawName + '.pdf';
    const saveBtn = document.getElementById('savePdfBtn');
    saveBtn.disabled = true;

    showProgress(10, 'Menyusun dokumen PDF baru...');

    try {
        const blob = await buildOrganizedPdfBlob(showProgress);
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = outputName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showProgress(100, 'Selesai!');
        showStatus(`✅ Berhasil! Dokumen baru dengan <strong>${pages.length} halaman</strong> berhasil diunduh sebagai "${outputName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Gagal menyimpan PDF: ' + err.message, 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

// ─── Save Organized PDF to Google Drive ────────────────────────
async function saveOrganizedToGDrive() {
    if (pages.length === 0) return;

    const rawName = document.getElementById('outputName').value.trim() || 'omni_combined_doc';
    const outputName = rawName.endsWith('.pdf') ? rawName : rawName + '.pdf';
    const saveBtn = document.getElementById('savePdfBtn');
    const gdriveBtn = document.getElementById('saveGDriveBtn');

    saveBtn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(10, 'Menyusun dokumen PDF baru...');

    try {
        const blob = await buildOrganizedPdfBlob(showProgress);

        showProgress(90, 'Mengunggah ke Google Drive...');
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
        showStatus('❌ Gagal menyimpan PDF: ' + err.message, 'error');
    } finally {
        saveBtn.disabled = false;
        if (gdriveBtn) gdriveBtn.disabled = false;
    }
}

// ─── UI Utility Helpers ────────────────────────────────────────
function showProgress(percent, text) {
    const sec = document.getElementById('progressSection');
    const bar = document.getElementById('progressBar');
    const txt = document.getElementById('progressText');
    if (sec) sec.classList.remove('hidden');
    if (bar) bar.style.width = percent + '%';
    if (txt) txt.textContent = text;
}

function hideProgress() {
    const sec = document.getElementById('progressSection');
    const bar = document.getElementById('progressBar');
    if (sec) sec.classList.add('hidden');
    if (bar) bar.style.width = '0%';
}

function showStatus(msg, type) {
    const box = document.getElementById('statusBox');
    if (!box) return;
    box.innerHTML = msg;
    box.className = `status-box ${type}`;
    box.classList.remove('hidden');
}

function hideStatus() {
    const box = document.getElementById('statusBox');
    if (box) box.classList.add('hidden');
}

function formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
