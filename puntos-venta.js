document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formPuntoVenta');
    const tabla = document.getElementById('tablaPuntosVenta');

    function formatearFechaHora(f) {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }

    async function cargarPuntosVenta() {
        try {
            const res = await fetch('/api/puntos-venta/todos');
            if (!res.ok) throw new Error('Error al cargar puntos de venta');
            const datos = await res.json();

            if (!datos || datos.length === 0) {
                tabla.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">No hay puntos de venta registrados.</td></tr>`;
                return;
            }

            tabla.innerHTML = datos.map(pv => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 font-medium text-gray-800">${pv.nombre || ''}</td>
                    <td class="p-3 text-gray-600">${pv.direccion || '-'}</td>
                    <td class="p-3 text-gray-600">${pv.tipo_stand || '-'}</td>
                    <td class="p-3">
                        <span class="px-2 py-1 rounded text-xs font-semibold ${pv.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
                            ${pv.activo ? 'Activo' : 'Inactivo'}
                        </span>
                    </td>
                    <td class="p-3 text-gray-500 text-xs">
                        ${pv.registrado_por_nombre || '-'}<br>${formatearFechaHora(pv.creado_en)}
                    </td>
                    <td class="p-3">
                        <button data-id="${pv.id}" data-activo="${pv.activo}" class="btnToggleEstado text-xs px-3 py-1.5 rounded transition ${pv.activo ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-emerald-500 hover:bg-emerald-600 text-white'}">
                            ${pv.activo ? 'Desactivar' : 'Activar'}
                        </button>
                    </td>
                </tr>
            `).join('');

            document.querySelectorAll('.btnToggleEstado').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.id;
                    const activoActual = btn.dataset.activo === 'true';
                    try {
                        const res = await fetch(`/api/puntos-venta/${id}/estado`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ activo: !activoActual })
                        });
                        if (!res.ok) throw new Error('Error al actualizar estado');
                        cargarPuntosVenta();
                    } catch (err) {
                        console.error(err);
                        alert('No se pudo actualizar el estado.');
                    }
                });
            });

        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar los puntos de venta.</td></tr>`;
        }
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const nombre = document.getElementById('nombre').value.trim();
            const direccion = document.getElementById('direccion').value.trim();
            const tipoStand = document.getElementById('tipoStand').value.trim();

            if (!nombre) return;

            try {
                const res = await fetch('/api/puntos-venta', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre, direccion, tipo_stand: tipoStand })
                });
                if (!res.ok) throw new Error('Error al crear punto de venta');

                form.reset();
                cargarPuntosVenta();
            } catch (err) {
                console.error(err);
                alert('No se pudo crear el punto de venta.');
            }
        });
    }

    cargarPuntosVenta();
});
