// ===========================================================================
//  CAPA DE DATOS — todas las consultas a Supabase en un solo sitio
//  Supabase es la ÚNICA fuente de verdad. Nada de esto se guarda localmente.
// ===========================================================================
import { sb } from './core.js';

const ok = ({ data, error }) => { if (error) throw error; return data; };

// --- Selección estándar de un registro con sus relaciones ------------------
// Se traen los nombres VIVOS (servicio, cliente, masajistas) además de los
// snapshots, para poder aplicar la regla de resolución de nombres.
const REGISTRO = `
  id, estado, fecha, hora_ingreso, precio_referencial, precio_cobrado,
  descuento, ajuste, motivo_descuento, motivo_descuento_texto,
  forma_pago, dinero_recibido, vuelto, vuelto_metodo, notas,
  anulado, motivo_anulacion, motivo_cancelacion, atendido_en,
  servicio_id, servicio_nombre_snapshot, cliente_id, cliente_texto, usuario_id,
  servicio:servicios ( id, masaje, modalidad, duracion, nombre_completo,
                       precio_referencial, terapeutas_requeridas ),
  cliente:clientes ( id, nombre, telefono, vip, visitas, ultima_visita ),
  masajistas:registro_masajistas (
    orden, masajista_id, masajista_nombre_snapshot,
    masajista:masajistas ( id, nombre, apellido, eliminada ) )`;

// ===========================  REGISTROS  ===================================

export const registrosDelDia = fecha =>
  sb.from('registros_servicios').select(REGISTRO)
    .eq('fecha', fecha)
    .order('hora_ingreso', { ascending: true, nullsFirst: false })
    .order('id')
    .then(ok);

export const registro = id =>
  sb.from('registros_servicios').select(REGISTRO).eq('id', id).single().then(ok);

export const proximasReservas = desde =>
  sb.from('registros_servicios').select(REGISTRO)
    .eq('estado', 'reserva').gt('fecha', desde)
    .order('fecha').order('hora_ingreso', { nullsFirst: false }).limit(100).then(ok);

export function historial(f = {}) {
  let q = sb.from('registros_servicios').select(REGISTRO);
  if (f.desde)      q = q.gte('fecha', f.desde);
  if (f.hasta)      q = q.lte('fecha', f.hasta);
  if (f.estado)     q = q.eq('estado', f.estado);
  if (f.forma_pago) q = q.eq('forma_pago', f.forma_pago);
  if (f.servicio)   q = q.eq('servicio_id', f.servicio);
  if (f.cliente)    q = q.eq('cliente_id', f.cliente);
  if (f.conDescuento) q = q.gt('descuento', 0);
  return q.order('fecha', { ascending: false })
          .order('hora_ingreso', { ascending: false, nullsFirst: false })
          .limit(f.limite || 300).then(ok);
}

// Guardado atómico: el registro y sus masajistas viajan en una sola operación.
// Nunca puede quedar una venta sin sus masajistas si algo falla a mitad.
export const guardarRegistro = (datos, masajistas = [], id = null) =>
  sb.rpc('guardar_registro', { p_datos: datos, p_masajistas: masajistas, p_id: id }).then(ok);

export const borrarRegistro = id =>
  sb.from('registros_servicios').delete().eq('id', id).then(ok);

// Una atención NUNCA se borra: solo baja lógica con motivo obligatorio.
export const anularRegistro = (id, motivo) =>
  sb.from('registros_servicios')
    .update({ anulado: true, motivo_anulacion: motivo, estado: 'cancelado' })
    .eq('id', id).then(ok);

export const avisoSolapamiento = (masajistas, fecha, hora, duracion, excluir = null) =>
  sb.rpc('solapamientos', {
    p_masajistas: masajistas, p_fecha: fecha, p_hora: hora,
    p_duracion: duracion, p_excluir: excluir
  }).then(ok);

// ===========================  BÚSQUEDAS  ===================================

export const buscarClientes    = t => sb.rpc('buscar_clientes',    { p_texto: t }).then(ok);
export const buscarMasajistas  = t => sb.rpc('buscar_masajistas',  { p_texto: t }).then(ok);
export const buscarServicios   = t => sb.rpc('buscar_servicios',   { p_texto: t }).then(ok);
export const duplicadosCliente = () => sb.rpc('posibles_duplicados').then(ok);

// ===========================  CATÁLOGO  ====================================

export const servicios = (soloActivos = true) => {
  let q = sb.from('servicios').select('*');
  if (soloActivos) q = q.eq('activo', true);
  return q.order('masaje').order('modalidad').order('duracion').then(ok);
};

export const guardarServicio = (s) => {
  const { id, ...resto } = s;
  return id ? sb.from('servicios').update(resto).eq('id', id).then(ok)
            : sb.from('servicios').insert(resto).then(ok);
};

export const listasCatalogo = async () => ({
  masajes:     await sb.from('masajes').select('*').order('orden').then(ok),
  modalidades: await sb.from('modalidades').select('*').order('orden').then(ok),
  duraciones:  await sb.from('duraciones').select('*').order('minutos').then(ok)
});

