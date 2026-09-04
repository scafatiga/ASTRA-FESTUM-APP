document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formProducto');
    const tabla = document.getElementById('tablaProductos');
    const TIPOS_STAND = ['CHOCOBERRIES', 'CARIBBEAN', 'MACONDO', 'KOKO BLENDS'];

    let productosCache = [];

    function claseBoton(activo) {
        const base = 'w-full h-12 flex items-center justify-center text-center px-2 rounded-lg text-xs transition border';
        return activo
            ? `${base} bg-blue-600 border-blue-600 text-white font-semibold`
            : `${base} bg-gray-100 border-gray-300 text-gray-600 font-medium hover:bg-gray-200`;
    }

    function pintarBotones(contenedorId, inputOcultoId, valorInicial) {
        const contenedor = document.getElementById(contenedorId);
        contenedor.innerHTML = TIPOS_STAND.map(op =>
            `<button type="button" class="opcion-btn ${claseBoton(op === valorInicial)}" data-valor="${op}">${op}</button>`
        ).join('');
        document.getElementById(inputOcultoId).value = valorInicial || '';

        contenedor.querySelectorAll('.opcion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                contenedor.querySelectorAll('.opcion-btn').forEach(b => b.className = `opcion-btn ${claseBoton(false)}`);
                btn.className = `opcion-btn ${claseBoton(true)}`;
                document.getElementById(inputOcultoId).value = btn.dataset.valor;
            });
        });
    }

    pintarBotones('tipoStandBotones', 'tipoStand', '');

    function formatearFechaHora(f) {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }

    function formatearImporte(n) {
        return Number(n || 0).toFixed(2) + ' €';
    }

    // --- Colapsar / expandir ---
    const btnToggleLista = document.getElementById('btnToggleLista');
    const listaWrapper = document.getElementById('listaProductosWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Buscador ---
    document.getElementById('buscadorProductos').addEventListener('input', (e) => {
        renderizarTabla(filtrarProductos(e.target.value));
    });

    function filtrarProductos(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return productosCache;
        return productosCache.filter(p =>
            (p.nombre || '').toLowerCase().includes(q) || (p.tipo_stand || '').toLowerCase().includes(q)
        );
    }

    // --- Cargar lista ---
    async function cargarProductos() {
        try {
            const res = await fetch('/api/productos');
            if (!res.ok) throw new Error('Error al cargar productos');
            productosCache = await res.json();
            document.getElementById('contadorProductos').textContent = productosCache.length;

            const texto = document.getElementById('buscadorProductos').value;
            renderizarTabla(filtrarProductos(texto));
        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-500">Error al cargar los productos.</td></tr>`;
        }
    }

    function renderizarTabla(datos) {
        if (!datos || datos.length === 0) {
            tabla.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-500">No hay productos que coincidan.</td></tr>`;
            return;
        }

        tabla.innerHTML = datos.map(p => `
            <tr class="hover:bg-gray-50 border-b">
                <td class="p-3 font-medium text-gray-800">${p.nombre || ''}</td>
                <td class="p-3 text-gray-600">${p.tipo_stand || '-'}</td>
                <td class="p-3 text-gray-600">${formatearImporte(p.precio_unitario)}</td>
                <td class="p-3">
                    <button class="btnToggleEstado px-2 py-1 rounded text-xs font-semibold transition ${p.activo ? 'bg-emerald-500 hover:bg-emerald-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white'}" data-id="${p.id}" data-activo="${p.activo}">
                        ${p.activo ? 'Activo' : 'Inactivo'}
                    </button>
                </td>
                <td class="p-3">
                    <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${p.id}">
                        <option value="">Acción...</option>
                        <option value="detalle">Detalle</option>
                        <option value="editar">Editar</option>
                        <option value="eliminar">Eliminar</option>
                    </select>
                </td>
            </tr>
        `).join('');

        document.querySelectorAll('.btnToggleEstado').forEach(btn => {
            btn.addEventListener('click', () => cambiarEstado(btn.dataset.id, btn.dataset.activo === 'true'));
        });

        document.querySelectorAll('.accionSelect').forEach(sel => {
            sel.addEventListener('change', async () => {
                const id = sel.dataset.id;
                const accion = sel.value;
                sel.value = '';

                if (accion === 'detalle') {
                    await abrirDetalle(id);
                } else if (accion === 'editar') {
                    abrirEditar(id);
                } else if (accion === 'eliminar') {
                    await eliminarProducto(id);
                }
            });
        });
    }

    async function cambiarEstado(id, activoActual) {
        try {
            const res = await fetch(`/api/productos/${id}/estado`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activo: !activoActual })
            });
            if (!res.ok) throw new Error('Error al actualizar estado');
            cargarProductos();
        } catch (err) {
            console.error(err);
            alert('No se pudo actualizar el estado.');
        }
    }

    // --- Detalle (con stock por Punto de Venta) ---
    async function abrirDetalle(id) {
        const p = productosCache.find(x => String(x.id) === String(id));
        if (!p) return;

        try {
            const res = await fetch(`/api/productos/${id}/stock`);
            const stock = res.ok ? await res.json() : [];

            const filasBase = [
                ['Producto', p.nombre],
                ['Tipo_Stand', p.tipo_stand],
                ['Precio Unitario', formatearImporte(p.precio_unitario)],
                ['Estado', p.activo ? 'Activo' : 'Inactivo'],
                ['Registrado por', p.registrado_por_nombre
                    ? `${p.registrado_por_nombre} — ${formatearFechaHora(p.created_at)}`
                    : '-']
            ];

            let html = filasBase.map(([label, valor]) => `
                <div class="flex justify-between border-b py-1.5 gap-4">
                    <span class="text-gray-500">${label}</span>
                    <span class="text-gray-800 font-medium text-right">${valor || '-'}</span>
                </div>
            `).join('');

            html += '<div class="pt-3 font-semibold text-gray-700 text-sm">Stock por Punto de Venta:</div>';
            if (stock.length === 0) {
                html += '<div class="text-gray-400 text-sm pt-1">Sin stock registrado todavía.</div>';
            } else {
                html += stock.map(s => `
                    <div class="flex justify-between border-b py-1.5 gap-4 text-sm">
                        <span class="text-gray-500">${s.punto_venta_nombre}</span>
                        <span class="font-medium ${Number(s.cantidad) < 0 ? 'text-red-600' : 'text-gray-800'}">${s.cantidad}</span>
                    </div>
                `).join('');
            }

            document.getElementById('contenidoDetalle').innerHTML = html;
            document.getElementById('modalDetalle').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el stock.');
        }
    }
    document.getElementById('btnCerrarDetalle').addEventListener('click', () => {
        document.getElementById('modalDetalle').classList.add('hidden');
    });

    // --- Editar ---
    const formEditar = document.getElementById('formEditarProducto');

    function abrirEditar(id) {
        const p = productosCache.find(x => String(x.id) === String(id));
        if (!p) return;

        document.getElementById('editId').value = p.id;
        document.getElementById('editNombre').value = p.nombre || '';
        document.getElementById('editPrecioUnitario').value = p.precio_unitario || '';
        pintarBotones('editTipoStandBotones', 'editTipoStand', p.tipo_stand);

        document.getElementById('modalEditar').classList.remove('hidden');
    }
    document.getElementById('btnCerrarEditar').addEventListener('click', () => {
        document.getElementById('modalEditar').classList.add('hidden');
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();

        const tipoStand = document.getElementById('editTipoStand').value;
        if (!formEditar.checkValidity() || !tipoStand) {
            formEditar.reportValidity();
            if (!tipoStand) alert('Selecciona un Tipo_Stand.');
            return;
        }

        const id = document.getElementById('editId').value;
        const datos = {
            nombre: document.getElementById('editNombre').value.trim(),
            tipo_stand: tipoStand,
            precio_unitario: document.getElementById('editPrecioUnitario').value
        };

        try {
            const res = await fetch(`/api/productos/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al guardar los cambios');

            document.getElementById('modalEditar').classList.add('hidden');
            cargarProductos();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo guardar el producto.');
        }
    });

    // --- Eliminar ---
    async function eliminarProducto(id) {
        if (!confirm('¿Seguro que quieres eliminar este producto? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/productos/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarProductos();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el producto.');
        }
    }

    // --- Alta ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const tipoStand = document.getElementById('tipoStand').value;
            if (!form.checkValidity() || !tipoStand) {
                form.reportValidity();
                if (!tipoStand) alert('Selecciona un Tipo_Stand.');
                return;
            }

            const datos = {
                nombre: document.getElementById('nombre').value.trim(),
                tipo_stand: tipoStand,
                precio_unitario: document.getElementById('precioUnitario').value,
                stock: document.getElementById('stockInicial').value || ''
            };

            try {
                const res = await fetch('/api/productos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datos)
                });
                const resultado = await res.json();
                if (!res.ok) throw new Error(resultado.error || 'Error al crear el producto');

                alert(`Producto "${resultado.nombre}" añadido correctamente.`);
                form.reset();
                pintarBotones('tipoStandBotones', 'tipoStand', '');
                cargarProductos();
            } catch (err) {
                console.error(err);
                alert(err.message || 'No se pudo crear el producto.');
            }
        });
    }

    // --- Importar catálogo desde Excel ---
    const inputExcel = document.getElementById('inputExcel');
    const btnImportarExcel = document.getElementById('btnImportarExcel');
    const resultadoImportacion = document.getElementById('resultadoImportacion');

    btnImportarExcel.addEventListener('click', () => inputExcel.click());

    inputExcel.addEventListener('change', async () => {
        const archivo = inputExcel.files[0];
        if (!archivo) return;

        btnImportarExcel.disabled = true;
        btnImportarExcel.textContent = 'Subiendo...';
        resultadoImportacion.classList.add('hidden');

        const formData = new FormData();
        formData.append('archivo', archivo);

        try {
            const res = await fetch('/api/productos/importar-excel', { method: 'POST', body: formData });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al importar el archivo');

            const stockTexto = resultado.stockCargado > 0 ? ` Stock cargado en ${resultado.stockCargado} producto(s) en "La Nave".` : '';
            const avisoNave = resultado.avisoSinNave ? ' (No se pudo cargar el stock: no existe un Punto de Venta llamado "Nave" — créalo primero en Puntos de Venta.)' : '';
            resultadoImportacion.textContent = `Importación completada: ${resultado.creados} producto(s) nuevo(s), ${resultado.actualizados} actualizado(s) (de ${resultado.total} filas leídas).${stockTexto}${avisoNave}`;
            resultadoImportacion.className = 'text-sm mb-6 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-3';
            resultadoImportacion.classList.remove('hidden');

            cargarProductos();
        } catch (err) {
            console.error(err);
            resultadoImportacion.textContent = err.message || 'No se pudo importar el archivo.';
            resultadoImportacion.className = 'text-sm mb-6 text-red-700 bg-red-50 border border-red-200 rounded p-3';
            resultadoImportacion.classList.remove('hidden');
        } finally {
            btnImportarExcel.disabled = false;
            btnImportarExcel.textContent = '📄 Subir Excel';
            inputExcel.value = '';
        }
    });

    cargarProductos();
});
