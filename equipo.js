/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — equipo.js
   Dos secciones sobre las mismas personas:

     · MASAJISTAS (§5.8) — fichas y estado laboral. Solo Administrador.
     · ASISTENCIA (§5.9) — quién vino hoy. Ambos roles.

   Regla que las mantiene separadas: EL SISTEMA NO ASUME QUE UNA SRTA.
   ESTUVO PRESENTE SOLO PORQUE REALIZÓ UN MASAJE. Alguien puede estar
   presente todo el día y no atender a nadie, y eso también es un dato.

   Y la otra: eliminar es SIEMPRE lógico. Los masajes, asistencias y
   reportes históricos se conservan y siguen mostrando su nombre. Nunca
   debe quedar vacío ni decir "masajista eliminada".
   ══════════════════════════════════════════════════════════════════════ */

import { esAdmin, estado, crear, vaciar, traducirError } from './core.js';
import {
  masajistas as traerMasajistas, guardarMasajista,
  eliminarMasajista, reactivarMasajista, asistenciaDia, guardarAsistencia
} from './datos.js';
import {
  cabeceraVista, celda, esqueleto, vacio, abrirHoja, confirmar,
  aviso, avisoError, campo
} from './ui.js';
import { hoy, fechaLarga, fechaCorta, hora12, horaAhora, plural } from './formato.js';

export const tablas = ['masajistas', 'asistencias'];

const ESTADOS = [
  { clave: 'activa',        nombre: 'Activa',        senal: '🟢', enSelector: true },
  { clave: 'vacaciones',    nombre: 'Vacaciones',    senal: '🟡', enSelector: false },
  { clave: 'licencia',      nombre: 'Licencia',      senal: '🟠', enSelector: false },
  { clave: 'descanso',      nombre: 'Descanso',      senal: '🔵', enSelector: false },
  { clave: 'baja_temporal', nombre: 'Baja temporal', senal: '⚪', enSelector: false },
  { clave: 'eliminada',     nombre: 'Eliminada',     senal: '🔴', enSelector: false }
];

const ESTADOS_ASISTENCIA = [
  'Presente', 'Falta', 'Tardanza', 'Descanso', 'Vacaciones', 'Licencia', 'Justificada'
];

let contenedor = null;
let seccion = 'masajistas';
let lista = [];
let filtroEstado = 'todas';
let fecha = hoy();

/* ══════════════════════════════════════════════════════════════════════
   MONTAJE
   ══════════════════════════════════════════════════════════════════════ */

export async function montar(donde, opciones = {}) {
  contenedor = donde;
  seccion = opciones.seccion === 'asistencia' ? 'asistencia' : 'masajistas';
  fecha = opciones.fecha || hoy();
  await cargar();
}

export function desmontar() {
  contenedor = null;
  lista = [];
}

export async function refrescar() {
  if (contenedor) await cargar({ silencioso: true });
}

async function cargar({ silencioso = false } = {}) {
  if (!silencioso) vaciar(contenedor).appendChild(esqueleto(5));
  lista = await traerMasajistas({ incluirEliminadas: true });
  if (seccion === 'asistencia') await pintarAsistencia();
  else pintarMasajistas();
}

/* ══════════════════════════════════════════════════════════════════════
   MASAJISTAS  [admin]
   ══════════════════════════════════════════════════════════════════════ */