export const agregarAlCatalogo = (tabla, fila) => sb.from(tabla).insert(fila).then(ok);

// ===========================  MASAJISTAS  ==================================

export const masajistas = (filtro = 'todas') => {
  let q = sb.from('masajistas').select('*');
  if (filtro === 'eliminadas') q = q.eq('eliminada', true);
  else {
    q = q.eq('eliminada', false);
    if (filtro !== 'todas') q = q.eq('estado_laboral', filtro);
  }
  return q.order('nombre').then(ok);
};

export const guardarMasajista = m => {
  const { id, ...resto } = m;
  return id ? sb.from('masajistas').update(resto).eq('id', id).then(ok)
            : sb.from('masajistas').insert(resto).then(ok);
};

// Dar de baja (temporal, reactivable) y eliminar (definitiva) conviven.
// Las dos son lógicas: el historial nunca pierde su nombre.
export const cambiarEstadoMasajista = (id, estado) =>
  sb.from('masajistas').update({ estado_laboral: estado }).eq('id', id).then(ok);

export const eliminarMasajista = id =>
  sb.from('masajistas').update({
    eliminada: true, eliminada_en: new Date().toISOString()
  }).eq('id', id).then(ok);

export const restaurarMasajista = id =>
  sb.from('masajistas').update({
    eliminada: false, eliminada_en: null, estado_laboral: 'activa'
  }).eq('id', id).then(ok);

// ===========================  CLIENTES  ====================================

export const clientes = (texto = '') => {
  let q = sb.from('clientes').select('*').eq('estado', 'activo');
  if (texto) q = q.ilike('nombre', `%${texto}%`);
  return q.order('visitas', { ascending: false }).limit(200).then(ok);
};

export const crearCliente = c =>
  sb.from('clientes').insert(c).select().single().then(ok);

export const guardarCliente = c =>
  sb.from('clientes').update(c).eq('id', c.id).select().single().then(ok);

export const historialCliente = id =>
  sb.from('registros_servicios').select(REGISTRO)
    .eq('cliente_id', id).order('fecha', { ascending: false }).limit(100).then(ok);

export const fusionarClientes = (conservar, absorber) =>
  sb.rpc('fusionar_clientes', { p_conservar: conservar, p_absorber: absorber }).then(ok);

// ===========================  ASISTENCIA  ==================================

export const asistenciasDe = fecha =>
  sb.from('asistencias').select('*, masajista:masajistas(id,nombre,apellido)')
    .eq('fecha', fecha).then(ok);

export const guardarAsistencia = a =>
  sb.from('asistencias').upsert(a, { onConflict: 'masajista_id,fecha' }).then(ok);

export const asistenciasRango = (desde, hasta) =>
  sb.from('asistencias').select('*, masajista:masajistas(id,nombre,apellido)')
    .gte('fecha', desde).lte('fecha', hasta).order('fecha').then(ok);

// ===========================  CAJA Y CIERRE  ===============================

export const resumenDia   = fecha => sb.rpc('resumen_dia', { p_fecha: fecha }).then(ok);
export const diaCerrado   = fecha => sb.rpc('dia_esta_cerrado', { p_fecha: fecha }).then(ok);
export const diasCerrados = () =>
  sb.from('dias_cerrados').select('*').order('fecha', { ascending: false }).limit(60).then(ok);

export const registrarFondo = (fecha, monto) =>
  sb.rpc('registrar_fondo_inicial', { p_fecha: fecha, p_monto: monto }).then(ok);

export const cerrarDia = (fecha, contado, cajaFija, fondo, obs) =>
  sb.rpc('cerrar_dia', {
    p_fecha: fecha, p_efectivo_contado: contado,
    p_caja_fija_siguiente: cajaFija, p_fondo_inicial: fondo, p_observaciones: obs
  }).then(ok);

export const reabrirDia = fecha => sb.rpc('reabrir_dia', { p_fecha: fecha }).then(ok);

export const justificar = (fecha, motivo, monto) =>
  sb.rpc('justificar_diferencia', { p_fecha: fecha, p_motivo: motivo, p_monto: monto }).then(ok);

export const cierre = fecha =>
  sb.from('cierres_diarios').select('*, ajustes:ajustes_cierre(*)')
    .eq('fecha', fecha).maybeSingle().then(ok);

// ===========================  USUARIOS Y EQUIPOS  ==========================

export const perfiles = () =>
  sb.from('perfiles').select('*').order('nombre').then(ok);

export const dispositivos = () =>
  sb.from('dispositivos').select('*, usuario:perfiles(nombre)')
    .order('ultimo_acceso', { ascending: false }).then(ok);

export const revocarDispositivo = id => sb.rpc('revocar_dispositivo', { p_id: id }).then(ok);

export const activarUsuario = (id, activo) =>
  sb.from('perfiles').update({ activo }).eq('id', id).then(ok);

export const cambiarRol = (id, rol) =>
  sb.from('perfiles').update({ rol }).eq('id', id).then(ok);

export const auditoria = (limite = 200) =>
  sb.from('auditoria').select('*, usuario:perfiles(nombre)')
    .order('created_at', { ascending: false }).limit(limite).then(ok);
