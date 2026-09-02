document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formProveedor');
    const tabla = document.getElementById('tablaProveedores');

    async function cargarProveedores() {
        try {
            const res = await fetch('/api/proveedores/todos');
            if (!res.ok) throw new Error('Error al cargar proveedores');
            const datos = await res.json();

            if (!datos || datos.length === 0) {
                tabla.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-gray-500">No hay proveedores registrados.</td></tr>`;
                return;
            }

            tabla.innerHTML = datos.map(p => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 font-medium text-gray-800">${p.nombre_proveedor || ''}</td>
                    <td class="p-3 text-gray-600">${p.nombre_comercial || '-'}</td>
                    <td class="p-3 text-gray-600">${p.cif || '-'}</td>
                    <td class="p-3 text-gray-600">${p.ciudad || '-'}</td>
                    <td class="p-3 text-gray-600">${p.telefono || '-'}</td>
                    <td class="p-3 text-gray-600">${p.email || '-'}</td>
                    <td class="p-3">
                        <span class="px-2 py-1 rounded text-xs font-semibold ${p.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
                            ${p.activo ? 'Activo' : 'Inactivo'}
                        </span>
                    </td>
                    <td class="p-3">
                        <button data-id="${p.id}" data-activo="${p.activo}" class="btnToggleEstado text-xs px-3 py-1.5 rounded transition ${p.activo ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-emerald-500 hover:bg-emerald-600 text-white'}">
                            ${p.activo ? 'Desactivar' : 'Activar'}
                        </button>
                    </td>
                </tr>
            `).join('');

            document.querySelectorAll('.btnToggleEstado').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.id;
                    const activoActual = btn.dataset.activo === 'true';
                    try {
                        const res = await fetch(`/api/proveedores/${id}/estado`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ activo: !activoActual })
                        });
                        if (!res.ok) throw new Error('Error al actualizar estado');
                        cargarProveedores();
                    } catch (err) {
                        console.error(err);
                        alert('No se pudo actualizar el estado.');
                    }
                });
            });

        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-red-500">Error al cargar los proveedores.</td></tr>`;
        }
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const nombre_proveedor = document.getElementById('nombreProveedor').value.trim();
            const nombre_comercial = document.getElementById('nombreComercial').value.trim();
            const cif = document.getElementById('cif').value.trim();
            const iban = document.getElementById('iban').value.trim();
            const forma_pago = document.getElementById('formaPago').value.trim();
            const ciudad = document.getElementById('ciudad').value.trim();
            const direccion_fiscal = document.getElementById('direccionFiscal').value.trim();
            const telefono = document.getElementById('telefono').value.trim();
            const email = document.getElementById('email').value.trim();

            if (!nombre_proveedor) return;

            try {
                const res = await fetch('/api/proveedores', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nombre_proveedor, nombre_comercial, cif, iban,
                        forma_pago, ciudad, direccion_fiscal, telefono, email
                    })
                });
                if (!res.ok) throw new Error('Error al crear proveedor');

                form.reset();
                cargarProveedores();
            } catch (err) {
                console.error(err);
                alert('No se pudo crear el proveedor.');
            }
        });
    }

    cargarProveedores();
});
