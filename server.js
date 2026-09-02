require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: 'astra_festum' } }
);

app.post('/api/cierre-caja', async (req, res) => {
  const { fecha, punto_venta, usuario_email, total_efectivo, total_tarjeta, observaciones, adelantos, gastos } = req.body;

  try {
    const { data: venta, error: errVenta } = await supabase
      .from('ventas_diarias')
      .insert([{ fecha, punto_venta, usuario_email, total_efectivo, total_tarjeta, observaciones }])
      .select()
      .single();

    if (errVenta) throw errVenta;

    if (adelantos && adelantos.length > 0) {
      const listaAdelantos = adelantos.map(a => ({
        venta_id: venta.id,
        fecha,
        punto_venta,
        empleado_nombre: a.empleado_nombre,
        importe: a.importe
      }));
      const { error: errAdelantos } = await supabase.from('adelantos_empleados').insert(listaAdelantos);
      if (errAdelantos) throw errAdelantos;
    }

    if (gastos && gastos.length > 0) {
      const listaGastos = gastos.map(g => ({
        venta_id: venta.id,
        fecha,
        punto_venta,
        proveedor_nombre: g.proveedor_nombre || null,
        concepto: g.concepto,
        importe: g.importe,
        metodo_pago: g.metodo_pago || 'EFECTIVO'
      }));
      const { error: errGastos } = await supabase.from('gastos_caja').insert(listaGastos);
      if (errGastos) throw errGastos;
    }

    res.status(200).json({ success: true, message: 'Cierre registrado correctamente', venta_id: venta.id });
  } catch (err) {
    console.error('Error al guardar cierre:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(Servidor Astra Festum activo en puerto \));