/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — historial.js
   La misma lista de la agenda, sin límite de fecha, con filtros (§5.11).

   Dos cosas que este archivo deja claras en pantalla:

   · Qué es REFERENCIAL y qué es COBRADO. Si se confunden, la caja del día
     deja de significar nada.
   · Quién puede corregir. Recepción lee todo el historial con sus montos
     —lo necesita para trabajar— pero no edita ni elimina atenciones.
     Sí puede completar una reserva y marcarla atendida.
   ══════════════════════════════════════════════════════════════════════ */

import { esAdmin, crear, vaciar, traducirError } from './core.js';
import { historial as traerHistorial, registro as traerRegistro, anularRegistro, cancelarRegistro, masajistas as traerMasajistas } from './datos.js';
import {
  cabeceraVista, celda, celdaMonto, pastilla, esqueleto, vacio,
  abrirHoja, confirmar, pedirTexto, aviso, avisoError, campo, casilla
} from './ui.js';
import {
  hoy, sumarDias, fechaCorta, hora12, soles, unirMasajistas, duracion, plural
} from './formato.js';

export const tablas = ['registros_servicios', 'registro_masajistas', 'pagos_registro', 'clientes'];

let contenedor = null;
let filtros = {};
let filas = [];

/* ══════════════════════════════════════════════════════════════════════
   VISTA
   ══════════════════════════════════════════════════════════════════════ */

export async function montar(donde, opciones = {}) {
  contenedor = donde;
  filtros = {
    desde: opciones.desde || sumarDias(hoy(), -30),
    hasta: opciones.hasta || (opciones.desde ? '' : hoy()),
    estado: opciones.estado || '',
    formaPago: '',
    masajistaId: null,
    soloConDescuento: false
  };
  await cargar({ titulo: opciones.titulo });
}

export function desmontar() {
  contenedor = null;
  filas = [];
}

export async function refrescar() {
  if (contenedor) await cargar({ silencioso: true });
}

async function cargar({ silencioso = false, titulo = null } = {}) {
  if (!silencioso) {
    vaciar(contenedor);
    contenedor.appendChild(cabeceraVista(titulo || 'Historial'));
    contenedor.appendChild(await panelFiltros());
    contenedor.appendChild(esqueleto(6, { conTitulo: false }));
  }

  filas = await traerHistorial({
    desde: filtros.desde || null,
    hasta: filtros.hasta || null,
    estado: filtros.estado || null,
    formaPago: filtros.formaPago || null,
    masajistaId: filtros.masajistaId,
    soloConDescuento: filtros.soloConDescuento,
    limite: 300
  });

  pintarResultados(titulo);
}

