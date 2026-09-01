/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — core.js
   El centro del sistema: conexión con Supabase, identidad del dispositivo,
   estado en memoria, traducción de errores y utilidades de DOM.

   Todo lo demás importa desde aquí. Este archivo no pinta pantallas.
   ══════════════════════════════════════════════════════════════════════ */

const CFG = window.CONFIG_ADHAMAR;

/* ── IDENTIDAD DEL DISPOSITIVO ───────────────────────────────────────────
   Un identificador propio de este equipo, guardado en localStorage.
   Viaja en una cabecera para que las policies puedan comprobar si el
   dispositivo fue revocado.

   Honestidad, no adorno (§3.3): esta cabecera la controla el navegador y
   alguien con conocimientos técnicos puede falsificarla. La barrera dura
   es desactivar a la persona, no revocar el equipo. La aplicación lo dice
   en pantalla, en Usuarios y dispositivos.
   ────────────────────────────────────────────────────────────────────── */

const LLAVE_DISPOSITIVO = 'adhamar.dispositivo';

export function dispositivoId() {
  let id = null;
  try {
    id = localStorage.getItem(LLAVE_DISPOSITIVO);
  } catch (e) { /* navegación privada muy restrictiva */ }

  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
         `d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try { localStorage.setItem(LLAVE_DISPOSITIVO, id); } catch (e) {}
  }
  return id;
}

export function olvidarDispositivo() {
  try { localStorage.removeItem(LLAVE_DISPOSITIVO); } catch (e) {}
}

/* ── CLIENTE DE SUPABASE ─────────────────────────────────────────────── */

export const sb = window.supabase.createClient(CFG.url.trim(), CFG.anonKey.trim(), {
  auth: {
    persistSession: true,       // la sesión sobrevive a cerrar la pestaña (§3.3)
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'adhamar.sesion'
  },
  global: {
    headers: { 'x-dispositivo': dispositivoId() }
  },
  realtime: {
    params: { eventsPerSecond: 5 }
  }
});

/* ── ESTADO EN MEMORIA ───────────────────────────────────────────────────
   Nunca es fuente de verdad: es una copia de lo que ya confirmó el
   servidor. En localStorage solo van preferencias y estado de bloqueo.
   ────────────────────────────────────────────────────────────────────── */

export const estado = {
  sesion: null,
  perfil: null,          // { id, nombre, rol, activo, bloqueo_minutos }
  vista: null,           // nombre de la sección abierta
  modulo: null,          // módulo de esa sección (lo consulta realtime.js)
  bloqueada: false,
  conexion: 'conectado'  // conectado | sincronizando | sin-conexion
};

export function esAdmin() {
  return estado.perfil?.rol === 'admin';
}

/** Corta la ejecución si el rol no alcanza. La barrera real está en RLS;
    esto solo evita pedirle a la base algo que va a rechazar. */
export function exigirAdmin() {
  if (!esAdmin()) {
    throw new ErrorAmable('Esta sección es solo para administración.');
  }
}

/* ── AVISOS INTERNOS (bus de eventos) ────────────────────────────────────
   Realtime, el bloqueo y los módulos se hablan por aquí, sin importarse
   unos a otros.
   ────────────────────────────────────────────────────────────────────── */

const oyentes = new Map();

export function escuchar(evento, fn) {
  if (!oyentes.has(evento)) oyentes.set(evento, new Set());
  oyentes.get(evento).add(fn);
  return () => oyentes.get(evento)?.delete(fn);   // devuelve cómo dejar de escuchar
}

export function avisar(evento, datos) {
  oyentes.get(evento)?.forEach((fn) => {
    try { fn(datos); } catch (e) { console.error(`[core] Fallo escuchando "${evento}"`, e); }
  });
}

/* ── ESTADO DE CONEXIÓN ──────────────────────────────────────────────────
   El indicador de la cabecera. Nunca finge: si no se guardó, lo dice.
   ────────────────────────────────────────────────────────────────────── */

const TEXTO_CONEXION = {
  'conectado':     'Conectado',
  'sincronizando': 'Sincronizando…',
  'sin-conexion':  'Sin conexión'
};

export function conexion(nuevo) {
  if (estado.conexion === nuevo) return;
  estado.conexion = nuevo;
  const caja = document.getElementById('estado-conexion');
  if (caja) {
    caja.dataset.estado = nuevo;
    caja.querySelector('.estado-texto').textContent = TEXTO_CONEXION[nuevo] || '';
  }
  avisar('conexion', nuevo);
}

window.addEventListener('offline', () => conexion('sin-conexion'));
window.addEventListener('online',  () => conexion('conectado'));

/* ── ERRORES ─────────────────────────────────────────────────────────────
   R10 / §7: ningún error crudo de Postgres llega a la usuaria.
   "duplicate key value violates unique constraint" no es un mensaje: es
   un volcado. El detalle técnico va a la consola; a pantalla va una frase
   en español que dice qué hacer.
   ────────────────────────────────────────────────────────────────────── */

/** Error con un mensaje ya listo para mostrar. */
export class ErrorAmable extends Error {
  constructor(mensaje, original) {
    super(mensaje);
    this.name = 'ErrorAmable';
    this.amable = true;
    this.original = original;
  }
}

/* Mensajes por restricción concreta. Se busca por nombre del constraint,
   que es lo único estable que devuelve Postgres. Los nombres tienen que
   coincidir con los del esquema SQL. */
const POR_RESTRICCION = {
  'servicios_masaje_modalidad_duracion_key':
    'Esa combinación de masaje, modalidad y duración ya existe en el tarifario.',
  'registro_masajistas_registro_id_masajista_id_key':
    'No puedes elegir dos veces a la misma srta. en el mismo servicio.',
  'pagos_registro_registro_id_metodo_key':
    'Cada forma de pago solo puede aparecer una vez.',
  'cierres_diarios_fecha_key':
    'Ese día ya tiene un cierre registrado. Ábrelo desde Caja para corregirlo.',
  'perfiles_pin_hash_check':
    'El PIN tiene que ser de cuatro dígitos.',
  'registros_atendido_check':
    'Para marcar como atendido faltan datos: masaje, precio y al menos una srta.'
};

/**
 * Traduce cualquier error a una frase en español que se puede mostrar.
 * @returns {string}
 */
export function traducirError(error) {
  if (!error) return 'Ocurrió algo inesperado. Vuelve a intentarlo.';
  console.error('[adhamar] Detalle técnico:', error);

  if (error.amable) return error.message;

  const codigo  = error.code || '';
  const mensaje = String(error.message || '');

  /* Mensajes que la propia base de datos escribió para la usuaria.
     El SQL los lanza con el prefijo ADHAMAR: precisamente para esto. */
  if (mensaje.startsWith('ADHAMAR:')) return mensaje.replace('ADHAMAR:', '').trim();

  /* Restricción concreta, si la reconocemos */
  for (const clave in POR_RESTRICCION) {
    if (mensaje.includes(clave)) return POR_RESTRICCION[clave];
  }

  switch (codigo) {
    case '23505':
      return 'Ese dato ya está registrado. Búscalo en la lista en vez de crearlo otra vez.';
    case '23503':
      return 'Falta elegir un dato de la lista: lo que se escribió no corresponde a ningún registro existente.';
    case '23514':
      return 'Alguno de los datos no es válido. Revisa los montos y los campos obligatorios.';
    case '23502':
      return 'Falta completar un campo obligatorio.';
    case '22P02':
      return 'Algún campo tiene un valor que no se entiende. Revisa los números y las horas.';
    case '42501':
    case 'PGRST301':
      return 'Tu usuario no tiene permiso para hacer esto. Pídeselo a administración.';
    case 'PGRST116':
      return 'No se encontró ese registro. Puede que alguien lo haya cambiado desde el otro dispositivo.';
    case 'P0001':
      return mensaje || 'La operación fue rechazada por la base de datos.';
  }

  if (/JWT|token is expired|invalid claim/i.test(mensaje)) {
    return 'Tu sesión venció. Vuelve a entrar con tu correo y contraseña.';
  }
  if (/Invalid login credentials/i.test(mensaje)) {
    return 'El correo o la contraseña no coinciden.';
  }
  if (/Email not confirmed/i.test(mensaje)) {
    return 'La cuenta todavía no está confirmada. Avisa a administración.';
  }
  if (/Failed to fetch|NetworkError|network|ERR_INTERNET/i.test(mensaje)) {
    conexion('sin-conexion');
    return 'No hay conexión. No se guardó nada; vuelve a intentarlo cuando tengas internet.';
  }
  if (/row-level security|violates row-level/i.test(mensaje)) {
    return 'Tu usuario no tiene permiso para hacer esto. Pídeselo a administración.';
  }

  return 'No se pudo completar la operación. Vuelve a intentarlo; si sigue igual, avisa a administración.';
}

/* ── LLAMADAS A LA BASE ──────────────────────────────────────────────────
   Prohibida la actualización optimista (§1): se espera la confirmación
   del servidor antes de mostrar nada. Medio segundo más lento, cero
   registros fantasma.
   ────────────────────────────────────────────────────────────────────── */

/**
 * Envuelve una consulta de Supabase: marca "Sincronizando…", espera la
 * respuesta y convierte el error en algo legible.
 * Uso:  const filas = await pedir(sb.from('clientes').select('*'));
 */
export async function pedir(consulta) {
  conexion('sincronizando');
  try {
    const { data, error } = await consulta;
    if (error) throw new ErrorAmable(traducirError(error), error);
    conexion('conectado');
    return data;
  } catch (e) {
    if (e.amable) { conexion(navigator.onLine ? 'conectado' : 'sin-conexion'); throw e; }
    const texto = traducirError(e);
    conexion(navigator.onLine ? 'conectado' : 'sin-conexion');
    throw new ErrorAmable(texto, e);
  }
}

/** Igual que pedir(), pero para funciones SQL: llamar('masajistas_disponibles', {...}) */
export async function llamar(funcion, parametros = {}) {
  return pedir(sb.rpc(funcion, parametros));
}

/* ── PREFERENCIAS LOCALES ────────────────────────────────────────────────
   Solo apariencia y comodidad. Jamás ventas, precios, usuarios ni PIN.
   ────────────────────────────────────────────────────────────────────── */

export function preferencia(clave, valor) {
  const k = `adhamar.pref.${clave}`;
  try {
    if (valor === undefined) return localStorage.getItem(k);
    if (valor === null) { localStorage.removeItem(k); return null; }
    localStorage.setItem(k, String(valor));
    return valor;
  } catch (e) { return null; }
}

/* ── UTILIDADES DE DOM ───────────────────────────────────────────────── */

export const $  = (selector, dentro = document) => dentro.querySelector(selector);
export const $$ = (selector, dentro = document) => Array.from(dentro.querySelectorAll(selector));

/** crear('div', { clase:'tarjeta', texto:'Hola', datos:{ id:3 } }) */
export function crear(etiqueta, opciones = {}) {
  const el = document.createElement(etiqueta);
  if (opciones.clase) el.className = opciones.clase;
  if (opciones.texto !== undefined) el.textContent = opciones.texto;
  if (opciones.html !== undefined) el.innerHTML = opciones.html;
  if (opciones.atributos) {
    for (const a in opciones.atributos) el.setAttribute(a, opciones.atributos[a]);
  }
  if (opciones.datos) {
    for (const d in opciones.datos) el.dataset[d] = opciones.datos[d];
  }
  if (opciones.al) {
    for (const evento in opciones.al) el.addEventListener(evento, opciones.al[evento]);
  }
  (opciones.hijos || []).forEach((h) => h && el.appendChild(h));
  return el;
}

export function vaciar(el) {
  while (el && el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Espera antes de disparar. Para el autocompletado: 150–200 ms (§5.5). */
export function esperarUnPoco(fn, ms = 180) {
  let reloj;
  return (...args) => {
    clearTimeout(reloj);
    reloj = setTimeout(() => fn(...args), ms);
  };
}

/** Vibración breve en acciones importantes, con moderación (§2.5). */
export function vibrar(patron = 12) {
  try { navigator.vibrate?.(patron); } catch (e) {}
}

/** Uso interno: identificador único para relacionar etiqueta y campo. */
let contador = 0;
export function idUnico(prefijo = 'campo') {
  contador += 1;
  return `${prefijo}-${contador}`;
}
