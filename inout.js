document.addEventListener('DOMContentLoaded', async () => {
    const puntosVentaBotones = document.getElementById('puntosVentaBotones');
    const bloqueEmpleados = document.getElementById('bloqueEmpleados');
    const empleadosBotones = document.getElementById('empleadosBotones');
    const tabla = document.getElementById('tablaFichajes');

    let puntosVentaCache = [];
    let puntoVentaSeleccionado = null;
    let empleadosDetalleCache = {}; // id -> nombre, para el listado

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
        const horas = ms / (1000 * 60 * 60);
        return horas.toFixed(2) + ' h';
    }

    function nombrePuntoVenta(id) {
        const pv = puntosVentaCache.find(p => String(p.id) === String(id));
        return pv ? pv.nombre : '-';
    }

    // --- Paso 1: botones de Puntos de Venta ---
    async function cargarPuntosVentaBotones() {
        try {
            const res = await fetch('/api/fichajes/puntos-venta');
            if (!res.ok) throw new Error('Error al cargar puntos de venta');
            puntosVentaCache = await res.json();

            if (puntosVentaCache.length === 0) {
                puntosVentaBotones.innerHTML = '<div class="col-span-full text-center text-gray-400 text-sm py-4">No hay puntos de venta activos.</div>';
                return;
            }

            puntosVentaBotones.innerHTML = puntosVentaCache.map(pv => `
                <button type="button" class="pv-btn h-14 flex items-center justify-center text-center px-2 rounded-lg text-sm font-medium border bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200 transition" data-id="${pv.id}">
                    ${pv.nombre}
                </button>
            `).join('');

            document.querySelectorAll('.pv-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.pv-btn').forEach(b => {
                        b.className = 'pv-btn h-14 flex items-center justify-center text-center px-2 rounded-lg text-sm font-medium border bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200 transition';
                    });
                    btn.className = 'pv-btn h-14 flex items-center justify-center text-center px-2 rounded-lg text-sm font-medium border bg-blue-600 border-blue-600 text-white transition';
                    puntoVentaSeleccionado = btn.dataset.id;
                    cargarPanelEmpleados(puntoVentaSeleccionado);
                });
            });
        } catch (err) {
            console.error(err);
            puntosVentaBotones.innerHTML = '<div class="col-span-full text-center text-red-500 text-sm py-4">Error al cargar los puntos de venta.</div>';
        }
    }

    // --- Paso 2: botones de Empleados de ese Punto de Venta ---
    async function cargarPanelEmpleados(puntoVentaId) {
        bloqueEmpleados.classList.remove('hidden');
        empleadosBotones.innerHTML = '<div class="col-span-full text-center text-gray-400 text-sm py-4">Cargando...</div>';

        try {
            const res = await fetch(`/api/fichajes/panel?punto_venta_id=${puntoVentaId}`);
            if (!res.ok) throw new Error('Error al cargar empleados');
            const empleados = await res.json();

            if (empleados.length === 0) {
                empleadosBotones.innerHTML = '<div class="col-span-full text-center text-gray-400 text-sm py-4">No hay empleados asignados a este Punto de Venta.</div>';
                return;
            }

            empleadosBotones.innerHTML = empleados.map(e => {
                const esSalida = e.proxima_accion === 'SALIDA';
                const colorClase = !e.puede_ficharlo
                    ? 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed'
                    : esSalida
                        ? 'bg-red-500 hover:bg-red-600 border-red-500 text-white'
                        : 'bg-emerald-500 hover:bg-emerald-600 border-emerald-500 text-white';
                return `
                    <button type="button" class="emp-btn h-20 flex flex-col items-center justify-center text-center px-2 gap-1 rounded-lg border transition ${colorClase}" data-id="${e.id}" data-accion="${e.proxima_accion}" ${!e.puede_ficharlo ? 'disabled' : ''}>
                        <span class="text-xs font-medium opacity-90">${e.nombre}</span>
                        <span class="text-base font-bold">${e.puede_ficharlo ? (esSalida ? 'Fichar Salida' : 'Fichar Entrada') : 'Sin permiso'}</span>
                    </button>
                `;
            }).join('');

            document.querySelectorAll('.emp-btn').forEach(btn => {
                if (btn.disabled) return;
                btn.addEventListener('click', () => registrarFichaje(btn.dataset.id));
            });
        } catch (err) {
            console.error(err);
            empleadosBotones.innerHTML = '<div class="col-span-full text-center text-red-500 text-sm py-4">Error al cargar los empleados.</div>';
        }
    }

    async function registrarFichaje(empleadoId) {
        try {
            const res = await fetch('/api/fichajes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ empleado_id: empleadoId, punto_venta_id: puntoVentaSeleccionado })
            });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al registrar el fichaje');

            cargarPanelEmpleados(puntoVentaSeleccionado);
            cargarFichajes();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo registrar el fichaje.');
        }
    }

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

    async function cargarSelectsEditar() {
        const opcionesPV = puntosVentaCache.map(pv => `<option value="${pv.id}">${pv.nombre}</option>`).join('');
        document.getElementById('editPuntoVenta').innerHTML = `<option value="">-- Selecciona --</option>${opcionesPV}`;

        const empleadosOrdenados = Object.entries(empleadosDetalleCache).sort((a, b) => a[1].localeCompare(b[1]));
        const opcionesEmp = empleadosOrdenados.map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('');
        document.getElementById('editEmpleado').innerHTML = `<option value="">-- Selecciona --</option>${opcionesEmp}`;
    }

    async function abrirEditar(id) {
        try {
            const f = fichajesCache.find(x => String(x.id) === String(id));
            if (!f) throw new Error('Fichaje no encontrado');

            await cargarSelectsEditar();

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
            if (puntoVentaSeleccionado) cargarPanelEmpleados(puntoVentaSeleccionado);
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
            if (puntoVentaSeleccionado) cargarPanelEmpleados(puntoVentaSeleccionado);
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo eliminar el fichaje.');
        }
    }

    await cargarPuntosVentaBotones();
    await cargarFichajes();
});
