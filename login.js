document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('formLogin');
    const errorLogin = document.getElementById('errorLogin');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorLogin.classList.add('hidden');

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const datos = await res.json();

            if (!res.ok) {
                errorLogin.textContent = datos.error || 'No se pudo iniciar sesión.';
                errorLogin.classList.remove('hidden');
                return;
            }

            window.location.href = '/';
        } catch (err) {
            console.error(err);
            errorLogin.textContent = 'Error de conexión. Inténtalo de nuevo.';
            errorLogin.classList.remove('hidden');
        }
    });

    // --- ¿Olvidaste tu contraseña? ---
    const btnMostrarOlvide = document.getElementById('btnMostrarOlvide');
    const formOlvide = document.getElementById('formOlvide');
    const mensajeOlvide = document.getElementById('mensajeOlvide');

    btnMostrarOlvide.addEventListener('click', () => {
        formOlvide.classList.toggle('hidden');
    });

    formOlvide.addEventListener('submit', async (e) => {
        e.preventDefault();
        mensajeOlvide.classList.add('hidden');

        const email = document.getElementById('emailOlvide').value.trim();
        const boton = formOlvide.querySelector('button[type="submit"]');
        boton.disabled = true;
        boton.textContent = 'Enviando...';

        try {
            const res = await fetch('/api/olvide-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const datos = await res.json();

            mensajeOlvide.textContent = datos.mensaje || (res.ok ? 'Si ese email existe, te hemos enviado un correo.' : (datos.error || 'No se pudo procesar la solicitud.'));
            mensajeOlvide.className = res.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-600';
            mensajeOlvide.classList.remove('hidden');
        } catch (err) {
            console.error(err);
            mensajeOlvide.textContent = 'Error de conexión. Inténtalo de nuevo.';
            mensajeOlvide.className = 'text-sm text-red-600';
            mensajeOlvide.classList.remove('hidden');
        } finally {
            boton.disabled = false;
            boton.textContent = 'Enviar Enlace';
        }
    });
});
