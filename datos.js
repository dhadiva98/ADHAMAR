/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — datos.js
   Todo lo que habla con Supabase pasa por aquí. Ningún módulo de vista
   escribe una consulta suelta: así, cuando cambie el esquema, hay un solo
   archivo que tocar.

   ─────────────────────────────────────────────────────────────────────
   CONTRATO CON EL SQL
   Este archivo llama a estas funciones de la base. El SQL de la Tanda 1
   tiene que crearlas con estos nombres y estos parámetros exactos:

     dispositivo_autorizado()                          → boolean
     registrar_dispositivo(p_device_id, p_nombre)      → uuid
     revocar_dispositivo(p_id)                         → void        [admin]
     definir_pin(p_pin)                                → void
     cambiar_pin(p_actual, p_nuevo)                    → boolean
     verificar_pin(p_pin)                              → boolean
     buscar_clientes(p_texto, p_limite)                → setof
     buscar_masajistas(p_texto)                        → setof
     buscar_servicios(p_texto)                         → setof
     posibles_duplicados_clientes()                    → setof       [admin]
     fusionar_clientes(p_conservar, p_absorber)        → void        [admin]
     masajistas_disponibles(p_fecha, p_inicio, p_duracion) → setof
     registrar_servicio(p_datos jsonb)                 → uuid
     actualizar_servicio_registrado(p_id, p_datos jsonb)→ void
     resumen_dia(p_fecha)                              → jsonb       [admin]
     cerrar_dia(p_fecha, p_datos jsonb)                → uuid        [admin]
     reabrir_dia(p_fecha)                              → void        [admin]
     reporte_periodo(p_desde, p_hasta, p_filtros jsonb)→ jsonb       [admin]

   Los nombres de las restricciones que traduce core.js también son parte
   del contrato. Si cambian en el SQL, hay que cambiarlos allí.
   ────────────────────────────────────────────────────────────────────── */

import { sb, pedir, llamar, estado, ErrorAmable, dispositivoId } from './core.js';
import { hoy } from './formato.js';

/* ══════════════════════════════════════════════════════════════════════
   1. PERFIL, DISPOSITIVOS Y PIN
   ══════════════════════════════════════════════════════════════════════ */

export async function miPerfil() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const filas = await pedir(
    sb.from('perfiles')
      .select('id, nombre, rol, activo, bloqueo_minutos, pin_hash')
      .eq('id', user.id)
      .limit(1)
  );

  const perfil = filas?.[0];
  if (!perfil) {
    throw new ErrorAmable(
      'Tu usuario existe pero todavía no tiene perfil en el sistema. Avisa a administración para que te asigne un rol.'
    );
  }
  if (!perfil.activo) {
    throw new ErrorAmable('Tu usuario está desactivado. Comunícate con administración.');
  }

  // No conservamos el hash en memoria: solo si ya tiene PIN o no.
  const tienePin = Boolean(perfil.pin_hash);
  delete perfil.pin_hash;
  return { ...perfil, tienePin, correo: user.email };
}

/** ¿Este equipo sigue autorizado? Se comprueba al desbloquear y al volver
    a primer plano (§3.3). Si devuelve false, se cierra sesión. */
export async function dispositivoAutorizado() {
  try {
    return Boolean(await llamar('dispositivo_autorizado'));
  } catch (e) {
    return false;   // ante la duda, no dejamos pasar
  }
}

export function registrarDispositivo(nombre) {
  return llamar('registrar_dispositivo', {
    p_device_id: dispositivoId(),
    p_nombre: (nombre || '').trim() || 'Dispositivo sin nombre'
  });
}

export function dispositivos() {
  return pedir(
    sb.from('dispositivos')
      .select('id, device_id, nombre, ultimo_acceso, revocado, revocado_en, usuario:perfiles(id, nombre)')
      .order('ultimo_acceso', { ascending: false })
  );
}

