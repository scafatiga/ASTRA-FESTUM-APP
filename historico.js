document.addEventListener('DOMContentLoaded', async () => {
    const tbody = document.getElementById('tablaCierres');

    try {
        const response = await fetch('/api/cierres');
        if (!response.ok) throw new Error('Error al obtener el histórico');

        const cierres = await response.json();

        if (!cierres || cierres.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">No hay cierres registrados.</td></tr>`;
            return;
        }

        tbody.innerHTML = cierres.map(c => {
            // Manejar diferentes nombres posibles para la fecha
            const rawFecha = c.fecha || c.created_at || c.createdAt || c.timestamp;
            let fechaFormateada = 'Fecha no disponible';
            if (rawFecha) {
                const dateObj = new Date(rawFecha);
                if (!isNaN(dateObj.getTime())) {
                    fechaFormateada = dateObj.toLocaleString('es-ES', {
                        dateStyle: 'short',
                        timeStyle: 'short'
                    });
                }
            }

            // Manejar variantes para el punto de venta
            const puntoVenta = c.punto_venta || c.puntoVenta || 'No especificado';

            const efectivo = Number(c.total_efectivo ?? c.efectivo ?? 0).toFixed(2);
            const tarjeta = Number(c.total_tarjeta ?? c.tarjeta ?? 0).toFixed(2);
            const total = (Number(efectivo) + Number(tarjeta)).toFixed(2);

            let detallesHtml = '<div class="space-y-1 text-xs">';
            
            const gastos = c.gastos || [];
            if (gastos.length > 0) {
                detallesHtml += '<div class="font-semibold text-red-600">Gastos:</div>';
                gastos.forEach(g => {
                    detallesHtml += `<div>- ${g.descripcion || g.concepto}: ${Number(g.importe || g.monto || 0).toFixed(2)}€ (${g.punto_venta || g.puntoVenta || ''})</div>`;
                });
            }

            const adelantos = c.adelantos || [];
            if (adelantos.length > 0) {
                detallesHtml += '<div class="font-semibold text-blue-600 mt-1">Adelantos:</div>';
                adelantos.forEach(a => {
                    detallesHtml += `<div>- ${a.empleado || a.nombre}: ${Number(a.importe || a.monto || 0).toFixed(2)}€ (${a.punto_venta || a.puntoVenta || ''})</div>`;
                });
            }

            if (gastos.length === 0 && adelantos.length === 0) {
                detallesHtml += '<span class="text-gray-400">Sin incidencias</span>';
            }

            detallesHtml += '</div>';

            return `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 text-gray-700">${fechaFormateada}</td>
                    <td class="p-3 font-medium text-gray-800">${puntoVenta}</td>
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