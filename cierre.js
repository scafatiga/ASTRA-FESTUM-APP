document.addEventListener('DOMContentLoaded', async () => {
    const btnAgregarGasto = document.getElementById('btnAgregarGasto');
    const btnAgregarAdelanto = document.getElementById('btnAgregarAdelanto');
    const gastosContainer = document.getElementById('gastosContainer');
    const adelantosContainer = document.getElementById('adelantosContainer');
    const cierreForm = document.getElementById('cierreForm');

    // --- Carga de empleados desde el backend (solo se usa en Adelantos) ---
    let empleadosCache = [];

    async function cargarEmpleados() {
        try {
            const res = await fetch('/api/empleados');
            if (!res.ok) throw new Error('No se pudo cargar la lista de empleados');
            const data = await res.json();
            empleadosCache = (Array.isArray(data) ? data : [])
                .map(e => e.nombre || e.nombre_completo || e.name || e.empleado || null)
                .filter(Boolean);
        } catch (err) {
            console.error('Error cargando empleados:', err);
            empleadosCache = [];
        }
    }

    function empleadoOptionsHtml() {
        const opciones = empleadosCache
            .map(nombre => `<option value="${nombre}">${nombre}</option>`)
            .join('');
        return `<option value="">-- Selecciona empleado --</option>${opciones}`;
    }

    await cargarEmpleados();

    // --- Filas dinámicas ---

    function agregarGastoFila() {
        const div = document.createElement('div');
        div.className = 'grid grid-cols-3 md:flex md:items-center gap-2 mb-2';
        div.innerHTML = `
            <input type="text" placeholder="Concepto / Descripción" class="gasto-desc col-span-3 md:flex-1 min-w-0 border p-2 rounded w-full text-sm" required>
            <input type="number" step="0.01" placeholder="Importe (€)" class="gasto-importe min-w-0 border p-2 rounded w-full md:w-28 text-sm" required>
            <select class="gasto-pv min-w-0 border p-2 rounded w-full md:w-32 text-sm">
                <option value="Alicante">Alicante</option>
                <option value="Madrid">Madrid</option>
            </select>
            <button type="button" class="bg-red-500 hover:bg-red-600 text-white rounded text-sm transition min-w-0 w-full md:w-auto py-2 md:px-3 md:py-2" onclick="this.parentElement.remove()">✕</button>
        `;
        gastosContainer.appendChild(div);
    }

    function agregarAdelantoFila() {
        const div = document.createElement('div');
        div.className = 'grid grid-cols-3 md:flex md:items-center gap-2 mb-2';
        div.innerHTML = `
            <select class="adelanto-emp col-span-3 md:flex-1 min-w-0 border p-2 rounded w-full text-sm" required>
                ${empleadoOptionsHtml()}
            </select>
            <input type="number" step="0.01" placeholder="Importe (€)" class="adelanto-importe min-w-0 border p-2 rounded w-full md:w-28 text-sm" required>
            <select class="adelanto-pv min-w-0 border p-2 rounded w-full md:w-32 text-sm">
                <option value="Alicante">Alicante</option>
                <option value="Madrid">Madrid</option>
            </select>
            <button type="button" class="bg-red-500 hover:bg-red-600 text-white rounded text-sm transition min-w-0 w-full md:w-auto py-2 md:px-3 md:py-2" onclick="this.parentElement.remove()">✕</button>
        `;
        adelantosContainer.appendChild(div);
    }

    if (btnAgregarGasto) btnAgregarGasto.addEventListener('click', agregarGastoFila);
    if (btnAgregarAdelanto) btnAgregarAdelanto.addEventListener('click', agregarAdelantoFila);

    if (gastosContainer && gastosContainer.children.length === 0) agregarGastoFila();
    if (adelantosContainer && adelantosContainer.children.length === 0) agregarAdelantoFila();

    if (cierreForm) {
        cierreForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const puntoVenta = document.getElementById('puntoVenta').value;
            const totalEfectivo = parseFloat(document.getElementById('totalEfectivo').value) || 0;
            const totalTarjeta = parseFloat(document.getElementById('totalTarjeta').value) || 0;
            const observaciones = document.getElementById('observaciones').value;

            const gastos = [];
            document.querySelectorAll('#gastosContainer > div').forEach(row => {
                const descripcion = row.querySelector('.gasto-desc').value;
                const importe = parseFloat(row.querySelector('.gasto-importe').value) || 0;
                const pv = row.querySelector('.gasto-pv').value;
                if (descripcion && importe > 0) {
                    gastos.push({ descripcion, importe, punto_venta: pv });
                }
            });

            const adelantos = [];
            document.querySelectorAll('#adelantosContainer > div').forEach(row => {
                const empleado = row.querySelector('.adelanto-emp').value;
                const importe = parseFloat(row.querySelector('.adelanto-importe').value) || 0;
                const pv = row.querySelector('.adelanto-pv').value;
                if (empleado && importe > 0) {
                    adelantos.push({ empleado, importe, punto_venta: pv });
                }
            });

            const datosCierre = {
                punto_venta: puntoVenta,
                total_efectivo: totalEfectivo,
                total_tarjeta: totalTarjeta,
                gastos,
                adelantos,
                observaciones
            };

            try {
                const response = await fetch('/api/cierres', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datosCierre)
                });

                if (!response.ok) throw new Error('Error al registrar el cierre');

                alert('¡Cierre registrado correctamente!');
                cierreForm.reset();
                document.querySelectorAll('#gastosContainer > div, #adelantosContainer > div').forEach(el => el.remove());
                agregarGastoFila();
                agregarAdelantoFila();
                cargarCierres();
            } catch (error) {
                console.error(error);
                alert('Hubo un error al guardar el cierre.');
            }
        });
    }

    // =========================================================================
    // Histórico de Cierres (embebido, colapsado abajo del formulario)
    // =========================================================================

    const tbody = document.getElementById('tablaCierres');

    let esAdmin = false;
    try {
        const resMe = await fetch('/api/me');
        if (resMe.ok) {
            const yo = await resMe.json();
            esAdmin = !!yo.es_admin;
        }
    } catch (err) {
        console.error('Error al cargar el usuario actual:', err);
    }

    function formatearFechaHora(rawFecha) {
        if (!rawFecha) return 'Fecha no disponible';
        const dateObj = new Date(rawFecha);
        if (isNaN(dateObj.getTime())) return 'Fecha no disponible';
        return dateObj.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
    }

    function calcularTotales(c) {
        const rawFecha = c.fecha || c.created_at || c.createdAt || c.timestamp;
        const fechaFormateada = formatearFechaHora(rawFecha);
        const puntoVenta = c.punto_venta || c.puntoVenta || c.puntoventa || c.pv || 'Alicante';

        const efectivo = Number(c.total_efectivo ?? c.efectivo ?? c.totalEfectivo ?? 0);
        const tarjeta = Number(c.total_tarjeta ?? c.tarjeta ?? c.totalTarjeta ?? 0);
        const totalBruto = Number(c.total ?? (efectivo + tarjeta));

        const gastos = c.gastos || c.gastosList || c.listaGastos || c.gasto || [];
        const totalGastos = Array.isArray(gastos)
            ? gastos.reduce((sum, g) => sum + Number(g.importe || g.monto || g.valor || 0), 0)
            : Number(c.total_gastos || c.gastos || 0);

        const adelantos = c.adelantos || c.adelantosList || c.listaAdelantos || c.adelanto || [];
        const totalAdelantos = Array.isArray(adelantos)
            ? adelantos.reduce((sum, a) => sum + Number(a.importe || a.monto || a.valor || 0), 0)
            : Number(c.total_adelantos || c.adelantos || 0);

        const cashNeto = efectivo - totalGastos - totalAdelantos;

        return { fechaFormateada, puntoVenta, efectivo, tarjeta, totalBruto, gastos, adelantos, totalGastos, totalAdelantos, cashNeto };
    }

    function construirDetallesHtml(gastos, adelantos) {
        let detallesHtml = '<div class="space-y-1 text-xs">';
        if (Array.isArray(gastos) && gastos.length > 0) {
            detallesHtml += '<div class="font-semibold text-red-600">Gastos:</div>';
            gastos.forEach(g => {
                const desc = g.descripcion || g.concepto || g.desc || 'Gasto';
                const imp = Number(g.importe || g.monto || g.valor || 0).toFixed(2);
                const pvGasto = g.punto_venta || g.puntoVenta || '';
                detallesHtml += `<div>- ${desc}: ${imp}€ ${pvGasto ? '(' + pvGasto + ')' : ''}</div>`;
            });
        }
        if (Array.isArray(adelantos) && adelantos.length > 0) {
            detallesHtml += '<div class="font-semibold text-blue-600 mt-1">Adelantos:</div>';
            adelantos.forEach(a => {
                const emp = a.empleado || a.nombre || 'Empleado';
                const imp = Number(a.importe || a.monto || a.valor || 0).toFixed(2);
                const pvAd = a.punto_venta || a.puntoVenta || '';
                detallesHtml += `<div>- ${emp}: ${imp}€ ${pvAd ? '(' + pvAd + ')' : ''}</div>`;
            });
        }
        if ((!Array.isArray(gastos) || gastos.length === 0) && (!Array.isArray(adelantos) || adelantos.length === 0)) {
            detallesHtml += '<span class="text-gray-400">Sin incidencias</span>';
        }
        detallesHtml += '</div>';
        return detallesHtml;
    }

    // --- Colapsar / expandir el histórico ---
    const btnToggleHistorico = document.getElementById('btnToggleHistorico');
    const historicoWrapper = document.getElementById('historicoWrapper');
    const iconoToggleHistorico = document.getElementById('iconoToggleHistorico');
    btnToggleHistorico.addEventListener('click', () => {
        const abierta = !historicoWrapper.classList.contains('hidden');
        historicoWrapper.classList.toggle('hidden');
        iconoToggleHistorico.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Buscador en tiempo real (fecha o punto de venta) ---
    let cierresCache = [];
    document.getElementById('buscadorCierres').addEventListener('input', (e) => {
        renderizarTablaCierres(filtrarCierres(e.target.value));
    });

    function filtrarCierres(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return cierresCache;
        return cierresCache.filter(c => {
            const { fechaFormateada, puntoVenta } = calcularTotales(c);
            return fechaFormateada.toLowerCase().includes(q) || (puntoVenta || '').toLowerCase().includes(q);
        });
    }

    async function cargarCierres() {
        try {
            const response = await fetch('/api/cierres');
            if (!response.ok) throw new Error('Error al obtener el histórico');

            cierresCache = await response.json();
            document.getElementById('contadorCierres').textContent = cierresCache.length;

            const texto = document.getElementById('buscadorCierres').value;
            renderizarTablaCierres(filtrarCierres(texto));
        } catch (error) {
            console.error('Error:', error);
            const colspanVacio = 4;
            tbody.innerHTML = `<tr><td colspan="${colspanVacio}" class="p-4 text-center text-red-500">Error al cargar los datos del histórico.</td></tr>`;
        }
    }

    function renderizarTablaCierres(cierres) {
        const colspanVacio = 4;

        if (!cierres || cierres.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${colspanVacio}" class="p-4 text-center text-gray-500">No hay cierres que coincidan.</td></tr>`;
            return;
        }

        tbody.innerHTML = cierres.map(c => {
            const { fechaFormateada, puntoVenta, cashNeto } = calcularTotales(c);

            const opcionesAdmin = esAdmin
                ? `<option value="editar">Editar</option><option value="eliminar">Eliminar</option>`
                : '';

            return `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-700">${fechaFormateada}</td>
                    <td class="p-3 font-medium text-gray-800">${puntoVenta}</td>
                    <td class="p-3 font-bold ${cashNeto < 0 ? 'text-red-700' : 'text-emerald-700'}">${cashNeto.toFixed(2)} €</td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${c.id}">
                            <option value="">Acción...</option>
                            <option value="detalle">Detalle</option>
                            ${opcionesAdmin}
                        </select>
                    </td>
                </tr>
            `;
        }).join('');

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
                    await eliminarCierre(id);
                }
            });
        });
    }

    // --- Detalle (accesible a todos; Editar/Eliminar solo administrador) ---
    async function abrirDetalle(id) {
        try {
            const res = await fetch(`/api/cierres/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el cierre');
            const c = await res.json();
            const { fechaFormateada, puntoVenta, efectivo, tarjeta, totalBruto, gastos, adelantos, totalGastos, totalAdelantos, cashNeto } = calcularTotales(c);

            const filas = [
                ['Fecha', fechaFormateada],
                ['Punto de Venta', puntoVenta],
                ['Efectivo', efectivo.toFixed(2) + ' €'],
                ['Tarjeta', tarjeta.toFixed(2) + ' €'],
                ['Total Bruto', totalBruto.toFixed(2) + ' €'],
                ['Total Gastos', totalGastos.toFixed(2) + ' €'],
                ['Total Adelantos', totalAdelantos.toFixed(2) + ' €'],
                ['Cash Neto', cashNeto.toFixed(2) + ' €'],
                ['Observaciones', c.observaciones || '-'],
                ['Registrado por', c.registrado_por_nombre || '-']
            ];

            let html = filas.map(([label, valor]) => `
                <div class="flex justify-between border-b py-1.5 gap-4">
                    <span class="text-gray-500">${label}</span>
                    <span class="text-gray-800 font-medium text-right">${valor}</span>
                </div>
            `).join('');
            html += `<div class="pt-3">${construirDetallesHtml(gastos, adelantos)}</div>`;

            document.getElementById('contenidoDetalle').innerHTML = html;
            document.getElementById('modalDetalle').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el detalle.');
        }
    }
    const btnCerrarDetalle = document.getElementById('btnCerrarDetalle');
    if (btnCerrarDetalle) {
        btnCerrarDetalle.addEventListener('click', () => {
            document.getElementById('modalDetalle').classList.add('hidden');
        });
    }

    // --- Editar (solo administrador) ---
    const formEditarCierre = document.getElementById('formEditarCierre');

    async function abrirEditar(id) {
        try {
            const res = await fetch(`/api/cierres/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el cierre');
            const c = await res.json();

            document.getElementById('editId').value = c.id;
            document.getElementById('editFecha').value = c.fecha ? new Date(c.fecha).toISOString().slice(0, 16) : '';
            document.getElementById('editPuntoVenta').value = c.punto_venta || '';
            document.getElementById('editTotalEfectivo').value = c.total_efectivo || 0;
            document.getElementById('editTotalTarjeta').value = c.total_tarjeta || 0;
            document.getElementById('editObservaciones').value = c.observaciones || '';

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el cierre para editar.');
        }
    }
    const btnCerrarEditar = document.getElementById('btnCerrarEditar');
    if (btnCerrarEditar) {
        btnCerrarEditar.addEventListener('click', () => {
            document.getElementById('modalEditar').classList.add('hidden');
        });
    }

    if (formEditarCierre) {
        formEditarCierre.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!formEditarCierre.checkValidity()) {
                formEditarCierre.reportValidity();
                return;
            }

            const id = document.getElementById('editId').value;
            const fechaLocal = document.getElementById('editFecha').value;
            const datos = {
                fecha: fechaLocal ? new Date(fechaLocal).toISOString() : null,
                punto_venta: document.getElementById('editPuntoVenta').value.trim(),
                total_efectivo: document.getElementById('editTotalEfectivo').value,
                total_tarjeta: document.getElementById('editTotalTarjeta').value,
                observaciones: document.getElementById('editObservaciones').value.trim()
            };

            try {
                const res = await fetch(`/api/cierres/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datos)
                });
                const resultado = await res.json();
                if (!res.ok) throw new Error(resultado.error || 'Error al guardar los cambios');

                document.getElementById('modalEditar').classList.add('hidden');
                cargarCierres();
            } catch (err) {
                console.error(err);
                alert(err.message || 'No se pudo guardar el cierre.');
            }
        });
    }

    // --- Eliminar (solo administrador) ---
    async function eliminarCierre(id) {
        if (!confirm('¿Seguro que quieres eliminar este cierre? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/cierres/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarCierres();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el cierre.');
        }
    }

    await cargarCierres();
});
