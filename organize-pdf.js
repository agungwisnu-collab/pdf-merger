/** ============================================================
 *  organize-pdf.js — Visual Page Organizer, Rotator & Deleter
 *  Libraries: pdf-lib (copyPages & rotation), PDF.js (rendering)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfFile     = null;
let pdfDocJs    = null;
let originalPages = [];
let pages       = []; // array of { origIndex: number, thumbUrl: string, rotation: number }
let dragSrcIndex = null;

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
        const total = pdfDocJs.numPages;

        document.getElementById('docTitle').textContent = `📄 ${file.name}`;
        document.getElementById('docMeta').textContent = `${total} Halaman · ${formatSize(file.size)}`;

        pages = [];
        for (let i = 1; i <= total; i++) {
            const pct = Math.round(20 + (i / total) * 70);
            showProgress(pct, `Membuat pratinjau halaman ${i} dari ${total}...`);

            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale: 0.35 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

            pages.push({
                origIndex: i - 1,
                thumbUrl: canvas.toDataURL('image/jpeg', 0.8),
                rotation: 0,
            });
        }

        originalPages = JSON.parse(JSON.stringify(pages));

        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');

        renderOrganizeGrid();
        hideProgress();
    } catch (err) {
        hideProgress();
        alert('Gagal memuat PDF: ' + err.message);
    }
}

function clearFile() {
    pdfFile = null;
    pdfDocJs = null;
    pages = [];
    originalPages = [];
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('organizeGrid').innerHTML = '';
    hideStatus();
    hideProgress();
}

// ─── Render Organize Grid ──────────────────────────────────────
function renderOrganizeGrid() {
    const grid = document.getElementById('organizeGrid');
    document.getElementById('docMeta').textContent = `${pages.length} Halaman aktif`;

    if (pages.length === 0) {
        grid.innerHTML = '<p class="placeholder-text">Semua halaman telah dihapus. Klik "Reset Susunan Asli" untuk mengembalikan.</p>';
        document.getElementById('savePdfBtn').disabled = true;
        return;
    }

    document.getElementById('savePdfBtn').disabled = false;

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
                <img src="${item.thumbUrl}" class="doc-page-thumb" style="transform: rotate(${item.rotation}deg);" alt="Hal ${index + 1}">
            </div>
            <div class="doc-page-footer">
                <span>#${index + 1}</span>
                <div class="doc-page-actions">
                    <button class="doc-mini-btn" onclick="rotatePage(${index})" title="Putar 90°">🔄</button>
                    <button class="doc-mini-btn" onclick="duplicatePage(${index})" title="Duplikat Halaman">📑</button>
                    <button class="doc-mini-btn del-btn" onclick="deletePage(${index})" title="Hapus Halaman">🗑️</button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// ─── Page Actions ──────────────────────────────────────────────
function rotatePage(index) {
    if (!pages[index]) return;
    pages[index].rotation = (pages[index].rotation + 90) % 360;
    renderOrganizeGrid();
}

function rotateAllPages(deg) {
    pages.forEach(p => {
        p.rotation = (p.rotation + deg) % 360;
    });
    renderOrganizeGrid();
}

function duplicatePage(index) {
    if (!pages[index]) return;
    const clone = { ...pages[index] };
    pages.splice(index + 1, 0, clone);
    renderOrganizeGrid();
}

function deletePage(index) {
    pages.splice(index, 1);
    renderOrganizeGrid();
}

function resetAllChanges() {
    pages = JSON.parse(JSON.stringify(originalPages));
    renderOrganizeGrid();
}

// ─── Drag-to-Reorder ──────────────────────────────────────────
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
    if (card.dataset.index !== undefined) card.classList.add('drag-over');
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

// ─── Save & Download Organized PDF ─────────────────────────────
async function saveOrganizedPDF() {
    if (!pdfFile || pages.length === 0) return;

    const rawName = document.getElementById('outputName').value.trim() || 'organized_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const saveBtn = document.getElementById('savePdfBtn');
    saveBtn.disabled = true;

    showProgress(10, 'Menyusun dokumen PDF baru...');

    try {
        const { PDFDocument, degrees } = PDFLib;
        const arrayBuf = await pdfFile.arrayBuffer();
        const srcDoc = await PDFDocument.load(arrayBuf);
        const newDoc = await PDFDocument.create();

        for (let i = 0; i < pages.length; i++) {
            const item = pages[i];
            const pct = Math.round(10 + (i / pages.length) * 75);
            showProgress(pct, `Menyalin lembar #${i + 1}...`);

            const [copiedPage] = await newDoc.copyPages(srcDoc, [item.origIndex]);
            if (item.rotation !== 0) {
                const currentRot = copiedPage.getRotation().angle;
                copiedPage.setRotation(degrees((currentRot + item.rotation) % 360));
            }
            newDoc.addPage(copiedPage);
        }

        showProgress(90, 'Menyimpan dokumen PDF...');
        const pdfBytes = await newDoc.save();
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
        showStatus(`✅ Berhasil! Dokumen baru dengan ${pages.length} halaman tersimpan sebagai "${outputName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error: ' + err.message, 'error');
    } finally {
        saveBtn.disabled = false;
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
    box.textContent = msg;
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
