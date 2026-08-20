/** ============================================================
 *  Image to PDF — image-to-pdf.js
 *  Library: pdf-lib (embed & create PDF)
 * ============================================================ */

// Page sizes in points (1 inch = 72 pts)
const PAGE_SIZES = {
    'fit':              null,
    'a4-portrait':      [595.28, 841.89],
    'a4-landscape':     [841.89, 595.28],
    'letter-portrait':  [612, 792],
    'letter-landscape': [792, 612],
};

/**
 * imageItems: array of {
 *   file      : File,
 *   thumbnail : string | null,  // data URL
 *   width     : number,
 *   height    : number,
 *   rotation  : number,         // 0, 90, 180, 270
 * }
 */
let imageItems   = [];
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
    const files = Array.from(e.dataTransfer.files)
        .filter(f => f.type.startsWith('image/'));
    if (files.length) handleFiles(files);
});

// ─── Handle New Files ──────────────────────────────────────────
function handleFiles(files) {
    const imgOnly = files.filter(f => f.type.startsWith('image/'));
    if (imgOnly.length !== files.length) {
        showStatus('⚠️ Beberapa file diabaikan karena bukan gambar.', 'error');
    }
    if (imgOnly.length === 0) return;
    imgOnly.forEach(file => loadImageItem(file));
}

// ─── Google Drive Picker ───────────────────────────────────────
function pickFromGDrive() {
    openGDrivePicker({
        mimeTypes: ['image/*'],
        multiSelect: true,
        onFilesSelected: (files) => {
            handleFiles(files);
        },
    });
}

// ─── Load Image Item ───────────────────────────────────────────
async function loadImageItem(file) {
    const item = { file, thumbnail: null, width: 0, height: 0, rotation: 0 };
    imageItems.push(item);
    renderImageList();

    await new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            item.width  = img.naturalWidth;
            item.height = img.naturalHeight;

            // Generate thumbnail via canvas
            const maxW  = 160, maxH = 160;
            const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width  = Math.round(img.naturalWidth  * ratio);
            canvas.height = Math.round(img.naturalHeight * ratio);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            item.thumbnail = canvas.toDataURL('image/jpeg', 0.85);

            URL.revokeObjectURL(url);
            resolve();
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve();
        };

        img.src = url;
    });

    renderImageList();
}

// ─── Render Image Grid Gallery ─────────────────────────────────
function renderImageList() {
    const list            = document.getElementById('fileList');
    const convertBtn      = document.getElementById('convertBtn');
    const fileSection     = document.getElementById('fileSection');
    const fileCount       = document.getElementById('fileCount');
    const settingsSection = document.getElementById('settingsSection');

    if (imageItems.length === 0) {
        fileSection.classList.add('hidden');
        settingsSection.classList.add('hidden');
        convertBtn.disabled = true;
        return;
    }

    fileSection.classList.remove('hidden');
    settingsSection.classList.remove('hidden');
    fileCount.textContent = imageItems.length;
    convertBtn.disabled   = false;

    list.className = 'image-grid';
    list.innerHTML = imageItems.map((item, index) => {
        const thumb = item.thumbnail
            ? `<img src="${item.thumbnail}" class="image-card-thumb" style="transform: rotate(${item.rotation}deg);" alt="preview">`
            : `<div style="font-size: 1.5rem;">⏳</div>`;

        // Calculate visual dimensions factoring in rotation
        const isRotated90or270 = item.rotation === 90 || item.rotation === 270;
        const displayW = isRotated90or270 ? item.height : item.width;
        const displayH = isRotated90or270 ? item.width : item.height;
        const dimsLabel = item.width > 0 ? `${displayW} × ${displayH} px` : 'Memuat...';

        return `
        <div
            class="image-card"
            draggable="true"
            data-index="${index}"
            ondragstart="onDragStart(event, ${index})"
            ondragover="onDragOver(event)"
            ondrop="onDropItem(event, ${index})"
            ondragend="onDragEnd()"
        >
            <span class="image-badge-num">#${index + 1}</span>
            <div class="image-card-thumb-wrap">
                ${thumb}
            </div>
            <div class="image-card-info">
                <div class="image-card-name" title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</div>
                <div class="image-card-meta">${formatSize(item.file.size)} · ${dimsLabel}</div>
            </div>
            <div class="image-card-actions">
                <button class="image-btn-action" onclick="rotateImage(${index})" title="Putar 90 derajat searah jarum jam">
                    🔄 Putar
                </button>
                <button class="image-btn-action delete-action" onclick="removeImage(${index})" title="Hapus gambar ini">
                    🗑️ Hapus
                </button>
            </div>
        </div>`;
    }).join('');
}

