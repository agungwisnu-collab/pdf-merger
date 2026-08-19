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

    const builder = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setAppId(config.APP_ID || '')
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
