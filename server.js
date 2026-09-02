import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = process.env.PORT || 10000;

// Configuración de Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Servir archivos estáticos como cierre.html

// Inicialización de Supabase con Service Role Key
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Helper para interactuar exclusivamente con el esquema astra_festum
const db = supabase.schema('astra_festum');

// ==========================================
// ENDPOINTS API
// ==========================================

// 1. Obtener lista de Puntos de Venta (PDVs) activos
app.get('/api/puntos-venta', async (req, res) => {
  try {
    const { data, error } = await db
      .from('puntos_venta')
      .select('id, nombre, activo')
      .eq('activo', true)
      .order('nombre', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error en GET /api/puntos-venta:', err.message);
    res.status(500).json({ error: 'Error al obtener los puntos de venta' });
  }
});

// 2. Obtener lista de Empleados activos
app.get('/api/empleados', async (req, res) => {
  try {
    const { data, error } = await db
      .from('empleados')
      .select('id, nombre, apellidos, activo')
      .eq('activo', true)
      .order('nombre', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error en GET /api/empleados:', err.message);
    res.status(500).json({ error: 'Error al obtener la lista de empleados' });
  }
});

// 3. Procesar Cierre de Caja con Gastos y Adelantos Cruzados
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

    // Validación básica de campos requeridos
    if (!pdv_origen_id || total_efectivo === undefined || total_tarjeta === undefined) {
      return res.status(400).json({ error: 'Faltan datos obligatorios en el cierre' });
    }

    // A. Insertar cabecera del Cierre
    const { data: cierreData, error: cierreError } = await db
      .from('cierres')
      .insert([
        {
          pdv_id: pdv_origen_id,
          fecha: fecha || new Date().toISOString(),
          total_efectivo,
          total_tarjeta,
          observaciones
        }
      ])
      .select('id')
      .single();

    if (cierreError) throw cierreError;

    const cierreId = cierreData.id;

    // B. Insertar Gastos (asociando caja origen y PDV destino imputado)
    if (gastos && Array.isArray(gastos) && gastos.length > 0) {
      const gastosFormateados = gastos.map(g => ({
        cierre_id: cierreId,
        pdv_origen_id: pdv_origen_id,
        pdv_destino_id: g.pdv_destino_id || pdv_origen_id,
        monto: g.monto,
        concepto: g.concepto
      }));

      const { error: gastosError } = await db
        .from('gastos')
        .insert(gastosFormateados);

      if (gastosError) throw gastosError;
    }

    // C. Insertar Adelantos/Abonos de Empleados (caja origen y PDV/empleado imputado)
    if (adelantos && Array.isArray(adelantos) && adelantos.length > 0) {
      const adelantosFormateados = adelantos.map(a => ({
        cierre_id: cierreId,
        pdv_origen_id: pdv_origen_id,
        pdv_destino_id: a.pdv_destino_id || pdv_origen_id,
        empleado_id: a.empleado_id,
        monto: a.monto,
        observaciones: a.observaciones || ''
      }));

      const { error: adelantosError } = await db
        .from('adelantos')
        .insert(adelantosFormateados);

      if (adelantosError) throw adelantosError;
    }

    // Respuesta exitosa
    res.status(201).json({
      success: true,
      message: 'Cierre registrado correctamente',
      cierre_id: cierreId
    });

  } catch (err) {
    console.error('Error en POST /api/cierre:', err.message);
    res.status(500).json({ error: 'Error interno al registrar el cierre de caja' });
  }
});

// Inicialización del servidor
app.listen(port, () => {
  console.log(`Servidor Astra Festum activo en puerto ${port}`);
});