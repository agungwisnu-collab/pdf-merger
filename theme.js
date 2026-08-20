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
        if (btnElement) btnElement.classList.add('active');
        window.filterTools();
    };

    window.filterTools = function () {
        const searchInput = document.getElementById('toolSearchInput');
        const query = (searchInput?.value || '').toLowerCase().trim();
        const cards = document.querySelectorAll('.hub-tool-card');
        let visibleCount = 0;

        cards.forEach(card => {
            const cardCat = card.getAttribute('data-category');
            const cardKeywords = (card.getAttribute('data-keywords') || '').toLowerCase();
            const cardTitle = (card.querySelector('.hub-card-title')?.textContent || '').toLowerCase();
            const cardDesc = (card.querySelector('.hub-card-desc')?.textContent || '').toLowerCase();

            const matchesCategory = currentCategory === 'all' || cardCat === currentCategory;
            const matchesQuery = !query || cardTitle.includes(query) || cardDesc.includes(query) || cardKeywords.includes(query);

            if (matchesCategory && matchesQuery) {
                card.style.display = 'flex';
                visibleCount++;
            } else {
                card.style.display = 'none';
            }
        });

        // Handle empty state
        const grid = document.getElementById('toolsGrid');
        let emptyState = document.getElementById('toolsEmptyState');
        if (visibleCount === 0) {
            if (!emptyState && grid) {
                emptyState = document.createElement('div');
                emptyState.id = 'toolsEmptyState';
                emptyState.className = 'tools-empty-state';
                emptyState.innerHTML = `
                    <div style="font-size: 2.5rem; margin-bottom: 8px;">🔍</div>
                    <h3 style="font-size: 1.1rem; color: var(--text-main); margin-bottom: 4px;">Tidak ada alat yang cocok</h3>
                    <p style="font-size: 0.88rem;">Coba cari dengan kata kunci lain seperti <em>"split"</em>, <em>"word"</em>, <em>"putar"</em>, atau <em>"kunci"</em>.</p>
                `;
                grid.appendChild(emptyState);
            }
        } else if (emptyState) {
            emptyState.remove();
        }
    };
})();
