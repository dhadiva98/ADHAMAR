/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — agenda.js
   La pantalla principal (§5.1). No es un tablero de métricas: es la lista
   de lo que pasa hoy, en orden de hora, donde conviven las reservas
   pendientes y los servicios ya realizados.

   El pie es condicional al rol: Recepción ve el conteo de atenciones; el
   Administrador ve además el total del día.
   ══════════════════════════════════════════════════════════════════════ */

import { estado, esAdmin, crear, vaciar, $ } from './core.js';
import { agendaDia } from './datos.js';
import {
  cabeceraVista, pastilla, celda, celdaMonto, esqueleto, vacio, confirmar
} from './ui.js';
import {
  hoy, sumarDias, fechaLarga, diaRelativo, hora12, horaFin,
  soles, unirMasajistas, duracion, plural
} from './formato.js';

/* Realtime repinta esta vista solo si cambia alguna de estas tablas. */
export const tablas = [
  'registros_servicios', 'registro_masajistas', 'pagos_registro', 'clientes'
];

let contenedor = null;
let fecha = hoy();
let registros = [];

/* ══════════════════════════════════════════════════════════════════════
   MONTAJE
   ══════════════════════════════════════════════════════════════════════ */

export async function montar(donde, opciones = {}) {
  contenedor = donde;
  fecha = opciones.fecha || hoy();
  await cargar();
}

export function desmontar() {
  contenedor = null;
  registros = [];
}

export async function refrescar() {
  if (!contenedor) return;
  await cargar({ silencioso: true });
}

async function cargar({ silencioso = false } = {}) {
  if (!silencioso) vaciar(contenedor).appendChild(esqueleto(6));
  registros = await agendaDia(fecha);
  pintar();
}

/* ══════════════════════════════════════════════════════════════════════
   PINTADO
   ══════════════════════════════════════════════════════════════════════ */

function pintar() {
  vaciar(contenedor);

  contenedor.appendChild(cabeceraVista(
    fecha === hoy() ? 'Agenda del día' : `Agenda · ${diaRelativo(fecha)}`,
    [
      { texto: '+ Nuevo', tipo: 'primario', al: () => abrirRegistro() },
      { texto: 'Ver próximas reservas', al: verProximas },
      { texto: 'Ver otro día', al: elegirOtroDia }
    ]
  ));

  contenedor.appendChild(barraFecha());

  if (!registros.length) {
    contenedor.appendChild(vacio(
      fecha === hoy() ? 'Todavía no hay nada anotado hoy' : 'No hay nada anotado ese día',
      'Cuando registres un masaje o anotes una reserva, aparecerá aquí.',
      { texto: 'Registrar un servicio', al: () => abrirRegistro() }
    ));
    return;
  }

  contenedor.appendChild(tablaEscritorio());
  contenedor.appendChild(tarjetasMovil());
  contenedor.appendChild(pie());
  contenedor.appendChild(nota());
}

function barraFecha() {
  const caja = crear('div', { clase: 'pie-agenda', atributos: { style: 'margin:0 0 16px' } });

  const anterior = crear('button', {
    clase: 'boton-icono', texto: '‹',
    atributos: { type: 'button', 'aria-label': 'Día anterior', style: 'font-size:26px' },
    al: { click: () => cambiarFecha(sumarDias(fecha, -1)) }
  });
  const siguiente = crear('button', {
    clase: 'boton-icono', texto: '›',
    atributos: { type: 'button', 'aria-label': 'Día siguiente', style: 'font-size:26px' },
    al: { click: () => cambiarFecha(sumarDias(fecha, 1)) }
  });

  caja.append(anterior, crear('strong', { texto: fechaLarga(fecha) }), siguiente);

  if (fecha !== hoy()) {
    caja.appendChild(crear('button', {
      clase: 'boton-enlace', texto: 'Volver a hoy',
      atributos: { type: 'button' },
      al: { click: () => cambiarFecha(hoy()) }
    }));
  }
  return caja;
}

