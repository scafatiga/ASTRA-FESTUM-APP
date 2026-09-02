document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formEmpleado');
    const tabla = document.getElementById('tablaEmpleados');
    const selectPuntoVenta = document.getElementById('puntoVenta');

    // Cache de puntos de venta: id -> nombre, para mostrar nombre en la tabla
    let puntosVentaCache = [];

    async function cargarPuntosVentaSelect() {
        try {
            const res = await fetch('/api/puntos-venta');
            if (!res.ok) throw new Error('Error al cargar puntos de venta');
            puntosVentaCache = await res.json();

            const opciones = puntosVentaCache
                .map(pv => `<option value="${pv.id}">${pv.nombre}</option>`)
                .join('');
            selectPuntoVenta.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
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

    async function cargarEmpleados() {
        try {
            const res = await fetch('/api/personal');
            if (!res.ok) throw new Error('Error al cargar empleados');
            const datos = await res.json();

            if (!datos || datos.length === 0) {
                tabla.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-500">No hay empleados registrados.</td></tr>`;
                return;
            }

            tabla.innerHTML = datos.map(e => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 font-medium text-gray-800">${e.nombre || ''}</td>
                    <td class="p-3 text-gray-600">${e.dni || '-'}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(e.punto_venta_id)}</td>
                    <td class="p-3 text-gray-600">${formatearFecha(e.fecha_in)}</td>
                    <td class="p-3 text-gray-600">${formatearFecha(e.fecha_out)}</td>
                    <td class="p-3">
                        <span class="px-2 py-1 rounded text-xs font-semibold ${e.estado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
                            ${e.estado ? 'Activo' : 'No Activo'}
                        </span>
                    </td>
                    <td class="p-3">
                        <button data-id="${e.id}" data-estado="${e.estado}" class="btnToggleEstado text-xs px-3 py-1.5 rounded transition ${e.estado ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-emerald-500 hover:bg-emerald-600 text-white'}">
                            ${e.estado ? 'Desactivar' : 'Activar'}
                        </button>
                    </td>
                </tr>
            `).join('');

            document.querySelectorAll('.btnToggleEstado').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.id;
                    const estadoActual = btn.dataset.estado === 'true';
                    try {
                        const res = await fetch(`/api/personal/${id}/estado`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ estado: !estadoActual })
                        });
                        if (!res.ok) throw new Error('Error al actualizar estado');
                        cargarEmpleados();
                    } catch (err) {
                        console.error(err);
                        alert('No se pudo actualizar el estado.');
                    }
                });
            });

        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">Error al cargar los empleados.</td></tr>`;
        }
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const datosEmpleado = {
                nombre: document.getElementById('nombre').value.trim(),
                dni: document.getElementById('dni').value.trim(),
                numero_seguridad_social: document.getElementById('numeroSegSocial').value.trim(),
                nacionalidad: document.getElementById('nacionalidad').value.trim(),
                fecha_nacimiento: document.getElementById('fechaNacimiento').value || null,
                iban: document.getElementById('iban').value.trim(),
                domicilio: document.getElementById('domicilio').value.trim(),
                fecha_in: document.getElementById('fechaIn').value || null,
                fecha_out: document.getElementById('fechaOut').value || null,
                horas_alta: parseFloat(document.getElementById('horasAlta').value) || null,
                punto_venta_id: document.getElementById('puntoVenta').value || null,
                direccion: document.getElementById('direccion').value.trim(),
                email: document.getElementById('email').value.trim(),
                foto_dni: document.getElementById('fotoDni').value.trim()
            };

            if (!datosEmpleado.nombre) return;

            try {
                const res = await fetch('/api/personal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datosEmpleado)
                });
                if (!res.ok) throw new Error('Error al crear empleado');

                form.reset();
                cargarEmpleados();
            } catch (err) {
                console.error(err);
                alert('No se pudo crear el empleado.');
            }
        });
    }

    await cargarPuntosVentaSelect();
    await cargarEmpleados();
});
