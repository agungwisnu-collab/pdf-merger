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
    });
})();
