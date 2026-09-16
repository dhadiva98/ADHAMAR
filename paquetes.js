// ===========================================================================
//  PAQUETES CON NOMBRE ("Ritual Pareja", "Ritual Madre e Hija"…)
//
//  Un paquete tiene nombre, un solo precio y es para 1 o 2 personas.
//  CADA persona recibe lo que el paquete incluye: un masaje de X minutos
//  (el tipo se elige aquí, salvo que el paquete lo fije) y/o sauna.
//  Se guarda una fila por persona, unidas por `venta_paquete`.
//
//  El sauna es para UNA persona a la vez: en pareja se usa por turnos.
//  Por defecto la persona 1 hace sauna ANTES del masaje y la persona 2
//  DESPUÉS, así las dos entran y salen juntas sin cruzarse en el sauna.
// ===========================================================================
import { horaAhora, hora12, sumarMinutos, monto, numero,
         escapar, mensajeError, vibrar } from './core.js';
import { abrirHoja, cerrarHoja, avisar, autocompletar, preguntarEnLinea } from './ui.js';
import * as D from './datos.js';
import { clienteNuevoConAviso, resolverCliente } from './registro.js';

const MOTIVOS = ['Cliente frecuente', 'Promoción', 'Cortesía', 'Campaña',
                 'Compensación', 'Descuento especial', 'Otro'];

// "Deep Tissue · 45' + Sauna 30'" (lo que recibe CADA persona)
export function describirPaquete(p) {
  if (!p) return '';
  const partes = [];
  if (p.masaje_minutos) {
    const cual = p.masaje_fijo
      ? p.masaje_fijo + (p.modalidad_fija ? ` · ${p.modalidad_fija}` : '')
      : 'Masaje a elegir' + (p.modalidad_fija ? ` (${p.modalidad_fija})` : '');
    partes.push(`${cual} ${p.masaje_minutos}'`);
  }
  if (p.sauna_minutos) partes.push(`Sauna ${p.sauna_minutos}'`);
  return partes.join(' + ');
}

export const paraCuantos = p => p.personas === 2 ? 'Para 2 personas' : 'Para 1 persona';

// Masajes que pueden ir en este paquete (tipo masaje, mismo tiempo, y el
// masaje/modalidad fijos si el paquete los define).
const masajesValidos = (p, servicios) => !p?.masaje_minutos ? [] : servicios
  .filter(s => s.tipo === 'masaje' && s.duracion === p.masaje_minutos
    && (!p.masaje_fijo || s.masaje === p.masaje_fijo)
    && (!p.modalidad_fija || s.modalidad === p.modalidad_fija))
  .sort((a, b) => a.masaje.localeCompare(b.masaje) || a.modalidad.localeCompare(b.modalidad));

