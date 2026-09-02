document.addEventListener('DOMContentLoaded', async () => {
    const tbody = document.getElementById('tablaCierres');

    try {
        const response = await fetch('/api/cierres');
        if (!response.ok) throw new Error('Error al obtener el histórico');

        const cierres = await response.json();

        if (cierres.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">No hay cierres registrados.</td></tr>`;
            return;
        }

        tbody.innerHTML = cierres.map(c => {
            const fecha = new Date(c.fecha || c.created_at).toLocaleString('es-ES', {
                dateStyle: 'short',
                timeStyle: 'short'
            });

            const efectivo = Number(c.total_efectivo || 0).toFixed(2);
            const tarjeta = Number(c.total_tarjeta || 0).toFixed(2);
            const total = (Number(c.total_efectivo || 0) + Number(c.total_tarjeta || 0)).toFixed(2);

            let detallesHtml = '<div class="space-y-1 text-xs">';
            
            if (c.gastos && c.gastos.length > 0) {
                detallesHtml += '<div class="font-semibold text-red-600">Gastos:</div>';
                c.gastos.forEach(g => {
                    detallesHtml += `<div>- ${g.descripcion}: ${Number(g.importe).toFixed(2)}€ (${g.punto_venta})</div>`;
                });
            }

            if (c.adelantos && c.adelantos.length > 0) {
                detallesHtml += '<div class="font-semibold text-blue-600 mt-1">Adelantos:</div>';
                c.adelantos.forEach(a => {
                    detallesHtml += `<div>- ${a.empleado}: ${Number(a.importe).toFixed(2)}€ (${a.punto_venta})</div>`;
                });
            }

            if ((!c.gastos || c.gastos.length === 0) && (!c.adelantos || c.adelantos.length === 0)) {
                detallesHtml += '<span class="text-gray-400">Sin incidencias</span>';
            }

            detallesHtml += '</div>';

            return `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-700">${fecha}</td>
                    <td class="p-3 font-medium text-gray-800">${c.punto_venta}</td>
                    <td class="p-3 text-gray-600">${efectivo} €</td>
                    <td class="p-3 text-gray-600">${tarjeta} €</td>
                    <td class="p-3 font-semibold text-gray-900">${total} €</td>
                    <td class="p-3">${detallesHtml}</td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar los datos del histórico.</td></tr>`;
    }
});