async function cambiarFecha(nueva) {
  fecha = nueva;
  await cargar();
}

/* ── Tabla (escritorio) ─────────────────────────────────────────────── */

const COLUMNAS = ['', 'Hora', 'Cliente', 'Srta.', 'Servicio', 'Tiempo', 'Desc.', 'Pago', 'Total', 'Estado'];

function tablaEscritorio() {
  const envoltura = crear('div', { clase: 'tabla-envoltura a-tarjetas' });
  const tabla = crear('table', { clase: 'tabla' });

  const thead = crear('thead');
  const filaCabecera = crear('tr');
  COLUMNAS.forEach((titulo, i) => {
    filaCabecera.appendChild(crear('th', {
      texto: titulo,
      clase: (i === 6 || i === 8) ? 'derecha' : ''
    }));
  });
  thead.appendChild(filaCabecera);
  tabla.appendChild(thead);

  const tbody = crear('tbody');
  registros.forEach((r) => tbody.appendChild(fila(r)));
  tabla.appendChild(tbody);

  envoltura.appendChild(tabla);
  return envoltura;
}

function fila(r) {
  const tr = crear('tr', { datos: { abrible: 'si', id: r.id } });
  tr.addEventListener('click', () => abrirRegistroExistente(r));

  /* VIP: marca discreta, no una columna ancha con texto */
  const tdVip = crear('td');
  if (r.clienteVip) {
    tdVip.appendChild(crear('span', {
      clase: 'vip', texto: '★', atributos: { title: 'Cliente VIP', 'aria-label': 'Cliente VIP' }
    }));
  }
  tr.appendChild(tdVip);

  tr.appendChild(celda(hora12(r.hora_ingreso), { vacio: '—' }));
  tr.appendChild(celda(r.clienteNombre, { vacio: 'Sin nombre' }));
  tr.appendChild(celda(unirMasajistas(r.nombresMasajistas), { vacio: 'Sin asignar' }));
  tr.appendChild(celda(r.servicioNombre, { vacio: '—' }));
  tr.appendChild(celda(r.duracion ? duracion(r.duracion) : null));

  /* Descuento: si no hay, un guion. Nunca un cero falso. */
  tr.appendChild(
    Number(r.descuento) > 0
      ? celdaMonto(r.descuento)
      : celda(null, { clase: 'monto' })
  );

  tr.appendChild(celda(textoPago(r), { vacio: 'No registrado' }));

  tr.appendChild(
    r.estado === 'atendido'
      ? celdaMonto(r.precio_cobrado)
      : celda(null, { clase: 'monto' })
  );

  const tdEstado = crear('td');
  tdEstado.appendChild(pastilla(r.estado));
  tr.appendChild(tdEstado);

  return tr;
}

function textoPago(r) {
  const medios = Object.entries(r.pagos || {});
  if (!medios.length) return null;
  if (medios.length === 1) return capitalizarMedio(medios[0][0]);
  return medios.map(([m, monto]) => `${capitalizarMedio(m)} ${soles(monto)}`).join(' + ');
}

