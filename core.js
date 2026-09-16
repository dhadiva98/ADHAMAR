// ===========================================================================
//  NÚCLEO — cliente de Supabase, identidad del dispositivo, estado y formato
// ===========================================================================

const C = window.CONFIG;

// --- Identidad del dispositivo ---------------------------------------------
// Se genera una sola vez y viaja en cada petición como cabecera x-device-id.
// Las policies del servidor la usan para poder revocar este equipo.
function idDispositivo() {
  let id = localStorage.getItem('adhamar.dispositivo');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID()
                            : Date.now() + '-' + Math.random().toString(36).slice(2));
    localStorage.setItem('adhamar.dispositivo', id);
  }
  return id;
}

export const DISPOSITIVO = idDispositivo();

export const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON, {
  auth: {
    persistSession: true,        // la sesión sobrevive a cerrar la pestaña
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'adhamar.sesion'
  },
  global: { headers: { 'x-device-id': DISPOSITIVO } },
  realtime: { params: { eventsPerSecond: 20 } }
});

// --- Estado en memoria ------------------------------------------------------
export const estado = {
  usuario: null,      // fila de `perfiles`
  vista: 'agenda',
  fecha: hoy(),       // fecha que se está mirando en la agenda
  bloqueada: false
};

export const esAdmin = () => estado.usuario?.rol === 'admin';

// --- Fechas y horas ---------------------------------------------------------
// Todo se calcula con el reloj local del dispositivo, que en el spa siempre
// es América/Lima. Nunca en UTC: un registro de las 8 PM caería en el día
// siguiente y descuadraría el cierre.
export function hoy() { return aISO(new Date()); }

export function aISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function sumarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return aISO(d);
}

export function fechaLarga(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00')
    .toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function fechaCorta(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// Formato 12 horas con AM/PM, como en la referencia: "4:30 PM"
export function hora12(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function horaAhora() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Hora estimada de término: informativa, nunca se guarda como dato duro.
export function sumarMinutos(hhmm, min) {
  if (!hhmm || !min) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + Number(min);
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// --- Dinero -----------------------------------------------------------------
// Se guarda con céntimos, se muestra con un decimal como máximo:
// 185 -> "S/ 185"   ·   185.5 -> "S/ 185.5"
// (para cambiar a dos decimales fijos, es este único sitio)
export function monto(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  const txt = Number.isInteger(v) ? v.toLocaleString('es-PE')
                                  : v.toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return 'S/ ' + txt;
}

export const numero = n => (n === null || n === undefined) ? 0 : Number(n);

// --- Utilidades varias ------------------------------------------------------
export function esperar(fn, ms = 180) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function vibrar(patron = 12) {
  if (navigator.vibrate) try { navigator.vibrate(patron); } catch (_) {}
}

export function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Nombre a mostrar de un registro: nombre VIVO si la entidad existe,
// snapshot solo si fue eliminada. Un nombre mal escrito es un error a
// corregir, no un dato histórico a congelar.
export function nombreVivo(relacion, snapshot, campo = 'nombre_completo') {
  return relacion?.[campo] || snapshot || null;
}

// Traduce los errores crudos de PostgreSQL a algo que una persona entienda.
export function mensajeError(e) {
  const m = String(e?.message || e || '');
  if (/masajistas activas|no existe/i.test(m)) return m.replace(/^.*?:\s*/, '');
  if (/al menos una masajista/i.test(m))       return 'Falta elegir la masajista.';
  if (/al menos un dato/i.test(m))             return 'Escribe al menos un nombre, una hora o una terapeuta.';
  if (/repetir la misma masajista/i.test(m))   return 'Esa masajista ya está en este registro.';
  if (/row-level security|permission denied/i.test(m))
    return 'Tu usuario no tiene permiso para hacer eso.';
  if (/duplicate key.*cierres/i.test(m))       return 'Este día ya fue cerrado.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
  if (/JWT|token/i.test(m))                    return 'La sesión caducó. Vuelve a entrar.';
  console.error('[Adhamar]', e);               // el detalle técnico, solo en consola
  return m || 'Algo no salió bien. Inténtalo de nuevo.';
}
