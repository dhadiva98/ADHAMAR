// ===========================================================================
//  ACCESO — dos niveles claramente separados
//
//  NIVEL 1  Correo + contraseña -> Supabase Auth. Una sola vez por equipo,
//           lo hace el administrador al activarlo.
//  NIVEL 2  Inactividad -> bloqueo -> PIN de 4 dígitos. El uso diario.
//
//  El PIN solo desbloquea la interfaz. Nunca cierra ni sustituye la sesión.
// ===========================================================================
import { sb, estado, DISPOSITIVO, mensajeError } from './core.js';
import { $, avisar } from './ui.js';

const CLAVE_ACTIVIDAD = 'adhamar.actividad';
const CLAVE_BLOQUEO   = 'adhamar.bloqueada';

let alDesbloquear = null;
let temporizador  = null;

// --- Pantallas --------------------------------------------------------------
const mostrar = id => {
  ['splash', 'login', 'bloqueo', 'crear-pin'].forEach(p =>
    $('#' + p).classList.toggle('oculto', p !== id));
  $('#app').classList.toggle('oculto', id !== null);
};
export const mostrarApp = () => mostrar(null);

// ===========================  NIVEL 1: SESIÓN  =============================

export async function iniciarAcceso(alEntrar) {
  alDesbloquear = alEntrar;

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return pantallaLogin();

  const listo = await cargarPerfil();
  if (!listo) return;

  // ¿Ya tiene PIN configurado en este dispositivo?
  const { data: tienePin } = await sb.rpc('tengo_pin');
  if (!tienePin) return pantallaCrearPin();

  // ¿Estaba bloqueada, o pasó el tiempo de inactividad estando en segundo plano?
  if (localStorage.getItem(CLAVE_BLOQUEO) === '1' || inactivaDemasiado()) return bloquear();

  desbloquear();
}

async function cargarPerfil() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { pantallaLogin(); return false; }

  const { data, error } = await sb.from('perfiles').select('*').eq('id', user.id).single();
  if (error || !data) {
    avisar('Tu usuario todavía no tiene un perfil asignado. Avisa al administrador.', 'error');
    await sb.auth.signOut(); pantallaLogin(); return false;
  }
  if (!data.activo) {
    avisar('Este usuario fue desactivado.', 'error');
    await sb.auth.signOut(); pantallaLogin(); return false;
  }
  estado.usuario = data;
  $('#lateral-rol').textContent = `${data.nombre} · ${data.rol === 'admin' ? 'Administradora' : 'Recepción'}`;
  return true;
}

function pantallaLogin() {
  mostrar('login');
  const f = $('#form-login');
  f.querySelectorAll('.chip').forEach(c => {
    c.onclick = () => { $('#login-equipo').value = c.dataset.equipo; };
  });

  f.onsubmit = async e => {
    e.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Entrando…';

    const { error } = await sb.auth.signInWithPassword({
      email: $('#login-correo').value.trim(),
      password: $('#login-clave').value
    });

    if (error) {
      err.textContent = /Invalid login/i.test(error.message)
        ? 'El correo o la contraseña no coinciden.'
        : mensajeError(error);
      err.hidden = false;
      btn.disabled = false; btn.textContent = 'Entrar';
      return;
    }

    // Registra este equipo con su nombre legible, para poder revocarlo después.
    try {
      await sb.rpc('registrar_dispositivo', {
        p_device_id: DISPOSITIVO,
        p_nombre: $('#login-equipo').value.trim() || 'Equipo sin nombre',
        p_user_agent: navigator.userAgent.slice(0, 200)
      });
    } catch (_) { /* no bloquea la entrada */ }

    localStorage.removeItem(CLAVE_BLOQUEO);
    f.reset();
    btn.disabled = false; btn.textContent = 'Entrar';
    iniciarAcceso(alDesbloquear);
  };
}

export async function cerrarSesion() {
  detener();
  localStorage.removeItem(CLAVE_BLOQUEO);
  await sb.auth.signOut();
  location.reload();
}

// ===========================  NIVEL 2: PIN  ================================

function pantallaCrearPin() {
  mostrar('crear-pin');
  const f = $('#form-pin');
  f.onsubmit = async e => {
    e.preventDefault();
    const err = $('#pin-crear-error');
    const a = $('#pin-nuevo').value, b = $('#pin-repite').value;
    err.hidden = true;

    if (!/^[0-9]{4}$/.test(a)) { err.textContent = 'El PIN son cuatro números, ni más ni menos.'; err.hidden = false; return; }
    if (a !== b)               { err.textContent = 'Los dos PIN no coinciden.'; err.hidden = false; return; }

    try {
      await sb.rpc('establecer_pin', { p_pin: a });
      f.reset();
      avisar('PIN guardado', 'exito');
      desbloquear();
    } catch (ex) { err.textContent = mensajeError(ex); err.hidden = false; }
  };
}

export function bloquear() {
  if (estado.bloqueada) return;
  estado.bloqueada = true;
  localStorage.setItem(CLAVE_BLOQUEO, '1');
  mostrar('bloqueo');
  prepararTeclado();
}

