document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formReset');
    const mensajeReset = document.getElementById('mensajeReset');
    const linkVolverLogin = document.getElementById('linkVolverLogin');

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
        form.classList.add('hidden');
        mensajeReset.textContent = 'Este enlace no es válido. Pide uno nuevo desde la pantalla de inicio de sesión.';
        mensajeReset.className = 'text-sm text-red-600';
        mensajeReset.classList.remove('hidden');
        linkVolverLogin.classList.remove('hidden');
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        mensajeReset.classList.add('hidden');

        const passwordNueva = document.getElementById('passwordNueva').value;
        const passwordNuevaRepetir = document.getElementById('passwordNuevaRepetir').value;

        if (passwordNueva !== passwordNuevaRepetir) {
            mensajeReset.textContent = 'Las contraseñas no coinciden.';
            mensajeReset.className = 'text-sm text-red-600';
            mensajeReset.classList.remove('hidden');
            return;
        }

        const boton = form.querySelector('button[type="submit"]');
        boton.disabled = true;
        boton.textContent = 'Guardando...';

        try {
            const res = await fetch('/api/resetear-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password_nueva: passwordNueva })
            });
            const datos = await res.json();

            if (!res.ok) throw new Error(datos.error || 'No se pudo restablecer la contraseña.');

            form.classList.add('hidden');
            mensajeReset.textContent = 'Contraseña actualizada correctamente. Ya puedes iniciar sesión.';
            mensajeReset.className = 'text-sm text-emerald-700';
            mensajeReset.classList.remove('hidden');
            linkVolverLogin.classList.remove('hidden');
        } catch (err) {
            console.error(err);
            mensajeReset.textContent = err.message || 'No se pudo restablecer la contraseña.';
            mensajeReset.className = 'text-sm text-red-600';
            mensajeReset.classList.remove('hidden');
            boton.disabled = false;
            boton.textContent = 'Guardar Contraseña';
        }
    });
});
