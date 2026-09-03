document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formIngreso');
    const tabla = document.getElementById('tablaIngresos');
    const selectPuntoVenta = document.getElementById('puntoVenta');

    let puntosVentaCache = [];

    async function cargarPuntosVentaSelect() {
        try {
            const res = await fetch('/api/puntos-venta');
            if (!res.ok) throw new Error('Error al cargar puntos de venta');
            puntosVentaCache = await res.json();

            const opciones = puntosVentaCache.map(pv => `<option value="${pv.id}">${pv.nombre}</option>`).join('');
            selectPuntoVenta.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
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

    function formatearImporte(n) {
        return Number(n || 0).toFixed(2) + ' €';
    }

    // --- Colapsar / expandir la lista ---
    const btnToggleLista = document.getElementById('btnToggleLista');
    const listaWrapper = document.getElementById('listaIngresosWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Cargar lista (ya viene ordenada de más nuevo a más antiguo desde el backend) ---
    async function cargarIngresos() {
        try {
            const res = await fetch('/api/ingresos');
            if (!res.ok) throw new Error('Error al cargar ingresos');
            const datos = await res.json();

            document.getElementById('contadorIngresos').textContent = datos ? datos.length : 0;

            if (!datos || datos.length === 0) {
                tabla.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-500">No hay ingresos registrados.</td></tr>`;
                return;
            }

            tabla.innerHTML = datos.map(i => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-800 font-medium">${formatearFecha(i.fecha)}</td>
                    <td class="p-3 text-gray-600">${formatearImporte(i.importe)}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(i.punto_venta_id)}</td>
                    <td class="p-3">
                        <a href="/api/ingresos/${i.id}/comprobante" target="_blank" class="text-blue-600 hover:underline text-xs">Ver</a>
                        <span class="text-gray-300">|</span>
                        <a href="/api/ingresos/${i.id}/comprobante?download=1" class="text-blue-600 hover:underline text-xs">Descargar</a>
                    </td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${i.id}">
                            <option value="">Acción...</option>
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

                    if (accion === 'editar') {
                        await abrirEditar(id);
                    } else if (accion === 'eliminar') {
                        await eliminarIngreso(id);
                    }
                });
            });

        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-500">Error al cargar los ingresos.</td></tr>`;
        }
    }

    // --- Editar ---
    const formEditar = document.getElementById('formEditarIngreso');

    async function abrirEditar(id) {
        try {
            const res = await fetch(`/api/ingresos/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el ingreso');
            const i = await res.json();

            document.getElementById('editId').value = i.id;
            document.getElementById('editFecha').value = i.fecha ? i.fecha.substring(0, 10) : '';
            document.getElementById('editImporte').value = i.importe || '';
            document.getElementById('editPuntoVenta').value = i.punto_venta_id || '';
            document.getElementById('editComprobante').value = '';

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el ingreso para editar.');
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
        formData.append('importe', document.getElementById('editImporte').value);
        formData.append('punto_venta_id', document.getElementById('editPuntoVenta').value);

        const archivo = document.getElementById('editComprobante').files[0];
        if (archivo) formData.append('comprobante', archivo);

        try {
            const res = await fetch(`/api/ingresos/${id}`, { method: 'PUT', body: formData });
            if (!res.ok) throw new Error('Error al guardar los cambios');
            document.getElementById('modalEditar').classList.add('hidden');
            cargarIngresos();
        } catch (err) {
            console.error(err);
            alert('No se pudo guardar el ingreso.');
        }
    });

    // --- Eliminar ---
    async function eliminarIngreso(id) {
        if (!confirm('¿Seguro que quieres eliminar este ingreso? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/ingresos/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarIngresos();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el ingreso.');
        }
    }

    // --- Alta de ingreso ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const formData = new FormData();
            formData.append('fecha', document.getElementById('fecha').value);
            formData.append('importe', document.getElementById('importe').value);
            formData.append('punto_venta_id', document.getElementById('puntoVenta').value);
            formData.append('comprobante', document.getElementById('comprobante').files[0]);

            try {
                const res = await fetch('/api/ingresos', { method: 'POST', body: formData });
                if (!res.ok) throw new Error('Error al crear el ingreso');

                form.reset();
                cargarIngresos();
            } catch (err) {
                console.error(err);
                alert('No se pudo crear el ingreso.');
            }
        });
    }

    await cargarPuntosVentaSelect();
    await cargarIngresos();
});
