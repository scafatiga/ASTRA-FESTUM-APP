import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Resend } from 'resend';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import AdmZip from 'adm-zip';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
  '/base-punto-venta.html': 'base_punto_venta',
  '/factura-cash.html': 'factura_cash',
  '/productos.html': 'insumos',
  '/albaranes.html': 'albaranes'
};

const PUBLIC_PATHS = new Set(['/login.html', '/login.js', '/nav.css', '/nav.js', '/favicon.ico', '/resetear-password.html', '/resetear-password.js']);

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
    // El administrador tiene acceso a todo automáticamente, sin depender de la
    // rejilla de permisos (incluidas pestañas nuevas que aún no se le hayan marcado).
    if (req.session.usuario.es_admin) {
      return next();
    }
    if (!req.session.usuario.permisos || !req.session.usuario.permisos[tab]) {
      return res.status(403).json({ error: 'No tienes acceso a esta sección' });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.usuario) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (!req.session.usuario.es_admin) {
    return res.status(403).json({ error: 'Solo el administrador puede hacer esto' });
  }
  next();
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
  if (permisoRequerido && !req.session.usuario.es_admin && !req.session.usuario.permisos[permisoRequerido]) {
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
      'SELECT id, nombre, email, permisos, activo, password_hash, es_admin FROM usuarios WHERE email = $1',
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
      permisos: usuario.permisos || {},
      es_admin: !!usuario.es_admin
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

// Cualquier usuario logueado puede cambiar su propia contraseña (necesita la actual)
app.post('/api/cambiar-password', requireAuth, async (req, res) => {
  const { password_actual, password_nueva } = req.body;

  if (!password_actual || !password_nueva) {
    return res.status(400).json({ error: 'Falta la contraseña actual o la nueva' });
  }
  if (password_nueva.length < 8) {
    return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres' });
  }

  try {
    const { rows } = await pool.query('SELECT password_hash FROM usuarios WHERE id = $1', [req.session.usuario.id]);
    if (!rows[0] || !rows[0].password_hash) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const coincide = await bcrypt.compare(password_actual, rows[0].password_hash);
    if (!coincide) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });
    }

    const hash = await bcrypt.hash(password_nueva, 10);
    await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, req.session.usuario.id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('Error POST /api/cambiar-password:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Paso 1: el usuario pide el email de recuperación (sin necesitar sesión iniciada)
app.post('/api/olvide-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Falta el email' });
  }

  // Siempre respondemos igual, exista o no el email, para no revelar qué cuentas existen
  const mensajeGenerico = { ok: true, mensaje: 'Si ese email existe en el sistema, te hemos enviado un correo con las instrucciones.' };

  try {
    const { rows } = await pool.query('SELECT id, nombre, email FROM usuarios WHERE email = $1 AND activo = TRUE', [email]);
    if (!rows[0]) {
      return res.json(mensajeGenerico);
    }
    const usuario = rows[0];

    const token = crypto.randomBytes(32).toString('hex');
    const expiraEn = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await pool.query(
      'INSERT INTO password_reset_tokens (usuario_id, token, expira_en) VALUES ($1, $2, $3)',
      [usuario.id, token, expiraEn.toISOString()]
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const urlReset = `${baseUrl}/resetear-password.html?token=${token}`;

    try {
      await enviarEmailResetPassword(usuario.email, usuario.nombre, urlReset);
    } catch (errEmail) {
      console.error('Error enviando email de recuperación:', errEmail.message);
      // No revelamos el fallo de envío al usuario para no dar pistas; queda en logs del servidor.
    }

    res.json(mensajeGenerico);
  } catch (err) {
    console.error('Error POST /api/olvide-password:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Paso 2: el usuario llega desde el enlace del email y pone la contraseña nueva
app.post('/api/resetear-password', async (req, res) => {
  const { token, password_nueva } = req.body;

  if (!token || !password_nueva) {
    return res.status(400).json({ error: 'Falta el token o la contraseña nueva' });
  }
  if (password_nueva.length < 8) {
    return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, usuario_id, expira_en, usado FROM password_reset_tokens WHERE token = $1',
      [token]
    );
    const registro = rows[0];

    if (!registro || registro.usado || new Date(registro.expira_en) < new Date()) {
      return res.status(400).json({ error: 'Este enlace ya no es válido. Pide uno nuevo desde "¿Olvidaste tu contraseña?".' });
    }

    const hash = await bcrypt.hash(password_nueva, 10);
    await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, registro.usuario_id]);
    await pool.query('UPDATE password_reset_tokens SET usado = TRUE WHERE id = $1', [registro.id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('Error POST /api/resetear-password:', err.message);
    res.status(500).json({ error: err.message });
  }
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

// --- Cloudflare R2 (almacenamiento de archivos: fotos DNI, comprobantes, facturas) ---
let r2Client = null;

function getR2Client() {
  if (r2Client) return r2Client;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Faltan las variables de entorno de R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
  }
  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY
    }
  });
  return r2Client;
}

// Sube un archivo a R2 y devuelve la "key" (ruta) con la que se guarda, para meter en la BD.
async function subirArchivoR2(carpeta, nombreOriginal, buffer, mimetype) {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error('Falta la variable de entorno R2_BUCKET_NAME');

  const extension = (nombreOriginal.split('.').pop() || 'bin').toLowerCase();
  const key = `${carpeta}/${crypto.randomUUID()}.${extension}`;

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimetype
  }));

  return key;
}