// ─── Rotate Image ──────────────────────────────────────────────
function rotateImage(index) {
    if (!imageItems[index]) return;
    imageItems[index].rotation = (imageItems[index].rotation + 90) % 360;
    renderImageList();
}

// ─── Drag-to-Reorder ──────────────────────────────────────────
function onDragStart(e, index) {
    dragSrcIndex = index;
    setTimeout(() => {
        document.querySelectorAll('.image-card[data-index]').forEach(card => {
            if (parseInt(card.dataset.index) === index) card.classList.add('dragging');
        });
    }, 0);
}

function onDragOver(e) {
    e.preventDefault();
    document.querySelectorAll('.image-card[data-index]').forEach(card => card.classList.remove('drag-over'));
    const card = e.currentTarget;
    if (card.dataset.index !== undefined) card.classList.add('drag-over');
}

function onDropItem(e, targetIndex) {
    e.preventDefault();
    if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;
    const moved = imageItems.splice(dragSrcIndex, 1)[0];
    imageItems.splice(targetIndex, 0, moved);
    dragSrcIndex = null;
    renderImageList();
}

function onDragEnd() {
    document.querySelectorAll('.image-card').forEach(card => {
        card.classList.remove('dragging', 'drag-over');
    });
    dragSrcIndex = null;
}

// ─── Remove / Clear ────────────────────────────────────────────
function removeImage(index) {
    imageItems.splice(index, 1);
    renderImageList();
}

function clearAll() {
    imageItems = [];
    renderImageList();
    hideStatus();
    hideProgress();
}

// ─── Get Processed & Rotated Image Data for PDF ────────────────
async function getProcessedImageBytes(item) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(item.file);

        img.onload = () => {
            const rot = item.rotation % 360;
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (rot === 90 || rot === 270) {
                canvas.width  = img.naturalHeight;
                canvas.height = img.naturalWidth;
            } else {
                canvas.width  = img.naturalWidth;
                canvas.height = img.naturalHeight;
            }

            ctx.save();
            if (rot === 90) {
                ctx.translate(canvas.width, 0);
                ctx.rotate((90 * Math.PI) / 180);
            } else if (rot === 180) {
                ctx.translate(canvas.width, canvas.height);
                ctx.rotate((180 * Math.PI) / 180);
            } else if (rot === 270) {
                ctx.translate(0, canvas.height);
                ctx.rotate((270 * Math.PI) / 180);
            }

            ctx.drawImage(img, 0, 0);
            ctx.restore();
            URL.revokeObjectURL(url);

            // Export as JPEG if original is JPEG and no transparency, else PNG
            const isJpeg = item.file.type === 'image/jpeg' || item.file.type === 'image/jpg';
            const format = isJpeg ? 'image/jpeg' : 'image/png';
            const quality = isJpeg ? 0.92 : undefined;

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    reject(new Error(`Gagal memproses gambar: ${item.file.name}`));
                    return;
                }
                const bytes = new Uint8Array(await blob.arrayBuffer());
                resolve({ bytes, type: isJpeg ? 'jpeg' : 'png', width: canvas.width, height: canvas.height });
            }, format, quality);
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Gagal memuat file: ${item.file.name}`));
        };

        img.src = url;
    });
}

// ─── Convert Images to PDF ─────────────────────────────────────
async function convertToPDF() {
    if (imageItems.length === 0) return;

    const pageSizeKey = document.getElementById('pageSize').value;
    const fitMode     = document.getElementById('fitMode').value;
    const rawName     = document.getElementById('outputName').value.trim();
    const outputName  = (rawName || 'images_to_pdf').replace(/\.pdf$/i, '') + '.pdf';
    const MARGIN      = 20; // points, used for fixed page sizes

    const convertBtn = document.getElementById('convertBtn');
    convertBtn.disabled = true;
    showProgress(0, 'Memulai konversi...');
    hideStatus();

    try {
        const { PDFDocument } = PDFLib;
        const pdfDoc = await PDFDocument.create();
        const total  = imageItems.length;

        for (let i = 0; i < total; i++) {
            const item = imageItems[i];
            const pct  = Math.round((i / total) * 90);
            showProgress(pct, `Memproses lembar #${i + 1}: ${item.file.name}...`);

            const processed = await getProcessedImageBytes(item);

            const embeddedImg = processed.type === 'jpeg'
                ? await pdfDoc.embedJpg(processed.bytes)
                : await pdfDoc.embedPng(processed.bytes);

            const imgW = embeddedImg.width;
            const imgH = embeddedImg.height;

            // Determine page dimensions
            let pageW, pageH;
            if (pageSizeKey === 'fit') {
                pageW = imgW;
                pageH = imgH;
            } else {
                [pageW, pageH] = PAGE_SIZES[pageSizeKey];
            }

            const page = pdfDoc.addPage([pageW, pageH]);

            // Calculate draw rect to fit/fill within available area
            const margin  = pageSizeKey === 'fit' ? 0 : MARGIN;
            const availW  = pageW - margin * 2;
            const availH  = pageH - margin * 2;

            let scale;
            if (fitMode === 'fill' && pageSizeKey !== 'fit') {
                scale = Math.max(availW / imgW, availH / imgH);
            } else {
                scale = Math.min(availW / imgW, availH / imgH);
            }

            const drawW = imgW * scale;
            const drawH = imgH * scale;
            // Center horizontally and vertically (pdf-lib origin is bottom-left)
            const drawX = margin + (availW - drawW) / 2;
            const drawY = margin + (availH - drawH) / 2;

            page.drawImage(embeddedImg, { x: drawX, y: drawY, width: drawW, height: drawH });
        }

        showProgress(95, 'Menyimpan dokumen PDF...');

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
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
            `✅ Berhasil! "${outputName}" — ${total} gambar dikonversi menjadi PDF. Download dimulai.`,
            'success'
        );

    } catch (error) {
        hideProgress();
        showStatus('❌ Error: ' + error.message, 'error');
    } finally {
        const isReady = imageItems.length > 0;
        convertBtn.disabled = !isReady;
        const gdriveBtn = document.getElementById('convertGDriveBtn');
        if (gdriveBtn) gdriveBtn.disabled = !isReady;
    }
}

