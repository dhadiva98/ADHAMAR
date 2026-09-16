// ===========================================================================
//  REPORTES Y EXPORTACIÓN
//  Los datos se piden a Supabase en el momento de exportar. El Excel es
//  siempre una salida, nunca una fuente de información.
// ===========================================================================
import { hoy, sumarDias, fechaCorta, hora12, monto, numero, escapar, mensajeError } from './core.js';
import { $, avisar, esqueleto, vacio } from './ui.js';
import * as D from './datos.js';

const RANGOS = {
  hoy:     () => [hoy(), hoy()],
  ayer:    () => [sumarDias(hoy(), -1), sumarDias(hoy(), -1)],
  semana:  () => [sumarDias(hoy(), -6), hoy()],
  mes:     () => [hoy().slice(0, 8) + '01', hoy()]
};

export async function vistaReportes() {
  const v = $('#vista');
  const [d0, h0] = RANGOS.mes();

  v.innerHTML = `
    <div class="barra-acciones">
      ${Object.keys(RANGOS).map(k => `<button class="btn btn--neutro" data-rango="${k}">
        ${({ hoy: 'Hoy', ayer: 'Ayer', semana: 'Esta semana', mes: 'Este mes' })[k]}</button>`).join('')}
    </div>
    <div class="panel" style="margin-bottom:18px"><div class="panel__cuerpo">
      <div class="fila">
        <label class="campo"><span>Desde</span><input type="date" id="r-desde" value="${d0}"></label>
        <label class="campo"><span>Hasta</span><input type="date" id="r-hasta" value="${h0}"></label>
      </div>
      <button class="btn btn--principal btn--bloque" id="r-ver">Ver reporte</button>
    </div></div>
    <div id="r-salida">${esqueleto(5)}</div>`;

  v.querySelectorAll('[data-rango]').forEach(b => b.onclick = () => {
    const [a, z] = RANGOS[b.dataset.rango]();
    $('#r-desde').value = a; $('#r-hasta').value = z; generar();
  });
  $('#r-ver').onclick = generar;
  generar();
}

