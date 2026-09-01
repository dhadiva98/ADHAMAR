/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — reportes.js
   Métricas por periodo y exportación a Excel (§5.13). Solo Administrador.

   ⚠ EL DOBLE CONTEO, dicho donde se ve y no en una nota al pie de un
   manual: cuando un masaje lo realizan dos srtas., el servicio y su monto
   se atribuyen COMPLETOS A CADA UNA. Por eso la suma de la columna
   "Cobrado" de la tabla por srta. NO es el total de ventas del día. El
   total real sale de los registros, contando cada uno una sola vez.

   El desglose por forma de pago sí cuadra con el total, porque reparte
   cada atención entre sus medios sin duplicarla.

   ─────────────────────────────────────────────────────────────────────
   Forma que debe devolver reporte_periodo(p_desde, p_hasta, p_filtros):

     { total_servicios, ventas_referenciales, descuentos, ventas_reales,
       ticket_promedio,
       por_metodo:    { efectivo, tarjeta, yape },
       top_servicios: [{ nombre, cantidad, total }],
       por_masajista: [{ nombre, cantidad, total, descuentos }] }
   ────────────────────────────────────────────────────────────────────── */

import { crear, vaciar, traducirError } from './core.js';
import {
  reportePeriodo, historial as traerHistorial, clientes as traerClientes,
  asistenciaPeriodo, cierres as traerCierres
} from './datos.js';
import {
  cabeceraVista, celda, celdaMonto, esqueleto, vacio, campo,
  aviso, avisoError, lineaCalculo
} from './ui.js';
import {
  hoy, sumarDias, fechaCorta, hora12, soles, unirMasajistas, plural
} from './formato.js';

export const tablas = ['registros_servicios', 'pagos_registro'];

let contenedor = null;
let desde = sumarDias(hoy(), -30);
let hasta = hoy();
let datos = null;

/* ══════════════════════════════════════════════════════════════════════
   VISTA
   ══════════════════════════════════════════════════════════════════════ */

export async function montar(donde) {
  contenedor = donde;
  await cargar();
}

export function desmontar() {
  contenedor = null;
  datos = null;
}

export async function refrescar() {
  if (contenedor) await cargar({ silencioso: true });
}

async function cargar({ silencioso = false } = {}) {
  if (!silencioso) vaciar(contenedor).appendChild(esqueleto(6));
  try {
    datos = await reportePeriodo(desde, hasta);
  } catch (e) {
    vaciar(contenedor).appendChild(vacio('No se pudo cargar el reporte', e.amable ? e.message : traducirError(e)));
    return;
  }
  pintar();
}

function pintar() {
  vaciar(contenedor);
  contenedor.appendChild(cabeceraVista('Reportes'));
  contenedor.appendChild(atajos());
  contenedor.appendChild(rangoManual());

  if (!datos || !datos.total_servicios) {
    contenedor.appendChild(vacio('No hay servicios en ese periodo', 'Prueba con un rango más amplio.'));
    contenedor.appendChild(cajaExportar());
    return;
  }

  contenedor.appendChild(cuadroResumen());
  contenedor.appendChild(cuadroMetodos());
  contenedor.appendChild(tablaTop());
  contenedor.appendChild(tablaMasajistas());
  contenedor.appendChild(cajaExportar());
}

function atajos() {
  const caja = crear('div', { clase: 'opciones', atributos: { style: 'margin-bottom:14px' } });

  const rangos = [
    ['Hoy', () => [hoy(), hoy()]],
    ['Ayer', () => [sumarDias(hoy(), -1), sumarDias(hoy(), -1)]],
    ['Esta semana', () => [sumarDias(hoy(), -6), hoy()]],
    ['Este mes', () => [`${hoy().slice(0, 7)}-01`, hoy()]],
    ['Últimos 30 días', () => [sumarDias(hoy(), -30), hoy()]]
  ];

  rangos.forEach(([texto, calcular]) => {
    const [d, h] = calcular();
    caja.appendChild(crear('button', {
      clase: 'opcion',
      texto,
      atributos: { type: 'button', 'aria-pressed': (desde === d && hasta === h) ? 'true' : 'false' },
      al: { click: async () => { [desde, hasta] = calcular(); await cargar(); } }
    }));
  });

  return caja;
}

