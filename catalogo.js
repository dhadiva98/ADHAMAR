/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — catalogo.js
   Dos secciones sobre la misma matriz de precios:

     · TARIFARIO  (§5.7) — solo lectura PARA TODOS, incluido el
       Administrador. Existe para que una srta. que no se sabe los precios
       de memoria pueda consultarlos sin riesgo de modificar nada.
     · SERVICIOS  (§5.6) — solo Administrador. Ahí sí se crean, se editan
       y se dan de baja las combinaciones.

   El catálogo NO es una lista plana con un precio cada uno: es una matriz
   masaje × modalidad × duración, y no todas las combinaciones existen.
   Las que no existen no tienen fila. Se muestran como "–", nunca como
   cero, porque cero significaría "se ofrece gratis".
   ══════════════════════════════════════════════════════════════════════ */

import { crear, vaciar, traducirError } from './core.js';
import { servicios as traerServicios, armarMatriz, guardarServicio, activarServicio } from './datos.js';
import {
  cabeceraVista, esqueleto, vacio, confirmar, aviso, avisoError, campo, celda
} from './ui.js';
import { soles, decimales, aNumero, duracion, normalizar } from './formato.js';

export const tablas = ['servicios'];

let contenedor = null;
let seccion = 'tarifario';
let filas = [];
let filtroMasaje = '';
let filtroModalidad = '';
let vistaMatriz = true;

/* ══════════════════════════════════════════════════════════════════════
   MONTAJE
   ══════════════════════════════════════════════════════════════════════ */

export async function montar(donde, opciones = {}) {
  contenedor = donde;
  seccion = opciones.seccion === 'servicios' ? 'servicios' : 'tarifario';
  await cargar();
}

export function desmontar() {
  contenedor = null;
  filas = [];
}

export async function refrescar() {
  if (contenedor) await cargar({ silencioso: true });
}

async function cargar({ silencioso = false } = {}) {
  if (!silencioso) vaciar(contenedor).appendChild(esqueleto(5));
  // En Servicios se ven también las combinaciones dadas de baja
  filas = await traerServicios({ soloActivos: seccion === 'tarifario' });
  pintar();
}

function pintar() {
  vaciar(contenedor);

  if (seccion === 'tarifario') pintarTarifario();
  else pintarServicios();
}

/* ══════════════════════════════════════════════════════════════════════
   TARIFARIO — SOLO LECTURA
   ══════════════════════════════════════════════════════════════════════ */

function pintarTarifario() {
  contenedor.appendChild(cabeceraVista('Tarifario', [
    { texto: 'Imprimir', al: () => window.print() }
  ]));

  contenedor.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'Solo consulta. Para cambiar precios hay que ir a Servicios y precios.'
  }));

  contenedor.appendChild(filtros());

  const visibles = filtrar(filas);
  if (!visibles.length) {
    contenedor.appendChild(vacio('No hay precios cargados todavía', 'El Administrador los carga desde Servicios y precios.'));
    return;
  }

  const matriz = armarMatriz(visibles);
  contenedor.appendChild(tablaMatriz(matriz, { editable: false }));
  contenedor.appendChild(tarjetasPorMasaje(matriz));
  contenedor.appendChild(leyenda());
}

