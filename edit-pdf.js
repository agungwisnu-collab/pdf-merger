/** ============================================================
 *  edit-pdf.js — Advanced Visual PDF Document Editor
 *  Features:
 *  - Zoom In/Out/Fit (50% - 250%)
 *  - Tambah Teks & Kustomisasi Font (Ukuran, Warna, Bold, Italic, Latar)
 *  - Ganti Teks Asli PDF (Deteksi teks otomatis & Whiteout Replace)
 *  - Tip-Ex / Whiteout Box (Hapus teks/gambar yang ada)
 *  - Freehand Pen & Highlighter (Multi-warna, ketebalan, penghapus)
 *  - Sisipkan Foto/Gambar (Resize dengan 4 sudut, Opacity, Rotasi)
 *  - Aneka Bentuk (Kotak, Lingkaran, Garis, Panah, Centang, Silang)
 *  - Undo / Redo & High-DPI Print-Ready Export (Local & Google Drive)
 *  - Pixel-Perfect Text Alignment (WYSIWYG on Screen & Canvas)
 * ============================================================ */

let pdfFile           = null;
let pdfDocJs          = null;
let currentPage       = 1;
let totalPages        = 1;
let currentZoom       = 1.0;
let activeTool        = 'select'; // 'select' | 'text' | 'replaceText' | 'whiteout' | 'pen' | 'highlighter' | 'shape' | 'image'
let selectedElementId = null;

// Page Edits Store: { [pageNum]: { elements: [], drawingDataUrl: '' } }
let pageEdits = {};

// History Stack for Global Undo / Redo
let undoStack = [];
let redoStack = [];

// Text Tool Settings
let textSettings = {
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    fontSize: 16,
    color: '#0f172a',
    isBold: false,
    isItalic: false,
    hasBg: false
};

// Pen / Highlighter Settings
let penSettings = {
    color: '#ef4444',
    width: 4,
    isEraser: false,
    mode: 'pen' // 'pen' | 'highlighter'
};

// Shape Settings
let shapeSettings = {
    type: 'rect', // 'rect' | 'circle' | 'line' | 'arrow' | 'check' | 'cross'
    strokeColor: '#ef4444',
    fillType: 'transparent', // 'transparent' | 'semi' | 'solid'
    strokeWidth: 3
};

// Freehand Drawing State
let isDrawing = false;
let lastDrawX = 0;
let lastDrawY = 0;

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

    initDrawingCanvasEvents();
    initKeyboardShortcuts();
});

// ─── Keyboard Shortcuts (Ctrl+Z, Delete, etc.) ──────────────────
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            if (e.shiftKey) {
                e.preventDefault();
                redoAction();
            } else {
                e.preventDefault();
                undoAction();
            }
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redoAction();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.isContentEditable || activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                return;
            }
            if (selectedElementId) {
                e.preventDefault();
                deleteSelectedElement();
            }
        }
    });
}

// ─── File Handling & Initialization ─────────────────────────────
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

    pdfFile     = file;
    currentPage = 1;
    currentZoom = 1.0;
    pageEdits   = {};
    undoStack   = [];
    redoStack   = [];
    selectedElementId = null;

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

        setActiveTool('select');
        await renderCurrentPage();
        hideProgress();
    } catch (err) {
        hideProgress();
        alert('Gagal memuat PDF: ' + err.message);
    }
}

function clearFile() {
    pdfFile     = null;
    pdfDocJs    = null;
    pageEdits   = {};
    undoStack   = [];
    redoStack   = [];
    document.getElementById('workspaceSection').classList.add('hidden');
    document.getElementById('uploadSection').classList.remove('hidden');
    hideStatus();
    hideProgress();
}

// ─── Tool Switching & Property Bars ─────────────────────────────
function setActiveTool(tool) {
    activeTool = tool;
    
    // Reset all tool button active states
    const toolBtns = ['toolSelectBtn', 'toolTextBtn', 'toolReplaceTextBtn', 'toolWhiteoutBtn', 'toolPenBtn', 'toolHighlighterBtn', 'toolShapeBtn', 'toolImageBtn'];
    toolBtns.forEach(id => {
        const b = document.getElementById(id);
        if (b) b.classList.remove('active');
    });

    const propBars = ['propsText', 'propsPen', 'propsShape', 'propsImage', 'propsWhiteout'];
    propBars.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const drawCanvas = document.getElementById('drawingCanvas');
    const overlay    = document.getElementById('annotationOverlay');
    const textLayer  = document.getElementById('pdfTextLayer');

    if (tool === 'select') {
        document.getElementById('toolSelectBtn')?.classList.add('active');
        if (drawCanvas) {
            drawCanvas.classList.remove('active-draw');
            drawCanvas.style.pointerEvents = 'none';
        }
        if (overlay) overlay.style.pointerEvents = 'none';
        if (textLayer) textLayer.classList.remove('active');
        if (selectedElementId) showPropsForSelectedElement();
    } else if (tool === 'text') {
        document.getElementById('toolTextBtn')?.classList.add('active');
        document.getElementById('propsText')?.classList.remove('hidden');
        if (drawCanvas) {
            drawCanvas.classList.remove('active-draw');
            drawCanvas.style.pointerEvents = 'none';
        }
        if (overlay) overlay.style.pointerEvents = 'none';
        if (textLayer) textLayer.classList.remove('active');
        addTextAnnotation(false);
    } else if (tool === 'replaceText') {
        document.getElementById('toolReplaceTextBtn')?.classList.add('active');
        document.getElementById('propsText')?.classList.remove('hidden');
        if (drawCanvas) {
            drawCanvas.classList.remove('active-draw');
            drawCanvas.style.pointerEvents = 'none';
        }
        if (overlay) overlay.style.pointerEvents = 'none';
        if (textLayer) textLayer.classList.add('active');
        deselectAllElements();
    } else if (tool === 'whiteout') {
        document.getElementById('toolWhiteoutBtn')?.classList.add('active');
        document.getElementById('propsWhiteout')?.classList.remove('hidden');
        if (drawCanvas) {
            drawCanvas.classList.remove('active-draw');
            drawCanvas.style.pointerEvents = 'none';
        }
        if (overlay) overlay.style.pointerEvents = 'none';
        if (textLayer) textLayer.classList.remove('active');
        addWhiteoutBox();
    } else if (tool === 'pen') {
        document.getElementById('toolPenBtn')?.classList.add('active');
        document.getElementById('propsPen')?.classList.remove('hidden');
        penSettings.mode = 'pen';
        penSettings.isEraser = false;
        if (drawCanvas) {
            drawCanvas.classList.add('active-draw');
        }
        if (textLayer) textLayer.classList.remove('active');
        deselectAllElements();
    } else if (tool === 'highlighter') {
        document.getElementById('toolHighlighterBtn')?.classList.add('active');
        document.getElementById('propsPen')?.classList.remove('hidden');
        penSettings.mode = 'highlighter';
        penSettings.isEraser = false;
        if (drawCanvas) {
            drawCanvas.classList.add('active-draw');
        }
        if (textLayer) textLayer.classList.remove('active');
        deselectAllElements();
    } else if (tool === 'shape') {
        document.getElementById('toolShapeBtn')?.classList.add('active');
        document.getElementById('propsShape')?.classList.remove('hidden');
        if (drawCanvas) {
            drawCanvas.classList.remove('active-draw');
            drawCanvas.style.pointerEvents = 'none';
        }
        if (overlay) overlay.style.pointerEvents = 'none';
        if (textLayer) textLayer.classList.remove('active');
    }
}

