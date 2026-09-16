// ===========================================================================
//  ARRANQUE, NAVEGACIÓN Y TIEMPO REAL
// ===========================================================================
import { sb, estado, esAdmin, hoy, mensajeError } from './core.js';
import { $, $$, iniciarHoja, avisar } from './ui.js';
import { iniciarAcceso, cerrarSesion } from './acceso.js';
import { vistaAgenda, vistaHistorial } from './agenda.js';
import { formularioServicio } from './registro.js';
import { vistaTarifario, vistaServicios } from './catalogo.js';
import { vistaClientes } from './clientes.js';
import { vistaMasajistas } from './masajistas.js';
import { vistaAsistencia } from './asistencia.js';
import { vistaResumen, vistaCaja } from './caja.js';
import { vistaReportes } from './reportes.js';
import { vistaUsuarios, vistaAuditoria, vistaConfiguracion, aplicarTema } from './admin.js';
import * as D from './datos.js';

// --- Menú -------------------------------------------------------------------
// Recepción simplemente no ve Resumen, Caja, Reportes, Servicios, Masajistas,
// Usuarios ni Auditoría. Y aunque manipulara el JavaScript para mostrarlos,
// el RLS del servidor le devolvería vacío o error.
const VISTAS = [
  { id: 'agenda',      titulo: 'Agenda del día', ver: vistaAgenda },
  { id: 'historial',   titulo: 'Historial',      ver: vistaHistorial },
  { id: 'clientes',    titulo: 'Clientes',       ver: vistaClientes },
  { id: 'tarifario',   titulo: 'Tarifario',      ver: vistaTarifario },
  { id: 'asistencia',  titulo: 'Asistencia',     ver: vistaAsistencia },
  { separador: true },
  { id: 'resumen',     titulo: 'Resumen',        ver: vistaResumen,     admin: true },
  { id: 'caja',        titulo: 'Caja',           ver: vistaCaja,        admin: true },
  { id: 'reportes',    titulo: 'Reportes',       ver: vistaReportes,    admin: true },
  { separador: true, admin: true },
  { id: 'servicios',   titulo: 'Servicios',      ver: vistaServicios,   admin: true },
  { id: 'masajistas',  titulo: 'Masajistas',     ver: vistaMasajistas,  admin: true },
  { id: 'usuarios',    titulo: 'Usuarios',       ver: vistaUsuarios,    admin: true },
  { id: 'auditoria',   titulo: 'Auditoría',      ver: vistaAuditoria,   admin: true },
  { separador: true },
  { id: 'ajustes',     titulo: 'Configuración',  ver: vistaConfiguracion }
];

function pintarMenu() {
  const menu = $('#menu');
  menu.innerHTML = VISTAS
    .filter(v => !v.admin || esAdmin())
    .map(v => v.separador ? '<div class="separador"></div>'
      : `<button data-vista="${v.id}">${v.titulo}</button>`).join('');

  menu.querySelectorAll('[data-vista]').forEach(b =>
    b.onclick = () => { ir(b.dataset.vista); cerrarLateral(); });
}

export function ir(id) {
  const v = VISTAS.find(x => x.id === id) || VISTAS[0];
  if (v.admin && !esAdmin()) return;
  estado.vista = v.id;
  $('#titulo-vista').textContent = v.titulo;
  $$('#menu [data-vista]').forEach(b => b.classList.toggle('activo', b.dataset.vista === v.id));
  $('#fab-nuevo').classList.toggle('oculto', !['agenda', 'historial'].includes(v.id));
  v.ver();
  avisoDiaCerrado();
}

// --- Aviso de día cerrado ---------------------------------------------------
// El sistema AVISA, no bloquea. Cualquier corrección recalcula el cierre solo.
async function avisoDiaCerrado() {
  const caja = $('#aviso-dia');
  if (!['agenda', 'historial'].includes(estado.vista)) { caja.classList.add('oculto'); return; }
  try {
    const cerrado = await D.diaCerrado(estado.fecha);
    caja.classList.toggle('oculto', !cerrado);
    if (cerrado) caja.textContent =
      'Este día ya fue cerrado. Si registras o corriges algo, el cierre se recalculará automáticamente.';
  } catch (_) { caja.classList.add('oculto'); }
}

