/** ============================================================
 *  split-pdf.js — Split PDF Controller
 *  Libraries: pdf-lib (split), PDF.js (thumbnails), JSZip (ZIP)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfFile      = null;
let pdfDocJs     = null;
let totalPages   = 0;
let selectedPages = new Set();
let splitMode    = 'range'; // 'range' | 'all'

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

        // Default: pilih semua halaman
        selectedPages = new Set(Array.from({ length: totalPages }, (_, i) => i + 1));
        document.getElementById('rangeInput').value = totalPages > 1 ? `1-${totalPages}` : '1';

        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');

        await renderPageThumbnails();
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
    selectedPages.clear();
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('pageGrid').innerHTML = '';
    hideStatus();
    hideProgress();
}

// ─── Mode Switching ─────────────────────────────────────────────
function setSplitMode(mode) {
    splitMode = mode;
    document.getElementById('modeRangeCard').classList.toggle('active', mode === 'range');
    document.getElementById('modeAllCard').classList.toggle('active', mode === 'all');
    document.getElementById('rangeInputPanel').classList.toggle('hidden', mode === 'all');
    document.getElementById('formatOptionPanel').classList.toggle('hidden', mode === 'range');

    const format = document.getElementById('splitFormat').value;
    updateSplitBtnLabels(mode, format);
}

function onSplitFormatChange(format) {
    updateSplitBtnLabels(splitMode, format);
}

function updateSplitBtnLabels(mode, format) {
    const splitBtn = document.getElementById('splitBtn');
    const extSpan  = document.getElementById('outputExt');

    if (mode === 'range') {
        extSpan.textContent = '.pdf';
        splitBtn.textContent = '✂️ Pisahkan & Download PDF';
    } else {
        if (format === 'zip') {
            extSpan.textContent = '.zip';
            splitBtn.textContent = '📦 Pisahkan & Download (.ZIP)';
        } else {
            extSpan.textContent = '.pdf';
            splitBtn.textContent = '📑 Download Semua Halaman Satuan (.PDF)';
        }
    }
}

// ─── Quick Single Page PDF Download ────────────────────────────
async function downloadSinglePagePdf(pageIndex) {
    if (!pdfFile) return;

    showProgress(20, `Mengekstrak halaman ${pageIndex}...`);
    try {
        const { PDFDocument } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const srcDoc = await PDFDocument.load(arrayBuf);

        const singleDoc = await PDFDocument.create();
        const [copied] = await singleDoc.copyPages(srcDoc, [pageIndex - 1]);
        singleDoc.addPage(copied);

        const pdfBytes = await singleDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const baseName = pdfFile.name.replace(/\.pdf$/i, '');
        const filename = `${baseName}_halaman_${pageIndex}.pdf`;

        downloadBlob(blob, filename);
        showProgress(100, 'Selesai!');
        showStatus(`✅ Halaman ${pageIndex} berhasil diunduh sebagai "${filename}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Gagal mengunduh halaman: ' + err.message, 'error');
    }
}

// ─── Render Page Thumbnails ────────────────────────────────────
async function renderPageThumbnails() {
    const grid = document.getElementById('pageGrid');
    grid.innerHTML = '';

    for (let i = 1; i <= totalPages; i++) {
        const page = await pdfDocJs.getPage(i);
        const viewport = page.getViewport({ scale: 0.3 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const card = document.createElement('div');
        card.className = `doc-page-card ${selectedPages.has(i) ? 'selected' : ''}`;
        card.id = `pageCard_${i}`;
        card.onclick = () => togglePageSelect(i);

        card.innerHTML = `
            <div class="doc-page-thumb-wrap">
                <img src="${canvas.toDataURL('image/jpeg', 0.8)}" class="doc-page-thumb" alt="Hal ${i}">
            </div>
            <div class="doc-page-footer" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span style="font-size: 0.8rem; font-weight: 700;">Hal. ${i}</span>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <button class="btn btn-secondary-sm" style="padding: 2px 7px; font-size: 0.72rem;" title="Download halaman ${i} saja" onclick="event.stopPropagation(); downloadSinglePagePdf(${i})">⬇️ PDF</button>
                    <input type="checkbox" ${selectedPages.has(i) ? 'checked' : ''} onclick="event.stopPropagation(); togglePageSelect(${i})">
                </div>
            </div>
        `;
        grid.appendChild(card);
    }
    updateRangeStatus();
}

function togglePageSelect(num) {
    if (selectedPages.has(num)) selectedPages.delete(num);
    else selectedPages.add(num);

    const card = document.getElementById(`pageCard_${num}`);
    if (card) {
        card.classList.toggle('selected', selectedPages.has(num));
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = selectedPages.has(num);
    }
    updateRangeInputFromSet();
    updateRangeStatus();
}

function selectAll() {
    selectedPages = new Set(Array.from({ length: totalPages }, (_, i) => i + 1));
    document.getElementById('rangeInput').value = `1-${totalPages}`;
    document.querySelectorAll('.doc-page-card').forEach(c => c.classList.add('selected'));
    document.querySelectorAll('.doc-page-card input[type="checkbox"]').forEach(cb => cb.checked = true);
    updateRangeStatus();
}

function clearSelection() {
    selectedPages.clear();
    document.getElementById('rangeInput').value = '';
    document.querySelectorAll('.doc-page-card').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.doc-page-card input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateRangeStatus();
}

function onRangeChange(val) {
    selectedPages = parsePageRange(val, totalPages);
    document.querySelectorAll('.doc-page-card').forEach((card, idx) => {
        const pageNum = idx + 1;
        const isSel = selectedPages.has(pageNum);
        card.classList.toggle('selected', isSel);
        const cb = card.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = isSel;
    });
    updateRangeStatus();
}

function updateRangeInputFromSet() {
    const arr = Array.from(selectedPages).sort((a, b) => a - b);
    document.getElementById('rangeInput').value = arr.join(', ');
}

function updateRangeStatus() {
    const el = document.getElementById('rangeStatus');
    if (selectedPages.size === 0) {
        el.className = 'page-status page-status-warn';
        el.textContent = '⚠️ Belum ada halaman yang dipilih.';
    } else {
        el.className = 'page-status';
        el.textContent = `✅ ${selectedPages.size} dari ${totalPages} halaman dipilih.`;
    }
}

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

// ─── Process Split & Download ──────────────────────────────────
async function processSplit() {
    if (!pdfFile) return;

    if (splitMode === 'range' && selectedPages.size === 0) {
        alert('Harap pilih minimal 1 halaman untuk diekstrak.');
        return;
    }

    const rawName = document.getElementById('outputName').value.trim() || 'split_document';
    const splitBtn = document.getElementById('splitBtn');
    splitBtn.disabled = true;
    showProgress(10, 'Mempersiapkan pemisahan dokumen...');

    try {
        const { PDFDocument } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const srcDoc = await PDFDocument.load(arrayBuf);

        if (splitMode === 'range') {
            // Mode A: Ekstrak halaman terpilih menjadi 1 file PDF
            const newDoc = await PDFDocument.create();
            const indices = Array.from(selectedPages).sort((a, b) => a - b).map(p => p - 1);
            const copiedPages = await newDoc.copyPages(srcDoc, indices);
            copiedPages.forEach(page => newDoc.addPage(page));

            showProgress(85, 'Menyimpan file PDF...');
            const pdfBytes = await newDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            downloadBlob(blob, `${rawName}.pdf`);

            showProgress(100, 'Selesai!');
            showStatus(`✅ Berhasil! ${selectedPages.size} halaman diekstrak ke "${rawName}.pdf".`, 'success');
        } else {
            // Mode B: Pisahkan setiap halaman
            const format = document.getElementById('splitFormat').value;
            const total = srcDoc.getPageCount();

            if (format === 'zip') {
                const zip = new JSZip();
                for (let i = 0; i < total; i++) {
                    const pct = Math.round(10 + (i / total) * 75);
                    showProgress(pct, `Mengekstrak halaman ${i + 1} dari ${total}...`);

                    const singleDoc = await PDFDocument.create();
                    const [copied] = await singleDoc.copyPages(srcDoc, [i]);
                    singleDoc.addPage(copied);
                    const singleBytes = await singleDoc.save();
                    zip.file(`${rawName}_halaman_${i + 1}.pdf`, singleBytes);
                }

                showProgress(90, 'Mengompresi file ke format ZIP...');
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                downloadBlob(zipBlob, `${rawName}.zip`);

                showProgress(100, 'Selesai!');
                showStatus(`✅ Berhasil! Seluruh ${total} halaman dipisah & diunduh sebagai "${rawName}.zip".`, 'success');
            } else {
                // Mode Single: Download each page individually with a tiny pause
                for (let i = 0; i < total; i++) {
                    const pct = Math.round(10 + (i / total) * 80);
                    showProgress(pct, `Mengunduh lembar ${i + 1} dari ${total}...`);

                    const singleDoc = await PDFDocument.create();
                    const [copied] = await singleDoc.copyPages(srcDoc, [i]);
                    singleDoc.addPage(copied);
                    const singleBytes = await singleDoc.save();
                    const singleBlob = new Blob([singleBytes], { type: 'application/pdf' });
                    downloadBlob(singleBlob, `${rawName}_halaman_${i + 1}.pdf`);

                    await new Promise(r => setTimeout(r, 250));
                }

                showProgress(100, 'Selesai!');
                showStatus(`✅ Berhasil! Seluruh ${total} file PDF satuan per lembar telah diunduh.`, 'success');
            }
        }
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        splitBtn.disabled = false;
    }
}

// ─── Split & Save Directly to Google Drive ─────────────────────
async function splitAndSaveToGDrive() {
    if (!pdfFile) return;

    if (splitMode === 'range' && selectedPages.size === 0) {
        alert('Harap pilih minimal 1 halaman untuk diekstrak.');
        return;
    }

    const rawName = document.getElementById('outputName').value.trim() || 'split_document';
    const splitBtn = document.getElementById('splitBtn');
    const gdriveBtn = document.getElementById('splitGDriveBtn');
    splitBtn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(10, 'Mempersiapkan pemisahan dokumen...');

    try {
        const { PDFDocument } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const srcDoc = await PDFDocument.load(arrayBuf);

        if (splitMode === 'range') {
            const newDoc = await PDFDocument.create();
            const indices = Array.from(selectedPages).sort((a, b) => a - b).map(p => p - 1);
            const copiedPages = await newDoc.copyPages(srcDoc, indices);
            copiedPages.forEach(page => newDoc.addPage(page));

            showProgress(75, 'Menyimpan file PDF...');
            const pdfBytes = await newDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });

            uploadBlobToGDrive({
                blob,
                filename: `${rawName}.pdf`,
                mimeType: 'application/pdf',
                onProgress: showProgress,
                onSuccess: (res) => {
                    showProgress(100, 'Selesai!');
                    const loc = res.folderName ? `di folder <strong>"${res.folderName}"</strong>` : 'di Google Drive Anda';
                    showStatus(
                        `✅ File <strong>"${res.name}"</strong> berhasil disimpan ${loc}! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka di Google Drive</a>`,
                        'success'
                    );
                },
                onError: (err) => {
                    showStatus('❌ Gagal mengunggah ke Google Drive: ' + err.message, 'error');
                },
            });
        } else {
            const zip = new JSZip();
            const total = srcDoc.getPageCount();

            for (let i = 0; i < total; i++) {
                const pct = Math.round(10 + (i / total) * 65);
                showProgress(pct, `Mengekstrak halaman ${i + 1} dari ${total}...`);

                const singleDoc = await PDFDocument.create();
                const [copied] = await singleDoc.copyPages(srcDoc, [i]);
                singleDoc.addPage(copied);
                const singleBytes = await singleDoc.save();
                zip.file(`halaman_${i + 1}.pdf`, singleBytes);
            }

            showProgress(80, 'Mengompresi file ke format ZIP...');
            const zipBlob = await zip.generateAsync({ type: 'blob' });

            uploadBlobToGDrive({
                blob: zipBlob,
                filename: `${rawName}.zip`,
                mimeType: 'application/zip',
                onProgress: showProgress,
                onSuccess: (res) => {
                    showProgress(100, 'Selesai!');
                    const loc = res.folderName ? `di folder <strong>"${res.folderName}"</strong>` : 'di Google Drive Anda';
                    showStatus(
                        `✅ Arsip <strong>"${res.name}"</strong> berhasil disimpan ${loc}! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka di Google Drive</a>`,
                        'success'
                    );
                },
                onError: (err) => {
                    showStatus('❌ Gagal mengunggah ke Google Drive: ' + err.message, 'error');
                },
            });
        }
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        splitBtn.disabled = false;
        if (gdriveBtn) gdriveBtn.disabled = false;
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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
