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
let pageDpr           = 1; // High-DPI screen pixel ratio for crisp rendering

// Page Edits Store: { [pageNum]: { elements: [], deletedElements: [], drawingDataUrl: '' } }
let pageEdits = {};
let detectedPageElements = {}; // { [pageNum]: { textBlocks: [], imageBlocks: [] } }

// History Stack for Global Undo / Redo
let undoStack = [];
let redoStack = [];

// Text Tool Settings (Typography & Alignment)
let textSettings = {
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    fontSize: 16,
    color: '#0f172a',
    isBold: false,
    isItalic: false,
    isUnderline: false,
    align: 'left', // 'left' | 'center' | 'right'
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

    // Deselect elements when clicking empty canvas stage or viewport
    const editorViewport = document.getElementById('editorViewport');
    if (editorViewport) {
        editorViewport.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.anno-element') && !e.target.closest('.pdf-text-item') && !e.target.closest('.editor-toolbar-box') && !e.target.closest('.editor-sidebar-pages') && !e.target.closest('.preview-floating-nav')) {
                deselectAllElements();
            }
        });

        // Smooth Zoom with Ctrl + Mouse Wheel (or trackpad pinch)
        editorViewport.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.deltaY < 0) {
                    zoomIn();
                } else if (e.deltaY > 0) {
                    zoomOut();
                }
            }
        }, { passive: false });
    }

    initDrawingCanvasEvents();
    initKeyboardShortcuts();
});