export function revocarDispositivo(id) {
  return llamar('revocar_dispositivo', { p_id: id });
}

/* PIN — nunca se compara en el navegador. La base responde solo sí o no. */
export const definirPin   = (pin)           => llamar('definir_pin', { p_pin: pin });
export const cambiarPin   = (actual, nuevo) => llamar('cambiar_pin', { p_actual: actual, p_nuevo: nuevo });
export const verificarPin = (pin)           => llamar('verificar_pin', { p_pin: pin });

export function guardarMinutosBloqueo(minutos) {
  return pedir(
    sb.from('perfiles')
      .update({ bloqueo_minutos: minutos })
      .eq('id', estado.perfil.id)
  );
}

/* ══════════════════════════════════════════════════════════════════════
   2. USUARIOS  [admin]
   ══════════════════════════════════════════════════════════════════════ */

export function usuarios() {
  return pedir(
    sb.from('perfiles')
      .select('id, nombre, rol, activo, created_at')
      .order('nombre')
  );
}

export const cambiarRol      = (id, rol)    => pedir(sb.from('perfiles').update({ rol }).eq('id', id));
export const activarUsuario  = (id, activo) => pedir(sb.from('perfiles').update({ activo }).eq('id', id));

/* ══════════════════════════════════════════════════════════════════════
   3. CATÁLOGO: SERVICIOS EN MATRIZ
   ══════════════════════════════════════════════════════════════════════ */

const CAMPOS_SERVICIO =
  'id, masaje, modalidad, duracion, nombre_completo, precio_referencial, terapeutas_requeridas, descripcion, activo, orden';

export function servicios({ soloActivos = true } = {}) {
  let consulta = sb.from('servicios').select(CAMPOS_SERVICIO)
    .order('masaje').order('modalidad').order('duracion');
  if (soloActivos) consulta = consulta.eq('activo', true);
  return pedir(consulta);
}

export const masajes     = () => pedir(sb.from('masajes').select('id, nombre, orden, activo').order('orden'));
export const modalidades = () => pedir(sb.from('modalidades').select('id, nombre, orden, activo').order('orden'));
export const duraciones  = () => pedir(sb.from('duraciones').select('id, minutos, orden, activo').order('minutos'));

/**
 * Crea o actualiza una combinación del tarifario.
 * R5: las bajas lógicas chocan con el UNIQUE, así que va por upsert sobre
 * la clave única. Reactivar una celda que se había quitado no falla.
 */
export function guardarServicio(datos) {
  return pedir(
    sb.from('servicios')
      .upsert({ ...datos, activo: datos.activo ?? true },
              { onConflict: 'masaje,modalidad,duracion' })
      .select(CAMPOS_SERVICIO)
      .single()
  );
}

export const activarServicio = (id, activo) => pedir(sb.from('servicios').update({ activo }).eq('id', id));

/** Cambiar el precio nunca toca los registros anteriores: ellos guardaron
    su propia copia del referencial (§4). */
export const cambiarPrecio = (id, precio) =>
  pedir(sb.from('servicios').update({ precio_referencial: precio }).eq('id', id));

/** Arma la matriz masaje × (modalidad, duración) que usan Tarifario y Servicios. */
export function armarMatriz(filas) {
  const porMasaje = new Map();
  const columnas = new Map();   // "Básico|60" → { modalidad, duracion, terapeutas }

  filas.forEach((f) => {
    const clave = `${f.modalidad}|${f.duracion}`;
    if (!columnas.has(clave)) {
      columnas.set(clave, {
        clave,
        modalidad: f.modalidad,
        duracion: f.duracion,
        terapeutas: f.terapeutas_requeridas || 1
      });
    }
    if (!porMasaje.has(f.masaje)) porMasaje.set(f.masaje, new Map());
    porMasaje.get(f.masaje).set(clave, f);
  });

  const orden = (a, b) => a.modalidad.localeCompare(b.modalidad) || a.duracion - b.duracion;
  return {
    columnas: Array.from(columnas.values()).sort(orden),
    masajes: Array.from(porMasaje.entries()).map(([masaje, celdas]) => ({ masaje, celdas }))
  };
}

