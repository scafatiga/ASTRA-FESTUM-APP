document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formEmpleado');
    const tabla = document.getElementById('tablaEmpleados');
    const selectPuntoVenta = document.getElementById('puntoVenta');
    const checkboxGestoria = document.getElementById('gestoria');
    const grupoGestoria1 = document.getElementById('grupoGestoria1');
    const grupoGestoria2 = document.getElementById('grupoGestoria2');

    // Campos que solo son obligatorios cuando Gestoría = Sí
    const CAMPOS_GESTORIA = ['dni', 'numeroSegSocial', 'nacionalidad', 'fechaNacimiento', 'iban', 'domicilio', 'fechaIn', 'fechaOut', 'horasAlta'];

    // --- Mostrar/ocultar según el checkbox de Gestoría ---
    function actualizarVisibilidadGestoria() {
        const activo = checkboxGestoria.checked;

        [grupoGestoria1, grupoGestoria2].forEach(grupo => {
            if (activo) {
                grupo.classList.remove('hidden');
                grupo.classList.add('contents');
            } else {
                grupo.classList.remove('contents');
                grupo.classList.add('hidden');
            }
        });

        CAMPOS_GESTORIA.forEach(id => {
            document.getElementById(id).required = activo;
        });
        actualizarRequeridoFotoDni();
        if (!activo) document.getElementById('fotoDni').required = false;
    }

    checkboxGestoria.addEventListener('change', actualizarVisibilidadGestoria);
    actualizarVisibilidadGestoria(); // estado inicial

    // --- Validaciones ---

    // Documento: acepta DNI (8 dígitos + letra) o NIE (letra X/Y/Z + 7 dígitos + letra),
    // con la letra de control calculada de verdad, no solo el formato.
    function validarDocumento(valor) {
        const doc = (valor || '').trim().toUpperCase();
        const letras = 'TRWAGMYFPDXBNJZSQVHLCKE';

        if (/^[XYZ]\d{7}[A-Z]$/.test(doc)) {
            const mapaLetraInicial = { X: '0', Y: '1', Z: '2' };
            const numero = mapaLetraInicial[doc[0]] + doc.slice(1, 8);
            const letraEsperada = letras[parseInt(numero, 10) % 23];
            return { valido: letraEsperada === doc[8], tipo: 'NIE' };
        }

        if (/^\d{8}[A-Z]$/.test(doc)) {
            const numero = doc.slice(0, 8);
            const letraEsperada = letras[parseInt(numero, 10) % 23];
            return { valido: letraEsperada === doc[8], tipo: 'DNI' };
        }

        return { valido: false, tipo: null };
    }

    // La Foto DNI solo es obligatoria si el documento introducido es un NIE
    function actualizarRequeridoFotoDni() {
        if (!checkboxGestoria.checked) return; // el bloque entero está oculto, no aplica
        const { tipo } = validarDocumento(document.getElementById('dni').value);
        document.getElementById('fotoDni').required = (tipo === 'NIE');
    }

    document.getElementById('dni').addEventListener('input', actualizarRequeridoFotoDni);

    // Nº Seguridad Social: exactamente 12 dígitos
    function validarSegSocial(valor) {
        return /^\d{12}$/.test((valor || '').trim());
    }

    // IBAN: comprobación de dígito de control (algoritmo mod 97)
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

    // --- Cargar puntos de venta para el desplegable ---
    let puntosVentaCache = [];

    async function cargarPuntosVentaSelect() {
        try {
            const res = await fetch('/api/puntos-venta');
            if (!res.ok) throw new Error('Error al cargar puntos de venta');
            puntosVentaCache = await res.json();

            const opciones = puntosVentaCache
                .map(pv => `<option value="${pv.id}">${pv.nombre}</option>`)
                .join('');
            selectPuntoVenta.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
        } catch (err) {
            console.error('Error cargando puntos de venta:', err);
        }
    }

    function nombrePuntoVenta(id) {
        const pv = puntosVentaCache.find(p => String(p.id) === String(id));
        return pv ? pv.nombre : '-';
    }

    function formatearFecha(f) {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('es-ES');
    }

    // --- Colapsar / expandir la lista ---
    const btnToggleLista = document.getElementById('btnToggleLista');
    const listaWrapper = document.getElementById('listaEmpleadosWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Cambiar Activo/Inactivo desde el menú de Acción ---
    async function cambiarEstadoEmpleado(id, estadoActual) {
        try {
            const res = await fetch(`/api/personal/${id}/estado`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: !estadoActual })
            });
            if (!res.ok) throw new Error('Error al actualizar estado');
            cargarEmpleados();
        } catch (err) {
            console.error(err);
            alert('No se pudo actualizar el estado.');
        }
    }

    // --- Detalle (solo lectura) ---
    async function abrirDetalle(id) {
        try {
            const res = await fetch(`/api/personal/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el empleado');
            const e = await res.json();

            const filas = [
                ['Nombre', e.nombre],
                ['DNI / NIE', e.dni],
                ['Nº Seguridad Social', e.numero_seguridad_social],
                ['Nacionalidad', e.nacionalidad],
                ['Fecha de Nacimiento', formatearFecha(e.fecha_nacimiento)],
                ['IBAN', e.iban],
                ['Domicilio', e.domicilio],
                ['Fecha IN', formatearFecha(e.fecha_in)],
                ['Fecha OUT', formatearFecha(e.fecha_out)],
                ['Jornada Semanal', e.horas_alta],
                ['Punto de Venta', nombrePuntoVenta(e.punto_venta_id)],
                ['Email', e.email],
                ['Estado', e.estado ? 'Activo' : 'Inactivo'],
                ['Foto DNI', e.tiene_foto_dni
                    ? `<a href="/api/personal/${e.id}/foto-dni" target="_blank" class="text-blue-600 hover:underline">Ver archivo</a>`
                    : 'No adjuntada']
            ];

            document.getElementById('contenidoDetalle').innerHTML = filas.map(([label, valor]) => `
                <div class="flex justify-between border-b py-1.5 gap-4">
                    <span class="text-gray-500">${label}</span>
                    <span class="text-gray-800 font-medium text-right">${valor || '-'}</span>
                </div>
            `).join('');

            document.getElementById('modalDetalle').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el detalle del empleado.');
        }
    }
    document.getElementById('btnCerrarDetalle').addEventListener('click', () => {
        document.getElementById('modalDetalle').classList.add('hidden');
    });

    // --- Editar ---
    const formEditar = document.getElementById('formEditarEmpleado');

    async function abrirEditar(id) {
        try {
            const res = await fetch(`/api/personal/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el empleado');
            const e = await res.json();

            document.getElementById('editId').value = e.id;
            document.getElementById('editNombre').value = e.nombre || '';
            document.getElementById('editDni').value = e.dni || '';
            document.getElementById('editNumeroSegSocial').value = e.numero_seguridad_social || '';
            document.getElementById('editNacionalidad').value = e.nacionalidad || '';
            document.getElementById('editFechaNacimiento').value = e.fecha_nacimiento ? e.fecha_nacimiento.substring(0, 10) : '';
            document.getElementById('editIban').value = e.iban || '';
            document.getElementById('editDomicilio').value = e.domicilio || '';
            document.getElementById('editFechaIn').value = e.fecha_in ? e.fecha_in.substring(0, 10) : '';
            document.getElementById('editFechaOut').value = e.fecha_out ? e.fecha_out.substring(0, 10) : '';
            document.getElementById('editHorasAlta').value = e.horas_alta || '';
            document.getElementById('editEmail').value = e.email || '';
            document.getElementById('editEstado').value = e.estado ? 'true' : 'false';
            document.getElementById('editFotoDni').value = '';

            const selectEditPV = document.getElementById('editPuntoVenta');
            const opciones = puntosVentaCache.map(pv => `<option value="${pv.id}">${pv.nombre}</option>`).join('');
            selectEditPV.innerHTML = `<option value="">-- Selecciona --</option>${opciones}`;
            selectEditPV.value = e.punto_venta_id || '';

            document.getElementById('editDniError').classList.add('hidden');
            document.getElementById('editSegSocialError').classList.add('hidden');
            document.getElementById('editIbanError').classList.add('hidden');

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el empleado para editar.');
        }
    }
    document.getElementById('btnCerrarEditar').addEventListener('click', () => {
        document.getElementById('modalEditar').classList.add('hidden');
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();

        const dni = document.getElementById('editDni').value.trim();
        const segSocial = document.getElementById('editNumeroSegSocial').value.trim();
        const iban = document.getElementById('editIban').value.trim();

        let valido = true;
        if (dni) {
            const { valido: dniValido } = validarDocumento(dni);
            mostrarError('editDni', 'editDniError', dniValido);
            valido = valido && dniValido;
        }
        if (segSocial) {
            const segSocialValido = validarSegSocial(segSocial);
            mostrarError('editNumeroSegSocial', 'editSegSocialError', segSocialValido);
            valido = valido && segSocialValido;
        }
        if (iban) {
            const ibanValido = validarIBAN(iban);
            mostrarError('editIban', 'editIbanError', ibanValido);
            valido = valido && ibanValido;
        }
        if (!valido) return;

        const id = document.getElementById('editId').value;
        const formData = new FormData();
        formData.append('nombre', document.getElementById('editNombre').value.trim());
        formData.append('dni', dni);
        formData.append('numero_seguridad_social', segSocial);
        formData.append('nacionalidad', document.getElementById('editNacionalidad').value.trim());
        formData.append('fecha_nacimiento', document.getElementById('editFechaNacimiento').value || '');
        formData.append('iban', iban);
        formData.append('domicilio', document.getElementById('editDomicilio').value.trim());
        formData.append('fecha_in', document.getElementById('editFechaIn').value || '');
        formData.append('fecha_out', document.getElementById('editFechaOut').value || '');
        formData.append('horas_alta', document.getElementById('editHorasAlta').value || '');
        formData.append('punto_venta_id', document.getElementById('editPuntoVenta').value || '');
        formData.append('email', document.getElementById('editEmail').value.trim());
        formData.append('estado', document.getElementById('editEstado').value);

        const archivoFotoDni = document.getElementById('editFotoDni').files[0];
        if (archivoFotoDni) {
            formData.append('fotoDni', archivoFotoDni);
        }

        try {
            const res = await fetch(`/api/personal/${id}`, { method: 'PUT', body: formData });
            if (!res.ok) throw new Error('Error al guardar los cambios');
            document.getElementById('modalEditar').classList.add('hidden');
            cargarEmpleados();
        } catch (err) {
            console.error(err);
            alert('No se pudo guardar el empleado.');
        }
    });

    // --- Eliminar ---
    async function eliminarEmpleado(id) {
        if (!confirm('¿Seguro que quieres eliminar este empleado? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/personal/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');
            cargarEmpleados();
        } catch (err) {
            console.error(err);
            alert('No se pudo eliminar el empleado.');
        }
    }

    // --- Cargar lista de empleados ---
    async function cargarEmpleados() {
        try {
            const res = await fetch('/api/personal');
            if (!res.ok) throw new Error('Error al cargar empleados');
            const datos = await res.json();

            document.getElementById('contadorEmpleados').textContent = datos ? datos.length : 0;

            if (!datos || datos.length === 0) {
                tabla.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-gray-500">No hay empleados registrados.</td></tr>`;
                return;
            }

            tabla.innerHTML = datos.map(e => `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 font-medium text-gray-800">${e.nombre || ''}</td>
                    <td class="p-3 text-gray-600">${e.dni || '-'}</td>
                    <td class="p-3 text-gray-600">${nombrePuntoVenta(e.punto_venta_id)}</td>
                    <td class="p-3 text-gray-600">${formatearFecha(e.fecha_in)}</td>
                    <td class="p-3 text-gray-600">${formatearFecha(e.fecha_out)}</td>
                    <td class="p-3">
                        ${e.tiene_foto_dni
                            ? `<a href="/api/personal/${e.id}/foto-dni" target="_blank" class="text-blue-600 hover:underline text-xs">Ver</a>
                               <span class="text-gray-300">|</span>
                               <a href="/api/personal/${e.id}/foto-dni?download=1" class="text-blue-600 hover:underline text-xs">Descargar</a>`
                            : '<span class="text-gray-400 text-xs">-</span>'}
                    </td>
                    <td class="p-3">
                        <span class="px-2 py-1 rounded text-xs font-semibold ${e.estado ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
                            ${e.estado ? 'Activo' : 'No Activo'}
                        </span>
                    </td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${e.id}" data-estado="${e.estado}">
                            <option value="">Acción...</option>
                            <option value="estado">${e.estado ? 'Desactivar' : 'Activar'}</option>
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
                    sel.value = ''; // vuelve al placeholder tras ejecutar

                    if (accion === 'estado') {
                        await cambiarEstadoEmpleado(id, sel.dataset.estado === 'true');
                    } else if (accion === 'detalle') {
                        await abrirDetalle(id);
                    } else if (accion === 'editar') {
                        await abrirEditar(id);
                    } else if (accion === 'eliminar') {
                        await eliminarEmpleado(id);
                    }
                });
            });

        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="8" class="p-4 text-center text-red-500">Error al cargar los empleados.</td></tr>`;
        }
    }

    // --- Envío del formulario ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const gestoriaActiva = checkboxGestoria.checked;
            const nombre = document.getElementById('nombre').value.trim();

            // Validación nativa de campos obligatorios (respeta el required dinámico ya aplicado)
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            // Validaciones específicas, solo si el bloque de Gestoría está activo y visible
            if (gestoriaActiva) {
                const dni = document.getElementById('dni').value.trim();
                const segSocial = document.getElementById('numeroSegSocial').value.trim();
                const iban = document.getElementById('iban').value.trim();

                const { valido: dniValido, tipo: tipoDocumento } = validarDocumento(dni);
                const segSocialValido = validarSegSocial(segSocial);
                const ibanValido = validarIBAN(iban);

                mostrarError('dni', 'dniError', dniValido);
                mostrarError('numeroSegSocial', 'segSocialError', segSocialValido);
                mostrarError('iban', 'ibanError', ibanValido);

                // Foto DNI solo obligatoria si es NIE
                const fotoDniInput = document.getElementById('fotoDni');
                fotoDniInput.required = (tipoDocumento === 'NIE');
                const fotoDniValida = !fotoDniInput.required || fotoDniInput.files.length > 0;
                if (!fotoDniValida) fotoDniInput.reportValidity();

                if (!dniValido || !segSocialValido || !ibanValido || !fotoDniValida) {
                    return; // no envía el formulario hasta que todo sea válido
                }
            }

            const formData = new FormData();
            formData.append('nombre', nombre);
            formData.append('punto_venta_id', document.getElementById('puntoVenta').value || '');
            formData.append('email', document.getElementById('email').value.trim());
            formData.append('estado', document.getElementById('estado').value);
            formData.append('enviarGestoria', gestoriaActiva);

            if (gestoriaActiva) {
                formData.append('dni', document.getElementById('dni').value.trim());
                formData.append('numero_seguridad_social', document.getElementById('numeroSegSocial').value.trim());
                formData.append('nacionalidad', document.getElementById('nacionalidad').value.trim());
                formData.append('fecha_nacimiento', document.getElementById('fechaNacimiento').value || '');
                formData.append('iban', document.getElementById('iban').value.trim());
                formData.append('domicilio', document.getElementById('domicilio').value.trim());
                formData.append('fecha_in', document.getElementById('fechaIn').value || '');
                formData.append('fecha_out', document.getElementById('fechaOut').value || '');
                formData.append('horas_alta', document.getElementById('horasAlta').value || '');

                const archivoFotoDni = document.getElementById('fotoDni').files[0];
                if (archivoFotoDni) {
                    formData.append('fotoDni', archivoFotoDni);
                }
            }

            try {
                const res = await fetch('/api/personal', {
                    method: 'POST',
                    body: formData
                    // Sin header Content-Type: el navegador lo pone solo (multipart + boundary)
                });
                if (!res.ok) throw new Error('Error al crear empleado');

                const resultado = await res.json();
                if (gestoriaActiva) {
                    if (resultado.gestoria_enviada) {
                        alert('Empleado creado y email enviado a la Gestoría.');
                    } else {
                        alert('Empleado creado, pero el email a la Gestoría NO se pudo enviar: ' + (resultado.gestoria_error || 'error desconocido'));
                    }
                }

                form.reset();
                actualizarVisibilidadGestoria();
                cargarEmpleados();
            } catch (err) {
                console.error(err);
                alert('No se pudo crear el empleado.');
            }
        });
    }

    await cargarPuntosVentaSelect();
    await cargarEmpleados();
});