function filtros() {
  const caja = crear('div', { atributos: { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-bottom:18px' } });

  const { campo: cBuscar, entrada: eBuscar } = campo('Buscar masaje', {
    tipo: 'search', valor: filtroMasaje
  });
  cBuscar.style.flex = '1 1 220px';
  cBuscar.style.marginBottom = '0';
  eBuscar.addEventListener('input', () => { filtroMasaje = eBuscar.value; repintarTabla(); });

  const cModalidad = crear('label', { clase: 'campo', atributos: { style: 'flex:1 1 180px;margin-bottom:0' } });
  cModalidad.appendChild(crear('span', { clase: 'campo-etiqueta', texto: 'Modalidad' }));
  const sModalidad = crear('select');
  sModalidad.appendChild(crear('option', { texto: 'Todas', atributos: { value: '' } }));
  Array.from(new Set(filas.map((f) => f.modalidad))).sort().forEach((m) => {
    sModalidad.appendChild(crear('option', { texto: m, atributos: { value: m } }));
  });
  sModalidad.value = filtroModalidad;
  sModalidad.addEventListener('change', () => { filtroModalidad = sModalidad.value; repintarTabla(); });
  cModalidad.appendChild(sModalidad);

  caja.append(cBuscar, cModalidad);
  return caja;
}

function filtrar(lista) {
  const q = normalizar(filtroMasaje);
  return lista.filter((f) =>
    (!q || normalizar(f.masaje).includes(q)) &&
    (!filtroModalidad || f.modalidad === filtroModalidad)
  );
}

function repintarTabla() {
  // Se conserva cabecera, nota y filtros; se rehace lo demás
  const conservar = seccion === 'tarifario' ? 3 : 2;
  while (contenedor.children.length > conservar) contenedor.lastChild.remove();

  const visibles = filtrar(filas);
  if (!visibles.length) {
    contenedor.appendChild(vacio('Ningún masaje coincide', 'Prueba con otra parte del nombre.'));
    return;
  }
  const matriz = armarMatriz(visibles);
  contenedor.appendChild(tablaMatriz(matriz, { editable: seccion === 'servicios' && vistaMatriz }));
  if (seccion === 'tarifario') {
    contenedor.appendChild(tarjetasPorMasaje(matriz));
    contenedor.appendChild(leyenda());
  }
}

/* ── La matriz ──────────────────────────────────────────────────────── */

function tablaMatriz(matriz, { editable }) {
  const envoltura = crear('div', { clase: 'tabla-envoltura' });
  const tabla = crear('table', { clase: 'tabla tabla-fija' });

  /* Dos filas de encabezado: la modalidad agrupa sus duraciones. */
  const thead = crear('thead');

  const filaModalidades = crear('tr');
  filaModalidades.appendChild(crear('th', { texto: 'Masajes', atributos: { rowspan: '2' } }));

  const grupos = [];
  matriz.columnas.forEach((col) => {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.modalidad === col.modalidad) ultimo.columnas.push(col);
    else grupos.push({ modalidad: col.modalidad, terapeutas: col.terapeutas, columnas: [col] });
  });

  grupos.forEach((g) => {
    const th = crear('th', {
      texto: g.terapeutas === 2 ? `${g.modalidad} · 2 srtas.` : g.modalidad,
      clase: 'derecha',
      atributos: { colspan: String(g.columnas.length), style: 'text-align:center' }
    });
    filaModalidades.appendChild(th);
  });
  thead.appendChild(filaModalidades);

  const filaDuraciones = crear('tr');
  matriz.columnas.forEach((col) => {
    filaDuraciones.appendChild(crear('th', { texto: duracion(col.duracion), clase: 'derecha' }));
  });
  thead.appendChild(filaDuraciones);
  tabla.appendChild(thead);

  const tbody = crear('tbody');
  matriz.masajes.forEach(({ masaje, celdas }) => {
    const tr = crear('tr');
    tr.appendChild(crear('td', { texto: masaje, atributos: { style: 'font-weight:600' } }));

    matriz.columnas.forEach((col) => {
      const servicio = celdas.get(col.clave);
      tr.appendChild(editable
        ? celdaEditable(masaje, col, servicio)
        : celdaPrecio(servicio));
    });
    tbody.appendChild(tr);
  });
  tabla.appendChild(tbody);

  envoltura.appendChild(tabla);
  return envoltura;
}

function celdaPrecio(servicio) {
  if (!servicio) {
    /* Combinación inexistente: guion tenue, claramente distinto de un
       precio. Nunca un cero. */
    return celda(null, { clase: 'monto', vacio: '–' });
  }
  const td = crear('td', { clase: 'monto', texto: soles(servicio.precio_referencial) });
  if (!servicio.activo) {
    td.style.opacity = '.5';
    td.title = 'Combinación dada de baja';
  }
  return td;
}

function celdaEditable(masaje, col, servicio) {
  const td = crear('td', { clase: 'monto' });
  const entrada = crear('input', {
    atributos: {
      type: 'text',
      inputmode: 'decimal',
      value: servicio ? decimales(servicio.precio_referencial) : '',
      placeholder: '–',
      style: 'width:96px;min-height:44px;text-align:right;font-size:17px;padding:6px 8px'
    }
  });
  entrada.classList.add('entrada-monto');
  if (servicio && !servicio.activo) entrada.style.opacity = '.5';

  entrada.addEventListener('change', async () => {
    const valor = aNumero(entrada.value);

    if (valor === null) {
      if (!servicio) return;                     // seguía vacía: nada que hacer
      const bajar = await confirmar({
        titulo: 'Quitar esta combinación',
        texto: `Se dejará de ofrecer ${masaje} · ${col.modalidad} · ${duracion(col.duracion)}. Los servicios ya registrados no cambian.`,
        aceptar: 'Quitar',
        peligro: true
      });
      if (!bajar) { entrada.value = decimales(servicio.precio_referencial); return; }
      try {
        await activarServicio(servicio.id, false);
        aviso('Combinación dada de baja');
        await refrescar();
      } catch (e) { avisoError(e.amable ? e.message : traducirError(e)); }
      return;
    }

    if (valor < 0) { avisoError('El precio no puede ser negativo.'); return; }

    try {
      /* R5 — upsert sobre la clave única. Si la combinación existía pero
         estaba dada de baja, la celda se veía vacía y un insert normal
         chocaría contra el UNIQUE. Así se reactiva sin error. */
      await guardarServicio({
        masaje,
        modalidad: col.modalidad,
        duracion: col.duracion,
        precio_referencial: valor,
        terapeutas_requeridas: col.terapeutas || 1,
        activo: true
      });
      entrada.style.opacity = '';
      aviso('Precio guardado');
      /* Cambiar el precio NUNCA modifica registros anteriores: cada uno
         guardó su propia copia del referencial (§4). */
    } catch (e) {
      avisoError(e.amable ? e.message : traducirError(e));
      entrada.value = servicio ? decimales(servicio.precio_referencial) : '';
    }
  });

  td.appendChild(entrada);
  return td;
}

/* ── En celular: una tarjeta por masaje, sin scroll horizontal ───────── */

function tarjetasPorMasaje(matriz) {
  const lista = crear('div', { clase: 'lista-tarjetas' });

  matriz.masajes.forEach(({ masaje, celdas }) => {
    const tarjeta = crear('div', { clase: 'tarjeta' });
    tarjeta.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: masaje }));

    const porModalidad = new Map();
    matriz.columnas.forEach((col) => {
      const servicio = celdas.get(col.clave);
      if (!servicio) return;
      if (!porModalidad.has(col.modalidad)) porModalidad.set(col.modalidad, { terapeutas: col.terapeutas, items: [] });
      porModalidad.get(col.modalidad).items.push(`${duracion(col.duracion)} ${soles(servicio.precio_referencial)}`);
    });

    if (!porModalidad.size) {
      tarjeta.appendChild(crear('p', { clase: 'campo-ayuda', texto: 'Sin precios cargados.' }));
    }

    porModalidad.forEach((datos, modalidad) => {
      const linea = crear('div', { clase: 'linea-calculo' });
      linea.appendChild(crear('span', {
        texto: datos.terapeutas === 2 ? `${modalidad} · 2 srtas.` : modalidad
      }));
      linea.appendChild(crear('span', { clase: 'monto', texto: datos.items.join('   ') }));
      tarjeta.appendChild(linea);
    });

    lista.appendChild(tarjeta);
  });

  return lista;
}

