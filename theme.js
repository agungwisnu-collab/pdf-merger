/** ============================================================
 *  theme.js — Theme Controller (Dark/Light Mode), Navbar Mega Menu & PWA
 * ============================================================ */

(function () {
    const THEME_STORAGE_KEY = 'pdf_tools_theme';

    // 1. Terapkan tema sesegera mungkin untuk mencegah screen flash
    function getPreferredTheme() {
        const saved = localStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'dark' || saved === 'light') return saved;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    const currentTheme = getPreferredTheme();
    document.documentElement.setAttribute('data-theme', currentTheme);

    // 2. Fungsi Toggle Tema
    window.toggleTheme = function () {
        const activeTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', activeTheme);
        localStorage.setItem(THEME_STORAGE_KEY, activeTheme);
        updateThemeToggleIcons(activeTheme);
    };

    // 3. Update icon tema pada tombol
    function updateThemeToggleIcons(theme) {
        const toggleBtns = document.querySelectorAll('.theme-toggle-btn');
        toggleBtns.forEach(btn => {
            btn.innerHTML = theme === 'dark'
                ? '<span class="theme-icon">☀️</span><span class="theme-label">Light</span>'
                : '<span class="theme-icon">🌙</span><span class="theme-label">Dark</span>';
            btn.setAttribute('aria-label', theme === 'dark' ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap');
            btn.setAttribute('title', theme === 'dark' ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap');
        });
    }

    // 4. Tools Mega Menu Dropdown Toggle
    window.toggleToolsDropdown = function (e) {
        if (e) e.stopPropagation();
        const dropdown = document.querySelector('.nav-dropdown');
        if (dropdown) {
            dropdown.classList.toggle('open');
        }
    };

    // 5. Inisialisasi event saat DOM sudah siap
    document.addEventListener('DOMContentLoaded', () => {
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        updateThemeToggleIcons(theme);

        // Tutup dropdown menu saat klik di luar
        document.addEventListener('click', (e) => {
            const dropdown = document.querySelector('.nav-dropdown');
            if (dropdown && !dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });

        // Pantau perubahan preferensi tema sistem jika user belum menyetel manual
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem(THEME_STORAGE_KEY)) {
                const newTheme = e.matches ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', newTheme);
                updateThemeToggleIcons(newTheme);
            }
        });

        // 6. Register PWA Service Worker if supported
        if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
            navigator.serviceWorker.register('sw.js').catch((err) => {
                console.log('SW registration note:', err.message);
            });
        }

        // 7. Global Keyboard shortcut '/' to focus search input
        document.addEventListener('keydown', (e) => {
            if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                const searchInput = document.getElementById('toolSearchInput');
                if (searchInput) {
                    e.preventDefault();
                    searchInput.focus();
                    searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
    });

    // ─── Tools Hub Grid Search & Category Controller ───────────
    let currentCategory = 'all';

    window.setCategoryFilter = function (category, btnElement) {
        currentCategory = category;
        const pills = document.querySelectorAll('.category-pill');
        pills.forEach(p => p.classList.remove('active'));
        if (btnElement) {
            btnElement.classList.add('active');
            btnElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
        window.filterTools();
    };

    window.clearToolSearch = function () {
        const searchInput = document.getElementById('toolSearchInput');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
            window.filterTools();
        }
    };

    window.filterTools = function () {
        const searchInput = document.getElementById('toolSearchInput');
        const query = (searchInput?.value || '').toLowerCase().trim();
        const clearBtn = document.getElementById('clearSearchBtn');
        const badge = document.getElementById('searchKeyBadge');

        if (clearBtn && badge) {
            if (query.length > 0) {
                clearBtn.style.display = 'flex';
                badge.style.display = 'none';
            } else {
                clearBtn.style.display = 'none';
                badge.style.display = 'block';
            }
        }

        const sections = document.querySelectorAll('.category-section');
        let totalVisible = 0;

        sections.forEach(section => {
            const secCat = section.getAttribute('data-category');
            const cards = section.querySelectorAll('.hub-tool-card');
            let sectionVisibleCount = 0;

            // Jika sedang mencari (query ada), cari di semua kategori. Jika kosong, filter sesuai kategori aktif
            const categoryMatches = !query ? (currentCategory === 'all' || secCat === currentCategory) : true;

            cards.forEach(card => {
                const cardKeywords = (card.getAttribute('data-keywords') || '').toLowerCase();
                const cardTitle = (card.querySelector('.hub-card-title')?.textContent || '').toLowerCase();
                const cardDesc = (card.querySelector('.hub-card-desc')?.textContent || '').toLowerCase();

                const matchesQuery = !query || cardTitle.includes(query) || cardDesc.includes(query) || cardKeywords.includes(query);

                if (categoryMatches && matchesQuery) {
                    card.style.display = 'flex';
                    sectionVisibleCount++;
                    totalVisible++;
                } else {
                    card.style.display = 'none';
                }
            });

            // Sembunyikan section jika tidak ada kartu yang cocok atau kategori tidak sesuai
            if (sectionVisibleCount > 0 && categoryMatches) {
                section.style.display = 'block';
            } else {
                section.style.display = 'none';
            }
        });

        // Handle empty state across all sections
        const container = document.getElementById('toolsSectionContainer');
        let emptyState = document.getElementById('toolsEmptyState');
        if (totalVisible === 0) {
            if (!emptyState && container) {
                emptyState = document.createElement('div');
                emptyState.id = 'toolsEmptyState';
                emptyState.className = 'tools-empty-state';
                emptyState.style.textAlign = 'center';
                emptyState.style.padding = '40px 20px';
                emptyState.innerHTML = `
                    <div style="font-size: 2.8rem; margin-bottom: 12px;">🔍</div>
                    <h3 style="font-size: 1.15rem; color: var(--text-main); margin-bottom: 6px; font-weight: 700;">Tidak ada alat yang cocok</h3>
                    <p style="font-size: 0.9rem; color: var(--text-muted);">Coba cari dengan kata kunci lain seperti <em>"gabung"</em>, <em>"split"</em>, <em>"word"</em>, <em>"putar"</em>, atau <em>"kunci"</em>.</p>
                `;
                container.appendChild(emptyState);
            }
        } else if (emptyState) {
            emptyState.remove();
        }
    };

    // ============================================================
    // 8. Modern Global Toast & Notification System (Omni PDF)
    // ============================================================
    function getToastContainer() {
        let container = document.getElementById('omniToastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'omniToastContainer';
            container.className = 'omni-toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    window.showToast = function (message, type = 'info', duration = 3800) {
        if (!message) return;
        const msgStr = String(message);

        // Infer type if not explicitly set
        if (type === 'info') {
            if (msgStr.includes('✅') || msgStr.toLowerCase().includes('berhasil')) {
                type = 'success';
            } else if (msgStr.includes('❌') || msgStr.toLowerCase().includes('gagal') || msgStr.toLowerCase().includes('error')) {
                type = 'error';
            } else if (msgStr.includes('⚠️') || msgStr.toLowerCase().includes('peringatan')) {
                type = 'warning';
            }
        }

        // Clean redundant leading emojis if already matched
        let cleanMsg = msgStr.replace(/^[✅❌⚠️ℹ️💡]\s*/, '');

        const iconMap = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        const container = getToastContainer();
        const toast = document.createElement('div');
        toast.className = `omni-toast-card toast-${type}`;

        toast.innerHTML = `
            <div class="toast-icon">${iconMap[type] || 'ℹ️'}</div>
            <div class="toast-message">${cleanMsg}</div>
            <button class="toast-close-btn" aria-label="Tutup">✕</button>
        `;

        const closeBtn = toast.querySelector('.toast-close-btn');
        let dismissTimer = null;

        function dismissToast() {
            if (dismissTimer) clearTimeout(dismissTimer);
            toast.classList.add('dismissing');
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 260);
        }

        closeBtn.onclick = dismissToast;

        if (duration > 0) {
            dismissTimer = setTimeout(dismissToast, duration);
            toast.addEventListener('mouseenter', () => {
                if (dismissTimer) clearTimeout(dismissTimer);
            });
            toast.addEventListener('mouseleave', () => {
                dismissTimer = setTimeout(dismissToast, 1800);
            });
        }

        container.appendChild(toast);
        return toast;
    };

    // Intercept native browser alert to use modern Toast
    const nativeAlert = window.alert;
    window.alert = function (msg) {
        window.showToast(msg);
    };

    // ============================================================
    // 9. Modern Global Confirm Modal (Glassmorphism Dialog)
    // ============================================================
    window.showConfirmModal = function (options) {
        return new Promise((resolve) => {
            const opts = typeof options === 'string' ? { message: options } : (options || {});
            const title = opts.title || 'Konfirmasi Tindakan';
            const message = opts.message || 'Apakah Anda yakin ingin melanjutkan?';
            const confirmText = opts.confirmText || 'Lanjutkan';
            const cancelText = opts.cancelText || 'Batal';
            const isDanger = opts.danger !== false;

            let backdrop = document.getElementById('omniModalBackdrop');
            if (backdrop) backdrop.remove();

            backdrop = document.createElement('div');
            backdrop.id = 'omniModalBackdrop';
            backdrop.className = 'omni-modal-backdrop';

            backdrop.innerHTML = `
                <div class="omni-modal-card">
                    <div class="omni-modal-header">
                        <span class="omni-modal-icon">${isDanger ? '⚠️' : '❓'}</span>
                        <h3 class="omni-modal-title">${title}</h3>
                    </div>
                    <div class="omni-modal-body">
                        <p>${message}</p>
                    </div>
                    <div class="omni-modal-actions">
                        <button type="button" class="btn btn-secondary-sm modal-btn-cancel">${cancelText}</button>
                        <button type="button" class="btn ${isDanger ? 'btn-danger-outline' : 'btn-primary'} modal-btn-confirm">${confirmText}</button>
                    </div>
                </div>
            `;

            function closeModal(result) {
                backdrop.classList.add('closing');
                setTimeout(() => {
                    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
                    resolve(result);
                    if (result && typeof opts.onConfirm === 'function') opts.onConfirm();
                    if (!result && typeof opts.onCancel === 'function') opts.onCancel();
                }, 200);
            }

            backdrop.querySelector('.modal-btn-cancel').onclick = () => closeModal(false);
            backdrop.querySelector('.modal-btn-confirm').onclick = () => closeModal(true);

            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) closeModal(false);
            });

            document.addEventListener('keydown', function escHandler(e) {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', escHandler);
                    closeModal(false);
                }
            });

            document.body.appendChild(backdrop);
        });
    };
})();

