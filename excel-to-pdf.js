/** ============================================================
 *  excel-to-pdf.js — Excel Spreadsheet to PDF Converter Controller
 * ============================================================ */

let excelFile = null;
let workbook  = null;

document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadSection');
    const fileInput  = document.getElementById('excelInput');

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
});

function pickExcelFromGDrive() {
    openGDrivePicker({
        mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'],
        multiSelect: false,
        onFilesSelected: (files) => {
            if (files.length > 0) handleFileSelect(files[0]);
        },
    });
}

async function handleFileSelect(file) {
    excelFile = file;
    document.getElementById('docTitle').textContent = `📊 ${file.name}`;
    document.getElementById('docMeta').textContent = `Ukuran: ${formatSize(file.size)}`;
    document.getElementById('outputName').value = file.name.replace(/\.(xlsx|xls|csv)$/i, '');

    showProgress(25, 'Membaca spreadsheet Excel...');
    hideStatus();

    try {
        const arrayBuf = await file.arrayBuffer();
        workbook = XLSX.read(arrayBuf, { type: 'array' });

        // Populate sheets dropdown
        const sheetSelect = document.getElementById('sheetSelect');
        sheetSelect.innerHTML = '';
        workbook.SheetNames.forEach((name, idx) => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            if (idx === 0) opt.selected = true;
            sheetSelect.appendChild(opt);
        });

        renderSheetTable(workbook.SheetNames[0]);

        document.getElementById('uploadSection').classList.add('hidden');
        document.getElementById('workspaceSection').classList.remove('hidden');
        hideProgress();
    } catch (err) {
        hideProgress();
        alert('Gagal membaca file Excel: ' + err.message);
    }
}

function clearFile() {
    excelFile = null;
    workbook = null;
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    document.getElementById('excelTableContainer').innerHTML = '';
    hideStatus();
    hideProgress();
}

function onSheetChange(sheetName) {
    if (workbook) renderSheetTable(sheetName);
}

function renderSheetTable(sheetName) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return;

    const html = XLSX.utils.sheet_to_html(worksheet, { id: 'excelTable' });
    const container = document.getElementById('excelTableContainer');
    container.innerHTML = html;

    // Apply clean modern table styles
    const table = container.querySelector('table');
    if (table) {
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.style.fontFamily = "'Segoe UI', Arial, sans-serif";
        table.style.fontSize = '12px';

        const cells = table.querySelectorAll('td, th');
        cells.forEach(cell => {
            cell.style.border = '1px solid #cbd5e1';
            cell.style.padding = '8px 12px';
            cell.style.textAlign = 'left';
        });

        const headerRow = table.querySelector('tr');
        if (headerRow) {
            headerRow.style.background = '#f1f5f9';
            headerRow.style.fontWeight = '700';
        }
    }
}

// ─── Generate PDF Blob via html2pdf ────────────────────────────
async function generateExcelPdfBlob() {
    const tableContainer = document.getElementById('excelTableContainer');
    const orientation = document.getElementById('pageOrientation').value || 'landscape';
    
    // Create an unconstrained clone with clean print styles
    const clone = tableContainer.cloneNode(true);
    clone.style.position = 'absolute';
    clone.style.left = '-9999px';
    clone.style.top = '0';
    clone.style.width = orientation === 'landscape' ? '1120px' : '794px';
    clone.style.maxWidth = orientation === 'landscape' ? '1120px' : '794px';
    clone.style.padding = '20px';
    clone.style.background = '#ffffff';
    clone.style.color = '#0f172a';
    clone.style.overflow = 'visible';
    clone.style.height = 'auto';
    clone.style.maxHeight = 'none';
    document.body.appendChild(clone);

    const opt = {
        margin: [10, 10, 10, 10],
        filename: 'spreadsheet.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: orientation },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    try {
        const worker = html2pdf().set(opt).from(clone);
        const pdfBlob = await worker.output('blob');
        document.body.removeChild(clone);
        return pdfBlob;
    } catch (e) {
        if (clone.parentNode) clone.parentNode.removeChild(clone);
        throw e;
    }
}

// ─── Convert & Download PDF ────────────────────────────────────
async function convertAndDownload() {
    if (!excelFile || !workbook) return;

    const rawName = document.getElementById('outputName').value.trim() || 'converted_excel';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('convertBtn');
    btn.disabled = true;

    showProgress(40, 'Merender tabel Excel ke PDF...');

    try {
        const pdfBlob = await generateExcelPdfBlob();

        showProgress(90, 'Menyimpan file PDF...');
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outputName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showProgress(100, 'Selesai!');
        showStatus(`✅ Berhasil! Spreadsheet Excel berhasil dikonversi ke PDF dan diunduh sebagai "${outputName}".`, 'success');
    } catch (err) {
        hideProgress();
        showStatus('❌ Error saat konversi: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Convert & Save to Google Drive ────────────────────────────
async function convertAndSaveToGDrive() {
    if (!excelFile || !workbook) return;

    const rawName = document.getElementById('outputName').value.trim() || 'converted_excel';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const btn = document.getElementById('convertBtn');
    const gdriveBtn = document.getElementById('convertGDriveBtn');
    btn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    showProgress(40, 'Merender tabel Excel ke PDF...');

    try {
        const pdfBlob = await generateExcelPdfBlob();

        uploadBlobToGDrive({
            blob: pdfBlob,
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
        showStatus('❌ Error saat konversi: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
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
