// ===========================================================================
//  CONFIGURACIÓN PÚBLICA
//
//  Estas dos credenciales son PÚBLICAS por diseño: la "anon key" está pensada
//  para vivir en el navegador y no da ningún permiso por sí sola — todo lo
//  decide el RLS del servidor.
//
//  NUNCA pegues aquí la "service_role key". El código de esta carpeta se
//  publica en GitHub y cualquiera puede leerlo.
// ===========================================================================

window.CONFIG = {
  SUPABASE_URL:  'https://ersqxkcebecoxdgsvklx.supabase.co',
  SUPABASE_ANON: 'sb_publishable_AFArHIYA-pDQzxXJtOyLmA_6Y0sqxfX',

  SPA: 'Adhamar',
  ZONA: 'America/Lima',
  BLOQUEO_MINUTOS_DEFECTO: 15
};
