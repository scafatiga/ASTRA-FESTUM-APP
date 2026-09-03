import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Resend } from 'resend';
import bcrypt from 'bcryptjs';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// La base de datos se conecta antes que nada: la necesitan tanto las rutas
// normales como el guardado de sesiones de login.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Render está detrás de un proxy; hace falta para que las cookies "secure" funcionen bien.
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Sesión de login ("recuérdame" 30 días, persistida en la base de datos) ---
const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'astra-festum-cambia-esta-clave',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
  }
}));

// --- Control de acceso: qué pestaña necesita qué permiso ---
const PAGE_PERMISOS = {
  '/cierre.html': 'cierre',
  '/historico.html': 'historico',
  '/inout.html': 'inout',
  '/socios.html': 'socios',
  '/ingresos.html': 'ingresos',
  '/gastos-tarjeta.html': 'gastos_tarjeta',
  '/puntos-venta.html': 'puntos_venta',
  '/proveedores.html': 'proveedores',
  '/empleados.html': 'empleados',
  '/usuarios.html': 'usuarios'
};

const PUBLIC_PATHS = new Set(['/login.html', '/login.js', '/nav.css', '/nav.js', '/favicon.ico']);

function requireAuth(req, res, next) {
  if (!req.session || !req.session.usuario) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

function requirePermiso(tab) {
  return (req, res, next) => {
    if (!req.session || !req.session.usuario) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (!req.session.usuario.permisos || !req.session.usuario.permisos[tab]) {
      return res.status(403).json({ error: 'No tienes acceso a esta sección' });
    }
    next();
  };
}

// Puerta de entrada para las páginas HTML: sin sesión, todo redirige a /login.html;
// con sesión, cada página exige el permiso que le corresponda (si tiene uno asignado).
app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path) || req.path.startsWith('/api/')) return next();

  const autenticado = !!(req.session && req.session.usuario);
  if (!autenticado) {
    if (req.path === '/' || req.path.endsWith('.html')) {
      return res.redirect('/login.html');
    }
    return res.status(401).send('No autenticado');
  }

  const permisoRequerido = PAGE_PERMISOS[req.path];
  if (permisoRequerido && !req.session.usuario.permisos[permisoRequerido]) {
    return res.status(403).send('No tienes acceso a esta sección.');
  }

  next();
});

app.use(express.static(path.join(__dirname)));

// --- Login / Logout / Sesión actual ---

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Faltan email o contraseña' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, email, permisos, activo, password_hash FROM usuarios WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    const usuario = rows[0];

    if (!usuario || !usuario.password_hash) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    if (!usuario.activo) {
      return res.status(403).json({ error: 'Este usuario está desactivado' });
    }

    const coincide = await bcrypt.compare(password, usuario.password_hash);
    if (!coincide) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    req.session.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      permisos: usuario.permisos || {}
    };

    res.json({ ok: true, usuario: req.session.usuario });
  } catch (err) {
    console.error('Error POST /api/login:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.usuario) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  res.json(req.session.usuario);
});

// Multer en memoria: el archivo se guarda directo en la base de datos (columna BYTEA),
// no se escribe nunca en el disco de Render.
const upload = multer({ storage: multer.memoryStorage() });

// --- Envío de email a la Gestoría (checkbox en Alta de Empleado) ---

let resendClient = null;

function getResendClient() {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('Falta la variable de entorno RESEND_API_KEY');
  }
  resendClient = new Resend(apiKey);
  return resendClient;
}

function formatearFechaEmail(f) {
  if (!f) return '-';
  const d = new Date(f);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('es-ES');
}

