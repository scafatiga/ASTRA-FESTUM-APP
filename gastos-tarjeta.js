document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formGasto');
    const tabla = document.getElementById('tablaGastos');
    const selectPuntoVenta = document.getElementById('puntoVenta');
    const selectProveedor = document.getElementById('proveedor');

    let puntosVentaCache = [];
    let proveedoresCache = [];

    async function cargarDesplegables() {
        try {
            const [resPV, resProv] = await Promise.all([
                fetch('/api/puntos-venta'),
                fetch('/api/proveedores-dropdown')
            ]);
            if (!resPV.ok) throw new Error('Error al cargar puntos de venta');
            if (!resProv.ok) throw new Error('Error al cargar proveedores');
            puntosVentaCache = await resPV.json();
            proveedoresCache = await resProv.json();

            const opcionesPV = puntosVentaCache.map(pv => `<option value="${pv.id}">${pv.nombre}</option>`).join('');
            selectPuntoVenta.innerHTML = `<option value="">-- Selecciona --</option>${opcionesPV}`;
            document.getElementById('editPuntoVenta').innerHTML = `<option value="">-- Selecciona --</option>${opcionesPV}`;

            const opcionesProv = proveedoresCache.map(p => `<option value="${p.id}">${p.nombre_proveedor}</option>`).join('');
            selectProveedor.innerHTML = `<option value="">-- Selecciona --</option>${opcionesProv}`;
            document.getElementById('editProveedor').innerHTML = `<option value="">-- Selecciona --</option>${opcionesProv}`;
        } catch (err) {
            console.error('Error cargando desplegables:', err);
        }
    }

    function nombrePuntoVenta(id) {
        const pv = puntosVentaCache.find(p => String(p.id) === String(id));
        return pv ? pv.nombre : '-';
    }

    function nombreProveedor(id) {
        const p = proveedoresCache.find(x => String(x.id) === String(id));
        return p ? p.nombre_proveedor : '-';
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
    const listaWrapper = document.getElementById('listaGastosWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Buscador en tiempo real (proveedor, punto de venta o importe) ---
    let gastosCache = [];
    document.getElementById('buscadorGastos').addEventListener('input', (e) => {
        renderizarTablaGastos(filtrarGastos(e.target.value));
    });

    function filtrarGastos(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return gastosCache;
        return gastosCache.filter(g => {
            const campos = [nombreProveedor(g.proveedor_id), nombrePuntoVenta(g.punto_venta_id), String(g.importe || '')];
            return campos.some(c => (c || '').toLowerCase().includes(q));
        });
    }

    // --- Cargar lista (ya viene ordenada de más nuevo a más antiguo desde el backend) ---
    async function cargarGastos() {
        try {
            const res = await fetch('/api/gastos-tarjeta');
            if (!res.ok) throw new Error('Error al cargar los gastos');
            gastosCache = await res.json();

            document.getElementById('contadorGastos').textContent = gastosCache.length;

            const texto = document.getElementById('buscadorGastos').value;
            renderizarTablaGastos(filtrarGastos(texto));
        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">Error al cargar los gastos.</td></tr>`;
        }
    }

    function renderizarTablaGastos(datos) {
        if (!datos || datos.length === 0) {
            tabla.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">No hay gastos que coincidan.</td></tr>`;
            return;
        }

        tabla.innerHTML = datos.map(g => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-800 font-medium">${formatearFecha(g.fecha)}</td>
                    <td class="p-3 text-gray-600">${nombreProveedor(g.proveedor_id)}</td>
                    <td class="p-3 text-gray-600 whitespace-nowrap">${formatearImporte(g.importe)}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(g.punto_venta_id)}</td>
                    <td class="p-3">
                        <a href="/api/gastos-tarjeta/${g.id}/factura" target="_blank" class="text-blue-600 hover:underline text-xs">Ver</a>
                        <span class="text-gray-300">|</span>
                        <a href="/api/gastos-tarjeta/${g.id}/factura?download=1" class="text-blue-600 hover:underline text-xs">Descargar</a>
                    </td>
                    <td class="p-3 text-gray-500 text-xs">
                        ${g.registrado_por_nombre || '-'}<br>${formatearFechaHora(g.created_at)}
                    </td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${g.id}">
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
                        await eliminarGasto(id);
                    }
                });
            });

    }

    // --- Editar ---
    const formEditar = document.getElementById('formEditarGasto');

    async function abrirEditar(id) {
        try {
            const res = await fetch(`/api/gastos-tarjeta/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el gasto');
            const g = await res.json();

            document.getElementById('editId').value = g.id;
            document.getElementById('editFecha').value = g.fecha ? g.fecha.substring(0, 10) : '';
            document.getElementById('editProveedor').value = g.proveedor_id || '';
            document.getElementById('editImporte').value = g.importe || '';
            document.getElementById('editPuntoVenta').value = g.punto_venta_id || '';
            document.getElementById('editFactura').value = '';

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el gasto para editar.');
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
        formData.append('proveedor_id', document.getElementById('editProveedor').value);
        formData.append('importe', document.getElementById('editImporte').value);
        formData.append('punto_venta_id', document.getElementById('editPuntoVenta').value);

        const archivo = document.getElementById('editFactura').files[0];
        if (archivo) formData.append('factura', archivo);

        try {
            const res = await fetch(`/api/gastos-tarjeta/${id}`, { method: 'PUT', body: formData });
            if (!res.ok) throw new Error('Error al guardar los cambios');
            document.getElementById('modalEditar').classList.add('hidden');
            cargarGastos();
        } catch (err) {
            console.error(err);
            alert('No se pudo guardar el gasto.');
        }
    });

    // --- Eliminar ---
    async function eliminarGasto(id) {
        if (!confirm('¿Seguro que quieres eliminar este gasto? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/gastos-tarjeta/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarGastos();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el gasto.');
        }
    }

    // --- Alta de gasto ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const formData = new FormData();
            formData.append('fecha', document.getElementById('fecha').value);
            formData.append('proveedor_id', document.getElementById('proveedor').value);
            formData.append('importe', document.getElementById('importe').value);
            formData.append('punto_venta_id', document.getElementById('puntoVenta').value);
            formData.append('factura', document.getElementById('factura').files[0]);

            try {
                const res = await fetch('/api/gastos-tarjeta', { method: 'POST', body: formData });
                if (!res.ok) throw new Error('Error al crear el gasto');

                form.reset();
                cargarGastos();
            } catch (err) {
                console.error(err);
                alert('No se pudo crear el gasto.');
            }
        });
    }

    await cargarDesplegables();
    await cargarGastos();
});