function showPropsForSelectedElement() {
    const item = getElementById(selectedElementId);
    if (!item) return;

    // Reset toolbar button active states
    const toolBtns = ['toolSelectBtn', 'toolTextBtn', 'toolReplaceTextBtn', 'toolWhiteoutBtn', 'toolPenBtn', 'toolHighlighterBtn', 'toolShapeBtn', 'toolImageBtn'];
    toolBtns.forEach(id => document.getElementById(id)?.classList.remove('active'));

    const propBars = ['propsText', 'propsPen', 'propsShape', 'propsImage', 'propsWhiteout'];
    propBars.forEach(id => document.getElementById(id)?.classList.add('hidden'));

    if (item.type === 'whiteout' || (item.type === 'shape' && item.fillColor === '#ffffff' && item.fillType === 'solid')) {
        document.getElementById('toolWhiteoutBtn')?.classList.add('active');
        document.getElementById('propsWhiteout')?.classList.remove('hidden');
    } else if (item.type === 'text') {
        if (item.hasBg) {
            document.getElementById('toolReplaceTextBtn')?.classList.add('active');
        } else {
            document.getElementById('toolTextBtn')?.classList.add('active');
        }
        document.getElementById('propsText')?.classList.remove('hidden');
        document.getElementById('textFontFamily').value = item.fontFamily || textSettings.fontFamily;
        document.getElementById('textFontSize').value = item.fontSize || textSettings.fontSize;
        document.getElementById('textBoldBtn')?.classList.toggle('active', !!item.isBold);
        document.getElementById('textItalicBtn')?.classList.toggle('active', !!item.isItalic);
        document.getElementById('textBgBtn')?.classList.toggle('active', !!item.hasBg);
    } else if (item.type === 'image') {
        document.getElementById('toolImageBtn')?.classList.add('active');
        document.getElementById('propsImage')?.classList.remove('hidden');
        const opacity = item.opacity !== undefined ? Math.round(item.opacity * 100) : 100;
        document.getElementById('imageOpacitySlider').value = opacity;
        document.getElementById('imageOpacityVal').textContent = opacity + '%';
    } else if (item.type === 'shape') {
        document.getElementById('toolShapeBtn')?.classList.add('active');
        document.getElementById('propsShape')?.classList.remove('hidden');
        document.getElementById('shapeTypeSelect').value = item.shapeType || 'rect';
    }
}

// ─── Rendering Page, Text Layer & Annotations ───────────────────
async function renderCurrentPage() {
    if (!pdfDocJs) return;

    document.getElementById('pageNavText').textContent = `${currentPage} / ${totalPages}`;
    const page = await pdfDocJs.getPage(currentPage);
    const baseViewport = page.getViewport({ scale: 1.0 });

    // 1. Render Base PDF Canvas
    const bgCanvas = document.getElementById('pdfBgCanvas');
    bgCanvas.width  = baseViewport.width;
    bgCanvas.height = baseViewport.height;
    const bgCtx = bgCanvas.getContext('2d');
    await page.render({ canvasContext: bgCtx, viewport: baseViewport }).promise;

    // 2. Render Text Layer for "Replace Text" Feature
    await renderInteractiveTextLayer(page, baseViewport);

    // 3. Freehand Drawing Canvas
    const drawCanvas = document.getElementById('drawingCanvas');
    drawCanvas.width  = baseViewport.width;
    drawCanvas.height = baseViewport.height;

    const drawCtx = drawCanvas.getContext('2d');
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    if (pageEdits[currentPage]?.drawingDataUrl) {
        const img = new Image();
        img.onload = () => drawCtx.drawImage(img, 0, 0);
        img.src = pageEdits[currentPage].drawingDataUrl;
    }

    // 4. Interactive Overlay Elements
    const overlay = document.getElementById('annotationOverlay');
    overlay.style.width  = baseViewport.width + 'px';
    overlay.style.height = baseViewport.height + 'px';
    overlay.innerHTML = '';

    if (pageEdits[currentPage]?.elements) {
        pageEdits[currentPage].elements.forEach(item => {
            renderOverlayElement(item);
        });
    }

    applyZoom();
    updateHistoryButtons();
}

// ─── Interactive Text Layer Detection ───────────────────────────
async function renderInteractiveTextLayer(page, viewport) {
    const textLayerDiv = document.getElementById('pdfTextLayer');
    if (!textLayerDiv) return;
    textLayerDiv.innerHTML = '';
    textLayerDiv.style.width  = viewport.width + 'px';
    textLayerDiv.style.height = viewport.height + 'px';

    // Click anywhere on text layer to place a replacement box if not clicking a specific span
    textLayerDiv.onclick = (e) => {
        if (e.target !== textLayerDiv) return;
        const rect = textLayerDiv.getBoundingClientRect();
        const clickX = (e.clientX - rect.left) * (textLayerDiv.offsetWidth / rect.width);
        const clickY = (e.clientY - rect.top) * (textLayerDiv.offsetHeight / rect.height);
        replaceExistingPdfText('Teks baru...', clickX, clickY, 140, 16);
    };

    try {
        const textContent = await page.getTextContent();
        textContent.items.forEach(item => {
            if (!item.str || item.str.trim() === '') return;

            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
            const left = tx[4];
            const top  = tx[5] - fontHeight;
            const width = item.width * viewport.scale;
            const height = fontHeight * 1.15;

            const span = document.createElement('span');
            span.className = 'pdf-text-item';
            span.style.left   = `${left}px`;
            span.style.top    = `${top}px`;
            span.style.width  = `${width}px`;
            span.style.height = `${height}px`;
            span.title = `Klik untuk ganti: "${item.str}"`;

            span.onclick = (e) => {
                e.stopPropagation();
                replaceExistingPdfText(item.str, left, top, width, Math.round(fontHeight));
            };

            textLayerDiv.appendChild(span);
        });
    } catch (err) {
        console.warn('Text layer extraction note:', err);
    }
}