function prepararTeclado() {
  const input  = $('#pin-input');
  const puntos = $('#pin-puntos');
  const err    = $('#pin-error');
  input.value = ''; err.hidden = true;
  pintarPuntos(0);

  setTimeout(() => input.focus(), 120);
  puntos.onclick = () => input.focus();

  input.oninput = () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 4);
    pintarPuntos(input.value.length);
    if (input.value.length === 4) intentar();
  };
  $('#btn-desbloquear').onclick = intentar;

  $('#btn-olvide-pin').onclick = async () => {
    // Nunca se muestra el PIN anterior: se reautentica y se crea uno nuevo.
    await sb.auth.signOut();
    localStorage.removeItem(CLAVE_BLOQUEO);
    estado.bloqueada = false;
    avisar('Entra con tu correo y contraseña para crear un PIN nuevo.');
    pantallaLogin();
  };

  // Cambiar de usuario NUNCA se hace escribiendo otro PIN.
  $('#btn-cambiar-usuario').onclick = cerrarSesion;

  function pintarPuntos(n) {
    puntos.querySelectorAll('i').forEach((p, i) => p.classList.toggle('lleno', i < n));
  }

  async function intentar() {
    const pin = input.value;
    if (pin.length !== 4) { fallo('Escribe los cuatro números.'); return; }
    try {
      const r = await sb.rpc('verificar_pin', { p_pin: pin }).then(({ data, error }) => {
        if (error) throw error; return data;
      });
      if (r.ok) {
        estado.bloqueada = false;
        localStorage.removeItem(CLAVE_BLOQUEO);
        desbloquear();
        return;
      }
      if (r.motivo === 'espera')       fallo(`Espera ${r.segundos} segundos antes de intentarlo otra vez.`);
      else if (r.motivo === 'reautenticar') {
        avisar('Demasiados intentos. Entra con tu correo y contraseña.', 'error');
        cerrarSesion();
      }
      else if (r.motivo === 'sin_acceso') {
        // El dispositivo fue revocado o el usuario desactivado.
        avisar('Este equipo ya no tiene acceso.', 'error');
        cerrarSesion();
      }
      else fallo('PIN incorrecto');
    } catch (ex) { fallo(mensajeError(ex)); }
  }

  function fallo(msg) {
    err.textContent = msg; err.hidden = false;
    input.value = ''; pintarPuntos(0);
    puntos.classList.add('sacudir');
    setTimeout(() => puntos.classList.remove('sacudir'), 360);
    if (navigator.vibrate) navigator.vibrate([14, 70, 14]);
    input.focus();
  }
}

async function desbloquear() {
  // Comprobación contra el servidor al desbloquear: si este equipo fue
  // revocado, se cierra sesión y se limpia todo estado local de inmediato.
  try {
    const { data } = await sb.rpc('dispositivo_autorizado');
    if (data === false) {
      avisar('Este equipo ya no tiene acceso.', 'error');
      return cerrarSesion();
    }
  } catch (_) { /* sin red: se reintenta en la siguiente acción */ }

  estado.bloqueada = false;
  marcarActividad();
  mostrarApp();
  vigilar();
  alDesbloquear?.();
}

// ===========================  INACTIVIDAD  =================================
//
//  No se confía solo en setTimeout: se guarda la marca de la última actividad
//  y se recalcula el tiempo transcurrido cada vez que la app vuelve a estar
//  activa. Así funciona aunque el navegador estuviera en segundo plano, el
//  celular apagara la pantalla, la laptop se bloqueara o el sistema congelara
//  el JavaScript.
//
//  LÍMITE HONESTO: una web no puede detectar el bloqueo físico del dispositivo
//  ni ejecutar código mientras la pestaña está suspendida. Lo que sí puede
//  hacer, y hace, es comprobar el reloj al reactivarse: si pasó más tiempo del
//  permitido, bloquea antes de mostrar nada.

const minutos = () => estado.usuario?.bloqueo_minutos ?? window.CONFIG.BLOQUEO_MINUTOS_DEFECTO;

function marcarActividad() { localStorage.setItem(CLAVE_ACTIVIDAD, String(Date.now())); }

function inactivaDemasiado() {
  const m = minutos();
  if (m === 0) return false;                       // "Nunca"
  const t = Number(localStorage.getItem(CLAVE_ACTIVIDAD) || 0);
  return t > 0 && (Date.now() - t) > m * 60000;
}

let ultimoRegistro = 0;
function actividad() {
  const ahora = Date.now();
  if (ahora - ultimoRegistro < 4000) return;       // throttle: no en cada píxel
  ultimoRegistro = ahora;
  marcarActividad();
}

function vigilar() {
  detener();
  ['click', 'touchstart', 'keydown', 'scroll', 'mousemove', 'input']
    .forEach(ev => document.addEventListener(ev, actividad, { passive: true }));

  document.addEventListener('visibilitychange', alVolver);
  window.addEventListener('focus', alVolver);

  temporizador = setInterval(() => { if (inactivaDemasiado()) bloquear(); }, 15000);
}

function alVolver() {
  if (document.visibilityState !== 'visible') return;
  if (inactivaDemasiado()) return bloquear();
  marcarActividad();
  // Al recuperar visibilidad, revalidar contra el servidor.
  sb.rpc('dispositivo_autorizado').then(({ data }) => {
    if (data === false) { avisar('Este equipo ya no tiene acceso.', 'error'); cerrarSesion(); }
  }).catch(() => {});
}

function detener() {
  clearInterval(temporizador);
  ['click', 'touchstart', 'keydown', 'scroll', 'mousemove', 'input']
    .forEach(ev => document.removeEventListener(ev, actividad));
  document.removeEventListener('visibilitychange', alVolver);
  window.removeEventListener('focus', alVolver);
}

export function bloquearAhora() { bloquear(); }
