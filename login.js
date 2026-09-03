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
});
