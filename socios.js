document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formSocio');
    const tabla = document.getElementById('tablaSocios');
    const selectPuntoVenta = document.getElementById('puntoVenta');

    const SOCIOS = ['Gabriel', 'Wilson', 'Diana', 'Fernando'];
    const TIPOS = ['Pago de Gasto', 'Retiro Cash'];

    let puntosVentaCache = [];

    // --- Botones tipo chip para Socio / Tipo (Alta y Editar) ---
    function claseBoton(activo) {
        const base = 'w-full h-12 flex items-center justify-center text-center px-2 rounded-lg text-sm transition border';
        return activo
            ? `${base} bg-blue-600 border-blue-600 text-white font-semibold`
            : `${base} bg-gray-100 border-gray-300 text-gray-600 font-medium hover:bg-gray-200`;
    }

    function pintarBotones(contenedorId, inputOcultoId, opciones, valorInicial) {
        const contenedor = document.getElementById(contenedorId);
        contenedor.innerHTML = opciones.map(op =>
            `<button type="button" class="opcion-btn ${claseBoton(op === valorInicial)}" data-valor="${op}">${op}</button>`
        ).join('');
        document.getElementById(inputOcultoId).value = valorInicial || '';

        contenedor.querySelectorAll('.opcion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                contenedor.querySelectorAll('.opcion-btn').forEach(b => b.className = `opcion-btn ${claseBoton(false)}`);
                btn.className = `opcion-btn ${claseBoton(true)}`;
                document.getElementById(inputOcultoId).value = btn.dataset.valor;
            });
        });
    }

    pintarBotones('socioBotones', 'socio', SOCIOS, '');
    pintarBotones('tipoBotones', 'tipo', TIPOS, '');

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
    const listaWrapper = document.getElementById('listaSociosWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Cargar lista (ya viene ordenada de más nuevo a más antiguo desde el backend) ---
    async function cargarSocios() {
        try {
            const res = await fetch('/api/socios');
            if (!res.ok) throw new Error('Error al cargar los registros');
            const datos = await res.json();

            document.getElementById('contadorSocios').textContent = datos ? datos.length : 0;

            if (!datos || datos.length === 0) {
                tabla.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">No hay registros.</td></tr>`;
                return;
            }

            tabla.innerHTML = datos.map(s => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-800 font-medium">${formatearFecha(s.fecha)}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(s.punto_venta_id)}</td>
                    <td class="p-3 text-gray-600">${s.socio}</td>
                    <td class="p-3 text-gray-600">${s.tipo}</td>
                    <td class="p-3 text-gray-600">${formatearImporte(s.importe)}</td>
                    <td class="p-3 text-gray-500 text-xs">${s.registrado_por_nombre || '-'}<br>${formatearFechaHora(s.created_at)}</td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${s.id}">
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
                        await eliminarSocio(id);
                    }
                });
            });

        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">Error al cargar los registros.</td></tr>`;
        }
    }

    // --- Detalle ---
    async function abrirDetalle(id) {
        try {
            const res = await fetch(`/api/socios/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el registro');
            const s = await res.json();

            const filas = [
                ['Fecha', formatearFecha(s.fecha)],
                ['Punto de Venta', nombrePuntoVenta(s.punto_venta_id)],
                ['Socio', s.socio],
                ['Tipo', s.tipo],
                ['Importe', formatearImporte(s.importe)],
                ['Observaciones', s.observaciones || '-']
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
    const formEditar = document.getElementById('formEditarSocio');

    async function abrirEditar(id) {
        try {
            const res = await fetch(`/api/socios/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el registro');
            const s = await res.json();

            document.getElementById('editId').value = s.id;
            document.getElementById('editFecha').value = s.fecha ? s.fecha.substring(0, 10) : '';
            document.getElementById('editPuntoVenta').value = s.punto_venta_id || '';
            document.getElementById('editImporte').value = s.importe || '';
            document.getElementById('editObservaciones').value = s.observaciones || '';

            pintarBotones('editSocioBotones', 'editSocio', SOCIOS, s.socio);
            pintarBotones('editTipoBotones', 'editTipo', TIPOS, s.tipo);

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el registro para editar.');
        }
    }
    document.getElementById('btnCerrarEditar').addEventListener('click', () => {
        document.getElementById('modalEditar').classList.add('hidden');
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!formEditar.checkValidity() || !document.getElementById('editSocio').value || !document.getElementById('editTipo').value) {
            formEditar.reportValidity();
            if (!document.getElementById('editSocio').value) alert('Selecciona un Socio.');
            else if (!document.getElementById('editTipo').value) alert('Selecciona un Tipo.');
            return;
        }

        const id = document.getElementById('editId').value;
        const datos = {
            fecha: document.getElementById('editFecha').value,
            punto_venta_id: document.getElementById('editPuntoVenta').value,
            socio: document.getElementById('editSocio').value,
            tipo: document.getElementById('editTipo').value,
            importe: document.getElementById('editImporte').value,
            observaciones: document.getElementById('editObservaciones').value.trim()
        };

        try {
            const res = await fetch(`/api/socios/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al guardar los cambios');

            document.getElementById('modalEditar').classList.add('hidden');
            cargarSocios();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo guardar el registro.');
        }
    });

    // --- Eliminar ---
    async function eliminarSocio(id) {
        if (!confirm('¿Seguro que quieres eliminar este registro? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/socios/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarSocios();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el registro.');
        }
    }

    // --- Alta de registro ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const socio = document.getElementById('socio').value;
            const tipo = document.getElementById('tipo').value;

            if (!form.checkValidity() || !socio || !tipo) {
                form.reportValidity();
                if (!socio) alert('Selecciona un Socio.');
                else if (!tipo) alert('Selecciona un Tipo.');
                return;
            }

            const datos = {
                fecha: document.getElementById('fecha').value,
                punto_venta_id: document.getElementById('puntoVenta').value,
                socio,
                tipo,
                importe: document.getElementById('importe').value,
                observaciones: document.getElementById('observaciones').value.trim()
            };

            try {
                const res = await fetch('/api/socios', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datos)
                });
                const resultado = await res.json();
                if (!res.ok) throw new Error(resultado.error || 'Error al crear el registro');

                form.reset();
                pintarBotones('socioBotones', 'socio', SOCIOS, '');
                pintarBotones('tipoBotones', 'tipo', TIPOS, '');
                cargarSocios();
            } catch (err) {
                console.error(err);
                alert(err.message || 'No se pudo crear el registro.');
            }
        });
    }

    await cargarPuntosVentaSelect();
    await cargarSocios();
});