function pintarMasajistas() {
  vaciar(contenedor);

  contenedor.appendChild(cabeceraVista('Masajistas', [
    { texto: '+ Nueva srta.', tipo: 'primario', al: () => abrirFicha(null) }
  ]));

  contenedor.appendChild(barraFiltros());

  const visibles = filtrar();
  if (!visibles.length) {
    contenedor.appendChild(vacio('No hay nadie con ese filtro', 'Prueba con "Todas".'));
    return;
  }

  const envoltura = crear('div', { clase: 'tabla-envoltura a-tarjetas' });
  const tabla = crear('table', { clase: 'tabla' });

  const thead = crear('thead');
  const tr = crear('tr');
  ['Nombre', 'Teléfono', 'Especialidades', 'Estado'].forEach((t) =>
    tr.appendChild(crear('th', { texto: t })));
  thead.appendChild(tr);
  tabla.appendChild(thead);

  const tbody = crear('tbody');
  visibles.forEach((m) => {
    const fila = crear('tr', { datos: { abrible: 'si' } });
    fila.addEventListener('click', () => abrirFicha(m));
    fila.appendChild(celda([m.nombre, m.apellido].filter(Boolean).join(' ')));
    fila.appendChild(celda(m.telefono));
    fila.appendChild(celda(m.especialidades));

    const info = ESTADOS.find((e) => e.clave === (m.eliminada ? 'eliminada' : m.estado_laboral)) || ESTADOS[0];
    fila.appendChild(celda(`${info.senal} ${info.nombre}`));
    tbody.appendChild(fila);
  });
  tabla.appendChild(tbody);
  envoltura.appendChild(tabla);
  contenedor.appendChild(envoltura);

  const tarjetas = crear('div', { clase: 'lista-tarjetas' });
  visibles.forEach((m) => {
    const info = ESTADOS.find((e) => e.clave === (m.eliminada ? 'eliminada' : m.estado_laboral)) || ESTADOS[0];
    const t = crear('div', { clase: 'tarjeta-fila' });
    t.addEventListener('click', () => abrirFicha(m));
    t.appendChild(crear('span', { clase: 'hora', texto: info.senal }));
    t.appendChild(crear('span', { clase: 'cliente', texto: [m.nombre, m.apellido].filter(Boolean).join(' ') }));
    t.appendChild(crear('span', { clase: 'sugerencia-dato', texto: info.nombre }));
    t.appendChild(crear('span', {
      clase: 'detalle',
      texto: [m.telefono, m.especialidades].filter(Boolean).join(' · ') || 'Sin datos adicionales'
    }));
    tarjetas.appendChild(t);
  });
  contenedor.appendChild(tarjetas);
}

function barraFiltros() {
  const caja = crear('div', { clase: 'opciones', atributos: { style: 'margin-bottom:18px' } });

  const opciones = [
    ['todas', 'Todas'], ['activa', 'Activas'], ['vacaciones', 'Vacaciones'],
    ['licencia', 'Licencia'], ['baja_temporal', 'Baja temporal'], ['eliminadas', 'Eliminadas']
  ];

  opciones.forEach(([clave, texto]) => {
    caja.appendChild(crear('button', {
      clase: 'opcion',
      texto,
      atributos: { type: 'button', 'aria-pressed': filtroEstado === clave ? 'true' : 'false' },
      al: { click: () => { filtroEstado = clave; pintarMasajistas(); } }
    }));
  });

  return caja;
}

function filtrar() {
  /* Las eliminadas van en un apartado especial, nunca por defecto. */
  if (filtroEstado === 'eliminadas') return lista.filter((m) => m.eliminada);
  const vivas = lista.filter((m) => !m.eliminada);
  if (filtroEstado === 'todas') return vivas;
  return vivas.filter((m) => m.estado_laboral === filtroEstado);
}

