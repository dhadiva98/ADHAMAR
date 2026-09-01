/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — formato.js
   Cómo se ve cada dato en pantalla. Sin dependencias: solo funciones.

   Dos reglas que se respetan en todo el sistema:
     · Moneda S/ con dos decimales, siempre.
     · Hora en formato de 12 horas con AM/PM, siempre.

   Y una trampa evitada: la fecha "de hoy" es la de Lima, no la del reloj
   del dispositivo. Si alguien viaja o el celular queda en otra zona,
   el cierre del día seguiría cuadrando.
   ══════════════════════════════════════════════════════════════════════ */

const CFG = window.CONFIG_ADHAMAR || {};
export const ZONA = CFG.zonaHoraria || 'America/Lima';
export const SIMBOLO = CFG.moneda || 'S/';

/* ── DINERO ──────────────────────────────────────────────────────────── */

/** 150 → "S/ 150.00" · null → "—" */
export function soles(valor, { vacio = '—', signo = false } = {}) {
  if (valor === null || valor === undefined || valor === '') return vacio;
  const n = Number(valor);
  if (!Number.isFinite(n)) return vacio;
  const cuerpo = `${SIMBOLO} ${Math.abs(n).toFixed(2)}`;
  if (n < 0) return `−${cuerpo}`;               // menos tipográfico, no guion
  if (signo && n > 0) return `+${cuerpo}`;
  return cuerpo;
}

/** Solo el número, para campos e informes: 150 → "150.00" */
export function decimales(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n.toFixed(2) : '';
}

/**
 * Lee lo que la usuaria escribió en un campo de dinero.
 * Acepta "150", "150.5", "150,50", "S/ 150.50" y devuelve un número o null.
 * Nunca devuelve NaN: un NaN suelto termina guardando basura en la base.
 */
export function aNumero(texto) {
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null;
  if (!texto) return null;
  const limpio = String(texto).replace(/[^\d,.-]/g, '').replace(',', '.');
  if (limpio === '' || limpio === '-' || limpio === '.') return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/* ── HORAS ───────────────────────────────────────────────────────────── */

/** "16:30:00" o "16:30" → "4:30 PM" */
export function hora12(horaSql, { vacio = '—' } = {}) {
  if (!horaSql) return vacio;
  const partes = String(horaSql).split(':');
  let h = parseInt(partes[0], 10);
  const m = partes[1] ? partes[1].padStart(2, '0') : '00';
  if (!Number.isFinite(h)) return vacio;
  const sufijo = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${sufijo}`;
}

/** "4:30 PM" o "16:30" → "16:30:00" para guardar. null si no se entiende. */
export function horaSql(texto) {
  if (!texto) return null;
  const t = String(texto).trim().toUpperCase();
  const m = t.match(/^(\d{1,2})[:.](\d{2})\s*(AM|PM)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (min > 59 || h > 23) return null;
  if (m[3] === 'PM' && h < 12) h += 12;
  if (m[3] === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

/** Hora actual de Lima como "16:30:00", lista para precargar el formulario. */
export function horaAhora() {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false
  });
  return `${f.format(new Date())}:00`;
}

/**
 * Hora de término estimada: ("16:30:00", 60) → "5:30 PM".
 * Es informativa. No se guarda como dato duro (§5.2).
 */
export function horaFin(horaInicio, minutos) {
  if (!horaInicio || !minutos) return null;
  const [h, m] = String(horaInicio).split(':').map(Number);
  const total = (h * 60 + m + Number(minutos)) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return hora12(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
}

/** Minutos entre dos horas del mismo día. Sirve para detectar solapes. */
export function minutosEntre(desde, hasta) {
  const a = String(desde).split(':').map(Number);
  const b = String(hasta).split(':').map(Number);
  return (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
}

/* ── FECHAS ──────────────────────────────────────────────────────────── */

/** Fecha de hoy EN LIMA, como "2026-08-26". Nunca la del reloj local. */
export function hoy() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

/** "2026-08-26" → "26/08/2026" */
export function fechaCorta(iso, { vacio = '—' } = {}) {
  if (!iso) return vacio;
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return (a && m && d) ? `${d}/${m}/${a}` : vacio;
}

/** "2026-08-26" → "Miércoles 26 de agosto" */
export function fechaLarga(iso) {
  if (!iso) return '';
  const f = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  const texto = new Intl.DateTimeFormat('es-PE', {
    timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long'
  }).format(f);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Marca de tiempo completa para auditoría: "26/08/2026 · 8:15 PM" */
export function fechaHora(iso, { vacio = '—' } = {}) {
  if (!iso) return vacio;
  const f = new Date(iso);
  if (isNaN(f)) return vacio;
  const dia = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(f);
  const hora = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA, hour: 'numeric', minute: '2-digit', hour12: true
  }).format(f);
  return `${fechaCorta(dia)} · ${hora}`;
}

/** Suma o resta días a una fecha "2026-08-26". */
export function sumarDias(iso, dias) {
  const f = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  f.setUTCDate(f.getUTCDate() + Number(dias));
  return f.toISOString().slice(0, 10);
}

/** "Hoy", "Ayer", "Mañana" o la fecha corta. Para cabeceras de agenda. */
export function diaRelativo(iso) {
  const h = hoy();
  if (iso === h) return 'Hoy';
  if (iso === sumarDias(h, -1)) return 'Ayer';
  if (iso === sumarDias(h, 1)) return 'Mañana';
  return fechaCorta(iso);
}

/* ── TEXTO ───────────────────────────────────────────────────────────── */

/**
 * Quita tildes, mayúsculas, puntuación y espacios de más.
 * "  César T.  " → "cesar t"
 * Es la base de la búsqueda predictiva del lado del navegador; en la base
 * de datos el trabajo pesado lo hace pg_trgm (§5.5).
 */
export function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Coincide por cualquier palabra, no solo por el inicio? */
export function coincide(texto, consulta) {
  const t = normalizar(texto);
  const q = normalizar(consulta);
  if (!q) return true;
  return q.split(' ').every((parte) => t.includes(parte));
}

/** Primera letra en mayúscula, sin tocar el resto. */
export function capitalizar(texto) {
  const t = String(texto || '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Anaís" + "Alondra" → "Anaís | Alondra" (§5.2) */
export function unirMasajistas(nombres) {
  const lista = (nombres || []).filter(Boolean);
  return lista.length ? lista.join(' | ') : '—';
}

/** "60" → "60'" */
export function duracion(minutos) {
  return minutos ? `${minutos}'` : '—';
}

/** Evita inyectar HTML al pintar texto de la usuaria. */
export function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Pluraliza sin el paréntesis feo: (1,'atención','atenciones') */
export function plural(n, singular, plural_) {
  return `${n} ${n === 1 ? singular : plural_}`;
}
