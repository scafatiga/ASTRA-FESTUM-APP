document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formAlbaran');
    const tabla = document.getElementById('tablaAlbaranes');
    const selectOrigen = document.getElementById('puntoVentaOrigen');
    const selectDestino = document.getElementById('puntoVentaDestino');
    const bloqueProductos = document.getElementById('bloqueProductos');
    const barraTotalAlta = document.getElementById('barraTotalAlta');
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

    function formatearImporte(n) {
        return Number(n || 0).toFixed(2) + ' €';
    }

    // --- Rejilla de productos: reutilizable para Alta y para Editar ---
    // tablaId: <tbody> donde pintar las filas. cantidadesIniciales: { producto_id: cantidad } (opcional, para precargar en Editar)
    async function cargarRejillaProductosEn(tablaId, bloqueEl, totalEl, tipoStand, cantidadesIniciales, usarCantidadEstandar) {
        const tablaEl = document.getElementById(tablaId);
        if (!tipoStand) {
            bloqueEl.classList.add('hidden');
            if (bloqueEl === bloqueProductos) barraTotalAlta.classList.add('hidden');
            tablaEl.innerHTML = '';
            return;
        }
        try {
            const res = await fetch(`/api/productos-dropdown?tipo_stand=${encodeURIComponent(tipoStand)}`);
            if (!res.ok) throw new Error('Error al cargar productos');
            const productos = await res.json();

            if (productos.length === 0) {
                tablaEl.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-gray-500">No hay productos activos para ${tipoStand}.</td></tr>`;
            } else {
                tablaEl.innerHTML = productos.map(p => {
                    let cantidadPrevia = '';
                    if (cantidadesIniciales && cantidadesIniciales[p.id]) {
                        cantidadPrevia = cantidadesIniciales[p.id];
                    } else if (usarCantidadEstandar && p.cantidad_estandar !== null && p.cantidad_estandar !== undefined) {
                        cantidadPrevia = p.cantidad_estandar;
                    }
                    return `
                        <tr class="border-b producto-fila" data-precio="${p.precio_unitario}">
                            <td class="p-2">${p.nombre}</td>
                            <td class="p-2 text-gray-600">${formatearImporte(p.precio_unitario)}</td>
                            <td class="p-2">
                                <input type="text" inputmode="decimal" class="cantidad-input w-20 border rounded p-1 text-sm" data-producto-id="${p.id}" value="${cantidadPrevia}">
                            </td>
                            <td class="p-2 subtotal-celda text-gray-700">0.00 €</td>
                        </tr>
                    `;
                }).join('');

                tablaEl.querySelectorAll('.cantidad-input').forEach(input => {
                    input.addEventListener('input', () => actualizarTotalesEn(tablaId, totalEl));
                });
            }

            bloqueEl.classList.remove('hidden');
            if (bloqueEl === bloqueProductos) barraTotalAlta.classList.remove('hidden');
            actualizarTotalesEn(tablaId, totalEl);
        } catch (err) {
            console.error(err);
        }
    }

    function leerCantidad(valor) {
        const n = parseFloat(String(valor || '').replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }

    function actualizarTotalesEn(tablaId, totalElId) {
        const tablaEl = document.getElementById(tablaId);
        let total = 0;
        tablaEl.querySelectorAll('.producto-fila').forEach(fila => {
            const precio = Number(fila.dataset.precio) || 0;
            const cantidad = leerCantidad(fila.querySelector('.cantidad-input').value);
            const subtotal = precio * cantidad;
            fila.querySelector('.subtotal-celda').textContent = formatearImporte(subtotal);
            total += subtotal;
        });
        document.getElementById(totalElId).textContent = formatearImporte(total);
    }

    function recogerLineasDe(tablaId) {
        const lineas = [];
        document.getElementById(tablaId).querySelectorAll('.cantidad-input').forEach(input => {
            const cantidad = leerCantidad(input.value);
            if (cantidad > 0) {
                lineas.push({ producto_id: input.dataset.productoId, cantidad });
            }
        });
        return lineas;
    }

    function conectarBuscador(inputId, tablaId) {
        document.getElementById(inputId).addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            document.getElementById(tablaId).querySelectorAll('.producto-fila').forEach(fila => {
                const nombre = fila.querySelector('td').textContent.toLowerCase();
                fila.style.display = nombre.includes(q) ? '' : 'none';
            });
        });
    }
    conectarBuscador('buscadorProductosGrid', 'tablaProductosGrid');
    conectarBuscador('editBuscadorProductosGrid', 'editTablaProductosGrid');

    function esInicialSeleccionado() {
        return document.getElementById('tipoAlbaran').value === 'INICIAL';
    }

    pintarBotones('tipoAlbaranBotones', 'tipoAlbaran', TIPOS_ALBARAN, '', () => {
        const tipoStandActual = document.getElementById('tipoStand').value;
        if (tipoStandActual) {
            document.getElementById('buscadorProductosGrid').value = '';
            cargarRejillaProductosEn('tablaProductosGrid', bloqueProductos, 'totalAlbaran', tipoStandActual, null, esInicialSeleccionado());
        }
    });
    pintarBotones('tipoStandBotones', 'tipoStand', TIPOS_STAND, '', (valor) => {
        document.getElementById('buscadorProductosGrid').value = '';
        cargarRejillaProductosEn('tablaProductosGrid', bloqueProductos, 'totalAlbaran', valor, null, esInicialSeleccionado());
    });

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
    // --- Buscador en tiempo real (punto de venta o importe) ---
    let albaranesCache = [];
    document.getElementById('buscadorAlbaranes').addEventListener('input', (e) => {
        renderizarTablaAlbaranes(filtrarAlbaranes(e.target.value));
    });

    function filtrarAlbaranes(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return albaranesCache;
        return albaranesCache.filter(a => {
            const campos = [nombrePuntoVenta(a.punto_venta_origen_id), nombrePuntoVenta(a.punto_venta_destino_id), String(a.total_albaran || '')];
            return campos.some(c => (c || '').toLowerCase().includes(q));
        });
    }

    async function cargarAlbaranes() {
        try {
            const res = await fetch('/api/albaranes');
            if (!res.ok) throw new Error('Error al cargar los albaranes');
            albaranesCache = await res.json();

            document.getElementById('contadorAlbaranes').textContent = albaranesCache.length;

            const texto = document.getElementById('buscadorAlbaranes').value;
            renderizarTablaAlbaranes(filtrarAlbaranes(texto));
        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-red-500">Error al cargar los albaranes.</td></tr>`;
        }
    }

    function renderizarTablaAlbaranes(datos) {
        if (!datos || datos.length === 0) {
            tabla.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-gray-500">No hay albaranes que coincidan.</td></tr>`;
            return;
        }

        tabla.innerHTML = datos.map(a => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-800 font-medium">${formatearFecha(a.fecha)}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(a.punto_venta_origen_id)}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(a.punto_venta_destino_id)}</td>
                    <td class="p-3 text-gray-600">${a.tipo_stand}</td>
                    <td class="p-3 text-gray-600">${a.tipo_albaran}</td>
                    <td class="p-3 font-semibold text-gray-800 whitespace-nowrap">${formatearImporte(a.total_albaran)}</td>
                    <td class="p-3">
                        <a href="/api/albaranes/${a.id}/pdf" target="_blank" class="text-blue-600 hover:underline text-xs">Ver</a>
                        <span class="text-gray-300">|</span>
                        <a href="/api/albaranes/${a.id}/pdf?download=1" class="text-blue-600 hover:underline text-xs">Descargar</a>
                    </td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${a.id}">
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
                    await eliminarAlbaran(id);
                }
            });
        });
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

            html += `<div class="pt-3"><a href="/api/albaranes/${id}/pdf" target="_blank" class="text-blue-600 hover:underline text-sm">Ver PDF</a> <span class="text-gray-300">|</span> <a href="/api/albaranes/${id}/pdf?download=1" class="text-blue-600 hover:underline text-sm">Descargar PDF</a></div>`;

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

    // --- Editar (Fecha, Origen, Destino, Tipo_Stand, Tipo de Albarán y productos/cantidades) ---
    const formEditar = document.getElementById('formEditarAlbaran');

    async function abrirEditar(id) {
        try {
            const res = await fetch(`/api/albaranes/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el albarán');
            const a = await res.json();

            document.getElementById('editId').value = a.id;
            document.getElementById('editFecha').value = a.fecha ? a.fecha.substring(0, 10) : '';

            const opcionesPV = puntosVentaCache.map(pv => `<option value="${pv.id}">${pv.nombre}</option>`).join('');
            document.getElementById('editPuntoVentaOrigen').innerHTML = `<option value="">-- Selecciona --</option>${opcionesPV}`;
            document.getElementById('editPuntoVentaDestino').innerHTML = `<option value="">-- Selecciona --</option>${opcionesPV}`;
            document.getElementById('editPuntoVentaOrigen').value = a.punto_venta_origen_id || '';
            document.getElementById('editPuntoVentaDestino').value = a.punto_venta_destino_id || '';
            document.getElementById('editMismoPuntoError').classList.add('hidden');

            pintarBotones('editTipoAlbaranBotones', 'editTipoAlbaran', TIPOS_ALBARAN, a.tipo_albaran);

            // Cantidades actuales por producto, para precargar la rejilla
            const cantidadesIniciales = {};
            (a.lineas || []).forEach(l => {
                if (l.producto_id) cantidadesIniciales[l.producto_id] = l.cantidad;
            });

            const editBloqueProductos = document.getElementById('editBloqueProductos');
            pintarBotones('editTipoStandBotones', 'editTipoStand', TIPOS_STAND, a.tipo_stand, (valor) => {
                document.getElementById('editBuscadorProductosGrid').value = '';
                cargarRejillaProductosEn('editTablaProductosGrid', editBloqueProductos, 'editTotalAlbaran', valor, cantidadesIniciales);
            });
            document.getElementById('editBuscadorProductosGrid').value = '';
            await cargarRejillaProductosEn('editTablaProductosGrid', editBloqueProductos, 'editTotalAlbaran', a.tipo_stand, cantidadesIniciales);

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el albarán para editar.');
        }
    }
    document.getElementById('btnCerrarEditar').addEventListener('click', () => {
        document.getElementById('modalEditar').classList.add('hidden');
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();

        const origen = document.getElementById('editPuntoVentaOrigen').value;
        const destino = document.getElementById('editPuntoVentaDestino').value;
        const tipoStand = document.getElementById('editTipoStand').value;
        const tipoAlbaran = document.getElementById('editTipoAlbaran').value;

        if (!formEditar.checkValidity() || !tipoStand || !tipoAlbaran) {
            formEditar.reportValidity();
            if (!tipoStand) alert('Selecciona un Tipo_Stand.');
            else if (!tipoAlbaran) alert('Selecciona un Tipo de Albarán.');
            return;
        }
        if (origen === destino) {
            document.getElementById('editMismoPuntoError').classList.remove('hidden');
            return;
        }
        document.getElementById('editMismoPuntoError').classList.add('hidden');

        const lineas = recogerLineasDe('editTablaProductosGrid');
        if (lineas.length === 0) {
            alert('Añade al menos una cantidad mayor que 0 en algún producto.');
            return;
        }

        const id = document.getElementById('editId').value;
        const datos = {
            fecha: document.getElementById('editFecha').value,
            punto_venta_origen_id: origen,
            punto_venta_destino_id: destino,
            tipo_stand: tipoStand,
            tipo_albaran: tipoAlbaran,
            lineas
        };

        try {
            const res = await fetch(`/api/albaranes/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al guardar los cambios');

            document.getElementById('modalEditar').classList.add('hidden');
            cargarAlbaranes();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo guardar el albarán.');
        }
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

            const lineas = recogerLineasDe('tablaProductosGrid');
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
                pintarBotones('tipoAlbaranBotones', 'tipoAlbaran', TIPOS_ALBARAN, '', () => {
                    const tipoStandActual = document.getElementById('tipoStand').value;
                    if (tipoStandActual) {
                        document.getElementById('buscadorProductosGrid').value = '';
                        cargarRejillaProductosEn('tablaProductosGrid', bloqueProductos, 'totalAlbaran', tipoStandActual, null, esInicialSeleccionado());
                    }
                });
                pintarBotones('tipoStandBotones', 'tipoStand', TIPOS_STAND, '', (valor) => {
                    document.getElementById('buscadorProductosGrid').value = '';
                    cargarRejillaProductosEn('tablaProductosGrid', bloqueProductos, 'totalAlbaran', valor, null, esInicialSeleccionado());
                });
                bloqueProductos.classList.add('hidden');
                barraTotalAlta.classList.add('hidden');
                document.getElementById('totalAlbaran').textContent = '0.00 €';
                cargarAlbaranes();
            } catch (err) {
                console.error(err);
                alert(err.message || 'No se pudo crear el albarán.');
            }
        });
    }

    // --- Importar histórico desde Excel + ZIP ---
    const inputExcelAlbaranes = document.getElementById('inputExcelAlbaranes');
    const inputZipAlbaranes = document.getElementById('inputZipAlbaranes');
    const btnImportarAlbaranes = document.getElementById('btnImportarAlbaranes');
    const resultadoImportacionAlbaranes = document.getElementById('resultadoImportacionAlbaranes');

    btnImportarAlbaranes.addEventListener('click', async () => {
        const archivoExcel = inputExcelAlbaranes.files[0];
        if (!archivoExcel) {
            alert('Selecciona primero el archivo Excel.');
            return;
        }

        btnImportarAlbaranes.disabled = true;
        btnImportarAlbaranes.textContent = 'Importando...';
        resultadoImportacionAlbaranes.classList.add('hidden');

        const formData = new FormData();
        formData.append('excel', archivoExcel);
        const archivoZip = inputZipAlbaranes.files[0];
        if (archivoZip) formData.append('zip', archivoZip);

        try {
            const res = await fetch('/api/albaranes/importar-excel-zip', { method: 'POST', body: formData });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al importar');

            let texto = `Importación completada: ${resultado.creados} albarán(es) creado(s) de ${resultado.total} filas leídas. `;
            texto += `${resultado.conPdf} con PDF, ${resultado.sinPdf} sin PDF.`;
            if (resultado.omitidos > 0) texto += ` ${resultado.omitidos} fila(s) omitida(s) (datos incompletos).`;
            if (resultado.mismoOrigenDestino > 0) texto += ` ${resultado.mismoOrigenDestino} fila(s) omitida(s) (origen y destino iguales).`;
            if (resultado.sinPuntoVenta > 0) texto += ` ${resultado.sinPuntoVenta} fila(s) con algún Punto de Venta que no se encontró.`;
            if (resultado.sinNave > 0) texto += ` ${resultado.sinNave} fila(s) sin poder encontrar "La Nave" (créala en Puntos de Venta si aún no existe).`;

            resultadoImportacionAlbaranes.textContent = texto;
            resultadoImportacionAlbaranes.className = 'text-sm mb-6 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3';
            resultadoImportacionAlbaranes.classList.remove('hidden');

            cargarAlbaranes();
        } catch (err) {
            console.error(err);
            resultadoImportacionAlbaranes.textContent = err.message || 'No se pudo importar.';
            resultadoImportacionAlbaranes.className = 'text-sm mb-6 text-red-700 bg-red-50 border border-red-200 rounded p-3';
            resultadoImportacionAlbaranes.classList.remove('hidden');
        } finally {
            btnImportarAlbaranes.disabled = false;
            btnImportarAlbaranes.textContent = '📄 Importar';
            inputExcelAlbaranes.value = '';
            inputZipAlbaranes.value = '';
        }
    });

    await cargarPuntosVentaSelect();
    await cargarAlbaranes();
});
