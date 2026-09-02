import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Conexión directa por PostgreSQL URI (DATABASE_URL de Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const parseId = (val) => {
  if (val === null || val === undefined || val === '') return null;
  return isNaN(val) ? val : parseInt(val, 10);
};

// ==========================================
// RUTAS API
// ==========================================

app.get('/api/puntos-venta', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM astra_festum.puntos_venta ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/puntos-venta:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/empleados', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM astra_festum.empleados ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/empleados:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cierres', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM astra_festum.cierres ORDER BY fecha DESC');
    res.json(rows);
  } catch (err) {
    console.error('Error GET /api/cierres:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cierre', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      pdv_origen_id,
      fecha,
      total_efectivo,
      total_tarjeta,
      observaciones,
      gastos,
      adelantos
    } = req.body;

    if (!pdv_origen_id || total_efectivo === undefined || total_tarjeta === undefined) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Faltan datos obligatorios en el cierre' });
    }

    const pdvOrigenParsed = parseId(pdv_origen_id);

    // 1. Insertar Cierre
    const queryCierre = `
      INSERT INTO astra_festum.cierres (pdv_id, fecha, total_efectivo, total_tarjeta, observaciones)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id;
    `;
    const valuesCierre = [
      pdvOrigenParsed,
      fecha || new Date().toISOString(),
      parseFloat(total_efectivo) || 0,
      parseFloat(total_tarjeta) || 0,
      observaciones || ''
    ];

    const resCierre = await client.query(queryCierre, valuesCierre);
    const cierreId = resCierre.rows[0].id;

    // 2. Insertar Gastos
    if (gastos && Array.isArray(gastos) && gastos.length > 0) {
      for (const g of gastos) {
        const queryGasto = `
          INSERT INTO astra_festum.gastos (cierre_id, pdv_origen_id, pdv_destino_id, monto, concepto)
          VALUES ($1, $2, $3, $4, $5);
        `;
        await client.query(queryGasto, [
          cierreId,
          pdvOrigenParsed,
          parseId(g.pdv_destino_id) || pdvOrigenParsed,
          parseFloat(g.monto) || 0,
          g.concepto || 'Gasto vario'
        ]);
      }
    }

    // 3. Insertar Adelantos
    if (adelantos && Array.isArray(adelantos) && adelantos.length > 0) {
      for (const a of adelantos) {
        const queryAdelanto = `
          INSERT INTO astra_festum.adelantos (cierre_id, pdv_origen_id, pdv_destino_id, empleado_id, monto, observaciones)
          VALUES ($1, $2, $3, $4, $5, $6);
        `;
        await client.query(queryAdelanto, [
          cierreId,
          pdvOrigenParsed,
          parseId(a.pdv_destino_id) || pdvOrigenParsed,
          parseId(a.empleado_id),
          parseFloat(a.monto) || 0,
          a.observaciones || ''
        ]);
      }
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Cierre registrado correctamente',
      cierre_id: cierreId
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en POST /api/cierre:', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.listen(port, () => {
  console.log(`Servidor Astra Festum activo en el puerto ${port}`);
});