const aMin = hhmm => { if (!hhmm) return null; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const cruzan = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

// ---------------------------------------------------------------------------
//  filas: registros existentes de la venta (null = venta nueva)
//  inicial: { hora, cliente } traídos del formulario normal
// ---------------------------------------------------------------------------
export async function formularioPaquete(filas, fecha, alGuardar, inicial = {}) {
  const editando = !!filas?.length;
  const venta = editando ? filas[0].venta_paquete : null;
  const estadoActual = editando ? filas[0].estado : null;

  const cuerpo = abrirHoja(editando ? (estadoActual === 'reserva' ? 'Completar paquete' : 'Corregir paquete')
                                    : 'Registrar paquete', `<div id="pq-cargando" class="ayuda">Cargando…</div>`);
  const el = q => cuerpo.querySelector(q);

  let lista = [], servicios = [];
  try {
    [lista, servicios] = await Promise.all([D.paquetes(false), D.servicios(true)]);
  } catch (ex) { cuerpo.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; return; }

  const activos = lista.filter(p => p.activo || (editando && p.id === filas[0].paquete_id));
  if (!activos.length) {
    cuerpo.innerHTML = `<p class="ayuda">Todavía no hay paquetes. Administración los crea en Servicios → Paquetes.</p>`;
    return;
  }

  let paquete = (editando && lista.find(p => p.id === filas[0].paquete_id)) || null;

  // Estado de cada persona
  const personas = [0, 1].map(i => {
    const f = filas?.find(x => x.persona === i + 1);
    return {
      cliente: f?.cliente || (f?.cliente_texto ? { id: null, nombre: f.cliente_texto, __texto: true } : null)
               || (i === 0 && !editando ? inicial.cliente || null : null),
      servicio: f?.servicio_id ? (servicios.find(s => s.id === f.servicio_id) || f.servicio) : null,
      hora: f?.hora_ingreso?.slice(0, 5) || inicial.hora || horaAhora(),
      horaTocada: !!f,
      orden: f?.sauna_orden || null,
      masajista: (() => {
        const m = f?.masajistas?.[0];
        return m?.masajista_id ? { id: m.masajista_id,
          display: m.masajista ? `${m.masajista.nombre} ${m.masajista.apellido || ''}`.trim()
                               : m.masajista_nombre_snapshot } : null;
      })(),
      bCliente: null
    };
  });

  const totalGuardado = editando && filas.some(f => f.precio_cobrado != null)
    ? filas.reduce((s, f) => s + numero(f.precio_cobrado), 0) : null;
  const recibidoGuardado = editando && filas[0].dinero_recibido != null
    ? numero(filas[0].dinero_recibido) + filas.slice(1).reduce((s, f) => s + numero(f.precio_cobrado), 0) : null;

  cuerpo.innerHTML = `
    <label class="campo"><span>Paquete</span>
      <select id="pq-paquete">
        ${paquete ? '' : '<option value="">Elige un paquete…</option>'}
        ${activos.map(p => `<option value="${p.id}" ${paquete?.id === p.id ? 'selected' : ''}>
          ${escapar(p.nombre)} · ${p.personas === 2 ? '2 personas' : '1 persona'} · ${monto(p.precio)}</option>`).join('')}
      </select></label>
    <p class="ayuda" id="pq-incluye" style="margin:-8px 0 18px"></p>

    <div id="pq-personas"></div>
    <div id="pq-precio"></div>
    <div id="pq-pago"></div>

    <details style="margin:8px 0 18px">
      <summary style="padding:12px 0;font-weight:600;cursor:pointer">Motivo del descuento y notas</summary>
      <div style="padding-top:12px">
        <label class="campo"><span>Motivo del descuento</span>
          <select id="pq-motivo"><option value="">Sin motivo</option>
            ${MOTIVOS.map(m => `<option ${filas?.[0]?.motivo_descuento === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="campo ${filas?.[0]?.motivo_descuento === 'Otro' ? '' : 'oculto'}" id="pq-motivo-otro-caja"><span>¿Cuál?</span>
          <input type="text" id="pq-motivo-otro" value="${escapar(filas?.[0]?.motivo_descuento_texto || '')}"></label>
        <label class="campo"><span>Nota interna</span>
          <textarea id="pq-notas" placeholder="Solo la ven ustedes.">${escapar(filas?.[0]?.notas || '')}</textarea></label>
      </div>
    </details>

    <p class="error" id="pq-error" hidden></p>
    <div id="pq-aviso"></div>
    <div class="barra-acciones" style="margin:0">
      ${estadoActual && estadoActual !== 'reserva' ? '' :
        '<button class="btn btn--neutro" id="pq-reserva" style="flex:1">Guardar como reserva</button>'}
      <button class="btn btn--principal" id="pq-atendido" style="flex:1.3">Guardar atención</button>
    </div>
    ${editando && estadoActual === 'reserva'
      ? '<button class="btn btn--peligro btn--bloque" id="pq-borrar" style="margin-top:12px">Borrar esta reserva</button>' : ''}`;

  el('#pq-motivo').onchange = e =>
    el('#pq-motivo-otro-caja').classList.toggle('oculto', e.target.value !== 'Otro');

  // ---------------------------------------------------------------------
  const n = () => paquete?.personas || 0;
  const conMasaje = () => !!paquete?.masaje_minutos;
  const conSauna = () => !!paquete?.sauna_minutos;

  // Minutos desde el ingreso hasta el inicio del masaje / del sauna de una persona
  const inicioMasaje = per => aMin(per.hora) + (conSauna() && per.orden === 'antes' ? paquete.sauna_minutos : 0);
  const inicioSauna = per => aMin(per.hora) + (conMasaje() && per.orden === 'despues' ? paquete.masaje_minutos : 0);
  const finTotal = per => aMin(per.hora) + (paquete.masaje_minutos || 0) + (paquete.sauna_minutos || 0);
  const aHora = min => { const h = Math.floor(min / 60) % 24, m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };

  function pintarPaquete() {
    el('#pq-incluye').textContent = paquete
      ? `${paraCuantos(paquete)}. Cada una recibe: ${describirPaquete(paquete)}.` +
        (paquete.personas === 2 && conSauna() ? ' El sauna es por turnos (entra una a la vez).' : '')
      : '';
    // Valores por defecto al cambiar de paquete
    personas.forEach((per, i) => {
      if (per.servicio && !masajesValidos(paquete, servicios).some(s => s.id === per.servicio.id)) per.servicio = null;
      if (!conMasaje()) { per.servicio = null; per.masajista = null; }
      if (conMasaje() && conSauna() && paquete.personas === 2 && !per.orden) per.orden = i === 0 ? 'antes' : 'despues';
      if (!(conMasaje() && conSauna())) per.orden = null;
    });
    // Solo sauna en pareja: la segunda entra cuando sale la primera.
    if (paquete && !conMasaje() && paquete.personas === 2 && !personas[1].horaTocada && personas[0].hora) {
      personas[1].hora = sumarMinutos(personas[0].hora, paquete.sauna_minutos);
    }
    pintarPersonas();
    pintarPrecio();
  }

  function pintarPersonas() {
    const caja = el('#pq-personas');
    if (!paquete) { caja.innerHTML = ''; return; }
    const validos = masajesValidos(paquete, servicios);

    caja.innerHTML = Array.from({ length: n() }, (_, i) => `
      <div class="panel" style="margin-bottom:14px">
        <div class="panel__cabecera"><span class="eyebrow">Persona ${i + 1}</span></div>
        <div class="panel__cuerpo">
          <div id="pq-cli-${i}"></div>
          ${conMasaje() ? `
            <p class="eyebrow" style="margin-bottom:8px">Masaje de ${paquete.masaje_minutos}'</p>
            ${validos.length ? `<div class="duraciones" style="margin-bottom:16px">
              ${validos.map(s => `<button type="button" class="duracion${personas[i].servicio?.id === s.id ? ' elegida' : ''}"
                  data-persona="${i}" data-servicio="${s.id}">
                <strong>${escapar(s.masaje)}</strong><small>${escapar(s.modalidad)}</small></button>`).join('')}
            </div>` : `<p class="error">No hay masajes de ${paquete.masaje_minutos}' con precio en Servicios.</p>`}` : ''}
          <label class="campo"><span>Hora de ingreso</span>
            <input type="time" id="pq-hora-${i}" value="${personas[i].hora || ''}"></label>
          ${conMasaje() && conSauna() ? `
            <div class="campo"><span>El sauna va</span>
              <div class="segmentos">
                <button type="button" data-persona="${i}" data-orden="antes" class="${personas[i].orden === 'antes' ? 'activo' : ''}">Antes del masaje</button>
                <button type="button" data-persona="${i}" data-orden="despues" class="${personas[i].orden === 'despues' ? 'activo' : ''}">Después del masaje</button>
              </div></div>` : ''}
          ${conMasaje() ? `<div id="pq-ter-${i}"></div>` : ''}
          <p class="ayuda" id="pq-fin-${i}" style="margin:-6px 0 0"></p>
        </div>
      </div>`).join('');

    personas.slice(0, n()).forEach((per, i) => {
      per.bCliente = autocompletar({
        contenedor: el(`#pq-cli-${i}`), etiqueta: 'Cliente', valorInicial: per.cliente,
        autoenfocar: false, buscar: D.buscarClientes,
        pintar: c => ({ titulo: (c.vip ? '★ ' : '') + (c.nombre || 'Sin nombre'),
                        nota: c.__nuevo || c.__texto ? 'Nuevo' : c.visitas ? `${c.visitas} visitas` : 'Sin visitas' }),
        alElegir: c => per.cliente = c,
        permitirCrear: clienteNuevoConAviso, textoCrear: 'Nuevo cliente'
      });
      if (conMasaje()) {
        autocompletar({
          contenedor: el(`#pq-ter-${i}`), etiqueta: 'Masajista', requerido: true,
          valorInicial: per.masajista, autoenfocar: false,
          buscar: D.buscarMasajistas, pintar: m => ({ titulo: m.display }),
          alElegir: m => per.masajista = m
        });
      }
      el(`#pq-hora-${i}`).addEventListener('input', e => {
        per.hora = e.target.value; per.horaTocada = true;
        // Solo sauna en pareja: mover el turno de la segunda si nadie lo tocó.
        if (i === 0 && !conMasaje() && n() === 2 && !personas[1].horaTocada && per.hora) {
          personas[1].hora = sumarMinutos(per.hora, paquete.sauna_minutos);
          el('#pq-hora-1').value = personas[1].hora;
        }
        pintarFines();
      });
    });

    caja.querySelectorAll('[data-servicio]').forEach(b => b.onclick = () => {
      const per = personas[Number(b.dataset.persona)];
      per.servicio = servicios.find(s => s.id === b.dataset.servicio);
      caja.querySelectorAll(`[data-servicio][data-persona="${b.dataset.persona}"]`)
        .forEach(x => x.classList.toggle('elegida', x === b));
      vibrar(10);
    });
    caja.querySelectorAll('[data-orden]').forEach(b => b.onclick = () => {
      const per = personas[Number(b.dataset.persona)];
      per.orden = b.dataset.orden;
      caja.querySelectorAll(`[data-orden][data-persona="${b.dataset.persona}"]`)
        .forEach(x => x.classList.toggle('activo', x === b));
      pintarFines();
    });
    pintarFines();
  }

  function pintarFines() {
    personas.slice(0, n()).forEach((per, i) => {
      const p = el(`#pq-fin-${i}`); if (!p) return;
      if (!per.hora) { p.textContent = ''; return; }
      if (conSauna() && conMasaje() && !per.orden) {
        p.textContent = 'Indica si el sauna va antes o después del masaje.'; return;
      }
      const sauna = conSauna() &&
        `sauna ${hora12(aHora(inicioSauna(per)))}–${hora12(aHora(inicioSauna(per) + paquete.sauna_minutos))}`;
      const masaje = conMasaje() &&
        `masaje ${hora12(aHora(inicioMasaje(per)))}–${hora12(aHora(inicioMasaje(per) + paquete.masaje_minutos))}`;
      const orden = per.orden === 'despues' ? [masaje, sauna] : [sauna, masaje];
      p.textContent = `${orden.filter(Boolean).join(' · ')} → termina ~${hora12(aHora(finTotal(per)))}`;
    });
  }

  // --- Precio del paquete (se reparte en partes iguales) -------------------
  function pintarPrecio() {
    const caja = el('#pq-precio');
    if (!paquete) { caja.innerHTML = ''; pintarPago(); return; }
    const actual = el('#pq-cobrado')?.value;
    const precioLista = numero(paquete.precio);
    caja.innerHTML = `
      <div class="tarifa">
        <div class="tarifa__linea"><span>Precio del paquete</span><span>${monto(precioLista)}</span></div>
        <div class="tarifa__linea tarifa__linea--desc oculto" id="pq-linea-desc">
          <span id="pq-desc-etq">Descuento</span><span id="pq-desc-val"></span></div>
        <div class="tarifa__linea tarifa__linea--total"><span>Precio cobrado</span>
          <span id="pq-cobrado-eco">${monto(precioLista)}</span></div>
      </div>
      <label class="campo campo--monto"><span>Precio a cobrar (total del paquete)</span>
        <input type="number" id="pq-cobrado" inputmode="decimal" step="0.5" min="0"
               value="${actual ?? (totalGuardado ?? precioLista)}"></label>
      <p class="ayuda" id="pq-reparto" style="margin:-10px 0 18px"></p>`;
    el('#pq-cobrado').addEventListener('input', calcular);
    calcular();
  }

  function calcular() {
    if (!paquete) return;
    const precioLista = numero(paquete.precio);
    const cob = numero(el('#pq-cobrado').value);
    const desc = Math.max(0, precioLista - cob), aju = Math.max(0, cob - precioLista);
    const linea = el('#pq-linea-desc');
    el('#pq-cobrado-eco').textContent = monto(cob);
    if (desc > 0)     { linea.classList.remove('oculto'); el('#pq-desc-etq').textContent = 'Descuento'; el('#pq-desc-val').textContent = '−' + monto(desc); }
    else if (aju > 0) { linea.classList.remove('oculto'); el('#pq-desc-etq').textContent = 'Ajuste';    el('#pq-desc-val').textContent = '+' + monto(aju); }
    else linea.classList.add('oculto');
    el('#pq-reparto').textContent = n() === 2
      ? `En el registro se anota ${monto(cob / 2)} por persona.` : '';
    pintarPago();
  }

  // --- Pago (una sola vez por todo el paquete) -----------------------------
  function pintarPago() {
    const caja = el('#pq-pago');
    if (!paquete) { caja.innerHTML = ''; return; }
    const forma = el('#pq-forma')?.value ?? filas?.[0]?.forma_pago ?? '';
    const recibido = el('#pq-recibido')?.value ?? recibidoGuardado ?? '';
    const via = el('#pq-vuelto-via')?.value ?? filas?.[0]?.vuelto_metodo ?? 'efectivo';
    const cobrado = numero(el('#pq-cobrado')?.value);

    caja.innerHTML = `
      <label class="campo"><span>Forma de pago</span>
        <select id="pq-forma">
          <option value="">Todavía no se registró</option>
          <option value="efectivo" ${forma === 'efectivo' ? 'selected' : ''}>Efectivo</option>
          <option value="tarjeta"  ${forma === 'tarjeta'  ? 'selected' : ''}>Tarjeta</option>
          <option value="yape"     ${forma === 'yape'     ? 'selected' : ''}>Yape</option>
        </select></label>
      ${forma === 'efectivo' ? `
        <label class="campo campo--monto"><span>¿Cuánto entregaron?</span>
          <input type="number" id="pq-recibido" inputmode="decimal" step="0.5" min="0" value="${recibido}"></label>
        <div class="tarifa" id="pq-vuelto-caja"></div>
        <label class="campo"><span>El vuelto se entrega por</span>
          <select id="pq-vuelto-via">
            <option value="efectivo" ${via === 'efectivo' ? 'selected' : ''}>Efectivo</option>
            <option value="yape"     ${via === 'yape'     ? 'selected' : ''}>Yape</option>
          </select></label>` : ''}`;
    el('#pq-forma').onchange = pintarPago;
    if (forma === 'efectivo') {
      const rec = el('#pq-recibido');
      const dibujar = () => {
        const r = numero(rec.value), v = r - cobrado;
        el('#pq-vuelto-caja').innerHTML = r === 0 ? '<div class="tarifa__linea"><span>Vuelto</span><span>—</span></div>'
          : v < 0 ? `<div class="tarifa__linea tarifa__linea--desc"><span>Falta</span><span>${monto(-v)}</span></div>`
                  : `<div class="tarifa__linea"><span>Vuelto</span><span>${monto(v)}</span></div>`;
      };
      rec.addEventListener('input', dibujar);
      dibujar();
    }
  }

  el('#pq-paquete').onchange = e => {
    paquete = lista.find(p => p.id === e.target.value) || null;
    // Precio nuevo: se toma el del paquete elegido.
    const cob = el('#pq-cobrado'); if (cob) cob.value = paquete ? paquete.precio : '';
    pintarPaquete();
  };

  // --- Guardar --------------------------------------------------------------
  const fallo = msg => {
    const err = el('#pq-error');
    err.textContent = msg; err.hidden = false;
    err.scrollIntoView({ block: 'center', behavior: 'smooth' });
    vibrar([12, 60, 12]);
  };

  async function avisosDeHorario() {
    const activas = personas.slice(0, n()).filter(p => p.hora);
    const excluir = editando ? filas.map(f => f.id) : null;
    const preguntar = texto => preguntarEnLinea(el('#pq-aviso'), {
      texto, aceptar: 'Guardar igual', rechazar: 'Revisar' });

    // Dentro del mismo paquete
    if (conSauna() && activas.length === 2) {
      const [a, b] = activas;
      if (cruzan(inicioSauna(a), inicioSauna(a) + paquete.sauna_minutos,
                 inicioSauna(b), inicioSauna(b) + paquete.sauna_minutos)) {
        if (!await preguntar('Las dos personas quedarían en el sauna al mismo tiempo, y entra una sola. ¿Lo guardo igual?')) return false;
      }
    }
    if (conMasaje() && activas.length === 2) {
      const [a, b] = activas;
      if (a.masajista && b.masajista && a.masajista.id === b.masajista.id &&
          cruzan(inicioMasaje(a), inicioMasaje(a) + paquete.masaje_minutos,
                 inicioMasaje(b), inicioMasaje(b) + paquete.masaje_minutos)) {
        if (!await preguntar(`${a.masajista.display} tendría los dos masajes al mismo tiempo. Cambia la hora de una persona o elige otra masajista. ¿Lo guardo igual?`)) return false;
      }
    }
    // Contra la agenda del día
    try {
      for (const per of activas) {
        if (conMasaje() && per.masajista) {
          const ch = await D.avisoSolapamiento([per.masajista.id], fecha, per.hora,
            paquete.masaje_minutos, excluir, inicioMasaje(per) - aMin(per.hora));
          if (ch?.length && !await preguntar(`${ch[0].masajista} ya tiene un masaje de ${hora12(ch[0].desde?.slice(0,5))} a ${hora12(ch[0].hasta?.slice(0,5))}. ¿Lo guardo igual?`)) return false;
        }
        if (conSauna() && (!conMasaje() || per.orden)) {
          const cr = await D.crucesSauna(fecha, aHora(inicioSauna(per)), paquete.sauna_minutos, excluir);
          if (cr?.length && !await preguntar(`El sauna está ocupado de ${hora12(cr[0].desde?.slice(0,5))} a ${hora12(cr[0].hasta?.slice(0,5))} (${cr[0].cliente}). ¿Lo guardo igual?`)) return false;
        }
      }
    } catch (_) {}
    return true;
  }

  async function guardar(destino) {
    el('#pq-error').hidden = true;
    if (!paquete) return fallo('Elige el paquete.');
    const activas = personas.slice(0, n());

    if (destino === 'atendido') {
      for (const [i, per] of activas.entries()) {
        const q = n() === 2 ? ` (persona ${i + 1})` : '';
        if (conMasaje() && !per.servicio) return fallo(`Falta elegir el masaje${q}.`);
        if (conMasaje() && !per.masajista) return fallo(`Falta elegir la masajista${q}.`);
        if (conMasaje() && conSauna() && !per.orden) return fallo(`Indica si el sauna va antes o después del masaje${q}.`);
      }
      const cob = numero(el('#pq-cobrado').value);
      if (el('#pq-cobrado').value === '' || !(cob >= 0)) return fallo('Escribe cuánto se cobró por el paquete.');
      if (el('#pq-forma').value === 'efectivo' && el('#pq-recibido').value &&
          numero(el('#pq-recibido').value) < cob) return fallo('El monto recibido es insuficiente.');
    }

    if (!await avisosDeHorario()) return;

    const btn = destino === 'atendido' ? el('#pq-atendido') : el('#pq-reserva');
    btn.disabled = true;
    try {
      const datosPersonas = [];
      for (const per of activas) {
        const c = await resolverCliente(
          per.cliente || (per.bCliente?.texto() ? { id: null, nombre: per.bCliente.texto(), __nuevo: true } : null),
          destino);
        datosPersonas.push({
          cliente_id: c?.id || null,
          cliente_texto: c && !c.id ? (c.nombre || null) : null,
          servicio_id: per.servicio?.id || null,
          hora_ingreso: per.hora || null,
          sauna_orden: per.orden || null,
          masajistas: per.masajista ? [per.masajista.id] : []
        });
      }
      const forma = el('#pq-forma').value || null;
      await D.guardarVentaPaquete({
        paquete_id: paquete.id,
        estado: destino,
        fecha,
        precio_cobrado: el('#pq-cobrado').value === '' ? null : numero(el('#pq-cobrado').value),
        forma_pago: forma,
        dinero_recibido: forma === 'efectivo' && el('#pq-recibido')?.value ? numero(el('#pq-recibido').value) : null,
        vuelto_metodo: forma === 'efectivo' ? (el('#pq-vuelto-via')?.value || null) : null,
        motivo_descuento: el('#pq-motivo').value || null,
        motivo_descuento_texto: el('#pq-motivo').value === 'Otro' ? el('#pq-motivo-otro').value : null,
        notas: el('#pq-notas').value || null
      }, datosPersonas, venta);
      avisar(destino === 'atendido' ? 'Paquete guardado' : 'Reserva guardada', 'exito');
      cerrarHoja();
      alGuardar?.();
    } catch (ex) { fallo(mensajeError(ex)); btn.disabled = false; }
  }

  el('#pq-atendido').onclick = () => guardar('atendido');
  const br = el('#pq-reserva'); if (br) br.onclick = () => guardar('reserva');

  const borrar = el('#pq-borrar');
  if (borrar) borrar.onclick = async () => {
    const seguro = await preguntarEnLinea(el('#pq-aviso'), {
      texto: 'Se quita de la agenda la reserva completa del paquete. No es una venta, así que no afecta la caja.',
      aceptar: 'Borrar reserva', rechazar: 'Cancelar' });
    if (!seguro) return;
    try {
      await D.borrarVenta(venta);
      avisar('Reserva borrada', 'exito');
      cerrarHoja(); alGuardar?.();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };

  if (paquete) pintarPaquete();
  else if (activos.length === 1) {
    paquete = activos[0];
    el('#pq-paquete').value = paquete.id;
    pintarPaquete();
  }
}
