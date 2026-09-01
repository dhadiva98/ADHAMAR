/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — realtime.js
   Lo que se registra en la computadora aparece en el celular sin recargar.

   Tres cuidados que evitan que esto se convierta en un problema:

     1. Los eventos se AGRUPAN 250 ms. Guardar un servicio dispara tres
        cambios seguidos (registro, masajistas, pagos); sin agrupar, la
        pantalla se repintaría tres veces en ráfaga.
     2. Solo se repinta si la vista abierta DEPENDE de la tabla que cambió.
        Estando en Tarifario no tiene sentido repintar por una asistencia.
     3. Se cancela la suscripción anterior antes de crear otra, para no
        acumular oyentes cada vez que se reconecta.
   ══════════════════════════════════════════════════════════════════════ */

import { sb, estado, conexion, avisar, escuchar } from './core.js';

/* Tablas que vale la pena vigilar. Las de auditoría no: nadie mira esa
   pantalla esperando que se mueva sola. */
const TABLAS = [
  'registros_servicios',
  'registro_masajistas',
  'pagos_registro',
  'clientes',
  'servicios',
  'masajistas',
  'asistencias',
  'cierres_diarios'
];

let canal = null;
let pendientes = new Set();
let reloj = null;
let conectado = false;

/* ── Agrupador ──────────────────────────────────────────────────────── */

function anotarCambio(tabla) {
  pendientes.add(tabla);
  clearTimeout(reloj);
  reloj = setTimeout(despachar, 250);
}

function despachar() {
  const tablas = Array.from(pendientes);
  pendientes = new Set();
  if (!tablas.length) return;

  /* Aviso general: lo escuchan piezas sueltas (el pie de la agenda, el
     estado del cierre) aunque no sean la vista activa. */
  avisar('datos-cambiaron', tablas);

  const modulo = estado.modulo;
  if (!modulo || typeof modulo.refrescar !== 'function') return;

  const leInteresan = modulo.tablas || [];
  const afectado = tablas.some((t) => leInteresan.includes(t));
  if (!afectado) return;

  try {
    modulo.refrescar({ tablas });
  } catch (e) {
    console.warn('[realtime] la vista falló al refrescar', e);
  }
}

/* ── Suscripción ────────────────────────────────────────────────────── */

export function iniciar() {
  detener();

  canal = sb.channel('adhamar-cambios');

  TABLAS.forEach((tabla) => {
    canal.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: tabla },
      (evento) => anotarCambio(evento.table || tabla)
    );
  });

  canal.subscribe((situacion) => {
    if (situacion === 'SUBSCRIBED') {
      conectado = true;
      conexion('conectado');
    } else if (situacion === 'CHANNEL_ERROR' || situacion === 'TIMED_OUT') {
      conectado = false;
      conexion('sin-conexion');
      // Reintento suave: no insistir en bucle si la red está caída
      setTimeout(() => { if (!conectado) iniciar(); }, 8000);
    } else if (situacion === 'CLOSED') {
      conectado = false;
    }
  });
}

export function detener() {
  clearTimeout(reloj);
  pendientes = new Set();
  if (canal) {
    try { sb.removeChannel(canal); } catch (e) { /* ya estaba cerrado */ }
    canal = null;
  }
  conectado = false;
}

export function estaConectado() {
  return conectado;
}

/* Al volver del segundo plano el websocket suele haber muerto en
   silencio. Se rehace la suscripción y se repinta la vista actual, porque
   mientras tanto pudo cambiar todo. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!estado.perfil || estado.bloqueada) return;
  if (!conectado) iniciar();
  estado.modulo?.refrescar?.({ tablas: TABLAS, motivo: 'volvimos' });
});

window.addEventListener('online', () => {
  if (estado.perfil && !estado.bloqueada) iniciar();
});

/* Mientras la aplicación está bloqueada no hace falta escuchar nada. */
escuchar('pantalla', (cual) => {
  if (cual === 'bloqueo' || cual === 'login') detener();
});
