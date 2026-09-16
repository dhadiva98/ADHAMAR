// ===========================================================================
//  AGENDA DEL DÍA — pantalla principal de trabajo
//  Lista de las atenciones del día, en orden de hora, donde conviven
//  reservas pendientes y servicios ya realizados.
// ===========================================================================
import { estado, esAdmin, hoy, fechaCorta, fechaLarga, hora12, sumarMinutos,
         monto, escapar, mensajeError, sumarDias } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, esqueleto, vacio } from './ui.js';
import * as D from './datos.js';
import { formularioServicio, reservaRapida } from './registro.js';
import { formularioPaquete } from './paquetes.js';

let seleccion = new Set();

// --- Nombre resuelto: vivo si existe, snapshot si fue eliminada -------------
const nombreServicio = r => {
  const base = r.servicio?.nombre_completo || r.servicio_nombre_snapshot || null;
  if (!r.venta_paquete) return base;
  const paq = r.paquete?.nombre || r.paquete_nombre_snapshot || 'Paquete';
  return `${paq} (persona ${r.persona})` + (base ? ` · ${base}` : '');
};

const nombreMasajistas = r => {
  const ms = (r.masajistas || []).sort((a, b) => a.orden - b.orden);
  if (!ms.length) return null;
  return ms.map(m => m.masajista && !m.masajista.eliminada
    ? `${m.masajista.nombre} ${m.masajista.apellido || ''}`.trim()
    : m.masajista_nombre_snapshot).join(' | ');
};

const nombreCliente = r => r.cliente?.nombre || r.cliente_texto || null;

// Tipo del registro: el del servicio vivo o, si ya no existe, el guardado.
// En los paquetes con nombre manda el tipo guardado (masaje+sauna o solo sauna).
const tipoDe = r => r.venta_paquete ? (r.tipo_servicio || 'paquete')
                                    : (r.servicio?.tipo || r.tipo_servicio || 'masaje');

// Minutos totales que ocupa la atención (masaje + sauna en un paquete).
const minutosDe = r => {
  const s = r.servicio;
  if (r.venta_paquete) return ((s?.duracion || r.paquete?.masaje_minutos || 0) + (r.sauna_minutos || 0)) || null;
  if (!s) return null;
  const t = tipoDe(r);
  if (t === 'sauna') return s.sauna_minutos;
  return s.duracion + (t === 'paquete' ? (s.sauna_minutos || 0) : 0);
};

// Los datos faltantes se muestran como "—" en gris, nunca como cero falso.
const oFalta = (v, clase = 'vacio') => v ? escapar(v) : `<span class="${clase}">—</span>`;

// ===========================================================================
export async function vistaAgenda(fecha = estado.fecha) {
  estado.fecha = fecha;
  const v = $('#vista');
  v.innerHTML = barra(fecha) + esqueleto(6);
  conectarBarra(fecha);

  try {
    const regs = await D.registrosDelDia(fecha);
    v.innerHTML = barra(fecha) + tabla(regs, { conTotal: esAdmin() });
    conectarBarra(fecha);
    conectarFilas(regs, () => vistaAgenda(fecha));
  } catch (ex) {
    v.innerHTML = barra(fecha) + `<p class="error">${escapar(mensajeError(ex))}</p>`;
    conectarBarra(fecha);
  }
}

function barra(fecha) {
  const esHoy = fecha === hoy();
  return `
    <div class="barra-acciones">
      <button class="btn btn--principal" id="a-nuevo">+ Nuevo</button>
      <button class="btn btn--suave" id="a-reserva">Reserva rápida</button>
      <button class="btn btn--neutro" id="a-proximas">Ver próximas reservas</button>
      <input type="date" class="btn btn--neutro" id="a-fecha" value="${fecha}"
             style="padding:12px 14px;font-size:15px">
      ${!esHoy ? '<button class="btn btn--neutro" id="a-hoy">Volver a hoy</button>' : ''}
      <button class="btn btn--neutro oculto" id="a-borrar">Borrar seleccionado</button>
    </div>
    <p class="eyebrow" style="margin:-8px 0 16px">${escapar(fechaLarga(fecha))}</p>`;
}