async function abrirFicha(m) {
  const nueva = !m;
  const cuerpo = crear('div');

  /* Todo salvo el nombre es opcional: el sistema tiene que funcionar con
     una srta. registrada solo con su nombre. Y sin foto: no hay Storage. */
  const { campo: c1, entrada: eNombre } = campo('Nombre', { valor: m?.nombre || '' });
  const { campo: c2, entrada: eApellido } = campo('Apellido (opcional)', { valor: m?.apellido || '' });
  const { campo: c3, entrada: eTelefono } = campo('Teléfono (opcional)', { tipo: 'tel', valor: m?.telefono || '' });
  const { campo: c4, entrada: eEspecialidades } = campo('Especialidades (opcional)', { valor: m?.especialidades || '' });
  const { campo: c5, entrada: eIngreso } = campo('Fecha de ingreso (opcional)', { tipo: 'date', valor: m?.fecha_ingreso || '' });

  const cEstado = crear('label', { clase: 'campo' });
  cEstado.appendChild(crear('span', { clase: 'campo-etiqueta', texto: 'Estado laboral' }));
  const sEstado = crear('select');
  ESTADOS.filter((e) => e.clave !== 'eliminada').forEach((e) => {
    sEstado.appendChild(crear('option', {
      texto: `${e.senal} ${e.nombre}${e.enSelector ? '' : ' — no aparece al registrar servicios'}`,
      atributos: { value: e.clave }
    }));
  });
  sEstado.value = m?.estado_laboral || 'activa';
  cEstado.appendChild(sEstado);

  const { campo: c6, entrada: eObs } = campo('Observaciones internas (opcional)', {
    multilinea: true, valor: m?.observaciones || ''
  });

  cuerpo.append(c1, c2, c3, c4, c5, cEstado, c6);

  const acciones = [{
    texto: nueva ? 'Crear' : 'Guardar',
    tipo: 'primario',
    al: async ({ cerrar }) => {
      const nombre = eNombre.value.trim();
      if (!nombre) { avisoError('El nombre es obligatorio.'); return; }
      try {
        await guardarMasajista({
          ...(m?.id ? { id: m.id } : {}),
          nombre,
          apellido: eApellido.value.trim() || null,
          telefono: eTelefono.value.trim() || null,
          especialidades: eEspecialidades.value.trim() || null,
          fecha_ingreso: eIngreso.value || null,
          estado_laboral: sEstado.value,
          observaciones: eObs.value.trim() || null
        });
        /* Corregir el nombre propaga a todo el historial: los registros
           muestran el nombre ACTUAL mientras la ficha exista (§4). */
        aviso(nueva ? 'Srta. registrada' : 'Datos guardados');
        cerrar();
        await refrescar();
      } catch (e) {
        avisoError(e.amable ? e.message : traducirError(e));
      }
    }
  }];

  if (m && !m.eliminada) {
    acciones.push({
      texto: 'Eliminar', tipo: 'peligro',
      al: ({ cerrar }) => eliminar(m, cerrar)
    });
  }
  if (m && m.eliminada) {
    acciones.push({
      texto: 'Reactivar',
      al: async ({ cerrar }) => {
        try {
          await reactivarMasajista(m.id);
          aviso('Srta. reactivada');
          cerrar();
          await refrescar();
        } catch (e) { avisoError(e.amable ? e.message : traducirError(e)); }
      }
    });
  }

  abrirHoja({
    titulo: nueva ? 'Nueva srta.' : [m.nombre, m.apellido].filter(Boolean).join(' '),
    contenido: cuerpo,
    acciones
  });
}

