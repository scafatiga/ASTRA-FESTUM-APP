import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = process.env.PORT || 10000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Supabase Setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Faltan las variables de entorno de Supabase.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const db = supabase.schema('astra_festum');

// Helper para parsear IDs (Integer o conservar String si es UUID)
const parseId = (val) => {
  if (val === null || val === undefined || val === '') return null;
  return isNaN(val) ? val : parseInt(val, 10);
};

// ==========================================
// ENDPOINTS API
// ==========================================

// 1. Obtener Puntos de Venta
app.get('/api/puntos-venta', async (req, res) => {
  try {
    const { data, error } = await db
      .from('puntos_venta')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error en GET /api/puntos-venta:', err.message);
    res.status(500).json({ error: err.message || 'Error al obtener puntos de venta' });
  }
});

// 2. Obtener Empleados
app.get('/api/empleados', async (req, res) => {
  try {
    const { data, error } = await db
      .from('empleados')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error en GET /api/empleados:', err.message);
    res.status(500).json({ error: err.message || 'Error al obtener empleados' });
  }
});

// 3. Obtener Histórico de Cierres
app.get('/api/cierres', async (req, res) => {
  try {
    const { data, error } = await db
      .from('cierres')
      .select('*')
      .order('fecha', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error en GET /api/cierres:', err.message);
    res.status(500).json({ error: err.message || 'Error al obtener el histórico' });
  }
});

// 4. Registrar Cierre de Caja
app.post('/api/cierre', async (req, res) => {
  try {
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
      return res.status(400).json({ error: 'Faltan datos obligatorios en el cierre' });
    }

    const pdvOrigenParsed = parseId(pdv_origen_id);

    // A. Insertar Cierre
    const { data: cierreData, error: cierreError } = await db
      .from('cierres')
      .insert([
        {
          pdv_id: pdvOrigenParsed,
          fecha: fecha || new Date().toISOString(),
          total_efectivo: parseFloat(total_efectivo) || 0,
          total_tarjeta: parseFloat(total_tarjeta) || 0,
          observaciones: observaciones || ''
        }
      ])
      .select('id')
      .single();

    if (cierreError) {
      console.error('Error insertando cierre:', cierreError);
      return res.status(500).json({ error: `Error en Cierres: ${cierreError.message} (${cierreError.details || cierreError.hint || ''})` });
    }

    const cierreId = cierreData.id;

    // B. Insertar Gastos
    if (gastos && Array.isArray(gastos) && gastos.length > 0) {
      const gastosFormateados = gastos.map(g => ({
        cierre_id: cierreId,
        pdv_origen_id: pdvOrigenParsed,
        pdv_destino_id: parseId(g.pdv_destino_id) || pdvOrigenParsed,
        monto: parseFloat(g.monto) || 0,
        concepto: g.concepto || 'Gasto vario'
      }));

      const { error: gastosError } = await db
        .from('gastos')
        .insert(gastosFormateados);

      if (gastosError) {
        console.error('Error insertando gastos:', gastosError);
        return res.status(500).json({ error: `Error en Gastos: ${gastosError.message} (${gastosError.details || gastosError.hint || ''})` });
      }
    }

    // C. Insertar Adelantos
    if (adelantos && Array.isArray(adelantos) && adelantos.length > 0) {
      const adelantosFormateados = adelantos.map(a => ({
        cierre_id: cierreId,
        pdv_origen_id: pdvOrigenParsed,
        pdv_destino_id: parseId(a.pdv_destino_id) || pdvOrigenParsed,
        empleado_id: parseId(a.empleado_id),
        monto: parseFloat(a.monto) || 0,
        observaciones: a.observaciones || ''
      }));

      const { error: adelantosError } = await db
        .from('adelantos')
        .insert(adelantosFormateados);

      if (adelantosError) {
        console.error('Error insertando adelantos:', adelantosError);
        return res.status(500).json({ error: `Error en Adelantos: ${adelantosError.message} (${adelantosError.details || adelantosError.hint || ''})` });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Cierre registrado correctamente',
      cierre_id: cierreId
    });

  } catch (err) {
    console.error('Error no controlado en POST /api/cierre:', err);
    res.status(500).json({ error: err.message || 'Error interno en el servidor' });
  }
});

app.listen(port, () => {
  console.log(`Servidor Astra Festum activo en puerto ${port}`);
});