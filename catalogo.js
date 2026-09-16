// ===========================================================================
//  TARIFARIO (solo lectura) y SERVICIOS (matriz editable, solo admin)
//
//  El catálogo no es una lista plana: es una matriz. Un mismo masaje tiene
//  precios distintos por modalidad y duración, y NO todas las combinaciones
//  existen. Las que no existen se muestran como "–", nunca como precio cero.
// ===========================================================================
import { monto, escapar, mensajeError, numero } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, esqueleto, vacio, confirmar } from './ui.js';
import * as D from './datos.js';
import { describirPaquete, paraCuantos } from './paquetes.js';

function matriz(servicios) {
  const modalidades = [...new Set(servicios.map(s => s.modalidad))];
  const porMod = {};
  modalidades.forEach(m => porMod[m] = [...new Set(
    servicios.filter(s => s.modalidad === m).map(s => s.duracion))].sort((a, b) => a - b));
  const masajes = [...new Set(servicios.map(s => s.masaje))].sort();
  const buscar = (ma, mo, du) => servicios.find(s => s.masaje === ma && s.modalidad === mo && s.duracion === du);
  return { modalidades, porMod, masajes, buscar };
}

// ---------------------------------------------------------------------------
//  TARIFARIO — de solo lectura para TODOS los roles, incluido el administrador.
//  Existe para que una terapeuta pueda consultar precios sin riesgo de tocar nada.
// ---------------------------------------------------------------------------
export async function vistaTarifario() {
  const v = $('#vista');
  v.innerHTML = esqueleto(6);
  let servicios;
  try { servicios = await D.servicios(true); }
  catch (ex) { v.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; return; }
  // La matriz es solo para masajes; paquetes y sauna van en sus propias tablas.
  let nombrados = [];
  try { nombrados = await D.paquetes(true); } catch (_) {}
  if (!servicios.length && !nombrados.length) { v.innerHTML = vacio('Todavía no hay precios cargados.'); return; }
  const extras = bloquePaquetesConNombre(nombrados) + bloquesSaunaYPaquetes(servicios);
  servicios = servicios.filter(s => s.tipo === 'masaje');
  const m = matriz(servicios);

  v.innerHTML = `
    <div class="barra-acciones">
      <input type="search" class="campo" id="t-buscar" placeholder="Buscar masaje…"
             style="flex:1;min-width:200px;padding:12px 14px;border-radius:10px;
                    border:1.5px solid var(--borde-fuerte);background:var(--superficie)">
      <button class="btn btn--neutro" onclick="window.print()">Imprimir</button>
    </div>
    <p class="ayuda" style="margin:-8px 0 16px">Solo para consultar. Los precios se cambian en Servicios.</p>

    <!-- Escritorio: matriz completa -->
    <div class="panel solo-escritorio"><div class="tabla-envoltura">
      <table id="t-matriz">
        <thead>
          <tr><th class="col-fija" rowspan="2">Masaje</th>
            ${m.modalidades.map(mo => `<th colspan="${m.porMod[mo].length}" style="text-align:center">
              ${escapar(mo)}${servicios.find(s => s.modalidad === mo)?.terapeutas_requeridas > 1 ? ' · 2 srtas' : ''}
            </th>`).join('')}</tr>
          <tr>${m.modalidades.map(mo => m.porMod[mo].map(d =>
              `<th class="num">${d}'</th>`).join('')).join('')}</tr>
        </thead>
        <tbody>
          ${m.masajes.map(ma => `<tr data-masaje="${escapar(ma)}">
            <td class="col-fija"><strong>${escapar(ma)}</strong></td>
            ${m.modalidades.map(mo => m.porMod[mo].map(d => {
              const s = m.buscar(ma, mo, d);
              return `<td class="num">${s ? monto(s.precio_referencial)
                     : '<span class="vacio">–</span>'}</td>`;
            }).join('')).join('')}
          </tr>`).join('')}
        </tbody>
      </table></div></div>

    <!-- Celular: una tarjeta por masaje, sin scroll horizontal -->
    <div class="solo-movil-bloque">
      ${m.masajes.map(ma => `
        <div class="panel" data-masaje="${escapar(ma)}" style="margin-bottom:12px">
          <div class="panel__cabecera"><strong style="font-size:18px">${escapar(ma)}</strong></div>
          <div class="panel__cuerpo">
            ${m.modalidades.map(mo => {
              const filas = m.porMod[mo].map(d => m.buscar(ma, mo, d)).filter(Boolean);
              if (!filas.length) return '';
              return `<div style="margin-bottom:12px">
                <span class="eyebrow">${escapar(mo)}</span>
                <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">
                  ${filas.map(s => `<span><b>${s.duracion}'</b> ${monto(s.precio_referencial)}</span>`).join('')}
                </div></div>`;
            }).join('')}
          </div></div>`).join('')}
    </div>

    ${extras}

    <style>
      .solo-movil-bloque { display: none; }
      @media (max-width: 900px) {
        .solo-escritorio { display: none; }
        .solo-movil-bloque { display: block; }
      }
    </style>`;

  $('#t-buscar').oninput = e => {
    const t = e.target.value.trim().toLowerCase();
    v.querySelectorAll('[data-masaje]').forEach(el =>
      el.style.display = el.dataset.masaje.toLowerCase().includes(t) ? '' : 'none');
  };
}

// ---------------------------------------------------------------------------
//  Paquetes (masaje + sauna) y sauna sola: tablas simples, fuera de la matriz.
// ---------------------------------------------------------------------------
const masajeSoloDe = (todos, p) => todos.find(x => x.tipo === 'masaje' && x.activo !== false
  && x.masaje === p.masaje && x.modalidad === p.modalidad && x.duracion === p.duracion);

function bloquesSaunaYPaquetes(todos, editable = false) {
  const paquetes = todos.filter(s => s.tipo === 'paquete' && s.activo)
    .sort((a, b) => a.masaje.localeCompare(b.masaje) || a.modalidad.localeCompare(b.modalidad) || a.duracion - b.duracion);
  const saunas = todos.filter(s => s.tipo === 'sauna' && s.activo)
    .sort((a, b) => a.sauna_minutos - b.sauna_minutos);
  if (!editable && !paquetes.length && !saunas.length) return '';


  return `
    ${!editable && !paquetes.length ? '' : `<div class="panel" style="margin-top:18px">
      <div class="panel__cabecera"><span class="eyebrow">Masaje + sauna (una persona)</span></div>
      ${paquetes.length ? `<div class="tabla-envoltura"><table class="a-tarjetas">
        <thead><tr><th>Paquete</th><th class="num">Precio del paquete</th>
          ${editable ? '<th class="num">Masajista (masaje solo)</th><th class="num">Spa (sauna)</th>' : ''}</tr></thead>
        <tbody>${paquetes.map(p => {
          const solo = masajeSoloDe(todos, p);
          const mas = solo ? Math.min(numero(p.precio_referencial), numero(solo.precio_referencial)) : null;
          return `<tr${editable ? ` data-clic data-id="${p.id}"` : ''}>
            <td class="destacado">${escapar(p.nombre_completo)}</td>
            <td class="num" data-etiqueta="Precio">${monto(p.precio_referencial)}</td>
            ${editable ? `<td class="num" data-etiqueta="Masajista">${mas != null ? monto(mas)
                : '<span class="error" style="font-size:13px">Falta el precio del masaje solo</span>'}</td>
              <td class="num" data-etiqueta="Spa">${mas != null ? monto(numero(p.precio_referencial) - mas) : '—'}</td>` : ''}
          </tr>`; }).join('')}</tbody></table></div>`
        : `<div class="panel__cuerpo"><p class="ayuda" style="margin:0">Todavía no hay combinaciones de masaje + sauna.${
            editable ? ' Créalas con “+ Nueva combinación” → Masaje + sauna.' : ''}</p></div>`}
    </div>`}

    ${!editable && !saunas.length ? '' : `<div class="panel" style="margin-top:18px">
      <div class="panel__cabecera"><span class="eyebrow">Sauna sola · una persona a la vez · sin masajista</span></div>
      ${saunas.length ? `<div class="tabla-envoltura"><table class="a-tarjetas">
        <thead><tr><th>Servicio</th><th class="num">Precio</th></tr></thead>
        <tbody>${saunas.map(x => `<tr${editable ? ` data-clic data-id="${x.id}"` : ''}>
          <td class="destacado">${escapar(x.nombre_completo)}</td>
          <td class="num" data-etiqueta="Precio">${monto(x.precio_referencial)}</td></tr>`).join('')}</tbody>
        </table></div>`
        : `<div class="panel__cuerpo"><p class="ayuda" style="margin:0">El sauna todavía no tiene precio.${
            editable ? ' Créalo con “+ Nueva combinación” → Sauna.' : ''}</p></div>`}
    </div>`}`;
}

// ---------------------------------------------------------------------------
//  PAQUETES CON NOMBRE ("Ritual Pareja"…): tabla para tarifario y servicios
// ---------------------------------------------------------------------------
function bloquePaquetesConNombre(lista, editable = false) {
  const activos = lista.filter(p => p.activo);
  if (!editable && !activos.length) return '';
  return `
    <div class="panel" style="margin-top:18px">
      <div class="panel__cabecera" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span class="eyebrow">Paquetes</span>
        ${editable ? '<button class="btn btn--suave" id="s-paquete" style="min-height:40px;padding:8px 14px">+ Nuevo paquete</button>' : ''}
      </div>
      ${activos.length ? `<div class="tabla-envoltura"><table class="a-tarjetas">
        <thead><tr><th>Paquete</th><th>Para</th><th>Cada persona recibe</th><th class="num">Precio</th></tr></thead>
        <tbody>${activos.map(p => `<tr${editable ? ` data-clic data-paquete="${p.id}"` : ''}>
          <td class="destacado">${escapar(p.nombre)}${p.descripcion
            ? `<br><small class="ayuda" style="font-weight:400">${escapar(p.descripcion)}</small>` : ''}</td>
          <td data-etiqueta="Para">${p.personas === 2 ? '2 personas' : '1 persona'}</td>
          <td data-etiqueta="Incluye">${escapar(describirPaquete(p))}</td>
          <td class="num" data-etiqueta="Precio"><strong>${monto(p.precio)}</strong></td>
        </tr>`).join('')}</tbody></table></div>`
        : `<div class="panel__cuerpo"><p class="ayuda" style="margin:0">Todavía no hay paquetes con nombre.
            Por ejemplo: “Ritual Pareja” = para 2 personas, cada una masaje 45' + sauna 30'.</p></div>`}
    </div>`;
}

function editarPaquete(p, { masajes, modalidades, duraciones }, servicios, recargar) {
  const nuevo = !p;
  p = p || { nombre: '', personas: 1, masaje_minutos: duraciones[0] ?? null, masaje_fijo: null,
             modalidad_fija: null, sauna_minutos: SAUNA_MINUTOS, precio: '', descripcion: '' };
  const opcion = (v, t, sel) => `<option value="${escapar(String(v))}" ${sel ? 'selected' : ''}>${escapar(String(t))}</option>`;

  const cuerpo = abrirHoja(nuevo ? 'Nuevo paquete' : 'Editar paquete', `
    <label class="campo"><span>Nombre del paquete</span>
      <input type="text" id="pk-nombre" value="${escapar(p.nombre)}" placeholder="Ritual Pareja" autocomplete="off"></label>

    <div class="campo"><span>¿Para cuántas personas?</span>
      <div class="segmentos" id="pk-personas">
        <button type="button" data-n="1" class="${p.personas === 1 ? 'activo' : ''}">1 persona</button>
        <button type="button" data-n="2" class="${p.personas === 2 ? 'activo' : ''}">2 personas</button>
      </div></div>

    <p class="eyebrow" style="margin:4px 0 10px">Cada persona recibe</p>
    <label class="casilla"><input type="checkbox" id="pk-con-masaje" ${p.masaje_minutos ? 'checked' : ''}>
      <span>Masaje</span></label>
    <div id="pk-masaje-caja">
      <label class="campo"><span>Tiempo del masaje</span>
        <select id="pk-minutos">${duraciones.map(d => opcion(d, d + "'", d === p.masaje_minutos)).join('')}</select></label>
      <div class="fila">
        <label class="campo"><span>Masaje</span>
          <select id="pk-masaje">${opcion('', 'Se elige al registrar', !p.masaje_fijo)}
            ${masajes.map(m => opcion(m, m, m === p.masaje_fijo)).join('')}</select></label>
        <label class="campo"><span>Modalidad</span>
          <select id="pk-modalidad">${opcion('', 'Se elige al registrar', !p.modalidad_fija)}
            ${modalidades.map(m => opcion(m, m, m === p.modalidad_fija)).join('')}</select></label>
      </div>
      <p class="ayuda" id="pk-validos" style="margin:-8px 0 16px"></p>
    </div>
    <label class="casilla"><input type="checkbox" id="pk-con-sauna" ${p.sauna_minutos ? 'checked' : ''}>
      <span>Sauna ${SAUNA_MINUTOS}' <small class="ayuda">(una persona a la vez: en pareja, por turnos)</small></span></label>

    <label class="campo campo--monto" style="margin-top:8px"><span>Precio del paquete (total)</span>
      <input type="number" id="pk-precio" step="0.5" min="0" inputmode="decimal" value="${p.precio}"></label>
    <label class="campo"><span>Descripción <em style="text-transform:none;font-style:normal">(opcional)</em></span>
      <input type="text" id="pk-desc" value="${escapar(p.descripcion || '')}" placeholder="Ideal para madre e hija, amigas…"></label>

    <p class="error" id="pk-error" hidden></p>
    <div class="barra-acciones" style="margin:0">
      ${nuevo ? '' : '<button class="btn btn--peligro" id="pk-quitar" style="flex:1">Quitar del tarifario</button>'}
      <button class="btn btn--principal" id="pk-guardar" style="flex:1.4">Guardar paquete</button>
    </div>`);

  const el = q => cuerpo.querySelector(q);
  let personas = p.personas || 1;
  el('#pk-personas').querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
    personas = Number(b.dataset.n);
    el('#pk-personas').querySelectorAll('[data-n]').forEach(x => x.classList.toggle('activo', x === b));
  });

  const validos = () => servicios.filter(s => s.tipo === 'masaje' && s.activo
    && s.duracion === Number(el('#pk-minutos').value)
    && (!el('#pk-masaje').value || s.masaje === el('#pk-masaje').value)
    && (!el('#pk-modalidad').value || s.modalidad === el('#pk-modalidad').value));

  function refrescar() {
    const conMasaje = el('#pk-con-masaje').checked;
    el('#pk-masaje-caja').classList.toggle('oculto', !conMasaje);
    if (!conMasaje) return;
    if (!duraciones.length) { el('#pk-validos').textContent = 'Primero agrega una duración (+ Duración).'; return; }
    const v = validos();
    el('#pk-validos').innerHTML = v.length
      ? `Masajes que se podrán elegir: ${v.map(s => escapar(`${s.masaje} (${s.modalidad})`)).join(', ')}.`
      : `<span class="error">No hay masajes de ese tiempo con precio. Créalos primero en la tabla de masajes.</span>`;
  }
  ['#pk-con-masaje', '#pk-minutos', '#pk-masaje', '#pk-modalidad'].forEach(q => el(q).onchange = refrescar);
  refrescar();

  el('#pk-guardar').onclick = async e => {
    const btn = e.currentTarget;
    const err = el('#pk-error');
    const fallo = t => { err.textContent = t; err.hidden = false; };
    err.hidden = true;

    const nombre = el('#pk-nombre').value.trim();
    const conMasaje = el('#pk-con-masaje').checked;
    const conSauna = el('#pk-con-sauna').checked;
    const precio = numero(el('#pk-precio').value);
    if (!nombre) return fallo('Escribe el nombre del paquete.');
    if (!conMasaje && !conSauna) return fallo('El paquete debe incluir masaje, sauna o ambos.');
    if (conMasaje && !validos().length) return fallo('No hay masajes de ese tiempo con precio para este paquete.');
    if (el('#pk-precio').value === '' || !(precio >= 0)) return fallo('Escribe el precio del paquete.');

    btn.disabled = true;
    try {
      await D.guardarPaquete({
        id: p.id, nombre, personas,
        masaje_minutos: conMasaje ? Number(el('#pk-minutos').value) : null,
        masaje_fijo:    conMasaje ? (el('#pk-masaje').value || null) : null,
        modalidad_fija: conMasaje ? (el('#pk-modalidad').value || null) : null,
        sauna_minutos:  conSauna ? SAUNA_MINUTOS : null,
        precio,
        descripcion: el('#pk-desc').value.trim() || null,
        activo: true
      });
      avisar('Paquete guardado', 'exito');
      cerrarHoja(); recargar();
    } catch (ex) {
      const m = mensajeError(ex);
      fallo(/uk_paquetes_nombre|duplicate/i.test(ex?.message || '') ? 'Ya existe un paquete con ese nombre.' : m);
      btn.disabled = false;
    }
  };

  const q = el('#pk-quitar');
  if (q) q.onclick = async () => {
    const ok = await confirmar({
      titulo: 'Quitar paquete', peligro: true, aceptar: 'Quitar',
      texto: 'Dejará de ofrecerse, pero las ventas ya guardadas de este paquete no cambian.'
    });
    if (!ok) return;
    try {
      await D.guardarPaquete({ id: p.id, activo: false });
      avisar('Paquete quitado del tarifario', 'exito');
      cerrarHoja(); recargar();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}

// ---------------------------------------------------------------------------
//  SERVICIOS — vista de matriz editable (solo administrador)
// ---------------------------------------------------------------------------
export async function vistaServicios() {
  const v = $('#vista');
  v.innerHTML = esqueleto(6);

  let servicios, listas;
  try {
    servicios = await D.servicios(false);
    listas = await D.listasCatalogo();
  } catch (ex) { v.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; return; }
  let nombrados = [];
  try { nombrados = await D.paquetes(false); } catch (_) {}

  const masajesActivos = servicios.filter(s => s.activo && s.tipo === 'masaje');
  const m = matriz(masajesActivos);
  const modalidades = listas.modalidades.map(x => x.nombre);
  const duraciones  = listas.duraciones.map(x => x.minutos);
  const masajes     = listas.masajes.map(x => x.nombre);

  v.innerHTML = `
    <div class="barra-acciones">
      <button class="btn btn--principal" id="s-nuevo">+ Nueva combinación</button>
      <button class="btn btn--neutro" id="s-masaje">+ Masaje</button>
      <button class="btn btn--neutro" id="s-modalidad">+ Modalidad</button>
      <button class="btn btn--neutro" id="s-duracion">+ Duración</button>
    </div>
    <p class="ayuda" style="margin:-8px 0 16px">
      Toca un precio para cambiarlo. Una celda vacía significa que esa combinación no se ofrece.
      Cambiar un precio nunca modifica los registros ya guardados.</p>
    <span class="eyebrow" style="margin:0 0 8px">Masajes</span>
    ${masajes.length && modalidades.length && duraciones.length ? `
    <div class="panel"><div class="tabla-envoltura"><table>
      <thead><tr><th class="col-fija">Masaje</th>
        ${modalidades.map(mo => duraciones.map(d =>
          `<th class="num">${escapar(mo.slice(0,6))} ${d}'</th>`).join('')).join('')}</tr></thead>
      <tbody>${masajes.map(ma => `<tr>
        <td class="col-fija"><strong>${escapar(ma)}</strong></td>
        ${modalidades.map(mo => duraciones.map(d => {
          const s = m.buscar(ma, mo, d);
          return `<td class="num"><button class="celda" data-masaje="${escapar(ma)}"
                    data-modalidad="${escapar(mo)}" data-duracion="${d}"
                    data-id="${s?.id || ''}"
                    style="background:none;border:none;padding:8px 10px;border-radius:8px;
                           min-width:64px;font-size:15px;font-variant-numeric:tabular-nums;
                           color:${s ? 'inherit' : 'var(--tinta-suave)'}">
                    ${s ? monto(s.precio_referencial) : '–'}</button></td>`;
        }).join('')).join('')}
      </tr>`).join('')}</tbody>
    </table></div></div>`
    : `<div class="panel"><div class="panel__cuerpo"><p class="ayuda" style="margin:0">
        Para armar la tabla de masajes agrega al menos un masaje, una modalidad y una duración
        con los botones de arriba. Si tus masajes solo cambian por el tiempo, crea una sola modalidad (por ejemplo “Normal”).</p></div></div>`}
    ${bloquePaquetesConNombre(nombrados, true)}
    ${bloquesSaunaYPaquetes(servicios, true)}`;

  v.querySelectorAll('.celda').forEach(b => b.onclick = () => {
    const s = servicios.find(x => x.id === b.dataset.id);
    editarServicio(s || {
      tipo: 'masaje', masaje: b.dataset.masaje, modalidad: b.dataset.modalidad,
      duracion: Number(b.dataset.duracion), precio_referencial: '', terapeutas_requeridas: 1
    }, vistaServicios, servicios);
  });
  v.querySelectorAll('tr[data-clic][data-id]').forEach(tr => tr.onclick = () =>
    editarServicio(servicios.find(x => x.id === tr.dataset.id), vistaServicios, servicios));
  const catalogo = { masajes, modalidades, duraciones };
  v.querySelectorAll('tr[data-paquete]').forEach(tr => tr.onclick = () =>
    editarPaquete(nombrados.find(x => x.id === tr.dataset.paquete), catalogo, servicios, vistaServicios));
  $('#s-paquete').onclick = () => editarPaquete(null, catalogo, servicios, vistaServicios);

  $('#s-nuevo').onclick = () => nuevaCombinacion(servicios, { masajes, modalidades, duraciones });

  const agregar = (tabla, etiqueta, campo) => async () => {
    const val = prompt(`Nombre de ${etiqueta}:`);
    if (!val?.trim()) return;
    try {
      await D.agregarAlCatalogo(tabla, campo === 'minutos'
        ? { minutos: Number(val) } : { nombre: val.trim() });
      avisar(`${etiqueta} agregada`, 'exito');
      vistaServicios();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
  $('#s-masaje').onclick    = agregar('masajes', 'el masaje', 'nombre');
  $('#s-modalidad').onclick = agregar('modalidades', 'la modalidad', 'nombre');
  $('#s-duracion').onclick  = agregar('duraciones', 'la duración en minutos', 'minutos');
}

// Busca la misma combinación (activa o quitada) para no chocar con el índice único.
const mismaCombinacion = (todos, c) => todos.find(x => x.tipo === c.tipo
  && (x.masaje || null) === (c.masaje || null) && (x.modalidad || null) === (c.modalidad || null)
  && (x.duracion || null) === (c.duracion || null) && (x.sauna_minutos || null) === (c.sauna_minutos || null));

// Guarda una combinación. Si existía pero se había quitado del tarifario,
// se reactiva con el precio nuevo en lugar de crear otra.
async function guardarCombinacion(todos, c) {
  const previa = c.id ? null : mismaCombinacion(todos, c);
  if (previa) return D.guardarServicio({ ...c, id: previa.id, activo: true });
  return D.guardarServicio({ ...c, activo: true });
}

// ---------------------------------------------------------------------------
//  NUEVA COMBINACIÓN: masaje, paquete (masaje + sauna) o sauna sola
// ---------------------------------------------------------------------------
const SAUNA_MINUTOS = 30;

function nuevaCombinacion(todos, { masajes, modalidades, duraciones }) {
  const hayMatriz = masajes.length && modalidades.length && duraciones.length;
  const opcion = (v, t = v) => `<option value="${escapar(String(v))}">${escapar(String(t))}</option>`;

  const cuerpo = abrirHoja('Nueva combinación', `
    <div class="campo"><span>¿Qué vas a crear?</span>
      <div class="segmentos" id="n-tipo">
        <button type="button" data-tipo="masaje" class="activo">Masaje</button>
        <button type="button" data-tipo="paquete">Masaje + sauna</button>
        <button type="button" data-tipo="sauna">Sauna sola</button>
      </div></div>

    <div id="n-masaje-caja">
      ${hayMatriz ? `
      <label class="campo"><span>Masaje</span>
        <select id="n-masaje">${masajes.map(x => opcion(x)).join('')}</select></label>
      <div class="fila">
        <label class="campo"><span>Modalidad</span>
          <select id="n-modalidad">${modalidades.map(x => opcion(x)).join('')}</select></label>
        <label class="campo"><span>Tiempo del masaje</span>
          <select id="n-duracion">${duraciones.map(x => opcion(x, x + "'")).join('')}</select></label>
      </div>` : `<p class="error">Primero agrega al menos un masaje, una modalidad y una duración
        (botones + Masaje, + Modalidad y + Duración).</p>`}
    </div>

    <p class="ayuda oculto" id="n-sauna-nota" style="margin:-4px 0 16px">
      Incluye ${SAUNA_MINUTOS}' de sauna. Al registrar la atención se indica si va antes o después del masaje.</p>

    <label class="campo campo--monto"><span id="n-precio-etq">Precio</span>
      <input type="number" id="n-precio" step="0.5" min="0" inputmode="decimal"></label>
    <div class="tarifa oculto" id="n-reparto" style="margin-top:-6px"></div>

    <label class="campo" id="n-terapeutas-caja"><span>¿Cuántas masajistas realizan este servicio?</span>
      <select id="n-terapeutas"><option value="1">Una</option><option value="2">Dos</option></select></label>

    <p class="error" id="n-error" hidden></p>
    <button class="btn btn--principal btn--bloque" id="n-guardar">Guardar</button>`);

  let tipo = 'masaje';
  const el = q => cuerpo.querySelector(q);

  const combinacion = () => tipo === 'sauna'
    ? { tipo, masaje: null, modalidad: null, duracion: null, sauna_minutos: SAUNA_MINUTOS, terapeutas_requeridas: 0 }
    : { tipo, masaje: el('#n-masaje')?.value, modalidad: el('#n-modalidad')?.value,
        duracion: Number(el('#n-duracion')?.value),
        sauna_minutos: tipo === 'paquete' ? SAUNA_MINUTOS : null,
        terapeutas_requeridas: Number(el('#n-terapeutas').value) };

  function refrescar() {
    const sauna = tipo === 'sauna';
    el('#n-masaje-caja').classList.toggle('oculto', sauna);
    el('#n-terapeutas-caja').classList.toggle('oculto', sauna);
    el('#n-sauna-nota').classList.toggle('oculto', tipo !== 'paquete');
    el('#n-precio-etq').textContent = sauna ? `Precio del sauna (${SAUNA_MINUTOS}')`
      : tipo === 'paquete' ? 'Precio del paquete' : 'Precio del masaje';
    el('#n-error').hidden = true;

    const rep = el('#n-reparto');
    rep.classList.toggle('oculto', tipo !== 'paquete' || !hayMatriz);
    if (tipo === 'paquete' && hayMatriz) {
      const c = combinacion();
      const solo = masajeSoloDe(todos, c);
      const precio = numero(el('#n-precio').value);
      rep.innerHTML = solo
        ? `<div class="tarifa__linea"><span>Masaje solo (para la masajista)</span><span>${monto(solo.precio_referencial)}</span></div>
           <div class="tarifa__linea"><span>Queda para el spa (sauna)</span><span>${
             el('#n-precio').value ? monto(precio - Math.min(precio, numero(solo.precio_referencial))) : '—'}</span></div>`
        : `<p class="error" style="margin:0">Este masaje con esa modalidad y ese tiempo todavía no tiene precio solo.
             Créalo primero (tipo Masaje): es lo que se le cuenta a la masajista.</p>`;
    }
  }

  el('#n-tipo').querySelectorAll('[data-tipo]').forEach(b => b.onclick = () => {
    tipo = b.dataset.tipo;
    el('#n-tipo').querySelectorAll('[data-tipo]').forEach(x => x.classList.toggle('activo', x === b));
    refrescar();
  });
  ['#n-masaje', '#n-modalidad', '#n-duracion'].forEach(q => { const x = el(q); if (x) x.onchange = refrescar; });
  el('#n-precio').oninput = refrescar;
  refrescar();

  el('#n-guardar').onclick = async e => {
    const btn = e.currentTarget;
    const err = el('#n-error');
    const fallo = t => { err.textContent = t; err.hidden = false; };
    err.hidden = true;

    if (tipo !== 'sauna' && !hayMatriz) return fallo('Primero agrega un masaje, una modalidad y una duración.');
    const precio = numero(el('#n-precio').value);
    if (el('#n-precio').value === '' || !(precio >= 0)) return fallo('Escribe el precio.');

    const c = combinacion();
    if (tipo === 'paquete' && !masajeSoloDe(todos, c))
      return fallo('Primero crea el precio de ese masaje solo (tipo Masaje).');
    const previa = mismaCombinacion(todos, c);
    if (previa?.activo) return fallo('Esa combinación ya existe. Tócala en la tabla para cambiar su precio.');

    btn.disabled = true;
    try {
      await guardarCombinacion(todos, { ...c, precio_referencial: precio });
      avisar(tipo === 'sauna' ? 'Sauna guardado' : tipo === 'paquete' ? 'Paquete guardado' : 'Precio guardado', 'exito');
      cerrarHoja(); vistaServicios();
    } catch (ex) { fallo(mensajeError(ex)); btn.disabled = false; }
  };
}

// ---------------------------------------------------------------------------
//  Cambiar el precio de una combinación que ya existe (o de una celda vacía)
// ---------------------------------------------------------------------------
function editarServicio(s, recargar, todos = []) {
  const tipo = s.tipo || 'masaje';
  const titulo = s.id ? (tipo === 'sauna' ? 'Precio del sauna' : tipo === 'paquete' ? 'Precio del paquete' : 'Cambiar precio')
                      : 'Nueva combinación';
  const solo = tipo === 'paquete' ? masajeSoloDe(todos, s) : null;

  const cuerpo = abrirHoja(titulo, `
    <div class="tarifa" style="margin-bottom:18px">
      ${tipo === 'sauna'
        ? `<div class="tarifa__linea"><span>Servicio</span><span>Sauna sola</span></div>
           <div class="tarifa__linea"><span>Tiempo</span><span>${s.sauna_minutos}'</span></div>
           <div class="tarifa__linea"><span>Masajista</span><span>No lleva (ingreso del spa)</span></div>`
        : `<div class="tarifa__linea"><span>Masaje</span><span>${escapar(s.masaje)}</span></div>
           <div class="tarifa__linea"><span>Modalidad</span><span>${escapar(s.modalidad)}</span></div>
           <div class="tarifa__linea"><span>Tiempo del masaje</span><span>${s.duracion}'</span></div>
           ${tipo === 'paquete' ? `<div class="tarifa__linea"><span>Sauna</span><span>${s.sauna_minutos}'</span></div>
           <div class="tarifa__linea"><span>Masaje solo (para la masajista)</span><span>${
             solo ? monto(solo.precio_referencial) : '—'}</span></div>` : ''}`}
    </div>
    <label class="campo campo--monto"><span>${tipo === 'paquete' ? 'Precio del paquete' : 'Precio referencial'}</span>
      <input type="number" id="e-precio" step="0.5" min="0" value="${s.precio_referencial}"></label>
    ${tipo === 'sauna' ? '' : `
    <label class="campo"><span>¿Cuántas masajistas realizan este servicio?</span>
      <select id="e-terapeutas">
        <option value="1" ${s.terapeutas_requeridas == 1 ? 'selected' : ''}>Una</option>
        <option value="2" ${s.terapeutas_requeridas == 2 ? 'selected' : ''}>Dos</option>
      </select></label>`}
    <div class="barra-acciones" style="margin:0">
      ${s.id ? '<button class="btn btn--peligro" id="e-quitar" style="flex:1">Quitar del tarifario</button>' : ''}
      <button class="btn btn--principal" id="e-guardar" style="flex:1.4">Guardar</button>
    </div>`);

  cuerpo.querySelector('#e-guardar').onclick = async () => {
    const precio = numero(cuerpo.querySelector('#e-precio').value);
    if (cuerpo.querySelector('#e-precio').value === '' || !(precio >= 0))
      return avisar('Escribe un precio válido.', 'error');
    try {
      await guardarCombinacion(todos, {
        id: s.id, tipo,
        masaje: s.masaje ?? null, modalidad: s.modalidad ?? null, duracion: s.duracion ?? null,
        sauna_minutos: tipo === 'masaje' ? null : s.sauna_minutos,
        precio_referencial: precio,
        terapeutas_requeridas: tipo === 'sauna' ? 0 : Number(cuerpo.querySelector('#e-terapeutas').value)
      });
      avisar('Precio guardado', 'exito');
      cerrarHoja(); recargar();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };

  // Preferir desactivar antes que eliminar: las combinaciones con historial
  // nunca se borran físicamente.
  const q = cuerpo.querySelector('#e-quitar');
  if (q) q.onclick = async () => {
    const ok = await confirmar({
      titulo: 'Quitar del tarifario', peligro: true, aceptar: 'Quitar',
      texto: 'Dejará de ofrecerse en registros nuevos, pero las atenciones ya guardadas con este precio no cambian.'
    });
    if (!ok) return;
    try {
      await D.guardarServicio({ id: s.id, activo: false });
      avisar('Quitado del tarifario', 'exito');
      cerrarHoja(); recargar();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}
