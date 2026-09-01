/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — acceso.js
   Los dos niveles de acceso (§3):

     NIVEL 1 — SESIÓN   correo + contraseña → una sola vez por dispositivo
     NIVEL 2 — BLOQUEO  X minutos sin actividad → PIN de 4 dígitos

   El PIN no sustituye a la sesión: solo desbloquea la interfaz. Y nunca
   se compara en el navegador; la base responde únicamente sí o no.
   ══════════════════════════════════════════════════════════════════════ */

import {
  sb, estado, $, crear, preferencia, avisar,
  traducirError, olvidarDispositivo, vibrar
} from './core.js';

import {
  miPerfil, registrarDispositivo, dispositivoAutorizado,
  definirPin, verificarPin, cambiarPin, guardarMinutosBloqueo
} from './datos.js';

import { aviso, avisoError, confirmar, campo } from './ui.js';

const CFG = window.CONFIG_ADHAMAR;

/* ── PANTALLAS ───────────────────────────────────────────────────────── */

const PANTALLAS = {
  login:    '#pantalla-login',
  pinNuevo: '#pantalla-pin-nuevo',
  bloqueo:  '#pantalla-bloqueo',
  app:      '#app'
};

export function mostrarPantalla(cual) {
  Object.entries(PANTALLAS).forEach(([nombre, selector]) => {
    const el = $(selector);
    if (el) el.hidden = (nombre !== cual);
  });
  estado.bloqueada = (cual === 'bloqueo');
  avisar('pantalla', cual);
}

/* ══════════════════════════════════════════════════════════════════════
   ARRANQUE
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Decide en qué pantalla empieza la aplicación.
 * @returns {'app'|'bloqueo'|'login'|'pinNuevo'}
 */
export async function iniciarAcceso() {
  conectarFormularios();
  vigilarInactividad();
  vigilarSesion();

  const { data: { session } } = await sb.auth.getSession();
  if (!session) { mostrarPantalla('login'); return 'login'; }
  estado.sesion = session;

  try {
    estado.perfil = await miPerfil();
  } catch (e) {
    // Usuario sin perfil o desactivado: no tiene sentido dejarlo entrar
    await sb.auth.signOut();
    mostrarPantalla('login');
    mostrarErrorLogin(e.amable ? e.message : traducirError(e));
    return 'login';
  }

  /* El equipo tiene que seguir autorizado. Un dispositivo desconocido se
     registra solo; lo que bloquea es que esté marcado como revocado. */
  if (!(await dispositivoAutorizado())) {
    await expulsar('Este dispositivo fue desconectado desde administración. Vuelve a entrar con tu correo y contraseña si corresponde.');
    return 'login';
  }

  await registrarDispositivo(preferencia('dispositivoNombre') || 'Dispositivo');

  if (!estado.perfil.tienePin) {
    mostrarPantalla('pinNuevo');
    return 'pinNuevo';
  }

  if (debeEstarBloqueada()) {
    bloquear({ silencioso: true });
    return 'bloqueo';
  }

  marcarActividad();
  mostrarPantalla('app');
  return 'app';
}

/** Cierra sesión, limpia todo rastro local y vuelve al login. */
export async function cerrarSesion({ olvidarEquipo = false } = {}) {
  try { await sb.auth.signOut(); } catch (e) { /* aunque falle, seguimos limpiando */ }
  estado.sesion = null;
  estado.perfil = null;
  preferencia('bloqueada', null);
  preferencia('ultimaActividad', null);
  if (olvidarEquipo) olvidarDispositivo();
  mostrarPantalla('login');
}

async function expulsar(mensaje) {
  await cerrarSesion();
  mostrarErrorLogin(mensaje);
}