async function generar() {
  const salida = $('#r-salida');
  const desde = $('#r-desde').value, hasta = $('#r-hasta').value;
  salida.innerHTML = esqueleto(5);

  try {
    const regs = (await D.historial({ desde, hasta, estado: 'atendido', limite: 2000 }))
                   .filter(r => !r.anulado);
    if (!regs.length) { salida.innerHTML = vacio('No hay atenciones en ese rango.'); return; }

    const suma  = (f) => regs.reduce((s, r) => s + numero(f(r)), 0);
    const ref   = suma(r => r.precio_referencial);
    const desc  = suma(r => r.descuento);
    const real  = suma(r => r.precio_cobrado);
    const porPago = f => regs.filter(r => r.forma_pago === f).reduce((s, r) => s + numero(r.precio_cobrado), 0);

    // Servicios más vendidos
    const porServicio = {};
    regs.forEach(r => {
      const n = r.servicio?.nombre_completo || r.servicio_nombre_snapshot || 'Sin servicio';
      porServicio[n] = (porServicio[n] || 0) + 1;
    });

    // Rendimiento por masajista.
    // OJO: cuando dos masajistas hacen un masaje, el monto se atribuye COMPLETO
    // a cada una. La suma de esta columna NO equivale a las ventas totales.
    const porMasajista = {};
    regs.forEach(r => (r.masajistas || []).forEach(m => {
      const n = m.masajista && !m.masajista.eliminada
        ? `${m.masajista.nombre} ${m.masajista.apellido || ''}`.trim()
        : m.masajista_nombre_snapshot;
      porMasajista[n] ||= { servicios: 0, ref: 0, desc: 0, cobrado: 0 };
      porMasajista[n].servicios++;
      porMasajista[n].ref     += numero(r.precio_referencial);
      porMasajista[n].desc    += numero(r.descuento);
      porMasajista[n].cobrado += numero(r.precio_cobrado);
    }));

    salida.innerHTML = `
      <div class="rejilla">
        <div class="metrica destacada"><span class="eyebrow">Ventas reales</span><b>${monto(real)}</b></div>
        <div class="metrica"><span class="eyebrow">Servicios</span><b>${regs.length}</b></div>
        <div class="metrica"><span class="eyebrow">Ticket promedio</span><b>${monto(real / regs.length)}</b></div>
        <div class="metrica"><span class="eyebrow">Descuentos</span><b>${monto(desc)}</b></div>
      </div>

      <div class="panel">
        <div class="panel__cabecera"><span class="eyebrow">Cómo pagaron</span></div>
        <div class="panel__cuerpo"><div class="tarifa" style="margin:0">
          <div class="tarifa__linea"><span>Efectivo</span><span>${monto(porPago('efectivo'))}</span></div>
          <div class="tarifa__linea"><span>Tarjeta</span><span>${monto(porPago('tarjeta'))}</span></div>
          <div class="tarifa__linea"><span>Yape</span><span>${monto(porPago('yape'))}</span></div>
          <div class="tarifa__linea"><span>Ventas referenciales</span><span>${monto(ref)}</span></div>
        </div></div>
      </div>

      <div class="panel">
        <div class="panel__cabecera"><span class="eyebrow">Rendimiento por masajista</span></div>
        <div class="tabla-envoltura"><table>
          <thead><tr><th>Masajista</th><th class="num">Servicios</th><th class="num">Referencial</th>
            <th class="num">Descuentos</th><th class="num">Cobrado</th></tr></thead>
          <tbody>${Object.entries(porMasajista)
            .sort((a, b) => b[1].servicios - a[1].servicios)
            .map(([n, d]) => `<tr><td>${escapar(n)}</td><td class="num">${d.servicios}</td>
              <td class="num">${monto(d.ref)}</td><td class="num">${monto(d.desc)}</td>
              <td class="num"><strong>${monto(d.cobrado)}</strong></td></tr>`).join('')}</tbody>
        </table></div>
        <div class="panel__cuerpo" style="border-top:1px solid var(--borde)">
          <p class="ayuda" style="margin:0">Cuando dos masajistas atienden juntas, el monto se cuenta
             completo para cada una. Por eso la suma de esta columna no es el total de ventas del período,
             que es ${monto(real)}.</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel__cabecera"><span class="eyebrow">Servicios más vendidos</span></div>
        <div class="tabla-envoltura"><table>
          <thead><tr><th>Servicio</th><th class="num">Veces</th></tr></thead>
          <tbody>${Object.entries(porServicio).sort((a, b) => b[1] - a[1]).slice(0, 15)
            .map(([n, c]) => `<tr><td>${escapar(n)}</td><td class="num">${c}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="barra-acciones" style="margin-top:20px">
        <button class="btn btn--neutro" id="x-ventas">Descargar ventas</button>
        <button class="btn btn--neutro" id="x-clientes">Descargar clientes</button>
        <button class="btn btn--neutro" id="x-asistencia">Descargar asistencia</button>
      </div>`;

    $('#x-ventas').onclick = () => exportarVentas(regs, desde, hasta);
    $('#x-clientes').onclick = exportarClientes;
    $('#x-asistencia').onclick = () => exportarAsistencia(desde, hasta);
  } catch (ex) { salida.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
}

// ---------------------------------------------------------------------------
function descargar(filas, nombreHoja, archivo) {
  const hoja = XLSX.utils.json_to_sheet(filas);
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja);
  XLSX.writeFile(libro, archivo);
  avisar('Archivo descargado', 'exito');
}

function exportarVentas(regs, desde, hasta) {
  descargar(regs.map(r => ({
    Fecha: fechaCorta(r.fecha),
    Hora: hora12(r.hora_ingreso?.slice(0, 5)) || '',
    Cliente: r.cliente?.nombre || r.cliente_texto || '',
    Servicio: r.servicio?.nombre_completo || r.servicio_nombre_snapshot || '',
    Masajista: (r.masajistas || []).map(m => m.masajista && !m.masajista.eliminada
      ? `${m.masajista.nombre} ${m.masajista.apellido || ''}`.trim()
      : m.masajista_nombre_snapshot).join(' | '),
    'Precio referencial': numero(r.precio_referencial),
    Descuento: numero(r.descuento),
    'Precio cobrado': numero(r.precio_cobrado),
    'Forma de pago': r.forma_pago || 'No registrado',
    Vuelto: numero(r.vuelto),
    'Vuelto por': r.vuelto_metodo || '',
    Notas: r.notas || ''
  })), 'Ventas', `ventas_${desde}_${hasta}.xlsx`);
}

async function exportarClientes() {
  try {
    const cs = await D.clientes();
    descargar(cs.map(c => ({
      ID: c.id, Nombre: c.nombre || '', Teléfono: c.telefono || '',
      'Fecha de registro': fechaCorta(c.created_at?.slice(0, 10)),
      Visitas: c.visitas, 'Última visita': c.ultima_visita ? fechaCorta(c.ultima_visita) : '',
      VIP: c.vip ? 'Sí' : 'No', Observaciones: c.observaciones || ''
    })), 'Clientes', `clientes_${hoy()}.xlsx`);
  } catch (ex) { avisar(mensajeError(ex), 'error'); }
}

async function exportarAsistencia(desde, hasta) {
  try {
    const as = await D.asistenciasRango(desde, hasta);
    descargar(as.map(a => ({
      Fecha: fechaCorta(a.fecha),
      Masajista: `${a.masajista?.nombre || ''} ${a.masajista?.apellido || ''}`.trim(),
      Estado: a.estado,
      Entrada: hora12(a.hora_ingreso?.slice(0, 5)) || '',
      Salida: hora12(a.hora_salida?.slice(0, 5)) || '',
      Observaciones: a.observaciones || ''
    })), 'Asistencia', `asistencia_${desde}_${hasta}.xlsx`);
  } catch (ex) { avisar(mensajeError(ex), 'error'); }
}