// Descarga un archivo de R2 como Buffer, para servirlo igual que antes con res.send()
async function leerArchivoR2(key) {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME;
  const resultado = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const chunk of resultado.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function eliminarArchivoR2(key) {
  if (!key) return;
  try {
    const client = getR2Client();
    const bucket = process.env.R2_BUCKET_NAME;
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    console.error('Error al eliminar archivo de R2:', err.message);
  }
}


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

async function enviarEmailResetPassword(destinatario, nombre, urlReset) {
  const resend = getResendClient();
  const remitente = process.env.RESEND_FROM_EMAIL || 'Astra Festum <onboarding@resend.dev>';

  const cuerpo = `Hola ${nombre || ''},

Recibimos una solicitud para restablecer tu contraseña de Astra Festum.

Pulsa este enlace para crear una contraseña nueva (caduca en 1 hora):
${urlReset}

Si no fuiste tú quien lo pidió, puedes ignorar este correo — tu contraseña actual seguirá funcionando.

Un saludo,
Astra Festum
`;

  const { error } = await resend.emails.send({
    from: remitente,
    to: destinatario,
    subject: 'Restablecer tu contraseña - Astra Festum',
    text: cuerpo
  });
  if (error) {
    throw new Error(error.message || JSON.stringify(error));
  }
}

// --- PUNTOS DE VENTA ---

app.get('/api/puntos-venta', requireAuth, async (req, res) => {
  try {
    // Devuelve TODOS (activos e inactivos): las pantallas necesitan traducir
    // IDs ya guardados a su nombre aunque el punto de venta esté descontinuado.
    // El propio frontend filtra por "activo" al construir los desplegables de alta.
    const { rows } = await pool.query('SELECT * FROM puntos_venta ORDER BY activo DESC, nombre ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/puntos-venta/todos', requirePermiso('puntos_venta'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pv.*, u.nombre AS registrado_por_nombre
       FROM puntos_venta pv
       LEFT JOIN usuarios u ON u.id = pv.registrado_por
       ORDER BY pv.nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Importar Puntos de Venta desde Excel (formato AppSheet) ---
// Evita duplicados: si ya existe un Punto de Venta con el mismo nombre, lo actualiza en vez de crear otro.
function interpretarActivo(valor) {
  const texto = String(valor || '').trim().toUpperCase();
  if (['NO', 'INACTIVO', 'FALSE', '0'].includes(texto)) return false;
  return true; // por defecto activo (incluye "ACTIVO", "SI", "SÍ", vacío, etc.)
}

app.post('/api/puntos-venta/importar-excel', requirePermiso('puntos_venta'), upload.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el archivo Excel' });
  }

  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const primeraHoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: '' });

    if (filas.length === 0) {
      return res.status(400).json({ error: 'El Excel no tiene filas de datos.' });
    }

    let creados = 0;
    let actualizados = 0;
    let omitidos = 0;

    for (const filaOriginal of filas) {
      const fila = normalizarFilaExcel(filaOriginal);

      const nombre = String(obtenerValorPorClave(fila, 'PUNTO DE VENTA')).trim();
      if (!nombre) {
        omitidos++;
        continue;
      }

      const direccion = String(obtenerValorPorClave(fila, 'DIRECCION')).trim() || null;
      const tipoStand = String(obtenerValorPorClave(fila, 'TIPO_STAND')).trim() || null;
      const activo = interpretarActivo(obtenerValorPorClave(fila, 'ESTADO'));

      const existente = await pool.query(
        'SELECT id FROM puntos_venta WHERE LOWER(TRIM(nombre)) = LOWER($1)',
        [nombre]
      );

      if (existente.rows[0]) {
        await pool.query(
          'UPDATE puntos_venta SET direccion=$1, tipo_stand=$2, activo=$3 WHERE id=$4',
          [direccion, tipoStand, activo, existente.rows[0].id]
        );
        actualizados++;
      } else {
        await pool.query(
          'INSERT INTO puntos_venta (nombre, direccion, tipo_stand, activo, registrado_por) VALUES ($1, $2, $3, $4, $5)',
          [nombre, direccion, tipoStand, activo, req.session.usuario.id]
        );
        creados++;
      }
    }

    res.json({ ok: true, total: filas.length, creados, actualizados, omitidos });
  } catch (err) {
    console.error('Error POST /api/puntos-venta/importar-excel:', err.message);
    res.status(500).json({ error: 'No se pudo leer el archivo. Asegúrate de que es un .xlsx válido.' });
  }
});

app.post('/api/puntos-venta', requirePermiso('puntos_venta'), async (req, res) => {
  const { nombre, direccion, tipo_stand, universal } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO puntos_venta (nombre, direccion, tipo_stand, universal, activo, registrado_por) VALUES ($1, $2, $3, $4, TRUE, $5) RETURNING *',
      [nombre, direccion || null, tipo_stand || null, !!universal, req.session.usuario.id]
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

app.get('/api/puntos-venta/:id', requirePermiso('puntos_venta'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM puntos_venta WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Punto de venta no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/puntos-venta/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/puntos-venta/:id', requirePermiso('puntos_venta'), async (req, res) => {
  const { id } = req.params;
  const { nombre, direccion, tipo_stand, universal } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'Falta el nombre del punto de venta' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE puntos_venta SET nombre=$1, direccion=$2, tipo_stand=$3, universal=$4 WHERE id=$5 RETURNING *',
      [nombre, direccion || null, tipo_stand || null, !!universal, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Punto de venta no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/puntos-venta/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/puntos-venta/:id', requirePermiso('puntos_venta'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM puntos_venta WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/puntos-venta/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- CIERRES ---

app.get('/api/cierres', requirePermiso('historico'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, u.nombre AS registrado_por_nombre
       FROM cierres c
       LEFT JOIN usuarios u ON u.id = c.registrado_por
       ORDER BY c.fecha DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/cierres:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Importar Histórico de Cierres desde Excel (formato AppSheet) ---

function normalizarClave(str) {
  return String(str || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizarFilaExcel(fila) {
  const normalizada = {};
  for (const clave of Object.keys(fila)) {
    normalizada[normalizarClave(clave)] = fila[clave];
  }
  return normalizada;
}

function obtenerValorPorClave(filaNormalizada, nombreBuscado) {
  const valor = filaNormalizada[normalizarClave(nombreBuscado)];
  return (valor === undefined || valor === null) ? '' : valor;
}

// La columna de "ruta del archivo" en los Excel de AppSheet a veces no tiene un
// encabezado real (queda en blanco), así que buscamos primero por nombre y,
// si no aparece nada con pinta de ruta, caemos a detectarla por su contenido
// (cualquier columna cuyo valor tenga "/" y termine en una extensión de archivo).
function obtenerValorRutaArchivo(filaNormalizada) {
  const candidatos = ['_', 'RUTA', 'ARCHIVO', 'PATH'];
  for (const clave of candidatos) {
    const valor = obtenerValorPorClave(filaNormalizada, clave);
    if (valor && /\.(pdf|jpe?g|png)$/i.test(String(valor).trim())) {
      return valor;
    }
  }
  // Fallback: recorre todas las columnas de la fila y usa la primera que
  // parezca una ruta de archivo (contiene "/" y termina en una extensión conocida)
  for (const clave of Object.keys(filaNormalizada)) {
    const valor = filaNormalizada[clave];
    if (valor && String(valor).includes('/') && /\.(pdf|jpe?g|png)$/i.test(String(valor).trim())) {
      return valor;
    }
  }
  return '';
}

function parsearImporteExcel(valor) {
  if (valor === undefined || valor === '' || valor === null) return 0;
  const n = parseFloat(String(valor).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function combinarFechaHoraExcel(fechaValor, horaValor) {
  let fecha = null;

  if (fechaValor instanceof Date) {
    fecha = fechaValor;
  } else if (typeof fechaValor === 'string' && fechaValor.trim()) {
    const m = fechaValor.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      fecha = new Date(Number(y), Number(mo) - 1, Number(d));
    }
  } else if (typeof fechaValor === 'number') {
    // número de serie de Excel (días desde 1899-12-30)
    fecha = new Date(Math.round((fechaValor - 25569) * 86400 * 1000));
  }

  if (!fecha || isNaN(fecha.getTime())) return null;

  let horas = 0, minutos = 0, segundos = 0;
  if (horaValor instanceof Date) {
    horas = horaValor.getHours();
    minutos = horaValor.getMinutes();
    segundos = horaValor.getSeconds();
  } else if (typeof horaValor === 'string' && horaValor.trim()) {
    const m = horaValor.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      horas = Number(m[1]);
      minutos = Number(m[2]);
      segundos = Number(m[3] || 0);
    }
  } else if (typeof horaValor === 'number') {
    const totalSegundos = Math.round(horaValor * 24 * 60 * 60);
    horas = Math.floor(totalSegundos / 3600);
    minutos = Math.floor((totalSegundos % 3600) / 60);
    segundos = totalSegundos % 60;
  }

  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), horas, minutos, segundos);
}

app.post(
  '/api/cierres/importar-excel',
  requirePermiso('cierre'),
  upload.fields([{ name: 'excel', maxCount: 1 }, { name: 'zip', maxCount: 1 }]),
  async (req, res) => {
    if (!req.session.usuario.es_admin) {
      return res.status(403).json({ error: 'Solo un administrador puede importar el histórico de cierres' });
    }
    if (!req.files || !req.files.excel || !req.files.excel[0]) {
      return res.status(400).json({ error: 'Falta el archivo Excel' });
    }

    try {
      const libro = XLSX.read(req.files.excel[0].buffer, { type: 'buffer', cellDates: true });
      const primeraHoja = libro.Sheets[libro.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: '' });

      if (filas.length === 0) {
        return res.status(400).json({ error: 'El Excel no tiene filas de datos.' });
      }

      let entradasZip = [];
      if (req.files.zip && req.files.zip[0]) {
        const zip = new AdmZip(req.files.zip[0].buffer);
        entradasZip = zip.getEntries()
          .filter(e => !e.isDirectory)
          .map(e => ({ rutaNormalizada: normalizarRutaArchivo(e.entryName), entrada: e }));
      }

      function buscarArchivoZip(rutaExcel) {
        if (!rutaExcel || entradasZip.length === 0) return null;
        const rutaNorm = normalizarRutaArchivo(rutaExcel);
        let encontrado = entradasZip.find(e => e.rutaNormalizada.endsWith(rutaNorm));
        if (!encontrado) encontrado = entradasZip.find(e => rutaNorm.endsWith(e.rutaNormalizada));
        if (!encontrado) {
          const nombreArchivo = rutaNorm.split('/').pop();
          encontrado = entradasZip.find(e => e.rutaNormalizada.split('/').pop() === nombreArchivo);
        }
        return encontrado ? encontrado.entrada : null;
      }

      async function subirSiExiste(rutaExcel, carpeta) {
        const archivo = buscarArchivoZip(rutaExcel);
        if (!archivo) return { r2Key: null, mime: null };
        const nombreArchivo = archivo.entryName.split('/').pop();
        const mime = mimePorExtensionGenerico(nombreArchivo);
        if (!mime) return { r2Key: null, mime: null };
        try {
          const buffer = archivo.getData();
          const r2Key = await subirArchivoR2(carpeta, nombreArchivo, buffer, mime);
          return { r2Key, mime };
        } catch (errR2) {
          console.error('Error subiendo archivo de Cierre a R2:', errR2.message);
          return { r2Key: null, mime: null };
        }
      }

      const { rows: usuariosDb } = await pool.query('SELECT id, nombre, email FROM usuarios');
      function buscarUsuarioId(nombreOEmail) {
        if (!nombreOEmail) return null;
        const texto = String(nombreOEmail).trim().toLowerCase();
        const encontrado = usuariosDb.find(u =>
          (u.nombre || '').trim().toLowerCase() === texto ||
          (u.email || '').trim().toLowerCase() === texto
        );
        return encontrado ? encontrado.id : null;
      }

      let creados = 0;
      let omitidos = 0;
      let conTicket = 0;
      let conComprobanteGeneral = 0;
      const erroresFilas = [];

      for (let i = 0; i < filas.length; i++) {
        const fila = normalizarFilaExcel(filas[i]);

        const puntoVenta = obtenerValorPorClave(fila, 'PUNTO DE VENTA');
        const fechaValor = obtenerValorPorClave(fila, 'FECHA');
        const horaValor = obtenerValorPorClave(fila, 'HORA');

        if (!puntoVenta || !fechaValor) {
          omitidos++;
          continue;
        }

        const fechaCompleta = combinarFechaHoraExcel(fechaValor, horaValor) || new Date();

        const totalTarjeta = parsearImporteEuropeo(obtenerValorPorClave(fila, 'VENTA TARJETA'));
        const totalEfectivo = parsearImporteEuropeo(obtenerValorPorClave(fila, 'VENTA EFECTIVO'));

        const gastos = [];
        for (let g = 1; g <= 5; g++) {
          const descripcion = obtenerValorPorClave(fila, `CENTRO DE COSTO ${g}`);
          const importe = parsearImporteEuropeo(obtenerValorPorClave(fila, `IMPORTE GASTO ${g}`));
          if (descripcion && importe > 0) {
            const rutaTicket = obtenerValorPorClave(fila, `FOTO TICKET ${g}`);
            const { r2Key, mime } = await subirSiExiste(rutaTicket, 'cierres/ticket-gasto');
            if (r2Key) conTicket++;
            gastos.push({
              descripcion: String(descripcion).trim(),
              importe,
              punto_venta: String(puntoVenta).trim(),
              foto_r2_key: r2Key,
              foto_mime: mime
            });
          }
        }

        const adelantos = [];
        for (let p = 1; p <= 4; p++) {
          const empleado = obtenerValorPorClave(fila, `PAGO ${p}: EMPLEADO`);
          const importe = parsearImporteEuropeo(obtenerValorPorClave(fila, `PAGO ${p}: IMPORTE`));
          const pvPago = obtenerValorPorClave(fila, `PUNTO DE VENTA PAGO ${p}`) || puntoVenta;
          if (empleado && importe > 0) {
            adelantos.push({ empleado: String(empleado).trim(), importe, punto_venta: String(pvPago).trim() });
          }
        }

        const obsGastos = obtenerValorPorClave(fila, 'OBSERVACIONES GASTOS');
        const obsPagos = obtenerValorPorClave(fila, 'OBSERVACIONES PAGOS EMPLEADOS');
        const observaciones = [obsGastos, obsPagos].filter(Boolean).map(String).join(' | ');

        const usuarioId = buscarUsuarioId(obtenerValorPorClave(fila, 'USUARIO'));

        const rutaComprobanteGeneral = obtenerValorPorClave(fila, 'SUBIR ARCHIVO');
        const { r2Key: comprobanteGeneralR2Key, mime: comprobanteGeneralMime } = await subirSiExiste(rutaComprobanteGeneral, 'cierres/comprobante-general');
        if (comprobanteGeneralR2Key) conComprobanteGeneral++;

        try {
          await pool.query(
            `INSERT INTO cierres (fecha, punto_venta, total_efectivo, total_tarjeta, observaciones, gastos, adelantos, registrado_por, comprobante_general_r2_key, comprobante_general_mime)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)`,
            [
              fechaCompleta.toISOString(),
              String(puntoVenta).trim(),
              totalEfectivo,
              totalTarjeta,
              observaciones,
              JSON.stringify(gastos),
              JSON.stringify(adelantos),
              usuarioId,
              comprobanteGeneralR2Key,
              comprobanteGeneralMime
            ]
          );
          creados++;
        } catch (errFila) {
          erroresFilas.push({ fila: i + 2, error: errFila.message });
        }
      }

      res.json({
        ok: true,
        total: filas.length,
        creados,
        omitidos,
        conTicket,
        conComprobanteGeneral,
        errores: erroresFilas.length,
        detalleErrores: erroresFilas.slice(0, 10)
      });
    } catch (err) {
      console.error('Error POST /api/cierres/importar-excel:', err.message);
      res.status(500).json({ error: 'No se pudo leer el archivo. Asegúrate de que el Excel y el ZIP son válidos.' });
    }
  }
);

app.post('/api/cierres', requirePermiso('cierre'), upload.any(), async (req, res) => {
  let datos;
  try {
    datos = req.body.datos ? JSON.parse(req.body.datos) : req.body;
  } catch (err) {
    return res.status(400).json({ error: 'Datos del cierre mal formados' });
  }

  const {
    fecha,
    punto_venta,
    total_efectivo,
    total_tarjeta,
    observaciones,
    gastos,
    adelantos
  } = datos;

  // Validación básica: sin punto_venta no tiene sentido guardar el cierre
  if (!punto_venta) {
    return res.status(400).json({ error: 'Falta punto_venta en la petición' });
  }

  const gastosArray = Array.isArray(gastos) ? gastos : [];
  const adelantosArray = Array.isArray(adelantos) ? adelantos : [];
  const archivos = req.files || [];

  // Sube la foto de ticket de cada gasto (si el usuario adjuntó alguna)
  for (let i = 0; i < gastosArray.length; i++) {
    const archivo = archivos.find(f => f.fieldname === `fotoGasto_${i}`);
    if (archivo) {
      try {
        const r2Key = await subirArchivoR2('cierres/ticket-gasto', archivo.originalname, archivo.buffer, archivo.mimetype);
        gastosArray[i].foto_r2_key = r2Key;
        gastosArray[i].foto_mime = archivo.mimetype;
      } catch (errR2) {
        console.error('Error subiendo foto de ticket a R2:', errR2.message);
      }
    }
  }

  // Comprobante general del cierre (si se adjuntó)
  let comprobanteGeneralR2Key = null;
  let comprobanteGeneralMime = null;
  const archivoGeneral = archivos.find(f => f.fieldname === 'comprobanteGeneral');
  if (archivoGeneral) {
    try {
      comprobanteGeneralR2Key = await subirArchivoR2('cierres/comprobante-general', archivoGeneral.originalname, archivoGeneral.buffer, archivoGeneral.mimetype);
      comprobanteGeneralMime = archivoGeneral.mimetype;
    } catch (errR2) {
      console.error('Error subiendo comprobante general a R2:', errR2.message);
    }
  }

  const gastosJson = JSON.stringify(gastosArray);
  const adelantosJson = JSON.stringify(adelantosArray);

  try {
    const { rows } = await pool.query(
      `INSERT INTO cierres
        (fecha, punto_venta, total_efectivo, total_tarjeta, observaciones, gastos, adelantos, registrado_por, comprobante_general_r2_key, comprobante_general_mime)
       VALUES
        (COALESCE($1, NOW()), $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
       RETURNING *`,
      [
        fecha || null,
        punto_venta,
        total_efectivo || 0,
        total_tarjeta || 0,
        observaciones || '',
        gastosJson,
        adelantosJson,
        req.session.usuario.id,
        comprobanteGeneralR2Key,
        comprobanteGeneralMime
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/cierres:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sirve la foto de ticket de un gasto concreto dentro de un cierre
app.get('/api/cierres/:id/gasto-ticket/:indice', requirePermiso('cierre'), async (req, res) => {
  const { id, indice } = req.params;
  try {
    const { rows } = await pool.query('SELECT gastos FROM cierres WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Cierre no encontrado' });

    const gastos = rows[0].gastos || [];
    const gasto = gastos[Number(indice)];
    if (!gasto || !gasto.foto_r2_key) {
      return res.status(404).send('No hay foto de ticket para ese gasto');
    }

    const datosArchivo = await leerArchivoR2(gasto.foto_r2_key);
    res.set('Content-Type', gasto.foto_mime || 'application/octet-stream');
    if (req.query.download) {
      res.set('Content-Disposition', `attachment; filename="ticket-${id.slice(0, 8)}-${indice}"`);
    }
    res.send(datosArchivo);
  } catch (err) {
    console.error('Error GET /api/cierres/:id/gasto-ticket/:indice:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sirve el comprobante general de un cierre
app.get('/api/cierres/:id/comprobante-general', requirePermiso('cierre'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT comprobante_general_r2_key, comprobante_general_mime FROM cierres WHERE id = $1',
      [id]
    );
    if (!rows[0] || !rows[0].comprobante_general_r2_key) {
      return res.status(404).send('No hay comprobante general para este cierre');
    }
    const datosArchivo = await leerArchivoR2(rows[0].comprobante_general_r2_key);
    res.set('Content-Type', rows[0].comprobante_general_mime || 'application/octet-stream');
    if (req.query.download) {
      res.set('Content-Disposition', `attachment; filename="comprobante-${id.slice(0, 8)}"`);
    }
    res.send(datosArchivo);
  } catch (err) {
    console.error('Error GET /api/cierres/:id/comprobante-general:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Detalle / Editar / Eliminar un cierre — SOLO el administrador (no requiere permiso "cierre"
// ni "historico" adicional: es_admin es la única puerta para estas 3 acciones)
app.get('/api/cierres/:id', requirePermiso('historico'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT c.*, u.nombre AS registrado_por_nombre
       FROM cierres c
       LEFT JOIN usuarios u ON u.id = c.registrado_por
       WHERE c.id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cierre no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/cierres/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/cierres/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { fecha, punto_venta, total_efectivo, total_tarjeta, observaciones } = req.body;

  if (!punto_venta) {
    return res.status(400).json({ error: 'Falta punto_venta en la petición' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE cierres SET
         fecha = COALESCE($1, fecha), punto_venta = $2,
         total_efectivo = $3, total_tarjeta = $4, observaciones = $5
       WHERE id = $6
       RETURNING *`,
      [fecha || null, punto_venta, total_efectivo || 0, total_tarjeta || 0, observaciones || '', id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cierre no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/cierres/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cierres/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM cierres WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/cierres/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- USUARIOS / EMPLEADOS (cuentas de acceso, tabla "usuarios") ---

// La gestión de acceso (login + permisos) ahora vive dentro del alta/edición de Empleados,
// no como pestaña separada. Ver /api/personal más abajo.

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

// Crea o actualiza la cuenta de acceso (tabla usuarios) ligada a un empleado.
// Devuelve el usuario_id resultante (o null si no debe tener acceso).
async function gestionarAccesoEmpleado({ usuarioIdExistente, nombre, email, password, permisosJson, darAcceso, creadorId, sessionUsuarioId }) {
  const esUnoMismo = usuarioIdExistente && sessionUsuarioId && String(usuarioIdExistente) === String(sessionUsuarioId);

  if (darAcceso !== 'true') {
    if (usuarioIdExistente) {
      if (esUnoMismo) {
        throw new Error('No puedes quitarte el acceso a ti mismo');
      }
      await pool.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [usuarioIdExistente]);
    }
    return usuarioIdExistente || null;
  }

  const permisosObj = permisosJson ? JSON.parse(permisosJson) : {};

  if (esUnoMismo && permisosObj.empleados !== true) {
    throw new Error('No puedes quitarte a ti mismo el acceso a Empleados');
  }

  try {
    if (usuarioIdExistente) {
      if (password) {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
          'UPDATE usuarios SET nombre=$1, email=$2, permisos=$3::jsonb, activo=TRUE, password_hash=$4 WHERE id=$5',
          [nombre, email, JSON.stringify(permisosObj), hash, usuarioIdExistente]
        );
      } else {
        await pool.query(
          'UPDATE usuarios SET nombre=$1, email=$2, permisos=$3::jsonb, activo=TRUE WHERE id=$4',
          [nombre, email, JSON.stringify(permisosObj), usuarioIdExistente]
        );
      }
      return usuarioIdExistente;
    } else {
      if (!password || password.length < 8) {
        throw new Error('La contraseña debe tener al menos 8 caracteres');
      }
      const hash = await bcrypt.hash(password, 10);
      const nuevoId = crypto.randomUUID(); // generado aquí por si la BD no tiene DEFAULT en id
      const { rows } = await pool.query(
        `INSERT INTO usuarios (id, empresa_id, nombre, email, password_hash, permisos, activo)
         VALUES ($1, (SELECT empresa_id FROM usuarios WHERE id = $2), $3, $4, $5, $6::jsonb, TRUE)
         RETURNING id`,
        [nuevoId, creadorId, nombre, email, hash, JSON.stringify(permisosObj)]
      );
      return rows[0].id;
    }
  } catch (err) {
    if (err.code === '23505') {
      throw new Error('Ya existe un usuario con ese email de acceso');
    }
    throw err;
  }
}

app.get('/api/personal', requirePermiso('empleados'), async (req, res) => {
  try {
    // No traemos foto_dni_data (puede pesar varios MB) en la lista, solo si existe o no
    const { rows } = await pool.query(
      `SELECT e.id, e.usuario_id, e.nombre, e.dni, e.numero_seguridad_social, e.nacionalidad,
              e.fecha_nacimiento, e.iban, e.domicilio, e.fecha_in, e.fecha_out, e.horas_alta,
              e.punto_venta_id, e.email, e.estado, e.created_at,
              (e.foto_dni_data IS NOT NULL) AS tiene_foto_dni,
              (e.usuario_id IS NOT NULL AND u.activo) AS tiene_acceso,
              creador.nombre AS registrado_por_nombre
       FROM empleados e
       LEFT JOIN usuarios u ON u.id = e.usuario_id
       LEFT JOIN usuarios creador ON creador.id = e.registrado_por
       ORDER BY e.nombre ASC`
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
      'SELECT foto_dni_data, foto_dni_mime, foto_dni_nombre_original, foto_dni_r2_key FROM empleados WHERE id = $1',
      [id]
    );
    if (!rows[0] || (!rows[0].foto_dni_data && !rows[0].foto_dni_r2_key)) {
      return res.status(404).send('No hay foto de DNI para este empleado');
    }

    const { foto_dni_data, foto_dni_mime, foto_dni_nombre_original, foto_dni_r2_key } = rows[0];
    const datosArchivo = foto_dni_r2_key ? await leerArchivoR2(foto_dni_r2_key) : foto_dni_data;

    res.set('Content-Type', foto_dni_mime || 'application/octet-stream');

    if (req.query.download) {
      const nombreArchivo = foto_dni_nombre_original || `foto-dni-${id}`;
      res.set('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    }

    res.send(datosArchivo);
  } catch (err) {
    console.error('Error GET /api/personal/:id/foto-dni:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Importar Empleados desde Excel (formato AppSheet) ---
// Evita duplicados por DNI. No migra accesos/permisos ni foto de DNI (por seguridad,
// eso se activa a mano desde la ficha de cada empleado si hace falta).
function parsearFechaSoloExcel(valor) {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'string' && valor.trim()) {
    const m = valor.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      const fecha = new Date(Number(y), Number(mo) - 1, Number(d));
      if (!isNaN(fecha.getTime())) return fecha.toISOString().slice(0, 10);
    }
  }
  if (typeof valor === 'number' && valor > 0) {
    const fecha = new Date(Math.round((valor - 25569) * 86400 * 1000));
    if (!isNaN(fecha.getTime())) return fecha.toISOString().slice(0, 10);
  }
  return null;
}

app.post('/api/personal/importar-excel', requirePermiso('empleados'), upload.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el archivo Excel' });
  }

  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const primeraHoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: '' });

    if (filas.length === 0) {
      return res.status(400).json({ error: 'El Excel no tiene filas de datos.' });
    }

    const { rows: puntosVentaDb } = await pool.query('SELECT id, nombre FROM puntos_venta');
    function buscarPuntoVentaId(nombre) {
      if (!nombre) return null;
      const texto = String(nombre).trim().toLowerCase();
      const encontrado = puntosVentaDb.find(pv => (pv.nombre || '').trim().toLowerCase() === texto);
      return encontrado ? encontrado.id : null;
    }

    let creados = 0;
    let actualizados = 0;
    let omitidos = 0;
    let sinPuntoVenta = 0;

    for (const filaOriginal of filas) {
      const fila = normalizarFilaExcel(filaOriginal);

      const nombre = String(obtenerValorPorClave(fila, 'NOMBRE')).trim();
      if (!nombre) {
        omitidos++;
        continue;
      }

      const dni = String(obtenerValorPorClave(fila, 'DNI')).trim() || null;
      const numeroSegSocial = String(obtenerValorPorClave(fila, 'Nº SEG. SOCIAL')).trim() || null;
      const nacionalidad = String(obtenerValorPorClave(fila, 'NACIONALIDAD')).trim() || null;
      const fechaNacimiento = parsearFechaSoloExcel(obtenerValorPorClave(fila, 'FECHA DE NACIMIENTO'));
      const iban = String(obtenerValorPorClave(fila, 'IBAN')).trim() || null;
      const domicilio = String(obtenerValorPorClave(fila, 'DOMICILIO')).trim() || String(obtenerValorPorClave(fila, 'DIRECCION')).trim() || null;
      const fechaIn = parsearFechaSoloExcel(obtenerValorPorClave(fila, 'FECHA IN'));
      const fechaOut = parsearFechaSoloExcel(obtenerValorPorClave(fila, 'FECHA OUT'));
      const horasAltaValor = obtenerValorPorClave(fila, 'HORAS ALTA');
      const horasAlta = horasAltaValor === '' ? null : parsearImporteExcel(horasAltaValor);
      const email = String(obtenerValorPorClave(fila, 'EMAIL')).trim().toLowerCase() || null;
      const estado = interpretarActivo(obtenerValorPorClave(fila, 'ESTADO'));

      const nombrePuntoVenta = obtenerValorPorClave(fila, 'PUNTO DE VENTA');
      const puntoVentaId = buscarPuntoVentaId(nombrePuntoVenta);
      if (nombrePuntoVenta && !puntoVentaId) sinPuntoVenta++;

      const existente = dni
        ? await pool.query('SELECT id FROM empleados WHERE LOWER(TRIM(dni)) = LOWER($1)', [dni])
        : { rows: [] };

      if (existente.rows[0]) {
        await pool.query(
          `UPDATE empleados SET
             nombre=$1, numero_seguridad_social=$2, nacionalidad=$3, fecha_nacimiento=$4,
             iban=$5, domicilio=$6, fecha_in=$7, fecha_out=$8, horas_alta=$9,
             punto_venta_id=$10, email=$11, estado=$12
           WHERE id=$13`,
          [nombre, numeroSegSocial, nacionalidad, fechaNacimiento, iban, domicilio, fechaIn, fechaOut,
           horasAlta, puntoVentaId, email, estado, existente.rows[0].id]
        );
        actualizados++;
      } else {
        await pool.query(
          `INSERT INTO empleados
            (nombre, dni, numero_seguridad_social, nacionalidad, fecha_nacimiento, iban, domicilio,
             fecha_in, fecha_out, horas_alta, punto_venta_id, email, estado, registrado_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [nombre, dni, numeroSegSocial, nacionalidad, fechaNacimiento, iban, domicilio,
           fechaIn, fechaOut, horasAlta, puntoVentaId, email, estado, req.session.usuario.id]
        );
        creados++;
      }
    }

    res.json({ ok: true, total: filas.length, creados, actualizados, omitidos, sinPuntoVenta });
  } catch (err) {
    console.error('Error POST /api/personal/importar-excel:', err.message);
    res.status(500).json({ error: 'No se pudo leer el archivo. Asegúrate de que es un .xlsx válido.' });
  }
});

// --- Importar fotos de DNI en lote desde un ZIP ---
// Cada archivo dentro del ZIP debe llevar en el nombre el DNI y/o el nombre del empleado.
app.post('/api/personal/importar-fotos-zip', requirePermiso('empleados'), upload.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el archivo ZIP' });
  }

  try {
    const zip = new AdmZip(req.file.buffer);
    const entradas = zip.getEntries().filter(e => !e.isDirectory);

    const { rows: empleadosDb } = await pool.query('SELECT id, nombre, dni FROM empleados');

    function extraerDni(nombreArchivo) {
      const m = nombreArchivo.match(/\b(\d{8}[A-Za-z]|[XYZxyz]\d{7}[A-Za-z])\b/);
      return m ? m[1].toUpperCase() : null;
    }

    function buscarEmpleado(nombreArchivo, dniExtraido) {
      if (dniExtraido) {
        const porDni = empleadosDb.find(e => (e.dni || '').trim().toUpperCase() === dniExtraido);
        if (porDni) return porDni;
      }
      // Respaldo: busca por nombre dentro del nombre del archivo (sin extensión ni DNI)
      const base = nombreArchivo.replace(/\.[^.]+$/, '');
      const limpio = base
        .replace(dniExtraido || '', '')
        .replace(/[_\-]+/g, ' ')
        .trim()
        .toLowerCase();
      if (!limpio) return null;

      const porNombre = empleadosDb.find(e => {
        const nombreEmp = (e.nombre || '').trim().toLowerCase();
        return nombreEmp && (limpio.includes(nombreEmp) || nombreEmp.includes(limpio));
      });
      return porNombre || null;
    }

    function mimePorExtension(nombreArchivo) {
      const ext = nombreArchivo.split('.').pop().toLowerCase();
      if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
      if (ext === 'png') return 'image/png';
      if (ext === 'pdf') return 'application/pdf';
      return null;
    }

    let asignados = 0;
    let ignorados = 0;
    const noEncontrados = [];

    for (const entrada of entradas) {
      const nombreArchivo = entrada.entryName.split('/').pop();
      const mime = mimePorExtension(nombreArchivo);
      if (!mime) {
        ignorados++;
        continue;
      }

      const dniExtraido = extraerDni(nombreArchivo);
      const empleado = buscarEmpleado(nombreArchivo, dniExtraido);

      if (!empleado) {
        noEncontrados.push(nombreArchivo);
        continue;
      }

      await pool.query(
        'UPDATE empleados SET foto_dni_data=$1, foto_dni_mime=$2, foto_dni_nombre_original=$3 WHERE id=$4',
        [entrada.getData(), mime, nombreArchivo, empleado.id]
      );
      asignados++;
    }

    res.json({ ok: true, total: entradas.length, asignados, ignorados, noEncontrados });
  } catch (err) {
    console.error('Error POST /api/personal/importar-fotos-zip:', err.message);
    res.status(500).json({ error: 'No se pudo leer el archivo ZIP. Asegúrate de que es un .zip válido.' });
  }
});

app.post('/api/personal', requirePermiso('empleados'), upload.single('fotoDni'), async (req, res) => {
  const {
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
    enviarGestoria,
    darAcceso,
    password,
    permisos
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'Falta el nombre del empleado' });
  }
  if (darAcceso === 'true' && !email) {
    return res.status(400).json({ error: 'El email es obligatorio para dar acceso al sistema' });
  }

  const fotoDniMime = req.file ? req.file.mimetype : null;
  const fotoDniNombreOriginal = req.file ? req.file.originalname : null;
  let fotoDniR2Key = null;

  try {
    if (req.file) {
      fotoDniR2Key = await subirArchivoR2('empleados/foto-dni', req.file.originalname, req.file.buffer, req.file.mimetype);
    }

    let usuarioId = null;
    try {
      usuarioId = await gestionarAccesoEmpleado({
        usuarioIdExistente: null,
        nombre,
        email: email ? email.trim().toLowerCase() : null,
        password,
        permisosJson: permisos,
        darAcceso,
        creadorId: req.session.usuario.id,
        sessionUsuarioId: req.session.usuario.id
      });
    } catch (accesoErr) {
      return res.status(400).json({ error: accesoErr.message });
    }

    const { rows } = await pool.query(
      `INSERT INTO empleados
        (usuario_id, nombre, dni, numero_seguridad_social, nacionalidad, fecha_nacimiento,
         iban, domicilio, fecha_in, fecha_out, horas_alta, punto_venta_id,
         email, foto_dni_data, foto_dni_mime, foto_dni_nombre_original, foto_dni_r2_key, estado, registrado_por)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, COALESCE($18::boolean, TRUE), $19)
       RETURNING id, nombre, dni, punto_venta_id, fecha_in, fecha_out, estado`,
      [
        usuarioId,
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
        null,
        fotoDniMime,
        fotoDniNombreOriginal,
        fotoDniR2Key,
        estado,
        req.session.usuario.id
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
      `SELECT e.id, e.usuario_id, e.nombre, e.dni, e.numero_seguridad_social, e.nacionalidad,
              e.fecha_nacimiento, e.iban, e.domicilio, e.fecha_in, e.fecha_out, e.horas_alta,
              e.punto_venta_id, e.email, e.estado, e.created_at,
              (e.foto_dni_data IS NOT NULL) AS tiene_foto_dni,
              (e.usuario_id IS NOT NULL AND u.activo) AS tiene_acceso,
              u.permisos AS permisos_acceso,
              creador.nombre AS registrado_por_nombre
       FROM empleados e
       LEFT JOIN usuarios u ON u.id = e.usuario_id
       LEFT JOIN usuarios creador ON creador.id = e.registrado_por
       WHERE e.id = $1`,
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
// si no, se conserva la que ya hubiera. También crea/actualiza/revoca el acceso al sistema.
app.put('/api/personal/:id', requirePermiso('empleados'), upload.single('fotoDni'), async (req, res) => {
  const { id } = req.params;
  const {
    nombre, dni, numero_seguridad_social, nacionalidad, fecha_nacimiento,
    iban, domicilio, fecha_in, fecha_out, horas_alta, punto_venta_id, email, estado,
    darAcceso, password, permisos
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'Falta el nombre del empleado' });
  }
  if (darAcceso === 'true' && !email) {
    return res.status(400).json({ error: 'El email es obligatorio para dar acceso al sistema' });
  }

  try {
    const actual = await pool.query('SELECT usuario_id FROM empleados WHERE id = $1', [id]);
    if (!actual.rows[0]) return res.status(404).json({ error: 'Empleado no encontrado' });
    const usuarioIdExistente = actual.rows[0].usuario_id;

    let usuarioId;
    try {
      usuarioId = await gestionarAccesoEmpleado({
        usuarioIdExistente,
        nombre,
        email: email ? email.trim().toLowerCase() : null,
        password,
        permisosJson: permisos,
        darAcceso,
        creadorId: req.session.usuario.id,
        sessionUsuarioId: req.session.usuario.id
      });
    } catch (accesoErr) {
      return res.status(400).json({ error: accesoErr.message });
    }

    const camposBase = [
      usuarioId, nombre, dni || null, numero_seguridad_social || null, nacionalidad || null,
      fecha_nacimiento || null, iban || null, domicilio || null, fecha_in || null, fecha_out || null,
      horas_alta || null, punto_venta_id || null, email || null, estado
    ];

    let rows;
    if (req.file) {
      const nuevaR2Key = await subirArchivoR2('empleados/foto-dni', req.file.originalname, req.file.buffer, req.file.mimetype);
      ({ rows } = await pool.query(
        `UPDATE empleados SET
           usuario_id=$1, nombre=$2, dni=$3, numero_seguridad_social=$4, nacionalidad=$5,
           fecha_nacimiento=$6, iban=$7, domicilio=$8, fecha_in=$9, fecha_out=$10,
           horas_alta=$11, punto_venta_id=$12, email=$13, estado=COALESCE($14::boolean, estado),
           foto_dni_data=NULL, foto_dni_mime=$15, foto_dni_nombre_original=$16, foto_dni_r2_key=$17
         WHERE id=$18
         RETURNING id`,
        [...camposBase, req.file.mimetype, req.file.originalname, nuevaR2Key, id]
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

    // Si te has editado el acceso a ti mismo, refresca la sesión activa con tus nuevos datos
    if (usuarioId && String(usuarioId) === String(req.session.usuario.id)) {
      req.session.usuario.nombre = nombre;
      req.session.usuario.email = email ? email.trim().toLowerCase() : req.session.usuario.email;
      if (permisos) req.session.usuario.permisos = JSON.parse(permisos);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/personal/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar un empleado (y desactivar su acceso al sistema si lo tenía)
app.delete('/api/personal/:id', requirePermiso('empleados'), async (req, res) => {
  const { id } = req.params;
  try {
    const actual = await pool.query('SELECT usuario_id FROM empleados WHERE id = $1', [id]);
    const usuarioId = actual.rows[0] ? actual.rows[0].usuario_id : null;

    if (usuarioId && String(usuarioId) === String(req.session.usuario.id)) {
      return res.status(400).json({ error: 'No puedes eliminar tu propio empleado/usuario' });
    }

    await pool.query('DELETE FROM empleados WHERE id = $1', [id]);
    if (usuarioId) {
      await pool.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [usuarioId]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/personal/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- PROVEEDORES ---

// Lista ligera de proveedores (solo id + nombre), disponible para cualquier usuario logueado
// -- la usan formularios de otras pestañas (Gastos Tarjeta, etc.) para el desplegable,
// sin necesitar el permiso completo de gestión de Proveedores.
app.get('/api/proveedores-dropdown', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre_proveedor FROM proveedores WHERE activo = TRUE ORDER BY nombre_proveedor ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/proveedores-dropdown:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/proveedores', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.nombre AS registrado_por_nombre
       FROM proveedores p
       LEFT JOIN usuarios u ON u.id = p.registrado_por
       WHERE p.activo = TRUE ORDER BY p.nombre_proveedor ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/proveedores:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/proveedores/todos', requirePermiso('proveedores'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.nombre AS registrado_por_nombre
       FROM proveedores p
       LEFT JOIN usuarios u ON u.id = p.registrado_por
       ORDER BY p.nombre_proveedor ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/proveedores/todos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Importar Proveedores desde Excel (formato AppSheet) ---
// Evita duplicados por CIF: si ya existe, actualiza en vez de crear otro.
app.post('/api/proveedores/importar-excel', requirePermiso('proveedores'), upload.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el archivo Excel' });
  }

  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const primeraHoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: '' });

    if (filas.length === 0) {
      return res.status(400).json({ error: 'El Excel no tiene filas de datos.' });
    }

    let creados = 0;
    let actualizados = 0;
    let omitidos = 0;

    for (const filaOriginal of filas) {
      const fila = normalizarFilaExcel(filaOriginal);

      const nombreProveedor = String(obtenerValorPorClave(fila, 'NOMBRE_PROVEEDOR')).trim();
      if (!nombreProveedor) {
        omitidos++;
        continue;
      }

      const nombreComercial = String(obtenerValorPorClave(fila, 'NOMBRE_COMERCIAL')).trim() || null;
      const cif = String(obtenerValorPorClave(fila, 'CIF')).trim() || null;
      const iban = String(obtenerValorPorClave(fila, 'IBAN')).trim() || null;
      const formaPago = String(obtenerValorPorClave(fila, 'FORMA_PAGO')).trim() || null;
      const ciudad = String(obtenerValorPorClave(fila, 'CIUDAD')).trim() || null;
      const direccionFiscal = String(obtenerValorPorClave(fila, 'DIRECCION FISCAL')).trim() || null;
      const telefono = String(obtenerValorPorClave(fila, 'TELEFONO')).trim() || null;
      const email = String(obtenerValorPorClave(fila, 'EMAIL')).trim().toLowerCase() || null;

      const existente = cif
        ? await pool.query('SELECT id FROM proveedores WHERE LOWER(TRIM(cif)) = LOWER($1)', [cif])
        : { rows: [] };

      if (existente.rows[0]) {
        await pool.query(
          `UPDATE proveedores SET
             nombre_proveedor=$1, nombre_comercial=$2, iban=$3, forma_pago=$4,
             ciudad=$5, direccion_fiscal=$6, telefono=$7, email=$8
           WHERE id=$9`,
          [nombreProveedor, nombreComercial, iban, formaPago, ciudad, direccionFiscal, telefono, email, existente.rows[0].id]
        );
        actualizados++;
      } else {
        await pool.query(
          `INSERT INTO proveedores
            (nombre_proveedor, nombre_comercial, cif, iban, forma_pago, ciudad, direccion_fiscal, telefono, email, registrado_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [nombreProveedor, nombreComercial, cif, iban, formaPago, ciudad, direccionFiscal, telefono, email, req.session.usuario.id]
        );
        creados++;
      }
    }

    res.json({ ok: true, total: filas.length, creados, actualizados, omitidos });
  } catch (err) {
    console.error('Error POST /api/proveedores/importar-excel:', err.message);
    res.status(500).json({ error: 'No se pudo leer el archivo. Asegúrate de que es un .xlsx válido.' });
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
        (nombre_proveedor, nombre_comercial, cif, iban, forma_pago, ciudad, direccion_fiscal, telefono, email, registrado_por)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        email || null,
        req.session.usuario.id
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
      `SELECT i.id, i.fecha, i.importe, i.punto_venta_id, i.comprobante_nombre_original, i.created_at,
              u.nombre AS registrado_por_nombre
       FROM ingresos i
       LEFT JOIN usuarios u ON u.id = i.registrado_por
       ORDER BY i.fecha DESC, i.created_at DESC`
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
      'SELECT comprobante_data, comprobante_mime, comprobante_nombre_original, comprobante_r2_key FROM ingresos WHERE id = $1',
      [id]
    );
    if (!rows[0] || (!rows[0].comprobante_data && !rows[0].comprobante_r2_key)) {
      return res.status(404).send('No hay comprobante para este ingreso');
    }
    const { comprobante_data, comprobante_mime, comprobante_nombre_original, comprobante_r2_key } = rows[0];
    const datosArchivo = comprobante_r2_key ? await leerArchivoR2(comprobante_r2_key) : comprobante_data;

    res.set('Content-Type', comprobante_mime || 'application/octet-stream');
    if (req.query.download) {
      res.set('Content-Disposition', `attachment; filename="${comprobante_nombre_original || `comprobante-${id}`}"`);
    }
    res.send(datosArchivo);
  } catch (err) {
    console.error('Error GET /api/ingresos/:id/comprobante:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Importar Ingresos históricos desde Excel + ZIP de comprobantes (formato AppSheet) ---
function parsearImporteEuropeo(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  if (typeof valor === 'number') return valor;
  let texto = String(valor).replace(/[€\s]/g, '');
  if (texto.includes(',')) {
    // Formato europeo: punto = miles, coma = decimal
    texto = texto.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(texto);
  return isNaN(n) ? 0 : n;
}

function normalizarRutaArchivo(ruta) {
  return String(ruta || '').replace(/\\/g, '/').replace(/^\/+/, '').trim().toUpperCase();
}

function mimePorExtensionGenerico(nombreArchivo) {
  const ext = String(nombreArchivo).split('.').pop().toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'pdf') return 'application/pdf';
  return null;
}

app.post(
  '/api/ingresos/importar-excel-zip',
  requirePermiso('ingresos'),
  upload.fields([{ name: 'excel', maxCount: 1 }, { name: 'zip', maxCount: 1 }]),
  async (req, res) => {
    if (!req.files || !req.files.excel || !req.files.excel[0]) {
      return res.status(400).json({ error: 'Falta el archivo Excel' });
    }

    try {
      const libro = XLSX.read(req.files.excel[0].buffer, { type: 'buffer', cellDates: true });
      const primeraHoja = libro.Sheets[libro.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: '' });

      if (filas.length === 0) {
        return res.status(400).json({ error: 'El Excel no tiene filas de datos.' });
      }

      // Índice de archivos del ZIP (si se subió)
      let entradasZip = [];
      if (req.files.zip && req.files.zip[0]) {
        const zip = new AdmZip(req.files.zip[0].buffer);
        entradasZip = zip.getEntries()
          .filter(e => !e.isDirectory)
          .map(e => ({ rutaNormalizada: normalizarRutaArchivo(e.entryName), entrada: e }));
      }

      function buscarArchivoZip(rutaExcel) {
        if (!rutaExcel || entradasZip.length === 0) return null;
        const rutaNorm = normalizarRutaArchivo(rutaExcel);
        let encontrado = entradasZip.find(e => e.rutaNormalizada.endsWith(rutaNorm));
        if (!encontrado) encontrado = entradasZip.find(e => rutaNorm.endsWith(e.rutaNormalizada));
        if (!encontrado) {
          const nombreArchivo = rutaNorm.split('/').pop();
          encontrado = entradasZip.find(e => e.rutaNormalizada.split('/').pop() === nombreArchivo);
        }
        return encontrado ? encontrado.entrada : null;
      }

      const { rows: puntosVentaDb } = await pool.query('SELECT id, nombre FROM puntos_venta');
      function buscarPuntoVentaId(nombre) {
        if (!nombre) return null;
        const texto = String(nombre).trim().toLowerCase();
        const encontrado = puntosVentaDb.find(pv => (pv.nombre || '').trim().toLowerCase() === texto);
        return encontrado ? encontrado.id : null;
      }

      const { rows: usuariosDb } = await pool.query('SELECT id, nombre, email FROM usuarios');
      function buscarUsuarioId(nombreOEmail) {
        if (!nombreOEmail) return null;
        const texto = String(nombreOEmail).trim().toLowerCase();
        const encontrado = usuariosDb.find(u =>
          (u.nombre || '').trim().toLowerCase() === texto ||
          (u.email || '').trim().toLowerCase() === texto
        );
        return encontrado ? encontrado.id : null;
      }

      let creados = 0;
      let omitidos = 0;
      let conComprobante = 0;
      let sinComprobante = 0;
      let sinPuntoVenta = 0;

      for (const filaOriginal of filas) {
        const fila = normalizarFilaExcel(filaOriginal);

        const fechaValor = obtenerValorPorClave(fila, 'FECHA');
        const importeValor = obtenerValorPorClave(fila, 'IMPORTE');
        const nombrePuntoVenta = obtenerValorPorClave(fila, 'PUNTO DE VENTA');
        const rutaArchivo = obtenerValorRutaArchivo(fila);
        const usuario = obtenerValorPorClave(fila, 'USUARIO');

        const fecha = parsearFechaSoloExcel(fechaValor);
        if (!fecha) {
          omitidos++;
          continue;
        }

        const importe = parsearImporteEuropeo(importeValor);
        const puntoVentaId = buscarPuntoVentaId(nombrePuntoVenta);
        if (nombrePuntoVenta && !puntoVentaId) sinPuntoVenta++;

        const usuarioId = buscarUsuarioId(usuario);

        const archivoEncontrado = buscarArchivoZip(rutaArchivo);
        let comprobanteData = null;
        let comprobanteMime = null;
        let comprobanteNombre = null;

        if (archivoEncontrado) {
          const nombreArchivo = archivoEncontrado.entryName.split('/').pop();
          const mime = mimePorExtensionGenerico(nombreArchivo);
          if (mime) {
            comprobanteData = archivoEncontrado.getData();
            comprobanteMime = mime;
            comprobanteNombre = nombreArchivo;
            conComprobante++;
          } else {
            sinComprobante++;
          }
        } else {
          sinComprobante++;
        }

        await pool.query(
          `INSERT INTO ingresos
            (fecha, importe, punto_venta_id, comprobante_data, comprobante_mime, comprobante_nombre_original, registrado_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [fecha, importe, puntoVentaId, comprobanteData, comprobanteMime, comprobanteNombre, usuarioId]
        );
        creados++;
      }

      res.json({
        ok: true,
        total: filas.length,
        creados,
        omitidos,
        conComprobante,
        sinComprobante,
        sinPuntoVenta
      });
    } catch (err) {
      console.error('Error POST /api/ingresos/importar-excel-zip:', err.message);
      res.status(500).json({ error: 'No se pudo leer el archivo. Asegúrate de que el Excel y el ZIP son válidos.' });
    }
  }
);

app.post('/api/ingresos', requirePermiso('ingresos'), upload.single('comprobante'), async (req, res) => {
  const { fecha, importe, punto_venta_id } = req.body;

  if (!fecha || !importe || !punto_venta_id || !req.file) {
    return res.status(400).json({ error: 'Fecha, importe, punto de venta y comprobante son obligatorios' });
  }

  try {
    const r2Key = await subirArchivoR2('ingresos/comprobante', req.file.originalname, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO ingresos
        (fecha, importe, punto_venta_id, comprobante_data, comprobante_mime, comprobante_nombre_original, comprobante_r2_key, registrado_por)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, fecha, importe, punto_venta_id, comprobante_nombre_original`,
      [fecha, importe, punto_venta_id, null, req.file.mimetype, req.file.originalname, r2Key, req.session.usuario.id]
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
      const r2Key = await subirArchivoR2('ingresos/comprobante', req.file.originalname, req.file.buffer, req.file.mimetype);
      ({ rows } = await pool.query(
        `UPDATE ingresos SET
           fecha=$1, importe=$2, punto_venta_id=$3,
           comprobante_data=NULL, comprobante_mime=$4, comprobante_nombre_original=$5, comprobante_r2_key=$6
         WHERE id=$7
         RETURNING id`,
        [fecha, importe, punto_venta_id, req.file.mimetype, req.file.originalname, r2Key, id]
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

// --- GASTOS TARJETA ---

app.get('/api/gastos-tarjeta', requirePermiso('gastos_tarjeta'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.fecha, g.proveedor_id, g.importe, g.punto_venta_id,
              g.factura_nombre_original, g.created_at,
              u.nombre AS registrado_por_nombre
       FROM gastos_tarjeta g
       LEFT JOIN usuarios u ON u.id = g.registrado_por
       ORDER BY g.fecha DESC, g.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/gastos-tarjeta:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gastos-tarjeta/:id', requirePermiso('gastos_tarjeta'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, fecha, proveedor_id, importe, punto_venta_id, factura_nombre_original,
              (factura_data IS NOT NULL) AS tiene_factura
       FROM gastos_tarjeta WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/gastos-tarjeta/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/gastos-tarjeta/:id/factura', requirePermiso('gastos_tarjeta'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT factura_data, factura_mime, factura_nombre_original, factura_r2_key FROM gastos_tarjeta WHERE id = $1',
      [id]
    );
    if (!rows[0] || (!rows[0].factura_data && !rows[0].factura_r2_key)) {
      return res.status(404).send('No hay factura para este gasto');
    }
    const { factura_data, factura_mime, factura_nombre_original, factura_r2_key } = rows[0];
    const datosArchivo = factura_r2_key ? await leerArchivoR2(factura_r2_key) : factura_data;

    res.set('Content-Type', factura_mime || 'application/octet-stream');
    if (req.query.download) {
      res.set('Content-Disposition', `attachment; filename="${factura_nombre_original || `factura-${id}`}"`);
    }
    res.send(datosArchivo);
  } catch (err) {
    console.error('Error GET /api/gastos-tarjeta/:id/factura:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Importar Gastos Tarjeta históricos desde Excel + ZIP de facturas (formato AppSheet) ---
app.post(
  '/api/gastos-tarjeta/importar-excel-zip',
  requirePermiso('gastos_tarjeta'),
  upload.fields([{ name: 'excel', maxCount: 1 }, { name: 'zip', maxCount: 1 }]),
  async (req, res) => {
    if (!req.files || !req.files.excel || !req.files.excel[0]) {
      return res.status(400).json({ error: 'Falta el archivo Excel' });
    }

    try {
      const libro = XLSX.read(req.files.excel[0].buffer, { type: 'buffer', cellDates: true });
      const primeraHoja = libro.Sheets[libro.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: '' });

      if (filas.length === 0) {
        return res.status(400).json({ error: 'El Excel no tiene filas de datos.' });
      }

      let entradasZip = [];
      if (req.files.zip && req.files.zip[0]) {
        const zip = new AdmZip(req.files.zip[0].buffer);
        entradasZip = zip.getEntries()
          .filter(e => !e.isDirectory)
          .map(e => ({ rutaNormalizada: normalizarRutaArchivo(e.entryName), entrada: e }));
      }

      function buscarArchivoZip(rutaExcel) {
        if (!rutaExcel || entradasZip.length === 0) return null;
        const rutaNorm = normalizarRutaArchivo(rutaExcel);
        let encontrado = entradasZip.find(e => e.rutaNormalizada.endsWith(rutaNorm));
        if (!encontrado) encontrado = entradasZip.find(e => rutaNorm.endsWith(e.rutaNormalizada));
        if (!encontrado) {
          const nombreArchivo = rutaNorm.split('/').pop();
          encontrado = entradasZip.find(e => e.rutaNormalizada.split('/').pop() === nombreArchivo);
        }
        return encontrado ? encontrado.entrada : null;
      }

      const { rows: puntosVentaDb } = await pool.query('SELECT id, nombre FROM puntos_venta');
      function buscarPuntoVentaId(nombre) {
        if (!nombre) return null;
        const texto = String(nombre).trim().toLowerCase();
        const encontrado = puntosVentaDb.find(pv => (pv.nombre || '').trim().toLowerCase() === texto);
        return encontrado ? encontrado.id : null;
      }

      const { rows: proveedoresDb } = await pool.query('SELECT id, nombre_proveedor, nombre_comercial FROM proveedores');
      function buscarProveedorId(nombre) {
        if (!nombre) return null;
        const texto = String(nombre).trim().toLowerCase();
        const encontrado = proveedoresDb.find(p =>
          (p.nombre_proveedor || '').trim().toLowerCase() === texto ||
          (p.nombre_comercial || '').trim().toLowerCase() === texto
        );
        return encontrado ? encontrado.id : null;
      }

      const { rows: usuariosDb } = await pool.query('SELECT id, nombre, email FROM usuarios');
      function buscarUsuarioId(nombreOEmail) {
        if (!nombreOEmail) return null;
        const texto = String(nombreOEmail).trim().toLowerCase();
        const encontrado = usuariosDb.find(u =>
          (u.nombre || '').trim().toLowerCase() === texto ||
          (u.email || '').trim().toLowerCase() === texto
        );
        return encontrado ? encontrado.id : null;
      }

      let creados = 0;
      let omitidos = 0;
      let conFactura = 0;
      let sinFactura = 0;
      let sinPuntoVenta = 0;
      let sinProveedor = 0;

      for (const filaOriginal of filas) {
        const fila = normalizarFilaExcel(filaOriginal);

        const fechaValor = obtenerValorPorClave(fila, 'FECHA');
        const importeValor = obtenerValorPorClave(fila, 'IMPORTE');
        const nombreProveedor = obtenerValorPorClave(fila, 'PROVEEDOR');
        const nombrePuntoVenta = obtenerValorPorClave(fila, 'CENTRO DE COSTE');
        const rutaArchivo = obtenerValorRutaArchivo(fila);
        const usuario = obtenerValorPorClave(fila, 'USUARIO');

        const fecha = parsearFechaSoloExcel(fechaValor);
        if (!fecha) {
          omitidos++;
          continue;
        }

        const importe = parsearImporteEuropeo(importeValor);
        const puntoVentaId = buscarPuntoVentaId(nombrePuntoVenta);
        if (nombrePuntoVenta && !puntoVentaId) sinPuntoVenta++;

        const proveedorId = buscarProveedorId(nombreProveedor);
        if (nombreProveedor && !proveedorId) sinProveedor++;

        const usuarioId = buscarUsuarioId(usuario);

        const archivoEncontrado = buscarArchivoZip(rutaArchivo);
        let facturaR2Key = null;
        let facturaMime = null;
        let facturaNombre = null;

        if (archivoEncontrado) {
          const nombreArchivo = archivoEncontrado.entryName.split('/').pop();
          const mime = mimePorExtensionGenerico(nombreArchivo);
          if (mime) {
            try {
              const buffer = archivoEncontrado.getData();
              facturaR2Key = await subirArchivoR2('gastos-tarjeta/factura', nombreArchivo, buffer, mime);
              facturaMime = mime;
              facturaNombre = nombreArchivo;
              conFactura++;
            } catch (errR2) {
              console.error('Error subiendo a R2 durante importación de Gastos Tarjeta:', errR2.message);
              sinFactura++;
            }
          } else {
            sinFactura++;
          }
        } else {
          sinFactura++;
        }

        await pool.query(
          `INSERT INTO gastos_tarjeta
            (fecha, proveedor_id, importe, punto_venta_id, factura_data, factura_mime, factura_nombre_original, factura_r2_key, registrado_por)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [fecha, proveedorId, importe, puntoVentaId, null, facturaMime, facturaNombre, facturaR2Key, usuarioId]
        );
        creados++;
      }

      res.json({
        ok: true,
        total: filas.length,
        creados,
        omitidos,
        conFactura,
        sinFactura,
        sinPuntoVenta,
        sinProveedor
      });
    } catch (err) {
      console.error('Error POST /api/gastos-tarjeta/importar-excel-zip:', err.message);
      res.status(500).json({ error: 'No se pudo leer el archivo. Asegúrate de que el Excel y el ZIP son válidos.' });
    }
  }
);

app.post('/api/gastos-tarjeta', requirePermiso('gastos_tarjeta'), upload.single('factura'), async (req, res) => {
  const { fecha, proveedor_id, importe, punto_venta_id } = req.body;

  if (!fecha || !proveedor_id || !importe || !punto_venta_id || !req.file) {
    return res.status(400).json({ error: 'Fecha, proveedor, importe, punto de venta y factura son obligatorios' });
  }

  try {
    const r2Key = await subirArchivoR2('gastos-tarjeta/factura', req.file.originalname, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO gastos_tarjeta
        (fecha, proveedor_id, importe, punto_venta_id, factura_data, factura_mime, factura_nombre_original, factura_r2_key, registrado_por)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, fecha, proveedor_id, importe, punto_venta_id, factura_nombre_original`,
      [fecha, proveedor_id, importe, punto_venta_id, null, req.file.mimetype, req.file.originalname, r2Key, req.session.usuario.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/gastos-tarjeta:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/gastos-tarjeta/:id', requirePermiso('gastos_tarjeta'), upload.single('factura'), async (req, res) => {
  const { id } = req.params;
  const { fecha, proveedor_id, importe, punto_venta_id } = req.body;

  if (!fecha || !proveedor_id || !importe || !punto_venta_id) {
    return res.status(400).json({ error: 'Fecha, proveedor, importe y punto de venta son obligatorios' });
  }

  try {
    let rows;
    if (req.file) {
      const r2Key = await subirArchivoR2('gastos-tarjeta/factura', req.file.originalname, req.file.buffer, req.file.mimetype);
      ({ rows } = await pool.query(
        `UPDATE gastos_tarjeta SET
           fecha=$1, proveedor_id=$2, importe=$3, punto_venta_id=$4,
           factura_data=NULL, factura_mime=$5, factura_nombre_original=$6, factura_r2_key=$7
         WHERE id=$8
         RETURNING id`,
        [fecha, proveedor_id, importe, punto_venta_id, req.file.mimetype, req.file.originalname, r2Key, id]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE gastos_tarjeta SET fecha=$1, proveedor_id=$2, importe=$3, punto_venta_id=$4
         WHERE id=$5
         RETURNING id`,
        [fecha, proveedor_id, importe, punto_venta_id, id]
      ));
    }
    if (!rows[0]) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/gastos-tarjeta/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/gastos-tarjeta/:id', requirePermiso('gastos_tarjeta'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM gastos_tarjeta WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/gastos-tarjeta/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- SOCIOS ---

const SOCIOS_VALIDOS = ['Gabriel', 'Wilson', 'Diana', 'Fernando'];
const TIPOS_SOCIO_VALIDOS = ['Pago de Gasto', 'Retiro Cash'];

app.get('/api/socios', requirePermiso('socios'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, u.nombre AS registrado_por_nombre
       FROM socios s
       LEFT JOIN usuarios u ON u.id = s.registrado_por
       ORDER BY s.fecha DESC, s.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/socios:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/socios/:id', requirePermiso('socios'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM socios WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/socios/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/socios', requirePermiso('socios'), async (req, res) => {
  const { fecha, punto_venta_id, socio, tipo, importe, observaciones } = req.body;

  if (!fecha || !punto_venta_id || !socio || !tipo || !importe) {
    return res.status(400).json({ error: 'Fecha, punto de venta, socio, tipo e importe son obligatorios' });
  }
  if (!SOCIOS_VALIDOS.includes(socio)) {
    return res.status(400).json({ error: 'Socio no válido' });
  }
  if (!TIPOS_SOCIO_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: 'Tipo no válido' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO socios (fecha, punto_venta_id, socio, tipo, importe, observaciones, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [fecha, punto_venta_id, socio, tipo, importe, observaciones || null, req.session.usuario.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/socios:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/socios/:id', requirePermiso('socios'), async (req, res) => {
  const { id } = req.params;
  const { fecha, punto_venta_id, socio, tipo, importe, observaciones } = req.body;

  if (!fecha || !punto_venta_id || !socio || !tipo || !importe) {
    return res.status(400).json({ error: 'Fecha, punto de venta, socio, tipo e importe son obligatorios' });
  }
  if (!SOCIOS_VALIDOS.includes(socio)) {
    return res.status(400).json({ error: 'Socio no válido' });
  }
  if (!TIPOS_SOCIO_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: 'Tipo no válido' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE socios SET fecha=$1, punto_venta_id=$2, socio=$3, tipo=$4, importe=$5, observaciones=$6
       WHERE id=$7
       RETURNING *`,
      [fecha, punto_venta_id, socio, tipo, importe, observaciones || null, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/socios/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/socios/:id', requirePermiso('socios'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM socios WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/socios/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- BASE PUNTO DE VENTA (traspasos entre puntos de venta) ---

app.get('/api/base-punto-venta', requirePermiso('base_punto_venta'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, u.nombre AS registrado_por_nombre
       FROM base_punto_venta b
       LEFT JOIN usuarios u ON u.id = b.registrado_por
       ORDER BY b.fecha DESC, b.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/base-punto-venta:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/base-punto-venta/:id', requirePermiso('base_punto_venta'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM base_punto_venta WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/base-punto-venta/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Importar Base Punto de Venta desde Excel (formato AppSheet) ---
app.post('/api/base-punto-venta/importar-excel', requirePermiso('base_punto_venta'), upload.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el archivo Excel' });
  }

  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const primeraHoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: '' });

    if (filas.length === 0) {
      return res.status(400).json({ error: 'El Excel no tiene filas de datos.' });
    }

    const { rows: puntosVentaDb } = await pool.query('SELECT id, nombre FROM puntos_venta');
    function buscarPuntoVentaId(nombre) {
      if (!nombre) return null;
      const texto = String(nombre).trim().toLowerCase();
      const encontrado = puntosVentaDb.find(pv => (pv.nombre || '').trim().toLowerCase() === texto);
      return encontrado ? encontrado.id : null;
    }

    const { rows: usuariosDb } = await pool.query('SELECT id, nombre, email FROM usuarios');
    function buscarUsuarioId(nombreOEmail) {
      if (!nombreOEmail) return null;
      const texto = String(nombreOEmail).trim().toLowerCase();
      const encontrado = usuariosDb.find(u =>
        (u.nombre || '').trim().toLowerCase() === texto ||
        (u.email || '').trim().toLowerCase() === texto
      );
      return encontrado ? encontrado.id : null;
    }

    let creados = 0;
    let omitidos = 0;
    let mismoOrigenDestino = 0;
    let sinPuntoVenta = 0;

    for (const filaOriginal of filas) {
      const fila = normalizarFilaExcel(filaOriginal);

      const fechaValor = obtenerValorPorClave(fila, 'FECHA');
      const importeValor = obtenerValorPorClave(fila, 'IMPORTE');
      const nombreOrigen = obtenerValorPorClave(fila, 'PUNTO DE VENTA ORIGEN');
      const nombreDestino = obtenerValorPorClave(fila, 'PUNTO DE VENTA DESTINO');
      const usuario = obtenerValorPorClave(fila, 'USUARIO');

      const fecha = parsearFechaSoloExcel(fechaValor);
      if (!fecha) {
        omitidos++;
        continue;
      }

      const importe = parsearImporteEuropeo(importeValor);
      const origenId = buscarPuntoVentaId(nombreOrigen);
      const destinoId = buscarPuntoVentaId(nombreDestino);
      if ((nombreOrigen && !origenId) || (nombreDestino && !destinoId)) sinPuntoVenta++;

      if (origenId && destinoId && origenId === destinoId) {
        mismoOrigenDestino++;
        continue;
      }

      const usuarioId = buscarUsuarioId(usuario);

      await pool.query(
        `INSERT INTO base_punto_venta (fecha, punto_venta_origen_id, punto_venta_destino_id, importe, registrado_por)
         VALUES ($1, $2, $3, $4, $5)`,
        [fecha, origenId, destinoId, importe, usuarioId]
      );
      creados++;
    }

    res.json({
      ok: true,
      total: filas.length,
      creados,
      omitidos,
      mismoOrigenDestino,
      sinPuntoVenta
    });
  } catch (err) {
    console.error('Error POST /api/base-punto-venta/importar-excel:', err.message);
    res.status(500).json({ error: 'No se pudo leer el archivo. Asegúrate de que es un .xlsx válido.' });
  }
});

app.post('/api/base-punto-venta', requirePermiso('base_punto_venta'), async (req, res) => {
  const { fecha, punto_venta_origen_id, punto_venta_destino_id, importe } = req.body;

  if (!fecha || !punto_venta_origen_id || !punto_venta_destino_id || !importe) {
    return res.status(400).json({ error: 'Fecha, punto de venta origen, destino e importe son obligatorios' });
  }
  if (String(punto_venta_origen_id) === String(punto_venta_destino_id)) {
    return res.status(400).json({ error: 'El punto de venta origen y destino no pueden ser el mismo' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO base_punto_venta (fecha, punto_venta_origen_id, punto_venta_destino_id, importe, registrado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [fecha, punto_venta_origen_id, punto_venta_destino_id, importe, req.session.usuario.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/base-punto-venta:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/base-punto-venta/:id', requirePermiso('base_punto_venta'), async (req, res) => {
  const { id } = req.params;
  const { fecha, punto_venta_origen_id, punto_venta_destino_id, importe } = req.body;

  if (!fecha || !punto_venta_origen_id || !punto_venta_destino_id || !importe) {
    return res.status(400).json({ error: 'Fecha, punto de venta origen, destino e importe son obligatorios' });
  }
  if (String(punto_venta_origen_id) === String(punto_venta_destino_id)) {
    return res.status(400).json({ error: 'El punto de venta origen y destino no pueden ser el mismo' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE base_punto_venta SET fecha=$1, punto_venta_origen_id=$2, punto_venta_destino_id=$3, importe=$4
       WHERE id=$5
       RETURNING *`,
      [fecha, punto_venta_origen_id, punto_venta_destino_id, importe, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/base-punto-venta/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/base-punto-venta/:id', requirePermiso('base_punto_venta'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM base_punto_venta WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/base-punto-venta/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- FACTURA CASH ---

app.get('/api/factura-cash', requirePermiso('factura_cash'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.fecha, f.proveedor_nombre, f.punto_venta_id, f.importe, f.observaciones,
              f.factura_nombre_original, f.created_at,
              u.nombre AS registrado_por_nombre
       FROM factura_cash f
       LEFT JOIN usuarios u ON u.id = f.registrado_por
       ORDER BY f.fecha DESC, f.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/factura-cash:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/factura-cash/:id', requirePermiso('factura_cash'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT f.id, f.fecha, f.proveedor_nombre, f.punto_venta_id, f.importe, f.observaciones, f.factura_nombre_original,
              (f.factura_data IS NOT NULL) AS tiene_factura,
              f.created_at, u.nombre AS registrado_por_nombre
       FROM factura_cash f
       LEFT JOIN usuarios u ON u.id = f.registrado_por
       WHERE f.id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/factura-cash/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/factura-cash/:id/factura', requirePermiso('factura_cash'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT factura_data, factura_mime, factura_nombre_original, factura_r2_key FROM factura_cash WHERE id = $1',
      [id]
    );
    if (!rows[0] || (!rows[0].factura_data && !rows[0].factura_r2_key)) {
      return res.status(404).send('No hay factura para este registro');
    }
    const { factura_data, factura_mime, factura_nombre_original, factura_r2_key } = rows[0];
    const datosArchivo = factura_r2_key ? await leerArchivoR2(factura_r2_key) : factura_data;

    res.set('Content-Type', factura_mime || 'application/octet-stream');
    if (req.query.download) {
      res.set('Content-Disposition', `attachment; filename="${factura_nombre_original || `factura-${id}`}"`);
    }
    res.send(datosArchivo);
  } catch (err) {
    console.error('Error GET /api/factura-cash/:id/factura:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Importar Facturas Cash históricas desde Excel + ZIP de facturas (formato AppSheet) ---
app.post(
  '/api/factura-cash/importar-excel-zip',
  requirePermiso('factura_cash'),
  upload.fields([{ name: 'excel', maxCount: 1 }, { name: 'zip', maxCount: 1 }]),
  async (req, res) => {
    if (!req.files || !req.files.excel || !req.files.excel[0]) {
      return res.status(400).json({ error: 'Falta el archivo Excel' });
    }

    try {
      const libro = XLSX.read(req.files.excel[0].buffer, { type: 'buffer', cellDates: true });
      const primeraHoja = libro.Sheets[libro.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: '' });

      if (filas.length === 0) {
        return res.status(400).json({ error: 'El Excel no tiene filas de datos.' });
      }

      let entradasZip = [];
      if (req.files.zip && req.files.zip[0]) {
        const zip = new AdmZip(req.files.zip[0].buffer);
        entradasZip = zip.getEntries()
          .filter(e => !e.isDirectory)
          .map(e => ({ rutaNormalizada: normalizarRutaArchivo(e.entryName), entrada: e }));
      }

      function buscarArchivoZip(rutaExcel) {
        if (!rutaExcel || entradasZip.length === 0) return null;
        const rutaNorm = normalizarRutaArchivo(rutaExcel);
        let encontrado = entradasZip.find(e => e.rutaNormalizada.endsWith(rutaNorm));
        if (!encontrado) encontrado = entradasZip.find(e => rutaNorm.endsWith(e.rutaNormalizada));
        if (!encontrado) {
          const nombreArchivo = rutaNorm.split('/').pop();
          encontrado = entradasZip.find(e => e.rutaNormalizada.split('/').pop() === nombreArchivo);
        }
        return encontrado ? encontrado.entrada : null;
      }

      const { rows: puntosVentaDb } = await pool.query('SELECT id, nombre FROM puntos_venta');
      function buscarPuntoVentaId(nombre) {
        if (!nombre) return null;
        const texto = String(nombre).trim().toLowerCase();
        const encontrado = puntosVentaDb.find(pv => (pv.nombre || '').trim().toLowerCase() === texto);
        return encontrado ? encontrado.id : null;
      }

      const { rows: usuariosDb } = await pool.query('SELECT id, nombre, email FROM usuarios');
      function buscarUsuarioId(nombreOEmail) {
        if (!nombreOEmail) return null;
        const texto = String(nombreOEmail).trim().toLowerCase();
        const encontrado = usuariosDb.find(u =>
          (u.nombre || '').trim().toLowerCase() === texto ||
          (u.email || '').trim().toLowerCase() === texto
        );
        return encontrado ? encontrado.id : null;
      }

      let creados = 0;
      let omitidos = 0;
      let conFactura = 0;
      let sinFactura = 0;
      let sinPuntoVenta = 0;

      for (const filaOriginal of filas) {
        const fila = normalizarFilaExcel(filaOriginal);

        const fechaValor = obtenerValorPorClave(fila, 'FECHA');
        const importeValor = obtenerValorPorClave(fila, 'IMPORTE');
        const proveedorNombre = String(obtenerValorPorClave(fila, 'PROVEEDOR')).trim() || null;
        const nombrePuntoVenta = obtenerValorPorClave(fila, 'PUNTO DE VENTA') || obtenerValorPorClave(fila, 'PUTNO DE VENTA');
        const rutaArchivo = obtenerValorRutaArchivo(fila);
        const usuario = obtenerValorPorClave(fila, 'USUARIO');

        const fecha = parsearFechaSoloExcel(fechaValor);
        if (!fecha) {
          omitidos++;
          continue;
        }

        const importe = parsearImporteEuropeo(importeValor);
        const puntoVentaId = buscarPuntoVentaId(nombrePuntoVenta);
        if (nombrePuntoVenta && !puntoVentaId) sinPuntoVenta++;

        const usuarioId = buscarUsuarioId(usuario);

        const archivoEncontrado = buscarArchivoZip(rutaArchivo);
        let facturaR2Key = null;
        let facturaMime = null;
        let facturaNombre = null;

        if (archivoEncontrado) {
          const nombreArchivo = archivoEncontrado.entryName.split('/').pop();
          const mime = mimePorExtensionGenerico(nombreArchivo);
          if (mime) {
            try {
              const buffer = archivoEncontrado.getData();
              facturaR2Key = await subirArchivoR2('factura-cash/factura', nombreArchivo, buffer, mime);
              facturaMime = mime;
              facturaNombre = nombreArchivo;
              conFactura++;
            } catch (errR2) {
              console.error('Error subiendo a R2 durante importación de Facturas Cash:', errR2.message);
              sinFactura++;
            }
          } else {
            sinFactura++;
          }
        } else {
          sinFactura++;
        }

        await pool.query(
          `INSERT INTO factura_cash
            (fecha, proveedor_nombre, punto_venta_id, importe, observaciones, factura_data, factura_mime, factura_nombre_original, factura_r2_key, registrado_por)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [fecha, proveedorNombre, puntoVentaId, importe, null, null, facturaMime, facturaNombre, facturaR2Key, usuarioId]
        );
        creados++;
      }

      res.json({
        ok: true,
        total: filas.length,
        creados,
        omitidos,
        conFactura,
        sinFactura,
        sinPuntoVenta
      });
    } catch (err) {
      console.error('Error POST /api/factura-cash/importar-excel-zip:', err.message);
      res.status(500).json({ error: 'No se pudo leer el archivo. Asegúrate de que el Excel y el ZIP son válidos.' });
    }
  }
);

app.post('/api/factura-cash', requirePermiso('factura_cash'), upload.single('factura'), async (req, res) => {
  const { fecha, proveedor_nombre, punto_venta_id, importe, observaciones } = req.body;

  if (!fecha || !proveedor_nombre || !punto_venta_id || !importe || !req.file) {
    return res.status(400).json({ error: 'Fecha, proveedor, punto de venta, importe y factura son obligatorios' });
  }

  try {
    const r2Key = await subirArchivoR2('factura-cash/factura', req.file.originalname, req.file.buffer, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO factura_cash
        (fecha, proveedor_nombre, punto_venta_id, importe, observaciones, factura_data, factura_mime, factura_nombre_original, factura_r2_key, registrado_por)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, fecha, proveedor_nombre, punto_venta_id, importe, observaciones, factura_nombre_original`,
      [fecha, proveedor_nombre, punto_venta_id, importe, observaciones || null, null, req.file.mimetype, req.file.originalname, r2Key, req.session.usuario.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/factura-cash:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/factura-cash/:id', requirePermiso('factura_cash'), upload.single('factura'), async (req, res) => {
  const { id } = req.params;
  const { fecha, proveedor_nombre, punto_venta_id, importe, observaciones } = req.body;

  if (!fecha || !proveedor_nombre || !punto_venta_id || !importe) {
    return res.status(400).json({ error: 'Fecha, proveedor, punto de venta e importe son obligatorios' });
  }

  try {
    let rows;
    if (req.file) {
      const r2Key = await subirArchivoR2('factura-cash/factura', req.file.originalname, req.file.buffer, req.file.mimetype);
      ({ rows } = await pool.query(
        `UPDATE factura_cash SET
           fecha=$1, proveedor_nombre=$2, punto_venta_id=$3, importe=$4, observaciones=$5,
           factura_data=NULL, factura_mime=$6, factura_nombre_original=$7, factura_r2_key=$8
         WHERE id=$9
         RETURNING id`,
        [fecha, proveedor_nombre, punto_venta_id, importe, observaciones || null, req.file.mimetype, req.file.originalname, r2Key, id]
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE factura_cash SET fecha=$1, proveedor_nombre=$2, punto_venta_id=$3, importe=$4, observaciones=$5
         WHERE id=$6
         RETURNING id`,
        [fecha, proveedor_nombre, punto_venta_id, importe, observaciones || null, id]
      ));
    }
    if (!rows[0]) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/factura-cash/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/factura-cash/:id', requirePermiso('factura_cash'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM factura_cash WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/factura-cash/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- INSUMOS (Productos + Stock) ---

const TIPOS_STAND_VALIDOS = ['CHOCOBERRIES', 'CARIBBEAN', 'MACONDO', 'KOKO BLENDS'];
const TIPOS_ALBARAN_VALIDOS = ['INICIAL', 'FINAL', 'NORMAL'];

app.get('/api/productos', requirePermiso('insumos'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.nombre AS registrado_por_nombre,
              COALESCE(s.stock_total, 0) AS stock_total
       FROM insumos_productos p
       LEFT JOIN usuarios u ON u.id = p.registrado_por
       LEFT JOIN (
         SELECT producto_id, SUM(cantidad) AS stock_total
         FROM producto_stock
         GROUP BY producto_id
       ) s ON s.producto_id = p.id
       ORDER BY p.tipo_stand ASC, p.nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/productos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Lista ligera para la rejilla de Albaranes (filtrable por tipo_stand), solo activos
app.get('/api/productos-dropdown', requirePermiso('albaranes'), async (req, res) => {
  const { tipo_stand } = req.query;
  try {
    const params = [];
    let query = 'SELECT id, nombre, precio_unitario, tipo_stand, cantidad_estandar FROM insumos_productos WHERE activo = TRUE';
    if (tipo_stand) {
      params.push(tipo_stand);
      query += ` AND tipo_stand = $${params.length}`;
    }
    query += ' ORDER BY nombre ASC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/productos-dropdown:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/productos/:id', requirePermiso('insumos'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM insumos_productos WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/productos/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Stock del producto desglosado por punto de venta (para el Detalle en Insumos)
app.get('/api/productos/:id/stock', requirePermiso('insumos'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT ps.punto_venta_id, ps.cantidad, pv.nombre AS punto_venta_nombre
       FROM producto_stock ps
       JOIN puntos_venta pv ON pv.id = ps.punto_venta_id
       WHERE ps.producto_id = $1 AND ps.cantidad <> 0
       ORDER BY pv.nombre ASC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/productos/:id/stock:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Encuentra el Punto de Venta "La Nave" (donde entra el stock nuevo por defecto).
// Se busca por nombre en vez de tener el ID fijo, porque puede variar entre entornos.
async function obtenerIdPuntoVentaNave() {
  const { rows } = await pool.query(
    `SELECT id FROM puntos_venta WHERE nombre ILIKE '%nave%' ORDER BY id ASC LIMIT 1`
  );
  return rows[0] ? rows[0].id : null;
}

function normalizarTipoStand(valor) {
  if (!valor) return null;
  const v = String(valor).trim().toUpperCase();
  return TIPOS_STAND_VALIDOS.find(t => v === t || v.includes(t)) || null;
}

function obtenerValorColumna(fila, nombresPosibles) {
  for (const clave of Object.keys(fila)) {
    const claveNorm = clave.trim().toUpperCase().replace(/[_\s]+/g, ' ');
    for (const posible of nombresPosibles) {
      if (claveNorm === posible.toUpperCase()) {
        return fila[clave];
      }
    }
  }
  return undefined;
}

// Importa el catálogo desde un Excel. Admite varias hojas (una por Tipo_Stand);
// si la hoja no trae columna TIPO_STAND, se infiere del nombre de la propia hoja.
// Reimportar el mismo archivo actualiza el precio en vez de duplicar (nombre+tipo_stand únicos).
app.post('/api/productos/importar-excel', requirePermiso('insumos'), upload.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el archivo Excel' });
  }

  try {
    const idNave = await obtenerIdPuntoVentaNave();
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const filasAImportar = [];

    for (const nombreHoja of libro.SheetNames) {
      const hoja = libro.Sheets[nombreHoja];
      const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
      const tipoStandDeHoja = normalizarTipoStand(nombreHoja);

      for (const fila of filas) {
        const nombreProducto = obtenerValorColumna(fila, ['PRODUCTO', 'NOMBRE']);
        const precioUnitario = obtenerValorColumna(fila, ['PRECIO UNITARIO', 'PRECIO', 'PRECIO_UNITARIO']);
        const tipoStandDeFila = normalizarTipoStand(obtenerValorColumna(fila, ['TIPO_STAND', 'TIPO STAND', 'STAND']));
        const tipoStand = tipoStandDeFila || tipoStandDeHoja;
        const stockValor = obtenerValorColumna(fila, ['STOCK', 'STOCK INICIAL', 'STOCK_INICIAL', 'STOCK ACTUALIZADO', 'STOCK_ACTUALIZADO']);
        const cantidadEstandarValor = obtenerValorColumna(fila, ['CANTIDAD_ALBARAN', 'CANTIDAD ALBARAN', 'CANTIDAD ESTANDAR', 'CANTIDAD_ESTANDAR']);

        if (!nombreProducto || !tipoStand || precioUnitario === undefined || precioUnitario === '') continue;

        const precioNumero = parseFloat(String(precioUnitario).replace(',', '.'));
        if (isNaN(precioNumero)) continue;

        let stockNumero = null;
        if (stockValor !== undefined && stockValor !== '') {
          const n = parseFloat(String(stockValor).replace(',', '.'));
          if (!isNaN(n)) stockNumero = n;
        }

        let cantidadEstandarNumero = null;
        if (cantidadEstandarValor !== undefined && cantidadEstandarValor !== '') {
          const n = parseFloat(String(cantidadEstandarValor).replace(',', '.'));
          if (!isNaN(n)) cantidadEstandarNumero = n;
        }

        filasAImportar.push({
          nombre: String(nombreProducto).trim(),
          tipo_stand: tipoStand,
          precio_unitario: precioNumero,
          stock: stockNumero,
          cantidad_estandar: cantidadEstandarNumero
        });
      }
    }

    if (filasAImportar.length === 0) {
      return res.status(400).json({
        error: 'No se encontraron filas válidas. Revisa que el Excel tenga columnas Producto y Precio Unitario, y que cada hoja se llame (o contenga) el Tipo_Stand: CHOCOBERRIES, CARIBBEAN, MACONDO o KOKO BLENDS.'
      });
    }

    let creados = 0;
    let actualizados = 0;
    let stockCargado = 0;

    for (const p of filasAImportar) {
      const resultado = await pool.query(
        `INSERT INTO insumos_productos (nombre, tipo_stand, precio_unitario, cantidad_estandar, registrado_por)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (nombre, tipo_stand)
         DO UPDATE SET
           precio_unitario = EXCLUDED.precio_unitario,
           cantidad_estandar = COALESCE(EXCLUDED.cantidad_estandar, insumos_productos.cantidad_estandar)
         RETURNING id, (xmax = 0) AS es_nuevo`,
        [p.nombre, p.tipo_stand, p.precio_unitario, p.cantidad_estandar, req.session.usuario.id]
      );
      if (resultado.rows[0].es_nuevo) creados++;
      else actualizados++;

      if (idNave && p.stock !== null) {
        await pool.query(
          `INSERT INTO producto_stock (producto_id, punto_venta_id, cantidad)
           VALUES ($1, $2, $3::numeric)
           ON CONFLICT (producto_id, punto_venta_id)
           DO UPDATE SET cantidad = $3::numeric`,
          [resultado.rows[0].id, idNave, p.stock]
        );
        stockCargado++;
      }
    }

    res.json({
      ok: true,
      total: filasAImportar.length,
      creados,
      actualizados,
      stockCargado,
      avisoSinNave: !idNave
    });
  } catch (err) {
    console.error('Error POST /api/productos/importar-excel:', err.message);
    res.status(500).json({ error: 'No se pudo leer el archivo. Asegúrate de que es un .xlsx válido.' });
  }
});

app.post('/api/productos', requirePermiso('insumos'), async (req, res) => {
  const { nombre, tipo_stand, precio_unitario, stock, cantidad_estandar } = req.body;

  if (!nombre || !tipo_stand || !precio_unitario) {
    return res.status(400).json({ error: 'Nombre, Tipo_Stand y Precio Unitario son obligatorios' });
  }
  if (!TIPOS_STAND_VALIDOS.includes(tipo_stand)) {
    return res.status(400).json({ error: 'Tipo_Stand no válido' });
  }

  const cantidadEstandarValor = (cantidad_estandar !== undefined && cantidad_estandar !== '') ? cantidad_estandar : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO insumos_productos (nombre, tipo_stand, precio_unitario, cantidad_estandar, registrado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre, tipo_stand, precio_unitario, cantidadEstandarValor, req.session.usuario.id]
    );
    const producto = rows[0];

    if (stock !== undefined && stock !== '' && Number(stock) !== 0) {
      const idNave = await obtenerIdPuntoVentaNave();
      if (idNave) {
        await pool.query(
          `INSERT INTO producto_stock (producto_id, punto_venta_id, cantidad)
           VALUES ($1, $2, $3::numeric)
           ON CONFLICT (producto_id, punto_venta_id)
           DO UPDATE SET cantidad = $3::numeric`,
          [producto.id, idNave, stock]
        );
      }
    }

    res.json(producto);
  } catch (err) {
    console.error('Error POST /api/productos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/productos/:id', requirePermiso('insumos'), async (req, res) => {
  const { id } = req.params;
  const { nombre, tipo_stand, precio_unitario, cantidad_estandar } = req.body;

  if (!nombre || !tipo_stand || !precio_unitario) {
    return res.status(400).json({ error: 'Nombre, Tipo_Stand y Precio Unitario son obligatorios' });
  }
  if (!TIPOS_STAND_VALIDOS.includes(tipo_stand)) {
    return res.status(400).json({ error: 'Tipo_Stand no válido' });
  }

  const cantidadEstandarValor = (cantidad_estandar !== undefined && cantidad_estandar !== '') ? cantidad_estandar : null;

  try {
    const { rows } = await pool.query(
      'UPDATE insumos_productos SET nombre=$1, tipo_stand=$2, precio_unitario=$3, cantidad_estandar=$4 WHERE id=$5 RETURNING *',
      [nombre, tipo_stand, precio_unitario, cantidadEstandarValor, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/productos/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/productos/:id/estado', requirePermiso('insumos'), async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE insumos_productos SET activo = $1 WHERE id = $2 RETURNING *',
      [activo, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PATCH /api/productos/:id/estado:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/productos/:id', requirePermiso('insumos'), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM insumos_productos WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/productos/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- ALBARANES ---

app.get('/api/albaranes', requirePermiso('albaranes'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.nombre AS registrado_por_nombre
       FROM albaranes a
       LEFT JOIN usuarios u ON u.id = a.registrado_por
       ORDER BY a.fecha DESC, a.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/albaranes:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/albaranes/:id', requirePermiso('albaranes'), async (req, res) => {
  const { id } = req.params;
  try {
    const cab = await pool.query(
      `SELECT a.*, u.nombre AS registrado_por_nombre
       FROM albaranes a
       LEFT JOIN usuarios u ON u.id = a.registrado_por
       WHERE a.id = $1`,
      [id]
    );
    if (!cab.rows[0]) return res.status(404).json({ error: 'Albarán no encontrado' });

    const detalle = await pool.query(
      'SELECT * FROM albaran_detalle WHERE albaran_id = $1 ORDER BY producto_nombre ASC',
      [id]
    );

    res.json({ ...cab.rows[0], lineas: detalle.rows });
  } catch (err) {
    console.error('Error GET /api/albaranes/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Importar Albaranes históricos desde Excel + ZIP de PDFs (formato AppSheet) ---
// Solo importa la cabecera del Albarán y el PDF real que ya existía en Drive
// (no reconstruye el detalle de productos: se mantiene el histórico visual tal cual).
app.post(
  '/api/albaranes/importar-excel-zip',
  requirePermiso('albaranes'),
  upload.fields([{ name: 'excel', maxCount: 1 }, { name: 'zip', maxCount: 1 }]),
  async (req, res) => {
    if (!req.files || !req.files.excel || !req.files.excel[0]) {
      return res.status(400).json({ error: 'Falta el archivo Excel' });
    }

    try {
      const libro = XLSX.read(req.files.excel[0].buffer, { type: 'buffer', cellDates: true });
      const primeraHoja = libro.Sheets[libro.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(primeraHoja, { defval: '' });

      if (filas.length === 0) {
        return res.status(400).json({ error: 'El Excel no tiene filas de datos.' });
      }

      let entradasZip = [];
      if (req.files.zip && req.files.zip[0]) {
        const zip = new AdmZip(req.files.zip[0].buffer);
        entradasZip = zip.getEntries()
          .filter(e => !e.isDirectory)
          .map(e => ({ rutaNormalizada: normalizarRutaArchivo(e.entryName), entrada: e }));
      }

      function buscarArchivoZip(rutaExcel) {
        if (!rutaExcel || entradasZip.length === 0) return null;
        const rutaNorm = normalizarRutaArchivo(rutaExcel);
        let encontrado = entradasZip.find(e => e.rutaNormalizada.endsWith(rutaNorm));
        if (!encontrado) encontrado = entradasZip.find(e => rutaNorm.endsWith(e.rutaNormalizada));
        if (!encontrado) {
          const nombreArchivo = rutaNorm.split('/').pop();
          encontrado = entradasZip.find(e => e.rutaNormalizada.split('/').pop() === nombreArchivo);
        }
        return encontrado ? encontrado.entrada : null;
      }

      const { rows: puntosVentaDb } = await pool.query('SELECT id, nombre FROM puntos_venta');
      function buscarPuntoVentaId(nombre) {
        if (!nombre) return null;
        const texto = String(nombre).trim().toLowerCase();
        const encontrado = puntosVentaDb.find(pv => (pv.nombre || '').trim().toLowerCase() === texto);
        return encontrado ? encontrado.id : null;
      }

      const { rows: usuariosDb } = await pool.query('SELECT id, nombre, email FROM usuarios');
      function buscarUsuarioId(nombreOEmail) {
        if (!nombreOEmail) return null;
        const texto = String(nombreOEmail).trim().toLowerCase();
        const encontrado = usuariosDb.find(u =>
          (u.nombre || '').trim().toLowerCase() === texto ||
          (u.email || '').trim().toLowerCase() === texto
        );
        return encontrado ? encontrado.id : null;
      }

      const idNave = await obtenerIdPuntoVentaNave();

      let creados = 0;
      let omitidos = 0;
      let mismoOrigenDestino = 0;
      let sinPuntoVenta = 0;
      let sinNave = 0;
      let conPdf = 0;
      let sinPdf = 0;

      for (const filaOriginal of filas) {
        const fila = normalizarFilaExcel(filaOriginal);

        const fechaValor = obtenerValorPorClave(fila, 'FECHA');
        const totalValor = obtenerValorPorClave(fila, 'TOTAL ALBARAN');
        const tipoStand = String(obtenerValorPorClave(fila, 'TIPO STAND')).trim().toUpperCase();
        const tipoAlbaran = String(obtenerValorPorClave(fila, 'TIPO_ALBARAN')).trim().toUpperCase();
        const nombrePuntoVenta = obtenerValorPorClave(fila, 'PUNTO DE VENTA');
        const nombrePuntoVentaOrigen = obtenerValorPorClave(fila, 'PUNTO DE VENTA ORIGEN');
        const usuario = obtenerValorPorClave(fila, 'USUARIO');
        let rutaArchivo = obtenerValorPorClave(fila, 'ENLACE AL PDF');
        if (!rutaArchivo) rutaArchivo = obtenerValorRutaArchivo(fila);

        const fecha = parsearFechaSoloExcel(fechaValor);
        if (!fecha || !tipoStand || !tipoAlbaran) {
          omitidos++;
          continue;
        }

        const puntoVentaId = buscarPuntoVentaId(nombrePuntoVenta);
        if (nombrePuntoVenta && !puntoVentaId) sinPuntoVenta++;

        let origenId = null;
        let destinoId = null;

        if (tipoAlbaran === 'TRASPASO') {
          origenId = buscarPuntoVentaId(nombrePuntoVentaOrigen);
          destinoId = puntoVentaId;
          if (nombrePuntoVentaOrigen && !origenId) sinPuntoVenta++;
        } else if (tipoAlbaran === 'FINAL') {
          origenId = puntoVentaId;
          destinoId = idNave;
          if (!idNave) sinNave++;
        } else {
          // INICIAL o NORMAL
          origenId = idNave;
          destinoId = puntoVentaId;
          if (!idNave) sinNave++;
        }

        if (origenId && destinoId && origenId === destinoId) {
          mismoOrigenDestino++;
          continue;
        }

        const totalAlbaran = parsearImporteEuropeo(totalValor);
        const usuarioId = buscarUsuarioId(usuario);

        const archivoEncontrado = buscarArchivoZip(rutaArchivo);
        let pdfR2Key = null;
        if (archivoEncontrado) {
          try {
            const nombreArchivo = archivoEncontrado.entryName.split('/').pop();
            const buffer = archivoEncontrado.getData();
            pdfR2Key = await subirArchivoR2('albaranes/pdf', nombreArchivo, buffer, 'application/pdf');
            conPdf++;
          } catch (errR2) {
            console.error('Error subiendo PDF de Albarán a R2:', errR2.message);
            sinPdf++;
          }
        } else {
          sinPdf++;
        }

        await pool.query(
          `INSERT INTO albaranes
            (fecha, punto_venta_origen_id, punto_venta_destino_id, tipo_stand, tipo_albaran, total_albaran, registrado_por, pdf_r2_key)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [fecha, origenId, destinoId, tipoStand, tipoAlbaran, totalAlbaran, usuarioId, pdfR2Key]
        );
        creados++;
      }

      res.json({
        ok: true,
        total: filas.length,
        creados,
        omitidos,
        mismoOrigenDestino,
        sinPuntoVenta,
        sinNave,
        conPdf,
        sinPdf
      });
    } catch (err) {
      console.error('Error POST /api/albaranes/importar-excel-zip:', err.message);
      res.status(500).json({ error: 'No se pudo leer el archivo. Asegúrate de que el Excel y el ZIP son válidos.' });
    }
  }
);

app.post('/api/albaranes', requirePermiso('albaranes'), async (req, res) => {
  const { fecha, punto_venta_origen_id, punto_venta_destino_id, tipo_stand, tipo_albaran, lineas } = req.body;

  if (!fecha || !punto_venta_origen_id || !punto_venta_destino_id || !tipo_stand || !tipo_albaran) {
    return res.status(400).json({ error: 'Fecha, origen, destino, Tipo_Stand y Tipo de Albarán son obligatorios' });
  }
  if (String(punto_venta_origen_id) === String(punto_venta_destino_id)) {
    return res.status(400).json({ error: 'El punto de venta origen y destino no pueden ser el mismo' });
  }
  if (!TIPOS_STAND_VALIDOS.includes(tipo_stand)) {
    return res.status(400).json({ error: 'Tipo_Stand no válido' });
  }
  if (!TIPOS_ALBARAN_VALIDOS.includes(tipo_albaran)) {
    return res.status(400).json({ error: 'Tipo de Albarán no válido' });
  }

  const lineasValidas = (Array.isArray(lineas) ? lineas : []).filter(l => l.producto_id && Number(l.cantidad) > 0);
  if (lineasValidas.length === 0) {
    return res.status(400).json({ error: 'Añade al menos un producto con cantidad mayor que 0' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let total = 0;
    const detalles = [];
    for (const linea of lineasValidas) {
      const prodRes = await client.query('SELECT nombre, precio_unitario FROM insumos_productos WHERE id = $1', [linea.producto_id]);
      if (!prodRes.rows[0]) continue;
      const cantidad = Number(linea.cantidad);
      const precio_unitario = Number(prodRes.rows[0].precio_unitario);
      const subtotal = cantidad * precio_unitario;
      total += subtotal;
      detalles.push({
        producto_id: linea.producto_id,
        producto_nombre: prodRes.rows[0].nombre,
        cantidad,
        precio_unitario,
        subtotal
      });
    }

    const cabeceraRes = await client.query(
      `INSERT INTO albaranes
        (fecha, punto_venta_origen_id, punto_venta_destino_id, tipo_stand, tipo_albaran, total_albaran, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [fecha, punto_venta_origen_id, punto_venta_destino_id, tipo_stand, tipo_albaran, total, req.session.usuario.id]
    );
    const albaran = cabeceraRes.rows[0];

    for (const d of detalles) {
      await client.query(
        `INSERT INTO albaran_detalle (albaran_id, producto_id, producto_nombre, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [albaran.id, d.producto_id, d.producto_nombre, d.cantidad, d.precio_unitario, d.subtotal]
      );

      // Resta del origen (crea la fila de stock si no existía, en negativo)
      await client.query(
        `INSERT INTO producto_stock (producto_id, punto_venta_id, cantidad)
         VALUES ($1, $2, -($3::numeric))
         ON CONFLICT (producto_id, punto_venta_id)
         DO UPDATE SET cantidad = producto_stock.cantidad - $3::numeric`,
        [d.producto_id, punto_venta_origen_id, d.cantidad]
      );

      // Suma al destino
      await client.query(
        `INSERT INTO producto_stock (producto_id, punto_venta_id, cantidad)
         VALUES ($1, $2, $3::numeric)
         ON CONFLICT (producto_id, punto_venta_id)
         DO UPDATE SET cantidad = producto_stock.cantidad + $3::numeric`,
        [d.producto_id, punto_venta_destino_id, d.cantidad]
      );
    }

    await client.query('COMMIT');
    res.json(albaran);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error POST /api/albaranes:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Editar un Albarán completo: Fecha, Origen/Destino, Tipo_Stand, Tipo_Albarán y también
// los productos/cantidades. Siempre revierte TODO el movimiento de stock viejo (con el
// Origen/Destino que tenía antes) y aplica el nuevo desde cero (con lo que se envía ahora),
// dentro de una única transacción.
app.put('/api/albaranes/:id', requirePermiso('albaranes'), async (req, res) => {
  const { id } = req.params;
  const { fecha, punto_venta_origen_id, punto_venta_destino_id, tipo_stand, tipo_albaran, lineas } = req.body;

  if (!fecha || !punto_venta_origen_id || !punto_venta_destino_id || !tipo_stand || !tipo_albaran) {
    return res.status(400).json({ error: 'Fecha, origen, destino, Tipo_Stand y Tipo de Albarán son obligatorios' });
  }
  if (String(punto_venta_origen_id) === String(punto_venta_destino_id)) {
    return res.status(400).json({ error: 'El punto de venta origen y destino no pueden ser el mismo' });
  }
  if (!TIPOS_STAND_VALIDOS.includes(tipo_stand)) {
    return res.status(400).json({ error: 'Tipo_Stand no válido' });
  }
  if (!TIPOS_ALBARAN_VALIDOS.includes(tipo_albaran)) {
    return res.status(400).json({ error: 'Tipo de Albarán no válido' });
  }

  const lineasValidas = (Array.isArray(lineas) ? lineas : []).filter(l => l.producto_id && Number(l.cantidad) > 0);
  if (lineasValidas.length === 0) {
    return res.status(400).json({ error: 'Añade al menos un producto con cantidad mayor que 0' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query('SELECT * FROM albaranes WHERE id = $1', [id]);
    if (!actual.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Albarán no encontrado' });
    }
    const anterior = actual.rows[0];

    // 1) Revierte TODO el movimiento de stock viejo (con el Origen/Destino que tenía antes)
    const detalleAnterior = await client.query('SELECT * FROM albaran_detalle WHERE albaran_id = $1', [id]);
    for (const d of detalleAnterior.rows) {
      if (!d.producto_id) continue;
      await client.query(
        'UPDATE producto_stock SET cantidad = cantidad + $1 WHERE producto_id = $2 AND punto_venta_id = $3',
        [d.cantidad, d.producto_id, anterior.punto_venta_origen_id]
      );
      await client.query(
        'UPDATE producto_stock SET cantidad = cantidad - $1 WHERE producto_id = $2 AND punto_venta_id = $3',
        [d.cantidad, d.producto_id, anterior.punto_venta_destino_id]
      );
    }

    // 2) Borra las líneas viejas
    await client.query('DELETE FROM albaran_detalle WHERE albaran_id = $1', [id]);

    // 3) Calcula las líneas nuevas (precio actual del catálogo) y aplica el movimiento nuevo
    let total = 0;
    for (const linea of lineasValidas) {
      const prodRes = await client.query('SELECT nombre, precio_unitario FROM insumos_productos WHERE id = $1', [linea.producto_id]);
      if (!prodRes.rows[0]) continue;
      const cantidad = Number(linea.cantidad);
      const precio_unitario = Number(prodRes.rows[0].precio_unitario);
      const subtotal = cantidad * precio_unitario;
      total += subtotal;

      await client.query(
        `INSERT INTO albaran_detalle (albaran_id, producto_id, producto_nombre, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, linea.producto_id, prodRes.rows[0].nombre, cantidad, precio_unitario, subtotal]
      );

      await client.query(
        `INSERT INTO producto_stock (producto_id, punto_venta_id, cantidad)
         VALUES ($1, $2, -($3::numeric))
         ON CONFLICT (producto_id, punto_venta_id)
         DO UPDATE SET cantidad = producto_stock.cantidad - $3::numeric`,
        [linea.producto_id, punto_venta_origen_id, cantidad]
      );
      await client.query(
        `INSERT INTO producto_stock (producto_id, punto_venta_id, cantidad)
         VALUES ($1, $2, $3::numeric)
         ON CONFLICT (producto_id, punto_venta_id)
         DO UPDATE SET cantidad = producto_stock.cantidad + $3::numeric`,
        [linea.producto_id, punto_venta_destino_id, cantidad]
      );
    }

    // 4) Actualiza la cabecera
    const actualizado = await client.query(
      `UPDATE albaranes SET
         fecha = $1, punto_venta_origen_id = $2, punto_venta_destino_id = $3,
         tipo_stand = $4, tipo_albaran = $5, total_albaran = $6
       WHERE id = $7
       RETURNING *`,
      [fecha, punto_venta_origen_id, punto_venta_destino_id, tipo_stand, tipo_albaran, total, id]
    );

    await client.query('COMMIT');
    res.json(actualizado.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error PUT /api/albaranes/:id:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Genera el PDF del Albarán con la plantilla ASTRA
app.get('/api/albaranes/:id/pdf', requirePermiso('albaranes'), async (req, res) => {
  const { id } = req.params;
  try {
    const cab = await pool.query(
      `SELECT a.*, u.nombre AS registrado_por_nombre,
              po.nombre AS origen_nombre, pd.nombre AS destino_nombre
       FROM albaranes a
       LEFT JOIN usuarios u ON u.id = a.registrado_por
       LEFT JOIN puntos_venta po ON po.id = a.punto_venta_origen_id
       LEFT JOIN puntos_venta pd ON pd.id = a.punto_venta_destino_id
       WHERE a.id = $1`,
      [id]
    );
    if (!cab.rows[0]) return res.status(404).json({ error: 'Albarán no encontrado' });
    const a = cab.rows[0];

    // Si es un Albarán migrado del histórico con su PDF real guardado, se sirve tal cual
    if (a.pdf_r2_key) {
      const nombreArchivo = `albaran-${id.slice(0, 8)}.pdf`;
      const datosPdf = await leerArchivoR2(a.pdf_r2_key);
      res.set('Content-Type', 'application/pdf');
      if (req.query.download) {
        res.set('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
      } else {
        res.set('Content-Disposition', `inline; filename="${nombreArchivo}"`);
      }
      return res.send(datosPdf);
    }

    const detalle = await pool.query(
      'SELECT * FROM albaran_detalle WHERE albaran_id = $1 ORDER BY producto_nombre ASC',
      [id]
    );

    const nombreArchivo = `albaran-${id.slice(0, 8)}.pdf`;
    res.set('Content-Type', 'application/pdf');
    if (req.query.download) {
      res.set('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    } else {
      res.set('Content-Disposition', `inline; filename="${nombreArchivo}"`);
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // Cabecera
    doc.fontSize(20).font('Helvetica-Bold').text('ASTRA', { align: 'left' });
    doc.fontSize(14).font('Helvetica-Bold').text('ALBARÁN DE ENTREGA');
    doc.moveDown(1);

    const fechaFormateada = a.fecha ? new Date(a.fecha).toLocaleDateString('es-ES') : '-';
    const filasCabecera = [
      ['Nº Albarán:', id],
      ['Fecha:', fechaFormateada],
      ['Punto de Venta Origen:', a.origen_nombre || '-'],
      ['Punto de Venta Destino:', a.destino_nombre || '-'],
      ['Tipo Stand:', a.tipo_stand],
      ['Tipo Albarán:', a.tipo_albaran],
      ['Usuario:', a.registrado_por_nombre || '-']
    ];

    doc.fontSize(10).font('Helvetica');
    filasCabecera.forEach(([label, valor]) => {
      doc.font('Helvetica-Bold').text(label, { continued: true });
      doc.font('Helvetica').text(' ' + valor);
    });
    doc.moveDown(1);

    // Tabla de productos
    const startX = doc.x;
    let y = doc.y;
    const colWidths = [220, 80, 100, 100];
    const headers = ['PRODUCTO', 'CANTIDAD', 'PRECIO UNIT.', 'SUBTOTAL'];

    function dibujarFilaTabla(valores, y, negrita) {
      doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      let x = startX;
      valores.forEach((valor, i) => {
        doc.text(String(valor), x, y, { width: colWidths[i], align: i === 0 ? 'left' : 'right' });
        x += colWidths[i];
      });
    }

    dibujarFilaTabla(headers, y, true);
    y += 18;
    doc.moveTo(startX, y - 4).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y - 4).stroke();

    detalle.rows.forEach(linea => {
      if (y > 720) { // salto de página si no cabe
        doc.addPage();
        y = 50;
      }
      dibujarFilaTabla(
        [linea.producto_nombre, linea.cantidad, Number(linea.precio_unitario).toFixed(2) + ' €', Number(linea.subtotal).toFixed(2) + ' €'],
        y, false
      );
      y += 16;
    });

    y += 10;
    doc.moveTo(startX, y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y).stroke();
    y += 10;

    doc.font('Helvetica-Bold').fontSize(12).text(`TOTAL ALBARÁN: ${Number(a.total_albaran).toFixed(2)} €`, startX, y, { align: 'right', width: colWidths.reduce((a, b) => a + b, 0) });

    doc.fontSize(8).font('Helvetica').text('Documento generado automáticamente por ASTRA', 50, 780, { align: 'center', width: 500 });

    doc.end();
  } catch (err) {
    console.error('Error GET /api/albaranes/:id/pdf:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/albaranes/:id', requirePermiso('albaranes'), async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cab = await client.query('SELECT * FROM albaranes WHERE id = $1', [id]);
    if (!cab.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Albarán no encontrado' });
    }
    const { punto_venta_origen_id, punto_venta_destino_id } = cab.rows[0];

    const detalle = await client.query('SELECT * FROM albaran_detalle WHERE albaran_id = $1', [id]);

    // Revierte el movimiento de stock: devuelve al origen, quita del destino
    for (const d of detalle.rows) {
      if (d.producto_id) {
        await client.query(
          'UPDATE producto_stock SET cantidad = cantidad + $1 WHERE producto_id = $2 AND punto_venta_id = $3',
          [d.cantidad, d.producto_id, punto_venta_origen_id]
        );
        await client.query(
          'UPDATE producto_stock SET cantidad = cantidad - $1 WHERE producto_id = $2 AND punto_venta_id = $3',
          [d.cantidad, d.producto_id, punto_venta_destino_id]
        );
      }
    }

    await client.query('DELETE FROM albaranes WHERE id = $1', [id]); // borra el detalle en cascada
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error DELETE /api/albaranes/:id:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// --- IN-OUT (Fichajes) ---

// Empleado ligado a la cuenta de login actual (o null si el usuario no tiene ficha de empleado)
async function obtenerEmpleadoDeUsuario(usuarioId) {
  const { rows } = await pool.query('SELECT id FROM empleados WHERE usuario_id = $1', [usuarioId]);
  return rows[0] ? rows[0].id : null;
}

function puedeFicharPorOtros(req) {
  return !!(req.session.usuario.es_admin || (req.session.usuario.permisos && req.session.usuario.permisos.inout_terceros));
}

// Puntos de Venta activos (para los botones de arriba)
// Panel de In-Out: quién soy, mi Punto de Venta por defecto, y (si tengo permiso)
// la lista de todos los empleados activos para poder fichar por otro.
app.get('/api/fichajes/mi-panel', requirePermiso('inout'), async (req, res) => {
  try {
    const miEmpleadoId = await obtenerEmpleadoDeUsuario(req.session.usuario.id);
    const puedeTerceros = puedeFicharPorOtros(req);

    if (!miEmpleadoId && !puedeTerceros) {
      return res.status(400).json({ error: 'Tu usuario no tiene una ficha de Empleado asociada. Pide a un administrador que la vincule.' });
    }

    async function estadoDe(empleadoId) {
      const { rows } = await pool.query(
        'SELECT id FROM fichajes WHERE empleado_id = $1 AND hora_salida IS NULL ORDER BY hora_entrada DESC LIMIT 1',
        [empleadoId]
      );
      return rows[0] ? 'SALIDA' : 'ENTRADA';
    }

    let yo = null;
    if (miEmpleadoId) {
      const { rows: miFichaRows } = await pool.query('SELECT id, nombre, punto_venta_id FROM empleados WHERE id = $1', [miEmpleadoId]);
      const miFicha = miFichaRows[0];
      if (miFicha) {
        yo = {
          empleado_id: miFicha.id,
          nombre: miFicha.nombre,
          punto_venta_id: miFicha.punto_venta_id,
          proxima_accion: await estadoDe(miFicha.id)
        };
      }
    }

    let empleados = [];
    if (puedeTerceros) {
      const { rows } = await pool.query('SELECT id, nombre, punto_venta_id FROM empleados WHERE estado = TRUE ORDER BY nombre ASC');
      for (const e of rows) {
        empleados.push({ ...e, proxima_accion: await estadoDe(e.id) });
      }
    }

    res.json({ yo, puede_terceros: puedeTerceros, empleados });
  } catch (err) {
    console.error('Error GET /api/fichajes/mi-panel:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Registra Entrada o Salida (automático según el último fichaje abierto del empleado)
app.post('/api/fichajes', requirePermiso('inout'), async (req, res) => {
  const { empleado_id, punto_venta_id, hora } = req.body;

  if (!empleado_id || !punto_venta_id) {
    return res.status(400).json({ error: 'Empleado y Punto de Venta son obligatorios' });
  }

  const miEmpleadoId = await obtenerEmpleadoDeUsuario(req.session.usuario.id);
  if (empleado_id !== miEmpleadoId && !puedeFicharPorOtros(req)) {
    return res.status(403).json({ error: 'No tienes permiso para fichar por otros empleados' });
  }

  const momento = hora ? new Date(hora) : new Date();
  if (isNaN(momento.getTime())) {
    return res.status(400).json({ error: 'Hora no válida' });
  }

  try {
    const abierto = await pool.query(
      `SELECT id, hora_entrada FROM fichajes WHERE empleado_id = $1 AND hora_salida IS NULL ORDER BY hora_entrada DESC LIMIT 1`,
      [empleado_id]
    );

    if (abierto.rows[0]) {
      // Cierra el turno abierto con la Salida — nunca antes de su propia Entrada
      if (momento < new Date(abierto.rows[0].hora_entrada)) {
        return res.status(400).json({
          error: 'La hora de Salida no puede ser anterior a la hora de Entrada de ese turno. Corrígelo desde Editar en el listado si hace falta.'
        });
      }
      const { rows } = await pool.query(
        `UPDATE fichajes SET hora_salida = $1 WHERE id = $2 RETURNING *`,
        [momento.toISOString(), abierto.rows[0].id]
      );
      return res.json({ ...rows[0], tipo: 'SALIDA' });
    } else {
      // Abre un turno nuevo con la Entrada
      const { rows } = await pool.query(
        `INSERT INTO fichajes (empleado_id, punto_venta_id, fecha, hora_entrada, registrado_por)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [empleado_id, punto_venta_id, momento.toISOString().slice(0, 10), momento.toISOString(), req.session.usuario.id]
      );
      return res.json({ ...rows[0], tipo: 'ENTRADA' });
    }
  } catch (err) {
    console.error('Error POST /api/fichajes:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/fichajes', requirePermiso('inout'), async (req, res) => {
  try {
    let query = `SELECT f.*, e.nombre AS empleado_nombre, pv.nombre AS punto_venta_nombre,
              u.nombre AS registrado_por_nombre
       FROM fichajes f
       LEFT JOIN empleados e ON e.id = f.empleado_id
       LEFT JOIN puntos_venta pv ON pv.id = f.punto_venta_id
       LEFT JOIN usuarios u ON u.id = f.registrado_por`;
    const params = [];

    // Solo el administrador ve el listado completo; el resto solo ve lo suyo.
    if (!req.session.usuario.es_admin) {
      const miEmpleadoId = await obtenerEmpleadoDeUsuario(req.session.usuario.id);
      params.push(miEmpleadoId);
      query += ` WHERE f.empleado_id = $${params.length}`;
    }

    query += ' ORDER BY f.hora_entrada DESC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/fichajes:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/fichajes/:id', requirePermiso('inout'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM fichajes WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Fichaje no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error GET /api/fichajes/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/fichajes/:id', requirePermiso('inout'), async (req, res) => {
  const { id } = req.params;
  const { empleado_id, punto_venta_id, hora_entrada, hora_salida } = req.body;

  if (!empleado_id || !punto_venta_id || !hora_entrada) {
    return res.status(400).json({ error: 'Empleado, Punto de Venta y Hora de Entrada son obligatorios' });
  }
  if (hora_salida && new Date(hora_salida) < new Date(hora_entrada)) {
    return res.status(400).json({ error: 'La hora de Salida no puede ser anterior a la hora de Entrada' });
  }

  try {
    const actual = await pool.query('SELECT empleado_id FROM fichajes WHERE id = $1', [id]);
    if (!actual.rows[0]) return res.status(404).json({ error: 'Fichaje no encontrado' });

    const miEmpleadoId = await obtenerEmpleadoDeUsuario(req.session.usuario.id);
    const esPropio = actual.rows[0].empleado_id === miEmpleadoId && empleado_id === miEmpleadoId;
    if (!esPropio && !puedeFicharPorOtros(req)) {
      return res.status(403).json({ error: 'No tienes permiso para editar fichajes de otros empleados' });
    }

    const { rows } = await pool.query(
      `UPDATE fichajes SET
         empleado_id = $1, punto_venta_id = $2, fecha = $3, hora_entrada = $4, hora_salida = $5
       WHERE id = $6
       RETURNING *`,
      [empleado_id, punto_venta_id, hora_entrada.slice(0, 10), hora_entrada, hora_salida || null, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/fichajes/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/fichajes/:id', requirePermiso('inout'), async (req, res) => {
  const { id } = req.params;
  try {
    const actual = await pool.query('SELECT empleado_id FROM fichajes WHERE id = $1', [id]);
    if (!actual.rows[0]) return res.status(404).json({ error: 'Fichaje no encontrado' });

    const miEmpleadoId = await obtenerEmpleadoDeUsuario(req.session.usuario.id);
    const esPropio = actual.rows[0].empleado_id === miEmpleadoId;
    if (!esPropio && !puedeFicharPorOtros(req)) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar fichajes de otros empleados' });
    }

    await pool.query('DELETE FROM fichajes WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/fichajes/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Migración de archivos ya guardados en Postgres hacia Cloudflare R2 (solo administrador) ---
async function migrarTablaAR2(tabla, columnaData, columnaMime, columnaNombre, columnaR2Key, carpeta) {
  const { rows } = await pool.query(
    `SELECT id, ${columnaData} AS data, ${columnaMime} AS mime, ${columnaNombre} AS nombre
     FROM ${tabla} WHERE ${columnaData} IS NOT NULL AND ${columnaR2Key} IS NULL`
  );

  let migrados = 0;
  let errores = 0;

  for (const fila of rows) {
    try {
      const r2Key = await subirArchivoR2(carpeta, fila.nombre || 'archivo', fila.data, fila.mime || 'application/octet-stream');
      await pool.query(
        `UPDATE ${tabla} SET ${columnaR2Key} = $1, ${columnaData} = NULL WHERE id = $2`,
        [r2Key, fila.id]
      );
      migrados++;
    } catch (err) {
      console.error(`Error migrando ${tabla} id=${fila.id} a R2:`, err.message);
      errores++;
    }
  }

  return { total: rows.length, migrados, errores };
}

function requireAdminSolo(req, res, next) {
  if (!req.session || !req.session.usuario) return res.status(401).json({ error: 'No autenticado' });
  if (!req.session.usuario.es_admin) return res.status(403).json({ error: 'Solo un administrador puede ejecutar esto' });
  next();
}

app.post('/api/admin/migrar-r2/empleados', requireAdminSolo, async (req, res) => {
  try {
    const resultado = await migrarTablaAR2('empleados', 'foto_dni_data', 'foto_dni_mime', 'foto_dni_nombre_original', 'foto_dni_r2_key', 'empleados/foto-dni');
    res.json(resultado);
  } catch (err) {
    console.error('Error migrando empleados a R2:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/migrar-r2/ingresos', requireAdminSolo, async (req, res) => {
  try {
    const resultado = await migrarTablaAR2('ingresos', 'comprobante_data', 'comprobante_mime', 'comprobante_nombre_original', 'comprobante_r2_key', 'ingresos/comprobante');
    res.json(resultado);
  } catch (err) {
    console.error('Error migrando ingresos a R2:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/migrar-r2/gastos-tarjeta', requireAdminSolo, async (req, res) => {
  try {
    const resultado = await migrarTablaAR2('gastos_tarjeta', 'factura_data', 'factura_mime', 'factura_nombre_original', 'factura_r2_key', 'gastos-tarjeta/factura');
    res.json(resultado);
  } catch (err) {
    console.error('Error migrando gastos_tarjeta a R2:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/migrar-r2/factura-cash', requireAdminSolo, async (req, res) => {
  try {
    const resultado = await migrarTablaAR2('factura_cash', 'factura_data', 'factura_mime', 'factura_nombre_original', 'factura_r2_key', 'factura-cash/factura');
    res.json(resultado);
  } catch (err) {
    console.error('Error migrando factura_cash a R2:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
