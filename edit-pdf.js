/** ============================================================
 *  edit-pdf.js — Visual PDF Annotation & Document Editor Controller
 * ============================================================ */

let pdfFile     = null;
let pdfDocJs    = null;
let currentPage = 1;
let totalPages  = 1;
let isDrawing   = false;
let isDrawMode  = false;

// Annotations stored per page: { [pageNum]: { elements: [], drawingsCanvas: null } }
let pageEdits = {};

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

    initDrawingHandlers();
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
    currentPage = 1;
    pageEdits = {};
    document.getElementById('docTitle').textContent = `📄 ${file.name}`;
    document.getElementById('outputName').value = file.name.replace(/\.pdf$/i, '') + '_edited';

    showProgress(15, 'Memuat dokumen PDF...');
    hideStatus();

    try {
        const arrayBuf = await file.arrayBuffer();
        pdfDocJs = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        totalPages = pdfDocJs.numPages;

        document.getElementById('docMeta').textContent = `${totalPages} Halaman · ${formatSize(file.size)}`;
        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');

        await renderCurrentPage();
        hideProgress();
    } catch (err) {
        hideProgress();
        alert('Gagal memuat PDF: ' + err.message);
    }
}

function clearFile() {
    pdfFile = null;
    pdfDocJs = null;
    pageEdits = {};
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    hideStatus();
    hideProgress();
}

async function renderCurrentPage() {
    if (!pdfDocJs) return;

    document.getElementById('pageNavText').textContent = `Hal ${currentPage} / ${totalPages}`;
    const page = await pdfDocJs.getPage(currentPage);
    const viewport = page.getViewport({ scale: 0.75 });

    const bgCanvas = document.getElementById('pdfBgCanvas');
    bgCanvas.width = viewport.width;
    bgCanvas.height = viewport.height;
    const bgCtx = bgCanvas.getContext('2d');
    await page.render({ canvasContext: bgCtx, viewport }).promise;

    const drawCanvas = document.getElementById('drawingCanvas');
    drawCanvas.width = viewport.width;
    drawCanvas.height = viewport.height;

    // Restore saved drawings for current page
    const drawCtx = drawCanvas.getContext('2d');
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    if (pageEdits[currentPage]?.drawingDataUrl) {
        const img = new Image();
        img.onload = () => drawCtx.drawImage(img, 0, 0);
        img.src = pageEdits[currentPage].drawingDataUrl;
    }

    // Restore DOM elements overlay
    const overlay = document.getElementById('annotationOverlay');
    overlay.style.width = viewport.width + 'px';
    overlay.style.height = viewport.height + 'px';
    overlay.innerHTML = '';

    if (pageEdits[currentPage]?.elements) {
        pageEdits[currentPage].elements.forEach(item => {
            renderOverlayElement(item);
        });
    }
}

function prevPage() {
    saveCurrentPageEdits();
    if (currentPage > 1) {
        currentPage--;
        renderCurrentPage();
    }
}

function nextPage() {
    saveCurrentPageEdits();
    if (currentPage < totalPages) {
        currentPage++;
        renderCurrentPage();
    }
}

function saveCurrentPageEdits() {
    const drawCanvas = document.getElementById('drawingCanvas');
    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [] };
    pageEdits[currentPage].drawingDataUrl = drawCanvas.toDataURL();
}

function clearCurrentPageAnnotations() {
    if (pageEdits[currentPage]) {
        pageEdits[currentPage] = { elements: [] };
    }
    const drawCanvas = document.getElementById('drawingCanvas');
    const ctx = drawCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    document.getElementById('annotationOverlay').innerHTML = '';
}

// ─── Drawing Pen Mode ──────────────────────────────────────────
function toggleDrawingMode() {
    isDrawMode = !isDrawMode;
    const drawCanvas = document.getElementById('drawingCanvas');
    const status = document.getElementById('drawStatus');
    const btn = document.getElementById('drawBtn');

    if (isDrawMode) {
        drawCanvas.style.pointerEvents = 'auto';
        drawCanvas.style.cursor = 'crosshair';
        status.textContent = 'ON';
        btn.classList.add('btn-primary');
    } else {
        drawCanvas.style.pointerEvents = 'none';
        drawCanvas.style.cursor = 'default';
        status.textContent = 'OFF';
        btn.classList.remove('btn-primary');
    }
}

function initDrawingHandlers() {
    const drawCanvas = document.getElementById('drawingCanvas');
    const ctx = drawCanvas.getContext('2d');
    let lastX = 0, lastY = 0;

    drawCanvas.addEventListener('mousedown', (e) => {
        if (!isDrawMode) return;
        isDrawing = true;
        const rect = drawCanvas.getBoundingClientRect();
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
    });

    drawCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawing || !isDrawMode) return;
        const rect = drawCanvas.getBoundingClientRect();
        const curX = e.clientX - rect.left;
        const curY = e.clientY - rect.top;

        ctx.strokeStyle = '#ef4444'; // Red pen
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(curX, curY);
        ctx.stroke();

        lastX = curX;
        lastY = curY;
    });

    document.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            saveCurrentPageEdits();
        }
    });
}