async function eliminar(m, cerrar) {
  /* Doble confirmación, y dicho con todas las letras qué pasa con el
     historial: no desaparece nada. */
  const primera = await confirmar({
    titulo: `Eliminar a ${m.nombre}`,
    texto: 'Dejará de aparecer al registrar servicios. Todos sus masajes, asistencias y reportes se conservan y siguen mostrando su nombre.',
    aceptar: 'Continuar',
    peligro: true
  });
  if (!primera) return;

  const segunda = await confirmar({
    titulo: '¿Seguro?',
    texto: 'Si solo se va por un tiempo, es mejor ponerle "Baja temporal": se puede reactivar cuando vuelva.',
    aceptar: 'Sí, eliminar',
    cancelar: 'Mejor no',
    peligro: true
  });
  if (!segunda) return;

  try {
    await eliminarMasajista(m.id);
    aviso('Srta. eliminada del listado operativo');
    cerrar();
    await refrescar();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}

/* ══════════════════════════════════════════════════════════════════════
   ASISTENCIA
   ══════════════════════════════════════════════════════════════════════ */

async function pintarAsistencia() {
  vaciar(contenedor);

  contenedor.appendChild(cabeceraVista(`Asistencia · ${fechaLarga(fecha)}`));

  const { campo: cFecha, entrada: eFecha } = campo('Día', { tipo: 'date', valor: fecha });
  cFecha.style.maxWidth = '220px';
  eFecha.addEventListener('change', async () => { fecha = eFecha.value || hoy(); await cargar(); });
  contenedor.appendChild(cFecha);

  contenedor.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'Se registra aparte de los masajes: alguien puede estar presente y no atender a nadie.'
  }));

  let registradas = [];
  try {
    registradas = await asistenciaDia(fecha);
  } catch (e) {
    contenedor.appendChild(vacio('No se pudo cargar la asistencia', e.amable ? e.message : ''));
    return;
  }

  const activas = lista.filter((m) => !m.eliminada);
  if (!activas.length) {
    contenedor.appendChild(vacio('Todavía no hay srtas. registradas', esAdmin()
      ? 'Regístralas en la sección Masajistas.'
      : 'Pídele a administración que las registre.'));
    return;
  }

  const porMasajista = new Map(registradas.map((a) => [a.masajista?.id, a]));
  const controles = new Map();

  const caja = crear('div', { clase: 'tarjeta' });

  activas.forEach((m) => {
    const previa = porMasajista.get(m.id);

    const fila = crear('div', {
      clase: 'linea-calculo',
      atributos: { style: 'flex-wrap:wrap;gap:10px' }
    });
    fila.appendChild(crear('span', {
      texto: [m.nombre, m.apellido].filter(Boolean).join(' '),
      atributos: { style: 'flex:1 1 140px;font-weight:600' }
    }));

    const sEstado = crear('select', { atributos: { style: 'min-height:44px;flex:0 0 auto' } });
    ESTADOS_ASISTENCIA.forEach((e) => sEstado.appendChild(crear('option', { texto: e, atributos: { value: e } })));
    sEstado.value = previa?.estado || 'Presente';
    fila.appendChild(sEstado);

    const eIngreso = crear('input', {
      atributos: {
        type: 'time', value: (previa?.hora_ingreso || '').slice(0, 5),
        style: 'min-height:44px;width:110px', 'aria-label': `Hora de ingreso de ${m.nombre}`
      }
    });
    const eSalida = crear('input', {
      atributos: {
        type: 'time', value: (previa?.hora_salida || '').slice(0, 5),
        style: 'min-height:44px;width:110px', 'aria-label': `Hora de salida de ${m.nombre}`
      }
    });
    fila.append(eIngreso, eSalida);

    controles.set(m.id, { sEstado, eIngreso, eSalida, previa });
    caja.appendChild(fila);
  });

  contenedor.appendChild(caja);

  contenedor.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'Puedes registrar solo el ingreso ahora y completar la salida más tarde.'
  }));

  const acciones = crear('div', { clase: 'dialogo-acciones' });

  acciones.appendChild(crear('button', {
    clase: 'boton-secundario',
    texto: 'Marcar ingreso ahora a las presentes',
    atributos: { type: 'button' },
    al: {
      click: () => {
        const ahora = horaAhora().slice(0, 5);
        controles.forEach(({ sEstado, eIngreso }) => {
          if (sEstado.value === 'Presente' && !eIngreso.value) eIngreso.value = ahora;
        });
      }
    }
  }));

  acciones.appendChild(crear('button', {
    clase: 'boton-primario',
    texto: 'Guardar asistencia',
    atributos: { type: 'button' },
    al: {
      click: async (e) => {
        const boton = e.currentTarget;
        boton.disabled = true;
        boton.textContent = 'Guardando…';
        try {
          const paquete = Array.from(controles.entries()).map(([masajistaId, c]) => ({
            ...(c.previa?.id ? { id: c.previa.id } : {}),
            masajista_id: masajistaId,
            fecha,
            estado: c.sEstado.value,
            hora_ingreso: c.eIngreso.value ? `${c.eIngreso.value}:00` : null,
            hora_salida: c.eSalida.value ? `${c.eSalida.value}:00` : null,
            registrado_por: estado.perfil.id
          }));
          await guardarAsistencia(paquete);
          aviso(`Asistencia guardada · ${plural(paquete.length, 'srta.', 'srtas.')}`);
          await refrescar();
        } catch (err) {
          avisoError(err.amable ? err.message : traducirError(err));
        } finally {
          boton.disabled = false;
          boton.textContent = 'Guardar asistencia';
        }
      }
    }
  }));

  contenedor.appendChild(acciones);

  if (registradas.length) {
    contenedor.appendChild(crear('p', {
      clase: 'pie-agenda',
      texto: `${plural(registradas.length, 'registro guardado', 'registros guardados')} para el ${fechaCorta(fecha)}` +
             (registradas[0]?.hora_ingreso ? ` · primer ingreso ${hora12(registradas[0].hora_ingreso)}` : '')
    }));
  }
}
