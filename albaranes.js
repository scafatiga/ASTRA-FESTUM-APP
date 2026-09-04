document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formAlbaran');
    const tabla = document.getElementById('tablaAlbaranes');
    const selectOrigen = document.getElementById('puntoVentaOrigen');
    const selectDestino = document.getElementById('puntoVentaDestino');
    const bloqueProductos = document.getElementById('bloqueProductos');
    const tablaProductosGrid = document.getElementById('tablaProductosGrid');

    const TIPOS_STAND = ['CHOCOBERRIES', 'CARIBBEAN', 'MACONDO', 'KOKO BLENDS'];
    const TIPOS_ALBARAN = ['INICIAL', 'FINAL', 'NORMAL'];

    let puntosVentaCache = [];

    function claseBoton(activo) {
        const base = 'w-full h-12 flex items-center justify-center text-center px-2 rounded-lg text-xs transition border';
        return activo
            ? `${base} bg-blue-600 border-blue-600 text-white font-semibold`
            : `${base} bg-gray-100 border-gray-300 text-gray-600 font-medium hover:bg-gray-200`;
    }

    function pintarBotones(contenedorId, inputOcultoId, opciones, valorInicial, onCambio) {
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
                if (onCambio) onCambio(btn.dataset.valor);
            });
        });
    }

    pintarBotones('tipoAlbaranBotones', 'tipoAlbaran', TIPOS_ALBARAN, '');
    pintarBotones('tipoStandBotones', 'tipoStand', TIPOS_STAND, '', (valor) => cargarRejillaProductos(valor));

    async function cargarPuntosVentaSelect() {
        try {
            const res = await fetch('/api/puntos-venta');
            if (!res.ok) throw new Error('Error al cargar puntos de venta');
            puntosVentaCache = await res.json();

            const opciones = puntosVentaCache.map(pv => `<option value="${pv.id}">${pv.nombre}</option>`).join('');
            selectOrigen.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
            selectDestino.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
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

    // --- Rejilla de productos: se rellena entera al elegir Tipo_Stand ---
    async function cargarRejillaProductos(tipoStand) {
        if (!tipoStand) {
            bloqueProductos.classList.add('hidden');
            tablaProductosGrid.innerHTML = '';
            return;
        }
        try {
            const res = await fetch(`/api/productos-dropdown?tipo_stand=${encodeURIComponent(tipoStand)}`);
            if (!res.ok) throw new Error('Error al cargar productos');
            const productos = await res.json();

            if (productos.length === 0) {
                tablaProductosGrid.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-gray-500">No hay productos activos para ${tipoStand}.</td></tr>`;
            } else {
                tablaProductosGrid.innerHTML = productos.map(p => `
                    <tr class="border-b producto-fila" data-precio="${p.precio_unitario}">
                        <td class="p-2">${p.nombre}</td>
                        <td class="p-2 text-gray-600">${formatearImporte(p.precio_unitario)}</td>
                        <td class="p-2">
                            <input type="number" step="0.01" min="0" class="cantidad-input w-20 border rounded p-1 text-sm" data-producto-id="${p.id}" value="">
                        </td>
                        <td class="p-2 subtotal-celda text-gray-700">0.00 €</td>
                    </tr>
                `).join('');

                tablaProductosGrid.querySelectorAll('.cantidad-input').forEach(input => {
                    input.addEventListener('input', actualizarTotales);
                });
            }

            bloqueProductos.classList.remove('hidden');
            document.getElementById('buscadorProductosGrid').value = '';
            actualizarTotales();
        } catch (err) {
            console.error(err);
        }
    }

    document.getElementById('buscadorProductosGrid').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        tablaProductosGrid.querySelectorAll('.producto-fila').forEach(fila => {
            const nombre = fila.querySelector('td').textContent.toLowerCase();
            fila.style.display = nombre.includes(q) ? '' : 'none';
        });
    });

    function actualizarTotales() {
        let total = 0;
        tablaProductosGrid.querySelectorAll('.producto-fila').forEach(fila => {
            const precio = Number(fila.dataset.precio) || 0;
            const cantidad = Number(fila.querySelector('.cantidad-input').value) || 0;
            const subtotal = precio * cantidad;
            fila.querySelector('.subtotal-celda').textContent = formatearImporte(subtotal);
            total += subtotal;
        });
        document.getElementById('totalAlbaran').textContent = formatearImporte(total);
    }

    function recogerLineas() {
        const lineas = [];
        tablaProductosGrid.querySelectorAll('.cantidad-input').forEach(input => {
            const cantidad = Number(input.value) || 0;
            if (cantidad > 0) {
                lineas.push({ producto_id: input.dataset.productoId, cantidad });
            }
        });
        return lineas;
    }

    // --- Colapsar / expandir la lista ---
    const btnToggleLista = document.getElementById('btnToggleLista');
    const listaWrapper = document.getElementById('listaAlbaranesWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Cargar lista (ya viene ordenada de más nuevo a más antiguo desde el backend) ---
    async function cargarAlbaranes() {
        try {
            const res = await fetch('/api/albaranes');
            if (!res.ok) throw new Error('Error al cargar los albaranes');
            const datos = await res.json();

            document.getElementById('contadorAlbaranes').textContent = datos ? datos.length : 0;

            if (!datos || datos.length === 0) {
                tabla.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-gray-500">No hay albaranes registrados.</td></tr>`;
                return;
            }

            tabla.innerHTML = datos.map(a => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-800 font-medium">${formatearFecha(a.fecha)}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(a.punto_venta_origen_id)}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(a.punto_venta_destino_id)}</td>
                    <td class="p-3 text-gray-600">${a.tipo_stand}</td>
                    <td class="p-3 text-gray-600">${a.tipo_albaran}</td>
                    <td class="p-3 font-semibold text-gray-800">${formatearImporte(a.total_albaran)}</td>
                    <td class="p-3 text-gray-500 text-xs">${a.registrado_por_nombre || '-'}<br>${formatearFechaHora(a.created_at)}</td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${a.id}">
                            <option value="">Acción...</option>
                            <option value="detalle">Detalle</option>
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
                    } else if (accion === 'eliminar') {
                        await eliminarAlbaran(id);
                    }
                });
            });

        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-red-500">Error al cargar los albaranes.</td></tr>`;
        }
    }

    // --- Detalle ---
    async function abrirDetalle(id) {
        try {
            const res = await fetch(`/api/albaranes/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el albarán');
            const a = await res.json();

            const filas = [
                ['Fecha', formatearFecha(a.fecha)],
                ['Punto de Venta Origen', nombrePuntoVenta(a.punto_venta_origen_id)],
                ['Punto de Venta Destino', nombrePuntoVenta(a.punto_venta_destino_id)],
                ['Tipo_Stand', a.tipo_stand],
                ['Tipo de Albarán', a.tipo_albaran],
                ['Total Albarán', formatearImporte(a.total_albaran)],
                ['Registrado por', a.registrado_por_nombre || '-']
            ];

            let html = filas.map(([label, valor]) => `
                <div class="flex justify-between border-b py-1.5 gap-4">
                    <span class="text-gray-500">${label}</span>
                    <span class="text-gray-800 font-medium text-right">${valor}</span>
                </div>
            `).join('');

            html += '<div class="pt-3 font-semibold text-gray-700">Productos:</div>';
            html += (a.lineas || []).map(l => `
                <div class="flex justify-between border-b py-1 text-sm">
                    <span class="text-gray-600">${l.producto_nombre} (x${l.cantidad})</span>
                    <span class="text-gray-800 font-medium">${formatearImporte(l.subtotal)}</span>
                </div>
            `).join('');

            document.getElementById('contenidoDetalle').innerHTML = html;
            document.getElementById('modalDetalle').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el detalle.');
        }
    }
    document.getElementById('btnCerrarDetalle').addEventListener('click', () => {
        document.getElementById('modalDetalle').classList.add('hidden');
    });

    // --- Eliminar (revierte el stock automáticamente en el servidor) ---
    async function eliminarAlbaran(id) {
        if (!confirm('¿Seguro que quieres eliminar este albarán? Esto revertirá el movimiento de stock (se devuelve al origen y se quita del destino). No se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/albaranes/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarAlbaranes();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el albarán.');
        }
    }

    // --- Alta de albarán ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const origen = selectOrigen.value;
            const destino = selectDestino.value;
            const tipoStand = document.getElementById('tipoStand').value;
            const tipoAlbaran = document.getElementById('tipoAlbaran').value;

            if (!form.checkValidity() || !tipoStand || !tipoAlbaran) {
                form.reportValidity();
                if (!tipoStand) alert('Selecciona un Tipo_Stand.');
                else if (!tipoAlbaran) alert('Selecciona un Tipo de Albarán.');
                return;
            }
            if (origen === destino) {
                document.getElementById('mismoPuntoError').classList.remove('hidden');
                return;
            }
            document.getElementById('mismoPuntoError').classList.add('hidden');

            const lineas = recogerLineas();
            if (lineas.length === 0) {
                alert('Añade al menos una cantidad mayor que 0 en algún producto.');
                return;
            }

            const datos = {
                fecha: document.getElementById('fecha').value,
                punto_venta_origen_id: origen,
                punto_venta_destino_id: destino,
                tipo_stand: tipoStand,
                tipo_albaran: tipoAlbaran,
                lineas
            };

            try {
                const res = await fetch('/api/albaranes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datos)
                });
                const resultado = await res.json();
                if (!res.ok) throw new Error(resultado.error || 'Error al crear el albarán');

                form.reset();
                pintarBotones('tipoAlbaranBotones', 'tipoAlbaran', TIPOS_ALBARAN, '');
                pintarBotones('tipoStandBotones', 'tipoStand', TIPOS_STAND, '', (valor) => cargarRejillaProductos(valor));
                bloqueProductos.classList.add('hidden');
                cargarAlbaranes();
            } catch (err) {
                console.error(err);
                alert(err.message || 'No se pudo crear el albarán.');
            }
        });
    }

    await cargarPuntosVentaSelect();
    await cargarAlbaranes();
});