async function enviarEmailGestoria(empleado, puntoVenta, archivo) {
  const resend = getResendClient();
  const destinatario = process.env.GESTORIA_EMAIL || 'gabrielscafati@yahoo.com';
  const remitente = process.env.RESEND_FROM_EMAIL || 'Astra Festum <onboarding@resend.dev>';

  const cuerpo = `Hola, por favor tramitar alta en ASTRA FESTUM:

DATOS PERSONALES:
Nombre: ${empleado.nombre || '-'}
DNI: ${empleado.dni || '-'}
Nº Seguridad Social: ${empleado.numero_seguridad_social || '-'}
Nacionalidad: ${empleado.nacionalidad || '-'}
Domicilio: ${empleado.domicilio || '-'}

DATOS CONTRACTUALES:
Punto de Venta: ${(puntoVenta && puntoVenta.nombre) || '-'}
Dirección: ${(puntoVenta && puntoVenta.direccion) || '-'}
Fecha de Inicio: ${formatearFechaEmail(empleado.fecha_in)}
Fecha Fin: ${formatearFechaEmail(empleado.fecha_out)}
Jornada: ${empleado.horas_alta || '-'}

Un saludo y gracias.
Gabriel Scafati
+34610261627
`;

  const opciones = {
    from: remitente,
    to: destinatario,
    subject: `Alta en ASTRA FESTUM - ${empleado.nombre}`,
    text: cuerpo
  };

  if (archivo && archivo.buffer) {
    opciones.attachments = [{
      filename: archivo.originalname || 'foto-dni',
      content: archivo.buffer
    }];
  }

  const { error } = await resend.emails.send(opciones);
  if (error) {
    throw new Error(error.message || JSON.stringify(error));
  }
}

// --- PUNTOS DE VENTA ---