function conectarBarra(fecha) {
  $('#a-nuevo').onclick    = () => formularioServicio(null, fecha, () => vistaAgenda(fecha));
  $('#a-reserva').onclick  = () => reservaRapida(fecha, () => vistaAgenda(fecha));
  $('#a-proximas').onclick = proximasReservas;
  $('#a-fecha').onchange   = e => vistaAgenda(e.target.value);
  const h = $('#a-hoy'); if (h) h.onclick = () => vistaAgenda(hoy());
  const b = $('#a-borrar');
  if (b) b.onclick = async () => {
    const ok = await confirmar({
      titulo: 'Borrar reservas', peligro: true, aceptar: 'Borrar',
      texto: `Se borrarán ${seleccion.size} ${seleccion.size === 1 ? 'reserva' : 'reservas'}. No contienen dinero, así que no afecta ningún cuadre.`
    });
    if (!ok) return;
    try {
      const regs = await D.registrosDelDia(fecha);
      const ventas = new Set();
      for (const id of seleccion) {
        const r = regs.find(x => x.id === id);
        if (r?.venta_paquete) ventas.add(r.venta_paquete);
        else await D.borrarRegistro(id);
      }
      for (const v of ventas) await D.borrarVenta(v);
      seleccion.clear();
      avisar('Reservas borradas', 'exito');
      vistaAgenda(fecha);
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}

// --- Tabla en escritorio, tarjetas en celular ------------------------------
export function tabla(regs, { conTotal = false, conFecha = false } = {}) {
  if (!regs.length) return vacio('Todavía no hay nada anotado en este día.',
    '<button class="btn btn--principal" onclick="document.getElementById(\'a-nuevo\')?.click()">+ Nuevo</button>');

  const total = regs.filter(r => r.estado === 'atendido' && !r.anulado)
                    .reduce((s, r) => s + Number(r.precio_cobrado || 0), 0);

  return `<div class="panel"><div class="tabla-envoltura">
    <table class="a-tarjetas">
      <thead><tr>
        <th></th><th>Hora</th>${conFecha ? '<th>Fecha</th>' : ''}<th>Cliente</th><th>Terapeuta</th>
        <th>Servicio</th><th>Modalidad</th><th>Tiempo</th>
        <th class="num">Desc</th><th>Pago</th><th class="num">Total</th><th>Estado</th>
      </tr></thead>
      <tbody>${regs.map(fila.bind(null, conFecha)).join('')}</tbody>
    </table></div>
    ${conTotal ? `<div class="panel__cabecera" style="border-bottom:none;border-top:1px solid var(--borde);
        display:flex;justify-content:space-between">
        <span class="eyebrow">${regs.length} ${regs.length === 1 ? 'atención' : 'atenciones'}</span>
        <strong>Total del día: ${monto(total)}</strong></div>` : ''}
  </div>`;
}

function fila(conFecha, r) {
  const s = r.servicio;
  const desc = Number(r.descuento || 0);
  const estadoTxt = r.anulado ? 'Anulado'
    : r.estado === 'atendido' ? 'Atendido' : r.estado === 'reserva' ? 'Reserva' : 'Cancelado';
  const clase = r.anulado ? 'cancelado' : r.estado;

  return `<tr data-clic data-id="${r.id}" data-estado="${r.estado}">
    <td style="width:44px">${r.estado === 'reserva'
      ? `<input type="checkbox" class="marca-reserva" data-marca="${r.id}"
           style="width:22px;height:22px;accent-color:var(--dorado)" aria-label="Seleccionar reserva">`
      : (r.cliente?.vip ? '<span class="estrella" title="VIP">★</span>' : '')}</td>
    <td class="destacado" data-etiqueta="Hora">${oFalta(hora12(r.hora_ingreso?.slice(0,5)))}</td>
    ${conFecha ? `<td data-etiqueta="Fecha">${fechaCorta(r.fecha)}</td>` : ''}
    <td data-etiqueta="Cliente">${oFalta(nombreCliente(r))}</td>
    <td data-etiqueta="Terapeuta">${nombreMasajistas(r)
      || (tipoDe(r) === 'sauna' ? '<span class="vacio">No aplica</span>' : '<span class="vacio">Sin asignar</span>')}</td>
    <td data-etiqueta="Servicio">${r.venta_paquete
      ? `<span class="insignia insignia--sauna">${escapar(r.paquete?.nombre || r.paquete_nombre_snapshot || 'Paquete')} · ${r.persona}/${r.paquete?.personas || r.persona}</span>`
        + (s?.masaje ? ` ${escapar(s.masaje)}` : '')
      : tipoDe(r) === 'sauna' ? '<span class="insignia insignia--sauna">Sauna</span>'
      : oFalta(s?.masaje || (r.servicio_nombre_snapshot || '').split(' · ')[0])
        + (tipoDe(r) === 'paquete' ? ' <span class="insignia insignia--sauna">+ Sauna</span>' : '')}</td>
    <td data-etiqueta="Modalidad">${oFalta(s?.modalidad)}</td>
    <td data-etiqueta="Tiempo">${r.venta_paquete
      ? [ (s?.duracion || r.paquete?.masaje_minutos) ? (s?.duracion || r.paquete?.masaje_minutos) + "'" : '',
          r.sauna_minutos ? `sauna ${r.sauna_minutos}'` : '' ].filter(Boolean).join(' + ') || '<span class="vacio">—</span>'
      : !s ? '<span class="vacio">—</span>'
      : tipoDe(r) === 'sauna' ? s.sauna_minutos + "'"
      : tipoDe(r) === 'paquete' ? `${s.duracion}' + ${s.sauna_minutos}'`
      : s.duracion + "'"}</td>
    <td class="num" data-etiqueta="Desc">${desc > 0
        ? `<span class="insignia insignia--descuento">−${monto(desc)}</span>`
        : '<span class="vacio">—</span>'}</td>
    <td data-etiqueta="Pago">${r.forma_pago
        ? `<span class="insignia insignia--pago">${etiquetaPago(r)}</span>`
        : '<span class="vacio">No registrado</span>'}</td>
    <td class="num" data-etiqueta="Total">${r.precio_cobrado != null
        ? `<strong>${monto(r.precio_cobrado)}</strong>` : '<span class="vacio">—</span>'}</td>
    <td data-etiqueta="Estado"><span class="insignia insignia--${clase}">${estadoTxt}</span></td>
  </tr>`;
}

const etiquetaPago = r => ({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', yape: 'Yape' })[r.forma_pago] || '—';

function conectarFilas(regs, recargar) {
  seleccion.clear();
  const botonBorrar = $('#a-borrar');

  $('#vista').querySelectorAll('[data-marca]').forEach(chk => {
    chk.onclick = e => e.stopPropagation();
    chk.onchange = () => {
      chk.checked ? seleccion.add(Number(chk.dataset.marca))
                  : seleccion.delete(Number(chk.dataset.marca));
      botonBorrar?.classList.toggle('oculto', seleccion.size === 0);
      if (botonBorrar) botonBorrar.textContent =
        `Borrar ${seleccion.size} ${seleccion.size === 1 ? 'reserva' : 'reservas'}`;
    };
  });

  $('#vista').querySelectorAll('tr[data-clic]').forEach(tr => {
    tr.onclick = e => {
      if (e.target.closest('[data-marca]')) return;
      const r = regs.find(x => String(x.id) === tr.dataset.id);
      if (!r) return;
      abrirRegistro(r, recargar);
    };
  });
}

// Tocar una reserva abre directamente el formulario para completarla.
// Los paquetes con nombre abren su propio formulario con todas sus personas.
export async function abrirRegistro(r, recargar) {
  if (r.venta_paquete && r.estado === 'reserva') {
    try { formularioPaquete(await D.ventaPaquete(r.venta_paquete), r.fecha, recargar); }
    catch (ex) { avisar(mensajeError(ex), 'error'); }
    return;
  }
  if (r.estado === 'reserva') formularioServicio(r, r.fecha, recargar);
  else detalle(r, recargar);
}

// ===========================================================================
//  Detalle de una atención
//  Debe quedar perfectamente claro qué es referencia y qué es dinero cobrado.
// ===========================================================================
export function detalle(r, recargar) {
  const s = r.servicio;
  const l = (k, v, extra = '') => v == null || v === ''
    ? '' : `<div class="tarifa__linea ${extra}"><span>${k}</span><span>${v}</span></div>`;

  const enPaquete = !!r.venta_paquete;
  const cuerpo = abrirHoja(enPaquete ? 'Detalle del paquete' : 'Detalle de la atención', `
    <div class="tarifa" style="margin-bottom:18px">
      ${l('Fecha', fechaCorta(r.fecha))}
      ${l('Hora', hora12(r.hora_ingreso?.slice(0,5)))}
      ${minutosDe(r) && r.hora_ingreso
        ? l('Termina ~', hora12(sumarMinutos(r.hora_ingreso.slice(0,5), minutosDe(r)))) : ''}
      ${tipoDe(r) === 'paquete' && r.sauna_minutos ? l('Sauna', r.sauna_orden === 'antes' ? 'Antes del masaje'
          : r.sauna_orden === 'despues' ? 'Después del masaje' : 'Sin indicar') : ''}
      ${l('Estado', r.anulado ? 'Anulado' : r.estado === 'atendido' ? 'Atendido' : 'Reserva')}
      ${enPaquete ? l('Paquete', `${escapar(r.paquete?.nombre || r.paquete_nombre_snapshot || '')} · persona ${r.persona} de ${r.paquete?.personas || r.persona}`) : ''}
      ${l('Cliente', (nombreCliente(r) || '—') + (r.cliente?.vip ? '  ★ VIP' : ''))}
      ${l('Servicio', nombreServicio(r) || '—')}
      ${l('Masajista', nombreMasajistas(r) || (tipoDe(r) === 'sauna' ? 'No aplica (sauna)' : 'Sin asignar'))}
    </div>
    <div class="tarifa" style="margin-bottom:18px">
      ${l('Precio referencial', monto(r.precio_referencial))}
      ${Number(r.descuento) > 0 ? l('Descuento', '−' + monto(r.descuento), 'tarifa__linea--desc') : ''}
      ${Number(r.ajuste)    > 0 ? l('Ajuste',    '+' + monto(r.ajuste),    'tarifa__linea--desc') : ''}
      ${l(enPaquete ? 'Cobrado (parte de esta persona)' : 'Precio cobrado', monto(r.precio_cobrado), 'tarifa__linea--total')}
      ${esAdmin() && tipoDe(r) === 'paquete' && r.monto_masajista != null
        ? l('Para la masajista', monto(r.monto_masajista)) + l('Para el spa (sauna)', monto(r.monto_spa)) : ''}
    </div>
    <div class="tarifa" style="margin-bottom:18px">
      ${l('Forma de pago', r.forma_pago ? etiquetaPago(r) : 'No registrado')}
      ${l('Recibido', r.dinero_recibido != null ? monto(r.dinero_recibido) : null)}
      ${l('Vuelto', r.vuelto != null && Number(r.vuelto) > 0 ? monto(r.vuelto) : null)}
      ${l('Vuelto por', r.vuelto_metodo === 'yape' ? 'Yape' : r.vuelto_metodo === 'efectivo' ? 'Efectivo' : null)}
      ${l('Motivo', r.motivo_descuento_texto || r.motivo_descuento)}
    </div>
    ${r.notas ? `<div class="panel"><div class="panel__cuerpo">
        <span class="eyebrow">Nota interna</span>
        <p style="margin:8px 0 0">${escapar(r.notas)}</p></div></div>` : ''}
    ${r.anulado ? `<p class="error" style="margin-top:16px">Anulado: ${escapar(r.motivo_anulacion || '')}</p>` : ''}
    ${esAdmin() && !r.anulado ? `
      <div class="barra-acciones" style="margin:22px 0 0">
        <button class="btn btn--neutro" id="d-editar" style="flex:1">Corregir</button>
        <button class="btn btn--peligro" id="d-anular" style="flex:1">Anular</button>
      </div>` : ''}`);

  if (!esAdmin() || r.anulado) return;

  cuerpo.querySelector('#d-editar').onclick = async () => {
    cerrarHoja();
    if (enPaquete) {
      try { const filas = await D.ventaPaquete(r.venta_paquete);
            setTimeout(() => formularioPaquete(filas, r.fecha, recargar), 240); }
      catch (ex) { avisar(mensajeError(ex), 'error'); }
    } else setTimeout(() => formularioServicio(r, r.fecha, recargar), 240);
  };

  // Eliminar una atención es SIEMPRE baja lógica con motivo obligatorio:
  // un registro que desaparece sin rastro rompe el cuadre de caja del día.
  cuerpo.querySelector('#d-anular').onclick = () => {
    const c2 = abrirHoja('Anular atención', `
      ${enPaquete ? '<p class="ayuda" style="margin:0 0 12px"><b>Se anula el paquete completo</b> (todas sus personas).</p>' : ''}
      <p class="ayuda" style="margin:0 0 18px">La atención deja de contar como venta y el cierre del día
         se recalcula solo. El registro no se borra: queda con su motivo, para que el cuadre siga cerrando.</p>
      <label class="campo"><span>¿Por qué se anula?</span>
        <input type="text" id="an-motivo" placeholder="Se registró dos veces"></label>
      <p class="error" id="an-error" hidden></p>
      <button class="btn btn--peligro btn--bloque" id="an-ok">Anular atención</button>`);

    c2.querySelector('#an-ok').onclick = async () => {
      const motivo = c2.querySelector('#an-motivo').value.trim();
      const err = c2.querySelector('#an-error');
      if (!motivo) { err.textContent = 'Escribe el motivo. Es obligatorio.'; err.hidden = false; return; }
      try {
        if (enPaquete) await D.anularVenta(r.venta_paquete, motivo);
        else await D.anularRegistro(r.id, motivo);
        avisar('Atención anulada', 'exito');
        cerrarHoja(); recargar?.();
      } catch (ex) { err.textContent = mensajeError(ex); err.hidden = false; }
    };
  };
}

// ===========================================================================
async function proximasReservas() {
  const cuerpo = abrirHoja('Próximas reservas', esqueleto(4));
  try {
    const regs = await D.proximasReservas(hoy());
    cuerpo.innerHTML = regs.length
      ? tabla(regs, { conFecha: true })
      : vacio('No hay reservas agendadas para los próximos días.');
    cuerpo.querySelectorAll('tr[data-clic]').forEach(tr => tr.onclick = () => {
      const r = regs.find(x => String(x.id) === tr.dataset.id);
      cerrarHoja();
      setTimeout(() => abrirRegistro(r, () => vistaAgenda(estado.fecha)), 240);
    });
  } catch (ex) { cuerpo.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
}

// ===========================================================================
//  HISTORIAL — la misma lista, sin límite de fecha
// ===========================================================================
export async function vistaHistorial() {
  const v = $('#vista');
  v.innerHTML = `
    <div class="panel" style="margin-bottom:18px"><div class="panel__cuerpo">
      <div class="fila">
        <label class="campo"><span>Desde</span><input type="date" id="h-desde" value="${sumarDias(hoy(), -30)}"></label>
        <label class="campo"><span>Hasta</span><input type="date" id="h-hasta" value="${hoy()}"></label>
      </div>
      <div class="fila">
        <label class="campo"><span>Estado</span><select id="h-estado">
          <option value="">Todos</option><option value="atendido">Atendido</option>
          <option value="reserva">Reserva</option><option value="cancelado">Cancelado</option></select></label>
        <label class="campo"><span>Forma de pago</span><select id="h-pago">
          <option value="">Todas</option><option value="efectivo">Efectivo</option>
          <option value="tarjeta">Tarjeta</option><option value="yape">Yape</option></select></label>
      </div>
      <label class="casilla"><input type="checkbox" id="h-desc">
        <span>Solo servicios con descuento</span></label>
      <button class="btn btn--principal btn--bloque" id="h-buscar">Buscar</button>
    </div></div>
    <div id="h-resultado"></div>`;

  const buscar = async () => {
    const caja = $('#h-resultado');
    caja.innerHTML = esqueleto(6);
    try {
      const regs = await D.historial({
        desde: $('#h-desde').value, hasta: $('#h-hasta').value,
        estado: $('#h-estado').value || null,
        forma_pago: $('#h-pago').value || null,
        conDescuento: $('#h-desc').checked
      });
      caja.innerHTML = regs.length ? tabla(regs, { conFecha: true })
                                   : vacio('No hay registros con esos filtros.');
      caja.querySelectorAll('tr[data-clic]').forEach(tr => tr.onclick = () => {
        const r = regs.find(x => String(x.id) === tr.dataset.id);
        abrirRegistro(r, buscar);
      });
    } catch (ex) { caja.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
  };

  $('#h-buscar').onclick = buscar;
  buscar();
}