/* ══════════════════════════════════════════════════════════════════════
   4. MASAJISTAS
   ══════════════════════════════════════════════════════════════════════ */

const CAMPOS_MASAJISTA =
  'id, nombre, apellido, telefono, especialidades, fecha_ingreso, estado_laboral, observaciones, eliminada';

export function masajistas({ soloActivas = false, incluirEliminadas = false } = {}) {
  let consulta = sb.from('masajistas').select(CAMPOS_MASAJISTA).order('nombre');
  if (soloActivas) consulta = consulta.eq('estado_laboral', 'activa');
  if (!incluirEliminadas) consulta = consulta.eq('eliminada', false);
  return pedir(consulta);
}

export const guardarMasajista = (datos) =>
  pedir(sb.from('masajistas').upsert(datos).select(CAMPOS_MASAJISTA).single());

export const cambiarEstadoLaboral = (id, estadoLaboral) =>
  pedir(sb.from('masajistas').update({ estado_laboral: estadoLaboral }).eq('id', id));

/** Eliminación LÓGICA. El historial conserva sus servicios y su nombre (§5.8). */
export const eliminarMasajista = (id) =>
  pedir(sb.from('masajistas').update({ eliminada: true, estado_laboral: 'eliminada' }).eq('id', id));

export const reactivarMasajista = (id) =>
  pedir(sb.from('masajistas').update({ eliminada: false, estado_laboral: 'activa' }).eq('id', id));

const CAMPOS_REGISTRO = `
  id, estado, fecha, hora_ingreso, atendido_en,
  precio_referencial, precio_cobrado, descuento, ajuste,
  motivo_descuento, motivo_descuento_texto,
  forma_pago, dinero_recibido, vuelto, vuelto_metodo,
  notas, motivo_cancelacion, anulado, motivo_anulacion, created_at,
  cliente_texto, servicio_nombre_snapshot,
  servicio:servicios ( id, masaje, modalidad, duracion, nombre_completo, terapeutas_requeridas, activo ),
  cliente:clientes ( id, nombre, vip, telefono ),
  masajistas:registro_masajistas ( orden, masajista_nombre_snapshot,
                                   masajista:masajistas ( id, nombre, eliminada ) ),
  pagos:pagos_registro ( metodo, monto ),
  usuario:perfiles ( id, nombre )
`;

/* ══════════════════════════════════════════════════════════════════════
   5. CLIENTES
   ══════════════════════════════════════════════════════════════════════ */

const CAMPOS_CLIENTE =
  'id, nombre, telefono, observaciones, estado, vip, visitas, ultima_visita, fusionado_en, created_at';

export const clientes = () =>
  pedir(sb.from('clientes').select(CAMPOS_CLIENTE).is('fusionado_en', null).order('nombre'));

export const cliente = (id) =>
  pedir(sb.from('clientes').select(CAMPOS_CLIENTE).eq('id', id).single());

/** Búsqueda predictiva tolerante a tildes y a errores de tipeo (pg_trgm). */
export const buscarClientes = (texto, limite = 8) =>
  llamar('buscar_clientes', { p_texto: texto, p_limite: limite });

export const buscarMasajistas = (texto) => llamar('buscar_masajistas', { p_texto: texto });
export const buscarServicios  = (texto) => llamar('buscar_servicios',  { p_texto: texto });

export const crearCliente = (datos) =>
  pedir(sb.from('clientes').insert(datos).select(CAMPOS_CLIENTE).single());

export const actualizarCliente = (id, datos) =>
  pedir(sb.from('clientes').update(datos).eq('id', id).select(CAMPOS_CLIENTE).single());

