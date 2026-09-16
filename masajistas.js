// ===========================================================================
//  MASAJISTAS
//
//  DAR DE BAJA (temporal) y ELIMINAR (definitiva) conviven como dos acciones
//  distintas. Las DOS son lógicas: nunca se borra físicamente una masajista,
//  ni su historial, ni su asistencia. El historial sigue mostrando su nombre.
// ===========================================================================
import { esAdmin, fechaCorta, escapar, mensajeError } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, esqueleto, vacio } from './ui.js';
import * as D from './datos.js';

const ESTADOS = {
  activa:       { etiqueta: 'Activa',        color: 'var(--verde)',  punto: '🟢' },
  vacaciones:   { etiqueta: 'Vacaciones',    color: 'var(--ambar)',  punto: '🟡' },
  licencia:     { etiqueta: 'Licencia',      color: 'var(--ambar)',  punto: '🟠' },
  descanso:     { etiqueta: 'Descanso',      color: 'var(--gris)',   punto: '🔵' },
  baja_temporal:{ etiqueta: 'Baja temporal', color: 'var(--gris)',   punto: '⚪' }
};

let filtro = 'todas';

export async function vistaMasajistas() {
  const v = $('#vista');
  const filtros = [['todas','Todas'],['activa','Activas'],['vacaciones','Vacaciones'],
                   ['licencia','Licencia'],['baja_temporal','Baja temporal'],['eliminadas','Eliminadas']];

  v.innerHTML = `
    <div class="barra-acciones">
      ${esAdmin() ? '<button class="btn btn--principal" id="m-nueva">+ Nueva masajista</button>' : ''}
      ${filtros.map(([k, t]) => `<button class="btn ${filtro === k ? 'btn--suave' : 'btn--neutro'}"
          data-filtro="${k}">${t}</button>`).join('')}
    </div>
    <div id="m-lista">${esqueleto(5)}</div>`;

  v.querySelectorAll('[data-filtro]').forEach(b => b.onclick = () => {
    filtro = b.dataset.filtro; vistaMasajistas();
  });
  const n = $('#m-nueva');
  if (n) n.onclick = () => editar({ nombre: '', estado_laboral: 'activa' });

  try {
    const lista = await D.masajistas(filtro);
    $('#m-lista').innerHTML = lista.length ? `
      <div class="panel"><div class="tabla-envoltura"><table class="a-tarjetas">
        <thead><tr><th>Nombre</th><th>Estado</th><th>Teléfono</th>
          <th>Desde</th>${esAdmin() ? '<th></th>' : ''}</tr></thead>
        <tbody>${lista.map(m => {
          const e = ESTADOS[m.estado_laboral] || ESTADOS.activa;
          return `<tr>
            <td class="destacado">${escapar(`${m.nombre} ${m.apellido || ''}`.trim())}</td>
            <td data-etiqueta="Estado">${m.eliminada
              ? '<span class="insignia insignia--cancelado">Eliminada</span>'
              : `<span class="insignia" style="background:var(--superficie-2);color:${e.color}">${e.punto} ${e.etiqueta}</span>`}</td>
            <td data-etiqueta="Teléfono">${m.telefono ? escapar(m.telefono) : '<span class="vacio">—</span>'}</td>
            <td data-etiqueta="Desde">${m.fecha_ingreso ? fechaCorta(m.fecha_ingreso) : '<span class="vacio">—</span>'}</td>
            ${esAdmin() ? `<td><button class="btn btn--neutro" data-id="${m.id}"
                style="padding:9px 15px;min-height:44px">Abrir</button></td>` : ''}
          </tr>`;
        }).join('')}</tbody></table></div></div>`
      : vacio(filtro === 'eliminadas' ? 'No hay masajistas eliminadas.' : 'No hay masajistas con ese filtro.');

    $('#m-lista').querySelectorAll('[data-id]').forEach(b => b.onclick = () =>
      abrirFicha(lista.find(m => m.id === b.dataset.id)));
  } catch (ex) { $('#m-lista').innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
}

// ---------------------------------------------------------------------------
function abrirFicha(m) {
  const e = ESTADOS[m.estado_laboral] || ESTADOS.activa;
  const cuerpo = abrirHoja(`${m.nombre} ${m.apellido || ''}`.trim(), `
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Estado</span>
        <span>${m.eliminada ? 'Eliminada' : e.punto + ' ' + e.etiqueta}</span></div>
      <div class="tarifa__linea"><span>Teléfono</span><span>${m.telefono ? escapar(m.telefono) : '—'}</span></div>
      <div class="tarifa__linea"><span>Especialidades</span><span>${m.especialidades ? escapar(m.especialidades) : '—'}</span></div>
      <div class="tarifa__linea"><span>Desde</span><span>${m.fecha_ingreso ? fechaCorta(m.fecha_ingreso) : '—'}</span></div>
    </div>
    ${m.observaciones ? `<div class="panel" style="margin-bottom:18px"><div class="panel__cuerpo">
      <span class="eyebrow">Observaciones internas</span>
      <p style="margin:8px 0 0">${escapar(m.observaciones)}</p></div></div>` : ''}

    ${m.eliminada ? `
      <p class="ayuda" style="margin-bottom:16px">Su historial de masajes y asistencia sigue intacto.</p>
      <button class="btn btn--principal btn--bloque" id="m-restaurar">Volver a darle de alta</button>
    ` : `
      <button class="btn btn--neutro btn--bloque" id="m-editar" style="margin-bottom:12px">Editar ficha</button>

      <span class="eyebrow" style="margin:18px 0 8px">Dar de baja temporalmente</span>
      <p class="ayuda" style="margin:0 0 10px">Deja de aparecer al registrar masajes, pero vuelve cuando quieras.</p>
      <div class="barra-acciones">
        ${Object.entries(ESTADOS).map(([k, v]) => `
          <button class="btn ${m.estado_laboral === k ? 'btn--suave' : 'btn--neutro'}"
                  data-estado="${k}" style="padding:10px 15px">${v.punto} ${v.etiqueta}</button>`).join('')}
      </div>

      <span class="eyebrow" style="margin:22px 0 8px">Eliminar definitivamente</span>
      <p class="ayuda" style="margin:0 0 10px">Solo si ya no va a volver.</p>
      <button class="btn btn--peligro btn--bloque" id="m-eliminar">Eliminar administrativamente</button>
    `}`);

  const r = cuerpo.querySelector('#m-restaurar');
  if (r) r.onclick = async () => {
    try { await D.restaurarMasajista(m.id); avisar('Dada de alta otra vez', 'exito');
          cerrarHoja(); vistaMasajistas(); }
    catch (ex) { avisar(mensajeError(ex), 'error'); }
  };

  const ed = cuerpo.querySelector('#m-editar');
  if (ed) ed.onclick = () => editar(m);

  cuerpo.querySelectorAll('[data-estado]').forEach(b => b.onclick = async () => {
    try {
      await D.cambiarEstadoMasajista(m.id, b.dataset.estado);
      avisar(`${m.nombre} pasó a ${ESTADOS[b.dataset.estado].etiqueta.toLowerCase()}`, 'exito');
      cerrarHoja(); vistaMasajistas();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  });

  const el = cuerpo.querySelector('#m-eliminar');
  if (el) el.onclick = async () => {
    const ok = await confirmar({
      titulo: 'Eliminar masajista', peligro: true, doble: true, aceptar: 'Eliminar definitivamente',
      texto: `${m.nombre} dejará de aparecer para registros nuevos y no podrá volver a elegirse. Su historial de masajes, asistencia y reportes permanecerá intacto.`
    });
    if (!ok) return;
    try {
      await D.eliminarMasajista(m.id);
      avisar(`${m.nombre} fue eliminada`, 'exito');
      cerrarHoja(); vistaMasajistas();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}

// ---------------------------------------------------------------------------
// Todos los campos salvo el nombre son opcionales: el sistema funciona
// perfectamente con una masajista registrada solo con su nombre.
function editar(m) {
  const cuerpo = abrirHoja(m.id ? 'Editar ficha' : 'Nueva masajista', `
    <label class="campo"><span>Nombre</span>
      <input type="text" id="me-nombre" value="${escapar(m.nombre || '')}" required></label>
    <label class="campo"><span>Apellido</span>
      <input type="text" id="me-apellido" value="${escapar(m.apellido || '')}"></label>
    <label class="campo"><span>Teléfono</span>
      <input type="tel" id="me-tel" value="${escapar(m.telefono || '')}"></label>
    <label class="campo"><span>Especialidades</span>
      <input type="text" id="me-esp" value="${escapar(m.especialidades || '')}"></label>
    <label class="campo"><span>Fecha de ingreso</span>
      <input type="date" id="me-fecha" value="${m.fecha_ingreso || ''}"></label>
    <label class="campo"><span>Observaciones internas</span>
      <textarea id="me-obs">${escapar(m.observaciones || '')}</textarea></label>
    <p class="error" id="me-error" hidden></p>
    <button class="btn btn--principal btn--bloque" id="me-guardar">Guardar</button>`);

  cuerpo.querySelector('#me-guardar').onclick = async () => {
    const nombre = cuerpo.querySelector('#me-nombre').value.trim();
    const err = cuerpo.querySelector('#me-error');
    if (!nombre) { err.textContent = 'Falta el nombre.'; err.hidden = false; return; }
    try {
      await D.guardarMasajista({
        id: m.id,
        nombre,
        apellido: cuerpo.querySelector('#me-apellido').value.trim() || null,
        telefono: cuerpo.querySelector('#me-tel').value.trim() || null,
        especialidades: cuerpo.querySelector('#me-esp').value.trim() || null,
        fecha_ingreso: cuerpo.querySelector('#me-fecha').value || null,
        observaciones: cuerpo.querySelector('#me-obs').value.trim() || null,
        estado_laboral: m.estado_laboral || 'activa'
      });
      avisar('Ficha guardada', 'exito');
      cerrarHoja(); vistaMasajistas();
    } catch (ex) { err.textContent = mensajeError(ex); err.hidden = false; }
  };
}
