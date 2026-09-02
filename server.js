import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Faltan las variables de entorno de Supabase.');
  process.exit(1);
}

// Configuración de cliente Supabase con el esquema astra_festum
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'astra_festum' },
  global: {
    headers: {
      'Accept-Profile': 'astra_festum',
      'Content-Profile': 'astra_festum'
    }
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
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
    const { data, error } = await supabase
      .schema('astra_festum')
      .from('puntos_venta')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error GET /api/puntos-venta:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/empleados', async (req, res) => {
  try {
    const { data, error } = await supabase
      .schema('astra_festum')
      .from('empleados')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error GET /api/empleados:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cierres', async (req, res) => {
  try {
    const { data, error } = await supabase
      .schema('astra_festum')
      .from('cierres')
      .select('*')
      .order('fecha', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error GET /api/cierres:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

    // 1. Insertar Cierre
    const { data: cierreData, error: cierreError } = await supabase
      .schema('astra_festum')
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
      console.error('Error Supabase Cierres:', cierreError);
      return res.status(500).json({ error: `Cierres: ${cierreError.message}` });
    }

    const cierreId = cierreData.id;

    // 2. Insertar Gastos
    if (gastos && Array.isArray(gastos) && gastos.length > 0) {
      const gastosFormateados = gastos.map(g => ({
        cierre_id: cierreId,
        pdv_origen_id: pdvOrigenParsed,
        pdv_destino_id: parseId(g.pdv_destino_id) || pdvOrigenParsed,
        monto: parseFloat(g.monto) || 0,
        concepto: g.concepto || 'Gasto vario'
      }));

      const { error: gastosError } = await supabase
        .schema('astra_festum')
        .from('gastos')
        .insert(gastosFormateados);

      if (gastosError) {
        console.error('Error Supabase Gastos:', gastosError);
        return res.status(500).json({ error: `Gastos: ${gastosError.message}` });
      }
    }

    // 3. Insertar Adelantos
    if (adelantos && Array.isArray(adelantos) && adelantos.length > 0) {
      const adelantosFormateados = adelantos.map(a => ({
        cierre_id: cierreId,
        pdv_origen_id: pdvOrigenParsed,
        pdv_destino_id: parseId(a.pdv_destino_id) || pdvOrigenParsed,
        empleado_id: parseId(a.empleado_id),
        monto: parseFloat(a.monto) || 0,
        observaciones: a.observaciones || ''
      }));

      const { error: adelantosError } = await supabase
        .schema('astra_festum')
        .from('adelantos')
        .insert(adelantosFormateados);

      if (adelantosError) {
        console.error('Error Supabase Adelantos:', adelantosError);
        return res.status(500).json({ error: `Adelantos: ${adelantosError.message}` });
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Cierre registrado correctamente',
      cierre_id: cierreId
    });

  } catch (err) {
    console.error('Error en POST /api/cierre:', err);
    return res.status(500).json({ error: err.message || 'Error interno en el servidor' });
  }
});

// ==========================================
// SERVIDOR
// ==========================================
const server = app.listen(port, () => {
  console.log(`Servidor Astra Festum activo en el puerto ${port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Puerto ${port} ocupado.`);
  } else {
    console.error('Error servidor:', err);
  }
});