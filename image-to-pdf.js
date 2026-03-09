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

const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp',
                        'image/gif', 'image/bmp', 'image/svg+xml'];

/**
 * imageItems: array of {
 *   file      : File,
 *   thumbnail : string | null,  // data URL
 *   width     : number,
 *   height    : number,
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

// ─── Load Image Item ───────────────────────────────────────────
async function loadImageItem(file) {
    const item = { file, thumbnail: null, width: 0, height: 0 };
    imageItems.push(item);
    renderImageList(); // render placeholder immediately

    await new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            item.width  = img.naturalWidth;
            item.height = img.naturalHeight;

            // Generate thumbnail via canvas
            const maxW  = 44, maxH = 58;
            const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width  = Math.round(img.naturalWidth  * ratio);
            canvas.height = Math.round(img.naturalHeight * ratio);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            item.thumbnail = canvas.toDataURL('image/jpeg', 0.75);

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

// ─── Render File List ──────────────────────────────────────────
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

    list.innerHTML = imageItems.map((item, index) => {
        const thumb = item.thumbnail
            ? `<img src="${item.thumbnail}" class="pdf-thumb" alt="preview">`
            : `<div class="pdf-thumb pdf-thumb-placeholder">⏳</div>`;

        const dimsLabel = item.width > 0
            ? `${item.width}×${item.height}`
            : 'Memuat...';

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
                    <span class="page-badge">${dimsLabel}</span>
                </div>
            </div>
            <button class="remove-btn" onclick="removeImage(${index})" title="Hapus">✕</button>
        </li>`;
    }).join('');
}

// ─── Drag-to-Reorder ──────────────────────────────────────────
function onDragStart(e, index) {
    dragSrcIndex = index;
    setTimeout(() => {
        document.querySelectorAll('#fileList li[data-index]').forEach(li => {
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
    const moved = imageItems.splice(dragSrcIndex, 1)[0];
    imageItems.splice(targetIndex, 0, moved);
    dragSrcIndex = null;
    renderImageList();
}

function onDragEnd() {
    document.querySelectorAll('#fileList li').forEach(li => {
        li.classList.remove('dragging', 'drag-over');
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

// ─── Get Embeddable Image Data ─────────────────────────────────
// JPEG → embed directly; PNG → embed directly; others → convert to PNG via canvas
async function getImageEmbedData(file) {
    const mime = file.type;

    if (mime === 'image/jpeg' || mime === 'image/jpg') {
        return { bytes: new Uint8Array(await file.arrayBuffer()), type: 'jpeg' };
    }
    if (mime === 'image/png') {
        return { bytes: new Uint8Array(await file.arrayBuffer()), type: 'png' };
    }

    // WebP, GIF, BMP, SVG, etc. → draw to canvas → export as PNG
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width  = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d').drawImage(img, 0, 0);
            URL.revokeObjectURL(url);

            canvas.toBlob(async (blob) => {
                if (!blob) {
                    reject(new Error(`Gagal mengkonversi: ${file.name}`));
                    return;
                }
                resolve({ bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' });
            }, 'image/png');
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Gagal memuat gambar: ${file.name}`));
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
    showProgress(0, 'Memulai proses...');
    hideStatus();

    try {
        const { PDFDocument } = PDFLib;
        const pdfDoc = await PDFDocument.create();
        const total  = imageItems.length;

        for (let i = 0; i < total; i++) {
            const item = imageItems[i];
            const pct  = Math.round((i / total) * 90);
            showProgress(pct, `Memproses: ${item.file.name} (${i + 1}/${total})`);

            const embedData = await getImageEmbedData(item.file);

            const embeddedImg = embedData.type === 'jpeg'
                ? await pdfDoc.embedJpg(embedData.bytes)
                : await pdfDoc.embedPng(embedData.bytes);

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
            // Center horizontally and vertically (pdf-lib Y origin is bottom-left)
            const drawX = margin + (availW - drawW) / 2;
            const drawY = margin + (availH - drawH) / 2;

            page.drawImage(embeddedImg, { x: drawX, y: drawY, width: drawW, height: drawH });
        }

        showProgress(95, 'Menyimpan file...');

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
        convertBtn.disabled = imageItems.length === 0;
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
