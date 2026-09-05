document.addEventListener('DOMContentLoaded', async () => {
    const btnFichar = document.getElementById('btnFichar');
    const selectPuntoVenta = document.getElementById('puntoVenta');
    const inputFecha = document.getElementById('fecha');
    const inputHora = document.getElementById('hora');
    const bloqueFicharPor = document.getElementById('bloqueFicharPor');
    const selectFicharPor = document.getElementById('ficharPor');
    const tabla = document.getElementById('tablaFichajes');

    let puntosVentaCache = [];
    let empleadosCache = []; // solo si puede fichar por terceros
    let miPanel = null; // { yo, puede_terceros, empleados }
    let empleadoSeleccionadoId = null; // null = yo mismo (si tengo ficha propia)

    function ahoraParaInputs() {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        inputFecha.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        inputHora.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function formatearFecha(f) {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('es-ES');
    }

    function formatearHora(f) {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }

    function calcularHoras(entrada, salida) {
        if (!entrada || !salida) return '-';
        const ms = new Date(salida) - new Date(entrada);
        if (isNaN(ms) || ms < 0) return '-';
        return (ms / (1000 * 60 * 60)).toFixed(2) + ' h';
    }

    function nombrePuntoVenta(id) {
        const pv = puntosVentaCache.find(p => String(p.id) === String(id));
        return pv ? pv.nombre : '-';
    }

    // --- Carga inicial: puntos de venta + mi panel ---
    async function cargarPuntosVenta() {
        try {
            const res = await fetch('/api/puntos-venta');
            if (!res.ok) throw new Error('Error al cargar puntos de venta');
            puntosVentaCache = await res.json();
            const opciones = puntosVentaCache.map(pv => `<option value="${pv.id}">${pv.nombre}</option>`).join('');
            selectPuntoVenta.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
            document.getElementById('editPuntoVenta').innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
        } catch (err) {
            console.error(err);
        }
    }

    const iconoReloj = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 animate-spin">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
        </svg>`;

    function actualizarBoton() {
        const empleado = empleadoSeleccionadoId
            ? miPanel.empleados.find(e => e.id === empleadoSeleccionadoId)
            : miPanel.yo;

        if (!empleado) {
            btnFichar.disabled = true;
            btnFichar.className = 'w-full h-20 rounded-lg text-xl font-bold text-white transition bg-gray-300';
            btnFichar.innerHTML = miPanel.yo ? 'Selecciona un empleado' : 'Elige por quién vas a fichar';
            return;
        }

        const esSalida = empleado.proxima_accion === 'SALIDA';
        btnFichar.disabled = false;
        btnFichar.className = `w-full h-20 rounded-lg text-white transition flex flex-col items-center justify-center gap-0.5 ${esSalida ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`;
        btnFichar.innerHTML = `
            <span class="text-xl font-bold">${esSalida ? 'Fichar Salida' : 'Fichar Entrada'}</span>
            <span class="text-sm font-medium opacity-90">${empleado.nombre}</span>
        `;
    }

    function mostrarBotonProcesando() {
        btnFichar.disabled = true;
        btnFichar.className = 'w-full h-20 rounded-lg text-white transition flex flex-col items-center justify-center gap-1 bg-gray-400';
        btnFichar.innerHTML = `
            ${iconoReloj}
            <span class="text-sm font-medium">Registrando...</span>
        `;
    }

    async function cargarMiPanel() {
        try {
            const res = await fetch('/api/fichajes/mi-panel');
            const datos = await res.json();
            if (!res.ok) throw new Error(datos.error || 'Error al cargar tu panel de fichaje');
            miPanel = datos;

            if (miPanel.yo) {
                selectPuntoVenta.value = miPanel.yo.punto_venta_id || '';
            }

            if (miPanel.puede_terceros && miPanel.empleados.length > 0) {
                empleadosCache = miPanel.empleados;
                const opciones = empleadosCache
                    .filter(e => !miPanel.yo || e.id !== miPanel.yo.empleado_id)
                    .map(e => `<option value="${e.id}">${e.nombre}</option>`)
                    .join('');

                if (miPanel.yo) {
                    selectFicharPor.innerHTML = `<option value="">Yo mismo</option>${opciones}`;
                } else {
                    // No tienes ficha de Empleado propia: hay que elegir a alguien sí o sí
                    selectFicharPor.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
                }
                bloqueFicharPor.classList.remove('hidden');
            }

            actualizarBoton();
        } catch (err) {
            console.error(err);
            btnFichar.textContent = 'No se pudo cargar tu panel';
            btnFichar.className = 'w-full h-20 rounded-lg text-xl font-bold text-white transition bg-gray-300';
        }
    }

    selectFicharPor.addEventListener('change', () => {
        empleadoSeleccionadoId = selectFicharPor.value || null;
        const empleado = empleadoSeleccionadoId
            ? empleadosCache.find(e => e.id === empleadoSeleccionadoId)
            : miPanel.yo;
        if (empleado) selectPuntoVenta.value = empleado.punto_venta_id || '';
        actualizarBoton();
    });

    btnFichar.addEventListener('click', async () => {
        const empleadoId = empleadoSeleccionadoId || (miPanel.yo ? miPanel.yo.empleado_id : null);
        const puntoVentaId = selectPuntoVenta.value;

        if (!empleadoId) {
            alert('Elige por quién vas a fichar.');
            return;
        }
        if (!puntoVentaId) {
            alert('Selecciona un Punto de Venta.');
            return;
        }

        const fechaValor = inputFecha.value;
        const horaValor = inputHora.value;
        const fechaHoraCombinada = (fechaValor && horaValor) ? `${fechaValor}T${horaValor}` : '';

        mostrarBotonProcesando();
        try {
            const res = await fetch('/api/fichajes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    empleado_id: empleadoId,
                    punto_venta_id: puntoVentaId,
                    hora: fechaHoraCombinada ? new Date(fechaHoraCombinada).toISOString() : undefined
                })
            });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al registrar el fichaje');

            ahoraParaInputs();
            await cargarMiPanel();
            cargarFichajes();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo registrar el fichaje.');
            actualizarBoton();
        }
    });

    // --- Colapsar / expandir la lista ---
    const btnToggleLista = document.getElementById('btnToggleLista');
    const listaWrapper = document.getElementById('listaFichajesWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Buscador en tiempo real (empleado o punto de venta) ---
    let fichajesCache = [];
    let empleadosDetalleCache = {};
    document.getElementById('buscadorFichajes').addEventListener('input', (e) => {
        renderizarTablaFichajes(filtrarFichajes(e.target.value));
    });

    function filtrarFichajes(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return fichajesCache;
        return fichajesCache.filter(f => {
            const campos = [f.empleado_nombre, f.punto_venta_nombre];
            return campos.some(c => (c || '').toLowerCase().includes(q));
        });
    }

    async function cargarFichajes() {
        try {
            const res = await fetch('/api/fichajes');
            if (!res.ok) throw new Error('Error al cargar los fichajes');
            fichajesCache = await res.json();

            fichajesCache.forEach(f => {
                if (f.empleado_id && f.empleado_nombre) {
                    empleadosDetalleCache[f.empleado_id] = f.empleado_nombre;
                }
            });

            document.getElementById('contadorFichajes').textContent = fichajesCache.length;

            const texto = document.getElementById('buscadorFichajes').value;
            renderizarTablaFichajes(filtrarFichajes(texto));
        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">Error al cargar los fichajes.</td></tr>`;
        }
    }

    function renderizarTablaFichajes(datos) {
        if (!datos || datos.length === 0) {
            tabla.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">No hay fichajes que coincidan.</td></tr>`;
            return;
        }

        tabla.innerHTML = datos.map(f => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-800 font-medium">${formatearFecha(f.fecha)}</td>
                    <td class="p-3 text-gray-600">${f.empleado_nombre || '-'}</td>
                    <td class="p-3 text-gray-600">${f.punto_venta_nombre || '-'}</td>
                    <td class="p-3 text-gray-600">${formatearHora(f.hora_entrada)}</td>
                    <td class="p-3 text-gray-600">${f.hora_salida ? formatearHora(f.hora_salida) : '<span class="text-amber-600 font-medium">Abierto</span>'}</td>
                    <td class="p-3 text-gray-600 whitespace-nowrap">${calcularHoras(f.hora_entrada, f.hora_salida)}</td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${f.id}">
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
                    await eliminarFichaje(id);
                }
            });
        });
    }

    // --- Editar ---
    const formEditar = document.getElementById('formEditarFichaje');

    function aInputDatetimeLocal(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function cargarSelectEmpleadoEditar() {
        const empleadosOrdenados = Object.entries(empleadosDetalleCache).sort((a, b) => a[1].localeCompare(b[1]));
        const opcionesEmp = empleadosOrdenados.map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('');
        document.getElementById('editEmpleado').innerHTML = `<option value="">-- Selecciona --</option>${opcionesEmp}`;
    }

    async function abrirEditar(id) {
        try {
            const f = fichajesCache.find(x => String(x.id) === String(id));
            if (!f) throw new Error('Fichaje no encontrado');

            cargarSelectEmpleadoEditar();

            document.getElementById('editId').value = f.id;
            document.getElementById('editEmpleado').value = f.empleado_id || '';
            document.getElementById('editPuntoVenta').value = f.punto_venta_id || '';
            document.getElementById('editHoraEntrada').value = aInputDatetimeLocal(f.hora_entrada);
            document.getElementById('editHoraSalida').value = aInputDatetimeLocal(f.hora_salida);

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el fichaje para editar.');
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
        const horaEntrada = document.getElementById('editHoraEntrada').value;
        const horaSalida = document.getElementById('editHoraSalida').value;

        const datos = {
            empleado_id: document.getElementById('editEmpleado').value,
            punto_venta_id: document.getElementById('editPuntoVenta').value,
            hora_entrada: horaEntrada ? new Date(horaEntrada).toISOString() : null,
            hora_salida: horaSalida ? new Date(horaSalida).toISOString() : null
        };

        try {
            const res = await fetch(`/api/fichajes/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al guardar los cambios');

            document.getElementById('modalEditar').classList.add('hidden');
            cargarFichajes();
            cargarMiPanel();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo guardar el fichaje.');
        }
    });

    // --- Eliminar ---
    async function eliminarFichaje(id) {
        if (!confirm('¿Seguro que quieres eliminar este fichaje? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/fichajes/${id}`, { method: 'DELETE' });
            const resultado = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(resultado.error || 'Error al eliminar');
            cargarFichajes();
            cargarMiPanel();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo eliminar el fichaje.');
        }
    }

    ahoraParaInputs();
    await cargarPuntosVenta();
    await cargarMiPanel();
    await cargarFichajes();
});