function replaceExistingPdfText(originalText, exactLeft, exactTop, width, fontSize) {
    saveStateForUndo();
    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [] };

    const cleanFontSize = Math.max(12, Math.min(40, fontSize || 16));

    // Position element so text inside (with padLeft 4px, padTop 2px) sits at EXACT original coordinates
    const posX = Math.max(0, Math.round(exactLeft - 4));
    const posY = Math.max(0, Math.round(exactTop - 2));
    const boxW = Math.max(60, Math.round(width + 8));
    const boxH = Math.round((cleanFontSize * 1.25) + 4);

    const replaceItem = {
        id: 'replace_' + Date.now(),
        type: 'text',
        content: originalText,
        x: posX,
        y: posY,
        fontFamily: textSettings.fontFamily,
        fontSize: cleanFontSize,
        color: textSettings.color,
        isBold: textSettings.isBold,
        isItalic: textSettings.isItalic,
        hasBg: true, // White background covers old text!
        width: boxW,
        height: boxH
    };

    pageEdits[currentPage].elements.push(replaceItem);
    renderOverlayElement(replaceItem);
    selectElement(replaceItem.id);

    const textLayer = document.getElementById('pdfTextLayer');
    if (textLayer) textLayer.classList.remove('active');

    setTimeout(() => {
        const domEl = document.getElementById(replaceItem.id);
        const textDiv = domEl?.querySelector('.editable-text-content');
        if (textDiv) {
            textDiv.focus();
            const range = document.createRange();
            range.selectNodeContents(textDiv);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }, 50);
}

// ─── Tip-Ex / Whiteout Box ──────────────────────────────────────
function addWhiteoutBox() {
    saveStateForUndo();
    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [] };

    const whiteoutItem = {
        id: 'whiteout_' + Date.now(),
        type: 'whiteout',
        x: 80,
        y: 80,
        width: 160,
        height: 35,
        strokeColor: '#cbd5e1',
        fillType: 'solid',
        fillColor: '#ffffff',
        strokeWidth: 1
    };

    pageEdits[currentPage].elements.push(whiteoutItem);
    renderOverlayElement(whiteoutItem);
    selectElement(whiteoutItem.id);
}

// ─── Zoom Controls ──────────────────────────────────────────────
function zoomIn() {
    if (currentZoom < 2.5) {
        currentZoom = Math.min(2.5, +(currentZoom + 0.25).toFixed(2));
        applyZoom();
    }
}

function zoomOut() {
    if (currentZoom > 0.5) {
        currentZoom = Math.max(0.5, +(currentZoom - 0.25).toFixed(2));
        applyZoom();
    }
}

function resetZoom() {
    currentZoom = 1.0;
    applyZoom();
}

function fitToWidth() {
    const viewport = document.getElementById('editorViewport');
    const bgCanvas = document.getElementById('pdfBgCanvas');
    if (!viewport || !bgCanvas || bgCanvas.width === 0) return;

    const availableWidth = viewport.clientWidth - 48;
    const fitScale = +(availableWidth / bgCanvas.width).toFixed(2);
    currentZoom = Math.max(0.5, Math.min(2.0, fitScale));
    applyZoom();
}

function applyZoom() {
    const stage = document.getElementById('canvasStage');
    const display = document.getElementById('zoomDisplay');
    if (stage) {
        stage.style.transform = `scale(${currentZoom})`;
    }
    if (display) {
        display.textContent = `${Math.round(currentZoom * 100)}%`;
    }
}

// ─── Page Navigation ────────────────────────────────────────────
function prevPage() {
    saveCurrentPageEdits();
    if (currentPage > 1) {
        currentPage--;
        deselectAllElements();
        renderCurrentPage();
    }
}

function nextPage() {
    saveCurrentPageEdits();
    if (currentPage < totalPages) {
        currentPage++;
        deselectAllElements();
        renderCurrentPage();
    }
}

function saveCurrentPageEdits() {
    const drawCanvas = document.getElementById('drawingCanvas');
    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [] };
    if (drawCanvas) pageEdits[currentPage].drawingDataUrl = drawCanvas.toDataURL();
}

function clearCurrentPageAnnotations() {
    if (!confirm('Hapus seluruh editan (teks, gambar, bentuk, dan coretan) pada halaman ini?')) return;
    
    saveStateForUndo();
    if (pageEdits[currentPage]) {
        pageEdits[currentPage] = { elements: [] };
    }
    const drawCanvas = document.getElementById('drawingCanvas');
    const ctx = drawCanvas.getContext('2d');
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    document.getElementById('annotationOverlay').innerHTML = '';
    deselectAllElements();
}

// ─── Freehand Drawing & Highlighter Engine ──────────────────────
function getDrawingCanvasPos(e) {
    const drawCanvas = document.getElementById('drawingCanvas');
    const rect = drawCanvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (drawCanvas.width / rect.width),
        y: (e.clientY - rect.top) * (drawCanvas.height / rect.height)
    };
}

