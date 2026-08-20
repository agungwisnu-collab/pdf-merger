/** ============================================================
 *  gdrive-picker.js — Google Drive Picker Integration Helper
 * ============================================================ */

let gdriveTokenClient = null;
let gdriveAccessToken = null;
let isGapiLoaded      = false;
let isGisInited       = false;

// ─── Memuat Script Google API & Identity Services Dinamis ───
function loadGoogleScripts() {
    return new Promise((resolve) => {
        let loadedCount = 0;
        const checkDone = () => {
            loadedCount++;
            if (loadedCount === 2) resolve();
        };

        if (window.gapi) {
            loadedCount++;
        } else {
            const scriptGapi = document.createElement('script');
            scriptGapi.src = 'https://apis.google.com/js/api.js';
            scriptGapi.async = true;
            scriptGapi.defer = true;
            scriptGapi.onload = () => {
                window.gapi.load('picker', () => {
                    isGapiLoaded = true;
                    checkDone();
                });
            };
            document.head.appendChild(scriptGapi);
        }

        if (window.google?.accounts?.oauth2) {
            loadedCount++;
        } else {
            const scriptGis = document.createElement('script');
            scriptGis.src = 'https://accounts.google.com/gsi/client';
            scriptGis.async = true;
            scriptGis.defer = true;
            scriptGis.onload = () => {
                isGisInited = true;
                checkDone();
            };
            document.head.appendChild(scriptGis);
        }

        if (loadedCount === 2) resolve();
    });
}

// ─── Inisialisasi Token Client OAuth 2.0 ─────────────────────
function initTokenClient(config, callback) {
    if (!window.google?.accounts?.oauth2) return;

    gdriveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: config.CLIENT_ID,
        scope: config.SCOPES || 'https://www.googleapis.com/auth/drive.readonly',
        callback: async (response) => {
            if (response.error !== undefined) {
                console.error('OAuth Error:', response);
                hideGDriveLoading();
                alert('Gagal autentikasi Google: ' + response.error);
                return;
            }
            gdriveAccessToken = response.access_token;
            if (callback) callback(gdriveAccessToken);
        },
    });
}

// ─── Buka Google Picker ─────────────────────────────────────
/**
 * @param {Object} options
 * @param {string[]} options.mimeTypes - Contoh: ['application/pdf'] atau ['image/*']
 * @param {boolean} options.multiSelect - true untuk multi file, false untuk single
 * @param {Function} options.onFilesSelected - callback menerima array File objects
 */
async function openGDrivePicker(options = {}) {
    const config = getGDriveConfig();

    // Jika Client ID atau API Key belum diisi, tampilkan dialog konfigurasi
    if (!config.CLIENT_ID || !config.API_KEY) {
        showGDriveConfigModal(() => openGDrivePicker(options));
        return;
    }

    showGDriveLoading('Menghubungkan ke Google Drive...');

    try {
        await loadGoogleScripts();

        // Siapkan token client jika belum ada
        initTokenClient(config, (token) => {
            createPicker(token, config, options);
        });

        // Request token jika belum punya token aktif
        if (!gdriveAccessToken) {
            // Minta akses (akan memunculkan popup otorisasi Google jika pertama kali)
            gdriveTokenClient.requestAccessToken({ prompt: '' });
        } else {
            createPicker(gdriveAccessToken, config, options);
        }
    } catch (err) {
        hideGDriveLoading();
        console.error('Gagal membuka Google Picker:', err);
        alert('Gagal memuat Google Picker: ' + err.message);
    }
}

// ─── Buat Instansiasi Picker ────────────────────────────────
function createPicker(token, config, options) {
    hideGDriveLoading();

    const mimeTypes = options.mimeTypes || ['application/pdf'];
    const multiSelect = options.multiSelect !== false;

    const docsView = new google.picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);

    // Set tipe file yang bisa dipilih
    if (mimeTypes.length === 1 && mimeTypes[0] === 'image/*') {
        docsView.setMimeTypes('image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp');
    } else if (mimeTypes.length > 0) {
        docsView.setMimeTypes(mimeTypes.join(','));
    }

    // Project Number (appId) diambil dari APP_ID atau prefix Client ID
    const appId = (/^\d+$/.test(config.APP_ID) ? config.APP_ID : config.CLIENT_ID?.split('-')[0]) || '';

    const builder = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setAppId(appId)
        .setOAuthToken(token)
        .addView(docsView)
        .addView(new google.picker.DocsUploadView())
        .setDeveloperKey(config.API_KEY)
        .setLocale('id')
        .setCallback(async (data) => {
            if (data.action === google.picker.Action.PICKED) {
                const docs = data.docs;
                if (!docs || docs.length === 0) return;
                await processPickedDocs(docs, token, options.onFilesSelected);
            } else if (data.action === google.picker.Action.CANCEL) {
                hideGDriveLoading();
            }
        });

    if (multiSelect) {
        builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
    }

    // Origin domain yang diizinkan
    builder.setOrigin(window.location.protocol + '//' + window.location.host);

    const picker = builder.build();
    picker.setVisible(true);
}

