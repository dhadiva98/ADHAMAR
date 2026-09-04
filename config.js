/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — CONFIGURACIÓN

   ESTE ES EL ÚNICO ARCHIVO QUE SE EDITA A MANO.
   No hace falta tocar ningún otro.

   Dónde se consiguen estos dos datos:
     1. Entra a https://supabase.com y abre tu proyecto.
     2. Menú de la izquierda → Project Settings (el engranaje, abajo).
     3. Sección "API Keys" (o "Data API" según la versión del panel).
     4. Copia "Project URL"  → va en  url
        Copia la clave "anon" / "publishable" → va en  anonKey

   La clave anon es pública a propósito: no da acceso a nada por sí sola.
   Quien decide qué puede leer y escribir cada usuario es la base de datos
   (las policies de RLS), no este archivo.

   NUNCA pegues aquí la clave "service_role" ni la contraseña de la base
   de datos. Este archivo es visible para cualquiera que abra la página.
   ══════════════════════════════════════════════════════════════════════ */

window.CONFIG_ADHAMAR = {

  /* ── Obligatorio: reemplaza los dos valores de ejemplo ────────────── */

NEXT_PUBLIC_SUPABASE_URL=https://ersqxkcebecoxdgsvklx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_AFArHIYA-pDQzxXJtOyLmA_6Y0sqxfX,

  /* ── Opcional: ajustes con los que arranca el sistema ─────────────── */

  // Minutos de inactividad antes de pedir el PIN.
  // También se puede cambiar después desde Configuración.
  bloqueoMinutos: 15,

  // Duración que se supone cuando una reserva no tiene servicio elegido.
  // Solo sirve para estimar la disponibilidad; siempre se muestra como estimada.
  duracionPorDefecto: 60,

  // No cambiar salvo que el spa se mude de país.
  zonaHoraria: "America/Lima",
  moneda: "S/"
};