function initDrawingCanvasEvents() {
    const drawCanvas = document.getElementById('drawingCanvas');

    drawCanvas.addEventListener('mousedown', (e) => {
        if (activeTool !== 'pen' && activeTool !== 'highlighter') return;
        saveStateForUndo();
        isDrawing = true;
        const ctx = drawCanvas.getContext('2d');
        const pos = getDrawingCanvasPos(e);
        lastDrawX = pos.x;
        lastDrawY = pos.y;

        // Draw initial dot
        if (penSettings.isEraser) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, penSettings.width * 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (activeTool === 'highlighter' || penSettings.mode === 'highlighter') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = hexToRgba(penSettings.color, 0.45);
            ctx.lineWidth = Math.max(18, penSettings.width * 3);
            ctx.lineCap = 'square';
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(pos.x + 0.1, pos.y);
            ctx.stroke();
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = penSettings.color;
            ctx.lineWidth = penSettings.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(pos.x + 0.1, pos.y);
            ctx.stroke();
        }
    });

    drawCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawing || (activeTool !== 'pen' && activeTool !== 'highlighter')) return;
        const ctx = drawCanvas.getContext('2d');
        const pos = getDrawingCanvasPos(e);

        if (penSettings.isEraser) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, penSettings.width * 2, 0, Math.PI * 2);
            ctx.fill();
        } else if (activeTool === 'highlighter' || penSettings.mode === 'highlighter') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = hexToRgba(penSettings.color, 0.45);
            ctx.lineWidth = Math.max(18, penSettings.width * 3);
            ctx.lineCap = 'square';
            ctx.beginPath();
            ctx.moveTo(lastDrawX, lastDrawY);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = penSettings.color;
            ctx.lineWidth = penSettings.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(lastDrawX, lastDrawY);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
        }

        lastDrawX = pos.x;
        lastDrawY = pos.y;
    });

    window.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            saveCurrentPageEdits();
        }
    });
}

function setPenColor(color) {
    penSettings.color = color;
    penSettings.isEraser = false;
    document.getElementById('penEraserBtn')?.classList.remove('active');
    document.getElementById('penColorPicker').value = color;
    updateColorDotActive('#propsPen', color);
}

function setPenWidth(width) {
    penSettings.width = width;
}

function toggleEraser() {
    penSettings.isEraser = !penSettings.isEraser;
    document.getElementById('penEraserBtn')?.classList.toggle('active', penSettings.isEraser);
}

// ─── Text Annotation Engine ─────────────────────────────────────
function addTextAnnotation(withBg = false) {
    saveStateForUndo();
    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [] };
    
    const fontSize = textSettings.fontSize || 16;
    const textItem = {
        id: 'text_' + Date.now(),
        type: 'text',
        content: 'Ketik teks di sini...',
        x: 60,
        y: 80,
        fontFamily: textSettings.fontFamily,
        fontSize: fontSize,
        color: textSettings.color,
        isBold: textSettings.isBold,
        isItalic: textSettings.isItalic,
        hasBg: withBg || textSettings.hasBg,
        width: 150,
        height: Math.round(fontSize * 1.25 + 4)
    };

    pageEdits[currentPage].elements.push(textItem);
    renderOverlayElement(textItem);
    selectElement(textItem.id);

    // Auto focus text
    setTimeout(() => {
        const domEl = document.getElementById(textItem.id);
        const textDiv = domEl?.querySelector('.editable-text-content');
        if (textDiv) {
            textDiv.focus();
            const range = document.createRange();
            range.selectNodeContents(textDiv);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }, 50);
}

function updateSelectedTextProp(prop, val) {
    textSettings[prop] = val;
    const item = getElementById(selectedElementId);
    if (item && item.type === 'text') {
        saveStateForUndo();
        item[prop] = val;
        applyTextStyleToDOM(item);
    }
}

function setTextTextColor(color) {
    updateSelectedTextProp('color', color);
    document.getElementById('textColorPicker').value = color;
    updateColorDotActive('#propsText', color);
}

function toggleTextBold() {
    const nextVal = !textSettings.isBold;
    updateSelectedTextProp('isBold', nextVal);
    document.getElementById('textBoldBtn')?.classList.toggle('active', nextVal);
}

function toggleTextItalic() {
    const nextVal = !textSettings.isItalic;
    updateSelectedTextProp('isItalic', nextVal);
    document.getElementById('textItalicBtn')?.classList.toggle('active', nextVal);
}

function toggleTextBackground() {
    const nextVal = !textSettings.hasBg;
    updateSelectedTextProp('hasBg', nextVal);
    document.getElementById('textBgBtn')?.classList.toggle('active', nextVal);
}

function applyTextStyleToDOM(item) {
    const el = document.getElementById(item.id);
    if (!el) return;
    const textDiv = el.querySelector('.editable-text-content');
    if (textDiv) {
        textDiv.style.fontFamily = item.fontFamily;
        textDiv.style.fontSize   = item.fontSize + 'px';
        textDiv.style.color      = item.color;
        textDiv.style.fontWeight = item.isBold ? '800' : '500';
        textDiv.style.fontStyle  = item.isItalic ? 'italic' : 'normal';
    }
    el.classList.toggle('has-bg', !!item.hasBg);
    item.width  = el.offsetWidth;
    item.height = el.offsetHeight;
}