// ─── Add Text Annotation ───────────────────────────────────────
function addTextAnnotation() {
    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [] };
    const textItem = {
        id: 'text_' + Date.now(),
        type: 'text',
        content: 'Ketik teks di sini...',
        x: 40,
        y: 40,
        fontSize: 16,
        color: '#1e293b',
    };
    pageEdits[currentPage].elements.push(textItem);
    renderOverlayElement(textItem);
}

// ─── Add Image/Stamp Annotation ────────────────────────────────
function addImageAnnotation(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [] };
        const imgItem = {
            id: 'img_' + Date.now(),
            type: 'image',
            dataUrl: e.target.result,
            x: 50,
            y: 50,
            width: 140,
            height: 90,
        };
        pageEdits[currentPage].elements.push(imgItem);
        renderOverlayElement(imgItem);
    };
    reader.readAsDataURL(file);
}

// ─── Add Highlight Box ─────────────────────────────────────────
function addHighlightBox() {
    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [] };
    const hlItem = {
        id: 'hl_' + Date.now(),
        type: 'highlight',
        x: 40,
        y: 40,
        width: 180,
        height: 30,
        color: 'rgba(250, 204, 21, 0.45)', // Yellow highlight
    };
    pageEdits[currentPage].elements.push(hlItem);
    renderOverlayElement(hlItem);
}

function renderOverlayElement(item) {
    const overlay = document.getElementById('annotationOverlay');
    const el = document.createElement('div');
    el.id = item.id;
    el.style.position = 'absolute';
    el.style.left = item.x + 'px';
    el.style.top = item.y + 'px';
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'move';
    el.style.userSelect = 'none';

    if (item.type === 'text') {
        el.style.border = '1px dashed #6366f1';
        el.style.padding = '4px 8px';
        el.style.background = 'rgba(255, 255, 255, 0.85)';
        el.style.borderRadius = '4px';
        el.innerHTML = `
            <div contenteditable="true" style="font-size: ${item.fontSize}px; color: ${item.color}; font-weight: 600; outline: none;" oninput="updateTextContent('${item.id}', this.innerText)">${item.content}</div>
        `;
    } else if (item.type === 'image') {
        el.style.border = '1.5px dashed #6366f1';
        el.style.borderRadius = '4px';
        el.style.width = item.width + 'px';
        el.style.height = item.height + 'px';
        el.innerHTML = `<img src="${item.dataUrl}" style="width: 100%; height: 100%; object-fit: contain; pointer-events: none;">`;
    } else if (item.type === 'highlight') {
        el.style.width = item.width + 'px';
        el.style.height = item.height + 'px';
        el.style.background = item.color;
        el.style.border = '1px dashed #eab308';
        el.style.borderRadius = '3px';
    }

    makeDraggable(el, item);
    overlay.appendChild(el);
}

function updateTextContent(id, text) {
    const item = (pageEdits[currentPage]?.elements || []).find(e => e.id === id);
    if (item) item.content = text;
}

function makeDraggable(el, item) {
    let startX = 0, startY = 0;
    let initialX = item.x, initialY = item.y;
    let isMoving = false;

    el.addEventListener('mousedown', (e) => {
        if (e.target.isContentEditable) return;
        isMoving = true;
        startX = e.clientX;
        startY = e.clientY;
        initialX = item.x;
        initialY = item.y;
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isMoving) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        item.x = Math.max(0, initialX + dx);
        item.y = Math.max(0, initialY + dy);
        el.style.left = item.x + 'px';
        el.style.top = item.y + 'px';
    });

    document.addEventListener('mouseup', () => { isMoving = false; });
}

