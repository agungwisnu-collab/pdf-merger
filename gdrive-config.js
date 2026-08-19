/** ============================================================
 *  gdrive-config.js — Konfigurasi Google Drive API
 *  
 *  Anda dapat mengisi CLIENT_ID dan API_KEY langsung di sini,
 *  atau mengisinya melalui dialog pengaturan di website.
 * ============================================================ */

const GDRIVE_DEFAULT_CONFIG = {
    // Masukkan Client ID dari Google Cloud Console (OAuth 2.0 Client ID)
    // Contoh: "1234567890-abcdefg.apps.googleusercontent.com"
    CLIENT_ID: '',

    // Masukkan API Key dari Google Cloud Console
    // Contoh: "AIzaSyD-xxxxxxxxxxxxxxxxxxxxxxxxx"
    API_KEY: '',

    // Project Number (Opsional / App ID)
    APP_ID: '',

    // Scope untuk membaca file dari Google Drive
    SCOPES: 'https://www.googleapis.com/auth/drive.readonly',
};

// Mengambil konfigurasi aktif (prioritas dari localStorage jika pernah diinput lewat UI)
function getGDriveConfig() {
    const savedClientId = localStorage.getItem('gdrive_client_id');
    const savedApiKey   = localStorage.getItem('gdrive_api_key');
    const savedAppId    = localStorage.getItem('gdrive_app_id');

    return {
        CLIENT_ID: savedClientId || GDRIVE_DEFAULT_CONFIG.CLIENT_ID,
        API_KEY:   savedApiKey   || GDRIVE_DEFAULT_CONFIG.API_KEY,
        APP_ID:    savedAppId    || GDRIVE_DEFAULT_CONFIG.APP_ID,
        SCOPES:    GDRIVE_DEFAULT_CONFIG.SCOPES,
    };
}

// Menyimpan konfigurasi ke localStorage
function saveGDriveConfig(clientId, apiKey, appId = '') {
    if (clientId) localStorage.setItem('gdrive_client_id', clientId.trim());
    else localStorage.removeItem('gdrive_client_id');

    if (apiKey) localStorage.setItem('gdrive_api_key', apiKey.trim());
    else localStorage.removeItem('gdrive_api_key');

    if (appId) localStorage.setItem('gdrive_app_id', appId.trim());
    else localStorage.removeItem('gdrive_app_id');
}

// Menghapus konfigurasi dari localStorage
function clearGDriveConfig() {
    localStorage.removeItem('gdrive_client_id');
    localStorage.removeItem('gdrive_api_key');
    localStorage.removeItem('gdrive_app_id');
}