/** Corregir el nombre propaga a todo el historial: los registros se
    relacionan por cliente_id, nunca por nombre (§5.10). */
export const corregirNombreCliente = (id, nombre) => actualizarCliente(id, { nombre });

export const marcarVip = (id, vip) => actualizarCliente(id, { vip });

export const posiblesDuplicados = () => llamar('posibles_duplicados_clientes');

/** Transaccional en el servidor: si falla a mitad, no parte el historial. */
export const fusionarClientes = (conservar, absorber) =>
  llamar('fusionar_clientes', { p_conservar: conservar, p_absorber: absorber });

export const historialCliente = (id) =>
  pedir(
    sb.from('registros_servicios')
      .select(CAMPOS_REGISTRO)
      .eq('cliente_id', id)
      .eq('anulado', false)
      .order('fecha', { ascending: false })
      .order('hora_ingreso', { ascending: false })
  ).then((filas) => filas.map(normalizarRegistro));

/* ══════════════════════════════════════════════════════════════════════
   6. REGISTROS DE SERVICIO
   ══════════════════════════════════════════════════════════════════════ */


/**
 * Regla de resolución de nombres (§4):
 *   1. Si la masajista o el servicio todavía existe → nombre ACTUAL.
 *   2. Si fue eliminada o la relación es nula → la copia guardada.
 * Así, corregir "Anahis" a "Anaís" arregla todo el historial, pero un
 * registro de alguien que ya no está nunca queda vacío.
 *
 * Ojo: el PRECIO referencial no sigue esta regla. Ese sí se congela
 * siempre, porque es un hecho contable, no un error de escritura.
 */
function resolverNombre(actual, copia) {
  return actual || copia || null;
}

/** Convierte la fila cruda de Supabase en algo cómodo de pintar. */
export function normalizarRegistro(fila) {
  if (!fila) return null;

  const masajistas = (fila.masajistas || [])
    .slice()
    .sort((a, b) => (a.orden || 0) - (b.orden || 0))
    .map((m) => ({
      id: m.masajista?.id || null,
      nombre: resolverNombre(m.masajista?.nombre, m.masajista_nombre_snapshot),
      eliminada: Boolean(m.masajista?.eliminada)
    }));

  const pagos = {};
  (fila.pagos || []).forEach((p) => { pagos[p.metodo] = Number(p.monto); });

  return {
    ...fila,
    servicioNombre: resolverNombre(fila.servicio?.nombre_completo, fila.servicio_nombre_snapshot),
    clienteNombre: fila.cliente?.nombre || fila.cliente_texto || null,
    clienteVip: Boolean(fila.cliente?.vip),
    // Si no está vinculado a un cliente, el nombre suelto se recupera igual (R12)
    clienteSuelto: !fila.cliente?.id && Boolean(fila.cliente_texto),
    masajistas,
    nombresMasajistas: masajistas.map((m) => m.nombre).filter(Boolean),
    pagos,
    totalPagado: Object.values(pagos).reduce((a, b) => a + b, 0),
    duracion: fila.servicio?.duracion || null
  };
}

/** Agenda de un día: reservas y atenciones juntas, en orden de hora. */
export async function agendaDia(fecha = hoy()) {
  const filas = await pedir(
    sb.from('registros_servicios')
      .select(CAMPOS_REGISTRO)
      .eq('fecha', fecha)
      .eq('anulado', false)
      .order('hora_ingreso', { ascending: true, nullsFirst: false })
  );
  return filas.map(normalizarRegistro);
}

export async function registro(id) {
  const fila = await pedir(
    sb.from('registros_servicios').select(CAMPOS_REGISTRO).eq('id', id).single()
  );
  return normalizarRegistro(fila);
}

/**
 * Guarda un servicio con sus masajistas y sus pagos en UNA sola operación
 * atómica del servidor. Nunca en tres llamadas sueltas: si fallara la
 * segunda, quedaría una venta sin masajista y la caja no cuadraría.
 */