// ─── Save & Download Edited PDF ────────────────────────────────
async function saveEditedPDF() {
    if (!pdfFile || !pdfDocJs) return;
    saveCurrentPageEdits();

    const rawName = document.getElementById('outputName').value.trim() || 'edited_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;

    showProgress(20, 'Merender perubahan pada dokumen PDF...');

    try {
        const { PDFDocument } = PDFLib;
        const newPdfDoc = await PDFDocument.create();

        for (let i = 1; i <= totalPages; i++) {
            const pct = Math.round(20 + (i / totalPages) * 70);
            showProgress(pct, `Menyimpan lembar ${i} dari ${totalPages}...`);

            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });

            // Create temporary canvas
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');

            // 1. Render PDF original
            await page.render({ canvasContext: ctx, viewport }).promise;

            // 2. Render user annotations if any for this page
            const edits = pageEdits[i];
            if (edits) {
                // Render drawings
                if (edits.drawingDataUrl) {
                    const drawImg = await new Promise((res) => {
                        const img = new Image();
                        img.onload = () => res(img);
                        img.src = edits.drawingDataUrl;
                    });
                    ctx.drawImage(drawImg, 0, 0, canvas.width, canvas.height);
                }

                // Render elements (scale 2.0 / 0.75 = 2.6667)
                const scaleFactor = 2.0 / 0.75;
                for (const el of (edits.elements || [])) {
                    if (el.type === 'text') {
                        ctx.font = `bold ${Math.round(el.fontSize * scaleFactor)}px Arial, sans-serif`;
                        ctx.fillStyle = el.color;
                        ctx.fillText(el.content, el.x * scaleFactor + 8, (el.y + 18) * scaleFactor);
                    } else if (el.type === 'highlight') {
                        ctx.fillStyle = el.color;
                        ctx.fillRect(el.x * scaleFactor, el.y * scaleFactor, el.width * scaleFactor, el.height * scaleFactor);
                    } else if (el.type === 'image') {
                        const img = await new Promise((res) => {
                            const image = new Image();
                            image.onload = () => res(image);
                            image.src = el.dataUrl;
                        });
                        ctx.drawImage(img, el.x * scaleFactor, el.y * scaleFactor, el.width * scaleFactor, el.height * scaleFactor);
                    }
                }
            }

            // Convert canvas to JPG and embed
            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
            const imgBytes = new Uint8Array(await blob.arrayBuffer());
            const embedded = await newPdfDoc.embedJpg(imgBytes);

            const origVp = page.getViewport({ scale: 1.0 });
            const newPage = newPdfDoc.addPage([origVp.width, origVp.height]);
            newPage.drawImage(embedded, { x: 0, y: 0, width: origVp.width, height: origVp.height });
        }

        showProgress(95, 'Menyimpan dokumen PDF...');
        const pdfBytes = await newPdfDoc.save();
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
        showStatus(`✅ Berhasil! Dokumen PDF yang diedit telah diunduh sebagai "${outputName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error saat menyimpan edit: ' + err.message, 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

// ─── Save Edited PDF to Google Drive ───────────────────────────
async function saveEditedToGDrive() {
    if (!pdfFile || !pdfDocJs) return;
    saveCurrentPageEdits();

    const rawName = document.getElementById('outputName').value.trim() || 'edited_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const saveBtn = document.getElementById('saveBtn');
    const gdriveBtn = document.getElementById('saveGDriveBtn');
    saveBtn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(20, 'Merender perubahan pada dokumen PDF...');

    try {
        const { PDFDocument } = PDFLib;
        const newPdfDoc = await PDFDocument.create();

        for (let i = 1; i <= totalPages; i++) {
            const pct = Math.round(20 + (i / totalPages) * 60);
            showProgress(pct, `Menyiapkan lembar ${i} dari ${totalPages}...`);

            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');

            await page.render({ canvasContext: ctx, viewport }).promise;

            const edits = pageEdits[i];
            if (edits) {
                if (edits.drawingDataUrl) {
                    const drawImg = await new Promise((res) => {
                        const img = new Image();
                        img.onload = () => res(img);
                        img.src = edits.drawingDataUrl;
                    });
                    ctx.drawImage(drawImg, 0, 0, canvas.width, canvas.height);
                }

                const scaleFactor = 2.0 / 0.75;
                for (const el of (edits.elements || [])) {
                    if (el.type === 'text') {
                        ctx.font = `bold ${Math.round(el.fontSize * scaleFactor)}px Arial, sans-serif`;
                        ctx.fillStyle = el.color;
                        ctx.fillText(el.content, el.x * scaleFactor + 8, (el.y + 18) * scaleFactor);
                    } else if (el.type === 'highlight') {
                        ctx.fillStyle = el.color;
                        ctx.fillRect(el.x * scaleFactor, el.y * scaleFactor, el.width * scaleFactor, el.height * scaleFactor);
                    } else if (el.type === 'image') {
                        const img = await new Promise((res) => {
                            const image = new Image();
                            image.onload = () => res(image);
                            image.src = el.dataUrl;
                        });
                        ctx.drawImage(img, el.x * scaleFactor, el.y * scaleFactor, el.width * scaleFactor, el.height * scaleFactor);
                    }
                }
            }

            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
            const imgBytes = new Uint8Array(await blob.arrayBuffer());
            const embedded = await newPdfDoc.embedJpg(imgBytes);

            const origVp = page.getViewport({ scale: 1.0 });
            const newPage = newPdfDoc.addPage([origVp.width, origVp.height]);
            newPage.drawImage(embedded, { x: 0, y: 0, width: origVp.width, height: origVp.height });
        }

        showProgress(85, 'Menyimpan dokumen PDF...');
        const pdfBytes = await newPdfDoc.save();
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
