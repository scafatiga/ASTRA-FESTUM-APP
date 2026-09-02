import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- PUNTOS DE VENTA ---

app.get('/api/puntos-venta', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM puntos_venta WHERE activo = TRUE ORDER BY nombre ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/puntos-venta/todos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM puntos_venta ORDER BY nombre ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/puntos-venta', async (req, res) => {
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

app.patch('/api/puntos-venta/:id/estado', async (req, res) => {
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

app.get('/api/cierres', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cierres ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/cierres:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cierres', async (req, res) => {
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

app.get('/api/usuarios', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM usuarios ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/usuarios:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/empleados', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM usuarios ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/empleados:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- PERSONAL (ficha completa de empleado, tabla "empleados") ---

app.get('/api/personal', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM empleados ORDER BY nombre ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/personal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/personal', async (req, res) => {
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
    direccion,
    email,
    foto_dni,
    estado
  } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'Falta el nombre del empleado' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO empleados
        (usuario_id, nombre, dni, numero_seguridad_social, nacionalidad, fecha_nacimiento,
         iban, domicilio, fecha_in, fecha_out, horas_alta, punto_venta_id, direccion,
         email, foto_dni, estado)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE($16, TRUE))
       RETURNING *`,
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
        direccion || null,
        email || null,
        foto_dni || null,
        estado
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/personal:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/personal/:id/estado', async (req, res) => {
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

// --- PROVEEDORES ---

app.get('/api/proveedores', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM proveedores WHERE activo = TRUE ORDER BY nombre_proveedor ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/proveedores:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/proveedores/todos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM proveedores ORDER BY nombre_proveedor ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/proveedores/todos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/proveedores', async (req, res) => {
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

app.patch('/api/proveedores/:id/estado', async (req, res) => {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));