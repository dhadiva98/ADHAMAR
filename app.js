/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — app.js
   Punto de entrada. Es el único módulo que index.html carga directamente;
   todo lo demás cuelga de aquí.

   Su trabajo: arrancar el acceso, montar la navegación y traer cada vista
   cuando hace falta. No sabe nada de masajes, precios ni caja.
   ══════════════════════════════════════════════════════════════════════ */

import { estado, esAdmin, $, $$, vaciar, escuchar, traducirError } from './core.js';
import { aviso, avisoError, esqueleto, vacio } from './ui.js';
import { iniciarAcceso, bloquear, marcarActividad } from './acceso.js';

/* ── MAPA DE VISTAS ──────────────────────────────────────────────────────
   Cada sección vive en un archivo y se trae cuando se abre por primera
   vez. Así el arranque es liviano y un módulo con un fallo no impide que
   el resto de la aplicación funcione.

   Varias secciones comparten archivo cuando son el mismo flujo de trabajo
   (Tarifario y Servicios son la misma matriz de precios, una de consulta
   y otra de edición). El módulo recibe cuál le tocó en opciones.seccion.

   Contrato de cada módulo de vista: exporta  montar(contenedor, opciones)
   y, opcionalmente,  tablas  (los nombres de tabla que le interesan, para
   que Realtime sepa cuándo repintarlo),  refrescar()  y  desmontar().
   ────────────────────────────────────────────────────────────────────── */

const VISTAS = {
  agenda:        { archivo: './agenda.js',    titulo: 'Agenda del día' },
  registro:      { archivo: './registro.js',  titulo: 'Registrar servicio' },
  historial:     { archivo: './historial.js', titulo: 'Historial' },
  clientes:      { archivo: './clientes.js',  titulo: 'Clientes' },
  tarifario:     { archivo: './catalogo.js',  titulo: 'Tarifario' },
  asistencia:    { archivo: './equipo.js',    titulo: 'Asistencia' },
  servicios:     { archivo: './catalogo.js',  titulo: 'Servicios y precios',     soloAdmin: true },
  masajistas:    { archivo: './equipo.js',    titulo: 'Masajistas',              soloAdmin: true },
  resumen:       { archivo: './caja.js',      titulo: 'Resumen',                 soloAdmin: true },
  caja:          { archivo: './caja.js',      titulo: 'Caja',                    soloAdmin: true },
  reportes:      { archivo: './reportes.js',  titulo: 'Reportes',                soloAdmin: true },
  usuarios:      { archivo: './admin.js',     titulo: 'Usuarios y dispositivos', soloAdmin: true },
  auditoria:     { archivo: './admin.js',     titulo: 'Auditoría',               soloAdmin: true },
  configuracion: { archivo: './admin.js',     titulo: 'Configuración' }
};

const VISTA_INICIAL = 'agenda';

/* ══════════════════════════════════════════════════════════════════════
   NAVEGACIÓN
   ══════════════════════════════════════════════════════════════════════ */

export async function irA(nombre, opciones = {}) {
  const vista = VISTAS[nombre];

  if (!vista) { irA(VISTA_INICIAL); return; }

  /* Ocultar el menú no es seguridad: la barrera está en las policies de
     RLS. Esto solo evita pedirle a la base algo que va a rechazar. */
  if (vista.soloAdmin && !esAdmin()) {
    aviso('Esa sección es solo para administración.', 'info');
    irA(VISTA_INICIAL);
    return;
  }

  const contenedor = $('#vista');
  marcarActividad();

  // Despedir la vista anterior para no acumular suscripciones ni relojes
  try { estado.modulo?.desmontar?.(); } catch (e) { console.warn('[app] al desmontar', e); }
  estado.modulo = null;

  estado.vista = nombre;
  marcarMenu(nombre);
  cerrarCajon();
  document.title = `${vista.titulo} · ADHAMAR`;
  if (location.hash !== `#${nombre}`) history.replaceState(null, '', `#${nombre}`);

  vaciar(contenedor).appendChild(esqueleto(5));
  contenedor.scrollIntoView?.({ block: 'start' });

  let modulo;
  try {
    modulo = await import(vista.archivo);
  } catch (e) {
    console.error('[app] No se pudo cargar el módulo', vista.archivo, e);
    vaciar(contenedor).appendChild(
      vacio(
        'Esta sección todavía no está instalada',
        `Falta el archivo ${vista.archivo.replace('./', '')} en el repositorio. Súbelo al mismo nivel que index.html y vuelve a abrir la aplicación.`
      )
    );
    return;
  }

  try {
    vaciar(contenedor);
    // La sección va en las opciones: varios módulos atienden más de una
    await modulo.montar(contenedor, { ...opciones, seccion: nombre });
    estado.modulo = modulo;
  } catch (e) {
    console.error('[app] Fallo al montar', nombre, e);
    vaciar(contenedor).appendChild(
      vacio('No se pudo abrir esta sección', e.amable ? e.message : traducirError(e))
    );
  }
}

