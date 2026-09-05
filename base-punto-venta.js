document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formTraspaso');
    const tabla = document.getElementById('tablaTraspasos');
    const selectOrigen = document.getElementById('puntoVentaOrigen');
    const selectDestino = document.getElementById('puntoVentaDestino');

    let puntosVentaCache = [];

    async function cargarPuntosVentaSelect() {
        try {
            const res = await fetch('/api/puntos-venta');
            if (!res.ok) throw new Error('Error al cargar puntos de venta');
            puntosVentaCache = await res.json();

            const opciones = puntosVentaCache.map(pv => `<option value="${pv.id}">${pv.nombre}</option>`).join('');
            selectOrigen.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
            selectDestino.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
            document.getElementById('editPuntoVentaOrigen').innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
            document.getElementById('editPuntoVentaDestino').innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
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
    const listaWrapper = document.getElementById('listaTraspasosWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Buscador en tiempo real (punto de venta o importe) ---
    let traspasosCache = [];
    document.getElementById('buscadorTraspasos').addEventListener('input', (e) => {
        renderizarTablaTraspasos(filtrarTraspasos(e.target.value));
    });

    function filtrarTraspasos(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return traspasosCache;
        return traspasosCache.filter(b => {
            const campos = [nombrePuntoVenta(b.punto_venta_origen_id), nombrePuntoVenta(b.punto_venta_destino_id), String(b.importe || '')];
            return campos.some(c => (c || '').toLowerCase().includes(q));
        });
    }

    // --- Cargar lista (ya viene ordenada de más nuevo a más antiguo desde el backend) ---
    async function cargarTraspasos() {
        try {
            const res = await fetch('/api/base-punto-venta');
            if (!res.ok) throw new Error('Error al cargar los traspasos');
            traspasosCache = await res.json();

            document.getElementById('contadorTraspasos').textContent = traspasosCache.length;

            const texto = document.getElementById('buscadorTraspasos').value;
            renderizarTablaTraspasos(filtrarTraspasos(texto));
        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar los traspasos.</td></tr>`;
        }
    }

    function renderizarTablaTraspasos(datos) {
        if (!datos || datos.length === 0) {
            tabla.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">No hay traspasos que coincidan.</td></tr>`;
            return;
        }

        tabla.innerHTML = datos.map(b => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-800 font-medium">${formatearFecha(b.fecha)}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(b.punto_venta_origen_id)}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(b.punto_venta_destino_id)}</td>
                    <td class="p-3 text-gray-600 whitespace-nowrap">${formatearImporte(b.importe)}</td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${b.id}">
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
                        await eliminarTraspaso(id);
                    }
                });
            });

    }

    // --- Detalle ---
    async function abrirDetalle(id) {
        try {
            const res = await fetch(`/api/base-punto-venta/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el traspaso');
            const b = await res.json();

            const filas = [
                ['Fecha', formatearFecha(b.fecha)],
                ['Punto de Venta Origen', nombrePuntoVenta(b.punto_venta_origen_id)],
                ['Punto de Venta Destino', nombrePuntoVenta(b.punto_venta_destino_id)],
                ['Importe', formatearImporte(b.importe)],
                ['Registrado por', b.registrado_por_nombre || '-']
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
    const formEditar = document.getElementById('formEditarTraspaso');

    async function abrirEditar(id) {
        try {
            const res = await fetch(`/api/base-punto-venta/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el traspaso');
            const b = await res.json();

            document.getElementById('editId').value = b.id;
            document.getElementById('editFecha').value = b.fecha ? b.fecha.substring(0, 10) : '';
            document.getElementById('editImporte').value = b.importe || '';
            document.getElementById('editPuntoVentaOrigen').value = b.punto_venta_origen_id || '';
            document.getElementById('editPuntoVentaDestino').value = b.punto_venta_destino_id || '';
            document.getElementById('editMismoPuntoError').classList.add('hidden');

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el traspaso para editar.');
        }
    }
    document.getElementById('btnCerrarEditar').addEventListener('click', () => {
        document.getElementById('modalEditar').classList.add('hidden');
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();

        const origen = document.getElementById('editPuntoVentaOrigen').value;
        const destino = document.getElementById('editPuntoVentaDestino').value;

        if (!formEditar.checkValidity()) {
            formEditar.reportValidity();
            return;
        }
        if (origen === destino) {
            document.getElementById('editMismoPuntoError').classList.remove('hidden');
            return;
        }
        document.getElementById('editMismoPuntoError').classList.add('hidden');

        const id = document.getElementById('editId').value;
        const datos = {
            fecha: document.getElementById('editFecha').value,
            punto_venta_origen_id: origen,
            punto_venta_destino_id: destino,
            importe: document.getElementById('editImporte').value
        };

        try {
            const res = await fetch(`/api/base-punto-venta/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al guardar los cambios');

            document.getElementById('modalEditar').classList.add('hidden');
            cargarTraspasos();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo guardar el traspaso.');
        }
    });

    // --- Eliminar ---
    async function eliminarTraspaso(id) {
        if (!confirm('¿Seguro que quieres eliminar este traspaso? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/base-punto-venta/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarTraspasos();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el traspaso.');
        }
    }

    // --- Alta de traspaso ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const origen = selectOrigen.value;
            const destino = selectDestino.value;

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
            if (origen === destino) {
                document.getElementById('mismoPuntoError').classList.remove('hidden');
                return;
            }
            document.getElementById('mismoPuntoError').classList.add('hidden');

            const datos = {
                fecha: document.getElementById('fecha').value,
                punto_venta_origen_id: origen,
                punto_venta_destino_id: destino,
                importe: document.getElementById('importe').value
            };

            try {
                const res = await fetch('/api/base-punto-venta', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datos)
                });
                const resultado = await res.json();
                if (!res.ok) throw new Error(resultado.error || 'Error al crear el traspaso');

                form.reset();
                cargarTraspasos();
            } catch (err) {
                console.error(err);
                alert(err.message || 'No se pudo crear el traspaso.');
            }
        });
    }

    // --- Importar desde Excel ---
    const inputExcel = document.getElementById('inputExcel');
    const btnImportarExcel = document.getElementById('btnImportarExcel');
    const resultadoImportacion = document.getElementById('resultadoImportacion');

    btnImportarExcel.addEventListener('click', () => inputExcel.click());

    inputExcel.addEventListener('change', async () => {
        const archivo = inputExcel.files[0];
        if (!archivo) return;

        btnImportarExcel.disabled = true;
        btnImportarExcel.textContent = 'Subiendo...';
        resultadoImportacion.classList.add('hidden');

        const formData = new FormData();
        formData.append('archivo', archivo);

        try {
            const res = await fetch('/api/base-punto-venta/importar-excel', { method: 'POST', body: formData });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al importar el archivo');

            let texto = `Importación completada: ${resultado.creados} traspaso(s) creado(s) de ${resultado.total} filas leídas.`;
            if (resultado.omitidos > 0) texto += ` ${resultado.omitidos} fila(s) omitida(s) (sin fecha válida).`;
            if (resultado.mismoOrigenDestino > 0) texto += ` ${resultado.mismoOrigenDestino} fila(s) omitida(s) (origen y destino iguales).`;
            if (resultado.sinPuntoVenta > 0) texto += ` ${resultado.sinPuntoVenta} fila(s) con algún Punto de Venta que no se encontró.`;

            resultadoImportacion.textContent = texto;
            resultadoImportacion.className = 'text-sm mb-6 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3';
            resultadoImportacion.classList.remove('hidden');

            cargarTraspasos();
        } catch (err) {
            console.error(err);
            resultadoImportacion.textContent = err.message || 'No se pudo importar el archivo.';
            resultadoImportacion.className = 'text-sm mb-6 text-red-700 bg-red-50 border border-red-200 rounded p-3';
            resultadoImportacion.classList.remove('hidden');
        } finally {
            btnImportarExcel.disabled = false;
            btnImportarExcel.textContent = '📄 Subir Excel';
            inputExcel.value = '';
        }
    });

    await cargarPuntosVentaSelect();
    await cargarTraspasos();
});