function rangoManual() {
  const caja = crear('div', { atributos: { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-bottom:18px' } });

  const { campo: c1, entrada: e1 } = campo('Desde', { tipo: 'date', valor: desde });
  const { campo: c2, entrada: e2 } = campo('Hasta', { tipo: 'date', valor: hasta });
  [c1, c2].forEach((c) => { c.style.flex = '1 1 150px'; c.style.marginBottom = '0'; });

  const boton = crear('button', {
    clase: 'boton-secundario',
    texto: 'Ver periodo',
    atributos: { type: 'button', style: 'width:auto;align-self:flex-end' },
    al: {
      click: async () => {
        if (e1.value) desde = e1.value;
        if (e2.value) hasta = e2.value;
        await cargar();
      }
    }
  });

  caja.append(c1, c2, boton);
  return caja;
}

function cuadroResumen() {
  const caja = crear('div', { clase: 'tarjeta' });
  caja.appendChild(crear('p', {
    clase: 'titulo-tarjeta',
    texto: `Del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`
  }));

  const linea = lineaCalculo('Servicios realizados', null);
  linea.lastChild.textContent = String(datos.total_servicios ?? 0);
  caja.appendChild(linea);

  caja.appendChild(lineaCalculo('Ventas referenciales', datos.ventas_referenciales || 0));
  caja.appendChild(lineaCalculo('Descuentos', -(datos.descuentos || 0)));
  caja.appendChild(lineaCalculo('Ventas reales', datos.ventas_reales || 0, { total: true }));
  caja.appendChild(lineaCalculo('Ticket promedio', datos.ticket_promedio || 0));
  return caja;
}

function cuadroMetodos() {
  const caja = crear('div', { clase: 'tarjeta' });
  caja.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Ventas por forma de pago' }));
  const m = datos.por_metodo || {};
  caja.appendChild(lineaCalculo('Efectivo', m.efectivo || 0));
  caja.appendChild(lineaCalculo('Tarjeta', m.tarjeta || 0));
  caja.appendChild(lineaCalculo('Yape', m.yape || 0));
  caja.appendChild(lineaCalculo('Total', (m.efectivo || 0) + (m.tarjeta || 0) + (m.yape || 0), { total: true }));
  caja.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'Este desglose sí cuadra con las ventas reales: cada atención se reparte entre sus medios sin duplicarse.'
  }));
  return caja;
}

function tablaTop() {
  const filas = datos.top_servicios || [];
  const caja = crear('div', { clase: 'tarjeta' });
  caja.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Servicios más vendidos' }));

  if (!filas.length) {
    caja.appendChild(crear('p', { clase: 'campo-ayuda', texto: 'Sin datos en este periodo.' }));
    return caja;
  }

  const envoltura = crear('div', { clase: 'tabla-envoltura' });
  const tabla = crear('table', { clase: 'tabla' });
  const thead = crear('thead');
  const tr = crear('tr');
  ['Servicio', 'Cantidad', 'Cobrado'].forEach((t, i) =>
    tr.appendChild(crear('th', { texto: t, clase: i > 0 ? 'derecha' : '' })));
  thead.appendChild(tr);
  tabla.appendChild(thead);

  const tbody = crear('tbody');
  filas.forEach((s) => {
    const fila = crear('tr');
    fila.appendChild(celda(s.nombre));
    fila.appendChild(celda(String(s.cantidad), { clase: 'monto' }));
    fila.appendChild(celdaMonto(s.total));
    tbody.appendChild(fila);
  });
  tabla.appendChild(tbody);
  envoltura.appendChild(tabla);
  caja.appendChild(envoltura);
  return caja;
}