function leyenda() {
  return crear('p', {
    clase: 'campo-ayuda',
    atributos: { style: 'margin-top:14px' },
    texto: '–  significa que esa combinación no se ofrece. Los precios son referenciales: al cobrar se puede ajustar.'
  });
}

/* ══════════════════════════════════════════════════════════════════════
   SERVICIOS Y PRECIOS  [admin]
   ══════════════════════════════════════════════════════════════════════ */

function pintarServicios() {
  contenedor.appendChild(cabeceraVista('Servicios y precios', [
    {
      texto: vistaMatriz ? 'Ver como lista' : 'Ver como matriz',
      al: () => { vistaMatriz = !vistaMatriz; pintar(); }
    },
    { texto: '+ Nueva combinación', tipo: 'primario', al: nuevaCombinacion }
  ]));

  contenedor.appendChild(filtros());

  const visibles = filtrar(filas);
  if (!visibles.length) {
    contenedor.appendChild(vacio(
      'Todavía no hay servicios cargados',
      'Crea la primera combinación de masaje, modalidad y duración.',
      { texto: '+ Nueva combinación', al: nuevaCombinacion }
    ));
    return;
  }

  if (vistaMatriz) {
    contenedor.appendChild(crear('p', {
      clase: 'campo-ayuda',
      texto: 'Escribe el precio en la celda y sal del campo para guardar. Deja una celda vacía para dejar de ofrecer esa combinación.'
    }));
    contenedor.appendChild(tablaMatriz(armarMatriz(visibles), { editable: true }));
  } else {
    contenedor.appendChild(listaServicios(visibles));
  }
}

