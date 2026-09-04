document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formPuntoVenta');
    const tabla = document.getElementById('tablaPuntosVenta');
    let puntosVentaCache = [];

    function formatearFechaHora(f) {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }

    // --- Buscador en tiempo real (nombre) ---
    document.getElementById('buscadorPuntosVenta').addEventListener('input', (e) => {
        renderizarTablaPuntosVenta(filtrarPuntosVenta(e.target.value));
    });

    function filtrarPuntosVenta(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return puntosVentaCache;
        return puntosVentaCache.filter(pv => (pv.nombre || '').toLowerCase().includes(q));
    }

    async function cargarPuntosVenta() {
        try {
            const res = await fetch('/api/puntos-venta/todos');
            if (!res.ok) throw new Error('Error al cargar puntos de venta');
            puntosVentaCache = await res.json();

            const texto = document.getElementById('buscadorPuntosVenta').value;
            renderizarTablaPuntosVenta(filtrarPuntosVenta(texto));
        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-500">Error al cargar los puntos de venta.</td></tr>`;
        }
    }

    function renderizarTablaPuntosVenta(datos) {
        if (!datos || datos.length === 0) {
            tabla.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-500">No hay puntos de venta que coincidan.</td></tr>`;
            return;
        }

        tabla.innerHTML = datos.map(pv => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 font-medium text-gray-800">${pv.nombre || ''}</td>
                    <td class="p-3 text-gray-600">${pv.direccion || '-'}</td>
                    <td class="p-3 text-gray-600">${pv.tipo_stand || '-'}</td>
                    <td class="p-3">
                        <button class="btnToggleEstado px-2 py-1 rounded text-xs font-semibold transition ${pv.activo ? 'bg-emerald-500 hover:bg-emerald-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white'}" data-id="${pv.id}" data-activo="${pv.activo}">
                            ${pv.activo ? 'Activo' : 'Inactivo'}
                        </button>
                    </td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${pv.id}">
                            <option value="">Acción...</option>
                            <option value="detalle">Detalle</option>
                            <option value="editar">Editar</option>
                            <option value="eliminar">Eliminar</option>
                        </select>
                    </td>
                </tr>
            `).join('');

        document.querySelectorAll('.btnToggleEstado').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.id;
                    const activoActual = btn.dataset.activo === 'true';
                    try {
                        const res = await fetch(`/api/puntos-venta/${id}/estado`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ activo: !activoActual })
                        });
                        if (!res.ok) throw new Error('Error al actualizar estado');
                        cargarPuntosVenta();
                    } catch (err) {
                        console.error(err);
                        alert('No se pudo actualizar el estado.');
                    }
                });
            });

            document.querySelectorAll('.accionSelect').forEach(sel => {
                sel.addEventListener('change', async () => {
                    const id = sel.dataset.id;
                    const accion = sel.value;
                    sel.value = '';

                    if (accion === 'detalle') {
                        abrirDetalle(id);
                    } else if (accion === 'editar') {
                        abrirEditar(id);
                    } else if (accion === 'eliminar') {
                        await eliminarPuntoVenta(id);
                    }
                });
            });

    }

    // --- Detalle ---
    function abrirDetalle(id) {
        const pv = puntosVentaCache.find(x => String(x.id) === String(id));
        if (!pv) return;

        const filas = [
            ['Nombre', pv.nombre],
            ['Dirección', pv.direccion],
            ['Tipo Stand', pv.tipo_stand],
            ['Estado', pv.activo ? 'Activo' : 'Inactivo'],
            ['Registrado por', pv.registrado_por_nombre
                ? `${pv.registrado_por_nombre} — ${formatearFechaHora(pv.creado_en)}`
                : '-']
        ];

        document.getElementById('contenidoDetalle').innerHTML = filas.map(([label, valor]) => `
            <div class="flex justify-between border-b py-1.5 gap-4">
                <span class="text-gray-500">${label}</span>
                <span class="text-gray-800 font-medium text-right">${valor || '-'}</span>
            </div>
        `).join('');

        document.getElementById('modalDetalle').classList.remove('hidden');
    }
    document.getElementById('btnCerrarDetalle').addEventListener('click', () => {
        document.getElementById('modalDetalle').classList.add('hidden');
    });

    // --- Editar ---
    const formEditar = document.getElementById('formEditarPuntoVenta');

    function abrirEditar(id) {
        const pv = puntosVentaCache.find(x => String(x.id) === String(id));
        if (!pv) return;

        document.getElementById('editId').value = pv.id;
        document.getElementById('editNombre').value = pv.nombre || '';
        document.getElementById('editDireccion').value = pv.direccion || '';
        document.getElementById('editTipoStand').value = pv.tipo_stand || '';

        document.getElementById('modalEditar').classList.remove('hidden');
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
        const datos = {
            nombre: document.getElementById('editNombre').value.trim(),
            direccion: document.getElementById('editDireccion').value.trim(),
            tipo_stand: document.getElementById('editTipoStand').value.trim()
        };

        try {
            const res = await fetch(`/api/puntos-venta/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al guardar los cambios');

            document.getElementById('modalEditar').classList.add('hidden');
            cargarPuntosVenta();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo guardar el punto de venta.');
        }
    });

    // --- Eliminar ---
    async function eliminarPuntoVenta(id) {
        if (!confirm('¿Seguro que quieres eliminar este punto de venta? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/puntos-venta/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarPuntosVenta();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el punto de venta.');
        }
    }

    // --- Alta ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const nombre = document.getElementById('nombre').value.trim();
            const direccion = document.getElementById('direccion').value.trim();
            const tipoStand = document.getElementById('tipoStand').value.trim();

            if (!nombre) return;

            try {
                const res = await fetch('/api/puntos-venta', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, direccion, tipo_stand: tipoStand })
                });
                if (!res.ok) throw new Error('Error al crear punto de venta');

                form.reset();
                cargarPuntosVenta();
            } catch (err) {
                console.error(err);
                alert('No se pudo crear el punto de venta.');
            }
        });
    }

    cargarPuntosVenta();
});