// --- Menú lateral en móvil --------------------------------------------------
const abrirLateral  = () => { $('#lateral').classList.add('abierto'); $('#velo').classList.remove('oculto'); };
const cerrarLateral = () => { $('#lateral').classList.remove('abierto'); $('#velo').classList.add('oculto'); };

// --- Estado de conexión -----------------------------------------------------
function conexion(estadoTxt, texto) {
  [$('#conexion'), $('#conexion-movil')].forEach(el => {
    if (!el) return;
    el.dataset.estado = estadoTxt;
    const t = el.querySelector('span'); if (t) t.textContent = texto;
  });
}

// ===========================================================================
//  TIEMPO REAL
//  Absolutamente todas las tablas. Las restringidas por RLS simplemente no
//  entregan eventos a recepción, así que suscribirse es seguro igualmente.
// ===========================================================================
let canal = null;

const TABLAS = ['registros_servicios', 'registro_masajistas', 'clientes', 'masajistas',
                'servicios', 'masajes', 'modalidades', 'duraciones', 'asistencias',
                'cierres_diarios', 'ajustes_cierre', 'dias_cerrados', 'perfiles',
                'dispositivos', 'auditoria', 'configuracion', 'paquetes'];

// Qué vistas dependen de qué tabla, para no repintar de más.
const AFECTA = {
  registros_servicios: ['agenda', 'historial', 'resumen', 'caja', 'reportes', 'clientes'],
  registro_masajistas: ['agenda', 'historial', 'resumen', 'reportes'],
  clientes:            ['clientes', 'agenda', 'historial'],
  masajistas:          ['masajistas', 'asistencia'],
  servicios:           ['tarifario', 'servicios'],
  masajes:             ['tarifario', 'servicios'],
  modalidades:         ['tarifario', 'servicios'],
  duraciones:          ['tarifario', 'servicios'],
  asistencias:         ['asistencia'],
  cierres_diarios:     ['caja', 'resumen'],
  ajustes_cierre:      ['caja'],
  dias_cerrados:       ['agenda', 'historial', 'caja'],
  perfiles:            ['usuarios'],
  dispositivos:        ['usuarios'],
  auditoria:           ['auditoria'],
  configuracion:       ['ajustes'],
  paquetes:            ['tarifario', 'servicios']
};

let repintarPendiente = null;

function suscribir() {
  desuscribir();
  canal = sb.channel('adhamar');

  TABLAS.forEach(tabla => canal.on('postgres_changes',
    { event: '*', schema: 'public', table: tabla }, carga => {
      // Si el día se acaba de cerrar en la PC, el celular lo muestra al instante.
      if (tabla === 'dias_cerrados' && carga.eventType === 'INSERT') {
        avisar('El día fue cerrado desde otro equipo.');
      }
      if (!(AFECTA[tabla] || []).includes(estado.vista)) return;
      // Agrupa ráfagas de eventos en un solo repintado.
      clearTimeout(repintarPendiente);
      repintarPendiente = setTimeout(() => {
        if (!estado.bloqueada) ir(estado.vista);
      }, 260);
    }));

  canal.subscribe(st => {
    if (st === 'SUBSCRIBED')      conexion('conectado', 'Conectado');
    else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') conexion('sin-conexion', 'Sin conexión');
    else                          conexion('sincronizando', 'Sincronizando…');
  });
}

function desuscribir() {
  if (canal) { sb.removeChannel(canal); canal = null; }
}

// ===========================================================================
//  ARRANQUE
// ===========================================================================
aplicarTema();
iniciarHoja();

$('#btn-menu').onclick   = abrirLateral;
$('#velo').onclick       = cerrarLateral;
$('#btn-salir').onclick  = cerrarSesion;
$('#fab-nuevo').onclick  = () =>
  formularioServicio(null, estado.fecha || hoy(), () => ir(estado.vista));

window.addEventListener('online',  () => { conexion('sincronizando', 'Sincronizando…'); suscribir(); });
window.addEventListener('offline', () => conexion('sin-conexion', 'Sin conexión'));

window.__adhamarArrancó?.();   // silencia la red de seguridad del index.html

iniciarAcceso(() => {
  pintarMenu();
  suscribir();
  estado.fecha = hoy();
  ir('agenda');
}).catch(e => {
  document.body.innerHTML =
    `<div class="pantalla-plena"><p class="error">${mensajeError(e)}</p></div>`;
});

// PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
