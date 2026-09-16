// ===========================================================================
//  CLIENTES — ficha, corrección de nombre, fusión de duplicados
//
//  Los registros se relacionan por cliente_id, nunca por nombre: por eso
//  corregir el nombre actualiza automáticamente todo el historial.
// ===========================================================================
import { esAdmin, fechaCorta, monto, escapar, mensajeError, esperar } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, esqueleto, vacio, autocompletar } from './ui.js';
import * as D from './datos.js';

export async function vistaClientes() {
  const v = $('#vista');
  v.innerHTML = `
    <div class="barra-acciones">
      <input type="search" id="c-buscar" placeholder="Buscar cliente…"
             style="flex:1;min-width:200px;padding:13px 14px;border-radius:10px;font-size:16px;
                    border:1.5px solid var(--borde-fuerte);background:var(--superficie);color:inherit">
      ${esAdmin() ? '<button class="btn btn--neutro" id="c-duplicados">Posibles duplicados</button>' : ''}
    </div>
    <div id="c-lista">${esqueleto(6)}</div>`;

  const pintar = async (texto = '') => {
    const caja = $('#c-lista');
    try {
      const lista = await D.clientes(texto);
      caja.innerHTML = lista.length ? `
        <div class="panel"><div class="tabla-envoltura"><table class="a-tarjetas">
          <thead><tr><th></th><th>Nombre</th><th>Teléfono</th>
            <th class="num">Visitas</th><th>Última visita</th></tr></thead>
          <tbody>${lista.map(c => `<tr data-clic data-id="${c.id}">
            <td style="width:30px">${c.vip ? '<span class="estrella">★</span>' : ''}</td>
            <td class="destacado">${escapar(c.nombre || 'Sin nombre')}</td>
            <td data-etiqueta="Teléfono">${c.telefono ? escapar(c.telefono) : '<span class="vacio">—</span>'}</td>
            <td class="num" data-etiqueta="Visitas">${c.visitas}</td>
            <td data-etiqueta="Última">${c.ultima_visita ? fechaCorta(c.ultima_visita) : '<span class="vacio">—</span>'}</td>
          </tr>`).join('')}</tbody></table></div></div>`
        : vacio(texto ? 'Ningún cliente con ese nombre.' : 'Todavía no hay clientes registrados.');

      caja.querySelectorAll('tr[data-clic]').forEach(tr => tr.onclick = () =>
        ficha(lista.find(c => c.id === tr.dataset.id)));
    } catch (ex) { caja.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
  };

  $('#c-buscar').oninput = esperar(e => pintar(e.target.value.trim()), 250);
  const dup = $('#c-duplicados');
  if (dup) dup.onclick = panelDuplicados;
  pintar();
}

// ---------------------------------------------------------------------------
async function ficha(c) {
  const cuerpo = abrirHoja(c.nombre || 'Cliente', `
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Teléfono</span><span>${c.telefono ? escapar(c.telefono) : '—'}</span></div>
      <div class="tarifa__linea"><span>Visitas</span><span>${c.visitas}</span></div>
      <div class="tarifa__linea"><span>Última visita</span><span>${c.ultima_visita ? fechaCorta(c.ultima_visita) : '—'}</span></div>
      <div class="tarifa__linea"><span>VIP</span><span>${c.vip ? 'Sí ★' : 'No'}</span></div>
    </div>
    ${c.observaciones ? `<div class="panel" style="margin-bottom:18px"><div class="panel__cuerpo">
      <span class="eyebrow">Observaciones</span><p style="margin:8px 0 0">${escapar(c.observaciones)}</p>
    </div></div>` : ''}
    <div class="barra-acciones">
      <button class="btn btn--neutro" id="c-editar" style="flex:1">Editar datos</button>
      ${esAdmin() ? '<button class="btn btn--neutro" id="c-fusionar" style="flex:1">Fusionar</button>' : ''}
    </div>
    <span class="eyebrow" style="margin:6px 0 10px">Historial de visitas</span>
    <div id="c-hist">${esqueleto(3)}</div>`);

  cuerpo.querySelector('#c-editar').onclick = () => editar(c);
  const f = cuerpo.querySelector('#c-fusionar');
  if (f) f.onclick = () => fusionar(c);

  try {
    const regs = await D.historialCliente(c.id);
    cuerpo.querySelector('#c-hist').innerHTML = regs.length ? `
      <div class="panel"><div class="tabla-envoltura"><table>
        <thead><tr><th>Fecha</th><th>Servicio</th><th>Masajista</th>
          <th class="num">Ref.</th><th class="num">Desc.</th><th class="num">Cobrado</th><th>Pago</th></tr></thead>
        <tbody>${regs.map(r => `<tr>
          <td>${fechaCorta(r.fecha)}</td>
          <td>${escapar(r.servicio?.nombre_completo || r.servicio_nombre_snapshot || '—')}</td>
          <td>${escapar((r.masajistas || []).map(m => m.masajista && !m.masajista.eliminada
                ? m.masajista.nombre : m.masajista_nombre_snapshot).join(' | ') || '—')}</td>
          <td class="num">${monto(r.precio_referencial)}</td>
          <td class="num">${Number(r.descuento) > 0 ? '−' + monto(r.descuento) : '—'}</td>
          <td class="num"><strong>${monto(r.precio_cobrado)}</strong></td>
          <td>${r.forma_pago || '<span class="vacio">—</span>'}</td>
        </tr>`).join('')}</tbody></table></div></div>`
      : '<p class="ayuda">Todavía no tiene visitas registradas.</p>';
  } catch (ex) {
    cuerpo.querySelector('#c-hist').innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`;
  }
}

// Corregir el nombre actualiza todo el historial sin perder visitas.
function editar(c) {
  const cuerpo = abrirHoja('Editar cliente', `
    <label class="campo"><span>Nombre</span>
      <input type="text" id="ce-nombre" value="${escapar(c.nombre || '')}"></label>
    <label class="campo"><span>Teléfono</span>
      <input type="tel" id="ce-tel" value="${escapar(c.telefono || '')}"></label>
    <label class="casilla"><input type="checkbox" id="ce-vip" ${c.vip ? 'checked' : ''}>
      <span>Cliente VIP (solo una marca visual, no cambia precios)</span></label>
    <label class="campo"><span>Observaciones</span>
      <textarea id="ce-obs">${escapar(c.observaciones || '')}</textarea></label>
    <button class="btn btn--principal btn--bloque" id="ce-guardar">Guardar cambios</button>`);

  cuerpo.querySelector('#ce-guardar').onclick = async () => {
    const nombreNuevo = cuerpo.querySelector('#ce-nombre').value.trim();
    const datos = {
      id: c.id,
      nombre: nombreNuevo || null,
      telefono: cuerpo.querySelector('#ce-tel').value.trim() || null,
      vip: cuerpo.querySelector('#ce-vip').checked,
      observaciones: cuerpo.querySelector('#ce-obs').value.trim() || null
    };

    // Corregir un nombre mal escrito suele significar que ya existe la
    // persona bien escrita. Si no se avisa aquí, quedan dos fichas idénticas
    // y el historial de esa persona se parte en dos.
    if (nombreNuevo && nombreNuevo !== c.nombre) {
      const gemelo = await buscarGemelo(nombreNuevo, c.id);
      if (gemelo) return proponerUnir(c, gemelo, datos);
    }

    await aplicar(datos);
  };

  async function aplicar(datos) {
    try {
      await D.guardarCliente(datos);
      avisar('Cliente actualizado', 'exito');
      cerrarHoja();
      vistaClientes();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  }
}

// Busca un cliente distinto cuyo nombre normalizado sea idéntico.
// Solo coincidencia exacta: para los parecidos ya está "Posibles duplicados".
async function buscarGemelo(nombre, propioId) {
  try {
    const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .toLowerCase().replace(/\s+/g, ' ').trim();
    const objetivo = norm(nombre);
    const hallados = await D.buscarClientes(nombre);
    return hallados.find(x => x.id !== propioId && norm(x.nombre) === objetivo) || null;
  } catch { return null; }   // si la búsqueda falla, no bloqueamos el guardado
}

// Ofrece unir en lugar de crear un duplicado. Deja salida por si de verdad
// son dos personas distintas con el mismo nombre.
function proponerUnir(actual, gemelo, datos) {
  const cuerpo = abrirHoja('Ya existe alguien con ese nombre', `
    <p class="ayuda" style="margin:0 0 18px">
      Al corregir el nombre, esta ficha queda igual que otra que ya existe.
      Si son la misma persona, únelas: el historial se junta y no se pierde
      ninguna visita.</p>

    <div class="tarifa" style="margin-bottom:8px">
      <div class="tarifa__linea"><span>Ficha que estás editando</span>
        <b>${escapar(actual.nombre || '—')}</b></div>
      <div class="tarifa__linea"><span>Visitas</span>
        <b>${actual.visitas ?? 0}</b></div>
    </div>
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Ficha que ya existía</span>
        <b>${escapar(gemelo.nombre)}</b></div>
      <div class="tarifa__linea"><span>Visitas</span>
        <b>${gemelo.visitas ?? 0}</b></div>
      <div class="tarifa__linea"><span>Teléfono</span>
        <b>${escapar(gemelo.telefono || '—')}</b></div>
    </div>

    <button class="btn btn--principal btn--bloque" id="pu-unir">
      Unir en una sola ficha</button>
    <button class="btn btn--neutro btn--bloque" id="pu-separado" style="margin-top:10px">
      Son personas distintas, guardar por separado</button>`);

  // Se conserva la ficha con más visitas: la otra se absorbe.
  const propias = actual.visitas ?? 0, ajenas = gemelo.visitas ?? 0;
  const [conservar, absorber] = propias >= ajenas
    ? [actual.id, gemelo.id] : [gemelo.id, actual.id];

  cuerpo.querySelector('#pu-unir').onclick = async () => {
    try {
      // Primero se corrige el nombre, para que la ficha que sobreviva
      // quede bien escrita aunque la que se conserve sea la otra.
      await D.guardarCliente(datos);
      const r = await D.fusionarClientes(conservar, absorber);
      avisar(`Unidas. Se movieron ${r.registros_movidos} registros.`, 'exito');
      cerrarHoja();
      vistaClientes();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };

  cuerpo.querySelector('#pu-separado').onclick = async () => {
    try {
      await D.guardarCliente(datos);
      avisar('Guardado como ficha separada', 'exito');
      cerrarHoja();
      vistaClientes();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}

// ---------------------------------------------------------------------------
//  Fusión: reasigna todos los registros y no borra nada físicamente.
// ---------------------------------------------------------------------------
function fusionar(conservar) {
  const cuerpo = abrirHoja('Fusionar clientes', `
    <div class="tarifa" style="margin-bottom:18px">
      <div class="tarifa__linea"><span>Se conserva</span>
        <span>${escapar(conservar.nombre || '—')} · ${conservar.visitas} visitas</span></div>
    </div>
    <div id="fu-absorber"></div>
    <div id="fu-resultado"></div>
    <p class="error">Esta acción no se puede deshacer desde la aplicación.</p>
    <button class="btn btn--principal btn--bloque" id="fu-ok" disabled>Fusionar</button>`);

  let absorber = null;
  autocompletar({
    contenedor: cuerpo.querySelector('#fu-absorber'),
    etiqueta: 'Cliente que se absorbe', requerido: true,
    buscar: async t => (await D.buscarClientes(t)).filter(c => c.id !== conservar.id),
    pintar: c => ({ titulo: c.nombre || 'Sin nombre', nota: `${c.visitas} visitas` }),
    alElegir: c => {
      absorber = c;
      cuerpo.querySelector('#fu-ok').disabled = !c;
      cuerpo.querySelector('#fu-resultado').innerHTML = c ? `
        <div class="tarifa" style="margin-bottom:18px">
          <div class="tarifa__linea tarifa__linea--total"><span>Resultado</span>
            <span>${escapar(conservar.nombre)} · ${conservar.visitas + c.visitas} visitas</span></div>
          <div class="tarifa__linea"><span>Registros que se mueven</span><span>${c.visitas}</span></div>
        </div>` : '';
    }
  });

  cuerpo.querySelector('#fu-ok').onclick = async () => {
    if (!absorber) return;
    try {
      const r = await D.fusionarClientes(conservar.id, absorber.id);
      avisar(`Fusionado. Se movieron ${r.registros_movidos} registros.`, 'exito');
      cerrarHoja(); vistaClientes();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}

// ---------------------------------------------------------------------------
//  Panel de posibles duplicados: los detecta el servidor por similitud.
// ---------------------------------------------------------------------------
async function panelDuplicados() {
  const cuerpo = abrirHoja('Posibles duplicados', esqueleto(4));
  try {
    const pares = await D.duplicadosCliente();
    cuerpo.innerHTML = pares.length ? `
      <p class="ayuda" style="margin-bottom:16px">Nombres muy parecidos. Revisa antes de unirlos.</p>
      ${pares.map((p, i) => `
        <div class="panel" style="margin-bottom:12px"><div class="panel__cuerpo">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <span><strong>${escapar(p.nombre_a)}</strong> · ${p.visitas_a} visitas</span>
            <span><strong>${escapar(p.nombre_b)}</strong> · ${p.visitas_b} visitas</span>
          </div>
          <button class="btn btn--suave btn--bloque" style="margin-top:12px" data-par="${i}">
            Unir en “${escapar(p.visitas_a >= p.visitas_b ? p.nombre_a : p.nombre_b)}”</button>
        </div></div>`).join('')}`
      : vacio('No se encontraron nombres parecidos. La base está limpia.');

    cuerpo.querySelectorAll('[data-par]').forEach(b => b.onclick = async () => {
      const p = pares[Number(b.dataset.par)];
      const [con, abs] = p.visitas_a >= p.visitas_b
        ? [p.id_a, p.id_b] : [p.id_b, p.id_a];
      const ok = await confirmar({
        titulo: 'Unir clientes', aceptar: 'Unir',
        texto: `Todos los masajes pasarán a un solo cliente. No se borra nada, pero no se puede deshacer.`
      });
      if (!ok) return;
      try {
        const r = await D.fusionarClientes(con, abs);
        avisar(`Unidos. Se movieron ${r.registros_movidos} registros.`, 'exito');
        panelDuplicados();
      } catch (ex) { avisar(mensajeError(ex), 'error'); }
    });
  } catch (ex) { cuerpo.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
}
