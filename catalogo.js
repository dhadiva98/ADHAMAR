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
  if (!servicios.length) { v.innerHTML = vacio('Todavía no hay precios cargados.'); return; }

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

  const m = matriz(servicios.filter(s => s.activo));
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
    </table></div></div>`;

  v.querySelectorAll('.celda').forEach(b => b.onclick = () => {
    const s = servicios.find(x => x.id === b.dataset.id);
    editarServicio(s || {
      masaje: b.dataset.masaje, modalidad: b.dataset.modalidad,
      duracion: Number(b.dataset.duracion), precio_referencial: '', terapeutas_requeridas: 1
    }, vistaServicios);
  });

  $('#s-nuevo').onclick = () => editarServicio({
    masaje: masajes[0], modalidad: modalidades[0], duracion: duraciones[0],
    precio_referencial: '', terapeutas_requeridas: 1
  }, vistaServicios, { masajes, modalidades, duraciones });

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

function editarServicio(s, recargar, opciones = null) {
  const cuerpo = abrirHoja(s.id ? 'Cambiar precio' : 'Nueva combinación', `
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Masaje</span><span>${escapar(s.masaje)}</span></div>
      <div class="tarifa__linea"><span>Modalidad</span><span>${escapar(s.modalidad)}</span></div>
      <div class="tarifa__linea"><span>Duración</span><span>${s.duracion}'</span></div>
    </div>
    <label class="campo campo--monto"><span>Precio referencial</span>
      <input type="number" id="e-precio" step="0.5" min="0" value="${s.precio_referencial}"></label>
    <label class="campo"><span>¿Cuántas masajistas realizan este servicio?</span>
      <select id="e-terapeutas">
        <option value="1" ${s.terapeutas_requeridas == 1 ? 'selected' : ''}>Una</option>
        <option value="2" ${s.terapeutas_requeridas == 2 ? 'selected' : ''}>Dos</option>
      </select></label>
    <div class="barra-acciones" style="margin:0">
      ${s.id ? '<button class="btn btn--peligro" id="e-quitar" style="flex:1">Quitar del tarifario</button>' : ''}
      <button class="btn btn--principal" id="e-guardar" style="flex:1.4">Guardar</button>
    </div>`);

  cuerpo.querySelector('#e-guardar').onclick = async () => {
    const precio = numero(cuerpo.querySelector('#e-precio').value);
    if (!(precio >= 0)) return avisar('Escribe un precio válido.', 'error');
    try {
      await D.guardarServicio({
        id: s.id, masaje: s.masaje, modalidad: s.modalidad, duracion: s.duracion,
        precio_referencial: precio,
        terapeutas_requeridas: Number(cuerpo.querySelector('#e-terapeutas').value),
        activo: true
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
      texto: 'Dejará de ofrecerse en registros nuevos, pero los masajes ya guardados con este precio no cambian.'
    });
    if (!ok) return;
    try {
      await D.guardarServicio({ id: s.id, activo: false });
      avisar('Quitado del tarifario', 'exito');
      cerrarHoja(); recargar();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}