function tablaMasajistas() {
  const filas = datos.por_masajista || [];
  const caja = crear('div', { clase: 'tarjeta' });
  caja.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Por srta.' }));

  if (!filas.length) {
    caja.appendChild(crear('p', { clase: 'campo-ayuda', texto: 'Sin datos en este periodo.' }));
    return caja;
  }

  const envoltura = crear('div', { clase: 'tabla-envoltura' });
  const tabla = crear('table', { clase: 'tabla' });
  const thead = crear('thead');
  const tr = crear('tr');
  ['Srta.', 'Servicios', 'Descuentos', 'Cobrado'].forEach((t, i) =>
    tr.appendChild(crear('th', { texto: t, clase: i > 0 ? 'derecha' : '' })));
  thead.appendChild(tr);
  tabla.appendChild(thead);

  const tbody = crear('tbody');
  filas.forEach((m) => {
    const fila = crear('tr');
    fila.appendChild(celda(m.nombre));
    fila.appendChild(celda(String(m.cantidad), { clase: 'monto' }));
    fila.appendChild(Number(m.descuentos) > 0 ? celdaMonto(m.descuentos) : celda(null, { clase: 'monto' }));
    fila.appendChild(celdaMonto(m.total));
    tbody.appendChild(fila);
  });
  tabla.appendChild(tbody);
  envoltura.appendChild(tabla);
  caja.appendChild(envoltura);

  /* La advertencia va aquí abajo, pegada a la tabla que la necesita. */
  caja.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'Cuando dos srtas. atienden juntas, el servicio se cuenta completo para cada una. Por eso la suma de esta columna no es el total de ventas: ese está arriba, en Ventas reales.'
  }));
  return caja;
}

/* ══════════════════════════════════════════════════════════════════════
   EXPORTACIÓN A EXCEL
   Los datos se piden a Supabase EN EL MOMENTO de exportar. El Excel es
   una salida, nunca una fuente.
   ══════════════════════════════════════════════════════════════════════ */

function cajaExportar() {
  const caja = crear('div', { clase: 'tarjeta' });
  caja.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Descargar en Excel' }));
  caja.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: `Se descarga lo que hay en el sistema ahora mismo, del ${fechaCorta(desde)} al ${fechaCorta(hasta)}.`
  }));

  const botones = crear('div', { clase: 'opciones', atributos: { style: 'margin-top:12px' } });
  [
    ['Ventas', exportarVentas],
    ['Clientes', exportarClientes],
    ['Asistencia', exportarAsistencia],
    ['Cierres diarios', exportarCierres]
  ].forEach(([texto, fn]) => {
    botones.appendChild(crear('button', {
      clase: 'opcion',
      texto,
      atributos: { type: 'button' },
      al: {
        click: async (e) => {
          const boton = e.currentTarget;
          const previo = boton.textContent;
          boton.disabled = true;
          boton.textContent = 'Preparando…';
          try { await fn(); } catch (err) {
            avisoError(err.amable ? err.message : traducirError(err));
          } finally {
            boton.disabled = false;
            boton.textContent = previo;
          }
        }
      }
    }));
  });

  caja.appendChild(botones);
  return caja;
}

/** Trae SheetJS solo cuando de verdad se va a exportar. */
async function cargarExcel() {
  if (window.XLSX) return window.XLSX;

  await new Promise((resolver, rechazar) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = resolver;
    script.onerror = () => rechazar(new Error('No se pudo cargar la librería de Excel'));
    document.head.appendChild(script);
  });

  if (!window.XLSX) throw new Error('No se pudo cargar la librería de Excel');
  return window.XLSX;
}

async function descargar(nombreArchivo, hojas) {
  const XLSX = await cargarExcel();
  const libro = XLSX.utils.book_new();
  hojas.forEach(({ nombre, filas }) => {
    XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), nombre.slice(0, 31));
  });
  XLSX.writeFile(libro, nombreArchivo);
  aviso('Archivo descargado');
}