// ─── Image / Photo Annotation Engine ────────────────────────────
function handleImageInsert(file) {
    if (!file) return;
    saveStateForUndo();

    const reader = new FileReader();
    reader.onload = (e) => {
        if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [] };
        
        const img = new Image();
        img.onload = () => {
            const maxW = 200;
            const aspect = img.width / img.height;
            const width = maxW;
            const height = Math.round(maxW / aspect);

            const imgItem = {
                id: 'img_' + Date.now(),
                type: 'image',
                dataUrl: e.target.result,
                x: 80,
                y: 80,
                width: width,
                height: height,
                opacity: 1.0,
                rotation: 0
            };

            pageEdits[currentPage].elements.push(imgItem);
            renderOverlayElement(imgItem);
            selectElement(imgItem.id);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function updateSelectedImageOpacity(val) {
    const opacity = parseFloat(val) / 100;
    document.getElementById('imageOpacityVal').textContent = Math.round(opacity * 100) + '%';
    const item = getElementById(selectedElementId);
    if (item && item.type === 'image') {
        item.opacity = opacity;
        const el = document.getElementById(item.id);
        if (el) el.style.opacity = opacity;
    }
}

function rotateSelectedImage(deg) {
    const item = getElementById(selectedElementId);
    if (item && item.type === 'image') {
        saveStateForUndo();
        item.rotation = ((item.rotation || 0) + deg) % 360;
        const el = document.getElementById(item.id);
        if (el) {
            const img = el.querySelector('img');
            if (img) img.style.transform = `rotate(${item.rotation}deg)`;
        }
    }
}

// ─── Shape Annotation Engine ────────────────────────────────────
function setShapeType(type) {
    shapeSettings.type = type;
}

function setShapeStrokeColor(color) {
    shapeSettings.strokeColor = color;
    document.getElementById('shapeStrokePicker').value = color;
    updateColorDotActive('#propsShape', color);
}

function setShapeFill(fill) {
    shapeSettings.fillType = fill;
}

function addShapeToPage() {
    saveStateForUndo();
    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [] };

    let w = 160, h = 100;
    if (shapeSettings.type === 'circle') { w = 120; h = 120; }
    else if (shapeSettings.type === 'line' || shapeSettings.type === 'arrow') { w = 180; h = 40; }
    else if (shapeSettings.type === 'check' || shapeSettings.type === 'cross') { w = 70; h = 70; }

    const shapeItem = {
        id: 'shape_' + Date.now(),
        type: 'shape',
        shapeType: shapeSettings.type,
        x: 80,
        y: 80,
        width: w,
        height: h,
        strokeColor: shapeSettings.strokeColor,
        fillType: shapeSettings.fillType,
        strokeWidth: shapeSettings.strokeWidth
    };

    pageEdits[currentPage].elements.push(shapeItem);
    renderOverlayElement(shapeItem);
    selectElement(shapeItem.id);
}

function renderShapeSVG(item) {
    const color = item.strokeColor || '#ef4444';
    let fill = 'none';
    if (item.fillType === 'solid' && item.fillColor) fill = item.fillColor;
    else if (item.fillType === 'semi') fill = hexToRgba(color, 0.25);
    else if (item.fillType === 'solid') fill = color;

    const strokeW = item.strokeWidth || 3;

    if (item.shapeType === 'rect') {
        return `<svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="4" y="4" width="92" height="92" rx="4" fill="${fill}" stroke="${color}" stroke-width="${strokeW}" /></svg>`;
    } else if (item.shapeType === 'circle') {
        return `<svg width="100%" height="100%" viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="46" ry="46" fill="${fill}" stroke="${color}" stroke-width="${strokeW}" /></svg>`;
    } else if (item.shapeType === 'line') {
        return `<svg width="100%" height="100%" viewBox="0 0 100 20" preserveAspectRatio="none"><line x1="2" y1="10" x2="98" y2="10" stroke="${color}" stroke-width="${strokeW * 1.5}" stroke-linecap="round" /></svg>`;
    } else if (item.shapeType === 'arrow') {
        return `<svg width="100%" height="100%" viewBox="0 0 100 30" preserveAspectRatio="none"><line x1="2" y1="15" x2="88" y2="15" stroke="${color}" stroke-width="${strokeW * 1.5}" stroke-linecap="round" /><polygon points="85,6 98,15 85,24" fill="${color}" /></svg>`;
    } else if (item.shapeType === 'check') {
        return `<svg width="100%" height="100%" viewBox="0 0 100 100"><polyline points="15,50 40,75 85,20" fill="none" stroke="${color}" stroke-width="${strokeW * 2}" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
    } else if (item.shapeType === 'cross') {
        return `<svg width="100%" height="100%" viewBox="0 0 100 100"><line x1="20" y1="20" x2="80" y2="80" stroke="${color}" stroke-width="${strokeW * 2}" stroke-linecap="round" /><line x1="80" y1="20" x2="20" y2="80" stroke="${color}" stroke-width="${strokeW * 2}" stroke-linecap="round" /></svg>`;
    }
    return '';
}

// ─── DOM Overlay Element Generator ──────────────────────────────
function renderOverlayElement(item) {
    const overlay = document.getElementById('annotationOverlay');
    const el = document.createElement('div');
    el.id = item.id;
    el.className = `anno-element anno-${item.type}`;
    el.style.left = item.x + 'px';
    el.style.top  = item.y + 'px';

    // Delete handle
    const delBtn = document.createElement('div');
    delBtn.className = 'anno-delete-btn';
    delBtn.innerHTML = '✕';
    delBtn.title = 'Hapus (Delete)';
    delBtn.onclick = (e) => {
        e.stopPropagation();
        deleteSelectedElement();
    };
    el.appendChild(delBtn);

    // 4 Corner Resize Handles
    const handles = ['nw', 'ne', 'sw', 'se'];
    handles.forEach(pos => {
        const h = document.createElement('div');
        h.className = `anno-handle handle-${pos}`;
        h.dataset.direction = pos;
        el.appendChild(h);
    });

    if (item.type === 'whiteout') {
        el.classList.add('anno-whiteout');
        el.style.width  = item.width + 'px';
        el.style.height = item.height + 'px';
        el.title = 'Tip-Ex Putih (Klik untuk geser/ubah ukuran)';
    } else if (item.type === 'text') {
        if (item.hasBg) el.classList.add('has-bg');
        if (item.width) el.style.width = item.width + 'px';
        if (item.height) el.style.minHeight = item.height + 'px';

        const textDiv = document.createElement('div');
        textDiv.className = 'editable-text-content';
        textDiv.contentEditable = 'true';
        textDiv.spellcheck = false;
        textDiv.style.fontFamily = item.fontFamily || textSettings.fontFamily;
        textDiv.style.fontSize   = (item.fontSize || textSettings.fontSize) + 'px';
        textDiv.style.color      = item.color || textSettings.color;
        textDiv.style.fontWeight = item.isBold ? '800' : '500';
        textDiv.style.fontStyle  = item.isItalic ? 'italic' : 'normal';
        textDiv.innerText = item.content || '';

        textDiv.addEventListener('input', () => {
            item.content = textDiv.innerText;
            item.width   = el.offsetWidth;
            item.height  = el.offsetHeight;
        });

        textDiv.addEventListener('blur', () => {
            item.content = textDiv.innerText.trim() || ' ';
            item.width   = el.offsetWidth;
            item.height  = el.offsetHeight;
        });

        textDiv.addEventListener('focus', () => {
            selectElement(item.id);
        });

        el.appendChild(textDiv);

    } else if (item.type === 'image') {
        el.style.width  = item.width + 'px';
        el.style.height = item.height + 'px';
        el.style.opacity = item.opacity !== undefined ? item.opacity : 1.0;
        
        const img = document.createElement('img');
        img.src = item.dataUrl;
        img.style.width  = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.style.pointerEvents = 'none';
        if (item.rotation) img.style.transform = `rotate(${item.rotation}deg)`;
        el.appendChild(img);

    } else if (item.type === 'shape') {
        el.style.width  = item.width + 'px';
        el.style.height = item.height + 'px';
        const shapeContainer = document.createElement('div');
        shapeContainer.className = 'shape-svg-wrap';
        shapeContainer.style.width = '100%';
        shapeContainer.style.height = '100%';
        shapeContainer.style.pointerEvents = 'none';
        shapeContainer.innerHTML = renderShapeSVG(item);
        el.appendChild(shapeContainer);
    }

    // Attach Selection, Drag, and Resize Listeners
    attachElementInteractions(el, item);
    overlay.appendChild(el);

    // Record initial rendered dimensions
    item.width  = el.offsetWidth;
    item.height = el.offsetHeight;
}

// ─── Drag & Resize Interaction Handlers ─────────────────────────
function attachElementInteractions(el, item) {
    const textContentEl = el.querySelector('.editable-text-content');

    el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('anno-handle') || e.target.classList.contains('anno-delete-btn')) {
            return;
        }
        selectElement(item.id);

        // If clicking directly inside the editable text area, allow direct caret typing!
        if (e.target === textContentEl || e.target.isContentEditable) {
            return;
        }

        saveStateForUndo();
        let startX = e.clientX;
        let startY = e.clientY;
        let initX  = item.x;
        let initY  = item.y;
        let isMoving = true;

        const onMouseMove = (moveEvt) => {
            if (!isMoving) return;
            const dx = (moveEvt.clientX - startX) / currentZoom;
            const dy = (moveEvt.clientY - startY) / currentZoom;
            item.x = Math.max(0, initX + dx);
            item.y = Math.max(0, initY + dy);
            el.style.left = item.x + 'px';
            el.style.top  = item.y + 'px';
        };

        const onMouseUp = () => {
            isMoving = false;
            item.width  = el.offsetWidth;
            item.height = el.offsetHeight;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    });

    // Resize Handles
    const handles = el.querySelectorAll('.anno-handle');
    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            saveStateForUndo();
            const dir = handle.dataset.direction;
            let startX = e.clientX;
            let startY = e.clientY;
            let initW  = item.width || el.offsetWidth;
            let initH  = item.height || el.offsetHeight;
            let initX  = item.x;
            let initY  = item.y;

            const onResizeMove = (moveEvt) => {
                const dx = (moveEvt.clientX - startX) / currentZoom;
                const dy = (moveEvt.clientY - startY) / currentZoom;

                if (dir === 'se') {
                    item.width  = Math.max(20, initW + dx);
                    item.height = Math.max(15, initH + dy);
                } else if (dir === 'sw') {
                    item.width  = Math.max(20, initW - dx);
                    item.height = Math.max(15, initH + dy);
                    item.x = initX + dx;
                } else if (dir === 'ne') {
                    item.width  = Math.max(20, initW + dx);
                    item.height = Math.max(15, initH - dy);
                    item.y = initY + dy;
                } else if (dir === 'nw') {
                    item.width  = Math.max(20, initW - dx);
                    item.height = Math.max(15, initH - dy);
                    item.x = initX + dx;
                    item.y = initY + dy;
                }

                el.style.left   = item.x + 'px';
                el.style.top    = item.y + 'px';
                el.style.width  = item.width + 'px';
                el.style.height = item.height + 'px';

                if (item.type === 'shape') {
                    const svgWrap = el.querySelector('.shape-svg-wrap');
                    if (svgWrap) svgWrap.innerHTML = renderShapeSVG(item);
                }
            };

            const onResizeUp = () => {
                item.width  = el.offsetWidth;
                item.height = el.offsetHeight;
                document.removeEventListener('mousemove', onResizeMove);
                document.removeEventListener('mouseup', onResizeUp);
            };

            document.addEventListener('mousemove', onResizeMove);
            document.addEventListener('mouseup', onResizeUp);
        });
    });
}

function selectElement(id) {
    selectedElementId = id;
    document.querySelectorAll('.anno-element').forEach(el => {
        el.classList.toggle('selected', el.id === id);
    });
    showPropsForSelectedElement();
}

function deselectAllElements() {
    selectedElementId = null;
    document.querySelectorAll('.anno-element').forEach(el => el.classList.remove('selected'));
    const propBars = ['propsText', 'propsShape', 'propsImage', 'propsWhiteout'];
    propBars.forEach(id => document.getElementById(id)?.classList.add('hidden'));
}

function deleteSelectedElement() {
    if (!selectedElementId) return;
    saveStateForUndo();
    
    if (pageEdits[currentPage]?.elements) {
        pageEdits[currentPage].elements = pageEdits[currentPage].elements.filter(e => e.id !== selectedElementId);
    }
    const domEl = document.getElementById(selectedElementId);
    if (domEl) domEl.remove();
    deselectAllElements();
}

function getElementById(id) {
    if (!id || !pageEdits[currentPage]?.elements) return null;
    return pageEdits[currentPage].elements.find(e => e.id === id);
}

function updateColorDotActive(parentSelector, color) {
    const parent = document.querySelector(parentSelector);
    if (!parent) return;
    parent.querySelectorAll('.color-dot').forEach(dot => {
        dot.classList.toggle('active', dot.style.background === color || rgbToHex(dot.style.background) === color.toLowerCase());
    });
}

// ─── Undo / Redo History Engine ─────────────────────────────────
function saveStateForUndo() {
    const drawCanvas = document.getElementById('drawingCanvas');
    const snapshot = {
        page: currentPage,
        elements: JSON.parse(JSON.stringify(pageEdits[currentPage]?.elements || [])),
        drawingDataUrl: drawCanvas ? drawCanvas.toDataURL() : ''
    };
    undoStack.push(snapshot);
    if (undoStack.length > 25) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
}

function undoAction() {
    if (undoStack.length === 0) return;
    
    const drawCanvas = document.getElementById('drawingCanvas');
    const currentSnapshot = {
        page: currentPage,
        elements: JSON.parse(JSON.stringify(pageEdits[currentPage]?.elements || [])),
        drawingDataUrl: drawCanvas ? drawCanvas.toDataURL() : ''
    };
    redoStack.push(currentSnapshot);

    const prevState = undoStack.pop();
    if (!pageEdits[prevState.page]) pageEdits[prevState.page] = { elements: [] };
    pageEdits[prevState.page].elements = prevState.elements;
    pageEdits[prevState.page].drawingDataUrl = prevState.drawingDataUrl;

    if (currentPage !== prevState.page) {
        currentPage = prevState.page;
    }
    renderCurrentPage();
    updateHistoryButtons();
}

function redoAction() {
    if (redoStack.length === 0) return;

    const drawCanvas = document.getElementById('drawingCanvas');
    const currentSnapshot = {
        page: currentPage,
        elements: JSON.parse(JSON.stringify(pageEdits[currentPage]?.elements || [])),
        drawingDataUrl: drawCanvas ? drawCanvas.toDataURL() : ''
    };
    undoStack.push(currentSnapshot);

    const nextState = redoStack.pop();
    if (!pageEdits[nextState.page]) pageEdits[nextState.page] = { elements: [] };
    pageEdits[nextState.page].elements = nextState.elements;
    pageEdits[nextState.page].drawingDataUrl = nextState.drawingDataUrl;

    if (currentPage !== nextState.page) {
        currentPage = nextState.page;
    }
    renderCurrentPage();
    updateHistoryButtons();
}

function updateHistoryButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

// ─── High-Resolution Export Engine (PDF-Lib + Canvas) ───────────
async function saveEditedPDF() {
    if (!pdfFile || !pdfDocJs) return;
    saveCurrentPageEdits();

    const rawName = document.getElementById('outputName').value.trim() || 'edited_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.disabled = true;

    showProgress(15, 'Merender perubahan dengan resolusi tinggi (High-DPI)...');

    try {
        const { PDFDocument } = PDFLib;
        const newPdfDoc = await PDFDocument.create();

        for (let i = 1; i <= totalPages; i++) {
            const pct = Math.round(15 + (i / totalPages) * 75);
            showProgress(pct, `Menyimpan lembar ${i} dari ${totalPages}...`);

            const page = await pdfDocJs.getPage(i);
            const renderScale = 2.5;
            const viewport = page.getViewport({ scale: renderScale });

            const canvas = document.createElement('canvas');
            canvas.width  = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');

            // 1. Render PDF base layer
            await page.render({ canvasContext: ctx, viewport }).promise;

            // 2. Render freehand drawings
            const edits = pageEdits[i];
            if (edits) {
                if (edits.drawingDataUrl) {
                    const drawImg = await loadImage(edits.drawingDataUrl);
                    ctx.drawImage(drawImg, 0, 0, canvas.width, canvas.height);
                }

                // 3. Render all annotations (whiteout, text, shapes, images)
                const scaleFactor = renderScale / 1.0;
                for (const el of (edits.elements || [])) {
                    if (el.type === 'whiteout') {
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(el.x * scaleFactor, el.y * scaleFactor, el.width * scaleFactor, el.height * scaleFactor);
                    } else if (el.type === 'text') {
                        drawTextOnCanvas(ctx, el, scaleFactor);
                    } else if (el.type === 'image') {
                        const img = await loadImage(el.dataUrl);
                        ctx.save();
                        ctx.globalAlpha = el.opacity !== undefined ? el.opacity : 1.0;
                        if (el.rotation) {
                            const cx = (el.x + el.width / 2) * scaleFactor;
                            const cy = (el.y + el.height / 2) * scaleFactor;
                            ctx.translate(cx, cy);
                            ctx.rotate((el.rotation * Math.PI) / 180);
                            ctx.drawImage(img, (-el.width / 2) * scaleFactor, (-el.height / 2) * scaleFactor, el.width * scaleFactor, el.height * scaleFactor);
                        } else {
                            ctx.drawImage(img, el.x * scaleFactor, el.y * scaleFactor, el.width * scaleFactor, el.height * scaleFactor);
                        }
                        ctx.restore();
                    } else if (el.type === 'shape') {
                        drawShapeOnCanvas(ctx, el, scaleFactor);
                    }
                }
            }

            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.94));
            const imgBytes = new Uint8Array(await blob.arrayBuffer());
            const embedded = await newPdfDoc.embedJpg(imgBytes);

            const origVp = page.getViewport({ scale: 1.0 });
            const newPage = newPdfDoc.addPage([origVp.width, origVp.height]);
            newPage.drawImage(embedded, { x: 0, y: 0, width: origVp.width, height: origVp.height });
        }

        showProgress(95, 'Menyelesaikan dokumen PDF...');
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
        showStatus(`✅ Berhasil! Dokumen PDF yang diedit telah diunduh sebagai <strong>"${outputName}"</strong>.`, 'success');
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

    showProgress(15, 'Merender perubahan untuk Google Drive...');

    try {
        const { PDFDocument } = PDFLib;
        const newPdfDoc = await PDFDocument.create();

        for (let i = 1; i <= totalPages; i++) {
            const pct = Math.round(15 + (i / totalPages) * 65);
            showProgress(pct, `Menyiapkan lembar ${i} dari ${totalPages}...`);

            const page = await pdfDocJs.getPage(i);
            const renderScale = 2.5;
            const viewport = page.getViewport({ scale: renderScale });

            const canvas = document.createElement('canvas');
            canvas.width  = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');

            await page.render({ canvasContext: ctx, viewport }).promise;

            const edits = pageEdits[i];
            if (edits) {
                if (edits.drawingDataUrl) {
                    const drawImg = await loadImage(edits.drawingDataUrl);
                    ctx.drawImage(drawImg, 0, 0, canvas.width, canvas.height);
                }

                const scaleFactor = renderScale / 1.0;
                for (const el of (edits.elements || [])) {
                    if (el.type === 'whiteout') {
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(el.x * scaleFactor, el.y * scaleFactor, el.width * scaleFactor, el.height * scaleFactor);
                    } else if (el.type === 'text') {
                        drawTextOnCanvas(ctx, el, scaleFactor);
                    } else if (el.type === 'image') {
                        const img = await loadImage(el.dataUrl);
                        ctx.save();
                        ctx.globalAlpha = el.opacity !== undefined ? el.opacity : 1.0;
                        if (el.rotation) {
                            const cx = (el.x + el.width / 2) * scaleFactor;
                            const cy = (el.y + el.height / 2) * scaleFactor;
                            ctx.translate(cx, cy);
                            ctx.rotate((el.rotation * Math.PI) / 180);
                            ctx.drawImage(img, (-el.width / 2) * scaleFactor, (-el.height / 2) * scaleFactor, el.width * scaleFactor, el.height * scaleFactor);
                        } else {
                            ctx.drawImage(img, el.x * scaleFactor, el.y * scaleFactor, el.width * scaleFactor, el.height * scaleFactor);
                        }
                        ctx.restore();
                    } else if (el.type === 'shape') {
                        drawShapeOnCanvas(ctx, el, scaleFactor);
                    }
                }
            }

            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.94));
            const imgBytes = new Uint8Array(await blob.arrayBuffer());
            const embedded = await newPdfDoc.embedJpg(imgBytes);

            const origVp = page.getViewport({ scale: 1.0 });
            const newPage = newPdfDoc.addPage([origVp.width, origVp.height]);
            newPage.drawImage(embedded, { x: 0, y: 0, width: origVp.width, height: origVp.height });
        }

        showProgress(85, 'Mengunggah ke Google Drive...');
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

// ─── Pixel-Perfect Text Rendering on Canvas (WYSIWYG) ───────────
function drawTextOnCanvas(ctx, el, scaleFactor) {
    const fontStyleStr = el.isItalic ? 'italic ' : '';
    const fontWeightStr = el.isBold ? '800 ' : '500 ';
    const fontFam = el.fontFamily ? el.fontFamily.split(',')[0].replace(/['"]/g, '').trim() : 'Plus Jakarta Sans';
    const fontSizePx = el.fontSize || 16;
    const scaledFontSize = Math.round(fontSizePx * scaleFactor);
    const lineHeight = scaledFontSize * 1.25;

    ctx.save();
    ctx.font = `${fontStyleStr}${fontWeightStr}${scaledFontSize}px "${fontFam}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
    ctx.textBaseline = 'alphabetic';

    const rawContent = el.content !== undefined ? String(el.content) : '';
    const lines = rawContent.split('\n');

    // Calculate exact bounding dimensions
    let maxLineWidth = 0;
    lines.forEach(line => {
        const m = ctx.measureText(line);
        if (m.width > maxLineWidth) maxLineWidth = m.width;
    });

    const padLeft = 4 * scaleFactor;
    const padTop  = 2 * scaleFactor;
    const totalTextH = Math.max(lines.length * lineHeight, (fontSizePx + 4) * scaleFactor);

    const boxW = el.width ? (el.width * scaleFactor) : (maxLineWidth + (padLeft * 2));
    const boxH = el.height ? (el.height * scaleFactor) : (totalTextH + (padTop * 2));

    // If Whiteout or Background is enabled, draw crisp white rect
    if (el.hasBg) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(el.x * scaleFactor, el.y * scaleFactor, boxW, boxH);
    }

    ctx.fillStyle = el.color || '#0f172a';
    
    // Exact baseline offset: padding-top (2px) + font baseline (0.92 * fontSize)
    const baselineOffset = (2 + (fontSizePx * 0.92)) * scaleFactor;
    
    lines.forEach((line, idx) => {
        ctx.fillText(line, (el.x * scaleFactor) + padLeft, (el.y * scaleFactor) + baselineOffset + (idx * lineHeight));
    });

    ctx.restore();
}

function drawShapeOnCanvas(ctx, el, scale) {
    const x = el.x * scale;
    const y = el.y * scale;
    const w = el.width * scale;
    const h = el.height * scale;
    const color = el.strokeColor || '#ef4444';
    const strokeW = (el.strokeWidth || 3) * scale;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = strokeW;

    let fill = 'transparent';
    if (el.fillType === 'solid' && el.fillColor) fill = el.fillColor;
    else if (el.fillType === 'semi') fill = hexToRgba(color, 0.25);
    else if (el.fillType === 'solid') fill = color;
    ctx.fillStyle = fill;

    if (el.shapeType === 'rect') {
        if (fill !== 'transparent') ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
    } else if (el.shapeType === 'circle') {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (fill !== 'transparent') ctx.fill();
        ctx.stroke();
    } else if (el.shapeType === 'line') {
        ctx.beginPath();
        ctx.moveTo(x, y + h / 2);
        ctx.lineTo(x + w, y + h / 2);
        ctx.stroke();
    } else if (el.shapeType === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(x, y + h / 2);
        ctx.lineTo(x + w - (12 * scale), y + h / 2);
        ctx.stroke();
        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(x + w - (14 * scale), y + (4 * scale));
        ctx.lineTo(x + w, y + h / 2);
        ctx.lineTo(x + w - (14 * scale), y + h - (4 * scale));
        ctx.fillStyle = color;
        ctx.fill();
    } else if (el.shapeType === 'check') {
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = strokeW * 1.5;
        ctx.moveTo(x + (w * 0.15), y + (h * 0.5));
        ctx.lineTo(x + (w * 0.4), y + (h * 0.75));
        ctx.lineTo(x + (w * 0.85), y + (h * 0.2));
        ctx.stroke();
    } else if (el.shapeType === 'cross') {
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.lineWidth = strokeW * 1.5;
        ctx.moveTo(x + (w * 0.2), y + (h * 0.2));
        ctx.lineTo(x + (w * 0.8), y + (h * 0.8));
        ctx.moveTo(x + (w * 0.8), y + (h * 0.2));
        ctx.lineTo(x + (w * 0.2), y + (h * 0.8));
        ctx.stroke();
    }

    ctx.restore();
}

// ─── Helpers ────────────────────────────────────────────────────
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = src;
    });
}

function hexToRgba(hex, alpha = 1) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

function rgbToHex(rgb) {
    if (!rgb || rgb.startsWith('#')) return rgb || '';
    const match = rgb.match(/\d+/g);
    if (!match || match.length < 3) return '';
    return '#' + ((1 << 24) + (parseInt(match[0]) << 16) + (parseInt(match[1]) << 8) + parseInt(match[2])).toString(16).slice(1);
}

function showProgress(percent, text) {
    document.getElementById('progressSection')?.classList.remove('hidden');
    const bar = document.getElementById('progressBar');
    if (bar) bar.style.width = percent + '%';
    const txt = document.getElementById('progressText');
    if (txt) txt.textContent = text;
}

function hideProgress() {
    document.getElementById('progressSection')?.classList.add('hidden');
    const bar = document.getElementById('progressBar');
    if (bar) bar.style.width = '0%';
}

function showStatus(msg, type) {
    const box = document.getElementById('statusBox');
    if (box) {
        box.innerHTML = msg;
        box.className = `status-box ${type}`;
        box.classList.remove('hidden');
    }
}

function hideStatus() {
    document.getElementById('statusBox')?.classList.add('hidden');
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