function capitalizarMedio(m) {
  return ({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', yape: 'Yape' })[m] || m;
}

/* ── Tarjetas (celular) ─────────────────────────────────────────────── */

function tarjetasMovil() {
  const lista = crear('div', { clase: 'lista-tarjetas' });

  registros.forEach((r) => {
    const tarjeta = crear('div', { clase: 'tarjeta-fila', datos: { id: r.id } });
    tarjeta.addEventListener('click', () => abrirRegistroExistente(r));

    tarjeta.appendChild(crear('span', { clase: 'hora', texto: hora12(r.hora_ingreso, { vacio: '—' }) }));

    const nombre = crear('span', { clase: 'cliente', texto: r.clienteNombre || 'Sin nombre' });
    if (r.clienteVip) nombre.appendChild(crear('span', { clase: 'vip', texto: ' ★' }));
    tarjeta.appendChild(nombre);

    tarjeta.appendChild(pastilla(r.estado));

    const partes = [
      unirMasajistas(r.nombresMasajistas),
      r.servicioNombre || '—',
      r.estado === 'atendido' ? soles(r.precio_cobrado) : null,
      textoPago(r) || 'Pago no registrado'
    ].filter(Boolean);

    tarjeta.appendChild(crear('span', { clase: 'detalle', texto: partes.join(' · ') }));
    lista.appendChild(tarjeta);
  });

  return lista;
}

/* ── Pie condicional al rol ─────────────────────────────────────────── */

function pie() {
  const atendidos = registros.filter((r) => r.estado === 'atendido');
  const caja = crear('div', { clase: 'pie-agenda' });

  caja.appendChild(crear('span', { texto: plural(atendidos.length, 'atención', 'atenciones') }));

  const reservas = registros.filter((r) => r.estado === 'reserva').length;
  if (reservas) {
    caja.appendChild(crear('span', { texto: `${plural(reservas, 'reserva', 'reservas')} sin completar` }));
  }

  /* El total del día SOLO lo ve el Administrador (§3.2).
     Ocultarlo es una separación de interfaz, no una barrera criptográfica:
     Recepción lee cada monto individual y podría sumarlos. Es una decisión
     aceptada y está dicha tal cual en la documentación. */
  if (esAdmin()) {
    const total = atendidos.reduce((suma, r) => suma + Number(r.precio_cobrado || 0), 0);
    caja.appendChild(crear('strong', { texto: `Total del día: ${soles(total)}` }));
  }

  return caja;
}

function nota() {
  const sinPago = registros.filter(
    (r) => r.estado === 'atendido' && !Object.keys(r.pagos || {}).length
  ).length;

  if (!sinPago) return crear('div');

  const caja = crear('p', {
    clase: 'campo-ayuda',
    atributos: { style: 'margin-top:10px' },
    texto: `${plural(sinPago, 'atención', 'atenciones')} sin forma de pago registrada. Al cerrar el día, la caja puede no cuadrar.`
  });
  return caja;
}

/* ══════════════════════════════════════════════════════════════════════
   ACCIONES
   ══════════════════════════════════════════════════════════════════════ */

async function abrirRegistro() {
  const { irA } = await import('./app.js');
  irA('registro', { fecha });
}

/** Tocar una fila: si es reserva, se abre para completarla; si ya está
    atendida, se abre el detalle. */
async function abrirRegistroExistente(r) {
  if (r.estado === 'reserva') {
    const registro = await import('./registro.js');
    await registro.completarReserva(r.id, { alGuardar: refrescar });
    return;
  }
  const historial = await import('./historial.js');
  await historial.abrirDetalle(r.id, { alCambiar: refrescar });
}

async function verProximas() {
  const { irA } = await import('./app.js');
  irA('historial', { desde: sumarDias(hoy(), 1), estado: 'reserva', titulo: 'Próximas reservas' });
}

async function elegirOtroDia() {
  const campo = crear('input', {
    atributos: { type: 'date', value: fecha, style: 'width:100%;min-height:52px;font-size:19px' }
  });
  const caja = crear('label', { clase: 'campo' });
  caja.append(crear('span', { clase: 'campo-etiqueta', texto: 'Día que quieres ver' }), campo);

  const ok = await confirmar({ titulo: 'Ver otro día', extra: caja, aceptar: 'Ver' });
  if (ok && campo.value) cambiarFecha(campo.value);
}

/* Hora estimada de término, para el detalle rápido de una fila.
   Es informativa: no se guarda como dato duro (§5.2). */
export function terminaAprox(r) {
  return r.hora_ingreso && r.duracion ? horaFin(r.hora_ingreso, r.duracion) : null;
}