export function guardarRegistro(datos) {
  return llamar('registrar_servicio', { p_datos: datos });
}

export function actualizarRegistro(id, datos) {
  return llamar('actualizar_servicio_registrado', { p_id: id, p_datos: datos });
}

/**
 * Borrado FÍSICO, permitido solo en reservas y cancelados (§5.3).
 * Una atención nunca se borra: se anula con motivo, porque un registro que
 * desaparece sin rastro rompe el cuadre de caja de ese día.
 */
export async function borrarReserva(id) {
  return pedir(
    sb.from('registros_servicios')
      .delete()
      .eq('id', id)
      .in('estado', ['reserva', 'cancelado'])
  );
}

export function borrarReservas(ids) {
  return pedir(
    sb.from('registros_servicios')
      .delete()
      .in('id', ids)
      .in('estado', ['reserva', 'cancelado'])
  );
}

/** Baja lógica de una atención, con motivo obligatorio. [admin] */
export function anularRegistro(id, motivo) {
  const razon = (motivo || '').trim();
  if (!razon) throw new ErrorAmable('Escribe el motivo por el que se anula este registro.');
  return pedir(
    sb.from('registros_servicios')
      .update({ anulado: true, motivo_anulacion: razon })
      .eq('id', id)
  );
}

export function cancelarRegistro(id, motivo) {
  return pedir(
    sb.from('registros_servicios')
      .update({ estado: 'cancelado', motivo_cancelacion: (motivo || '').trim() || null })
      .eq('id', id)
  );
}

/** Historial con filtros. Sin límite de fecha para ninguno de los dos roles. */
export async function historial({
  desde = null, hasta = null, masajistaId = null, servicioId = null,
  formaPago = null, estado: est = null, clienteId = null,
  soloConDescuento = false, texto = null, limite = 200
} = {}) {
  let consulta = sb.from('registros_servicios').select(CAMPOS_REGISTRO);

  if (desde)       consulta = consulta.gte('fecha', desde);
  if (hasta)       consulta = consulta.lte('fecha', hasta);
  if (servicioId)  consulta = consulta.eq('servicio_id', servicioId);
  if (formaPago)   consulta = consulta.eq('forma_pago', formaPago);
  if (est)         consulta = consulta.eq('estado', est);
  if (clienteId)   consulta = consulta.eq('cliente_id', clienteId);
  if (soloConDescuento) consulta = consulta.gt('descuento', 0);
  if (texto)       consulta = consulta.ilike('cliente_texto', `%${texto}%`);

  consulta = consulta
    .order('fecha', { ascending: false })
    .order('hora_ingreso', { ascending: false })
    .limit(limite);

  const filas = (await pedir(consulta)).map(normalizarRegistro);

  // El filtro por masajista se aplica aquí porque vive en la tabla puente
  return masajistaId
    ? filas.filter((r) => r.masajistas.some((m) => m.id === masajistaId))
    : filas;
}

/** Línea de disponibilidad (§5.2). Informativa: nunca bloquea. */
export function masajistasDisponibles(fecha, horaInicio, duracion) {
  return llamar('masajistas_disponibles', {
    p_fecha: fecha,
    p_inicio: horaInicio,
    p_duracion: duracion
  });
}

/* ══════════════════════════════════════════════════════════════════════
   7. ASISTENCIA
   Independiente de los masajes: alguien puede estar presente y no
   atender a nadie (§5.9).
   ══════════════════════════════════════════════════════════════════════ */

export function asistenciaDia(fecha = hoy()) {
  return pedir(
    sb.from('asistencias')
      .select('id, fecha, hora_ingreso, hora_salida, estado, observaciones, masajista:masajistas(id, nombre)')
      .eq('fecha', fecha)
  );
}

export function guardarAsistencia(filas) {
  return pedir(
    sb.from('asistencias')
      .upsert(filas, { onConflict: 'masajista_id,fecha' })
      .select('id')
  );
}

