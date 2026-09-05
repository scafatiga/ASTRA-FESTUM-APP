// Astra Festum - Shell de navegación compartido (barra superior + menú + barra inferior)
(function () {
    // Los 5 accesos "más usados", fijos abajo (igual que la app de AppSheet).
    // "permiso" es la clave que debe estar en TRUE en los permisos del usuario para verlo.
    const BOTTOM_ITEMS = [
        {
            label: 'Registro Ventas',
            href: '/cierre.html',
            permiso: 'cierre',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/></svg>'
        },
        {
            label: 'In-Out',
            href: '/inout.html',
            permiso: 'inout',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>'
        },
        {
            label: 'Socios',
            href: '/socios.html',
            permiso: 'socios',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
        },
        {
            label: 'Ingresos',
            href: '/ingresos.html',
            permiso: 'ingresos',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v6h-6"/></svg>'
        },
        {
            label: 'Gastos Tarjeta',
            href: '/gastos-tarjeta.html',
            permiso: 'gastos_tarjeta',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>'
        }
    ];

    // Todo lo que ya está construido vive en el menú lateral (☰), para no mezclarlo
    // con los 5 accesos de arriba, que replican tal cual la barra de AppSheet.
    const MENU_ITEMS = [
        { label: 'Registro Cierres Diarios', href: '/cierre.html', permiso: 'cierre' },
        { label: 'Puntos de Venta', href: '/puntos-venta.html', permiso: 'puntos_venta' },
        { label: 'Proveedores', href: '/proveedores.html', permiso: 'proveedores' },
        { label: 'Empleados', href: '/empleados.html', permiso: 'empleados' },
        { label: 'Base Punto de Venta', href: '/base-punto-venta.html', permiso: 'base_punto_venta' },
        { label: 'Factura Cash', href: '/factura-cash.html', permiso: 'factura_cash' },
        { label: 'Insumos', href: '/productos.html', permiso: 'insumos' },
        { label: 'Albaranes', href: '/albaranes.html', permiso: 'albaranes' },
        { label: 'Tarifas de Sueldos', href: '/tarifas-sueldos.html', permiso: 'tarifas_sueldos' }
    ];

    function rutaActual() {
        return window.location.pathname;
    }

    function construirBarraSuperior(usuario) {
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

        const permisos = (usuario && usuario.permisos) || {};
        const itemsVisibles = usuario && usuario.es_admin
            ? MENU_ITEMS
            : MENU_ITEMS.filter(item => permisos[item.permiso]);

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
                    ${itemsVisibles.map(item => `<a href="${item.href}" class="af-menu-link${rutaActual() === item.href ? ' active' : ''}">${item.label}</a>`).join('')}
                </nav>
                <div class="af-menu-footer">
                    ${usuario ? `<div class="af-menu-usuario">${usuario.nombre}<br><span>${usuario.email}</span></div>` : ''}
                    ${usuario && usuario.es_admin ? `<button id="afMigrarR2Btn" class="af-logout-btn" style="background:#e5e7eb;color:#1f2937;margin-bottom:8px;">Migrar Archivos a R2</button>` : ''}
                    <button id="afCambiarPasswordBtn" class="af-logout-btn" style="background:#e5e7eb;color:#1f2937;margin-bottom:8px;">Cambiar Contraseña</button>
                    <button id="afLogoutBtn" class="af-logout-btn">Cerrar sesión</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Modal de cambio de contraseña (se inyecta una sola vez, fuera del menú lateral)
        const modalPassword = document.createElement('div');
        modalPassword.id = 'afModalPassword';
        modalPassword.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:60;align-items:center;justify-content:center;padding:16px;';
        modalPassword.innerHTML = `
            <div style="background:#fff;border-radius:8px;max-width:360px;width:100%;padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h2 style="font-size:1.1rem;font-weight:bold;color:#1f2937;margin:0;">Cambiar Contraseña</h2>
                    <button id="afCerrarModalPassword" style="background:none;border:none;font-size:1.25rem;color:#9ca3af;cursor:pointer;line-height:1;">✕</button>
                </div>
                <form id="afFormPassword" style="display:flex;flex-direction:column;gap:12px;">
                    <div>
                        <label style="display:block;font-size:0.875rem;font-weight:500;color:#374151;margin-bottom:4px;">Contraseña actual:</label>
                        <input type="password" id="afPasswordActual" required style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:8px;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="display:block;font-size:0.875rem;font-weight:500;color:#374151;margin-bottom:4px;">Contraseña nueva: <span style="font-weight:400;color:#6b7280;font-size:0.75rem;">(mínimo 8 caracteres)</span></label>
                        <input type="password" id="afPasswordNueva" required minlength="8" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:8px;box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="display:block;font-size:0.875rem;font-weight:500;color:#374151;margin-bottom:4px;">Repetir contraseña nueva:</label>
                        <input type="password" id="afPasswordNuevaRepetir" required minlength="8" style="width:100%;border:1px solid #d1d5db;border-radius:6px;padding:8px;box-sizing:border-box;">
                    </div>
                    <p id="afPasswordError" style="display:none;color:#dc2626;font-size:0.875rem;margin:0;"></p>
                    <button type="submit" style="width:100%;background:#2563eb;color:#fff;font-weight:500;padding:10px;border:none;border-radius:8px;cursor:pointer;">Guardar Contraseña</button>
                </form>
            </div>
        `;
        document.body.appendChild(modalPassword);

        document.getElementById('afCambiarPasswordBtn').addEventListener('click', () => {
            overlay.classList.remove('open');
            document.getElementById('afFormPassword').reset();
            document.getElementById('afPasswordError').style.display = 'none';
            modalPassword.style.display = 'flex';
        });
        document.getElementById('afCerrarModalPassword').addEventListener('click', () => {
            modalPassword.style.display = 'none';
        });
        document.getElementById('afFormPassword').addEventListener('submit', async (e) => {
            e.preventDefault();
            const errorEl = document.getElementById('afPasswordError');
            errorEl.style.display = 'none';

            const actual = document.getElementById('afPasswordActual').value;
            const nueva = document.getElementById('afPasswordNueva').value;
            const repetir = document.getElementById('afPasswordNuevaRepetir').value;

            if (nueva !== repetir) {
                errorEl.textContent = 'La contraseña nueva y su repetición no coinciden.';
                errorEl.style.display = 'block';
                return;
            }

            try {
                const res = await fetch('/api/cambiar-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password_actual: actual, password_nueva: nueva })
                });
                const resultado = await res.json();
                if (!res.ok) throw new Error(resultado.error || 'Error al cambiar la contraseña');

                alert('Contraseña actualizada correctamente.');
                modalPassword.style.display = 'none';
            } catch (err) {
                errorEl.textContent = err.message || 'No se pudo cambiar la contraseña.';
                errorEl.style.display = 'block';
            }
        });

        // --- Migrar Archivos a R2 (solo administrador) ---
        const btnMigrarR2 = document.getElementById('afMigrarR2Btn');
        if (btnMigrarR2) {
            btnMigrarR2.addEventListener('click', async () => {
                if (!confirm('Esto moverá a Cloudflare R2 todos los archivos que todavía estén guardados en la base de datos (fotos de DNI, comprobantes, facturas). Puede tardar unos minutos. ¿Continuar?')) return;

                overlay.classList.remove('open');
                btnMigrarR2.disabled = true;
                btnMigrarR2.textContent = 'Migrando...';

                const tablas = [
                    { ruta: '/api/admin/migrar-r2/empleados', nombre: 'Empleados (fotos DNI)' },
                    { ruta: '/api/admin/migrar-r2/ingresos', nombre: 'Ingresos (comprobantes)' },
                    { ruta: '/api/admin/migrar-r2/gastos-tarjeta', nombre: 'Gastos Tarjeta (facturas)' },
                    { ruta: '/api/admin/migrar-r2/factura-cash', nombre: 'Facturas Cash (facturas)' }
                ];

                let resumen = '';
                for (const tabla of tablas) {
                    try {
                        const res = await fetch(tabla.ruta, { method: 'POST' });
                        const datos = await res.json();
                        if (!res.ok) throw new Error(datos.error || 'Error desconocido');
                        resumen += `${tabla.nombre}: ${datos.migrados} migrado(s), ${datos.errores} error(es), de ${datos.total} encontrados.\n`;
                    } catch (err) {
                        resumen += `${tabla.nombre}: FALLÓ (${err.message})\n`;
                    }
                }

                alert('Migración a R2 terminada:\n\n' + resumen);
                btnMigrarR2.disabled = false;
                btnMigrarR2.textContent = 'Migrar Archivos a R2';
            });
        }

        document.getElementById('afMenuBtn').addEventListener('click', () => overlay.classList.add('open'));
        document.getElementById('afMenuClose').addEventListener('click', () => overlay.classList.remove('open'));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
        document.getElementById('afLogoutBtn').addEventListener('click', async () => {
            try {
                await fetch('/api/logout', { method: 'POST' });
            } catch (err) {
                console.error('Error al cerrar sesión:', err);
            }
            window.location.href = '/login.html';
        });
    }

    function construirBarraInferior(usuario) {
        const permisos = (usuario && usuario.permisos) || {};
        const itemsVisibles = usuario && usuario.es_admin
            ? BOTTOM_ITEMS
            : BOTTOM_ITEMS.filter(item => permisos[item.permiso]);
        if (itemsVisibles.length === 0) return;

        const nav = document.createElement('nav');
        nav.className = 'af-bottom-nav';
        nav.innerHTML = itemsVisibles.map(item => {
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

    document.addEventListener('DOMContentLoaded', async () => {
        let usuario = null;
        try {
            const res = await fetch('/api/me');
            if (res.ok) usuario = await res.json();
        } catch (err) {
            console.error('Error al cargar el usuario actual:', err);
        }

        construirBarraSuperior(usuario);
        construirBarraInferior(usuario);
        document.body.classList.add('af-has-shell');
    });
})();
