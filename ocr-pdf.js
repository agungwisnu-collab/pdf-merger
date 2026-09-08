/** ============================================================
 *  ocr-pdf.js — iLovePDF-Grade Searchable PDF (Sandwich PDF) Generator
 *  Powered by: Tesseract.js v5 (AI OCR), PDF.js (Rendering), PDF-lib (Text Layer Injection)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfFile             = null;
let pdfBuffer           = null;
let pdfDocJs            = null;
let totalPages          = 0;
let searchablePdfBlob   = null;
let searchablePdfUrl    = null;
let extractedText       = '';

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

// ─── Load PDF & Render Thumbnails ──────────────────────────────
async function loadPDF(file) {
    try {
        pdfFile = file;
        showProgress(15, 'Membaca struktur dokumen PDF...');

        pdfBuffer = await file.arrayBuffer();
        pdfDocJs = await pdfjsLib.getDocument({ data: pdfBuffer.slice(0) }).promise;
        totalPages = pdfDocJs.numPages;

        document.getElementById('docTitle').textContent = file.name;
        document.getElementById('docMeta').textContent = `${totalPages} Halaman · ${formatSize(file.size)}`;
        document.getElementById('pagesCountBadge').textContent = `${totalPages} Hal`;

        // Switch View
        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');
        document.getElementById('ocrResultSection').classList.add('hidden');
        hideStatus();

        // Render thumbnails in background
        showProgress(35, 'Membuat pratinjau halaman...');
        await renderPageThumbnails();

        hideProgress();
    } catch (err) {
        hideProgress();
        showStatus('Gagal memuat PDF: ' + err.message, 'error');
    }
}

async function renderPageThumbnails() {
    const grid = document.getElementById('ocrThumbnailsGrid');
    grid.innerHTML = '';

    for (let i = 1; i <= totalPages; i++) {
        const card = document.createElement('div');
        card.className = 'ocr-thumb-card';
        card.id = `thumbCard_${i}`;

        const canvas = document.createElement('canvas');
        canvas.className = 'ocr-thumb-canvas';

        const label = document.createElement('div');
        label.className = 'ocr-thumb-label';
        label.textContent = `Halaman ${i}`;

        card.appendChild(canvas);
        card.appendChild(label);
        grid.appendChild(card);

        // Render low-res thumbnail
        try {
            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale: 0.38 });
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;
        } catch (e) {
            console.warn(`Gagal render thumbnail halaman ${i}:`, e);
        }
    }
}

function toggleCustomPageInput(val) {
    const wrap = document.getElementById('customPageInputWrap');
    if (val === 'custom') {
        wrap.classList.remove('hidden');
        document.getElementById('customPageRange').focus();
    } else {
        wrap.classList.add('hidden');
    }
}

function parsePageSelection() {
    const mode = document.getElementById('ocrPages').value;
    if (mode === 'all') {
        return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (mode === 'first') {
        return [1];
    }
    if (mode === 'custom') {
        const raw = document.getElementById('customPageRange').value.trim();
        if (!raw) return [1];
        const pages = new Set();
        const parts = raw.split(/[,;\s]+/);
        for (const part of parts) {
            if (part.includes('-')) {
                const [startStr, endStr] = part.split('-');
                const start = parseInt(startStr, 10);
                const end = parseInt(endStr, 10);
                if (!isNaN(start) && !isNaN(end)) {
                    const min = Math.max(1, Math.min(start, end));
                    const max = Math.min(totalPages, Math.max(start, end));
                    for (let p = min; p <= max; p++) pages.add(p);
                }
            } else {
                const p = parseInt(part, 10);
                if (!isNaN(p) && p >= 1 && p <= totalPages) {
                    pages.add(p);
                }
            }
        }
        return pages.size > 0 ? Array.from(pages).sort((a, b) => a - b) : [1];
    }
    return [1];
}

function clearFile() {
    if (searchablePdfUrl) {
        URL.revokeObjectURL(searchablePdfUrl);
        searchablePdfUrl = null;
    }
    searchablePdfBlob = null;
    pdfFile = null;
    pdfBuffer = null;
    pdfDocJs = null;
    totalPages = 0;
    extractedText = '';

    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('ocrOutput').value = '';
    document.getElementById('ocrResultSection').classList.add('hidden');
    document.getElementById('ocrThumbnailsGrid').innerHTML = '';
    hideStatus();
    hideProgress();
}

// ─── Execute OCR & Generate Searchable PDF ─────────────────────
async function runOCR() {
    if (!pdfFile || !pdfBuffer || !pdfDocJs) return;

    const targetPages = parsePageSelection();
    if (targetPages.length === 0) {
        alert('Silakan pilih minimal 1 halaman untuk dipindai.');
        return;
    }

    const lang = document.getElementById('ocrLang').value;
    const startBtn = document.getElementById('startOcrBtn');
    startBtn.disabled = true;

    // UI state
    document.getElementById('ocrResultSection').classList.add('hidden');
    hideStatus();
    showProgress(2, 'Memuat model kecerdasan buatan OCR (WebAssembly)...');

    try {
        // Load original PDF document with PDF-Lib
        const pdfDoc = await PDFLib.PDFDocument.load(pdfBuffer.slice(0));
        const helveticaFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

        let accumulatedText = '';
        const totalTarget = targetPages.length;

        for (let idx = 0; idx < totalTarget; idx++) {
            const pageNum = targetPages[idx];
            const baseProgress = Math.round(5 + (idx / totalTarget) * 85);
            showProgress(baseProgress, `Memindai teks halaman ${pageNum} (${idx + 1} dari ${totalTarget})...`);

            // Highlight thumbnail in UI
            const thumbCard = document.getElementById(`thumbCard_${pageNum}`);
            if (thumbCard) {
                thumbCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                thumbCard.classList.add('ocr-thumb-scanning');
            }

            // 1. High-DPI Rendering with PDF.js (scale 2.0 provides sharp OCR contrast)
            const pdfJsPage = await pdfDocJs.getPage(pageNum);
            const viewport = pdfJsPage.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await pdfJsPage.render({ canvasContext: ctx, viewport }).promise;

            // 2. Tesseract OCR with bounding box words
            const res = await Tesseract.recognize(canvas, lang, {
                logger: (m) => {
                    if (m.status === 'recognizing text') {
                        const stepPct = Math.round(baseProgress + (m.progress || 0) * (80 / totalTarget));
                        showProgress(Math.min(92, stepPct), `Memindai teks hal ${pageNum}: ${Math.round((m.progress || 0) * 100)}%`);
                    }
                }
            });

            // 3. Inject invisible text layer into the original PDF page
            const pdfLibPage = pdfDoc.getPage(pageNum - 1);
            const pdfWidth = pdfLibPage.getWidth();
            const pdfHeight = pdfLibPage.getHeight();

            const scaleX = pdfWidth / canvas.width;
            const scaleY = pdfHeight / canvas.height;

            const words = res.data.words || [];
            let pageText = '';

            for (const w of words) {
                const rawWord = (w.text || '').trim();
                if (!rawWord) continue;

                pageText += rawWord + ' ';

                // PDF-Lib standard font supports WinAnsiEncoding. Clean non-latin for drawText if needed
                const safeWord = rawWord.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');
                if (!safeWord.trim()) continue;

                // Canvas coordinates (origin top-left) to PDF coordinates (origin bottom-left)
                const pdfX = w.bbox.x0 * scaleX;
                const pdfY = pdfHeight - (w.bbox.y1 * scaleY);
                const wordHeight = (w.bbox.y1 - w.bbox.y0) * scaleY;
                const fontSize = Math.max(4, Math.min(72, wordHeight * 0.85));

                try {
                    pdfLibPage.drawText(safeWord, {
                        x: pdfX,
                        y: pdfY,
                        size: fontSize,
                        font: helveticaFont,
                        opacity: 0, // 100% transparent to the eye, but 100% searchable & selectable!
                    });
                } catch (drawErr) {
                    // Ignore rare unmappable glyph errors so process continues smoothly
                }
            }

            accumulatedText += `--- Halaman ${pageNum} ---\n` + (pageText.trim() || res.data.text || '') + '\n\n';

            if (thumbCard) {
                thumbCard.classList.remove('ocr-thumb-scanning');
                thumbCard.classList.add('ocr-thumb-done');
            }
        }

        // 4. Save the Searchable PDF
        showProgress(95, 'Menyusun dan mengompres file Searchable PDF...');
        const searchableBytes = await pdfDoc.save();

        if (searchablePdfUrl) URL.revokeObjectURL(searchablePdfUrl);
        searchablePdfBlob = new Blob([searchableBytes], { type: 'application/pdf' });
        searchablePdfUrl = URL.createObjectURL(searchablePdfBlob);
        extractedText = accumulatedText;

        document.getElementById('ocrOutput').value = extractedText;

        showProgress(100, 'Selesai!');
        setTimeout(() => {
            hideProgress();
            document.getElementById('ocrResultSection').classList.remove('hidden');
            document.getElementById('ocrResultSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 400);

    } catch (err) {
        console.error('Error saat proses OCR:', err);
        hideProgress();
        showStatus('❌ Gagal menerapkan OCR: ' + err.message, 'error');
    } finally {
        startBtn.disabled = false;
        // Clean up any pending scanner flags
        document.querySelectorAll('.ocr-thumb-scanning').forEach(el => el.classList.remove('ocr-thumb-scanning'));
    }
}

// ─── Download & Export Actions ──────────────────────────────────
function downloadSearchablePdf() {
    if (!searchablePdfBlob && !searchablePdfUrl) return;

    const baseName = (pdfFile?.name || 'dokumen').replace(/\.pdf$/i, '');
    const fileName = `${baseName}_searchable.pdf`;

    const a = document.createElement('a');
    a.href = searchablePdfUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function saveSearchablePdfToGDrive() {
    if (!searchablePdfBlob) {
        alert('File Searchable PDF belum siap.');
        return;
    }

    const gdriveBtn = document.getElementById('saveGDriveBtn');
    if (gdriveBtn) {
        gdriveBtn.disabled = true;
        gdriveBtn.innerHTML = `<span>⏳ Menyimpan ke Google Drive...</span>`;
    }

    const baseName = (pdfFile?.name || 'dokumen').replace(/\.pdf$/i, '');
    const fileName = `${baseName}_searchable.pdf`;

    try {
        await uploadBlobToGDrive({
            blob: searchablePdfBlob,
            filename: fileName,
            mimeType: 'application/pdf',
            onProgress: (pct, msg) => {
                showProgress(pct, msg);
            },
            onSuccess: (res) => {
                hideProgress();
                const folderInfo = res.folderName ? ` di folder <strong>"${res.folderName}"</strong>` : '';
                showStatus(`✅ Searchable PDF <strong>"${res.name}"</strong> berhasil disimpan ke Google Drive${folderInfo}! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka di Drive</a>`, 'success');
            },
            onError: (err) => {
                hideProgress();
                showStatus('❌ Gagal menyimpan ke Google Drive: ' + err.message, 'error');
            }
        });
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        if (gdriveBtn) {
            gdriveBtn.disabled = false;
            gdriveBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 87.3 78"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" fill="#00ac47"/><path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 10.15z" fill="#ea4335"/><path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="M59.8 53H87.3c0-1.55-.4-3.1-1.2-4.5l-25.4-44c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25z" fill="#2684fc"/><path d="M73.4 76.8H27.5L13.75 53h59.65c1.6 0 3.15.45 4.5 1.25.7.4 1.3.9 1.8 1.5z" fill="#ffba00"/></svg>
                <span>Simpan ke Google Drive</span>
            `;
        }
    }
}

function copyOcrText() {
    const text = document.getElementById('ocrOutput').value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        alert('✅ Teks berhasil disalin ke clipboard!');
    });
}

function downloadOcrTxt() {
    const text = document.getElementById('ocrOutput').value;
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (pdfFile?.name.replace(/\.pdf$/i, '') || 'ocr_result') + '_text.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function toggleTextExtractionPreview() {
    const body = document.getElementById('ocrTextBody');
    const arrow = document.getElementById('accordionArrow');
    if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        if (arrow) arrow.textContent = '▲';
    } else {
        body.classList.add('hidden');
        if (arrow) arrow.textContent = '▼';
    }
}

// ─── Status & Progress Utilities ───────────────────────────────
function showProgress(percent, text) {
    const sec = document.getElementById('progressSection');
    sec.classList.remove('hidden');
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('progressPercent').textContent = percent + '%';
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
