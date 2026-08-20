/** ============================================================
 *  ocr-pdf.js — PDF OCR Text Recognition Controller
 *  Libraries: Tesseract.js (AI OCR), PDF.js (rendering)
 * ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let pdfFile     = null;
let pdfDocJs    = null;
let totalPages  = 0;

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

        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');
        document.getElementById('ocrResultWrap').classList.add('hidden');

        hideProgress();
    } catch (err) {
        hideProgress();
        alert('Gagal memuat PDF: ' + err.message);
    }
}

function clearFile() {
    pdfFile = null;
    pdfDocJs = null;
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('ocrOutput').value = '';
    document.getElementById('ocrResultWrap').classList.add('hidden');
    hideStatus();
    hideProgress();
}

// ─── Run OCR ───────────────────────────────────────────────────
async function runOCR() {
    if (!pdfFile || !pdfDocJs) return;

    const lang = document.getElementById('ocrLang').value;
    const pageScope = document.getElementById('ocrPages').value;
    const maxPages = (pageScope === 'first') ? 1 : totalPages;

    const btn = document.getElementById('startOcrBtn');
    btn.disabled = true;
    const outputEl = document.getElementById('ocrOutput');
    outputEl.value = '';
    document.getElementById('ocrResultWrap').classList.remove('hidden');

    showProgress(5, 'Memuat model kecerdasan buatan OCR (WebAssembly)...');

    try {
        let fullText = '';

        for (let i = 1; i <= maxPages; i++) {
            const pct = Math.round(5 + (i / maxPages) * 90);
            showProgress(pct, `Memindai teks halaman ${i} dari ${maxPages}...`);

            const page = await pdfDocJs.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // High DPI for OCR accuracy
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: ctx, viewport }).promise;

            const { data } = await Tesseract.recognize(canvas, lang, {
                logger: (m) => {
                    if (m.status === 'recognizing text') {
                        const subPct = Math.round(pct + (m.progress || 0) * (90 / maxPages));
                        showProgress(subPct, `Memindai teks hal ${i}: ${Math.round((m.progress || 0) * 100)}%`);
                    }
                },
            });

            fullText += `--- Halaman ${i} ---\n` + (data.text || '').trim() + '\n\n';
            outputEl.value = fullText;
        }

        showProgress(100, 'Selesai!');
        showStatus(`✅ Berhasil! Teks dari ${maxPages} halaman berhasil diekstrak.`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error OCR: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
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