function listaServicios(visibles) {
  const envoltura = crear('div', { clase: 'tabla-envoltura' });
  const tabla = crear('table', { clase: 'tabla' });

  const thead = crear('thead');
  const tr = crear('tr');
  ['Masaje', 'Modalidad', 'Tiempo', 'Srtas.', 'Precio', 'Estado', ''].forEach((t, i) =>
    tr.appendChild(crear('th', { texto: t, clase: i === 4 ? 'derecha' : '' })));
  thead.appendChild(tr);
  tabla.appendChild(thead);

  const tbody = crear('tbody');
  visibles.forEach((s) => {
    const fila = crear('tr');
    fila.appendChild(celda(s.masaje));
    fila.appendChild(celda(s.modalidad));
    fila.appendChild(celda(duracion(s.duracion)));
    fila.appendChild(celda(String(s.terapeutas_requeridas || 1)));
    fila.appendChild(celda(soles(s.precio_referencial), { clase: 'monto' }));

    const tdEstado = crear('td');
    tdEstado.appendChild(crear('span', {
      clase: `pastilla ${s.activo ? 'pastilla-atendido' : 'pastilla-cancelado'}`,
      texto: s.activo ? 'Se ofrece' : 'Dado de baja'
    }));
    fila.appendChild(tdEstado);

    const tdAcciones = crear('td');
    tdAcciones.appendChild(crear('button', {
      clase: 'boton-enlace',
      texto: s.activo ? 'Dar de baja' : 'Reactivar',
      atributos: { type: 'button' },
      al: {
        click: async () => {
          try {
            /* Preferir desactivar antes que eliminar: el historial que
               apunta a esta fila tiene que seguir resolviendo su nombre. */
            await activarServicio(s.id, !s.activo);
            aviso(s.activo ? 'Combinación dada de baja' : 'Combinación reactivada');
            await refrescar();
          } catch (e) { avisoError(e.amable ? e.message : traducirError(e)); }
        }
      }
    }));
    fila.appendChild(tdAcciones);

    tbody.appendChild(fila);
  });
  tabla.appendChild(tbody);
  envoltura.appendChild(tabla);
  return envoltura;
}

async function nuevaCombinacion() {
  const caja = crear('div');
  const { campo: c1, entrada: eMasaje } = campo('Masaje', {
    ayuda: 'Si ya existe, se añade una combinación más a ese masaje.'
  });
  const { campo: c2, entrada: eModalidad } = campo('Modalidad', { ayuda: 'Por ejemplo: Básico, Holístico, 4 Manos.' });
  const { campo: c3, entrada: eDuracion } = campo('Duración en minutos', { tipo: 'number', atributos: { inputmode: 'numeric', min: '5' } });
  const { campo: c4, entrada: ePrecio } = campo('Precio referencial', { atributos: { inputmode: 'decimal' } });
  const { campo: c5, entrada: eSrtas } = campo('Cuántas srtas. atienden', { tipo: 'number', valor: '1', atributos: { min: '1', max: '2' } });
  ePrecio.classList.add('entrada-monto');
  caja.append(c1, c2, c3, c4, c5);

  const ok = await confirmar({ titulo: 'Nueva combinación', extra: caja, aceptar: 'Crear' });
  if (!ok) return;

  const masaje = eMasaje.value.trim();
  const modalidad = eModalidad.value.trim();
  const minutos = parseInt(eDuracion.value, 10);
  const precio = aNumero(ePrecio.value);

  if (!masaje || !modalidad) { avisoError('Falta el nombre del masaje o de la modalidad.'); return; }
  if (!minutos || minutos < 5) { avisoError('Escribe cuántos minutos dura.'); return; }
  if (precio === null || precio < 0) { avisoError('Escribe el precio referencial.'); return; }

  try {
    await guardarServicio({
      masaje,
      modalidad,
      duracion: minutos,
      precio_referencial: precio,
      terapeutas_requeridas: Math.min(2, Math.max(1, parseInt(eSrtas.value, 10) || 1)),
      activo: true
    });
    aviso('Combinación creada');
    await refrescar();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}
