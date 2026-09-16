// ===========================================================================
//  REGISTRAR SERVICIO
//
//  Debe completarse en pocos segundos. La tarifa aparece DESPUÉS de elegir
//  masaje y tiempo, siempre etiquetada como referencia, con el precio a
//  cobrar editable justo debajo.
// ===========================================================================
import { estado, hoy, horaAhora, hora12, sumarMinutos, monto, numero,
         escapar, mensajeError, vibrar } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, autocompletar, preguntarEnLinea } from './ui.js';
import * as D from './datos.js';

const MOTIVOS = ['Cliente frecuente', 'Promoción', 'Cortesía', 'Campaña',
                 'Compensación', 'Descuento especial', 'Otro'];

// ---------------------------------------------------------------------------
//  Atajo de reserva: tres campos y un botón. Debe hacerse en segundos.
// ---------------------------------------------------------------------------
export function reservaRapida(fecha, alGuardar) {
  const cuerpo = abrirHoja('Reserva rápida', `
    <div id="rr-cliente"></div>
    <label class="campo"><span>Hora</span>
      <input type="time" id="rr-hora" value="${horaAhora()}"></label>
    <div id="rr-masajista"></div>
    <label class="campo"><span>Fecha</span>
      <input type="date" id="rr-fecha" value="${fecha}"></label>
    <p class="ayuda">Con un nombre, una hora o una terapeuta ya se puede guardar.
       El resto se completa cuando llegue el momento.</p>
    <button class="btn btn--principal btn--bloque" id="rr-guardar"
            style="margin-top:14px">Guardar reserva</button>`);

  let cliente = null, masajista = null;

  const bCliente = autocompletar({
    contenedor: cuerpo.querySelector('#rr-cliente'),
    etiqueta: 'Nombre o apodo',
    buscar: D.buscarClientes,
    pintar: c => ({ titulo: c.nombre || 'Sin nombre',
                    nota: c.visitas ? `${c.visitas} ${c.visitas === 1 ? 'visita' : 'visitas'}` : 'Nuevo' }),
    alElegir: c => cliente = c,
    permitirCrear: (t) => ({ id: null, nombre: t, __texto: true }),
    textoCrear: 'Anotar como'
  });

  autocompletar({
    contenedor: cuerpo.querySelector('#rr-masajista'),
    etiqueta: 'Terapeuta',
    buscar: D.buscarMasajistas,
    pintar: m => ({ titulo: m.display }),
    alElegir: m => masajista = m
  });

  cuerpo.querySelector('#rr-guardar').onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const c = bCliente.valor();
    try {
      await D.guardarRegistro({
        estado: 'reserva',
        fecha: cuerpo.querySelector('#rr-fecha').value,
        hora_ingreso: cuerpo.querySelector('#rr-hora').value || null,
        cliente_id: c && !c.__texto ? c.id : null,
        cliente_texto: c && c.__texto ? c.nombre : (c ? null : bCliente.texto() || null)
      }, masajista ? [masajista.id] : []);
      avisar('Reserva guardada', 'exito');
      cerrarHoja(); alGuardar?.();
    } catch (ex) { avisar(mensajeError(ex), 'error'); btn.disabled = false; }
  };
}

