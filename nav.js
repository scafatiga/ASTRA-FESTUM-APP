// Astra Festum - Shell de navegación compartido (barra superior + menú + barra inferior)
(function () {
    // Los 5 accesos "más usados", fijos abajo (igual que la app de AppSheet).
    // Los href apuntan a páginas que iremos construyendo; de momento muestran "en construcción".
    const BOTTOM_ITEMS = [
        {
            label: 'Registro Ventas',
            href: '/cierre.html',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/></svg>'
        },
        {
            label: 'In-Out',
            href: '/inout.html',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>'
        },
        {
            label: 'Socios',
            href: '/socios.html',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
        },
        {
            label: 'Ingresos',
            href: '/ingresos.html',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v6h-6"/></svg>'
        },
        {
            label: 'Gastos Tarjeta',
            href: '/gastos-tarjeta.html',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>'
        }
    ];

    // Todo lo que ya está construido vive en el menú lateral (☰), para no mezclarlo
    // con los 5 accesos de arriba, que replican tal cual la barra de AppSheet.
    const MENU_ITEMS = [
        { label: 'Histórico de Cierres', href: '/historico.html' },
        { label: 'Puntos de Venta', href: '/puntos-venta.html' },
        { label: 'Proveedores', href: '/proveedores.html' },
        { label: 'Empleados', href: '/empleados.html' }
    ];

    function rutaActual() {
        return window.location.pathname;
    }

    function construirBarraSuperior() {
        const topbar = document.createElement('div');
        topbar.className = 'af-topbar';
        topbar.innerHTML = `
            <button id="afMenuBtn" class="af-menu-btn" aria-label="Abrir menú">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
                    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
            </button>
            <span class="af-topbar-title">ASTRA FESTUM</span>
        `;
        document.body.prepend(topbar);

        const overlay = document.createElement('div');
        overlay.id = 'afMenuOverlay';
        overlay.className = 'af-menu-overlay';
        overlay.innerHTML = `
            <div class="af-menu-panel">
                <div class="af-menu-header">
                    <span>Menú</span>
                    <button id="afMenuClose" aria-label="Cerrar menú">✕</button>
                </div>
                <nav class="af-menu-list">
                    ${MENU_ITEMS.map(item => `<a href="${item.href}" class="af-menu-link${rutaActual() === item.href ? ' active' : ''}">${item.label}</a>`).join('')}
                </nav>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('afMenuBtn').addEventListener('click', () => overlay.classList.add('open'));
        document.getElementById('afMenuClose').addEventListener('click', () => overlay.classList.remove('open'));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
    }

    function construirBarraInferior() {
        const nav = document.createElement('nav');
        nav.className = 'af-bottom-nav';
        nav.innerHTML = BOTTOM_ITEMS.map(item => {
            const activo = rutaActual() === item.href;
            return `
                <a href="${item.href}" class="af-bottom-item${activo ? ' active' : ''}">
                    ${item.icon}
                    <span class="af-bottom-label">${item.label}</span>
                </a>
            `;
        }).join('');
        document.body.appendChild(nav);
    }

    document.addEventListener('DOMContentLoaded', () => {
        construirBarraSuperior();
        construirBarraInferior();
        document.body.classList.add('af-has-shell');
    });
})();