/** Si la sesión se cierra en otra pestaña o el token expira, reaccionamos. */
function vigilarSesion() {
  sb.auth.onAuthStateChange((evento, sesion) => {
    estado.sesion = sesion;
    if (evento === 'SIGNED_OUT' && !$('#pantalla-login').hidden === false) {
      mostrarPantalla('login');
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════
   NIVEL 1 — CORREO Y CONTRASEÑA
   ══════════════════════════════════════════════════════════════════════ */

function mostrarErrorLogin(texto) {
  const caja = $('#login-error');
  if (!caja) return;
  caja.textContent = texto;
  caja.hidden = !texto;
}

function conectarFormularios() {
  /* Login */
  $('#form-login')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = $('#login-entrar');
    const correo = $('#login-correo').value.trim();
    const clave = $('#login-clave').value;
    const equipo = $('#login-dispositivo').value.trim();

    if (!correo || !clave) { mostrarErrorLogin('Falta escribir el correo y la contraseña.'); return; }
    if (!equipo) { mostrarErrorLogin('Ponle un nombre a este dispositivo, por ejemplo "Celular de Dhamar".'); return; }

    mostrarErrorLogin('');
    boton.disabled = true;
    boton.textContent = 'Entrando…';

    try {
      const { error } = await sb.auth.signInWithPassword({ email: correo, password: clave });
      if (error) throw error;

      preferencia('dispositivoNombre', equipo);
      estado.perfil = await miPerfil();
      await registrarDispositivo(equipo);

      $('#login-clave').value = '';
      marcarActividad();

      if (!estado.perfil.tienePin) mostrarPantalla('pinNuevo');
      else { mostrarPantalla('app'); avisar('sesion-lista'); }
    } catch (err) {
      mostrarErrorLogin(err.amable ? err.message : traducirError(err));
    } finally {
      boton.disabled = false;
      boton.textContent = 'Entrar';
    }
  });

  /* Crear PIN */
  $('#form-pin-nuevo')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const uno = $('#pin-nuevo').value;
    const dos = $('#pin-nuevo-repetir').value;
    const error = $('#pin-nuevo-error');

    const decir = (t) => { error.textContent = t; error.hidden = !t; };

    if (!/^\d{4}$/.test(uno)) { decir('El PIN tiene que ser de cuatro dígitos.'); return; }
    if (uno !== dos) { decir('Los dos PIN no coinciden. Vuelve a escribirlos.'); return; }

    decir('');
    try {
      await definirPin(uno);
      estado.perfil.tienePin = true;
      $('#pin-nuevo').value = '';
      $('#pin-nuevo-repetir').value = '';
      marcarActividad();
      mostrarPantalla('app');
      avisar('sesion-lista');
      aviso('PIN guardado');
    } catch (err) {
      decir(err.amable ? err.message : traducirError(err));
    }
  });

  /* Desbloquear */
  $('#form-bloqueo')?.addEventListener('submit', (e) => {
    e.preventDefault();
    intentarDesbloquear();
  });

  /* Al completar los cuatro dígitos, no hace falta tocar el botón */
  $('#bloqueo-pin')?.addEventListener('input', (e) => {
    if (/^\d{4}$/.test(e.target.value)) intentarDesbloquear();
  });

  $('#bloqueo-olvide')?.addEventListener('click', olvideMiPin);

  $('#bloqueo-cambiar-usuario')?.addEventListener('click', async () => {
    const seguro = await confirmar({
      titulo: 'Cambiar de usuario',
      texto: 'Se cerrará la sesión en este dispositivo. Para volver a entrar hará falta el correo y la contraseña.',
      aceptar: 'Cerrar sesión'
    });
    if (seguro) cerrarSesion();
  });
}

/* ══════════════════════════════════════════════════════════════════════
   NIVEL 2 — PIN Y BLOQUEO
   ══════════════════════════════════════════════════════════════════════ */

let intentosFallidos = 0;
let esperandoHasta = 0;

function mostrarErrorBloqueo(texto) {
  const caja = $('#bloqueo-error');
  caja.textContent = texto;
  caja.hidden = !texto;
}