export function asistenciaPeriodo(desde, hasta, masajistaId = null) {
  let consulta = sb.from('asistencias')
    .select('id, fecha, hora_ingreso, hora_salida, estado, observaciones, masajista:masajistas(id, nombre)')
    .gte('fecha', desde).lte('fecha', hasta)
    .order('fecha', { ascending: false });
  if (masajistaId) consulta = consulta.eq('masajista_id', masajistaId);
  return pedir(consulta);
}

/* ══════════════════════════════════════════════════════════════════════
   8. CAJA Y CIERRE  [admin]
   Solo cuentan los registros 'atendido', y siempre con precio_cobrado.
   ══════════════════════════════════════════════════════════════════════ */

/** Todo el cuadro del día calculado en el servidor: ventas, métodos,
    vueltos, fondo inicial y efectivo esperado. */
export const resumenDia = (fecha = hoy()) => llamar('resumen_dia', { p_fecha: fecha });

export const cierre = (fecha) =>
  pedir(sb.from('cierres_diarios').select('*').eq('fecha', fecha).maybeSingle());

export const cierres = (desde, hasta) =>
  pedir(
    sb.from('cierres_diarios').select('*')
      .gte('fecha', desde).lte('fecha', hasta)
      .order('fecha', { ascending: false })
  );

/** El fondo inicial se puede registrar al abrir el día o retroactivamente
    al cerrar. Nunca es una venta (§5.12).

    Ojo con el upsert: NO se envía `estado`. Si se enviara 'abierto',
    anotar el fondo inicial en un día ya cerrado lo reabriría en silencio,
    y reabrir un día es una acción explícita del Administrador. */
export function guardarFondoInicial(fecha, monto) {
  return pedir(
    sb.from('cierres_diarios')
      .upsert({
        fecha,
        fondo_inicial: monto,
        fondo_inicial_registrado_en: new Date().toISOString()
      }, { onConflict: 'fecha' })
      .select('id, fecha, fondo_inicial')
      .single()
  );
}

export const cerrarDia  = (fecha, datos) => llamar('cerrar_dia', { p_fecha: fecha, p_datos: datos });
export const reabrirDia = (fecha)        => llamar('reabrir_dia', { p_fecha: fecha });

export const ajustesCierre = (cierreId) =>
  pedir(
    sb.from('ajustes_cierre')
      .select('id, motivo, monto, tipo, created_at, usuario:perfiles(id, nombre)')
      .eq('cierre_id', cierreId)
      .order('created_at')
  );

/** Justificación de una diferencia. No es un módulo de gastos (§5.12). */
export const agregarAjuste = (cierreId, motivo, monto, tipo) =>
  pedir(
    sb.from('ajustes_cierre')
      .insert({ cierre_id: cierreId, motivo, monto, tipo, usuario_id: estado.perfil.id })
      .select('id')
      .single()
  );

/* ══════════════════════════════════════════════════════════════════════
   9. REPORTES Y AUDITORÍA  [admin]
   ══════════════════════════════════════════════════════════════════════ */

export const reportePeriodo = (desde, hasta, filtros = {}) =>
  llamar('reporte_periodo', { p_desde: desde, p_hasta: hasta, p_filtros: filtros });

export function auditoria({ desde = null, hasta = null, tabla = null, limite = 200 } = {}) {
  let consulta = sb.from('auditoria')
    .select('id, accion, tabla_afectada, registro_id, datos_anteriores, datos_nuevos, created_at, usuario:perfiles(id, nombre)')
    .order('created_at', { ascending: false })
    .limit(limite);

  if (desde) consulta = consulta.gte('created_at', `${desde}T00:00:00`);
  if (hasta) consulta = consulta.lte('created_at', `${hasta}T23:59:59`);
  if (tabla) consulta = consulta.eq('tabla_afectada', tabla);
  return pedir(consulta);
}