async function exportarVentas() {
  const filas = await traerHistorial({ desde, hasta, limite: 5000 });

  const hoja = filas.map((r) => ({
    Fecha: fechaCorta(r.fecha),
    Hora: hora12(r.hora_ingreso, { vacio: '' }),
    Estado: r.estado,
    Cliente: r.clienteNombre || '',
    Servicio: r.servicioNombre || '',
    Srtas: unirMasajistas(r.nombresMasajistas).replace('—', ''),
    'Precio referencial': Number(r.precio_referencial || 0),
    Descuento: Number(r.descuento || 0),
    Ajuste: Number(r.ajuste || 0),
    'Precio cobrado': Number(r.precio_cobrado || 0),
    'Forma de pago': Object.entries(r.pagos || {})
      .map(([m, v]) => `${m} ${soles(v)}`).join(' + '),
    'Monto efectivo': Number(r.pagos?.efectivo || 0),
    'Monto tarjeta': Number(r.pagos?.tarjeta || 0),
    'Monto yape': Number(r.pagos?.yape || 0),
    Recibido: Number(r.dinero_recibido || 0),
    Vuelto: Number(r.vuelto || 0),
    'Vuelto por': r.vuelto_metodo || '',
    Motivo: r.motivo_descuento_texto || r.motivo_descuento || '',
    Notas: r.notas || '',
    'Registrado por': r.usuario?.nombre || ''
  }));

  await descargar(`adhamar-ventas-${desde}-a-${hasta}.xlsx`, [{ nombre: 'Ventas', filas: hoja }]);
}

async function exportarClientes() {
  const filas = await traerClientes();
  const hoja = filas.map((c) => ({
    ID: c.id,
    Nombre: c.nombre || '',
    Teléfono: c.telefono || '',
    VIP: c.vip ? 'Sí' : 'No',
    'Fecha de registro': fechaCorta(c.created_at),
    Visitas: Number(c.visitas || 0),
    'Última visita': c.ultima_visita ? fechaCorta(c.ultima_visita) : '',
    Observaciones: c.observaciones || ''
  }));
  await descargar('adhamar-clientes.xlsx', [{ nombre: 'Clientes', filas: hoja }]);
}

async function exportarAsistencia() {
  const filas = await asistenciaPeriodo(desde, hasta);
  const hoja = filas.map((a) => ({
    Fecha: fechaCorta(a.fecha),
    Srta: a.masajista?.nombre || '',
    Estado: a.estado || '',
    Ingreso: hora12(a.hora_ingreso, { vacio: '' }),
    Salida: hora12(a.hora_salida, { vacio: '' }),
    Observaciones: a.observaciones || ''
  }));
  await descargar(`adhamar-asistencia-${desde}-a-${hasta}.xlsx`, [{ nombre: 'Asistencia', filas: hoja }]);
}

async function exportarCierres() {
  const filas = await traerCierres(desde, hasta);
  const hoja = filas.map((c) => ({
    Fecha: fechaCorta(c.fecha),
    Servicios: Number(c.total_servicios || 0),
    'Ventas referenciales': Number(c.ventas_referenciales || 0),
    Descuentos: Number(c.descuentos || 0),
    'Ventas reales': Number(c.ventas_reales || 0),
    Efectivo: Number(c.total_efectivo || 0),
    Tarjeta: Number(c.total_tarjeta || 0),
    Yape: Number(c.total_yape || 0),
    'Vuelto en efectivo': Number(c.total_vuelto_efectivo || 0),
    'Vuelto por Yape': Number(c.total_vuelto_yape || 0),
    'Fondo inicial': c.fondo_inicial === null ? '' : Number(c.fondo_inicial),
    'Efectivo esperado': Number(c.efectivo_esperado || 0),
    'Efectivo contado': Number(c.efectivo_contado || 0),
    Diferencia: Number(c.diferencia || 0),
    'Diferencia justificada': Number(c.diferencia_justificada || 0),
    Retirado: Number(c.monto_retirado || 0),
    'Caja fija dejada': Number(c.caja_fija_siguiente || 0),
    Estado: c.estado || '',
    Observaciones: c.observaciones || ''
  }));
  await descargar(`adhamar-cierres-${desde}-a-${hasta}.xlsx`, [{ nombre: 'Cierres', filas: hoja }]);
}

/** plural() se usa al informar cuántas filas se exportaron. */
export function resumenExportacion(n) {
  return plural(n, 'fila exportada', 'filas exportadas');
}