// ─── Download File dari Google Drive & Ubah ke Objek File ────
async function processPickedDocs(docs, token, onFilesSelected) {
    showGDriveLoading(`Mengunduh ${docs.length} file dari Google Drive... (0/${docs.length})`);

    const files = [];
    let completed = 0;

    for (const doc of docs) {
        try {
            completed++;
            showGDriveLoading(`Mengunduh: ${doc.name} (${completed}/${docs.length})...`);

            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}: Gagal mengunduh file ${doc.name}`);
            }

            const blob = await res.blob();
            // Buat objek File standar
            const file = new File([blob], doc.name, {
                type: doc.mimeType || blob.type || 'application/pdf',
                lastModified: doc.lastEditedUtc || Date.now(),
            });

            files.push(file);
        } catch (err) {
            console.error(`Error download file ${doc.name}:`, err);
            alert(`Gagal mengunduh "${doc.name}": ${err.message}`);
        }
    }

    hideGDriveLoading();

    if (files.length > 0 && typeof onFilesSelected === 'function') {
        onFilesSelected(files);
    }
}

// ─── Modal Loading & Progress UI ────────────────────────────
function showGDriveLoading(text = 'Memproses Google Drive...') {
    let overlay = document.getElementById('gdriveLoadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'gdriveLoadingOverlay';
        overlay.className = 'gdrive-overlay';
        overlay.innerHTML = `
            <div class="gdrive-loading-box">
                <div class="gdrive-spinner"></div>
                <p id="gdriveLoadingText">${text}</p>
            </div>
        `;
        document.body.appendChild(overlay);
    } else {
        document.getElementById('gdriveLoadingText').textContent = text;
        overlay.classList.remove('hidden');
    }
}

function hideGDriveLoading() {
    const overlay = document.getElementById('gdriveLoadingOverlay');
    if (overlay) overlay.classList.add('hidden');
}

// ─── Modal Konfigurasi / Pengaturan Kredensial ───────────────
function showGDriveConfigModal(onSavedCallback) {
    let modal = document.getElementById('gdriveConfigModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'gdriveConfigModal';
        modal.className = 'gdrive-modal-backdrop';
        modal.innerHTML = `
            <div class="gdrive-modal-card">
                <div class="gdrive-modal-header">
                    <div class="gdrive-modal-title">
                        <span>⚙️ Konfigurasi Google Drive API</span>
                    </div>
                    <button class="gdrive-modal-close" onclick="closeGDriveConfigModal()">✕</button>
                </div>
                <div class="gdrive-modal-body">
                    <div class="gdrive-guide-banner">
                        <p><strong>💡 Cara Mendapatkan Kredensial Google:</strong></p>
                        <ol>
                            <li>Buka <strong><a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a></strong> dan buat project baru.</li>
                            <li>Aktifkan <strong>Google Drive API</strong> dan <strong>Google Picker API</strong> di menu <em>APIs & Services > Library</em>.</li>
                            <li>Buat <strong>API Key</strong> di <em>Credentials > Create Credentials > API key</em>.</li>
                            <li>Buat <strong>OAuth 2.0 Client ID</strong> (tipe <em>Web application</em>). Tambahkan <code>${window.location.origin}</code> pada <strong>Authorized JavaScript origins</strong>.</li>
                        </ol>
                    </div>

                    <div class="gdrive-field">
                        <label for="gdriveInputClientId">OAuth Client ID <span class="req">*</span></label>
                        <input type="text" id="gdriveInputClientId" placeholder="contoh: 123456789-abc.apps.googleusercontent.com" />
                    </div>

                    <div class="gdrive-field">
                        <label for="gdriveInputApiKey">Google API Key <span class="req">*</span></label>
                        <input type="text" id="gdriveInputApiKey" placeholder="contoh: AIzaSyD..." />
                    </div>

                    <div class="gdrive-field">
                        <label for="gdriveInputAppId">Project Number / App ID (Opsional)</label>
                        <input type="text" id="gdriveInputAppId" placeholder="contoh: 123456789012" />
                    </div>
                </div>
                <div class="gdrive-modal-footer">
                    <button class="btn btn-secondary-sm" onclick="closeGDriveConfigModal()">Batal</button>
                    <button class="btn btn-primary" id="gdriveSaveBtn">💾 Simpan Konfigurasi</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const config = getGDriveConfig();
    document.getElementById('gdriveInputClientId').value = config.CLIENT_ID || '';
    document.getElementById('gdriveInputApiKey').value   = config.API_KEY || '';
    document.getElementById('gdriveInputAppId').value    = config.APP_ID || '';

    modal.classList.remove('hidden');

    document.getElementById('gdriveSaveBtn').onclick = () => {
        const clientId = document.getElementById('gdriveInputClientId').value.trim();
        const apiKey   = document.getElementById('gdriveInputApiKey').value.trim();
        const appId    = document.getElementById('gdriveInputAppId').value.trim();

        if (!clientId || !apiKey) {
            alert('Harap isi Client ID dan API Key terlebih dahulu.');
            return;
        }

        saveGDriveConfig(clientId, apiKey, appId);
        modal.classList.add('hidden');
        alert('✅ Konfigurasi Google Drive berhasil disimpan!');

        if (typeof onSavedCallback === 'function') {
            onSavedCallback();
        }
    };
}

function closeGDriveConfigModal() {
    const modal = document.getElementById('gdriveConfigModal');
    if (modal) modal.classList.add('hidden');
}

// ─── Destination Modal (Pilih Root atau Folder) ───────────────
function showGDriveDestinationModal(filename, onSelect) {
    let modal = document.getElementById('gdriveDestModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'gdriveDestModal';
        modal.className = 'gdrive-modal-backdrop';
        modal.innerHTML = `
            <div class="gdrive-modal-card" style="max-width: 480px;">
                <div class="gdrive-modal-header">
                    <div class="gdrive-modal-title" style="display: flex; align-items: center; gap: 8px;">
                        <svg viewBox="0 0 87.3 78" style="width: 22px; height: 20px;" xmlns="http://www.w3.org/2000/svg"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>
                        <span>Simpan ke Google Drive</span>
                    </div>
                    <button class="gdrive-modal-close" onclick="closeGDriveDestModal()">✕</button>
                </div>
                <div class="gdrive-modal-body">
                    <p style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 4px;">
                        File <strong id="gdriveDestFilename" style="color: var(--primary);">document.pdf</strong> siap disimpan.
                    </p>
                    <p style="font-size: 0.85rem; color: var(--text-subtle); margin-bottom: 12px;">
                        Pilih lokasi tujuan penyimpanan di Google Drive Anda:
                    </p>
                    <div class="gdrive-dest-options">
                        <button class="gdrive-dest-card" id="destRootOption">
                            <span style="font-size: 1.8rem;">🏠</span>
                            <div>
                                <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">Drive Saya (Halaman Utama)</div>
                                <div style="font-size: 0.8rem; color: var(--text-muted);">Simpan langsung di root folder utama Google Drive</div>
                            </div>
                        </button>
                        <button class="gdrive-dest-card" id="destFolderOption">
                            <span style="font-size: 1.8rem;">📂</span>
                            <div>
                                <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">Pilih Folder Tertentu...</div>
                                <div style="font-size: 0.8rem; color: var(--text-muted);">Buka penjelajah folder untuk memilih folder tujuan</div>
                            </div>
                        </button>
                    </div>
                </div>
                <div class="gdrive-modal-footer">
                    <button class="btn btn-secondary-sm" onclick="closeGDriveDestModal()">Batal</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('gdriveDestFilename').textContent = filename;
    modal.classList.remove('hidden');

    document.getElementById('destRootOption').onclick = () => {
        closeGDriveDestModal();
        onSelect({ type: 'root' });
    };

    document.getElementById('destFolderOption').onclick = () => {
        closeGDriveDestModal();
        onSelect({ type: 'folder' });
    };
}

function closeGDriveDestModal() {
    const modal = document.getElementById('gdriveDestModal');
    if (modal) modal.classList.add('hidden');
    hideGDriveLoading();
}

// ─── Buka Google Picker untuk Memilih Folder ───────────────────
function openGDriveFolderPicker(token, config, onFolderSelected, onCancel) {
    const docsView = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder');

    const appId = (/^\d+$/.test(config.APP_ID) ? config.APP_ID : config.CLIENT_ID?.split('-')[0]) || '';

    const builder = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setAppId(appId)
        .setOAuthToken(token)
        .addView(docsView)
        .setDeveloperKey(config.API_KEY)
        .setLocale('id')
        .setTitle('Pilih Folder Tujuan Penyimpanan')
        .setOrigin(window.location.protocol + '//' + window.location.host)
        .setCallback((data) => {
            if (data.action === google.picker.Action.PICKED) {
                const doc = data.docs?.[0];
                if (doc) onFolderSelected({ id: doc.id, name: doc.name });
            } else if (data.action === google.picker.Action.CANCEL) {
                if (onCancel) onCancel();
                hideGDriveLoading();
            }
        });

    const picker = builder.build();
    picker.setVisible(true);
}

// ─── Upload File Blob ke Google Drive via REST API v3 ──────────
/**
 * Upload file Blob langsung ke Google Drive pengguna dengan opsi pemilihan folder
 * @param {Object} options
 * @param {Blob} options.blob - File Blob yang akan diupload
 * @param {string} options.filename - Nama file di Google Drive
 * @param {string} options.mimeType - Tipe MIME file (default: 'application/pdf')
 * @param {Function} options.onProgress - Callback progres upload (persen, teks)
 * @param {Function} options.onSuccess - Callback sukses ({ id, name, webViewLink, folderName })
 * @param {Function} options.onError - Callback gagal (error)
 */
async function uploadBlobToGDrive(options = {}) {
    const config = getGDriveConfig();
    if (!config.CLIENT_ID || !config.API_KEY) {
        showGDriveConfigModal(() => uploadBlobToGDrive(options));
        return;
    }

    const { blob, filename, mimeType = 'application/pdf', onProgress, onSuccess, onError } = options;
    if (!blob) {
        const err = new Error('File tidak ditemukan.');
        if (onError) onError(err);
        else alert(err.message);
        return;
    }

    // Tampilkan dialog pilihan folder penyimpanan (Root atau Folder Tertentu)
    showGDriveDestinationModal(filename, async (destChoice) => {
        if (onProgress) onProgress(10, 'Menghubungkan ke Google Drive...');
        showGDriveLoading('Menghubungkan ke Google Drive...');

        try {
            await loadGoogleScripts();

            const executeUpload = async (token, folderId = null, folderName = null) => {
                try {
                    const targetDesc = folderName ? `ke folder "${folderName}"` : 'ke Drive Saya';
                    if (onProgress) onProgress(30, `Mengunggah ${targetDesc}...`);
                    showGDriveLoading(`Mengunggah "${filename}" ${targetDesc}...`);

                    const metadata = {
                        name: filename,
                        mimeType: mimeType,
                    };

                    if (folderId) {
                        metadata.parents = [folderId];
                    }

                    const boundary = '-------314159265358979323846';
                    const delimiter = "\r\n--" + boundary + "\r\n";
                    const close_delim = "\r\n--" + boundary + "--";

                    const metadataPart = delimiter +
                        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
                        JSON.stringify(metadata);

                    const arrayBuffer = await blob.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer);

                    const mediaHeader = delimiter +
                        'Content-Type: ' + mimeType + '\r\n\r\n';

                    const enc = new TextEncoder();
                    const part1 = enc.encode(metadataPart);
                    const part2 = enc.encode(mediaHeader);
                    const part4 = enc.encode(close_delim);

                    const combinedLength = part1.length + part2.length + uint8Array.length + part4.length;
                    const combinedBody = new Uint8Array(combinedLength);

                    let offset = 0;
                    combinedBody.set(part1, offset); offset += part1.length;
                    combinedBody.set(part2, offset); offset += part2.length;
                    combinedBody.set(uint8Array, offset); offset += uint8Array.length;
                    combinedBody.set(part4, offset);

                    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'multipart/related; boundary="' + boundary + '"',
                        },
                        body: combinedBody,
                    });

                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        throw new Error(errData.error?.message || `HTTP ${response.status}: Gagal mengunggah file`);
                    }

                    const result = await response.json();
                    result.folderName = folderName;
                    hideGDriveLoading();
                    if (onProgress) onProgress(100, 'Selesai diunggah ke Google Drive!');
                    if (onSuccess) onSuccess(result);
                    else {
                        alert(`✅ Berhasil disimpan ke Google Drive: ${result.name}`);
                    }
                } catch (uploadErr) {
                    hideGDriveLoading();
                    console.error('Error saat upload ke GDrive:', uploadErr);
                    if (onError) onError(uploadErr);
                    else alert('Gagal mengunggah ke Google Drive: ' + uploadErr.message);
                }
            };

            const handleTokenReady = (token) => {
                if (destChoice.type === 'folder') {
                    hideGDriveLoading();
                    openGDriveFolderPicker(token, config, (folder) => {
                        executeUpload(token, folder.id, folder.name);
                    }, () => {
                        if (onProgress) onProgress(0, '');
                    });
                } else {
                    executeUpload(token, null, null);
                }
            };

            initTokenClient(config, (token) => {
                handleTokenReady(token);
            });

            if (!gdriveAccessToken) {
                gdriveTokenClient.requestAccessToken({ prompt: '' });
            } else {
                handleTokenReady(gdriveAccessToken);
            }
        } catch (err) {
            hideGDriveLoading();
            if (onError) onError(err);
            else alert('Error Google Drive: ' + err.message);
        }
    });
}

