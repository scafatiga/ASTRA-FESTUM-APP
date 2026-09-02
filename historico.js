document.addEventListener('DOMContentLoaded', async () => {
    const tbody = document.getElementById('tablaCierres');

    try {
        const response = await fetch('/api/cierres');
        if (!response.ok) throw new Error('Error al obtener el histórico');

        const cierres = await response.json();

        if (!cierres || cierres.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-gray-500">No hay cierres registrados.</td></tr>`;
            return;
        }

        tbody.innerHTML = cierres.map(c => {
            // Fecha
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

            // Punto de Venta (buscando todas las variantes posibles)
            const puntoVenta = c.punto_venta || c.puntoVenta || c.puntoventa || c.pv || 'No especificado';

            // Totales
            const efectivo = Number(c.total_efectivo ?? c.efectivo ?? c.totalEfectivo ?? 0);
            const tarjeta = Number(c.total_tarjeta ?? c.tarjeta ?? c.totalTarjeta ?? 0);
            const totalBruto = efectivo + tarjeta;

            // Gastos (buscando array en cualquier propiedad posible)
            const gastos = c.gastos || c.gastosList || c.listaGastos || [];
            const totalGastos = gastos.reduce((sum, g) => sum + Number(g.importe || g.monto || g.valor || 0), 0);

            // Adelantos (buscando array en cualquier propiedad posible)
            const adelantos = c.adelantos || c.adelantosList || c.listaAdelantos || [];
            const totalAdelantos = adelantos.reduce((sum, a) => sum + Number(a.importe || a.monto || a.valor || 0), 0);

            // Cash Neto
            const cashNeto = efectivo - totalGastos - totalAdelantos;

            // Construir detalles visuales
            let detallesHtml = '<div class="space-y-1 text-xs">';
            if (gastos.length > 0) {
                detallesHtml += '<div class="font-semibold text-red-600">Gastos:</div>';
                gastos.forEach(g => {
                    const desc = g.descripcion || g.concepto || g.desc || 'Gasto';
                    const imp = Number(g.importe || g.monto || g.valor || 0).toFixed(2);
                    const pvGasto = g.punto_venta || g.puntoVenta || '';
                    detallesHtml += `<div>- ${desc}: ${imp}€ ${pvGasto ? '('+pvGasto+')' : ''}</div>`;
                });
            }

            if (adelantos.length > 0) {
                detallesHtml += '<div class="font-semibold text-blue-600 mt-1">Adelantos:</div>';
                adelantos.forEach(a => {
                    const emp = a.empleado || a.nombre || 'Empleado';
                    const imp = Number(a.importe || a.monto || a.valor || 0).toFixed(2);
                    const pvAd = a.punto_venta || a.puntoVenta || '';
                    detallesHtml += `<div>- ${emp}: ${imp}€ ${pvAd ? '('+pvAd+')' : ''}</div>`;
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
                    <td class="p-3 text-gray-600">${efectivo.toFixed(2)} €</td>
                    <td class="p-3 text-gray-600">${tarjeta.toFixed(2)} €</td>
                    <td class="p-3 text-red-600 font-medium">${totalGastos > 0 ? '-' + totalGastos.toFixed(2) + ' €' : '0.00 €'}</td>
                    <td class="p-3 text-blue-600 font-medium">${totalAdelantos > 0 ? '-' + totalAdelantos.toFixed(2) + ' €' : '0.00 €'}</td>
                    <td class="p-3 font-bold ${cashNeto < 0 ? 'text-red-700' : 'text-emerald-700'}">${cashNeto.toFixed(2)} €</td>
                    <td class="p-3 font-semibold text-gray-900">${totalBruto.toFixed(2)} €</td>
                    <td class="p-3">${detallesHtml}</td>
                </tr>
            `;
        }).join('');

    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-red-500">Error al cargar los datos del histórico.</td></tr>`;
    }
});