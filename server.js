import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Cliente básico sin la opción db.schema global
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Registrar Cierre
app.post('/api/cierre-caja', async (req, res) => {
  try {
    const { fecha, punto_venta, usuario_email, total_efectivo, total_tarjeta, observaciones, adelantos, gastos } = req.body;

    const { data: venta, error: ventaErr } = await supabase
      .schema('astra_festum')
      .from('ventas_diarias')
      .insert([{ fecha, punto_venta, usuario_email, total_efectivo, total_tarjeta, observaciones }])
      .select()
      .single();

    if (ventaErr) throw ventaErr;

    if (adelantos && adelantos.length > 0) {
      const adelantosFormatted = adelantos.map(a => ({ ...a, venta_id: venta.id }));
      const { error: adErr } = await supabase
        .schema('astra_festum')
        .from('adelantos_empleados')
        .insert(adelantosFormatted);
      if (adErr) throw adErr;
    }

    if (gastos && gastos.length > 0) {
      const gastosFormatted = gastos.map(g => ({ ...g, venta_id: venta.id }));
      const { error: gErr } = await supabase
        .schema('astra_festum')
        .from('gastos_caja')
        .insert(gastosFormatted);
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
    const { data: ventas, error: vErr } = await supabase
      .schema('astra_festum')
      .from('ventas_diarias')
      .select('*')
      .order('fecha', { ascending: false });

    if (vErr) throw vErr;

    const { data: adelantos, error: aErr } = await supabase
      .schema('astra_festum')
      .from('adelantos_empleados')
      .select('*');

    if (aErr) throw aErr;

    const { data: gastos, error: gErr } = await supabase
      .schema('astra_festum')
      .from('gastos_caja')
      .select('*');

    if (gErr) throw gErr;

    const result = (ventas || []).map(v => ({
      ...v,
      adelantos_empleados: (adelantos || []).filter(a => a.venta_id === v.id),
      gastos_caja: (gastos || []).filter(g => g.venta_id === v.id)
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Error al obtener cierres:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('Servidor Astra Festum activo en puerto ' + PORT);
});