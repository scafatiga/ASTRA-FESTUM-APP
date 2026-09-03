document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formProveedor');
    const tabla = document.getElementById('tablaProveedores');
    let proveedoresCache = [];

    // --- Validaciones (mismo rigor matemático que en Empleados) ---

    function validarDNI(doc) {
        const letras = 'TRWAGMYFPDXBNJZSQVHLCKE';
        if (!/^\d{8}[A-Z]$/.test(doc)) return false;
        const letraEsperada = letras[parseInt(doc.slice(0, 8), 10) % 23];
        return letraEsperada === doc[8];
    }

    function validarNIE(doc) {
        const letras = 'TRWAGMYFPDXBNJZSQVHLCKE';
        if (!/^[XYZ]\d{7}[A-Z]$/.test(doc)) return false;
        const mapaLetraInicial = { X: '0', Y: '1', Z: '2' };
        const numero = mapaLetraInicial[doc[0]] + doc.slice(1, 8);
        const letraEsperada = letras[parseInt(numero, 10) % 23];
        return letraEsperada === doc[8];
    }

    // CIF: letra + 7 dígitos + dígito o letra de control (algoritmo oficial)
    function validarCIF(doc) {
        if (!/^[A-Z]\d{7}[0-9A-Z]$/.test(doc)) return false;
        const letraInicial = doc[0];
        const digitos = doc.slice(1, 8);
        const controlActual = doc[8];

        let sumaPar = 0, sumaImpar = 0;
        for (let i = 0; i < 7; i++) {
            const n = parseInt(digitos[i], 10);
            if (i % 2 === 0) { // posiciones 1ª,3ª,5ª,7ª (impares en base 1) -> se duplican
                let doble = n * 2;
                if (doble > 9) doble -= 9;
                sumaPar += doble;
            } else {
                sumaImpar += n;
            }
        }
        const unidad = (sumaPar + sumaImpar) % 10;
        const digitoControl = unidad === 0 ? 0 : 10 - unidad;
        const letraControl = 'JABCDEFGHI'[digitoControl];

        const soloNumerico = 'ABEH';
        const soloLetra = 'KPQS';

        if (soloNumerico.includes(letraInicial)) return controlActual === String(digitoControl);
        if (soloLetra.includes(letraInicial)) return controlActual === letraControl;
        return controlActual === String(digitoControl) || controlActual === letraControl;
    }

    // Acepta los 3 formatos que puede tener el identificador fiscal de un proveedor:
    // DNI (8 dígitos+letra), NIE (letra X/Y/Z+7 dígitos+letra), o CIF (letra+7 dígitos+dígito/letra)
    function validarDocumentoFiscal(valor) {
        const doc = (valor || '').trim().toUpperCase();
        if (/^\d{8}[A-Z]$/.test(doc)) return validarDNI(doc);
        if (/^[XYZ]\d{7}[A-Z]$/.test(doc)) return validarNIE(doc);
        if (/^[A-Z]\d{7}[0-9A-Z]$/.test(doc)) return validarCIF(doc);
        return false;
    }

    // IBAN: algoritmo real (ISO 7064, módulo 97)
    function validarIBAN(valor) {
        const iban = (valor || '').replace(/\s+/g, '').toUpperCase();
        if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban) || iban.length < 15) return false;
        const reordenado = iban.slice(4) + iban.slice(0, 4);
        const convertido = reordenado.replace(/[A-Z]/g, ch => (ch.charCodeAt(0) - 55).toString());
        let resto = 0;
        for (let i = 0; i < convertido.length; i++) {
            resto = (resto * 10 + parseInt(convertido[i], 10)) % 97;
        }
        return resto === 1;
    }

    function formatearFechaHora(f) {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }

    function mostrarError(idCampo, idError, esValido) {
        const campo = document.getElementById(idCampo);
        const error = document.getElementById(idError);
        if (esValido) {
            campo.classList.remove('border-red-500');
            error.classList.add('hidden');
        } else {
            campo.classList.add('border-red-500');
            error.classList.remove('hidden');
        }
    }

    // --- Colapsar / expandir la lista ---
    const btnToggleLista = document.getElementById('btnToggleLista');
    const listaWrapper = document.getElementById('listaProveedoresWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Buscador en tiempo real ---
    document.getElementById('buscadorProveedores').addEventListener('input', (e) => {
        renderizarTabla(filtrarProveedores(e.target.value));
    });

    function filtrarProveedores(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return proveedoresCache;
        return proveedoresCache.filter(p => {
            const campos = [p.nombre_proveedor, p.nombre_comercial, p.cif, p.ciudad, p.telefono, p.email];
            return campos.some(c => (c || '').toLowerCase().includes(q));
        });
    }

    // --- Cargar lista ---
    async function cargarProveedores() {
        try {
            const res = await fetch('/api/proveedores/todos');
            if (!res.ok) throw new Error('Error al cargar proveedores');
            proveedoresCache = await res.json();
            document.getElementById('contadorProveedores').textContent = proveedoresCache.length;

            const texto = document.getElementById('buscadorProveedores').value;
            renderizarTabla(filtrarProveedores(texto));
        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-red-500">Error al cargar los proveedores.</td></tr>`;
        }
    }

    function renderizarTabla(datos) {
        if (!datos || datos.length === 0) {
            tabla.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-gray-500">No hay proveedores que coincidan.</td></tr>`;
            return;
        }

        tabla.innerHTML = datos.map(p => `
            <tr class="hover:bg-gray-50 border-b">
                <td class="p-3 font-medium text-gray-800">${p.nombre_proveedor || ''}</td>
                <td class="p-3 text-gray-600">${p.nombre_comercial || '-'}</td>
                <td class="p-3 text-gray-600">${p.cif || '-'}</td>
                <td class="p-3 text-gray-600">${p.ciudad || '-'}</td>
                <td class="p-3 text-gray-600">${p.telefono || '-'}</td>
                <td class="p-3 text-gray-600">${p.email || '-'}</td>
                <td class="p-3">
                    <span class="px-2 py-1 rounded text-xs font-semibold ${p.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
                        ${p.activo ? 'Activo' : 'Inactivo'}
                    </span>
                </td>
                <td class="p-3">
                    <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${p.id}" data-activo="${p.activo}">
                        <option value="">Acción...</option>
                        <option value="estado">${p.activo ? 'Desactivar' : 'Activar'}</option>
                        <option value="detalle">Detalle</option>
                        <option value="editar">Editar</option>
                        <option value="eliminar">Eliminar</option>
                    </select>
                </td>
            </tr>
        `).join('');

        document.querySelectorAll('.accionSelect').forEach(sel => {
            sel.addEventListener('change', async () => {
                const id = sel.dataset.id;
                const accion = sel.value;
                sel.value = '';

                if (accion === 'estado') {
                    await cambiarEstado(id, sel.dataset.activo === 'true');
                } else if (accion === 'detalle') {
                    abrirDetalle(id);
                } else if (accion === 'editar') {
                    abrirEditar(id);
                } else if (accion === 'eliminar') {
                    await eliminarProveedor(id);
                }
            });
        });
    }

    async function cambiarEstado(id, activoActual) {
        try {
            const res = await fetch(`/api/proveedores/${id}/estado`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activo: !activoActual })
            });
            if (!res.ok) throw new Error('Error al actualizar estado');
            cargarProveedores();
        } catch (err) {
            console.error(err);
            alert('No se pudo actualizar el estado.');
        }
    }

    // --- Detalle ---
    function abrirDetalle(id) {
        const p = proveedoresCache.find(x => String(x.id) === String(id));
        if (!p) return;

        const filas = [
            ['Nombre Proveedor', p.nombre_proveedor],
            ['Nombre Comercial', p.nombre_comercial],
            ['CIF', p.cif],
            ['IBAN', p.iban],
            ['Forma de Pago', p.forma_pago],
            ['Ciudad', p.ciudad],
            ['Dirección Fiscal', p.direccion_fiscal],
            ['Teléfono', p.telefono],
            ['Email', p.email],
            ['Estado', p.activo ? 'Activo' : 'Inactivo'],
            ['Registrado por', p.registrado_por_nombre
                ? `${p.registrado_por_nombre} — ${formatearFechaHora(p.created_at)}`
                : '-']
        ];

        document.getElementById('contenidoDetalle').innerHTML = filas.map(([label, valor]) => `
            <div class="flex justify-between border-b py-1.5 gap-4">
                <span class="text-gray-500">${label}</span>
                <span class="text-gray-800 font-medium text-right">${valor || '-'}</span>
            </div>
        `).join('');

        document.getElementById('modalDetalle').classList.remove('hidden');
    }
    document.getElementById('btnCerrarDetalle').addEventListener('click', () => {
        document.getElementById('modalDetalle').classList.add('hidden');
    });

    // --- Editar ---
    const formEditar = document.getElementById('formEditarProveedor');

    function abrirEditar(id) {
        const p = proveedoresCache.find(x => String(x.id) === String(id));
        if (!p) return;

        document.getElementById('editId').value = p.id;
        document.getElementById('editNombreProveedor').value = p.nombre_proveedor || '';
        document.getElementById('editNombreComercial').value = p.nombre_comercial || '';
        document.getElementById('editCif').value = p.cif || '';
        document.getElementById('editIban').value = p.iban || '';
        document.getElementById('editFormaPago').value = p.forma_pago || '';
        document.getElementById('editCiudad').value = p.ciudad || '';
        document.getElementById('editDireccionFiscal').value = p.direccion_fiscal || '';
        document.getElementById('editTelefono').value = p.telefono || '';
        document.getElementById('editEmail').value = p.email || '';

        document.getElementById('editCifError').classList.add('hidden');
        document.getElementById('editIbanError').classList.add('hidden');

        document.getElementById('modalEditar').classList.remove('hidden');
    }
    document.getElementById('btnCerrarEditar').addEventListener('click', () => {
        document.getElementById('modalEditar').classList.add('hidden');
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!formEditar.checkValidity()) {
            formEditar.reportValidity();
            return;
        }

        const cif = document.getElementById('editCif').value.trim();
        const iban = document.getElementById('editIban').value.trim();

        let valido = true;
        if (cif) {
            const cifValido = validarDocumentoFiscal(cif);
            mostrarError('editCif', 'editCifError', cifValido);
            valido = valido && cifValido;
        }
        if (iban) {
            const ibanValido = validarIBAN(iban);
            mostrarError('editIban', 'editIbanError', ibanValido);
            valido = valido && ibanValido;
        }
        if (!valido) return;

        const id = document.getElementById('editId').value;
        const datos = {
            nombre_proveedor: document.getElementById('editNombreProveedor').value.trim(),
            nombre_comercial: document.getElementById('editNombreComercial').value.trim(),
            cif, iban,
            forma_pago: document.getElementById('editFormaPago').value.trim(),
            ciudad: document.getElementById('editCiudad').value.trim(),
            direccion_fiscal: document.getElementById('editDireccionFiscal').value.trim(),
            telefono: document.getElementById('editTelefono').value.trim(),
            email: document.getElementById('editEmail').value.trim()
        };

        try {
            const res = await fetch(`/api/proveedores/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            if (!res.ok) throw new Error('Error al guardar los cambios');
            document.getElementById('modalEditar').classList.add('hidden');
            cargarProveedores();
        } catch (err) {
            console.error(err);
            alert('No se pudo guardar el proveedor.');
        }
    });

    // --- Eliminar ---
    async function eliminarProveedor(id) {
        if (!confirm('¿Seguro que quieres eliminar este proveedor? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/proveedores/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarProveedores();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el proveedor.');
        }
    }

    // --- Alta de proveedor ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const cif = document.getElementById('cif').value.trim();
            const iban = document.getElementById('iban').value.trim();

            let valido = true;
            if (cif) {
                const cifValido = validarDocumentoFiscal(cif);
                mostrarError('cif', 'cifError', cifValido);
                valido = valido && cifValido;
            }
            if (iban) {
                const ibanValido = validarIBAN(iban);
                mostrarError('iban', 'ibanError', ibanValido);
                valido = valido && ibanValido;
            }
            if (!valido) return;

            const nombre_proveedor = document.getElementById('nombreProveedor').value.trim();
            const nombre_comercial = document.getElementById('nombreComercial').value.trim();
            const forma_pago = document.getElementById('formaPago').value.trim();
            const ciudad = document.getElementById('ciudad').value.trim();
            const direccion_fiscal = document.getElementById('direccionFiscal').value.trim();
            const telefono = document.getElementById('telefono').value.trim();
            const email = document.getElementById('email').value.trim();

            if (!nombre_proveedor) return;

            try {
                const res = await fetch('/api/proveedores', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        nombre_proveedor, nombre_comercial, cif, iban,
                        forma_pago, ciudad, direccion_fiscal, telefono, email
                    })
                });
                if (!res.ok) throw new Error('Error al crear proveedor');

                form.reset();
                cargarProveedores();
            } catch (err) {
                console.error(err);
                alert('No se pudo crear el proveedor.');
            }
        });
    }

    cargarProveedores();
});
