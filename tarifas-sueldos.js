document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formTarifa');
    const tabla = document.getElementById('tablaTarifas');
    const selectEmpleado = document.getElementById('empleado');

    let empleadosCache = [];

    function formatearFecha(f) {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('es-ES');
    }

    function formatearImporte(n) {
        return Number(n || 0).toFixed(2) + ' €';
    }

    function nombreEmpleado(id) {
        const e = empleadosCache.find(x => String(x.id) === String(id));
        return e ? e.nombre : '-';
    }

    async function cargarEmpleadosSelect() {
        try {
            const res = await fetch('/api/personal-dropdown');
            if (!res.ok) throw new Error('Error al cargar empleados');
            empleadosCache = await res.json();

            const opciones = empleadosCache.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
            selectEmpleado.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
            document.getElementById('editEmpleado').innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
        } catch (err) {
            console.error('Error cargando empleados:', err);
        }
    }

    // --- Cálculo automático de Importe Hora = Importe Día / Horas por Día ---
    function calcularImporteHora(inputDia, inputHoras, inputHoraDestino) {
        function recalcular() {
            const dia = parseFloat(inputDia.value) || 0;
            const horas = parseFloat(inputHoras.value) || 0;
            inputHoraDestino.value = horas > 0 ? (dia / horas).toFixed(2) : '';
        }
        inputDia.addEventListener('input', recalcular);
        inputHoras.addEventListener('input', recalcular);
    }
    calcularImporteHora(
        document.getElementById('importeDia'),
        document.getElementById('horasPorDia'),
        document.getElementById('importeHora')
    );
    calcularImporteHora(
        document.getElementById('editImporteDia'),
        document.getElementById('editHorasPorDia'),
        document.getElementById('editImporteHora')
    );

    // --- Colapsar / expandir la lista ---
    const btnToggleLista = document.getElementById('btnToggleLista');
    const listaWrapper = document.getElementById('listaTarifasWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Buscador en tiempo real (por nombre de empleado) ---
    let tarifasCache = [];
    document.getElementById('buscadorTarifas').addEventListener('input', (e) => {
        renderizarTablaTarifas(filtrarTarifas(e.target.value));
    });

    function filtrarTarifas(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return tarifasCache;
        return tarifasCache.filter(t => (t.empleado_nombre || '').toLowerCase().includes(q));
    }

    // --- Cargar lista ---
    async function cargarTarifas() {
        try {
            const res = await fetch('/api/tarifas-sueldos');
            if (!res.ok) throw new Error('Error al cargar las tarifas');
            tarifasCache = await res.json();

            document.getElementById('contadorTarifas').textContent = tarifasCache.length;

            const texto = document.getElementById('buscadorTarifas').value;
            renderizarTablaTarifas(filtrarTarifas(texto));
        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar las tarifas.</td></tr>`;
        }
    }

    function renderizarTablaTarifas(datos) {
        if (!datos || datos.length === 0) {
            tabla.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">No hay tarifas que coincidan.</td></tr>`;
            return;
        }

        tabla.innerHTML = datos.map(t => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-800 font-medium">${t.empleado_nombre || '-'}</td>
                    <td class="p-3 text-gray-600 whitespace-nowrap">${formatearImporte(t.importe_dia)}</td>
                    <td class="p-3 text-gray-600 whitespace-nowrap">${formatearImporte(t.importe_hora)}</td>
                    <td class="p-3 text-gray-600">${formatearFecha(t.vigente_desde)}</td>
                    <td class="p-3 text-gray-600">${formatearFecha(t.vigente_hasta)}</td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${t.id}">
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
                        await eliminarTarifa(id);
                    }
                });
            });
    }

    // --- Detalle ---
    async function abrirDetalle(id) {
        try {
            const res = await fetch(`/api/tarifas-sueldos/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar la tarifa');
            const t = await res.json();

            const filas = [
                ['Empleado', t.empleado_nombre || '-'],
                ['Importe Día', formatearImporte(t.importe_dia)],
                ['Horas por Día', t.horas_por_dia],
                ['Importe Hora', formatearImporte(t.importe_hora)],
                ['Extra +10 Horas', formatearImporte(t.extra_mas_10_horas)],
                ['Hora x Montaje', formatearImporte(t.horaxmontaje)],
                ['Vigente Desde', formatearFecha(t.vigente_desde)],
                ['Vigente Hasta', formatearFecha(t.vigente_hasta)],
                ['Registrado por', t.registrado_por_nombre || '-']
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
    const formEditar = document.getElementById('formEditarTarifa');

    async function abrirEditar(id) {
        try {
            const res = await fetch(`/api/tarifas-sueldos/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar la tarifa');
            const t = await res.json();

            document.getElementById('editId').value = t.id;
            const opcionesEdit = empleadosCache.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
            document.getElementById('editEmpleado').innerHTML = `<option value="">-- Selecciona --</option>${opcionesEdit}`;
            document.getElementById('editEmpleado').value = t.empleado_id || '';
            document.getElementById('editImporteDia').value = t.importe_dia || '';
            document.getElementById('editHorasPorDia').value = t.horas_por_dia || '';
            document.getElementById('editImporteHora').value = t.importe_hora || '';
            document.getElementById('editExtraMas10Horas').value = t.extra_mas_10_horas || 0;
            document.getElementById('editHoraxmontaje').value = t.horaxmontaje || 0;
            document.getElementById('editVigenteDesde').value = t.vigente_desde ? t.vigente_desde.substring(0, 10) : '';
            document.getElementById('editVigenteHasta').value = t.vigente_hasta ? t.vigente_hasta.substring(0, 10) : '';

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar la tarifa para editar.');
        }
    }
    document.getElementById('btnCerrarEditar').addEventListener('click', () => {
        document.getElementById('modalEditar').classList.add('hidden');
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = document.getElementById('editId').value;
        const datos = {
            empleado_id: document.getElementById('editEmpleado').value,
            importe_dia: document.getElementById('editImporteDia').value,
            horas_por_dia: document.getElementById('editHorasPorDia').value,
            importe_hora: document.getElementById('editImporteHora').value,
            extra_mas_10_horas: document.getElementById('editExtraMas10Horas').value || 0,
            horaxmontaje: document.getElementById('editHoraxmontaje').value || 0,
            vigente_desde: document.getElementById('editVigenteDesde').value,
            vigente_hasta: document.getElementById('editVigenteHasta').value || null
        };

        try {
            const res = await fetch(`/api/tarifas-sueldos/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al guardar los cambios');

            document.getElementById('modalEditar').classList.add('hidden');
            cargarTarifas();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo guardar la tarifa.');
        }
    });

    // --- Eliminar ---
    async function eliminarTarifa(id) {
        if (!confirm('¿Seguro que quieres eliminar esta tarifa? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/tarifas-sueldos/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarTarifas();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar la tarifa.');
        }
    }

    // --- Alta ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const datos = {
                empleado_id: document.getElementById('empleado').value,
                importe_dia: document.getElementById('importeDia').value,
                horas_por_dia: document.getElementById('horasPorDia').value,
                importe_hora: document.getElementById('importeHora').value,
                extra_mas_10_horas: document.getElementById('extraMas10Horas').value || 0,
                horaxmontaje: document.getElementById('horaxmontaje').value || 0,
                vigente_desde: document.getElementById('vigenteDesde').value,
                vigente_hasta: document.getElementById('vigenteHasta').value || null
            };

            try {
                const res = await fetch('/api/tarifas-sueldos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datos)
                });
                const resultado = await res.json();
                if (!res.ok) throw new Error(resultado.error || 'Error al crear la tarifa');

                form.reset();
                cargarTarifas();
            } catch (err) {
                console.error(err);
                alert(err.message || 'No se pudo crear la tarifa.');
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
            const res = await fetch('/api/tarifas-sueldos/importar-excel', { method: 'POST', body: formData });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al importar el archivo');

            let texto = `Importación completada: ${resultado.creados} tarifa(s) creada(s) de ${resultado.total} filas leídas.`;
            if (resultado.omitidos > 0) texto += ` ${resultado.omitidos} fila(s) omitida(s) (datos incompletos).`;
            if (resultado.sinEmpleado > 0) texto += ` ${resultado.sinEmpleado} fila(s) con un Empleado que no se encontró.`;

            resultadoImportacion.textContent = texto;
            resultadoImportacion.className = 'text-sm mb-6 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3';
            resultadoImportacion.classList.remove('hidden');

            cargarTarifas();
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

    await cargarEmpleadosSelect();
    await cargarTarifas();
});
