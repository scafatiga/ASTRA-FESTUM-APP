document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("tablaCierres");

  try {
    const response = await fetch("/api/cierres");
    if (!response.ok) throw new Error("Error en la respuesta del servidor");

    const data = await response.json();
    
    // Si la API devuelve un objeto con propiedad data o un array directo
    const cierres = Array.isArray(data) ? data : (data.data || []);

    if (cierres.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-gray-500">No hay cierres registrados.</td></tr>`;
      return;
    }

    tbody.innerHTML = ""; // Limpiar carga

    cierres.forEach(c => {
      const row = document.createElement("tr");
      row.className = "hover:bg-gray-50";
      
      row.innerHTML = `
        <td class="p-3 font-medium text-gray-900">${c.fecha || '-'}</td>
        <td class="p-3 text-gray-700">${c.punto_venta || c.pdv_id || '-'}</td>
        <td class="p-3 text-gray-700">${c.total_efectivo ?? 0} €</td>
        <td class="p-3 text-gray-700">${c.total_tarjeta ?? 0} €</td>
        <td class="p-3 font-semibold text-gray-900">${c.total ?? 0} €</td>
        <td class="p-3 text-gray-500 text-xs">${c.observaciones || 'Sin incidencias'}</td>
      `;
      tbody.appendChild(row);
    });

  } catch (err) {
    console.error("Error cargando histórico:", err);
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error al cargar datos del servidor</td></tr>`;
  }
});