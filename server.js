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
  const { nombre } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO puntos_venta (nombre, activo) VALUES ($1, TRUE) RETURNING *',
      [nombre]
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
  const { fecha, punto_venta, total_efectivo, total_tarjeta, observaciones } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO cierres (fecha, punto_venta, total_efectivo, total_tarjeta, observaciones) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [fecha, punto_venta, total_efectivo, total_tarjeta, observaciones]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/cierres:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- USUARIOS / EMPLEADOS ---

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));