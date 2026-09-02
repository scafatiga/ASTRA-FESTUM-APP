document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("tablaCierres");

  try {
    const response = await fetch("/api/cierres");
    if (!response.ok) throw new Error("Error en la respuesta del servidor");

    const data = await response.json();
    const cierres = Array.isArray(data) ? data : (data.data || []);

    if (cierres.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">No hay cierres registrados.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";

    cierres.forEach(c => {
      const row = document.createElement("tr");
      row.className = "hover:bg-gray-50";

      // Formatear la fecha
      let fechaFormateada = c.fecha || '-';
      if (fechaFormateada.includes('T')) {
        const partes = fechaFormateada.split('T')[0].split('-');
        if (partes.length === 3) {
          fechaFormateada = `${partes[2]}/${partes[1]}/${partes[0]}`;
        }
      }

      const efectivo = parseFloat(c.total_efectivo ?? c.efectivo ?? 0);
      const tarjeta = parseFloat(c.total_tarjeta ?? c.tarjeta ?? 0);
      const totalCalculado = (efectivo + tarjeta).toFixed(2);

      // Limpiar o mostrar el punto de venta
      let puntoVenta = c.punto_venta || c.pdv_id || '-';
      // Si el punto de venta es un UUID largo, puedes mapearlo o mostrar una etiqueta limpia
      if (puntoVenta.length > 20) {
        puntoVenta = "Punto de Venta Principal"; // O el nombre que corresponda
      }

      row.innerHTML = `
        <td class="p-3 font-medium text-gray-900">${fechaFormateada}</td>
        <td class="p-3 text-gray-700 font-semibold">${puntoVenta}</td>
        <td class="p-3 text-gray-700">${efectivo.toFixed(2)} €</td>
        <td class="p-3 text-gray-700">${tarjeta.toFixed(2)} €</td>
        <td class="p-3 font-semibold text-gray-900">${totalCalculado} €</td>
        <td class="p-3 text-gray-600 text-xs">
          <div><strong>Obs:</strong> ${c.observaciones || 'Sin incidencias'}</div>
        </td>
      `;
      tbody.appendChild(row);
    });

  } catch (err) {
    console.error("Error cargando histórico:", err);
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar datos del servidor</td></tr>`;
  }
});