export function bloquear({ silencioso = false } = {}) {
  if (!estado.perfil) return;
  preferencia('bloqueada', '1');
  $('#bloqueo-pin').value = '';
  mostrarErrorBloqueo('');
  $('#bloqueo-usuario').textContent = estado.perfil.nombre || '';
  mostrarPantalla('bloqueo');
  if (!silencioso) vibrar(10);
  setTimeout(() => $('#bloqueo-pin')?.focus(), 80);
}

async function intentarDesbloquear() {
  const campoPin = $('#bloqueo-pin');
  const pin = campoPin.value;

  const restante = Math.ceil((esperandoHasta - Date.now()) / 1000);
  if (restante > 0) {
    mostrarErrorBloqueo(`Espera ${restante} segundo${restante === 1 ? '' : 's'} antes de volver a intentar.`);
    return;
  }

  if (!/^\d{4}$/.test(pin)) { mostrarErrorBloqueo('El PIN son cuatro dígitos.'); return; }

  try {
    const correcto = await verificarPin(pin);

    if (!correcto) {
      intentosFallidos += 1;
      campoPin.value = '';
      vibrar([10, 60, 10]);

      /* Retraso progresivo: 0, 0, 2s, 4s, 8s, 15s… */
      if (intentosFallidos >= 3) {
        const espera = Math.min(2 ** (intentosFallidos - 2), 15) * 1000;
        esperandoHasta = Date.now() + espera;
        mostrarErrorBloqueo(`PIN incorrecto. Espera ${espera / 1000} segundos antes de volver a intentar.`);
      } else {
        mostrarErrorBloqueo('PIN incorrecto.');
      }
      return;
    }

    /* Correcto. Antes de dejar entrar, comprobamos contra el servidor que
       este equipo no haya sido revocado mientras estaba bloqueado (§3.3). */
    if (!(await dispositivoAutorizado())) {
      await expulsar('Este dispositivo fue desconectado desde administración.');
      return;
    }

    intentosFallidos = 0;
    esperandoHasta = 0;
    campoPin.value = '';
    mostrarErrorBloqueo('');
    preferencia('bloqueada', null);
    marcarActividad();
    mostrarPantalla('app');
    avisar('desbloqueada');
  } catch (err) {
    mostrarErrorBloqueo(err.amable ? err.message : traducirError(err));
  }
}

/** "¿Olvidaste tu PIN?" — se reautentica y se crea uno nuevo. Nunca se
    muestra el anterior, porque en la base solo hay un hash. */
async function olvideMiPin() {
  const caja = crear('div');
  const { campo: c1, entrada: correo } = campo('Correo', { tipo: 'email', atributos: { autocomplete: 'username', autocapitalize: 'none' } });
  const { campo: c2, entrada: clave } = campo('Contraseña', { tipo: 'password', atributos: { autocomplete: 'current-password' } });
  caja.append(c1, c2);

  const sigue = await confirmar({
    titulo: '¿Olvidaste tu PIN?',
    texto: 'Escribe tu correo y contraseña para crear uno nuevo.',
    extra: caja,
    aceptar: 'Continuar'
  });
  if (!sigue) return;

  try {
    const { error } = await sb.auth.signInWithPassword({
      email: correo.value.trim(),
      password: clave.value
    });
    if (error) throw error;

    estado.perfil = await miPerfil();
    estado.perfil.tienePin = false;
    preferencia('bloqueada', null);
    mostrarPantalla('pinNuevo');
  } catch (err) {
    avisoError(err.amable ? err.message : traducirError(err));
  }
}

