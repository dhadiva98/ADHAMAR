// ===========================================================================
//  RESUMEN, CAJA Y CIERRE DIARIO — solo administrador
//
//  La caja usa SIEMPRE precio_cobrado y solo cuenta registros ATENDIDOS.
//  Reservas y cancelados quedan fuera de todo cálculo de dinero.
//  El vuelto entregado por Yape no es una venta por Yape, y no sale de la
//  caja física: por eso no se resta del efectivo esperado.
// ===========================================================================
import { estado, hoy, fechaCorta, fechaLarga, monto, numero, escapar, mensajeError } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, esqueleto } from './ui.js';
import * as D from './datos.js';

// ---------------------------------------------------------------------------
//  RESUMEN — los acumulados que solo ve la dueña
// ---------------------------------------------------------------------------
export async function vistaResumen() {
  const v = $('#vista');
  v.innerHTML = esqueleto(4);
  try {
    const r = await D.resumenDia(hoy());
    const antesDeDescuentos = numero(r.ventas_referenciales);

    v.innerHTML = `
      <div class="rejilla">
        <div class="metrica destacada"><span class="eyebrow">Ventas de hoy</span><b>${monto(r.ventas_reales)}</b></div>
        <div class="metrica"><span class="eyebrow">Servicios atendidos</span><b>${r.servicios}</b></div>
        <div class="metrica"><span class="eyebrow">Ticket promedio</span><b>${monto(r.ticket_promedio)}</b></div>
        <div class="metrica"><span class="eyebrow">Descuentos otorgados</span><b>${monto(r.descuentos)}</b></div>
      </div>

      <div class="panel">
        <div class="panel__cabecera"><span class="eyebrow">Control de descuentos</span></div>
        <div class="panel__cuerpo">
          <div class="tarifa" style="margin:0">
            <div class="tarifa__linea"><span>Ventas antes de descuentos</span><span>${monto(antesDeDescuentos)}</span></div>
            <div class="tarifa__linea tarifa__linea--desc"><span>Descuentos otorgados</span><span>−${monto(r.descuentos)}</span></div>
            <div class="tarifa__linea tarifa__linea--total"><span>Ventas reales</span><span>${monto(r.ventas_reales)}</span></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel__cabecera"><span class="eyebrow">Cómo pagaron</span></div>
        <div class="panel__cuerpo"><div class="tarifa" style="margin:0">
          <div class="tarifa__linea"><span>Efectivo</span><span>${monto(r.efectivo)}</span></div>
          <div class="tarifa__linea"><span>Tarjeta</span><span>${monto(r.tarjeta)}</span></div>
          <div class="tarifa__linea"><span>Yape</span><span>${monto(r.yape)}</span></div>
          <div class="tarifa__linea"><span>Vuelto en efectivo</span><span>${monto(r.vuelto_efectivo)}</span></div>
          <div class="tarifa__linea"><span>Vuelto enviado por Yape</span><span>${monto(r.vuelto_yape)}</span></div>
        </div></div>
      </div>

      ${(r.reservas_pendientes || r.atenciones_sin_pago) ? `
        <div class="aviso" style="margin:18px 0 0">
          ${r.reservas_pendientes ? `Quedan ${r.reservas_pendientes} reservas sin completar. ` : ''}
          ${r.atenciones_sin_pago ? `${r.atenciones_sin_pago} atención sin forma de pago registrada.` : ''}
        </div>` : ''}`;
  } catch (ex) { v.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
}

// ---------------------------------------------------------------------------
//  CAJA
// ---------------------------------------------------------------------------
export async function vistaCaja(fecha = hoy()) {
  const v = $('#vista');
  v.innerHTML = esqueleto(5);
  try {
    const [r, c] = await Promise.all([D.resumenDia(fecha), D.cierre(fecha)]);
    const esperado = numero(r.efectivo_esperado);

    v.innerHTML = `
      <div class="barra-acciones">
        <input type="date" id="k-fecha" value="${fecha}"
               style="padding:12px 14px;border-radius:10px;font-size:15px;
                      border:1.5px solid var(--borde-fuerte);background:var(--superficie);color:inherit">
        ${r.cerrado
          ? '<button class="btn btn--neutro" id="k-reabrir">Reabrir día</button>'
          : '<button class="btn btn--principal" id="k-cerrar">Finalizar día</button>'}
      </div>
      <p class="eyebrow" style="margin:-8px 0 16px">${escapar(fechaLarga(fecha))}${r.cerrado ? ' · Día cerrado' : ''}</p>

      <div class="panel">
        <div class="panel__cabecera" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
          <span class="eyebrow">Efectivo con el que se inició el día</span>
          <button class="btn btn--suave" id="k-fondo" style="padding:9px 15px;min-height:44px">
            ${r.fondo_inicial != null ? monto(r.fondo_inicial) : 'Anotar'}</button>
        </div>
        <div class="panel__cuerpo">
          ${r.fondo_inicial == null
            ? `<p class="ayuda" style="margin:0">No se registró el efectivo inicial. Puedes anotarlo ahora
                 o al cerrar el día; sin él, la diferencia puede no ser confiable.</p>`
            : '<p class="ayuda" style="margin:0">Este dinero ya estaba en caja. No cuenta como venta.</p>'}
        </div>
      </div>

      <div class="panel">
        <div class="panel__cabecera"><span class="eyebrow">Efectivo esperado en caja</span></div>
        <div class="panel__cuerpo"><div class="tarifa" style="margin:0">
          <div class="tarifa__linea"><span>Fondo inicial</span><span>${r.fondo_inicial != null ? monto(r.fondo_inicial) : '—'}</span></div>
          <div class="tarifa__linea"><span>+ Ventas en efectivo</span><span>${monto(r.efectivo)}</span></div>
          <div class="tarifa__linea"><span>− Vuelto entregado en efectivo</span><span>${monto(r.vuelto_efectivo)}</span></div>
          <div class="tarifa__linea tarifa__linea--total"><span>Efectivo esperado</span><span>${monto(esperado)}</span></div>
        </div>
        <p class="ayuda">El vuelto enviado por Yape (${monto(r.vuelto_yape)}) no se resta: ese dinero nunca salió de la caja.</p>
        </div>
      </div>

      ${c ? panelCierre(c, fecha) : ''}`;

    $('#k-fecha').onchange = e => vistaCaja(e.target.value);
    $('#k-fondo').onclick = () => anotarFondo(fecha, r.fondo_inicial ?? r.caja_fija_anterior);

    const cerrar = $('#k-cerrar');
    if (cerrar) cerrar.onclick = () => pantallaCierre(fecha, r);

    const reab = $('#k-reabrir');
    if (reab) reab.onclick = async () => {
      const ok = await confirmar({ titulo: 'Reabrir día', aceptar: 'Reabrir',
        texto: 'Podrás corregir los registros de ese día sin ver advertencias en cada acción.' });
      if (!ok) return;
      try { await D.reabrirDia(fecha); avisar('Día reabierto', 'exito'); vistaCaja(fecha); }
      catch (ex) { avisar(mensajeError(ex), 'error'); }
    };

    v.querySelectorAll('[data-justificar]').forEach(b => b.onclick = () => justificar(fecha));
  } catch (ex) { v.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
}

function panelCierre(c, fecha) {
  const dif = c.diferencia == null ? null : numero(c.diferencia);
  const just = numero(c.diferencia_justificada);
  const pendiente = dif == null ? null : Math.abs(dif) - just;

  return `
    <div class="panel">
      <div class="panel__cabecera"><span class="eyebrow">Cierre registrado</span></div>
      <div class="panel__cuerpo">
        <div class="tarifa" style="margin:0 0 14px">
          <div class="tarifa__linea"><span>Efectivo esperado</span><span>${monto(c.efectivo_esperado)}</span></div>
          <div class="tarifa__linea"><span>Efectivo contado</span><span>${monto(c.efectivo_contado)}</span></div>
          ${dif != null ? `<div class="tarifa__linea ${dif !== 0 ? 'tarifa__linea--desc' : ''}">
            <span>Diferencia</span><span>${dif > 0 ? '+' : ''}${monto(dif)}</span></div>` : ''}
          ${just > 0 ? `<div class="tarifa__linea"><span>Justificado</span><span>${monto(just)}</span></div>` : ''}
          ${pendiente != null ? `<div class="tarifa__linea tarifa__linea--total">
            <span>${pendiente <= 0.001 ? '🟢 Cierre justificado' : '🟠 Diferencia sin justificar'}</span>
            <span>${monto(Math.max(0, pendiente))}</span></div>` : ''}
          <div class="tarifa__linea"><span>Se retiró</span><span>${monto(c.monto_retirado)}</span></div>
          <div class="tarifa__linea"><span>Caja fija para el día siguiente</span><span>${monto(c.caja_fija_siguiente)}</span></div>
        </div>
        ${c.modificado_en ? `<p class="ayuda">Este cierre fue recalculado el ${fechaCorta(c.modificado_en.slice(0,10))} porque se corrigió un registro del día.</p>` : ''}
        ${(c.ajustes || []).length ? `
          <span class="eyebrow" style="margin:14px 0 8px">Ajustes del día</span>
          <table><thead><tr><th>Motivo</th><th class="num">Monto</th><th>Tipo</th></tr></thead>
            <tbody>${c.ajustes.map(a => `<tr><td>${escapar(a.motivo)}</td>
              <td class="num">${monto(a.monto)}</td><td>${a.tipo}</td></tr>`).join('')}</tbody></table>` : ''}
        ${dif != null && dif !== 0 && pendiente > 0.001
          ? '<button class="btn btn--suave btn--bloque" data-justificar style="margin-top:14px">Justificar diferencia</button>' : ''}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
//  Fondo inicial: se puede anotar al abrir el día o retroactivamente al cerrar.
// ---------------------------------------------------------------------------
function anotarFondo(fecha, sugerido) {
  const cuerpo = abrirHoja('Efectivo inicial', `
    <p class="ayuda" style="margin:0 0 16px">¿Con cuánto efectivo se empezó el día? Este dinero ya estaba
       en la caja y no cuenta como venta.</p>
    <label class="campo campo--monto"><span>Efectivo con el que se inicia</span>
      <input type="number" id="fo-monto" step="0.5" min="0" value="${sugerido ?? ''}"></label>
    ${sugerido != null ? '<p class="ayuda" style="margin:-10px 0 16px">Es lo que quedó como caja fija en el cierre anterior. Confirma o corrige.</p>' : ''}
    <button class="btn btn--principal btn--bloque" id="fo-guardar">Guardar</button>`);

  cuerpo.querySelector('#fo-guardar').onclick = async () => {
    try {
      await D.registrarFondo(fecha, numero(cuerpo.querySelector('#fo-monto').value));
      avisar('Efectivo inicial guardado', 'exito');
      cerrarHoja(); vistaCaja(fecha);
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}

// ---------------------------------------------------------------------------
//  Pantalla de cierre
// ---------------------------------------------------------------------------
function pantallaCierre(fecha, r) {
  const esperado = numero(r.efectivo_esperado);
  const cuerpo = abrirHoja(`Resumen del día — ${fechaCorta(fecha)}`, `
    <div class="tarifa" style="margin-bottom:16px">
      <div class="tarifa__linea"><span>Servicios atendidos</span><span>${r.servicios}</span></div>
      ${r.reservas_pendientes ? `<div class="tarifa__linea tarifa__linea--desc">
        <span>Reservas sin completar</span><span>${r.reservas_pendientes} ⚠</span></div>` : ''}
      ${r.atenciones_sin_pago ? `<div class="tarifa__linea tarifa__linea--desc">
        <span>Atenciones sin forma de pago</span><span>${r.atenciones_sin_pago} ⚠</span></div>` : ''}
      <div class="tarifa__linea"><span>Ventas referenciales</span><span>${monto(r.ventas_referenciales)}</span></div>
      <div class="tarifa__linea tarifa__linea--desc"><span>Descuentos</span><span>−${monto(r.descuentos)}</span></div>
      <div class="tarifa__linea tarifa__linea--total"><span>Ventas reales</span><span>${monto(r.ventas_reales)}</span></div>
    </div>

    <div class="tarifa" style="margin-bottom:16px">
      <div class="tarifa__linea"><span>Efectivo</span><span>${monto(r.efectivo)}</span></div>
      <div class="tarifa__linea"><span>Tarjeta</span><span>${monto(r.tarjeta)}</span></div>
      <div class="tarifa__linea"><span>Yape</span><span>${monto(r.yape)}</span></div>
      <div class="tarifa__linea"><span>Vuelto en efectivo</span><span>${monto(r.vuelto_efectivo)}</span></div>
      <div class="tarifa__linea"><span>Vuelto enviado por Yape</span><span>${monto(r.vuelto_yape)}</span></div>
    </div>

    ${r.fondo_inicial == null ? `
      <label class="campo campo--monto"><span>¿Cuánto se dejó al iniciar el día?</span>
        <input type="number" id="ci-fondo" step="0.5" min="0" value="${r.caja_fija_anterior ?? ''}"></label>
      <p class="ayuda" style="margin:-10px 0 16px">No se anotó por la mañana. Si lo dejas vacío,
         la diferencia puede no ser confiable, pero puedes cerrar igual.</p>` : ''}

    <div class="tarifa" style="margin-bottom:16px">
      <div class="tarifa__linea tarifa__linea--total"><span>Efectivo esperado</span>
        <span id="ci-esperado">${monto(esperado)}</span></div>
    </div>

    <label class="campo campo--monto"><span>¿Cuánto efectivo contaste?</span>
      <input type="number" id="ci-contado" step="0.5" min="0"></label>
    <div class="tarifa" id="ci-dif" style="margin-bottom:16px"></div>

    <label class="campo campo--monto"><span>Caja fija que se deja para mañana</span>
      <input type="number" id="ci-caja" step="0.5" min="0" value="${r.fondo_inicial ?? r.caja_fija_anterior ?? ''}"></label>
    <div class="tarifa" id="ci-retira" style="margin-bottom:16px"></div>

    <label class="campo"><span>Observaciones</span>
      <textarea id="ci-obs" placeholder="Opcional"></textarea></label>

    <div class="barra-acciones" style="margin:0">
      <button class="btn btn--neutro" id="ci-no" style="flex:1">Cancelar</button>
      <button class="btn btn--principal" id="ci-si" style="flex:1.4">Finalizar día</button>
    </div>`);

  const el = s => cuerpo.querySelector(s);
  const fondoActual = () => r.fondo_inicial != null ? numero(r.fondo_inicial) : numero(el('#ci-fondo')?.value);

  function recalcular() {
    const esp = fondoActual() + numero(r.efectivo) - numero(r.vuelto_efectivo);
    el('#ci-esperado').textContent = monto(esp);
    const contado = el('#ci-contado').value;
    if (contado === '') { el('#ci-dif').innerHTML = ''; }
    else {
      const d = numero(contado) - esp;
      el('#ci-dif').innerHTML = `<div class="tarifa__linea ${d !== 0 ? 'tarifa__linea--desc' : ''}">
        <span>Diferencia</span><span>${d > 0 ? '+' : ''}${monto(d)}</span></div>`;
    }
    const caja = el('#ci-caja').value;
    el('#ci-retira').innerHTML = (contado === '' || caja === '') ? ''
      : `<div class="tarifa__linea"><span>Se retira</span>
         <span>${monto(numero(contado) - numero(caja))}</span></div>`;
  }

  ['#ci-fondo', '#ci-contado', '#ci-caja'].forEach(s => el(s)?.addEventListener('input', recalcular));
  recalcular();

  el('#ci-no').onclick = cerrarHoja;
  el('#ci-si').onclick = async () => {
    if (r.reservas_pendientes || r.atenciones_sin_pago) {
      const ok = await confirmar({
        titulo: '¿Finalizar de todas formas?', aceptar: 'Finalizar día',
        texto: `Quedan ${r.reservas_pendientes} reservas sin completar y ${r.atenciones_sin_pago} atención sin forma de pago registrada.`
      });
      if (!ok) return;
    }
    el('#ci-si').disabled = true;
    try {
      await D.cerrarDia(fecha,
        el('#ci-contado').value === '' ? null : numero(el('#ci-contado').value),
        el('#ci-caja').value === '' ? null : numero(el('#ci-caja').value),
        r.fondo_inicial == null && el('#ci-fondo')?.value ? numero(el('#ci-fondo').value) : null,
        el('#ci-obs').value.trim() || null);
      avisar('Día finalizado', 'exito');
      cerrarHoja(); vistaCaja(fecha);
    } catch (ex) { avisar(mensajeError(ex), 'error'); el('#ci-si').disabled = false; }
  };
}

// ---------------------------------------------------------------------------
//  Justificación de diferencia. NO es un módulo de gastos: solo responde
//  "¿por qué falta este dinero?". Nunca obliga a inventar un motivo.
// ---------------------------------------------------------------------------
function justificar(fecha) {
  const cuerpo = abrirHoja('Justificar diferencia', `
    <label class="campo"><span>Motivo</span>
      <input type="text" id="ju-motivo" placeholder="Se pagó agua"></label>
    <label class="campo campo--monto"><span>Monto</span>
      <input type="number" id="ju-monto" step="0.5" min="0"></label>
    <p class="ayuda" style="margin:-10px 0 16px">Puedes anotar varias justificaciones,
       una por cada cosa (agua, hielo…).</p>
    <button class="btn btn--principal btn--bloque" id="ju-ok">Guardar justificación</button>`);

  cuerpo.querySelector('#ju-ok').onclick = async () => {
    const motivo = cuerpo.querySelector('#ju-motivo').value.trim();
    const m = numero(cuerpo.querySelector('#ju-monto').value);
    if (!motivo || !(m > 0)) return avisar('Escribe el motivo y el monto.', 'error');
    try {
      const r = await D.justificar(fecha, motivo, m);
      avisar(r.pendiente <= 0.001 ? 'Cierre justificado' : `Quedan ${monto(r.pendiente)} sin justificar`, 'exito');
      cerrarHoja(); vistaCaja(fecha);
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}
