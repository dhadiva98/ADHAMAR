/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — clientes.js
   Fichas, historial de visitas, corrección de nombres y fusión (§5.10).

   La idea que sostiene todo el módulo: los registros de servicio se
   relacionan con el cliente POR ID, nunca por nombre. Por eso corregir
   "cesar t" y dejarlo en "César Torres" arregla el historial completo,
   los reportes y el autocompletado, sin perder ni una visita.
   ══════════════════════════════════════════════════════════════════════ */

import { esAdmin, crear, vaciar, traducirError } from './core.js';
import {
  clientes as traerClientes, cliente as traerCliente, buscarClientes,
  crearCliente, actualizarCliente, marcarVip,
  fusionarClientes, posiblesDuplicados, historialCliente
} from './datos.js';
import {
  cabeceraVista, celda, esqueleto, vacio, abrirHoja, confirmar,
  aviso, avisoError, campo, casilla, celdaMonto
} from './ui.js';
import { fechaCorta, unirMasajistas, plural, normalizar } from './formato.js';

export const tablas = ['clientes', 'registros_servicios'];

let contenedor = null;
let lista = [];
let filtro = '';

/* ══════════════════════════════════════════════════════════════════════
   VISTA
   ══════════════════════════════════════════════════════════════════════ */

export async function montar(donde) {
  contenedor = donde;
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
  if (!silencioso) vaciar(contenedor).appendChild(esqueleto(6));
  lista = await traerClientes();
  pintar();
}

function pintar() {
  vaciar(contenedor);

  const acciones = [
    { texto: '+ Nuevo cliente', tipo: 'primario', al: nuevoCliente }
  ];
  if (esAdmin()) {
    acciones.push({ texto: 'Posibles duplicados', al: abrirDuplicados });
    acciones.push({ texto: 'Fusionar dos clientes', al: () => abrirFusion() });
  }
  contenedor.appendChild(cabeceraVista('Clientes', acciones));

  /* Buscador local: la lista completa ya está en memoria, así que filtrar
     aquí es instantáneo. La búsqueda difusa de la base se usa en los
     campos de registro, donde sí hace falta tolerar errores de tipeo. */
  const { campo: cBuscar, entrada: eBuscar } = campo('Buscar', {
    tipo: 'search',
    valor: filtro,
    atributos: { placeholder: 'Nombre o teléfono' }
  });
  eBuscar.addEventListener('input', () => {
    filtro = eBuscar.value;
    pintarTabla();
  });
  contenedor.appendChild(cBuscar);

  contenedor.appendChild(crear('div', { atributos: { id: 'lista-clientes' } }));
  pintarTabla();
}

function filtrados() {
  if (!filtro.trim()) return lista;
  const q = normalizar(filtro);
  return lista.filter((c) =>
    normalizar(c.nombre).includes(q) || String(c.telefono || '').includes(filtro.trim())
  );
}

function pintarTabla() {
  const caja = vaciar(contenedor.querySelector('#lista-clientes'));
  const datos = filtrados();

  if (!datos.length) {
    caja.appendChild(vacio(
      filtro ? 'Ningún cliente coincide' : 'Todavía no hay clientes',
      filtro ? 'Prueba con otra parte del nombre.' : 'Se van creando solos al registrar servicios.'
    ));
    return;
  }

  const envoltura = crear('div', { clase: 'tabla-envoltura a-tarjetas' });
  const tabla = crear('table', { clase: 'tabla' });

  const thead = crear('thead');
  const tr = crear('tr');
  ['', 'Nombre', 'Teléfono', 'Visitas', 'Última visita'].forEach((t, i) => {
    tr.appendChild(crear('th', { texto: t, clase: i === 3 ? 'derecha' : '' }));
  });
  thead.appendChild(tr);
  tabla.appendChild(thead);

  const tbody = crear('tbody');
  datos.forEach((c) => {
    const fila = crear('tr', { datos: { abrible: 'si' } });
    fila.addEventListener('click', () => abrirFicha(c.id));

    const tdVip = crear('td');
    if (c.vip) tdVip.appendChild(crear('span', { clase: 'vip', texto: '★', atributos: { title: 'Cliente VIP' } }));
    fila.appendChild(tdVip);

    fila.appendChild(celda(c.nombre, { vacio: 'Sin nombre' }));
    fila.appendChild(celda(c.telefono));
    fila.appendChild(celda(String(c.visitas ?? 0), { clase: 'monto' }));
    fila.appendChild(celda(c.ultima_visita ? fechaCorta(c.ultima_visita) : null));

    tbody.appendChild(fila);
  });
  tabla.appendChild(tbody);
  envoltura.appendChild(tabla);
  caja.appendChild(envoltura);

  const tarjetas = crear('div', { clase: 'lista-tarjetas' });
  datos.forEach((c) => {
    const t = crear('div', { clase: 'tarjeta-fila' });
    t.addEventListener('click', () => abrirFicha(c.id));
    t.appendChild(crear('span', { clase: 'hora', texto: c.vip ? '★' : '' }));
    t.appendChild(crear('span', { clase: 'cliente', texto: c.nombre || 'Sin nombre' }));
    t.appendChild(crear('span', { clase: 'sugerencia-dato', texto: plural(c.visitas ?? 0, 'visita', 'visitas') }));
    t.appendChild(crear('span', {
      clase: 'detalle',
      texto: [c.telefono, c.ultima_visita ? `Última: ${fechaCorta(c.ultima_visita)}` : null]
        .filter(Boolean).join(' · ') || 'Sin datos adicionales'
    }));
    tarjetas.appendChild(t);
  });
  caja.appendChild(tarjetas);

  caja.appendChild(crear('p', {
    clase: 'pie-agenda',
    texto: plural(datos.length, 'cliente', 'clientes')
  }));
}