// ─── Convert Images & Save to Google Drive ─────────────────────
async function convertAndSaveToGDrive() {
    if (imageItems.length === 0) return;

    const pageSizeKey = document.getElementById('pageSize').value;
    const fitMode     = document.getElementById('fitMode').value;
    const rawName     = document.getElementById('outputName').value.trim();
    const outputName  = (rawName || 'images_to_pdf').replace(/\.pdf$/i, '') + '.pdf';
    const MARGIN      = 20;

    const convertBtn  = document.getElementById('convertBtn');
    const gdriveBtn   = document.getElementById('convertGDriveBtn');
    convertBtn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(0, 'Menyiapkan konversi gambar...');
    hideStatus();

    try {
        const { PDFDocument } = PDFLib;
        const pdfDoc = await PDFDocument.create();
        const total  = imageItems.length;

        for (let i = 0; i < total; i++) {
            const item = imageItems[i];
            const pct  = Math.round((i / total) * 70);
            showProgress(pct, `Memproses lembar #${i + 1}: ${item.file.name}...`);

            const processed = await getProcessedImageBytes(item);

            const embeddedImg = processed.type === 'jpeg'
                ? await pdfDoc.embedJpg(processed.bytes)
                : await pdfDoc.embedPng(processed.bytes);

            const imgW = embeddedImg.width;
            const imgH = embeddedImg.height;

            let pageW, pageH;
            if (pageSizeKey === 'fit') {
                pageW = imgW;
                pageH = imgH;
            } else {
                [pageW, pageH] = PAGE_SIZES[pageSizeKey];
            }

            const page = pdfDoc.addPage([pageW, pageH]);
            const margin  = pageSizeKey === 'fit' ? 0 : MARGIN;
            const availW  = pageW - margin * 2;
            const availH  = pageH - margin * 2;

            let scale;
            if (fitMode === 'fill' && pageSizeKey !== 'fit') {
                scale = Math.max(availW / imgW, availH / imgH);
            } else {
                scale = Math.min(availW / imgW, availH / imgH);
            }

            const drawW = imgW * scale;
            const drawH = imgH * scale;
            const drawX = margin + (availW - drawW) / 2;
            const drawY = margin + (availH - drawH) / 2;

            page.drawImage(embeddedImg, { x: drawX, y: drawY, width: drawW, height: drawH });
        }

        showProgress(75, 'Menyimpan dokumen PDF...');
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });

        uploadBlobToGDrive({
            blob,
            filename: outputName,
            mimeType: 'application/pdf',
            onProgress: (p, text) => showProgress(p, text),
            onSuccess: (res) => {
                showProgress(100, 'Selesai!');
                showStatus(
                    `✅ File PDF <strong>"${res.name}"</strong> berhasil disimpan di Google Drive Anda! <a href="${res.webViewLink}" target="_blank" rel="noopener" style="color: var(--primary); text-decoration: underline; margin-left: 8px; font-weight: 700;">🔗 Buka File di Google Drive</a>`,
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
        const isReady = imageItems.length > 0;
        convertBtn.disabled = !isReady;
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
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