app.get('/api/puntos-venta', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM puntos_venta WHERE activo = TRUE ORDER BY nombre ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/puntos-venta/todos', requirePermiso('puntos_venta'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM puntos_venta ORDER BY nombre ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/puntos-venta', requirePermiso('puntos_venta'), async (req, res) => {
  const { nombre, direccion, tipo_stand } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO puntos_venta (nombre, direccion, tipo_stand, activo) VALUES ($1, $2, $3, TRUE) RETURNING *',
      [nombre, direccion || null, tipo_stand || null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/puntos-venta/:id/estado', requirePermiso('puntos_venta'), async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE puntos_venta SET activo = $1 WHERE id = $2 RETURNING *',
      [activo, id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CIERRES ---

app.get('/api/cierres', requirePermiso('historico'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cierres ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/cierres:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cierres', requirePermiso('cierre'), async (req, res) => {
  const {
    fecha,
    punto_venta,
    total_efectivo,
    total_tarjeta,
    observaciones,
    gastos,
    adelantos
  } = req.body;

  // Validación básica: sin punto_venta no tiene sentido guardar el cierre
  if (!punto_venta) {
    return res.status(400).json({ error: 'Falta punto_venta en la petición' });
  }

  // gastos/adelantos siempre deben ser arrays (aunque vengan vacíos) antes de guardarlos como JSON
  const gastosJson = JSON.stringify(Array.isArray(gastos) ? gastos : []);
  const adelantosJson = JSON.stringify(Array.isArray(adelantos) ? adelantos : []);

  try {
    const { rows } = await pool.query(
      `INSERT INTO cierres
        (fecha, punto_venta, total_efectivo, total_tarjeta, observaciones, gastos, adelantos)
       VALUES
        (COALESCE($1, NOW()), $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       RETURNING *`,
      [
        fecha || null,
        punto_venta,
        total_efectivo || 0,
        total_tarjeta || 0,
        observaciones || '',
        gastosJson,
        adelantosJson
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/cierres:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- USUARIOS / EMPLEADOS (cuentas de acceso, tabla "usuarios") ---

app.get('/api/usuarios', requirePermiso('usuarios'), async (req, res) => {
  try {
    // Nunca se devuelve password_hash, ni aquí ni en ninguna otra respuesta.
    const { rows } = await pool.query(
      `SELECT id, nombre, email, permisos, activo, creado_en FROM usuarios ORDER BY nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/usuarios:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usuarios/:id', requirePermiso('usuarios'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, email, permisos, activo, creado_en FROM usuarios WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/usuarios/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/usuarios', requirePermiso('usuarios'), async (req, res) => {
  const { nombre, email, password, permisos } = req.body;

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (empresa_id, nombre, email, password_hash, permisos, activo)
       VALUES (
         (SELECT empresa_id FROM usuarios WHERE id = $1),
         $2, $3, $4, $5::jsonb, TRUE
       )
       RETURNING id, nombre, email, permisos, activo, creado_en`,
      [req.session.usuario.id, nombre, email.trim().toLowerCase(), passwordHash, JSON.stringify(permisos || {})]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') { // email duplicado
      return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
    }
    console.error('Error POST /api/usuarios:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/usuarios/:id', requirePermiso('usuarios'), async (req, res) => {
  const { id } = req.params;
  const { nombre, email, password, permisos } = req.body;

  if (!nombre || !email) {
    return res.status(400).json({ error: 'Nombre y email son obligatorios' });
  }

  // No te puedes quitar a ti mismo el acceso a la pestaña Usuarios (evita quedarte fuera).
  if (id === req.session.usuario.id && permisos && permisos.usuarios !== true) {
    return res.status(400).json({ error: 'No puedes quitarte a ti mismo el acceso a Usuarios' });
  }

  try {
    let rows;
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      ({ rows } = await pool.query(
        `UPDATE usuarios SET nombre=$1, email=$2, permisos=$3::jsonb, password_hash=$4
         WHERE id=$5
         RETURNING id, nombre, email, permisos, activo, creado_en`,
        [nombre, email.trim().toLowerCase(), JSON.stringify(permisos || {}), passwordHash, id]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE usuarios SET nombre=$1, email=$2, permisos=$3::jsonb
         WHERE id=$4
         RETURNING id, nombre, email, permisos, activo, creado_en`,
        [nombre, email.trim().toLowerCase(), JSON.stringify(permisos || {}), id]
      ));
    }

    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Si te has editado a ti mismo, refresca tus permisos en la sesión activa
    if (id === req.session.usuario.id) {
      req.session.usuario.nombre = rows[0].nombre;
      req.session.usuario.email = rows[0].email;
      req.session.usuario.permisos = rows[0].permisos;
    }

    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
    }
    console.error('Error PUT /api/usuarios/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/usuarios/:id/estado', requirePermiso('usuarios'), async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;

  if (id === req.session.usuario.id) {
    return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE usuarios SET activo = $1 WHERE id = $2 RETURNING id, nombre, email, permisos, activo',
      [activo, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PATCH /api/usuarios/:id/estado:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/usuarios/:id', requirePermiso('usuarios'), async (req, res) => {
  const { id } = req.params;

  if (id === req.session.usuario.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }

  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/usuarios/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/empleados', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, email, activo FROM usuarios WHERE activo = TRUE ORDER BY nombre ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/empleados:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- PERSONAL (ficha completa de empleado, tabla "empleados") ---

app.get('/api/personal', requirePermiso('empleados'), async (req, res) => {
  try {
    // No traemos foto_dni_data (puede pesar varios MB) en la lista, solo si existe o no
    const { rows } = await pool.query(
      `SELECT id, usuario_id, nombre, dni, numero_seguridad_social, nacionalidad,
              fecha_nacimiento, iban, domicilio, fecha_in, fecha_out, horas_alta,
              punto_venta_id, email, estado, created_at,
              (foto_dni_data IS NOT NULL) AS tiene_foto_dni
       FROM empleados ORDER BY nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/personal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sirve el archivo de la Foto DNI guardado en la base de datos.
// Con ?download=1 fuerza la descarga en vez de abrirlo en el navegador.
app.get('/api/personal/:id/foto-dni', requirePermiso('empleados'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT foto_dni_data, foto_dni_mime, foto_dni_nombre_original FROM empleados WHERE id = $1',
      [id]
    );
    if (!rows[0] || !rows[0].foto_dni_data) {
      return res.status(404).send('No hay foto de DNI para este empleado');
    }

    const { foto_dni_data, foto_dni_mime, foto_dni_nombre_original } = rows[0];
    res.set('Content-Type', foto_dni_mime || 'application/octet-stream');

    if (req.query.download) {
      const nombreArchivo = foto_dni_nombre_original || `foto-dni-${id}`;
      res.set('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    }

    res.send(foto_dni_data);
  } catch (err) {
    console.error('Error GET /api/personal/:id/foto-dni:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/personal', requirePermiso('empleados'), upload.single('fotoDni'), async (req, res) => {
  const {
    usuario_id,
    nombre,
    dni,
    numero_seguridad_social,
    nacionalidad,
    fecha_nacimiento,
    iban,
    domicilio,
    fecha_in,
    fecha_out,
    horas_alta,
    punto_venta_id,
    email,
    estado,
    enviarGestoria
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'Falta el nombre del empleado' });
  }

  const fotoDniData = req.file ? req.file.buffer : null;
  const fotoDniMime = req.file ? req.file.mimetype : null;
  const fotoDniNombreOriginal = req.file ? req.file.originalname : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO empleados
        (usuario_id, nombre, dni, numero_seguridad_social, nacionalidad, fecha_nacimiento,
         iban, domicilio, fecha_in, fecha_out, horas_alta, punto_venta_id,
         email, foto_dni_data, foto_dni_mime, foto_dni_nombre_original, estado)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, COALESCE($17::boolean, TRUE))
       RETURNING id, nombre, dni, punto_venta_id, fecha_in, fecha_out, estado`,
      [
        usuario_id || null,
        nombre,
        dni || null,
        numero_seguridad_social || null,
        nacionalidad || null,
        fecha_nacimiento || null,
        iban || null,
        domicilio || null,
        fecha_in || null,
        fecha_out || null,
        horas_alta || null,
        punto_venta_id || null,
        email || null,
        fotoDniData,
        fotoDniMime,
        fotoDniNombreOriginal,
        estado
      ]
    );
    const empleadoCreado = rows[0];

    // Si se marcó el checkbox, enviamos el email a la Gestoría (no bloquea la respuesta si falla)
    let gestoriaEnviada = false;
    let gestoriaError = null;
    if (enviarGestoria === 'true') {
      try {
        let puntoVenta = null;
        if (punto_venta_id) {
          const pv = await pool.query('SELECT nombre, direccion FROM puntos_venta WHERE id = $1', [punto_venta_id]);
          puntoVenta = pv.rows[0] || null;
        }

        await enviarEmailGestoria(
          {
            nombre, dni, numero_seguridad_social, nacionalidad, fecha_nacimiento,
            iban, domicilio, fecha_in, fecha_out, horas_alta, email
          },
          puntoVenta,
          req.file
        );
        gestoriaEnviada = true;
      } catch (mailErr) {
        console.error('Error enviando email a la Gestoría:', mailErr.message);
        gestoriaError = mailErr.message;
      }
    }

    res.json({ ...empleadoCreado, gestoria_enviada: gestoriaEnviada, gestoria_error: gestoriaError });
  } catch (err) {
    console.error('Error POST /api/personal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/personal/:id/estado', requirePermiso('empleados'), async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE empleados SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PATCH /api/personal/:id/estado:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Obtener la ficha completa de un empleado (para el modal de Detalle/Editar)
app.get('/api/personal/:id', requirePermiso('empleados'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, usuario_id, nombre, dni, numero_seguridad_social, nacionalidad,
              fecha_nacimiento, iban, domicilio, fecha_in, fecha_out, horas_alta,
              punto_venta_id, email, estado, created_at,
              (foto_dni_data IS NOT NULL) AS tiene_foto_dni
       FROM empleados WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/personal/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Editar un empleado. Si se adjunta un archivo nuevo, sustituye la Foto DNI;
// si no, se conserva la que ya hubiera.
app.put('/api/personal/:id', requirePermiso('empleados'), upload.single('fotoDni'), async (req, res) => {
  const { id } = req.params;
  const {
    usuario_id, nombre, dni, numero_seguridad_social, nacionalidad, fecha_nacimiento,
    iban, domicilio, fecha_in, fecha_out, horas_alta, punto_venta_id, email, estado
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'Falta el nombre del empleado' });
  }

  const camposBase = [
    usuario_id || null, nombre, dni || null, numero_seguridad_social || null, nacionalidad || null,
    fecha_nacimiento || null, iban || null, domicilio || null, fecha_in || null, fecha_out || null,
    horas_alta || null, punto_venta_id || null, email || null, estado
  ];

  try {
    let rows;
    if (req.file) {
      ({ rows } = await pool.query(
        `UPDATE empleados SET
           usuario_id=$1, nombre=$2, dni=$3, numero_seguridad_social=$4, nacionalidad=$5,
           fecha_nacimiento=$6, iban=$7, domicilio=$8, fecha_in=$9, fecha_out=$10,
           horas_alta=$11, punto_venta_id=$12, email=$13, estado=COALESCE($14::boolean, estado),
           foto_dni_data=$15, foto_dni_mime=$16, foto_dni_nombre_original=$17
         WHERE id=$18
         RETURNING id`,
        [...camposBase, req.file.buffer, req.file.mimetype, req.file.originalname, id]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE empleados SET
           usuario_id=$1, nombre=$2, dni=$3, numero_seguridad_social=$4, nacionalidad=$5,
           fecha_nacimiento=$6, iban=$7, domicilio=$8, fecha_in=$9, fecha_out=$10,
           horas_alta=$11, punto_venta_id=$12, email=$13, estado=COALESCE($14::boolean, estado)
         WHERE id=$15
         RETURNING id`,
        [...camposBase, id]
      ));
    }

    if (!rows[0]) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/personal/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar un empleado
app.delete('/api/personal/:id', requirePermiso('empleados'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM empleados WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/personal/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- PROVEEDORES ---

app.get('/api/proveedores', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM proveedores WHERE activo = TRUE ORDER BY nombre_proveedor ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/proveedores:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/proveedores/todos', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM proveedores ORDER BY nombre_proveedor ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/proveedores/todos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/proveedores', requirePermiso('proveedores'), async (req, res) => {
  const {
    nombre_proveedor,
    nombre_comercial,
    cif,
    iban,
    forma_pago,
    ciudad,
    direccion_fiscal,
    telefono,
    email
  } = req.body;

  if (!nombre_proveedor) {
    return res.status(400).json({ error: 'Falta el nombre del proveedor' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO proveedores
        (nombre_proveedor, nombre_comercial, cif, iban, forma_pago, ciudad, direccion_fiscal, telefono, email)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        nombre_proveedor,
        nombre_comercial || null,
        cif || null,
        iban || null,
        forma_pago || null,
        ciudad || null,
        direccion_fiscal || null,
        telefono || null,
        email || null
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/proveedores:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/proveedores/:id/estado', requirePermiso('proveedores'), async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE proveedores SET activo = $1 WHERE id = $2 RETURNING *',
      [activo, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PATCH /api/proveedores/:id/estado:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Obtener un proveedor (para Detalle/Editar)
app.get('/api/proveedores/:id', requirePermiso('proveedores'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM proveedores WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/proveedores/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Editar un proveedor
app.put('/api/proveedores/:id', requirePermiso('proveedores'), async (req, res) => {
  const { id } = req.params;
  const {
    nombre_proveedor, nombre_comercial, cif, iban,
    forma_pago, ciudad, direccion_fiscal, telefono, email
  } = req.body;

  if (!nombre_proveedor) {
    return res.status(400).json({ error: 'Falta el nombre del proveedor' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE proveedores SET
         nombre_proveedor=$1, nombre_comercial=$2, cif=$3, iban=$4,
         forma_pago=$5, ciudad=$6, direccion_fiscal=$7, telefono=$8, email=$9
       WHERE id=$10
       RETURNING *`,
      [
        nombre_proveedor, nombre_comercial || null, cif || null, iban || null,
        forma_pago || null, ciudad || null, direccion_fiscal || null,
        telefono || null, email || null, id
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/proveedores/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar un proveedor
app.delete('/api/proveedores/:id', requirePermiso('proveedores'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM proveedores WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/proveedores/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- INGRESOS ---

// Lista, sin el archivo pesado (solo si tiene comprobante), de más nuevo a más antiguo
app.get('/api/ingresos', requirePermiso('ingresos'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, fecha, importe, punto_venta_id, comprobante_nombre_original, created_at
       FROM ingresos
       ORDER BY fecha DESC, created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/ingresos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Un ingreso completo (para Editar)
app.get('/api/ingresos/:id', requirePermiso('ingresos'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, fecha, importe, punto_venta_id, comprobante_nombre_original,
              (comprobante_data IS NOT NULL) AS tiene_comprobante
       FROM ingresos WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Ingreso no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/ingresos/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Descargar/ver el comprobante
app.get('/api/ingresos/:id/comprobante', requirePermiso('ingresos'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT comprobante_data, comprobante_mime, comprobante_nombre_original FROM ingresos WHERE id = $1',
      [id]
    );
    if (!rows[0] || !rows[0].comprobante_data) {
      return res.status(404).send('No hay comprobante para este ingreso');
    }
    const { comprobante_data, comprobante_mime, comprobante_nombre_original } = rows[0];
    res.set('Content-Type', comprobante_mime || 'application/octet-stream');
    if (req.query.download) {
      res.set('Content-Disposition', `attachment; filename="${comprobante_nombre_original || `comprobante-${id}`}"`);
    }
    res.send(comprobante_data);
  } catch (err) {
    console.error('Error GET /api/ingresos/:id/comprobante:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ingresos', requirePermiso('ingresos'), upload.single('comprobante'), async (req, res) => {
  const { fecha, importe, punto_venta_id } = req.body;

  if (!fecha || !importe || !punto_venta_id || !req.file) {
    return res.status(400).json({ error: 'Fecha, importe, punto de venta y comprobante son obligatorios' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO ingresos
        (fecha, importe, punto_venta_id, comprobante_data, comprobante_mime, comprobante_nombre_original)
       VALUES
        ($1, $2, $3, $4, $5, $6)
       RETURNING id, fecha, importe, punto_venta_id, comprobante_nombre_original`,
      [fecha, importe, punto_venta_id, req.file.buffer, req.file.mimetype, req.file.originalname]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/ingresos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/ingresos/:id', requirePermiso('ingresos'), upload.single('comprobante'), async (req, res) => {
  const { id } = req.params;
  const { fecha, importe, punto_venta_id } = req.body;

  if (!fecha || !importe || !punto_venta_id) {
    return res.status(400).json({ error: 'Fecha, importe y punto de venta son obligatorios' });
  }

  try {
    let rows;
    if (req.file) {
      ({ rows } = await pool.query(
        `UPDATE ingresos SET
           fecha=$1, importe=$2, punto_venta_id=$3,
           comprobante_data=$4, comprobante_mime=$5, comprobante_nombre_original=$6
         WHERE id=$7
         RETURNING id`,
        [fecha, importe, punto_venta_id, req.file.buffer, req.file.mimetype, req.file.originalname, id]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE ingresos SET fecha=$1, importe=$2, punto_venta_id=$3
         WHERE id=$4
         RETURNING id`,
        [fecha, importe, punto_venta_id, id]
      ));
    }
    if (!rows[0]) return res.status(404).json({ error: 'Ingreso no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/ingresos/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ingresos/:id', requirePermiso('ingresos'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM ingresos WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/ingresos/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