/* ══════════════════════════════════════════════════════════════════════
   FICHA
   ══════════════════════════════════════════════════════════════════════ */

export async function abrirFicha(id) {
  let c;
  try {
    c = await traerCliente(id);
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
    return;
  }

  const cuerpo = crear('div');

  const datos = crear('div', { clase: 'tarjeta' });
  [
    ['Nombre', c.nombre || 'Sin nombre'],
    ['Teléfono', c.telefono],
    ['Visitas', String(c.visitas ?? 0)],
    ['Última visita', c.ultima_visita ? fechaCorta(c.ultima_visita) : null],
    ['Registrado', fechaCorta(c.created_at)],
    ['Observaciones', c.observaciones]
  ].forEach(([etiqueta, valor]) => {
    const linea = crear('div', { clase: 'linea-calculo' });
    linea.appendChild(crear('span', { texto: etiqueta }));
    linea.appendChild(valor
      ? crear('span', { texto: valor })
      : crear('span', { clase: 'dato-faltante', texto: '—' }));
    datos.appendChild(linea);
  });
  cuerpo.appendChild(datos);

  /* VIP: solo una señal visual. No aplica descuentos automáticos (§5.10). */
  const { casilla: cVip, entrada: eVip } = casilla('Cliente VIP', Boolean(c.vip));
  eVip.disabled = !esAdmin();
  cVip.appendChild(crear('span', {
    clase: 'campo-ayuda',
    texto: esAdmin()
      ? 'Solo aparece como estrella en la agenda. No cambia ningún precio.'
      : 'Solo aparece como estrella en la agenda. Lo marca administración.'
  }));
  eVip.addEventListener('change', async () => {
    try {
      await marcarVip(c.id, eVip.checked);
      aviso(eVip.checked ? 'Marcado como VIP' : 'Ya no es VIP');
      await refrescar();
    } catch (e) {
      eVip.checked = !eVip.checked;
      avisoError(e.amable ? e.message : traducirError(e));
    }
  });
  cuerpo.appendChild(cVip);

  cuerpo.appendChild(crear('p', { clase: 'campo-etiqueta', texto: 'Historial de visitas', atributos: { style: 'margin-top:20px' } }));
  const cajaHistorial = crear('div');
  cajaHistorial.appendChild(esqueleto(3, { conTitulo: false }));
  cuerpo.appendChild(cajaHistorial);

  /* Corregir un cliente es solo de administración: así lo dicen también
     las policies. Mostrarle el botón a Recepción solo serviría para que
     se llevara un "no tienes permiso" después de escribirlo todo. */
  const acciones = esAdmin()
    ? [{ texto: 'Editar', tipo: 'primario', al: ({ cerrar }) => editarFicha(c, cerrar) }]
    : [];

  abrirHoja({ titulo: c.nombre || 'Cliente', contenido: cuerpo, acciones });

  /* El historial se trae después de abrir la hoja: la ficha aparece de
     inmediato y las visitas se completan solas. */
  try {
    const visitas = await historialCliente(c.id);
    vaciar(cajaHistorial);
    if (!visitas.length) {
      cajaHistorial.appendChild(crear('p', { clase: 'campo-ayuda', texto: 'Todavía no tiene visitas registradas.' }));
      return;
    }
    const envoltura = crear('div', { clase: 'tabla-envoltura' });
    const tabla = crear('table', { clase: 'tabla' });
    const thead = crear('thead');
    const tr = crear('tr');
    ['Fecha', 'Servicio', 'Srta.', 'Desc.', 'Cobrado'].forEach((t, i) =>
      tr.appendChild(crear('th', { texto: t, clase: i >= 3 ? 'derecha' : '' })));
    thead.appendChild(tr);
    tabla.appendChild(thead);
    const tbody = crear('tbody');
    visitas.forEach((v) => {
      const fila = crear('tr');
      fila.appendChild(celda(fechaCorta(v.fecha)));
      fila.appendChild(celda(v.servicioNombre));
      fila.appendChild(celda(unirMasajistas(v.nombresMasajistas)));
      fila.appendChild(Number(v.descuento) > 0 ? celdaMonto(v.descuento) : celda(null, { clase: 'monto' }));
      fila.appendChild(celdaMonto(v.precio_cobrado));
      tbody.appendChild(fila);
    });
    tabla.appendChild(tbody);
    envoltura.appendChild(tabla);
    cajaHistorial.appendChild(envoltura);
  } catch (e) {
    vaciar(cajaHistorial).appendChild(
      crear('p', { clase: 'campo-ayuda texto-error', texto: 'No se pudo cargar el historial de visitas.' })
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════
   CREAR Y EDITAR
   ══════════════════════════════════════════════════════════════════════ */

async function nuevoCliente() {
  const caja = crear('div');
  const { campo: c1, entrada: eNombre } = campo('Nombre', { atributos: { autocapitalize: 'words' } });
  const { campo: c2, entrada: eTelefono } = campo('Teléfono (opcional)', { tipo: 'tel', atributos: { inputmode: 'tel' } });
  caja.append(c1, c2);

  const ok = await confirmar({ titulo: 'Nuevo cliente', extra: caja, aceptar: 'Crear' });
  if (!ok) return;

  const nombre = eNombre.value.trim();
  if (!nombre) { avisoError('Escribe al menos el nombre.'); return; }

  /* Antes de crear, avisar si se parece mucho a uno existente (§5.5).
     No se bloquea la creación: se obliga a pasar por la advertencia. */
  const parecido = await buscarParecido(nombre);
  if (parecido) {
    const esElMismo = await confirmar({
      titulo: `¿Te refieres a ${parecido.nombre}?`,
      texto: `Ya existe con ${plural(parecido.visitas ?? 0, 'visita', 'visitas')} registradas.`,
      aceptar: 'Sí, abrir ese cliente',
      cancelar: 'No, crear uno nuevo'
    });
    if (esElMismo) { abrirFicha(parecido.id); return; }
  }

  try {
    const nuevo = await crearCliente({ nombre, telefono: eTelefono.value.trim() || null });
    aviso(`Cliente "${nuevo.nombre}" creado`);
    await refrescar();
    abrirFicha(nuevo.id);
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}

async function editarFicha(c, cerrarHoja) {
  const caja = crear('div');
  const { campo: c1, entrada: eNombre } = campo('Nombre', { valor: c.nombre || '' });
  const { campo: c2, entrada: eTelefono } = campo('Teléfono', { tipo: 'tel', valor: c.telefono || '' });
  const { campo: c3, entrada: eObs } = campo('Observaciones', { multilinea: true, valor: c.observaciones || '' });
  caja.append(c1, c2, c3);

  const ok = await confirmar({ titulo: 'Editar cliente', extra: caja, aceptar: 'Guardar' });
  if (!ok) return;

  const nombre = eNombre.value.trim();
  if (!nombre) { avisoError('El nombre no puede quedar vacío.'); return; }

  /* R13 — corregir un nombre debe detectar si ya existe otro igual y
     ofrecer unir, en vez de crear un duplicado silencioso. Con salida por
     si de verdad son dos personas distintas. */
  if (normalizar(nombre) !== normalizar(c.nombre || '')) {
    const otro = await buscarParecido(nombre, c.id);
    if (otro && normalizar(otro.nombre) === normalizar(nombre)) {
      const unir = await confirmar({
        titulo: 'Ya existe un cliente con ese nombre',
        texto: `${otro.nombre} tiene ${plural(otro.visitas ?? 0, 'visita', 'visitas')}. ¿Son la misma persona?`,
        aceptar: 'Sí, unirlos',
        cancelar: 'No, son distintas'
      });
      if (unir) {
        cerrarHoja?.();
        await ejecutarFusion(otro.id, c.id);
        return;
      }
    }
  }

  try {
    await actualizarCliente(c.id, {
      nombre,
      telefono: eTelefono.value.trim() || null,
      observaciones: eObs.value.trim() || null
    });
    /* Como los registros apuntan al id, esto propaga a todo el historial,
       los reportes y el autocompletado, conservando visitas y fecha de
       registro. Y queda en auditoría. */
    aviso('Cliente actualizado');
    cerrarHoja?.();
    await refrescar();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}

async function buscarParecido(nombre, excluirId = null) {
  try {
    const filas = await buscarClientes(nombre, 3);
    return filas.find((c) => c.id !== excluirId && Number(c.similitud ?? 0) > 0.6) || null;
  } catch (e) {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   FUSIÓN DE DUPLICADOS  [admin]
   ══════════════════════════════════════════════════════════════════════ */

async function abrirFusion(idConservar = null, idAbsorber = null) {
  const caja = crear('div');

  const selConservar = crear('select');
  const selAbsorber = crear('select');
  lista.forEach((c) => {
    const texto = `${c.nombre} — ${plural(c.visitas ?? 0, 'visita', 'visitas')}`;
    selConservar.appendChild(crear('option', { texto, atributos: { value: c.id } }));
    selAbsorber.appendChild(crear('option', { texto, atributos: { value: c.id } }));
  });
  if (idConservar) selConservar.value = idConservar;
  if (idAbsorber) selAbsorber.value = idAbsorber;

  const c1 = crear('label', { clase: 'campo' });
  c1.append(crear('span', { clase: 'campo-etiqueta', texto: 'Cliente que se conserva' }), selConservar);
  const c2 = crear('label', { clase: 'campo' });
  c2.append(crear('span', { clase: 'campo-etiqueta', texto: 'Cliente que se absorbe' }), selAbsorber);

  const resultado = crear('p', { clase: 'campo-ayuda' });
  const actualizar = () => {
    const a = lista.find((x) => x.id === selConservar.value);
    const b = lista.find((x) => x.id === selAbsorber.value);
    resultado.textContent = (a && b && a.id !== b.id)
      ? `Resultado: ${a.nombre} — ${(a.visitas ?? 0) + (b.visitas ?? 0)} visitas. Se reasignarán los registros de ${b.nombre}.`
      : 'Elige dos clientes distintos.';
  };
  selConservar.addEventListener('change', actualizar);
  selAbsorber.addEventListener('change', actualizar);
  actualizar();

  caja.append(c1, c2, resultado, crear('p', {
    clase: 'campo-ayuda texto-error',
    texto: 'Esta acción no se puede deshacer desde la interfaz.'
  }));

  const ok = await confirmar({
    titulo: 'Fusionar clientes',
    extra: caja,
    aceptar: 'Fusionar',
    peligro: true
  });
  if (!ok) return;
  if (selConservar.value === selAbsorber.value) {
    avisoError('Elige dos clientes distintos.');
    return;
  }
  await ejecutarFusion(selConservar.value, selAbsorber.value);
}

async function ejecutarFusion(conservar, absorber) {
  try {
    /* Función transaccional en el servidor: reasigna registros, recalcula
       visitas, anexa observaciones y marca el absorbido como fusionado.
       Si fallara a mitad no puede quedar el historial partido. */
    await fusionarClientes(conservar, absorber);
    aviso('Clientes fusionados');
    await refrescar();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}

/** Panel que lista automáticamente los pares con nombres muy parecidos. */
async function abrirDuplicados() {
  const cuerpo = crear('div');
  cuerpo.appendChild(esqueleto(4, { conTitulo: false }));

  abrirHoja({ titulo: 'Posibles duplicados', contenido: cuerpo });

  try {
    const pares = await posiblesDuplicados();
    vaciar(cuerpo);

    if (!pares.length) {
      cuerpo.appendChild(vacio('No se detectaron duplicados', 'Los nombres registrados son suficientemente distintos entre sí.'));
      return;
    }

    pares.forEach((p) => {
      const tarjeta = crear('div', { clase: 'tarjeta' });
      tarjeta.appendChild(crear('p', {
        clase: 'titulo-tarjeta',
        texto: `${p.nombre_a}  ·  ${p.nombre_b}`
      }));
      tarjeta.appendChild(crear('p', {
        clase: 'campo-ayuda',
        texto: `${plural(p.visitas_a ?? 0, 'visita', 'visitas')} y ${plural(p.visitas_b ?? 0, 'visita', 'visitas')}. Parecido: ${Math.round((p.similitud || 0) * 100)}%`
      }));
      tarjeta.appendChild(crear('button', {
        clase: 'boton-secundario',
        texto: 'Revisar y fusionar',
        atributos: { type: 'button', style: 'width:auto;margin-top:10px' },
        al: { click: () => abrirFusion(p.id_a, p.id_b) }
      }));
      cuerpo.appendChild(tarjeta);
    });
  } catch (e) {
    vaciar(cuerpo).appendChild(
      vacio('No se pudo revisar', e.amable ? e.message : 'Vuelve a intentarlo en unos segundos.')
    );
  }
}
