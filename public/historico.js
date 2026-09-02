async function cargarCierres() {
  const tbody = document.getElementById('tablaCierres');
  try {
    const res = await fetch('/api/cierres');
    const data = await res.json();

    if (!data.success) {
      tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar datos: ' + (data.error || 'Error desconocido') + '</td></tr>';
      return;
    }

    if (!data.data || data.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-500">No hay cierres registrados todavia.</td></tr>';
      return;
    }

    tbody.innerHTML = data.data.map(item => {
      const total = (parseFloat(item.total_efectivo || 0) + parseFloat(item.total_tarjeta || 0)).toFixed(2);
      
      const adelantosText = (item.adelantos_empleados || []).map(a => a.empleado_nombre + ': ' + a.monto + ' EUR').join(', ');
      const gastosText = (item.gastos_caja || []).map(g => g.concepto + ': ' + g.monto + ' EUR').join(', ');
      
      let detalles = [];
      if (adelantosText) detalles.push('<b>Adelantos:</b> ' + adelantosText);
      if (gastosText) detalles.push('<b>Gastos:</b> ' + gastosText);
      if (item.observaciones) detalles.push('<b>Obs:</b> ' + item.observaciones);

      return `
        <tr class="hover:bg-gray-50">
          <td class="p-3 font-medium text-gray-900">${item.fecha || '-'}</td>
          <td class="p-3 text-gray-600">${item.punto_venta || '-'}</td>
          <td class="p-3 text-gray-600">${parseFloat(item.total_efectivo || 0).toFixed(2)} EUR</td>
          <td class="p-3 text-gray-600">${parseFloat(item.total_tarjeta || 0).toFixed(2)} EUR</td>
          <td class="p-3 font-semibold text-emerald-600">${total} EUR</td>
          <td class="p-3 text-xs text-gray-500">${detalles.join(' | ') || '-'}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-red-500">Error de conexion con el servidor.</td></tr>';
  }
}

document.addEventListener('DOMContentLoaded', cargarCierres);