function marcarMenu(nombre) {
  $$('[data-vista]').forEach((boton) => {
    if (boton.dataset.vista === nombre) boton.setAttribute('aria-current', 'page');
    else boton.removeAttribute('aria-current');
  });
}

/* ══════════════════════════════════════════════════════════════════════
   ARMAZÓN: MENÚ, ROL Y CABECERA
   ══════════════════════════════════════════════════════════════════════ */

function abrirCajon() {
  $('#menu')?.setAttribute('data-abierto', 'true');
  $('#menu-fondo').hidden = false;
  $('#btn-menu')?.setAttribute('aria-expanded', 'true');
}

function cerrarCajon() {
  $('#menu')?.removeAttribute('data-abierto');
  $('#menu-fondo').hidden = true;
  $('#btn-menu')?.setAttribute('aria-expanded', 'false');
}

function aplicarRol() {
  const admin = esAdmin();

  /* Se retiran del documento, no se ocultan con CSS: un elemento oculto
     con display:none sigue estando ahí para quien mire el HTML. La
     barrera de verdad, igualmente, son las policies. */
  $$('[data-rol="admin"]').forEach((el) => { if (!admin) el.remove(); });

  $('#usuario-nombre').textContent = estado.perfil?.nombre || '';
  $('#usuario-rol').textContent = admin ? 'Administración' : 'Recepción';
}

function conectarArmazon() {
  // Cualquier elemento con data-vista navega
  document.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-vista]');
    if (!boton) return;
    e.preventDefault();
    irA(boton.dataset.vista);
  });

  $('#btn-menu')?.addEventListener('click', () => {
    const abierto = $('#menu')?.getAttribute('data-abierto') === 'true';
    abierto ? cerrarCajon() : abrirCajon();
  });
  $('#menu-fondo')?.addEventListener('click', cerrarCajon);

  $('#barra-mas')?.addEventListener('click', abrirCajon);

  $('#btn-bloquear')?.addEventListener('click', () => bloquear());

  window.addEventListener('hashchange', () => {
    const nombre = location.hash.replace('#', '');
    if (nombre && nombre !== estado.vista) irA(nombre);
  });

  // Escape cierra el cajón lateral en celular
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarCajon();
  });
}

/* ══════════════════════════════════════════════════════════════════════
   TIEMPO REAL
   Se conecta después de pintar la primera pantalla: es una mejora, no un
   requisito para poder trabajar.
   ══════════════════════════════════════════════════════════════════════ */

async function conectarRealtime() {
  try {
    const realtime = await import('./realtime.js');
    realtime.iniciar();
  } catch (e) {
    console.warn('[app] Realtime no disponible todavía:', e);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   ARRANQUE
   ══════════════════════════════════════════════════════════════════════ */

async function arrancar() {
  conectarArmazon();

  let destino;
  try {
    destino = await iniciarAcceso();
  } catch (e) {
    console.error('[app] Fallo al iniciar el acceso', e);
    window.__arranqueFallo?.(
      'No se pudo conectar con la base de datos',
      'La aplicación cargó, pero no consiguió comunicarse con Supabase.',
      ['Comprueba que el dispositivo tenga internet.',
       'Revisa que la dirección y la clave de <code>config.js</code> sean las del proyecto correcto.',
       'Verifica en Supabase que el proyecto no esté pausado.'],
      e?.message || ''
    );
    return;
  }

  /* Hay pantalla en la que mirar: se retira el splash y se desactiva la
     red de seguridad de los 8 segundos (R9). */
  window.__arranqueOK?.();

  if (destino === 'app') await entrarALaApp();

  // Si entra más tarde (tras crear el PIN o desbloquear), montamos ahí
  escuchar('sesion-lista', entrarALaApp);
  escuchar('desbloqueada', () => { if (!estado.vista) entrarALaApp(); });
}

let appMontada = false;

async function entrarALaApp() {
  if (appMontada) return;
  appMontada = true;

  aplicarRol();

  const desdeUrl = location.hash.replace('#', '');
  await irA(VISTAS[desdeUrl] ? desdeUrl : VISTA_INICIAL);

  conectarRealtime();
}

/* Cualquier fallo que nadie atrapó termina aquí: en un aviso en español,
   nunca en la consola a solas (§7). */
window.addEventListener('unhandledrejection', (e) => {
  if (!appMontada) return;
  const mensaje = e.reason?.amable ? e.reason.message : traducirError(e.reason);
  avisoError(mensaje);
});

arrancar();