/** "Mi cuenta → Cambiar PIN". Lo usa configuracion.js. */
export async function pedirCambioDePin() {
  const caja = crear('div');
  const { campo: c1, entrada: actual } = campo('PIN actual', { tipo: 'password', atributos: { inputmode: 'numeric', maxlength: '4' } });
  const { campo: c2, entrada: nuevo } = campo('PIN nuevo', { tipo: 'password', atributos: { inputmode: 'numeric', maxlength: '4' } });
  const { campo: c3, entrada: repetir } = campo('Repite el PIN nuevo', { tipo: 'password', atributos: { inputmode: 'numeric', maxlength: '4' } });
  caja.append(c1, c2, c3);

  const sigue = await confirmar({ titulo: 'Cambiar PIN', extra: caja, aceptar: 'Guardar PIN' });
  if (!sigue) return false;

  if (!/^\d{4}$/.test(nuevo.value)) { avisoError('El PIN nuevo tiene que ser de cuatro dígitos.'); return false; }
  if (nuevo.value !== repetir.value) { avisoError('Los dos PIN nuevos no coinciden.'); return false; }

  try {
    const ok = await cambiarPin(actual.value, nuevo.value);
    if (!ok) { avisoError('El PIN actual no es correcto.'); return false; }
    aviso('PIN cambiado');
    return true;
  } catch (err) {
    avisoError(err.amable ? err.message : traducirError(err));
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   INACTIVIDAD

   No se confía en setTimeout (§3.5): el navegador congela JavaScript
   cuando la pestaña pasa a segundo plano o el celular apaga la pantalla,
   y el temporizador simplemente no se dispara. Lo que se guarda es la
   MARCA DE TIEMPO de la última actividad, y se compara el reloj cada vez
   que la aplicación vuelve a estar visible.

   Límite honesto: una web no puede saber si el dispositivo se bloqueó
   físicamente. Lo que sí detecta es que dejó de estar visible, y al
   volver compara el reloj. Por eso, si roban el equipo con la aplicación
   abierta y desbloqueada, el PIN no protege nada en ese momento: la única
   defensa real en esa ventana es un bloqueo corto.
   ══════════════════════════════════════════════════════════════════════ */

function minutosBloqueo() {
  const m = estado.perfil?.bloqueo_minutos ?? CFG.bloqueoMinutos ?? 15;
  return Number(m) || 0;    // 0 = nunca bloquear
}

export function marcarActividad() {
  preferencia('ultimaActividad', Date.now());
}

function debeEstarBloqueada() {
  if (preferencia('bloqueada') === '1') return true;

  const minutos = minutosBloqueo();
  if (!minutos) return false;

  const ultima = Number(preferencia('ultimaActividad') || 0);
  if (!ultima) return false;

  return (Date.now() - ultima) > minutos * 60 * 1000;
}

function comprobarInactividad() {
  if (!estado.perfil || estado.bloqueada) return;
  if ($('#app')?.hidden) return;          // todavía no entró
  if (debeEstarBloqueada()) bloquear();
}

let ultimoRegistro = 0;

function vigilarInactividad() {
  /* Actividad real, con freno: no hace falta escribir en localStorage
     con cada movimiento del ratón. */
  const registrar = () => {
    if (estado.bloqueada) return;
    const ahora = Date.now();
    if (ahora - ultimoRegistro < 5000) return;
    ultimoRegistro = ahora;
    marcarActividad();
  };

  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'submit'].forEach((evento) => {
    document.addEventListener(evento, registrar, { passive: true, capture: true });
  });

  /* Los tres momentos en que de verdad hay que comparar el reloj */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') comprobarInactividad();
    else marcarActividad();
  });
  window.addEventListener('focus', comprobarInactividad);
  window.addEventListener('pageshow', comprobarInactividad);

  /* Y una comprobación periódica, por si la pestaña sigue visible pero
     nadie la toca. Es un respaldo, no el mecanismo principal. */
  setInterval(comprobarInactividad, 20000);
}

/** Configuración → cambiar los minutos de bloqueo. */
export async function cambiarMinutosBloqueo(minutos) {
  await guardarMinutosBloqueo(minutos);
  estado.perfil.bloqueo_minutos = minutos;
  marcarActividad();
}
