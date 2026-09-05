document.addEventListener('DOMContentLoaded', async () => {
    const btnAgregarGasto = document.getElementById('btnAgregarGasto');
    const btnAgregarAdelanto = document.getElementById('btnAgregarAdelanto');
    const gastosContainer = document.getElementById('gastosContainer');
    const adelantosContainer = document.getElementById('adelantosContainer');
    const cierreForm = document.getElementById('cierreForm');
    const totalEfectivoInput = document.getElementById('totalEfectivo');
    const totalTarjetaInput = document.getElementById('totalTarjeta');

    const iconoPapelera = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
        </svg>`;

    // --- Carga de empleados desde el backend (solo se usa en Adelantos) ---
    let empleadosCache = [];

    async function cargarEmpleados() {
        try {
            const res = await fetch('/api/empleados');
            if (!res.ok) throw new Error('No se pudo cargar la lista de empleados');
            const data = await res.json();
            empleadosCache = (Array.isArray(data) ? data : [])
                .map(e => e.nombre || e.nombre_completo || e.name || e.empleado || null)
                .filter(Boolean);
        } catch (err) {
            console.error('Error cargando empleados:', err);
            empleadosCache = [];
        }
    }

    function empleadoOptionsHtml() {
        const opciones = empleadosCache
            .map(nombre => `<option value="${nombre}">${nombre}</option>`)
            .join('');
        return `<option value="">-- Selecciona empleado --</option>${opciones}`;
    }

    await cargarEmpleados();

    // --- Cálculos automáticos: Venta Total y Cash a Ingresar ---
    function formatearImporte(n) {
        return Number(n || 0).toFixed(2) + ' €';
    }

    function actualizarCalculos() {
        const efectivo = parseFloat(totalEfectivoInput.value) || 0;
        const tarjeta = parseFloat(totalTarjetaInput.value) || 0;
        const ventaTotal = efectivo + tarjeta;

        let sumaGastos = 0;
        document.querySelectorAll('.gasto-importe').forEach(input => {
            sumaGastos += parseFloat(input.value) || 0;
        });

        let sumaAdelantos = 0;
        document.querySelectorAll('.adelanto-importe').forEach(input => {
            sumaAdelantos += parseFloat(input.value) || 0;
        });

        const cashAIngresar = efectivo - sumaGastos - sumaAdelantos;

        document.getElementById('ventaTotal').textContent = formatearImporte(ventaTotal);
        document.getElementById('cashAIngresar').textContent = formatearImporte(cashAIngresar);
    }

    totalEfectivoInput.addEventListener('input', actualizarCalculos);
    totalTarjetaInput.addEventListener('input', actualizarCalculos);
    gastosContainer.addEventListener('input', actualizarCalculos);
    adelantosContainer.addEventListener('input', actualizarCalculos);

    // --- Filas dinámicas ---

    function agregarGastoFila() {
        const div = document.createElement('div');
        div.className = 'grid grid-cols-3 md:flex md:items-center gap-2 mb-2';
        div.innerHTML = `
            <input type="text" placeholder="Concepto / Descripción" class="gasto-desc col-span-3 md:flex-1 min-w-0 border p-2 rounded w-full text-sm" required>
            <input type="number" step="0.01" placeholder="Importe (€)" class="gasto-importe min-w-0 border p-2 rounded w-full md:w-28 text-sm" required>
            <select class="gasto-pv min-w-0 border p-2 rounded w-full md:w-32 text-sm">
                <option value="Alicante">Alicante</option>
                <option value="Madrid">Madrid</option>
            </select>
            <input type="file" accept="image/*,.pdf" class="gasto-foto col-span-3 md:w-40 min-w-0 border p-1.5 rounded w-full text-xs" title="Foto del ticket (opcional)">
            <button type="button" class="btnEliminarFila text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition min-w-0 w-full md:w-auto flex items-center justify-center py-2 md:px-3 md:py-2" title="Eliminar">${iconoPapelera}</button>
        `;
        div.querySelector('.btnEliminarFila').addEventListener('click', () => {
            div.remove();
            actualizarCalculos();
        });
        gastosContainer.appendChild(div);
    }

    function agregarAdelantoFila() {
        const div = document.createElement('div');
        div.className = 'grid grid-cols-3 md:flex md:items-center gap-2 mb-2';
        div.innerHTML = `
            <select class="adelanto-emp col-span-3 md:flex-1 min-w-0 border p-2 rounded w-full text-sm" required>
                ${empleadoOptionsHtml()}
            </select>
            <input type="number" step="0.01" placeholder="Importe (€)" class="adelanto-importe min-w-0 border p-2 rounded w-full md:w-28 text-sm" required>
            <select class="adelanto-pv min-w-0 border p-2 rounded w-full md:w-32 text-sm">
                <option value="Alicante">Alicante</option>
                <option value="Madrid">Madrid</option>
            </select>
            <button type="button" class="btnEliminarFila text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition min-w-0 w-full md:w-auto flex items-center justify-center py-2 md:px-3 md:py-2" title="Eliminar">${iconoPapelera}</button>
        `;
        div.querySelector('.btnEliminarFila').addEventListener('click', () => {
            div.remove();
            actualizarCalculos();
        });
        adelantosContainer.appendChild(div);
    }

    if (btnAgregarGasto) btnAgregarGasto.addEventListener('click', () => { agregarGastoFila(); actualizarCalculos(); });
    if (btnAgregarAdelanto) btnAgregarAdelanto.addEventListener('click', () => { agregarAdelantoFila(); actualizarCalculos(); });

    if (gastosContainer && gastosContainer.children.length === 0) agregarGastoFila();
    if (adelantosContainer && adelantosContainer.children.length === 0) agregarAdelantoFila();

    actualizarCalculos();

    if (cierreForm) {
        cierreForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const puntoVenta = document.getElementById('puntoVenta').value;
            const totalEfectivo = parseFloat(totalEfectivoInput.value) || 0;
            const totalTarjeta = parseFloat(totalTarjetaInput.value) || 0;
            const observaciones = document.getElementById('observaciones').value;

            const gastos = [];
            const fotosGastos = [];
            document.querySelectorAll('#gastosContainer > div').forEach(row => {
                const descripcion = row.querySelector('.gasto-desc').value;
                const importe = parseFloat(row.querySelector('.gasto-importe').value) || 0;
                const pv = row.querySelector('.gasto-pv').value;
                if (descripcion && importe > 0) {
                    gastos.push({ descripcion, importe, punto_venta: pv });
                    const inputFoto = row.querySelector('.gasto-foto');
                    fotosGastos.push(inputFoto && inputFoto.files[0] ? inputFoto.files[0] : null);
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

            const formData = new FormData();
            formData.append('datos', JSON.stringify(datosCierre));
            fotosGastos.forEach((archivo, indice) => {
                if (archivo) formData.append(`fotoGasto_${indice}`, archivo);
            });

            try {
                const response = await fetch('/api/cierres', {
                    method: 'POST',
                    body: formData
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
