import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: 'astra_festum' } }
);

// Registrar Cierre
app.post('/api/cierre-caja', async (req, res) => {
  try {
    const { fecha, punto_venta, usuario_email, total_efectivo, total_tarjeta, observaciones, adelantos, gastos } = req.body;

    const { data: venta, error: ventaErr } = await supabase
      .from('ventas_diarias')
      .insert([{ fecha, punto_venta, usuario_email, total_efectivo, total_tarjeta, observaciones }])
      .select()
      .single();

    if (ventaErr) throw ventaErr;

    if (adelantos && adelantos.length > 0) {
      const adelantosFormatted = adelantos.map(a => ({ ...a, venta_id: venta.id }));
      const { error: adErr } = await supabase.from('adelantos_empleados').insert(adelantosFormatted);
      if (adErr) throw adErr;
    }

    if (gastos && gastos.length > 0) {
      const gastosFormatted = gastos.map(g => ({ ...g, venta_id: venta.id }));
      const { error: gErr } = await supabase.from('gastos_caja').insert(gastosFormatted);
      if (gErr) throw gErr;
    }

    res.json({ success: true, id: venta.id });
  } catch (err) {
    console.error('Error en /api/cierre-caja:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Obtener Histórico de Cierres
app.get('/api/cierres', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('ventas_diarias')
      .select('*, adelantos_empleados(*), gastos_caja(*)')
      .order('fecha', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error al obtener cierres:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('Servidor Astra Festum activo en puerto ' + PORT);
});