document.addEventListener('DOMContentLoaded', () => {
    const btnAgregarGasto = document.getElementById('btnAgregarGasto');
    const btnAgregarAdelanto = document.getElementById('btnAgregarAdelanto');
    const gastosContainer = document.getElementById('gastosContainer');
    const adelantosContainer = document.getElementById('adelantosContainer');
    const cierreForm = document.getElementById('cierreForm');

    function agregarGastoFila() {
        const div = document.createElement('div');
        div.className = 'flex items-center gap-2 mb-2';
        div.innerHTML = `
            <input type="text" placeholder="Concepto / Descripción" class="gasto-desc border p-2 rounded flex-grow text-sm" required>
            <input type="number" step="0.01" placeholder="Importe (€)" class="gasto-importe border p-2 rounded w-28 text-sm" required>
            <select class="gasto-pv border p-2 rounded w-32 text-sm">
                <option value="Alicante">Alicante</option>
                <option value="Madrid">Madrid</option>
            </select>
            <button type="button" class="bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded text-sm transition" onclick="this.parentElement.remove()">✕</button>
        `;
        gastosContainer.appendChild(div);
    }

    function agregarAdelantoFila() {
        const div = document.createElement('div');
        div.className = 'flex items-center gap-2 mb-2';
        div.innerHTML = `
            <input type="text" placeholder="Nombre Empleado" class="adelanto-emp border p-2 rounded flex-grow text-sm" required>
            <input type="number" step="0.01" placeholder="Importe (€)" class="adelanto-importe border p-2 rounded w-28 text-sm" required>
            <select class="adelanto-pv border p-2 rounded w-32 text-sm">
                <option value="Alicante">Alicante</option>
                <option value="Madrid">Madrid</option>
            </select>
            <button type="button" class="bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded text-sm transition" onclick="this.parentElement.remove()">✕</button>
        `;
        adelantosContainer.appendChild(div);
    }

    if (btnAgregarGasto) btnAgregarGasto.addEventListener('click', agregarGastoFila);
    if (btnAgregarAdelanto) btnAgregarAdelanto.addEventListener('click', agregarAdelantoFila);

    // Añadir una fila inicial por defecto para que los desplegables se vean al abrir la página
    agregarGastoFila();
    agregarAdelantoFila();

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