// ---------------------------------------------------------------------------
//  Formulario completo. Sirve para crear y para completar una reserva.
// ---------------------------------------------------------------------------
export async function formularioServicio(reg, fecha, alGuardar) {
  const editando = !!reg;
  const cuerpo = abrirHoja(editando ? 'Completar atención' : 'Registrar servicio', `
    <div id="f-cliente"></div>
    <div id="f-masaje"></div>
    <div id="f-combinaciones"></div>
    <div id="f-tarifa"></div>

    <label class="campo"><span>Hora de ingreso</span>
      <input type="time" id="f-hora" value="${reg?.hora_ingreso?.slice(0,5) || horaAhora()}"></label>
    <p class="ayuda" id="f-termina" style="margin:-10px 0 18px"></p>

    <div id="f-masajista"></div>
    <label class="casilla"><input type="checkbox" id="f-varias">
      <span>Más de una masajista</span></label>
    <div id="f-extras"></div>

    <div id="f-pago"></div>

    <details style="margin:8px 0 18px">
      <summary style="padding:12px 0;font-weight:600;cursor:pointer">Motivo del descuento y notas</summary>
      <div style="padding-top:12px">
        <label class="campo"><span>Motivo del descuento</span>
          <select id="f-motivo"><option value="">Sin motivo</option>
            ${MOTIVOS.map(m => `<option>${m}</option>`).join('')}</select></label>
        <label class="campo oculto" id="f-motivo-otro-caja"><span>¿Cuál?</span>
          <input type="text" id="f-motivo-otro"></label>
        <label class="campo"><span>Nota interna</span>
          <textarea id="f-notas" placeholder="Solo la ven ustedes.">${escapar(reg?.notas || '')}</textarea></label>
      </div>
    </details>

    <p class="error" id="f-error" hidden></p>
    <div class="barra-acciones" style="margin:0">
      <button class="btn btn--neutro" id="f-reserva" style="flex:1">Guardar como reserva</button>
      <button class="btn btn--principal" id="f-atendido" style="flex:1.3">Guardar atención</button>
    </div>
    ${editando && reg.estado === 'reserva'
      ? '<button class="btn btn--peligro btn--bloque" id="f-borrar" style="margin-top:12px">Borrar esta reserva</button>'
      : ''}`);

  // --- Estado del formulario ---
  let servicio  = reg?.servicio || null;
  let masaje    = servicio?.masaje || null;
  let masajistas = (reg?.masajistas || []).map(m => ({
    id: m.masajista_id, display: m.masajista?.nombre
      ? `${m.masajista.nombre} ${m.masajista.apellido || ''}`.trim()
      : m.masajista_nombre_snapshot
  })).filter(m => m.id);
  // Si la reserva solo tenía un nombre suelto ("Anotar como"), se conserva:
  // antes se perdía al completar la atención.
  let cliente   = reg?.cliente
    || (reg?.cliente_texto ? { id: null, nombre: reg.cliente_texto, __texto: true } : null);
  let todos     = [];

  const el = s => cuerpo.querySelector(s);

  // === 1. Masaje (autocompletado) ==========================================
  autocompletar({
    contenedor: el('#f-masaje'),
    etiqueta: 'Masaje', requerido: true,
    valorInicial: masaje ? { masaje } : null,
    buscar: async t => {
      const r = await D.buscarServicios(t);
      const vistos = new Set();
      return r.filter(s => !vistos.has(s.masaje) && vistos.add(s.masaje))
              .map(s => ({ masaje: s.masaje }));
    },
    pintar: m => ({ titulo: m.masaje }),
    alElegir: async m => {
      masaje = m?.masaje || null;
      servicio = null;
      await pintarCombinaciones();
      pintarTarifa();
    }
  });

  // === 2. Modalidad y tiempo (selección progresiva) ========================
  // Solo se muestran las combinaciones QUE EXISTEN. Nada de opciones
  // deshabilitadas ni celdas vacías.
  async function pintarCombinaciones() {
    const caja = el('#f-combinaciones');
    if (!masaje) { caja.innerHTML = ''; return; }

    if (!todos.length) todos = await D.servicios(true);
    const propios = todos.filter(s => s.masaje === masaje);
    if (!propios.length) { caja.innerHTML = '<p class="ayuda">Este masaje no tiene precios cargados.</p>'; return; }

    const porModalidad = {};
    propios.forEach(s => (porModalidad[s.modalidad] ||= []).push(s));

    caja.innerHTML = `<p class="eyebrow" style="margin-bottom:10px">Modalidad y tiempo</p>` +
      Object.entries(porModalidad).map(([mod, lista]) => `
        <div class="grupo-modalidad">
          <span>${escapar(mod)}${lista[0].terapeutas_requeridas > 1 ? ' · 2 srtas' : ''}</span>
          <div class="duraciones">
            ${lista.sort((a,b) => a.duracion - b.duracion).map(s => `
              <button type="button" class="duracion${servicio?.id === s.id ? ' elegida' : ''}"
                      data-id="${s.id}">
                <strong>${s.duracion}'</strong><small>${monto(s.precio_referencial)}</small>
              </button>`).join('')}
          </div>
        </div>`).join('');

    caja.querySelectorAll('.duracion').forEach(b => b.onclick = () => {
      servicio = propios.find(s => s.id === b.dataset.id);
      caja.querySelectorAll('.duracion').forEach(x => x.classList.toggle('elegida', x === b));
      vibrar(10);
      pintarTarifa();
      // 4 Manos y similares: marcar sola la casilla, para ahorrar el clic.
      if (servicio.terapeutas_requeridas > 1 && !el('#f-varias').checked) {
        el('#f-varias').checked = true; pintarExtras();
      }
    });
  }

  // === 3. Tarifa referencial y precio a cobrar ============================
  function pintarTarifa() {
    const caja = el('#f-tarifa');
    if (!servicio) { caja.innerHTML = ''; actualizarTermina(); return; }
    const ref = numero(servicio.precio_referencial);
    const actual = el('#f-cobrado')?.value;

    caja.innerHTML = `
      <div class="tarifa">
        <div class="tarifa__linea"><span>Tarifa referencial</span><span>${monto(ref)}</span></div>
        <div class="tarifa__linea tarifa__linea--desc oculto" id="f-linea-desc">
          <span id="f-desc-etq">Descuento</span><span id="f-desc-val"></span></div>
        <div class="tarifa__linea tarifa__linea--total"><span>Precio cobrado</span>
          <span id="f-cobrado-eco">${monto(ref)}</span></div>
      </div>
      <label class="campo campo--monto"><span>Precio a cobrar</span>
        <input type="number" id="f-cobrado" inputmode="decimal" step="0.5" min="0"
               value="${actual ?? (reg?.precio_cobrado ?? ref)}"></label>
      <p class="ayuda" style="margin:-10px 0 18px">La tarifa es solo una referencia. Puedes cobrar más o menos.</p>`;

    el('#f-cobrado').addEventListener('input', calcular);
    calcular();
    actualizarTermina();
  }

  // descuento = referencial − cobrado (si es menor)
  // ajuste    = cobrado − referencial (si es mayor)
  // Cobrar por encima NUNCA bloquea el registro.
  function calcular() {
    if (!servicio) return;
    const ref = numero(servicio.precio_referencial);
    const cob = numero(el('#f-cobrado').value);
    const desc = Math.max(0, ref - cob), aju = Math.max(0, cob - ref);
    const linea = el('#f-linea-desc');

    el('#f-cobrado-eco').textContent = monto(cob);
    if (desc > 0)      { linea.classList.remove('oculto'); el('#f-desc-etq').textContent = 'Descuento';
                         el('#f-desc-val').textContent = '−' + monto(desc); }
    else if (aju > 0)  { linea.classList.remove('oculto'); el('#f-desc-etq').textContent = 'Ajuste';
                         el('#f-desc-val').textContent = '+' + monto(aju); }
    else                 linea.classList.add('oculto');

    pintarPago();
  }

  function actualizarTermina() {
    const h = el('#f-hora').value;
    el('#f-termina').textContent = (servicio && h)
      ? `Ingreso ${hora12(h)} · ${servicio.duracion}' → termina ~${hora12(sumarMinutos(h, servicio.duracion))}`
      : '';
  }
  el('#f-hora').addEventListener('input', actualizarTermina);

  // === 4. Masajistas ======================================================
  const bPrincipal = autocompletar({
    contenedor: el('#f-masajista'),
    etiqueta: 'Masajista', requerido: true,
    valorInicial: masajistas[0] || null,
    buscar: D.buscarMasajistas,
    pintar: m => ({ titulo: m.display }),
    alElegir: m => { masajistas[0] = m || undefined; }
  });

  const extras = [];
  function pintarExtras() {
    const caja = el('#f-extras');
    if (!el('#f-varias').checked) { caja.innerHTML = ''; extras.length = 0; masajistas.length = 1; return; }
    if (caja.children.length) return;
    agregarExtra(masajistas[1] || null);
    caja.insertAdjacentHTML('beforeend',
      `<button type="button" class="enlace" id="f-mas">+ Agregar otra</button>`);
    caja.querySelector('#f-mas').onclick = () => {
      agregarExtra(null);
      caja.append(caja.querySelector('#f-mas'));
    };
  }

  function agregarExtra(valor) {
    const caja = el('#f-extras');
    const fila = document.createElement('div');
    fila.style.cssText = 'display:flex;gap:8px;align-items:flex-end';
    const hueco = document.createElement('div'); hueco.style.flex = '1';
    const quitar = document.createElement('button');
    quitar.type = 'button'; quitar.className = 'btn-icono'; quitar.setAttribute('aria-label', 'Quitar');
    quitar.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
    quitar.style.marginBottom = '16px';
    fila.append(hueco, quitar);
    caja.append(fila);

    const idx = extras.length;
    const b = autocompletar({
      contenedor: hueco, etiqueta: `Masajista ${idx + 2}`, valorInicial: valor,
      buscar: D.buscarMasajistas, pintar: m => ({ titulo: m.display }),
      alElegir: m => extras[idx] = m
    });
    extras.push(valor);
    quitar.onclick = () => { extras[idx] = null; fila.remove(); };
  }

  el('#f-varias').checked = masajistas.length > 1;
  el('#f-varias').onchange = pintarExtras;
  pintarExtras();

  // === 5. Forma de pago, dinero recibido y vuelto =========================
  function pintarPago() {
    const caja = el('#f-pago');
    const forma = el('#f-forma')?.value ?? reg?.forma_pago ?? '';
    const recibido = el('#f-recibido')?.value ?? reg?.dinero_recibido ?? '';
    const via = el('#f-vuelto-via')?.value ?? reg?.vuelto_metodo ?? 'efectivo';
    const cobrado = numero(el('#f-cobrado')?.value);

    caja.innerHTML = `
      <label class="campo"><span>Forma de pago</span>
        <select id="f-forma">
          <option value="">Todavía no se registró</option>
          <option value="efectivo" ${forma === 'efectivo' ? 'selected' : ''}>Efectivo</option>
          <option value="tarjeta"  ${forma === 'tarjeta'  ? 'selected' : ''}>Tarjeta</option>
          <option value="yape"     ${forma === 'yape'     ? 'selected' : ''}>Yape</option>
        </select></label>
      ${forma === 'efectivo' ? `
        <label class="campo campo--monto"><span>¿Cuánto entregó el cliente?</span>
          <input type="number" id="f-recibido" inputmode="decimal" step="0.5" min="0" value="${recibido}"></label>
        <div class="tarifa" id="f-vuelto-caja"></div>
        <label class="campo"><span>El vuelto se entrega por</span>
          <select id="f-vuelto-via">
            <option value="efectivo" ${via === 'efectivo' ? 'selected' : ''}>Efectivo</option>
            <option value="yape"     ${via === 'yape'     ? 'selected' : ''}>Yape</option>
          </select></label>
        <p class="ayuda" style="margin:-10px 0 18px">Si devuelves por Yape, la venta sigue contando como efectivo.</p>
      ` : ''}`;

    el('#f-forma').onchange = pintarPago;
    if (forma === 'efectivo') {
      const rec = el('#f-recibido');
      const dibujarVuelto = () => {
        const r = numero(rec.value);
        const v = r - cobrado;
        el('#f-vuelto-caja').innerHTML = r === 0 ? '<div class="tarifa__linea"><span>Vuelto</span><span>—</span></div>'
          : v < 0
            ? `<div class="tarifa__linea tarifa__linea--desc"><span>Falta</span><span>${monto(-v)}</span></div>`
            : `<div class="tarifa__linea"><span>Vuelto</span><span>${monto(v)}</span></div>`;
      };
      rec.addEventListener('input', dibujarVuelto);
      dibujarVuelto();
    }
  }
  pintarPago();

  // === 6. Cliente y motivo ================================================
  const bCliente = autocompletar({
    contenedor: el('#f-cliente'), etiqueta: 'Cliente', valorInicial: cliente,
    autoenfocar: false,
    buscar: D.buscarClientes,
    pintar: c => ({ titulo: (c.vip ? '★ ' : '') + (c.nombre || 'Sin nombre'),
                    nota: c.__nuevo || c.__texto ? 'Nuevo'
                        : c.visitas ? `${c.visitas} visitas` : 'Sin visitas' }),
    alElegir: c => cliente = c,
    permitirCrear: clienteNuevoConAviso,
    textoCrear: 'Nuevo cliente'
  });

  el('#f-motivo').onchange = e =>
    el('#f-motivo-otro-caja').classList.toggle('oculto', e.target.value !== 'Otro');
  if (reg?.motivo_descuento) el('#f-motivo').value = reg.motivo_descuento;

  // === 7. Guardar ==========================================================
  const listaMasajistas = () =>
    [bPrincipal.valor(), ...extras].filter(Boolean).map(m => m.id)
      .filter((id, i, a) => a.indexOf(id) === i);

  function datos(estadoDestino, c) {
    return {
      estado: estadoDestino,
      fecha,
      hora_ingreso: el('#f-hora').value || null,
      servicio_id: servicio?.id || null,
      precio_referencial: servicio ? servicio.precio_referencial : null,
      precio_cobrado: el('#f-cobrado') ? numero(el('#f-cobrado').value) : null,
      cliente_id: c?.id || null,
      cliente_texto: c && !c.id ? (c.nombre || null) : null,
      motivo_descuento: el('#f-motivo').value || null,
      motivo_descuento_texto: el('#f-motivo').value === 'Otro' ? el('#f-motivo-otro').value : null,
      forma_pago: el('#f-forma').value || null,
      dinero_recibido: el('#f-recibido') ? (numero(el('#f-recibido').value) || null) : null,
      vuelto_metodo: el('#f-vuelto-via')?.value || null,
      notas: el('#f-notas').value || null
    };
  }

  async function guardar(destino) {
    const err = el('#f-error');
    err.hidden = true;
    const ms = listaMasajistas();

    if (destino === 'atendido') {
      // Aquí sí se exigen los datos mínimos, con mensajes en lenguaje humano.
      if (!servicio)   return fallo('Falta elegir el masaje y el tiempo.');
      if (!ms.length)  return fallo('Falta elegir la masajista.');
      const cob = numero(el('#f-cobrado').value);
      if (!(cob >= 0)) return fallo('Escribe cuánto se cobró.');
      const forma = el('#f-forma').value;
      if (forma === 'efectivo' && el('#f-recibido').value &&
          numero(el('#f-recibido').value) < cob)
        return fallo('El monto recibido es insuficiente.');

      // Aviso de cruce de horarios: advierte, no bloquea.
      if (el('#f-hora').value && ms.length) {
        try {
          const choques = await D.avisoSolapamiento(ms, fecha, el('#f-hora').value,
                                                    servicio.duracion, reg?.id || null);
          if (choques?.length) {
            const c = choques[0];
            const seguir = await confirmar({
              titulo: 'Horarios cruzados',
              texto: `${c.masajista} ya tiene un masaje de ${hora12(c.desde?.slice(0,5))} a ${hora12(c.hasta?.slice(0,5))}. ¿Lo registro igual?`,
              aceptar: 'Registrar igual'
            });
            if (!seguir) return;
          }
        } catch (_) {}
      }
    }

    const btn = destino === 'atendido' ? el('#f-atendido') : el('#f-reserva');
    btn.disabled = true;
    try {
      // El cliente es OPCIONAL y nunca bloquea el guardado.
      // Si se escribió un nombre y no se eligió de la lista, igual se guarda.
      const c = await resolverCliente(cliente || textoSuelto(bCliente.texto()), destino);
      await D.guardarRegistro(datos(destino, c), ms, reg?.id || null);
      avisar(destino === 'atendido' ? 'Masaje guardado' : 'Reserva guardada', 'exito');
      cerrarHoja();
      alGuardar?.();
    } catch (ex) { fallo(mensajeError(ex)); btn.disabled = false; }
  }

  function fallo(msg) {
    const err = el('#f-error');
    err.textContent = msg; err.hidden = false;
    err.scrollIntoView({ block: 'center', behavior: 'smooth' });
    vibrar([12, 60, 12]);
  }

  el('#f-reserva').onclick  = () => guardar('reserva');
  el('#f-atendido').onclick = () => guardar('atendido');

  // Una reserva no contiene dinero ni afecta ningún cuadre: sí puede borrarse
  // de verdad. Una atención, nunca.
  const borrar = el('#f-borrar');
  if (borrar) borrar.onclick = async () => {
    const ok = await confirmar({
      titulo: 'Borrar reserva', peligro: true, aceptar: 'Borrar',
      texto: 'Se quita de la agenda. No es una venta, así que no afecta la caja.'
    });
    if (!ok) return;
    try {
      await D.borrarRegistro(reg.id);
      avisar('Reserva borrada', 'exito');
      cerrarHoja(); alGuardar?.();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };

  await pintarCombinaciones();
  if (servicio) pintarTarifa();
}

// ---------------------------------------------------------------------------
//  CLIENTE NUEVO
//  Al elegir "+ Nuevo cliente" todavía NO se crea la ficha: se crea al guardar
//  la atención. Así, si el formulario se cancela, no quedan fichas vacías.
//  Si el nombre se parece mucho a alguien que ya existe, se pregunta dentro
//  del mismo campo (abrir otra hoja borraría el formulario a medio llenar).
// ---------------------------------------------------------------------------
export async function clienteNuevoConAviso(texto, parecidos = [], raiz = null) {
  const nombre = (texto || '').trim();
  if (!nombre) return null;
  const casi = (parecidos || []).find(c => c.puntaje > 1.4);
  if (casi && raiz) {
    const esEse = await preguntarEnLinea(raiz, {
      texto: `Ya existe «${casi.nombre}»${casi.visitas ? ` con ${casi.visitas} visitas` : ''}. ¿Es esa persona?`,
      aceptar: 'Sí, es ella', rechazar: 'No, es otra persona'
    });
    if (esEse) return casi;
  }
  return { id: null, nombre, __nuevo: true };
}

// Se mantiene por compatibilidad con otras pantallas.
export const crearClienteConAviso = clienteNuevoConAviso;

const textoSuelto = t => t ? { id: null, nombre: t, __nuevo: true } : null;

const normalizar = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

// Convierte lo que haya en el campo cliente en algo guardable:
//  · cliente con ficha         → se usa tal cual
//  · nombre escrito, RESERVA   → queda como nombre suelto (se vincula al atender)
//  · nombre escrito, ATENCIÓN  → se vincula a la ficha con el mismo nombre
//                                exacto, o se crea una ficha nueva
// Si algo falla, se guarda el nombre suelto: la atención NUNCA se pierde por
// culpa del cliente. Administración puede corregirlo después (Clientes →
// Editar datos / Posibles duplicados, o Corregir en la atención).
async function resolverCliente(c, destino) {
  if (!c) return null;
  if (c.id) return c;
  const nombre = (c.nombre || '').trim();
  if (!nombre) return null;
  if (destino !== 'atendido') return { id: null, nombre };
  try {
    const iguales = (await D.buscarClientes(nombre))
      .filter(x => normalizar(x.nombre) === normalizar(nombre));
    if (iguales.length) return iguales[0];
    const nuevo = await D.crearCliente({ nombre });
    return nuevo;
  } catch (ex) {
    console.error('[Adhamar] No se pudo crear la ficha del cliente', ex);
    return { id: null, nombre };
  }
}