async function panelFiltros() {
  const caja = crear('div', { clase: 'tarjeta' });

  const fila = crear('div', {
    atributos: { style: 'display:flex;flex-wrap:wrap;gap:14px' }
  });

  const { campo: cDesde, entrada: eDesde } = campo('Desde', { tipo: 'date', valor: filtros.desde });
  const { campo: cHasta, entrada: eHasta } = campo('Hasta', { tipo: 'date', valor: filtros.hasta });
  [cDesde, cHasta].forEach((c) => { c.style.flex = '1 1 150px'; c.style.marginBottom = '0'; });

  const cEstado = crear('label', { clase: 'campo', atributos: { style: 'flex:1 1 150px;margin-bottom:0' } });
  cEstado.appendChild(crear('span', { clase: 'campo-etiqueta', texto: 'Estado' }));
  const sEstado = crear('select');
  [['', 'Todos'], ['atendido', 'Atendidos'], ['reserva', 'Reservas'], ['cancelado', 'Cancelados']]
    .forEach(([v, t]) => sEstado.appendChild(crear('option', { texto: t, atributos: { value: v } })));
  sEstado.value = filtros.estado;
  cEstado.appendChild(sEstado);

  const cPago = crear('label', { clase: 'campo', atributos: { style: 'flex:1 1 150px;margin-bottom:0' } });
  cPago.appendChild(crear('span', { clase: 'campo-etiqueta', texto: 'Forma de pago' }));
  const sPago = crear('select');
  [['', 'Todas'], ['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['yape', 'Yape'], ['mixto', 'Mixto']]
    .forEach(([v, t]) => sPago.appendChild(crear('option', { texto: t, atributos: { value: v } })));
  sPago.value = filtros.formaPago;
  cPago.appendChild(sPago);

  const cSrta = crear('label', { clase: 'campo', atributos: { style: 'flex:1 1 170px;margin-bottom:0' } });
  cSrta.appendChild(crear('span', { clase: 'campo-etiqueta', texto: 'Srta.' }));
  const sSrta = crear('select');
  sSrta.appendChild(crear('option', { texto: 'Todas', atributos: { value: '' } }));
  try {
    const lista = await traerMasajistas({ incluirEliminadas: true });
    lista.forEach((m) => sSrta.appendChild(crear('option', {
      texto: m.nombre + (m.eliminada ? ' (eliminada)' : ''),
      atributos: { value: m.id }
    })));
  } catch (e) { /* si falla, el filtro queda en "Todas" */ }
  if (filtros.masajistaId) sSrta.value = filtros.masajistaId;
  cSrta.appendChild(sSrta);

  fila.append(cDesde, cHasta, cEstado, cPago, cSrta);
  caja.appendChild(fila);

  const { casilla: cDesc, entrada: eDesc } = casilla('Solo servicios con descuento', filtros.soloConDescuento);
  caja.appendChild(cDesc);

  caja.appendChild(crear('button', {
    clase: 'boton-secundario',
    texto: 'Aplicar filtros',
    atributos: { type: 'button', style: 'width:auto' },
    al: {
      click: async () => {
        filtros = {
          desde: eDesde.value,
          hasta: eHasta.value,
          estado: sEstado.value,
          formaPago: sPago.value,
          masajistaId: sSrta.value || null,
          soloConDescuento: eDesc.checked
        };
        await cargar();
      }
    }
  }));

  return caja;
}

function pintarResultados(titulo) {
  // Se conserva la cabecera y el panel de filtros; se reemplaza el resto
  while (contenedor.children.length > 2) contenedor.lastChild.remove();

  if (!filas.length) {
    contenedor.appendChild(vacio('No hay registros con esos filtros', 'Prueba ampliando el rango de fechas.'));
    return;
  }

  const envoltura = crear('div', { clase: 'tabla-envoltura a-tarjetas', atributos: { style: 'margin-top:18px' } });
  const tabla = crear('table', { clase: 'tabla' });

  const thead = crear('thead');
  const tr = crear('tr');
  ['Fecha', 'Hora', 'Cliente', 'Srta.', 'Servicio', 'Referencial', 'Desc.', 'Cobrado', 'Pago', 'Estado']
    .forEach((t, i) => tr.appendChild(crear('th', { texto: t, clase: [5, 6, 7].includes(i) ? 'derecha' : '' })));
  thead.appendChild(tr);
  tabla.appendChild(thead);

  const tbody = crear('tbody');
  filas.forEach((r) => {
    const fila = crear('tr', { datos: { abrible: 'si' } });
    fila.addEventListener('click', () => abrirDetalle(r.id, { alCambiar: refrescar }));

    fila.appendChild(celda(fechaCorta(r.fecha)));
    fila.appendChild(celda(hora12(r.hora_ingreso)));
    fila.appendChild(celda(r.clienteNombre, { vacio: 'Sin nombre' }));
    fila.appendChild(celda(unirMasajistas(r.nombresMasajistas), { vacio: 'Sin asignar' }));
    fila.appendChild(celda(r.servicioNombre));
    fila.appendChild(celdaMonto(r.precio_referencial));
    fila.appendChild(Number(r.descuento) > 0 ? celdaMonto(r.descuento) : celda(null, { clase: 'monto' }));
    fila.appendChild(celdaMonto(r.precio_cobrado));
    fila.appendChild(celda(textoPago(r), { vacio: 'No registrado' }));

    const tdEstado = crear('td');
    tdEstado.appendChild(pastilla(r.estado));
    if (r.anulado) tdEstado.appendChild(crear('span', { clase: 'pastilla pastilla-aviso', texto: 'Anulado' }));
    fila.appendChild(tdEstado);

    tbody.appendChild(fila);
  });
  tabla.appendChild(tbody);
  envoltura.appendChild(tabla);
  contenedor.appendChild(envoltura);

  // Tarjetas para celular
  const lista = crear('div', { clase: 'lista-tarjetas' });
  filas.forEach((r) => {
    const tarjeta = crear('div', { clase: 'tarjeta-fila' });
    tarjeta.addEventListener('click', () => abrirDetalle(r.id, { alCambiar: refrescar }));
    tarjeta.appendChild(crear('span', { clase: 'hora', texto: fechaCorta(r.fecha) }));
    tarjeta.appendChild(crear('span', { clase: 'cliente', texto: r.clienteNombre || 'Sin nombre' }));
    tarjeta.appendChild(pastilla(r.estado));
    tarjeta.appendChild(crear('span', {
      clase: 'detalle',
      texto: [hora12(r.hora_ingreso), r.servicioNombre || '—',
              unirMasajistas(r.nombresMasajistas),
              r.estado === 'atendido' ? soles(r.precio_cobrado) : null]
        .filter(Boolean).join(' · ')
    }));
    lista.appendChild(tarjeta);
  });
  contenedor.appendChild(lista);

  contenedor.appendChild(crear('p', {
    clase: 'pie-agenda',
    texto: plural(filas.length, 'registro encontrado', 'registros encontrados')
  }));
}

function textoPago(r) {
  const medios = Object.entries(r.pagos || {});
  if (!medios.length) return null;
  return medios.map(([m, monto]) => `${nombreMedio(m)} ${soles(monto)}`).join(' + ');
}

const nombreMedio = (m) => ({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', yape: 'Yape' })[m] || m;

/* ══════════════════════════════════════════════════════════════════════
   DETALLE
   Lo abre también la agenda al tocar una atención.
   ══════════════════════════════════════════════════════════════════════ */

export async function abrirDetalle(id, { alCambiar = null } = {}) {
  let r;
  try {
    r = await traerRegistro(id);
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
    return;
  }

  const cuerpo = crear('div');

  if (r.anulado) {
    cuerpo.appendChild(crear('p', {
      clase: 'mensaje-error',
      texto: `Registro anulado. Motivo: ${r.motivo_anulacion || 'sin especificar'}`
    }));
  }

  const filas_ = [
    ['Fecha', fechaCorta(r.fecha)],
    ['Hora', hora12(r.hora_ingreso)],
    ['Estado', ({ atendido: 'Atendido', reserva: 'Reserva', cancelado: 'Cancelado' })[r.estado]],
    ['Cliente', (r.clienteNombre || 'Sin nombre') + (r.clienteVip ? '  ★ VIP' : '')],
    ['Servicio', r.servicioNombre],
    ['Tiempo', r.duracion ? duracion(r.duracion) : null],
    ['Srta.', unirMasajistas(r.nombresMasajistas)],
    ['—separador—'],
    ['Precio referencial', soles(r.precio_referencial)],
    Number(r.descuento) > 0 ? ['Descuento', `−${soles(r.descuento)}`] : null,
    Number(r.ajuste) > 0 ? ['Ajuste', `+${soles(r.ajuste)}`] : null,
    ['Precio cobrado', soles(r.precio_cobrado)],
    ['Forma de pago', textoPago(r) || 'No registrado'],
    r.dinero_recibido ? ['Recibido', soles(r.dinero_recibido)] : null,
    r.vuelto ? ['Vuelto', soles(r.vuelto)] : null,
    r.vuelto_metodo ? ['Vuelto entregado por', nombreMedio(r.vuelto_metodo)] : null,
    ['—separador—'],
    r.motivo_descuento ? ['Motivo', r.motivo_descuento_texto || r.motivo_descuento] : null,
    r.notas ? ['Nota interna', r.notas] : null,
    ['Registrado por', r.usuario?.nombre || '—']
  ].filter(Boolean);

  filas_.forEach((par) => {
    if (par[0] === '—separador—') {
      cuerpo.appendChild(crear('div', { atributos: { style: 'height:10px' } }));
      return;
    }
    const [etiqueta, valor] = par;
    const linea = crear('div', { clase: 'linea-calculo' });
    linea.appendChild(crear('span', { texto: etiqueta }));
    const derecha = crear('span', {
      clase: /S\/|−|\+/.test(String(valor)) ? 'monto' : '',
      texto: valor || '—'
    });
    if (!valor) derecha.className = 'dato-faltante';
    linea.appendChild(derecha);
    cuerpo.appendChild(linea);
  });

  /* Recepción no edita ni elimina atenciones. Si se equivoca, avisa a
     administración. La barrera dura está en las policies. */
  const acciones = [];

  if (r.estado === 'reserva') {
    acciones.push({
      texto: 'Completar', tipo: 'primario',
      al: async ({ cerrar }) => {
        cerrar();
        const registro = await import('./registro.js');
        await registro.completarReserva(r.id, { alGuardar: alCambiar });
      }
    });
    acciones.push({
      texto: 'Eliminar reserva', tipo: 'peligro',
      al: ({ cerrar }) => eliminarReserva(r, cerrar, alCambiar)
    });
  } else if (esAdmin() && !r.anulado) {
    acciones.push({
      texto: 'Corregir', tipo: 'primario',
      al: async ({ cerrar }) => {
        cerrar();
        const registro = await import('./registro.js');
        await registro.editarRegistro(r.id, { alGuardar: alCambiar });
      }
    });
    acciones.push({
      texto: 'Anular', tipo: 'peligro',
      al: ({ cerrar }) => anular(r, cerrar, alCambiar)
    });
  }

  abrirHoja({ titulo: 'Detalle del servicio', contenido: cuerpo, acciones });
}

async function eliminarReserva(r, cerrar, alCambiar) {
  /* Una reserva no es venta, no contiene dinero y no afecta ningún cuadre:
     es la única excepción a "nada se borra". Confirmación breve, no doble:
     es una acción menor y frecuente (§5.3). */
  const seguro = await confirmar({
    titulo: 'Eliminar esta reserva',
    texto: 'Se borrará por completo. No afecta a la caja porque una reserva no es una venta.',
    aceptar: 'Eliminar',
    peligro: true
  });
  if (!seguro) return;

  try {
    const { borrarReserva } = await import('./datos.js');
    await borrarReserva(r.id);
    aviso('Reserva eliminada');
    cerrar();
    await alCambiar?.();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}

async function anular(r, cerrar, alCambiar) {
  /* Una atención NUNCA se borra físicamente: baja lógica con motivo. Un
     registro que desaparece sin rastro rompe el cuadre de ese día. */
  const motivo = await pedirTexto({
    titulo: 'Anular este registro',
    texto: 'El registro no se borra: queda guardado y marcado como anulado, con tu nombre y el motivo.',
    etiqueta: 'Motivo (obligatorio)',
    multilinea: true,
    aceptar: 'Anular registro'
  });
  if (!motivo) return;

  try {
    await anularRegistro(r.id, motivo);
    aviso('Registro anulado');
    cerrar();
    await alCambiar?.();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}

/** Marcar como cancelado (no se realizó), conservando el registro. */
export async function marcarCancelado(id, alCambiar = null) {
  const motivo = await pedirTexto({
    titulo: 'Marcar como cancelado',
    etiqueta: 'Motivo (opcional)',
    aceptar: 'Marcar'
  });
  if (motivo === null) return;
  try {
    await cancelarRegistro(id, motivo);
    aviso('Registro marcado como cancelado');
    await alCambiar?.();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}
