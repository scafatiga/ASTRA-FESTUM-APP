document.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('formUsuario');
    const tabla = document.getElementById('tablaUsuarios');

    // Debe coincidir exactamente con las claves usadas en server.js (PAGE_PERMISOS + los 5 de la barra inferior)
    const PESTAÑAS = [
        { clave: 'cierre', label: 'Registro Ventas / Cierre de Caja' },
        { clave: 'historico', label: 'Histórico de Cierres' },
        { clave: 'inout', label: 'In-Out' },
        { clave: 'socios', label: 'Socios' },
        { clave: 'ingresos', label: 'Ingresos' },
        { clave: 'gastos_tarjeta', label: 'Gastos Tarjeta' },
        { clave: 'puntos_venta', label: 'Puntos de Venta' },
        { clave: 'proveedores', label: 'Proveedores' },
        { clave: 'empleados', label: 'Empleados' },
        { clave: 'usuarios', label: 'Usuarios' }
    ];

    let usuarioActual = null;
    let usuariosCache = [];

    function pintarGridPermisos(contenedorId, valoresIniciales) {
        const contenedor = document.getElementById(contenedorId);
        contenedor.innerHTML = PESTAÑAS.map(p => `
            <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" class="permiso-check" data-clave="${p.clave}" ${valoresIniciales && valoresIniciales[p.clave] ? 'checked' : ''}>
                ${p.label}
            </label>
        `).join('');
    }

    function leerGridPermisos(contenedorId) {
        const permisos = {};
        document.querySelectorAll(`#${contenedorId} .permiso-check`).forEach(chk => {
            permisos[chk.dataset.clave] = chk.checked;
        });
        return permisos;
    }

    pintarGridPermisos('permisosGrid', {});

    // --- Colapsar / expandir la lista ---
    const btnToggleLista = document.getElementById('btnToggleLista');
    const listaWrapper = document.getElementById('listaUsuariosWrapper');
    const iconoToggleLista = document.getElementById('iconoToggleLista');
    btnToggleLista.addEventListener('click', () => {
        const abierta = !listaWrapper.classList.contains('hidden');
        listaWrapper.classList.toggle('hidden');
        iconoToggleLista.style.transform = abierta ? 'rotate(0deg)' : 'rotate(180deg)';
    });

    // --- Buscador ---
    document.getElementById('buscadorUsuarios').addEventListener('input', (e) => {
        renderizarTabla(filtrarUsuarios(e.target.value));
    });

    function filtrarUsuarios(texto) {
        const q = (texto || '').trim().toLowerCase();
        if (!q) return usuariosCache;
        return usuariosCache.filter(u =>
            (u.nombre || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
        );
    }

    // --- Cargar usuario actual (para saber quién soy y protegerme a mí mismo en la UI) ---
    async function cargarUsuarioActual() {
        try {
            const res = await fetch('/api/me');
            if (res.ok) usuarioActual = await res.json();
        } catch (err) {
            console.error(err);
        }
    }

    // --- Cargar lista ---
    async function cargarUsuarios() {
        try {
            const res = await fetch('/api/usuarios');
            if (!res.ok) throw new Error('Error al cargar usuarios');
            usuariosCache = await res.json();
            document.getElementById('contadorUsuarios').textContent = usuariosCache.length;

            const texto = document.getElementById('buscadorUsuarios').value;
            renderizarTabla(filtrarUsuarios(texto));
        } catch (err) {
            console.error(err);
            tabla.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-500">Error al cargar los usuarios.</td></tr>`;
        }
    }

    function renderizarTabla(datos) {
        if (!datos || datos.length === 0) {
            tabla.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-500">No hay usuarios que coincidan.</td></tr>`;
            return;
        }

        tabla.innerHTML = datos.map(u => {
            const esUnoMismo = usuarioActual && String(u.id) === String(usuarioActual.id);
            return `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="p-3 font-medium text-gray-800">${u.nombre || ''}${esUnoMismo ? ' <span class="text-xs text-blue-600">(tú)</span>' : ''}</td>
                    <td class="p-3 text-gray-600">${u.email || ''}</td>
                    <td class="p-3">
                        <span class="px-2 py-1 rounded text-xs font-semibold ${u.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
                            ${u.activo ? 'Activo' : 'Inactivo'}
                        </span>
                    </td>
                    <td class="p-3">
                        <select class="accionSelect border rounded px-2 py-1.5 text-xs" data-id="${u.id}" data-activo="${u.activo}" ${esUnoMismo ? 'disabled title="No puedes desactivarte o eliminarte a ti mismo"' : ''}>
                            <option value="">Acción...</option>
                            <option value="editar">Editar</option>
                            ${esUnoMismo ? '' : `<option value="estado">${u.activo ? 'Desactivar' : 'Activar'}</option><option value="eliminar">Eliminar</option>`}
                        </select>
                    </td>
                </tr>
            `;
        }).join('');

        document.querySelectorAll('.accionSelect').forEach(sel => {
            sel.addEventListener('change', async () => {
                const id = sel.dataset.id;
                const accion = sel.value;
                sel.value = '';

                if (accion === 'estado') {
                    await cambiarEstado(id, sel.dataset.activo === 'true');
                } else if (accion === 'editar') {
                    await abrirEditar(id);
                } else if (accion === 'eliminar') {
                    await eliminarUsuario(id);
                }
            });
        });
    }

    async function cambiarEstado(id, activoActual) {
        try {
            const res = await fetch(`/api/usuarios/${id}/estado`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activo: !activoActual })
            });
            const datos = await res.json();
            if (!res.ok) throw new Error(datos.error || 'Error al actualizar estado');
            cargarUsuarios();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo actualizar el estado.');
        }
    }

    // --- Editar ---
    const formEditar = document.getElementById('formEditarUsuario');

    async function abrirEditar(id) {
        try {
            const res = await fetch(`/api/usuarios/${id}`);
            if (!res.ok) throw new Error('No se pudo cargar el usuario');
            const u = await res.json();

            document.getElementById('editId').value = u.id;
            document.getElementById('editNombre').value = u.nombre || '';
            document.getElementById('editEmail').value = u.email || '';
            document.getElementById('editPassword').value = '';
            document.getElementById('editPasswordError').classList.add('hidden');
            pintarGridPermisos('editPermisosGrid', u.permisos || {});

            document.getElementById('modalEditar').classList.remove('hidden');
        } catch (err) {
            console.error(err);
            alert('No se pudo cargar el usuario para editar.');
        }
    }
    document.getElementById('btnCerrarEditar').addEventListener('click', () => {
        document.getElementById('modalEditar').classList.add('hidden');
    });

    formEditar.addEventListener('submit', async (e) => {
        e.preventDefault();

        const password = document.getElementById('editPassword').value;
        if (password && password.length < 8) {
            document.getElementById('editPasswordError').classList.remove('hidden');
            return;
        }
        document.getElementById('editPasswordError').classList.add('hidden');

        const id = document.getElementById('editId').value;
        const datos = {
            nombre: document.getElementById('editNombre').value.trim(),
            email: document.getElementById('editEmail').value.trim(),
            permisos: leerGridPermisos('editPermisosGrid')
        };
        if (password) datos.password = password;

        try {
            const res = await fetch(`/api/usuarios/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datos)
            });
            const resultado = await res.json();
            if (!res.ok) throw new Error(resultado.error || 'Error al guardar los cambios');

            document.getElementById('modalEditar').classList.add('hidden');
            cargarUsuarios();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo guardar el usuario.');
        }
    });

    // --- Eliminar ---
    async function eliminarUsuario(id) {
        if (!confirm('¿Seguro que quieres eliminar este usuario? Esta acción no se puede deshacer.')) return;
        try {
            const res = await fetch(`/api/usuarios/${id}`, { method: 'DELETE' });
            const datos = await res.json();
            if (!res.ok) throw new Error(datos.error || 'Error al eliminar');
            cargarUsuarios();
        } catch (err) {
            console.error(err);
            alert(err.message || 'No se pudo eliminar el usuario.');
        }
    }

    // --- Alta de usuario ---
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            const password = document.getElementById('password').value;
            const passwordConfirmar = document.getElementById('passwordConfirmar').value;
            if (password.length < 8 || password !== passwordConfirmar) {
                document.getElementById('passwordError').classList.remove('hidden');
                return;
            }
            document.getElementById('passwordError').classList.add('hidden');

            const datos = {
                nombre: document.getElementById('nombre').value.trim(),
                email: document.getElementById('email').value.trim(),
                password,
                permisos: leerGridPermisos('permisosGrid')
            };

            try {
                const res = await fetch('/api/usuarios', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(datos)
                });
                const resultado = await res.json();
                if (!res.ok) throw new Error(resultado.error || 'Error al crear el usuario');

                form.reset();
                pintarGridPermisos('permisosGrid', {});
                cargarUsuarios();
            } catch (err) {
                console.error(err);
                alert(err.message || 'No se pudo crear el usuario.');
            }
        });
    }

    await cargarUsuarioActual();
    await cargarUsuarios();
});