// ─── Keyboard Shortcuts (Ctrl+Z, Delete, Zoom, etc.) ────────────
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
            e.preventDefault();
            zoomIn();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
            e.preventDefault();
            zoomOut();
        } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
            e.preventDefault();
            resetZoom();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
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
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            toggleTextBold();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
            e.preventDefault();
            toggleTextItalic();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
            e.preventDefault();
            toggleTextUnderline();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            duplicateSelectedElement();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                return;
            }
            if (activeEl && activeEl.isContentEditable) {
                const text = (activeEl.innerText || '').trim();
                // If text box is empty or only whitespace, delete the box
                if (text === '' || text === '\n') {
                    e.preventDefault();
                    deleteSelectedElement();
                    return;
                }
                return;
            }
            if (selectedElementId) {
                e.preventDefault();
                deleteSelectedElement();
            }
        } else if (e.key === 'Escape') {
            if (document.activeElement && document.activeElement.isContentEditable) {
                document.activeElement.blur();
            } else {
                deselectAllElements();
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
    detectedPageElements = {};
    undoStack   = [];
    redoStack   = [];
    selectedElementId = null;

    document.getElementById('docTitle').textContent = `📄 ${file.name}`;
    const defaultOutName = file.name.replace(/\.pdf$/i, '') + '_edited';
    document.getElementById('outputName').value = defaultOutName;
    const sideOut = document.getElementById('outputNameSidebar');
    if (sideOut) sideOut.value = defaultOutName;

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
        renderSidebarThumbnails();
        inspectDocumentElements(file);
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
    detectedPageElements = {};
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
        if (textLayer) textLayer.classList.add('active');
        if (selectedElementId) showPropsForSelectedElement();
    } else if (tool === 'text') {
        document.getElementById('toolTextBtn')?.classList.add('active');
        document.getElementById('propsText')?.classList.remove('hidden');
        if (drawCanvas) {
            drawCanvas.classList.remove('active-draw');
            drawCanvas.style.pointerEvents = 'none';
        }
        if (overlay) overlay.style.pointerEvents = 'none';
        if (textLayer) textLayer.classList.add('active');
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

        const fontSelect = document.getElementById('textFontFamily');
        if (fontSelect && item.fontFamily) {
            let found = false;
            for (let opt of fontSelect.options) {
                if (opt.value === item.fontFamily || (item.fontFamily.toLowerCase().includes('times') && opt.value.includes('Times')) || (item.fontFamily.toLowerCase().includes('courier') && opt.value.includes('Courier')) || (item.fontFamily.toLowerCase().includes('arial') && opt.value.includes('Arial'))) {
                    fontSelect.value = opt.value;
                    found = true;
                    break;
                }
            }
            if (!found) {
                fontSelect.value = item.fontFamily;
            }
        }

        const sizeSelect = document.getElementById('textFontSize');
        if (sizeSelect && item.fontSize) {
            const rSize = Math.round(item.fontSize);
            let found = false;
            for (let opt of sizeSelect.options) {
                if (parseInt(opt.value) === rSize) {
                    sizeSelect.value = opt.value;
                    found = true;
                    break;
                }
            }
            if (!found) {
                const opt = document.createElement('option');
                opt.value = rSize;
                opt.textContent = `${rSize} px`;
                opt.selected = true;
                sizeSelect.appendChild(opt);
            }
        }

        document.getElementById('textBoldBtn')?.classList.toggle('active', !!item.isBold);
        document.getElementById('textItalicBtn')?.classList.toggle('active', !!item.isItalic);
        document.getElementById('textUnderlineBtn')?.classList.toggle('active', !!item.isUnderline);
        document.getElementById('textBgBtn')?.classList.toggle('active', !!item.hasBg);
        const curAlign = item.align || 'left';
        ['Left', 'Center', 'Right'].forEach(dir => {
            document.getElementById(`textAlign${dir}Btn`)?.classList.toggle('active', dir.toLowerCase() === curAlign);
        });
        const badgeWrap = document.getElementById('trueEditBadgeWrap');
        if (badgeWrap) badgeWrap.style.display = item.isTrueEdit ? 'inline-flex' : 'none';
    } else if (item.type === 'image' || item.type === 'detected_image') {
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

// ─── Canvas Background Clean & In-Place Eraser ──────────────────
function eraseRectFromBgCanvas(rect) {
    if (!rect || rect.length < 4) return;
    const bgCanvas = document.getElementById('pdfBgCanvas');
    if (!bgCanvas) return;
    const ctx = bgCanvas.getContext('2d');
    const dpr = pageDpr || 1;
    const pad = 1.5 * dpr;
    const x = Math.max(0, Math.floor(rect[0] * dpr - pad));
    const y = Math.max(0, Math.floor(rect[1] * dpr - pad));
    const w = Math.min(bgCanvas.width - x, Math.ceil((rect[2] - rect[0]) * dpr + pad * 2));
    const h = Math.min(bgCanvas.height - y, Math.ceil((rect[3] - rect[1]) * dpr + pad * 2));

    if (w <= 0 || h <= 0) return;

    // Sample surrounding background color just outside the rect
    let fillColor = '#ffffff';
    try {
        const sampleX = Math.max(0, x - Math.round(2 * dpr));
        const sampleY = Math.max(0, y - Math.round(2 * dpr));
        const pixel = ctx.getImageData(sampleX, sampleY, 1, 1).data;
        if (pixel[3] > 0) {
            fillColor = `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
        }
    } catch (_) {}

    ctx.fillStyle = fillColor;
    ctx.fillRect(x, y, w, h);
}

// ─── Rendering Page, Text Layer & Annotations ───────────────────
async function renderCurrentPage() {
    if (!pdfDocJs) return;

    const pageText = `${currentPage} / ${totalPages}`;
    const pageNavEl = document.getElementById('pageNavText');
    const previewNavEl = document.getElementById('previewPageNavText');
    if (pageNavEl) pageNavEl.textContent = pageText;
    if (previewNavEl) previewNavEl.textContent = pageText;
    const page = await pdfDocJs.getPage(currentPage);
    const baseViewport = page.getViewport({ scale: 1.0 });

    // 1. Render Base PDF Canvas at High-DPI (Crisp, zero-blur preview like genuine printed document)
    const dpr = Math.max(2, window.devicePixelRatio || 1);
    pageDpr = dpr;
    const bgCanvas = document.getElementById('pdfBgCanvas');
    bgCanvas.width  = Math.round(baseViewport.width * dpr);
    bgCanvas.height = Math.round(baseViewport.height * dpr);
    bgCanvas.style.width  = `${baseViewport.width}px`;
    bgCanvas.style.height = `${baseViewport.height}px`;

    const renderViewport = page.getViewport({ scale: dpr });
    const bgCtx = bgCanvas.getContext('2d');
    bgCtx.imageSmoothingEnabled = true;
    bgCtx.imageSmoothingQuality = 'high';
    await page.render({ canvasContext: bgCtx, viewport: renderViewport }).promise;

    // 2. Erase any deleted elements from bgCanvas!
    if (pageEdits[currentPage]?.deletedElements) {
        pageEdits[currentPage].deletedElements.forEach(delItem => {
            if (delItem.rect) eraseRectFromBgCanvas(delItem.rect);
        });
    }

    // 3. Render Text Layer for in-place text selection & modification
    await renderInteractiveTextLayer(page, baseViewport);

    // 4. Freehand Drawing Canvas
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

    // 5. Interactive Overlay Elements (Erase original spots from bgCanvas)
    const overlay = document.getElementById('annotationOverlay');
    overlay.style.width  = baseViewport.width + 'px';
    overlay.style.height = baseViewport.height + 'px';
    overlay.innerHTML = '';

    if (pageEdits[currentPage]?.elements) {
        pageEdits[currentPage].elements.forEach(item => {
            if (item.origRect) {
                eraseRectFromBgCanvas(item.origRect);
            }
            renderOverlayElement(item);
        });
    }

    renderDetectedImagesForCurrentPage();
    applyZoom();
    updateHistoryButtons();
    updateThumbnailActiveState();
    updateRightSidebarLayersList();
}

// ─── Sidebar Thumbnails Engine ──────────────────────────────────
async function renderSidebarThumbnails() {
    const sidebarList = document.getElementById('sidebarPagesList');
    const countEl = document.getElementById('sidebarPageCount');
    if (!sidebarList) return;

    sidebarList.innerHTML = '';
    if (countEl) countEl.textContent = totalPages;

    for (let p = 1; p <= totalPages; p++) {
        const card = document.createElement('div');
        card.className = `sidebar-page-card ${p === currentPage ? 'active' : ''}`;
        card.dataset.page = p;
        card.title = `Halaman ${p}`;
        card.onclick = () => switchPage(p);

        const canvas = document.createElement('canvas');
        canvas.className = 'sidebar-page-thumb';
        card.appendChild(canvas);

        const badge = document.createElement('span');
        badge.className = 'sidebar-page-badge';
        badge.textContent = `Hal ${p}`;
        card.appendChild(badge);

        sidebarList.appendChild(card);

        renderThumbnailCanvas(p, canvas);
    }
}

async function renderThumbnailCanvas(pageNum, canvas) {
    if (!pdfDocJs) return;
    try {
        const page = await pdfDocJs.getPage(pageNum);
        const vp = page.getViewport({ scale: 0.22 });
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch (err) {
        console.warn('Thumbnail canvas note:', err);
    }
}

function switchPage(pageNum) {
    if (pageNum === currentPage || pageNum < 1 || pageNum > totalPages) return;
    saveCurrentPageEdits();
    currentPage = pageNum;
    deselectAllElements();
    renderCurrentPage();
}

function updateThumbnailActiveState() {
    const cards = document.querySelectorAll('.sidebar-page-card');
    cards.forEach(c => {
        const p = parseInt(c.dataset.page, 10);
        const isActive = (p === currentPage);
        c.classList.toggle('active', isActive);
        if (isActive) {
            c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

// ─── Document Elements Inspection Engine (Text & Images) ────────
async function inspectDocumentElements(file) {
    if (!file || file.size > 4.2 * 1024 * 1024 || navigator.onLine === false) return;
    try {
        const arrayBuf = await file.arrayBuffer();
        const pdfBase64 = arrayBufferToBase64(arrayBuf);
        const res = await fetch('/api/true_edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'inspect',
                pdfBase64: pdfBase64
            })
        });
        if (!res.ok) return;
        const json = await res.json();
        if (json.status === 'ok' && json.pages) {
            json.pages.forEach(p => {
                detectedPageElements[p.page + 1] = {
                    textBlocks: p.textBlocks || [],
                    imageBlocks: p.imageBlocks || []
                };
            });
            renderDetectedImagesForCurrentPage();
        }
    } catch (err) {
        console.warn('Inspection note:', err);
    }
}

function renderDetectedImagesForCurrentPage() {
    const pageData = detectedPageElements[currentPage];
    if (!pageData || !pageData.imageBlocks || pageData.imageBlocks.length === 0) return;
    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [], deletedElements: [] };
    if (!pageEdits[currentPage].deletedElements) pageEdits[currentPage].deletedElements = [];

    const deleted = pageEdits[currentPage].deletedElements;
    const existingElements = pageEdits[currentPage].elements || [];
    const bgCanvas = document.getElementById('pdfBgCanvas');
    if (!bgCanvas) return;
    const ctx = bgCanvas.getContext('2d');

    pageData.imageBlocks.forEach((img, idx) => {
        const isDeleted = deleted.some(d => d.action === 'delete_image' && d.xref === img.xref);
        const isAdded = existingElements.some(el => el.origXref === img.xref || el.id === `orig_img_${currentPage}_${idx}`);
        if (isDeleted || isAdded) return;

        const dpr = pageDpr || 1;
        const rect = img.rect; // [x0, y0, x1, y1]
        const x = Math.max(0, Math.floor(rect[0]));
        const y = Math.max(0, Math.floor(rect[1]));
        const w = Math.max(16, Math.ceil(rect[2] - rect[0]));
        const h = Math.max(16, Math.ceil(rect[3] - rect[1]));

        // Extract image pixels from canvas into real image element at HiDPI resolution
        let dataUrl = '';
        try {
            const canvasX = Math.round(x * dpr);
            const canvasY = Math.round(y * dpr);
            const canvasW = Math.min(bgCanvas.width - canvasX, Math.round(w * dpr));
            const canvasH = Math.min(bgCanvas.height - canvasY, Math.round(h * dpr));
            const imgData = ctx.getImageData(canvasX, canvasY, canvasW, canvasH);
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvasW;
            tempCanvas.height = canvasH;
            tempCanvas.getContext('2d').putImageData(imgData, 0, 0);
            dataUrl = tempCanvas.toDataURL('image/png');
        } catch (err) {
            console.warn('Canvas extract note:', err);
        }

        // Erase original image from background canvas so it does NOT stay underneath!
        eraseRectFromBgCanvas(rect);

        const imgItem = {
            id: `orig_img_${currentPage}_${idx}`,
            type: 'image',
            dataUrl: dataUrl,
            x: x,
            y: y,
            width: w,
            height: h,
            origRect: [rect[0], rect[1], rect[2], rect[3]],
            origXref: img.xref,
            isOriginalImage: true,
            wasMoved: false
        };

        pageEdits[currentPage].elements.push(imgItem);
        renderOverlayElement(imgItem);
    });
}

// ─── Font Detection Helper for 1-to-1 Match ──────────────────────
function detectFontProperties(fontName, styleObj) {
    const rawName = (fontName || '').toLowerCase();
    const cssFamily = (styleObj?.fontFamily || '').toLowerCase();

    let fontFamily = 'Arial, sans-serif';
    if (rawName.includes('times') || rawName.includes('serif') || rawName.includes('garamond') || rawName.includes('georgia') || rawName.includes('cambria') || cssFamily.includes('serif')) {
        fontFamily = "'Times New Roman', serif";
    } else if (rawName.includes('courier') || rawName.includes('mono') || rawName.includes('consolas') || cssFamily.includes('monospace')) {
        fontFamily = "'Courier New', monospace";
    } else if (rawName.includes('comic')) {
        fontFamily = "'Comic Sans MS', cursive";
    } else if (rawName.includes('georgia')) {
        fontFamily = "Georgia, serif";
    } else if (rawName.includes('calibri')) {
        fontFamily = "Calibri, Arial, sans-serif";
    } else if (rawName.includes('helvetica') || rawName.includes('arial') || rawName.includes('sans') || cssFamily.includes('sans-serif')) {
        fontFamily = "Arial, sans-serif";
    } else if (styleObj?.fontFamily) {
        fontFamily = styleObj.fontFamily;
    }

    const isBold = rawName.includes('bold') || rawName.includes('black') || rawName.includes('heavy') || rawName.includes('semibold') || rawName.includes('demi') || (styleObj?.fontWeight >= 600);
    const isItalic = rawName.includes('italic') || rawName.includes('oblique') || rawName.includes('slanted') || styleObj?.fontStyle === 'italic';

    return { fontFamily, isBold, isItalic };
}

// ─── Interactive Text Layer Detection ───────────────────────────
async function renderInteractiveTextLayer(page, viewport) {
    const textLayerDiv = document.getElementById('pdfTextLayer');
    if (!textLayerDiv) return;
    textLayerDiv.innerHTML = '';
    textLayerDiv.style.width  = viewport.width + 'px';
    textLayerDiv.style.height = viewport.height + 'px';

    // Click anywhere on text layer to place a new text box if not clicking a specific span
    textLayerDiv.onclick = (e) => {
        if (e.target !== textLayerDiv) return;
        const rect = textLayerDiv.getBoundingClientRect();
        const clickX = (e.clientX - rect.left) * (textLayerDiv.offsetWidth / rect.width);
        const clickY = (e.clientY - rect.top) * (textLayerDiv.offsetHeight / rect.height);
        replaceExistingPdfText('Teks baru...', clickX, clickY, 140, 20, 16);
    };

    try {
        const textContent = await page.getTextContent();
        textContent.items.forEach(item => {
            if (!item.str || item.str.trim() === '') return;

            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const fontHeight = Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]) || 16;
            const left = tx[4];
            const top  = tx[5] - fontHeight;
            const width = item.width * viewport.scale;
            const height = fontHeight * 1.15;

            const styleObj = (textContent.styles && textContent.styles[item.fontName]) ? textContent.styles[item.fontName] : null;
            const detected = detectFontProperties(item.fontName, styleObj);

            // Check if this text is already lifted into an editable element or deleted
            const isAlreadyLifted = pageEdits[currentPage]?.elements?.some(el => el.isTrueEdit && el.origRect && Math.abs(el.origRect[0] - left) < 5 && Math.abs(el.origRect[1] - top) < 5);
            const isAlreadyDeleted = pageEdits[currentPage]?.deletedElements?.some(del => del.rect && Math.abs(del.rect[0] - left) < 5 && Math.abs(del.rect[1] - top) < 5);

            if (isAlreadyLifted || isAlreadyDeleted) return;

            const span = document.createElement('span');
            span.className = 'pdf-text-item';
            span.style.left   = `${left}px`;
            span.style.top    = `${top}px`;
            span.style.width  = `${width}px`;
            span.style.height = `${height}px`;
            span.title = `Klik untuk pilih / edit / hapus teks: "${item.str}"`;

            span.onclick = (e) => {
                e.stopPropagation();
                replaceExistingPdfText(item.str, left, top, width, height, fontHeight, span, detected, tx[5]);
            };

            textLayerDiv.appendChild(span);
        });
    } catch (err) {
        console.warn('Text layer extraction note:', err);
    }
}

function replaceExistingPdfText(originalText, exactLeft, exactTop, width, height, fontSize, clickedSpan, detectedFont, origBaselineY) {
    saveStateForUndo();
    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [], deletedElements: [] };

    // Precise unconstrained font size and box dimensions with generous anti-wrapping buffer
    const cleanFontSize = Math.max(6, Math.round((fontSize || 16) * 10) / 10);
    const textBuffer = Math.max(22, Math.ceil(cleanFontSize * 1.5));
    const boxW = Math.max(16, Math.ceil(width + textBuffer));
    const boxH = Math.ceil(height || cleanFontSize * 1.25);

    // Exact erase rect bounding box for glyphs
    const origRect = [exactLeft, exactTop, exactLeft + Math.ceil(width), exactTop + Math.ceil(height || cleanFontSize * 1.15)];

    // 1. Physically erase the glyphs from the background canvas!
    eraseRectFromBgCanvas(origRect);

    // Hide the clicked span in text layer so it doesn't trigger duplicate replacement
    if (clickedSpan) {
        clickedSpan.style.display = 'none';
    }

    // 2. Position element with transparent background (pure in-place editing, no white sticker!)
    const posX = Math.max(0, Math.round(exactLeft));
    const posY = Math.max(0, Math.round(exactTop));

    const fontFam = detectedFont?.fontFamily || textSettings.fontFamily || 'Arial, sans-serif';
    const isBold = (detectedFont?.isBold !== undefined) ? detectedFont.isBold : textSettings.isBold;
    const isItalic = (detectedFont?.isItalic !== undefined) ? detectedFont.isItalic : textSettings.isItalic;

    const replaceItem = {
        id: 'replace_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        type: 'text',
        content: originalText,
        x: posX,
        y: posY,
        fontFamily: fontFam,
        fontSize: cleanFontSize,
        color: '#000000',
        isBold: isBold,
        isItalic: isItalic,
        isUnderline: false,
        align: 'left',
        hasBg: false, // Pure transparent! No white sticker!
        width: boxW,
        height: boxH,
        isTrueEdit: true,
        origRect: origRect,
        origText: originalText,
        origBaseline: origBaselineY !== undefined ? origBaselineY : (posY + cleanFontSize),
        pageIndex: currentPage - 1
    };

    pageEdits[currentPage].elements.push(replaceItem);
    renderOverlayElement(replaceItem);
    selectElement(replaceItem.id);
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
    if (!viewport || !bgCanvas) return;

    const baseW = parseFloat(bgCanvas.style.width) || (bgCanvas.width / (pageDpr || 1));
    if (!baseW) return;

    const availableWidth = viewport.clientWidth - 56;
    const fitScale = +(availableWidth / baseW).toFixed(2);
    currentZoom = Math.max(0.4, Math.min(2.5, fitScale));
    applyZoom();
}

function applyZoom() {
    const stage = document.getElementById('canvasStage');
    const display = document.getElementById('zoomDisplay');
    const previewDisplay = document.getElementById('previewZoomDisplay');
    if (stage) {
        stage.style.transform = `scale(${currentZoom})`;
    }
    const zoomText = `${Math.round(currentZoom * 100)}%`;
    if (display) display.textContent = zoomText;
    if (previewDisplay) previewDisplay.textContent = zoomText;

    if (selectedElementId) {
        const el = document.getElementById(selectedElementId);
        const item = getElementById(selectedElementId);
        if (el && item) updateActionCardPosition(el, item);
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
        isUnderline: textSettings.isUnderline,
        align: textSettings.align || 'left',
        hasBg: withBg || textSettings.hasBg,
        width: 150,
        height: Math.round(fontSize * 1.25 + 4)
    };

    pageEdits[currentPage].elements.push(textItem);
    renderOverlayElement(textItem);
    selectElement(textItem.id);

    const domEl = document.getElementById(textItem.id);
    if (domEl) {
        enableTextEditing(domEl, textItem);
    }
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

function toggleTextUnderline() {
    const item = getElementById(selectedElementId);
    const nextVal = item ? !item.isUnderline : !textSettings.isUnderline;
    textSettings.isUnderline = nextVal;
    updateSelectedTextProp('isUnderline', nextVal);
    document.getElementById('textUnderlineBtn')?.classList.toggle('active', nextVal);
}

function setTextAlign(align) {
    textSettings.align = align;
    updateSelectedTextProp('align', align);
    ['Left', 'Center', 'Right'].forEach(dir => {
        document.getElementById(`textAlign${dir}Btn`)?.classList.toggle('active', dir.toLowerCase() === align);
    });
}

function duplicateSelectedElement() {
    if (!selectedElementId) return;
    const item = getElementById(selectedElementId);
    if (!item) return;
    saveStateForUndo();

    const clone = JSON.parse(JSON.stringify(item));
    clone.id = item.type + '_' + Date.now();
    clone.x = (clone.x || 60) + 20;
    clone.y = (clone.y || 60) + 20;

    // If cloning original text/image, mark clone as new standalone annotation
    clone.isTrueEdit = false;
    clone.isOriginalImage = false;
    delete clone.origRect;
    delete clone.origText;
    delete clone.origXref;

    pageEdits[currentPage].elements.push(clone);
    renderOverlayElement(clone);
    selectElement(clone.id);
}

function bringSelectedForward() {
    if (!selectedElementId || !pageEdits[currentPage]?.elements) return;
    saveStateForUndo();
    const els = pageEdits[currentPage].elements;
    const idx = els.findIndex(e => e.id === selectedElementId);
    if (idx !== -1 && idx < els.length - 1) {
        const temp = els[idx];
        els[idx] = els[idx + 1];
        els[idx + 1] = temp;
        refreshOverlayZIndexes();
    }
}

function sendSelectedBackward() {
    if (!selectedElementId || !pageEdits[currentPage]?.elements) return;
    saveStateForUndo();
    const els = pageEdits[currentPage].elements;
    const idx = els.findIndex(e => e.id === selectedElementId);
    if (idx > 0) {
        const temp = els[idx];
        els[idx] = els[idx - 1];
        els[idx - 1] = temp;
        refreshOverlayZIndexes();
    }
}

function refreshOverlayZIndexes() {
    if (!pageEdits[currentPage]?.elements) return;
    pageEdits[currentPage].elements.forEach((el, index) => {
        const domEl = document.getElementById(el.id);
        if (domEl) domEl.style.zIndex = 10 + index;
    });
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
        textDiv.style.textDecoration = item.isUnderline ? 'underline' : 'none';
        textDiv.style.textAlign  = item.align || 'left';
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
    el.className = `anno-element anno-${item.type}${item.isTrueEdit ? ' is-trueedit' : ''}${item.isOriginalImage ? ' is-original' : ''}`;
    el.style.left = item.x + 'px';
    el.style.top  = item.y + 'px';

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
        const isMulti = item.content && item.content.includes('\n');
        textDiv.className = 'editable-text-content' + (isMulti ? ' is-multiline' : '');
        textDiv.contentEditable = 'false'; // Start in object selection mode
        textDiv.spellcheck = false;
        textDiv.style.fontFamily = item.fontFamily || textSettings.fontFamily;
        textDiv.style.fontSize   = (item.fontSize || textSettings.fontSize) + 'px';
        textDiv.style.color      = item.color || textSettings.color;
        textDiv.style.fontWeight = item.isBold ? '700' : 'normal';
        textDiv.style.fontStyle  = item.isItalic ? 'italic' : 'normal';
        textDiv.style.textDecoration = item.isUnderline ? 'underline' : 'none';
        textDiv.style.textAlign  = item.align || 'left';
        textDiv.innerText = item.content || '';

        // Prevent native HTML5 dragghost on text
        el.addEventListener('dragstart', (e) => e.preventDefault());
        textDiv.addEventListener('dragstart', (e) => e.preventDefault());

        textDiv.addEventListener('input', () => {
            item.content = textDiv.innerText;
            if (item.content.includes('\n')) {
                textDiv.classList.add('is-multiline');
            }
            if (textDiv.scrollWidth > el.offsetWidth - 6) {
                const newW = textDiv.scrollWidth + 16;
                el.style.width = newW + 'px';
                item.width = newW;
            } else {
                item.width  = el.offsetWidth;
            }
            item.height = el.offsetHeight;
        });

        textDiv.addEventListener('blur', () => {
            disableTextEditing(el, item);
        });

        el.appendChild(textDiv);

    } else if (item.type === 'image') {
        el.style.width  = item.width + 'px';
        el.style.height = item.height + 'px';
        el.style.opacity = item.opacity !== undefined ? item.opacity : 1.0;
        if (item.isOriginalImage) {
            el.title = 'Gambar Dokumen Asli (Geser untuk pindah posisi, ubah ukuran, atau klik ✕ untuk hapus)';
        }
        
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

// ─── Text In-Place Editing Helpers ──────────────────────────────
function enableTextEditing(el, item) {
    if (!el || item.type !== 'text') return;
    const textDiv = el.querySelector('.editable-text-content');
    if (!textDiv) return;

    el.classList.add('is-editing');
    textDiv.contentEditable = 'true';
    textDiv.focus();

    const range = document.createRange();
    range.selectNodeContents(textDiv);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

function disableTextEditing(el, item) {
    if (!el) return;
    const textDiv = el.querySelector('.editable-text-content');
    if (textDiv) {
        textDiv.contentEditable = 'false';
        item.content = textDiv.innerText.trim() || ' ';
        item.width   = el.offsetWidth;
        item.height  = el.offsetHeight;
    }
    el.classList.remove('is-editing');
}

// ─── Drag & Resize Interaction Handlers ─────────────────────────
function attachElementInteractions(el, item) {
    const textContentEl = el.querySelector('.editable-text-content');

    // Double-click directly enters text editing
    if (item.type === 'text') {
        el.addEventListener('dblclick', (e) => {
            if (e.target.classList.contains('anno-handle')) return;
            e.stopPropagation();
            selectElement(item.id);
            enableTextEditing(el, item);
        });
    }

    el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('anno-handle')) {
            return;
        }

        const wasAlreadySelected = (selectedElementId === item.id);
        const isEditingNow = el.classList.contains('is-editing');

        selectElement(item.id);

        let startX = e.clientX;
        let startY = e.clientY;
        let initX  = item.x;
        let initY  = item.y;
        let isMoving = false;

        const onMouseMove = (moveEvt) => {
            const dx = (moveEvt.clientX - startX) / currentZoom;
            const dy = (moveEvt.clientY - startY) / currentZoom;
            const dist = Math.hypot(dx, dy);

            if (dist > 3) {
                if (!isMoving) {
                    isMoving = true;
                    saveStateForUndo();
                    if (isEditingNow) {
                        disableTextEditing(el, item);
                    }
                    window.getSelection()?.removeAllRanges();
                }
                item.x = Math.max(0, initX + dx);
                item.y = Math.max(0, initY + dy);
                el.style.left = item.x + 'px';
                el.style.top  = item.y + 'px';
                updateActionCardPosition(el, item);
            }
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            if (isMoving) {
                item.width  = el.offsetWidth;
                item.height = el.offsetHeight;
                updateActionCardPosition(el, item);
            } else {
                // If clicked without dragging:
                // If already selected and it's a text box, enter in-place text editing!
                if (wasAlreadySelected && item.type === 'text' && !isEditingNow) {
                    enableTextEditing(el, item);
                }
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
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
                updateActionCardPosition(el, item);

                if (item.type === 'shape') {
                    const svgWrap = el.querySelector('.shape-svg-wrap');
                    if (svgWrap) svgWrap.innerHTML = renderShapeSVG(item);
                }
            };

            const onResizeUp = () => {
                item.width  = el.offsetWidth;
                item.height = el.offsetHeight;
                updateActionCardPosition(el, item);
                document.removeEventListener('mousemove', onResizeMove);
                document.removeEventListener('mouseup', onResizeUp);
            };

            document.addEventListener('mousemove', onResizeMove);
            document.addEventListener('mouseup', onResizeUp);
        });
    });
}

// ─── Floating Action Card Engine (iLovePDF Style: [Edit | Delete]) ───
function updateActionCardPosition(el, item) {
    const card = document.getElementById('annoActionCard');
    if (!card || !el) return;

    // Position card centered horizontally above element
    const centerX = el.offsetLeft + (el.offsetWidth / 2);
    let topY = el.offsetTop - 40;
    if (topY < 6) {
        // If too close to top border, position below element
        topY = el.offsetTop + el.offsetHeight + 8;
    }

    card.style.left = centerX + 'px';
    card.style.top  = topY + 'px';

    const editBtn = document.getElementById('actionCardEditBtn');
    const divider = document.getElementById('actionCardDivider');
    if (editBtn && divider) {
        if (item && item.type === 'text') {
            editBtn.style.display = 'inline-flex';
            divider.style.display = 'block';
        } else {
            editBtn.style.display = 'none';
            divider.style.display = 'none';
        }
    }

    card.classList.remove('hidden');
}

function hideActionCard() {
    const card = document.getElementById('annoActionCard');
    if (card) card.classList.add('hidden');
}

function onActionCardEditClick(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    if (!selectedElementId) return;
    const item = getElementById(selectedElementId);
    const el = document.getElementById(selectedElementId);
    if (el && item) {
        enableTextEditing(el, item);
    }
}

function onActionCardDeleteClick(e) {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    if (!selectedElementId) return;
    deleteSelectedElement(selectedElementId);
}

function selectElement(id) {
    selectedElementId = id;
    const item = getElementById(id);
    document.querySelectorAll('.anno-element').forEach(el => {
        el.classList.toggle('selected', el.id === id);
    });
    const selectedEl = id ? document.getElementById(id) : null;
    if (selectedEl && item) {
        updateActionCardPosition(selectedEl, item);
    } else {
        hideActionCard();
    }
    showPropsForSelectedElement();
    updateRightSidebarLayersList();
}

function deselectAllElements() {
    selectedElementId = null;
    hideActionCard();
    document.querySelectorAll('.anno-element').forEach(el => {
        el.classList.remove('selected');
        if (el.classList.contains('is-editing')) {
            const item = getElementById(el.id);
            if (item) disableTextEditing(el, item);
        }
    });
    const propBars = ['propsText', 'propsShape', 'propsImage', 'propsWhiteout'];
    propBars.forEach(id => document.getElementById(id)?.classList.add('hidden'));
    const badgeWrap = document.getElementById('trueEditBadgeWrap');
    if (badgeWrap) badgeWrap.style.display = 'none';
    updateRightSidebarLayersList();
}

function deleteSelectedElement(targetId) {
    const idToDelete = targetId || selectedElementId;
    if (!idToDelete) return;
    saveStateForUndo();

    if (!pageEdits[currentPage]) pageEdits[currentPage] = { elements: [], deletedElements: [] };
    if (!pageEdits[currentPage].deletedElements) pageEdits[currentPage].deletedElements = [];

    const item = getElementById(idToDelete);
    if (item) {
        if (item.isTrueEdit && item.origRect) {
            // Register original text deletion for PyMuPDF vector redaction
            pageEdits[currentPage].deletedElements.push({
                action: 'delete_text',
                page: currentPage - 1,
                rect: item.origRect,
                origText: item.origText
            });
        } else if (item.isOriginalImage && item.origRect) {
            // Register original image deletion for PyMuPDF image stream removal
            pageEdits[currentPage].deletedElements.push({
                action: 'delete_image',
                page: currentPage - 1,
                rect: item.origRect,
                xref: item.origXref
            });
        }
    }

    if (pageEdits[currentPage]?.elements) {
        pageEdits[currentPage].elements = pageEdits[currentPage].elements.filter(e => e.id !== idToDelete);
    }
    const domEl = document.getElementById(idToDelete);
    if (domEl) domEl.remove();
    hideActionCard();
    deselectAllElements();
    updateRightSidebarLayersList();
}

// ─── Right Sidebar Layers List Engine (iLovePDF Style) ──────────
function updateRightSidebarLayersList() {
    const listEl = document.getElementById('rightLayersList');
    const countEl = document.getElementById('activeElementsCount');
    if (!listEl) return;

    const elements = pageEdits[currentPage]?.elements || [];
    if (countEl) countEl.textContent = elements.length;

    if (elements.length === 0) {
        listEl.innerHTML = '<div class="layers-empty-state"><span>Belum ada objek editan</span></div>';
        return;
    }

    listEl.innerHTML = '';
    elements.forEach(el => {
        const itemDiv = document.createElement('div');
        itemDiv.className = `right-layer-item ${el.id === selectedElementId ? 'active' : ''}`;
        itemDiv.title = 'Klik untuk pilih objek ini';
        itemDiv.onclick = (e) => {
            e.stopPropagation();
            selectElement(el.id);
        };

        let icon = '🔤';
        let label = 'Teks';
        if (el.type === 'image') {
            icon = '🖼️';
            label = el.isOriginalImage ? 'Gambar Asli' : 'Foto Sisipan';
        } else if (el.type === 'whiteout') {
            icon = '⬜';
            label = 'Tip-Ex Putih';
        } else if (el.type === 'shape') {
            icon = '🔷';
            label = `Bentuk (${el.shapeType || 'Shape'})`;
        } else if (el.content) {
            label = el.content.trim().slice(0, 20) || 'Teks Kosong';
        }

        const leftWrap = document.createElement('div');
        leftWrap.style.display = 'flex';
        leftWrap.style.alignItems = 'center';
        leftWrap.style.gap = '6px';
        leftWrap.style.overflow = 'hidden';
        leftWrap.innerHTML = `<span>${icon}</span><span class="layer-item-title">${escapeHtml(label)}</span>`;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'layer-item-del';
        delBtn.title = 'Hapus layer ini';
        delBtn.innerHTML = '🗑️';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteSelectedElement(el.id);
        };

        itemDiv.appendChild(leftWrap);
        itemDiv.appendChild(delBtn);
        listEl.appendChild(itemDiv);
    });
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[m]);
}

function syncOutputName(val) {
    const mainOut = document.getElementById('outputName');
    const sideOut = document.getElementById('outputNameSidebar');
    if (mainOut && mainOut.value !== val) mainOut.value = val;
    if (sideOut && sideOut.value !== val) sideOut.value = val;
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
        deletedElements: JSON.parse(JSON.stringify(pageEdits[currentPage]?.deletedElements || [])),
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
        deletedElements: JSON.parse(JSON.stringify(pageEdits[currentPage]?.deletedElements || [])),
        drawingDataUrl: drawCanvas ? drawCanvas.toDataURL() : ''
    };
    redoStack.push(currentSnapshot);

    const prevState = undoStack.pop();
    if (!pageEdits[prevState.page]) pageEdits[prevState.page] = { elements: [], deletedElements: [] };
    pageEdits[prevState.page].elements = prevState.elements;
    pageEdits[prevState.page].deletedElements = prevState.deletedElements || [];
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
        deletedElements: JSON.parse(JSON.stringify(pageEdits[currentPage]?.deletedElements || [])),
        drawingDataUrl: drawCanvas ? drawCanvas.toDataURL() : ''
    };
    undoStack.push(currentSnapshot);

    const nextState = redoStack.pop();
    if (!pageEdits[nextState.page]) pageEdits[nextState.page] = { elements: [], deletedElements: [] };
    pageEdits[nextState.page].elements = nextState.elements;
    pageEdits[nextState.page].deletedElements = nextState.deletedElements || [];
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

// ─── TrueEdit Engine & High-Resolution Export Engine ───────────

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

async function callTrueEditEngine(file, edits) {
    if (file.size > 4.2 * 1024 * 1024) {
        throw new Error('File melebihi limit Serverless 4.2 MB.');
    }

    const arrayBuf = await file.arrayBuffer();
    const pdfBase64 = arrayBufferToBase64(arrayBuf);

    const response = await fetch('/api/true_edit', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            pdfBase64: pdfBase64,
            edits: edits
        })
    });

    if (!response.ok) {
        let errDetail = 'Serverless status ' + response.status;
        try {
            const errJson = await response.json();
            if (errJson.error) errDetail = errJson.error;
        } catch (_) {}
        throw new Error(errDetail);
    }

    return await response.arrayBuffer();
}

// ─── Pure Vector Shape Renderer for PDFLib ──────────────────────
function drawShapeOnPdfLib(page, pageH, el, rgb) {
    const strokeCol = hexToRgb01(el.strokeColor || '#ef4444');
    let fillCol = null;
    let fillOpacity = 1;
    if (el.fillType === 'solid' && el.fillColor) {
        fillCol = hexToRgb01(el.fillColor);
    } else if (el.fillType === 'solid') {
        fillCol = strokeCol;
    } else if (el.fillType === 'semi') {
        fillCol = strokeCol;
        fillOpacity = 0.25;
    }

    const strokeW = el.strokeWidth || 3;
    const x = el.x;
    const y = pageH - (el.y + el.height);
    const w = el.width;
    const h = el.height;

    if (el.shapeType === 'rect') {
        page.drawRectangle({
            x, y, width: w, height: h,
            borderColor: rgb(strokeCol.r, strokeCol.g, strokeCol.b),
            borderWidth: strokeW,
            color: fillCol ? rgb(fillCol.r, fillCol.g, fillCol.b) : undefined,
            opacity: fillCol ? fillOpacity : undefined
        });
    } else if (el.shapeType === 'circle') {
        page.drawEllipse({
            x: x + w / 2,
            y: y + h / 2,
            xScale: w / 2,
            yScale: h / 2,
            borderColor: rgb(strokeCol.r, strokeCol.g, strokeCol.b),
            borderWidth: strokeW,
            color: fillCol ? rgb(fillCol.r, fillCol.g, fillCol.b) : undefined,
            opacity: fillCol ? fillOpacity : undefined
        });
    } else if (el.shapeType === 'line') {
        page.drawLine({
            start: { x: x, y: y + h / 2 },
            end: { x: x + w, y: y + h / 2 },
            thickness: strokeW,
            color: rgb(strokeCol.r, strokeCol.g, strokeCol.b)
        });
    } else if (el.shapeType === 'arrow') {
        page.drawLine({
            start: { x: x, y: y + h / 2 },
            end: { x: x + w - 10, y: y + h / 2 },
            thickness: strokeW,
            color: rgb(strokeCol.r, strokeCol.g, strokeCol.b)
        });
        page.drawLine({
            start: { x: x + w - 12, y: y + h / 2 + 6 },
            end: { x: x + w, y: y + h / 2 },
            thickness: strokeW,
            color: rgb(strokeCol.r, strokeCol.g, strokeCol.b)
        });
        page.drawLine({
            start: { x: x + w - 12, y: y + h / 2 - 6 },
            end: { x: x + w, y: y + h / 2 },
            thickness: strokeW,
            color: rgb(strokeCol.r, strokeCol.g, strokeCol.b)
        });
    } else if (el.shapeType === 'check') {
        page.drawLine({
            start: { x: x + w * 0.15, y: y + h * 0.5 },
            end: { x: x + w * 0.4, y: y + h * 0.25 },
            thickness: strokeW * 1.5,
            color: rgb(strokeCol.r, strokeCol.g, strokeCol.b)
        });
        page.drawLine({
            start: { x: x + w * 0.4, y: y + h * 0.25 },
            end: { x: x + w * 0.85, y: y + h * 0.8 },
            thickness: strokeW * 1.5,
            color: rgb(strokeCol.r, strokeCol.g, strokeCol.b)
        });
    } else if (el.shapeType === 'cross') {
        page.drawLine({
            start: { x: x + w * 0.2, y: y + h * 0.8 },
            end: { x: x + w * 0.8, y: y + h * 0.2 },
            thickness: strokeW * 1.5,
            color: rgb(strokeCol.r, strokeCol.g, strokeCol.b)
        });
        page.drawLine({
            start: { x: x + w * 0.8, y: y + h * 0.8 },
            end: { x: x + w * 0.2, y: y + h * 0.2 },
            thickness: strokeW * 1.5,
            color: rgb(strokeCol.r, strokeCol.g, strokeCol.b)
        });
    }
}

// ─── 100% Pure Native Vector PDF Export (Zero JPEG Flattening) ──
async function exportPureVectorPDF(basePdfBytes) {
    const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;
    const pdfDoc = await PDFDocument.load(basePdfBytes);
    
    // Embed standard core vector fonts (crisp at 1000% zoom, searchable text)
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const helveticaBoldOblique = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
    const timesFont = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const courierFont = await pdfDoc.embedFont(StandardFonts.Courier);

    const numPages = pdfDoc.getPageCount();

    for (let p = 1; p <= numPages; p++) {
        const page = pdfDoc.getPage(p - 1);
        const { width: pageW, height: pageH } = page.getSize();
        const edits = pageEdits[p];
        if (!edits) continue;

        // 1. Freehand drawings: embed as transparent high-res PNG layer
        if (edits.drawingDataUrl) {
            try {
                const pngBytes = await fetch(edits.drawingDataUrl).then(r => r.arrayBuffer());
                const pngImage = await pdfDoc.embedPng(pngBytes);
                page.drawImage(pngImage, {
                    x: 0,
                    y: 0,
                    width: pageW,
                    height: pageH
                });
            } catch (drawErr) {
                console.warn('Drawing overlay note:', drawErr);
            }
        }

        // 2. Vector annotations & Whiteouts
        for (const el of (edits.elements || [])) {
            // If it's a detected original image that wasn't moved, skip (already in PDF)
            if (el.isOriginalImage && !el.wasMoved) continue;
            // If it's an original text that was handled by serverless TrueEdit redaction, skip
            if (el.isTrueEdit && el.handledByServer) continue;

            if (el.type === 'whiteout') {
                page.drawRectangle({
                    x: el.x,
                    y: pageH - (el.y + el.height),
                    width: el.width,
                    height: el.height,
                    color: rgb(1, 1, 1),
                    borderWidth: 0
                });
            } else if (el.type === 'text') {
                if (el.hasBg) {
                    page.drawRectangle({
                        x: el.x,
                        y: pageH - (el.y + el.height),
                        width: el.width,
                        height: el.height,
                        color: rgb(1, 1, 1)
                    });
                }

                let chosenFont = helveticaFont;
                if (el.fontFamily && el.fontFamily.toLowerCase().includes('times')) {
                    chosenFont = timesFont;
                } else if (el.fontFamily && el.fontFamily.toLowerCase().includes('courier')) {
                    chosenFont = courierFont;
                } else {
                    if (el.isBold && el.isItalic) chosenFont = helveticaBoldOblique;
                    else if (el.isBold) chosenFont = helveticaBold;
                    else if (el.isItalic) chosenFont = helveticaOblique;
                    else chosenFont = helveticaFont;
                }

                const col = hexToRgb01(el.color || '#0f172a');
                const fontSize = el.fontSize || 16;
                const rawContent = el.content !== undefined ? String(el.content) : '';
                const lines = rawContent.split('\n');
                const lineHeight = fontSize * 1.25;

                lines.forEach((line, lIdx) => {
                    let lineWidth = 0;
                    try { lineWidth = chosenFont.widthOfTextAtSize(line, fontSize); } catch (_) {}

                    let textX = el.x;
                    if (el.align === 'center') {
                        textX = el.x + Math.max(0, (el.width - lineWidth) / 2);
                    } else if (el.align === 'right') {
                        textX = el.x + Math.max(0, el.width - lineWidth);
                    }

                    // Exact baseline calculation: use original font baseline to prevent any upward/downward shifting
                    let baselineFromTop = (el.y + (fontSize * 0.95));
                    if (el.origBaseline !== undefined) {
                        const yShift = el.origRect ? (el.y - el.origRect[1]) : 0;
                        baselineFromTop = el.origBaseline + yShift;
                    }
                    const textY = pageH - (baselineFromTop + (lIdx * lineHeight));

                    page.drawText(line, {
                        x: textX,
                        y: textY,
                        size: fontSize,
                        font: chosenFont,
                        color: rgb(col.r, col.g, col.b)
                    });

                    if (el.isUnderline && lineWidth > 0) {
                        page.drawLine({
                            start: { x: textX, y: textY - 2 },
                            end: { x: textX + lineWidth, y: textY - 2 },
                            thickness: Math.max(1, fontSize * 0.07),
                            color: rgb(col.r, col.g, col.b)
                        });
                    }
                });
            } else if (el.type === 'image') {
                try {
                    let embeddedImg;
                    if (el.dataUrl && el.dataUrl.startsWith('data:image/png')) {
                        const bytes = await fetch(el.dataUrl).then(r => r.arrayBuffer());
                        embeddedImg = await pdfDoc.embedPng(bytes);
                    } else if (el.dataUrl) {
                        const bytes = await fetch(el.dataUrl).then(r => r.arrayBuffer());
                        embeddedImg = await pdfDoc.embedJpg(bytes);
                    }
                    if (embeddedImg) {
                        page.drawImage(embeddedImg, {
                            x: el.x,
                            y: pageH - (el.y + el.height),
                            width: el.width,
                            height: el.height,
                            opacity: el.opacity !== undefined ? el.opacity : 1.0,
                            rotate: el.rotation ? degrees(-el.rotation) : undefined
                        });
                    }
                } catch (imgErr) {
                    console.warn('Image embedding note:', imgErr);
                }
            } else if (el.type === 'shape') {
                drawShapeOnPdfLib(page, pageH, el, rgb);
            }
        }
    }

    const finalBytes = await pdfDoc.save();
    return new Blob([finalBytes], { type: 'application/pdf' });
}

// ─── Build Export PDF Blob (Stream Redactions + Pure Vector Overlays) ─
async function buildExportPdfBlob() {
    const serverEdits = [];
    let hasEditsRequiringServer = false;

    for (let p = 1; p <= totalPages; p++) {
        const pEdits = pageEdits[p];
        if (!pEdits) continue;

        // 1. Collect deleted original text and images
        if (pEdits.deletedElements && pEdits.deletedElements.length > 0) {
            pEdits.deletedElements.forEach(delItem => {
                serverEdits.push({
                    page: p - 1,
                    action: delItem.action, // 'delete_text' or 'delete_image'
                    rect: delItem.rect,
                    origText: delItem.origText,
                    xref: delItem.xref
                });
                hasEditsRequiringServer = true;
            });
        }

        // 2. Collect moved/edited original texts and moved original images
        if (pEdits.elements && pEdits.elements.length > 0) {
            pEdits.elements.forEach(el => {
                if (el.isTrueEdit && el.origRect) {
                    const origR = el.origRect;
                    const targetLeft = el.x;
                    const targetTop  = el.y;
                    const targetRight = targetLeft + (el.width || (origR[2] - origR[0]));
                    const targetBottom = targetTop + (el.height || (origR[3] - origR[1]));

                    serverEdits.push({
                        page: p - 1,
                        action: 'edit_text',
                        rect: origR,
                        targetRect: [targetLeft, targetTop, targetRight, targetBottom],
                        origBaseline: el.origBaseline,
                        newText: el.content || '',
                        fontFamily: el.fontFamily || textSettings.fontFamily,
                        fontSize: el.fontSize || 16,
                        color: el.color || '#0f172a',
                        bold: !!el.isBold,
                        italic: !!el.isItalic,
                        useWhiteout: false
                    });
                    el.handledByServer = true;
                    hasEditsRequiringServer = true;
                } else if (el.isOriginalImage && el.origRect) {
                    const origR = el.origRect;
                    const isMoved = Math.abs(el.x - origR[0]) > 3 || Math.abs(el.y - origR[1]) > 3;
                    if (isMoved) {
                        el.wasMoved = true;
                        serverEdits.push({
                            page: p - 1,
                            action: 'move_image',
                            rect: origR,
                            targetRect: [el.x, el.y, el.x + el.width, el.y + el.height],
                            xref: el.origXref
                        });
                        hasEditsRequiringServer = true;
                    }
                }
            });
        }
    }

    let basePdfBytes = await pdfFile.arrayBuffer();

    // If there are stream redactions / deletions / moves, call serverless PyMuPDF TrueEdit engine
    if (hasEditsRequiringServer && pdfFile.size <= 4.2 * 1024 * 1024 && navigator.onLine !== false) {
        try {
            showProgress(35, 'Menjalankan TrueEdit Engine di Vercel (Hapus Teks/Gambar Asli & Vektor)...');
            basePdfBytes = await callTrueEditEngine(pdfFile, serverEdits);
            showProgress(70, 'Stream redaction & move berhasil...');
        } catch (err) {
            console.warn('TrueEdit Engine server error, proceeding with vector overlay:', err);
            for (let p = 1; p <= totalPages; p++) {
                if (pageEdits[p]?.elements) {
                    pageEdits[p].elements.forEach(el => { el.handledByServer = false; });
                }
            }
        }
    }

    // Export 100% Pure Vector PDF via PDFLib! ZERO JPEG FLATTENING!
    showProgress(85, 'Menyusun dokumen Pure Vector PDF...');
    return await exportPureVectorPDF(basePdfBytes);
}

async function saveEditedPDF() {
    if (!pdfFile || !pdfDocJs) return;
    saveCurrentPageEdits();

    const rawName = document.getElementById('outputName').value.trim() || 'edited_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const saveBtn = document.getElementById('saveBtn');
    const topSaveBtn = document.getElementById('topSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    if (topSaveBtn) topSaveBtn.disabled = true;

    try {
        const finalBlob = await buildExportPdfBlob();

        showProgress(95, 'Menyiapkan unduhan...');
        const url = URL.createObjectURL(finalBlob);
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
        if (saveBtn) saveBtn.disabled = false;
        if (topSaveBtn) topSaveBtn.disabled = false;
    }
}

async function saveEditedToGDrive() {
    if (!pdfFile || !pdfDocJs) return;
    saveCurrentPageEdits();

    const rawName = document.getElementById('outputName').value.trim() || 'edited_document';
    const outputName = (rawName.endsWith('.pdf') ? rawName : rawName + '.pdf');
    const saveBtn = document.getElementById('saveBtn');
    const topSaveBtn = document.getElementById('topSaveBtn');
    const gdriveBtn = document.getElementById('saveGDriveBtn');
    if (saveBtn) saveBtn.disabled = true;
    if (topSaveBtn) topSaveBtn.disabled = true;
    if (gdriveBtn) gdriveBtn.disabled = true;

    try {
        const finalBlob = await buildExportPdfBlob();

        showProgress(85, 'Mengunggah ke Google Drive...');
        uploadBlobToGDrive({
            blob: finalBlob,
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
        if (saveBtn) saveBtn.disabled = false;
        if (topSaveBtn) topSaveBtn.disabled = false;
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

    const totalTextH = Math.max(lines.length * lineHeight, (fontSizePx + 4) * scaleFactor);

    const boxW = el.width ? (el.width * scaleFactor) : maxLineWidth;
    const boxH = el.height ? (el.height * scaleFactor) : totalTextH;

    // If Whiteout or Background is enabled, draw crisp white rect
    if (el.hasBg) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(el.x * scaleFactor, el.y * scaleFactor, boxW, boxH);
    }

    ctx.fillStyle = el.color || '#0f172a';
    
    // Exact baseline offset: font baseline
    let baselineOffset = (fontSizePx * 0.95) * scaleFactor;
    if (el.origBaseline !== undefined && el.origRect) {
        baselineOffset = (el.origBaseline - el.origRect[1]) * scaleFactor;
    }
    
    lines.forEach((line, idx) => {
        let textX = el.x * scaleFactor;
        if (el.align === 'center') {
            textX = (el.x * scaleFactor) + Math.max(0, (boxW - (ctx.measureText(line).width)) / 2);
        } else if (el.align === 'right') {
            textX = (el.x * scaleFactor) + Math.max(0, boxW - (ctx.measureText(line).width));
        }
        ctx.fillText(line, textX, (el.y * scaleFactor) + baselineOffset + (idx * lineHeight));
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
