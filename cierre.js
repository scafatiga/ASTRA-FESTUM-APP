document.addEventListener('DOMContentLoaded', () => {
    const btnAgregarGasto = document.getElementById('btnAgregarGasto');
    const btnAgregarAdelanto = document.getElementById('btnAgregarAdelanto');
    const gastosContainer = document.getElementById('gastosContainer');
    const adelantosContainer = document.getElementById('adelantosContainer');
    const cierreForm = document.getElementById('cierreForm');

    function agregarGastoFila() {
        const div = document.createElement('div');
        // Grid: en móvil, concepto ocupa toda la fila (3 columnas) y
        // importe/punto de venta/borrar se reparten en 3 columnas iguales debajo.
        // En pantallas sm+ vuelve a ser una fila horizontal normal.
        div.className = 'grid grid-cols-3 sm:flex sm:items-center gap-2 mb-2';
        div.innerHTML = `
            <input type="text" placeholder="Concepto / Descripción" class="gasto-desc col-span-3 sm:flex-1 min-w-0 border p-2 rounded w-full text-sm" required>
            <input type="number" step="0.01" placeholder="Importe (€)" class="gasto-importe min-w-0 border p-2 rounded w-full sm:w-28 text-sm" required>
            <select class="gasto-pv min-w-0 border p-2 rounded w-full sm:w-32 text-sm">
                <option value="Alicante">Alicante</option>
                <option value="Madrid">Madrid</option>
            </select>
            <button type="button" class="bg-red-500 hover:bg-red-600 text-white rounded text-sm transition min-w-0 w-full sm:w-auto py-2 sm:px-3 sm:py-2" onclick="this.parentElement.remove()">✕</button>
        `;
        gastosContainer.appendChild(div);
    }

    function agregarAdelantoFila() {
        const div = document.createElement('div');
        div.className = 'grid grid-cols-3 sm:flex sm:items-center gap-2 mb-2';
        div.innerHTML = `
            <input type="text" placeholder="Nombre Empleado" class="adelanto-emp col-span-3 sm:flex-1 min-w-0 border p-2 rounded w-full text-sm" required>
            <input type="number" step="0.01" placeholder="Importe (€)" class="adelanto-importe min-w-0 border p-2 rounded w-full sm:w-28 text-sm" required>
            <select class="adelanto-pv min-w-0 border p-2 rounded w-full sm:w-32 text-sm">
                <option value="Alicante">Alicante</option>
                <option value="Madrid">Madrid</option>
            </select>
            <button type="button" class="bg-red-500 hover:bg-red-600 text-white rounded text-sm transition min-w-0 w-full sm:w-auto py-2 sm:px-3 sm:py-2" onclick="this.parentElement.remove()">✕</button>
        `;
        adelantosContainer.appendChild(div);
    }

    if (btnAgregarGasto) btnAgregarGasto.addEventListener('click', agregarGastoFila);
    if (btnAgregarAdelanto) btnAgregarAdelanto.addEventListener('click', agregarAdelantoFila);

    // Fuerza la creación de una línea inicial con su desplegable al cargar
    if (gastosContainer && gastosContainer.children.length === 0) agregarGastoFila();
    if (adelantosContainer && adelantosContainer.children.length === 0) agregarAdelantoFila();

    if (cierreForm) {
        cierreForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const puntoVenta = document.getElementById('puntoVenta').value;
            const totalEfectivo = parseFloat(document.getElementById('totalEfectivo').value) || 0;
            const totalTarjeta = parseFloat(document.getElementById('totalTarjeta').value) || 0;
            const observaciones = document.getElementById('observaciones').value;

            const gastos = [];
            document.querySelectorAll('#gastosContainer > div').forEach(row => {
                const descripcion = row.querySelector('.gasto-desc').value;
                const importe = parseFloat(row.querySelector('.gasto-importe').value) || 0;
                const pv = row.querySelector('.gasto-pv').value;
                if (descripcion && importe > 0) {
                    gastos.push({ descripcion, importe, punto_venta: pv });
                }
            });

            const adelantos = [];
            document.querySelectorAll('#adelantosContainer > div').forEach(row => {
                const empleado = row.querySelector('.adelanto-emp').value;
                const importe = parseFloat(row.querySelector('.adelanto-importe').value) || 0;
                const pv = row.querySelector('.adelanto-pv').value;
                if (empleado && importe > 0) {
                    adelantos.push({ empleado, importe, punto_venta: pv });
                }
            });

            const datosCierre = {
                punto_venta: puntoVenta,
                total_efectivo: totalEfectivo,
                total_tarjeta: totalTarjeta,
                gastos,
                adelantos,
                observaciones
            };

            try {
                const response = await fetch('/api/cierres', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datosCierre)
                });

                if (!response.ok) throw new Error('Error al registrar el cierre');

                alert('¡Cierre registrado correctamente!');
                window.location.href = '/historico.html';
            } catch (error) {
                console.error(error);
                alert('Hubo un error al guardar el cierre.');
            }
        });
    }
});