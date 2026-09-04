document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formFactura');
    const tabla = document.getElementById('tablaFacturas');

    let puntosVentaCache = [];

    async function cargarPuntosVentaSelect() {
        try {
            const res = await fetch('/api/puntos-venta');
            if (!res.ok) throw new Error('Error al cargar puntos de venta');
            puntosVentaCache = await res.json();

            const opciones = puntosVentaCache.map(pv => `<option value="${pv.id}">${pv.nombre}</option>`).join('');
            document.getElementById('puntoVenta').innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
            document.getElementById('editPuntoVenta').innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
        } catch (err) {
            console.error('Error cargando puntos de venta:', err);
        }
    }

    function nombrePuntoVenta(id) {
        const pv = puntosVentaCache.find(p => String(p.id) === String(id));
        return pv ? pv.nombre : '-';
    }

    function formatearFecha(f) {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('es-ES');
    }

    function formatearFechaHora(f) {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }

    function formatearImporte(n) {
        return Number(n || 0).toFixed(2) + ' €';
    }

    // --- Colapsar / expandir la lista ---
    const btnToggleLista = document.getElementById('btnToggleLista');
    const listaWrapper = document.getElementById('listaFacturasWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Buscador en tiempo real (proveedor, punto de venta o importe) ---
    let facturasCache = [];
    document.getElementById('buscadorFacturas').addEventListener('input', (e) => {
        renderizarTablaFacturas(filtrarFacturas(e.target.value));
    });

    function filtrarFacturas(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return facturasCache;
        return facturasCache.filter(f => {
            const campos = [f.proveedor_nombre, nombrePuntoVenta(f.punto_venta_id), String(f.importe || '')];
            return campos.some(c => (c || '').toLowerCase().includes(q));
        });
    }

    // --- Cargar lista (ya viene ordenada de más nuevo a más antiguo desde el backend) ---
    async function cargarFacturas() {
        try {
            const res = await fetch('/api/factura-cash');
            if (!res.ok) throw new Error('Error al cargar las facturas');
            facturasCache = await res.json();

            document.getElementById('contadorFacturas').textContent = facturasCache.length;

            const texto = document.getElementById('buscadorFacturas').value;
            renderizarTablaFacturas(filtrarFacturas(texto));
        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar las facturas.</td></tr>`;
        }
    }

    function renderizarTablaFacturas(datos) {
        if (!datos || datos.length === 0) {
            tabla.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">No hay facturas que coincidan.</td></tr>`;
            return;
        }

        tabla.innerHTML = datos.map(f => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-800 font-medium">${formatearFecha(f.fecha)}</td>
                    <td class="p-3 text-gray-600">${f.proveedor_nombre || '-'}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(f.punto_venta_id)}</td>
                    <td class="p-3 text-gray-600 whitespace-nowrap">${formatearImporte(f.importe)}</td>
                    <td class="p-3">
                        <a href="/api/factura-cash/${f.id}/factura" target="_blank" class="text-blue-600 hover:underline text-xs">Ver</a>
                        <span class="text-gray-300">|</span>
                        <a href="/api/factura-cash/${f.id}/factura?download=1" class="text-blue-600 hover:underline text-xs">Descargar</a>
                    </td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${f.id}">
                            <option value="">Acción...</option>
                            <option value="detalle">Detalle</option>
                            <option value="editar">Editar</option>
                            <option value="eliminar">Eliminar</option>
                        </select>
                    </td>
                </tr>
            `).join('');

        document.querySelectorAll('.accionSelect').forEach(sel => {
            sel.addEventListener('change', async () => {
                const id = sel.dataset.id;
                const accion = sel.value;
                sel.value = '';

                if (accion === 'detalle') {
                    await abrirDetalle(id);
                } else if (accion === 'editar') {
                    await abrirEditar(id);
                } else if (accion === 'eliminar') {
                    await eliminarFactura(id);
                }
            });
        });
    }

    // --- Detalle ---
    async function abrirDetalle(id) {
        try {
            const res = await fetch(`/api/factura-cash/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar la factura');
            const f = await res.json();

            const filas = [
                ['Fecha', formatearFecha(f.fecha)],
                ['Proveedor', f.proveedor_nombre || '-'],
                ['Punto de Venta', nombrePuntoVenta(f.punto_venta_id)],
                ['Importe', formatearImporte(f.importe)],
                ['Observaciones', f.observaciones || '-'],
                ['Factura', f.tiene_factura
                    ? `<a href="/api/factura-cash/${f.id}/factura" target="_blank" class="text-blue-600 hover:underline">Ver archivo</a>`
                    : 'No adjuntada'],
                ['Registrado por', f.registrado_por_nombre
                    ? `${f.registrado_por_nombre} — ${formatearFechaHora(f.created_at)}`
                    : '-']
            ];

            document.getElementById('contenidoDetalle').innerHTML = filas.map(([label, valor]) => `
                <div class="flex justify-between border-b py-1.5 gap-4">
                    <span class="text-gray-500">${label}</span>
                    <span class="text-gray-800 font-medium text-right">${valor}</span>
                </div>
            `).join('');

            document.getElementById('modalDetalle').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el detalle.');
        }
    }
    document.getElementById('btnCerrarDetalle').addEventListener('click', () => {
        document.getElementById('modalDetalle').classList.add('hidden');
    });

    // --- Editar ---
    const formEditar = document.getElementById('formEditarFactura');

    async function abrirEditar(id) {
        try {
            const res = await fetch(`/api/factura-cash/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar la factura');
            const f = await res.json();

            document.getElementById('editId').value = f.id;
            document.getElementById('editFecha').value = f.fecha ? f.fecha.substring(0, 10) : '';
            document.getElementById('editProveedor').value = f.proveedor_nombre || '';
            document.getElementById('editPuntoVenta').value = f.punto_venta_id || '';
            document.getElementById('editImporte').value = f.importe || '';
            document.getElementById('editObservaciones').value = f.observaciones || '';
            document.getElementById('editFactura').value = '';

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar la factura para editar.');
        }
    }
    document.getElementById('btnCerrarEditar').addEventListener('click', () => {
        document.getElementById('modalEditar').classList.add('hidden');
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!formEditar.checkValidity()) {
            formEditar.reportValidity();
            return;
        }

        const id = document.getElementById('editId').value;
        const formData = new FormData();
        formData.append('fecha', document.getElementById('editFecha').value);
        formData.append('proveedor_nombre', document.getElementById('editProveedor').value.trim());
        formData.append('punto_venta_id', document.getElementById('editPuntoVenta').value);
        formData.append('importe', document.getElementById('editImporte').value);
        formData.append('observaciones', document.getElementById('editObservaciones').value.trim());

        const archivo = document.getElementById('editFactura').files[0];
        if (archivo) formData.append('factura', archivo);

        try {
            const res = await fetch(`/api/factura-cash/${id}`, { method: 'PUT', body: formData });
            if (!res.ok) throw new Error('Error al guardar los cambios');
            document.getElementById('modalEditar').classList.add('hidden');
            cargarFacturas();
        } catch (err) {
            console.error(err);
            alert('No se pudo guardar la factura.');
        }
    });

    // --- Eliminar ---
    async function eliminarFactura(id) {
        if (!confirm('¿Seguro que quieres eliminar esta factura? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/factura-cash/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarFacturas();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar la factura.');
        }
    }

    // --- Alta de factura ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const formData = new FormData();
            formData.append('fecha', document.getElementById('fecha').value);
            formData.append('proveedor_nombre', document.getElementById('proveedor').value.trim());
            formData.append('punto_venta_id', document.getElementById('puntoVenta').value);
            formData.append('importe', document.getElementById('importe').value);
            formData.append('observaciones', document.getElementById('observaciones').value.trim());
            formData.append('factura', document.getElementById('factura').files[0]);

            try {
                const res = await fetch('/api/factura-cash', { method: 'POST', body: formData });
                if (!res.ok) throw new Error('Error al crear la factura');

                form.reset();
                cargarFacturas();
            } catch (err) {
                console.error(err);
                alert('No se pudo crear la factura.');
            }
        });
    }

    await cargarPuntosVentaSelect();
    await cargarFacturas();
});
