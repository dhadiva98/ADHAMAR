/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — registro.js
   Registrar un servicio (§5.2) y completar una reserva (§5.3).

   Es el archivo con más reglas del sistema. Las tres que lo gobiernan:

   1. EL PRECIO REFERENCIAL NO OBLIGA. La dueña cobra lo que decida; el
      sistema calcula el descuento o el ajuste y nunca bloquea por eso.
   2. EL ORDEN LO DICTA EL MOSTRADOR, NO LA BASE DE DATOS. El nombre del
      cliente es opcional en el esquema, pero es lo primero que se
      pregunta al atender, así que va arriba (R11).
   3. UNA RESERVA ES UN REGISTRO LEGÍTIMAMENTE INCOMPLETO. Guardar como
      reserva casi no valida nada; marcar como atendido lo valida todo.
   ══════════════════════════════════════════════════════════════════════ */

import { crear, vaciar, esperarUnPoco, traducirError } from './core.js';
import {
  servicios, buscarClientes, crearCliente, buscarMasajistas,
  masajistasDisponibles, guardarRegistro, actualizarRegistro, registro as traerRegistro
} from './datos.js';
import { crearBuscador } from './buscador.js';
import {
  cabeceraVista, campo, casilla, aviso, avisoError, confirmar,
  abrirHoja, esqueleto
} from './ui.js';
import {
  hoy, horaAhora, hora12, horaFin, soles, aNumero, decimales, duracion
} from './formato.js';

export const tablas = ['servicios', 'masajistas'];

const CFG = window.CONFIG_ADHAMAR;
const MEDIOS = [
  { clave: 'efectivo', nombre: 'Efectivo' },
  { clave: 'tarjeta',  nombre: 'Tarjeta' },
  { clave: 'yape',     nombre: 'Yape' }
];
const MOTIVOS = [
  'Cliente frecuente', 'Promoción', 'Cortesía', 'Campaña',
  'Compensación', 'Descuento especial', 'Otro'
];

let catalogo = null;   // servicios activos, en memoria mientras dure la sesión

async function traerCatalogo() {
  if (!catalogo) catalogo = await servicios({ soloActivos: true });
  return catalogo;
}

/* ══════════════════════════════════════════════════════════════════════
   ENTRADAS DEL MÓDULO
   ══════════════════════════════════════════════════════════════════════ */

let contenedor = null;

export async function montar(donde, opciones = {}) {
  contenedor = donde;
  vaciar(donde).appendChild(esqueleto(4));

  const formulario = await construirFormulario({
    fecha: opciones.fecha || hoy(),
    alGuardar: async () => {
      const { irA } = await import('./app.js');
      irA('agenda', { fecha: formulario.fecha() });
    }
  });

  vaciar(donde);
  donde.appendChild(cabeceraVista('Registrar servicio'));
  donde.appendChild(formulario.nodo);
  formulario.enfocar();
}

export function desmontar() {
  contenedor = null;
}

export function refrescar() {
  catalogo = null;   // el tarifario cambió: la próxima vez se vuelve a pedir
}

/**
 * Abre un registro existente en una hoja: una reserva para completarla
 * (§5.3) o una atención para corregirla (§5.11, solo Administrador).
 * Es el mismo formulario; cambian los rótulos y las validaciones.
 */
export async function completarReserva(id, { alGuardar = null } = {}) {
  const existente = await traerRegistro(id);

  const formulario = await construirFormulario({
    fecha: existente.fecha,
    existente,
    alGuardar: async () => { cerrar(); await alGuardar?.(); }
  });

  const { cerrar } = abrirHoja({
    titulo: existente.estado === 'reserva' ? 'Completar reserva' : 'Corregir servicio',
    contenido: formulario.nodo
  });
}

/** Mismo formulario, nombre honesto para lo que hace historial.js. */
export const editarRegistro = completarReserva;

/* ══════════════════════════════════════════════════════════════════════
   EL FORMULARIO
   ══════════════════════════════════════════════════════════════════════ */

async function construirFormulario({ fecha, existente = null, alGuardar = null }) {
  const lista = await traerCatalogo();
  const familias = agruparPorMasaje(lista);

  /* Estado del formulario. Nada aquí es fuente de verdad: es lo que la
     usuaria lleva escrito hasta que el servidor confirme. */
  const f = {
    fecha,
    servicio: null,          // fila completa de servicios
    familia: null,           // nombre del masaje elegido
    precioCobrado: null,
    mixto: false,
    medioSimple: null,
    montos: { efectivo: null, tarjeta: null, yape: null },
    recibido: null,
    vueltoMetodo: 'efectivo'
  };

  const nodo = crear('form', { atributos: { novalidate: 'true' } });
  nodo.addEventListener('submit', (e) => e.preventDefault());

  /* ── 1. CLIENTE ────────────────────────────────────────────────────────
     Arriba, porque es lo primero que se pregunta en el mostrador. */

  const busCliente = crearBuscador({
    etiqueta: 'Cliente',
    marcador: 'Nombre o apodo (opcional)',
    ayuda: 'Puedes dejarlo vacío y completarlo después.',
    buscar: (texto) => buscarClientes(texto, 8).then(
      (filas) => filas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        dato: c.visitas ? `${c.visitas} ${c.visitas === 1 ? 'visita' : 'visitas'}` : 'sin visitas',
        similitud: c.similitud
      }))
    ),
    permitirCrear: true,
    alCrear: crearClienteConAviso
  });
  nodo.appendChild(busCliente.campo);

  /* ── 2. MASAJE, MODALIDAD Y TIEMPO (selección progresiva) ───────────── */

  const busMasaje = crearBuscador({
    etiqueta: 'Masaje',
    marcador: 'Escribe las primeras letras',
    buscar: (texto) => Promise.resolve(
      familias
        .filter((fam) => coincideFamilia(fam.masaje, texto))
        .map((fam) => ({ id: fam.masaje, nombre: fam.masaje, dato: `${fam.filas.length} opciones` }))
    ),
    alElegir: (item) => elegirFamilia(item?.id || null)
  });
  nodo.appendChild(busMasaje.campo);

  const cajaCombinaciones = crear('div', { atributos: { style: 'margin-bottom:18px' } });
  nodo.appendChild(cajaCombinaciones);

  /* ── 3. TARIFA Y PRECIO A COBRAR ───────────────────────────────────── */

  const cajaPrecio = crear('div', { clase: 'tarjeta', atributos: { hidden: '' } });

  const lineaReferencial = crear('div', { clase: 'linea-calculo' });
  lineaReferencial.append(
    crear('span', { texto: 'Tarifa referencial' }),
    crear('span', { clase: 'monto', texto: '—' })
  );

  const { campo: campoPrecio, entrada: entradaPrecio } = campo('Precio a cobrar', {
    tipo: 'text',
    atributos: { inputmode: 'decimal', class: 'entrada-monto' }
  });
  entradaPrecio.classList.add('entrada-monto');

  const lineaDiferencia = crear('div', { clase: 'linea-calculo' });
  lineaDiferencia.append(
    crear('span', { texto: 'Descuento' }),
    crear('span', { clase: 'monto', texto: soles(0) })
  );

  cajaPrecio.append(lineaReferencial, campoPrecio, lineaDiferencia);
  nodo.appendChild(cajaPrecio);

  entradaPrecio.addEventListener('input', () => {
    f.precioCobrado = aNumero(entradaPrecio.value);
    pintarDiferencia();
    pintarPagos();
  });

  /* ── 4. HORA DE INGRESO ────────────────────────────────────────────── */

  const { campo: campoHora, entrada: entradaHora } = campo('Hora de ingreso', {
    tipo: 'time',
    valor: (existente?.hora_ingreso || horaAhora()).slice(0, 5)
  });
  const notaHora = crear('span', { clase: 'campo-ayuda' });
  campoHora.appendChild(notaHora);
  nodo.appendChild(campoHora);

  entradaHora.addEventListener('input', () => { pintarHoraFin(); pedirDisponibilidad(); });

  /* ── 5. MASAJISTAS ─────────────────────────────────────────────────── */

  const busMasajista1 = crearBuscador({
    etiqueta: 'Srta. que atiende',
    marcador: 'Escribe su nombre',
    buscar: buscarActivas,
    alElegir: pedirDisponibilidad
  });
  nodo.appendChild(busMasajista1.campo);

  const { casilla: casillaDos, entrada: entradaDos } = casilla('Más de una srta.', false);
  nodo.appendChild(casillaDos);

  const busMasajista2 = crearBuscador({
    etiqueta: 'Segunda srta.',
    marcador: 'Escribe su nombre',
    buscar: buscarActivas
  });
  busMasajista2.campo.hidden = true;
  nodo.appendChild(busMasajista2.campo);

  entradaDos.addEventListener('change', () => {
    busMasajista2.campo.hidden = !entradaDos.checked;
    if (!entradaDos.checked) busMasajista2.limpiar();
  });

  /* ── 6. LÍNEA DE DISPONIBILIDAD ────────────────────────────────────── */

  const lineaDisponibles = crear('p', {
    clase: 'campo-ayuda',
    atributos: { style: 'margin:-8px 0 18px' }
  });
  nodo.appendChild(lineaDisponibles);

  /* ── 7. FORMA DE PAGO ──────────────────────────────────────────────── */

  nodo.appendChild(crear('p', { clase: 'campo-etiqueta', texto: 'Forma de pago' }));

  const opcionesMedio = crear('div', { clase: 'opciones', atributos: { style: 'margin-bottom:14px' } });
  MEDIOS.forEach((m) => {
    opcionesMedio.appendChild(crear('button', {
      clase: 'opcion',
      texto: m.nombre,
      atributos: { type: 'button', 'aria-pressed': 'false' },
      datos: { medio: m.clave },
      al: {
        click: (e) => {
          f.medioSimple = (f.medioSimple === m.clave) ? null : m.clave;
          Array.from(opcionesMedio.children).forEach((b) => {
            b.setAttribute('aria-pressed', b.dataset.medio === f.medioSimple ? 'true' : 'false');
          });
          pintarEfectivo();
        }
      }
    }));
  });
  nodo.appendChild(opcionesMedio);

  const { casilla: casillaMixto, entrada: entradaMixto } = casilla('Pago mixto (varios medios)', false);
  nodo.appendChild(casillaMixto);

  const cajaMixto = crear('div', { clase: 'tarjeta', atributos: { hidden: '' } });
  const entradasMonto = {};
  MEDIOS.forEach((m) => {
    const { campo: c, entrada } = campo(m.nombre, {
      tipo: 'text', atributos: { inputmode: 'decimal' }
    });
    entrada.classList.add('entrada-monto');
    entrada.addEventListener('input', () => {
      f.montos[m.clave] = aNumero(entrada.value);
      pintarPagos();
      pintarEfectivo();
    });
    entradasMonto[m.clave] = entrada;
    cajaMixto.appendChild(c);
  });

  const lineaAsignado = crear('div', { clase: 'linea-calculo linea-calculo-total' });
  lineaAsignado.append(crear('span', { texto: 'Asignado' }), crear('span', { clase: 'monto', texto: soles(0) }));
  cajaMixto.appendChild(lineaAsignado);

  const avisoAsignado = crear('p', { clase: 'campo-ayuda' });
  cajaMixto.appendChild(avisoAsignado);

  cajaMixto.appendChild(crear('button', {
    clase: 'boton-enlace',
    texto: 'Completar con el resto',
    atributos: { type: 'button' },
    al: { click: completarConElResto }
  }));

  nodo.appendChild(cajaMixto);

  entradaMixto.addEventListener('change', () => {
    f.mixto = entradaMixto.checked;
    cajaMixto.hidden = !f.mixto;
    opcionesMedio.hidden = f.mixto;
    if (!f.mixto) MEDIOS.forEach((m) => { entradasMonto[m.clave].value = ''; f.montos[m.clave] = null; });
    else f.medioSimple = null;
    Array.from(opcionesMedio.children).forEach((b) => b.setAttribute('aria-pressed', 'false'));
    pintarPagos();
    pintarEfectivo();
  });

  /* ── 8. EFECTIVO RECIBIDO Y VUELTO ─────────────────────────────────── */

  const cajaEfectivo = crear('div', { clase: 'tarjeta', atributos: { hidden: '' } });

  const { campo: campoRecibido, entrada: entradaRecibido } = campo('¿Cuánto entregó el cliente?', {
    tipo: 'text', atributos: { inputmode: 'decimal' }
  });
  entradaRecibido.classList.add('entrada-monto');
  cajaEfectivo.appendChild(campoRecibido);

  const lineaVuelto = crear('div', { clase: 'linea-calculo' });
  lineaVuelto.append(crear('span', { texto: 'Vuelto' }), crear('span', { clase: 'monto', texto: '—' }));
  cajaEfectivo.appendChild(lineaVuelto);

  const avisoRecibido = crear('p', { clase: 'campo-ayuda' });
  cajaEfectivo.appendChild(avisoRecibido);

  const cajaVueltoPor = crear('div', { atributos: { hidden: '' } });
  cajaVueltoPor.appendChild(crear('p', { clase: 'campo-etiqueta', texto: 'Vuelto entregado por' }));
  const opcionesVuelto = crear('div', { clase: 'opciones' });
  [{ clave: 'efectivo', nombre: 'Efectivo' }, { clave: 'yape', nombre: 'Yape' }].forEach((m) => {
    opcionesVuelto.appendChild(crear('button', {
      clase: 'opcion',
      texto: m.nombre,
      atributos: { type: 'button', 'aria-pressed': m.clave === 'efectivo' ? 'true' : 'false' },
      datos: { vuelto: m.clave },
      al: {
        click: () => {
          f.vueltoMetodo = m.clave;
          Array.from(opcionesVuelto.children).forEach((b) => {
            b.setAttribute('aria-pressed', b.dataset.vuelto === m.clave ? 'true' : 'false');
          });
        }
      }
    }));
  });
  cajaVueltoPor.appendChild(opcionesVuelto);
  cajaVueltoPor.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'Si devuelves el vuelto por Yape, ese dinero no cuenta como venta por Yape: salió después de una venta en efectivo.'
  }));
  cajaEfectivo.appendChild(cajaVueltoPor);

  entradaRecibido.addEventListener('input', () => {
    f.recibido = aNumero(entradaRecibido.value);
    pintarEfectivo();
  });

  nodo.appendChild(cajaEfectivo);

  /* ── 9. MOTIVO DEL DESCUENTO Y NOTAS ───────────────────────────────── */

  const cajaMotivo = crear('label', { clase: 'campo', atributos: { hidden: '' } });
  cajaMotivo.appendChild(crear('span', { clase: 'campo-etiqueta', texto: 'Motivo del descuento (opcional)' }));
  const selectMotivo = crear('select');
  selectMotivo.appendChild(crear('option', { texto: 'Sin especificar', atributos: { value: '' } }));
  MOTIVOS.forEach((m) => selectMotivo.appendChild(crear('option', { texto: m, atributos: { value: m } })));
  cajaMotivo.appendChild(selectMotivo);

  const { campo: campoMotivoTexto, entrada: entradaMotivoTexto } = campo('¿Cuál?', { tipo: 'text' });
  campoMotivoTexto.hidden = true;
  selectMotivo.addEventListener('change', () => {
    campoMotivoTexto.hidden = selectMotivo.value !== 'Otro';
  });
  cajaMotivo.appendChild(campoMotivoTexto);
  nodo.appendChild(cajaMotivo);

  const { campo: campoNotas, entrada: entradaNotas } = campo('Nota interna (opcional)', {
    multilinea: true,
    ayuda: 'Solo la ve el equipo. No aparece en nada que se entregue al cliente.'
  });
  nodo.appendChild(campoNotas);

  /* ── 10. BOTONES ───────────────────────────────────────────────────── */

  const acciones = crear('div', { clase: 'dialogo-acciones' });

  const corrigiendo = existente?.estado === 'atendido';

  const botonReserva = crear('button', {
    clase: 'boton-secundario',
    texto: existente ? 'Guardar cambios' : 'Guardar como reserva',
    atributos: { type: 'button' },
    al: { click: () => enviar('reserva') }
  });
  // Corrigiendo una atención no tiene sentido "guardar como reserva":
  // devolvería una venta ya cobrada al estado de pendiente.
  botonReserva.hidden = corrigiendo;

  const botonAtendido = crear('button', {
    clase: 'boton-primario',
    texto: corrigiendo ? 'Guardar cambios' : (existente ? 'Marcar como atendido' : 'Guardar masaje'),
    atributos: { type: 'button' },
    al: { click: () => enviar('atendido') }
  });

  acciones.append(botonReserva, botonAtendido);
  nodo.appendChild(acciones);

  /* ══════════════════════════════════════════════════════════════════
     COMPORTAMIENTO
     ══════════════════════════════════════════════════════════════════ */

  function elegirFamilia(nombre) {
    f.familia = nombre;
    f.servicio = null;
    vaciar(cajaCombinaciones);
    cajaPrecio.hidden = true;

    if (!nombre) { pintarDisponibilidad(null); return; }

    const familia = familias.find((x) => x.masaje === nombre);
    if (!familia) return;

    cajaCombinaciones.appendChild(crear('p', { clase: 'campo-etiqueta', texto: 'Modalidad y tiempo' }));

    /* Solo las combinaciones QUE EXISTEN. Nada de opciones deshabilitadas
       ni celdas en cero: lo que no se ofrece, no se muestra (§5.6). */
    agruparPorModalidad(familia.filas).forEach(({ modalidad, filas, terapeutas }) => {
      const bloque = crear('div', { atributos: { style: 'margin-bottom:12px' } });
      const titulo = terapeutas === 2 ? `${modalidad} · 2 srtas.` : modalidad;
      bloque.appendChild(crear('p', { clase: 'campo-ayuda', texto: titulo }));

      const botones = crear('div', { clase: 'opciones' });
      filas.forEach((fila) => {
        const boton = crear('button', {
          clase: 'opcion',
          atributos: { type: 'button', 'aria-pressed': 'false' },
          datos: { servicio: fila.id }
        });
        boton.appendChild(crear('span', { texto: duracion(fila.duracion) }));
        boton.appendChild(crear('span', { clase: 'opcion-precio', texto: soles(fila.precio_referencial) }));
        boton.addEventListener('click', () => elegirServicio(fila));
        botones.appendChild(boton);
      });
      bloque.appendChild(botones);
      cajaCombinaciones.appendChild(bloque);
    });
  }

  function elegirServicio(fila) {
    f.servicio = fila;

    cajaCombinaciones.querySelectorAll('[data-servicio]').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.servicio === String(fila.id) ? 'true' : 'false');
    });

    /* La tarifa aparece DESPUÉS de elegir, y siempre etiquetada como
       referencial. Nunca como "precio final" (§5.2). */
    lineaReferencial.lastChild.textContent = soles(fila.precio_referencial);
    cajaPrecio.hidden = false;

    // El precio a cobrar se precarga igual al referencial, y es editable
    if (f.precioCobrado === null || !entradaPrecio.value) {
      f.precioCobrado = Number(fila.precio_referencial);
      entradaPrecio.value = decimales(fila.precio_referencial);
    }

    // Modalidad de dos srtas.: se marca sola la casilla (§5.2)
    if (Number(fila.terapeutas_requeridas) === 2 && !entradaDos.checked) {
      entradaDos.checked = true;
      entradaDos.dispatchEvent(new Event('change'));
    }

    pintarDiferencia();
    pintarHoraFin();
    pintarPagos();
    pintarEfectivo();
    pedirDisponibilidad();
  }

  function pintarDiferencia() {
    const referencial = Number(f.servicio?.precio_referencial ?? 0);
    const cobrado = Number(f.precioCobrado ?? referencial);
    const descuento = Math.max(0, referencial - cobrado);
    const ajuste = Math.max(0, cobrado - referencial);

    const etiqueta = lineaDiferencia.firstChild;
    const valor = lineaDiferencia.lastChild;

    if (ajuste > 0) {
      etiqueta.textContent = 'Ajuste';
      valor.textContent = soles(ajuste, { signo: true });
      valor.style.color = 'var(--bronce-texto)';
    } else {
      etiqueta.textContent = 'Descuento';
      valor.textContent = descuento > 0 ? `−${soles(descuento)}` : soles(0);
      valor.style.color = descuento > 0 ? 'var(--bronce-texto)' : '';
    }

    // El motivo solo tiene sentido si hubo descuento
    cajaMotivo.hidden = descuento <= 0;
  }

  function pintarHoraFin() {
    const hora = entradaHora.value;
    const minutos = f.servicio?.duracion;
    if (hora && minutos) {
      notaHora.textContent = `${hora12(`${hora}:00`)} · ${duracion(minutos)} → termina ~${horaFin(`${hora}:00`, minutos)}`;
    } else if (hora) {
      notaHora.textContent = hora12(`${hora}:00`);
    } else {
      notaHora.textContent = '';
    }
  }

  /* Porción del cobro que entra físicamente como efectivo. En pago simple
     es todo el precio; en pago mixto, solo lo asignado a efectivo. */
  function porcionEfectivo() {
    if (f.mixto) return Number(f.montos.efectivo || 0);
    return f.medioSimple === 'efectivo' ? Number(f.precioCobrado || 0) : 0;
  }

  function pintarPagos() {
    if (!f.mixto) return;
    const total = Number(f.precioCobrado || 0);
    const asignado = MEDIOS.reduce((s, m) => s + Number(f.montos[m.clave] || 0), 0);
    lineaAsignado.lastChild.textContent = soles(asignado);

    const resto = +(total - asignado).toFixed(2);
    if (Math.abs(resto) < 0.005) {
      avisoAsignado.textContent = 'Asignado completo ✓';
      avisoAsignado.classList.remove('texto-error');
    } else if (resto > 0) {
      avisoAsignado.textContent = `Falta asignar ${soles(resto)}`;
      avisoAsignado.classList.remove('texto-error');
    } else {
      avisoAsignado.textContent = `Te pasaste por ${soles(Math.abs(resto))}`;
      avisoAsignado.classList.add('texto-error');
    }
  }

  function completarConElResto() {
    const total = Number(f.precioCobrado || 0);
    const asignado = MEDIOS.reduce((s, m) => s + Number(f.montos[m.clave] || 0), 0);
    const resto = +(total - asignado).toFixed(2);
    if (resto <= 0) return;

    // Se completa en el primer medio que esté vacío
    const medio = MEDIOS.find((m) => !f.montos[m.clave]) || MEDIOS[0];
    f.montos[medio.clave] = +(Number(f.montos[medio.clave] || 0) + resto).toFixed(2);
    entradasMonto[medio.clave].value = decimales(f.montos[medio.clave]);
    pintarPagos();
    pintarEfectivo();
  }

  function pintarEfectivo() {
    const efectivo = porcionEfectivo();

    /* Tarjeta y Yape puros: no se pregunta cuánto entregó ni hay vuelto. */
    cajaEfectivo.hidden = efectivo <= 0;
    if (efectivo <= 0) return;

    const recibido = Number(f.recibido || 0);
    const vuelto = +(recibido - efectivo).toFixed(2);

    if (!f.recibido) {
      lineaVuelto.lastChild.textContent = '—';
      avisoRecibido.textContent = '';
      cajaVueltoPor.hidden = true;
      return;
    }

    if (vuelto < 0) {
      lineaVuelto.lastChild.textContent = '—';
      avisoRecibido.textContent = 'El monto recibido es insuficiente.';
      avisoRecibido.classList.add('texto-error');
      cajaVueltoPor.hidden = true;
      return;
    }

    avisoRecibido.textContent = '';
    avisoRecibido.classList.remove('texto-error');
    lineaVuelto.lastChild.textContent = soles(vuelto);
    cajaVueltoPor.hidden = vuelto <= 0;
  }

  /* ── Disponibilidad, en vivo ──────────────────────────────────────── */

  const pedirDisponibilidad = esperarUnPoco(async () => {
    const hora = entradaHora.value;
    if (!hora) { pintarDisponibilidad(null); return; }

    /* Sin servicio elegido no se conoce la duración: se usa la
       predeterminada y se ROTULA COMO ESTIMADA. Decir "ocupada hasta las
       8:08" cuando nadie lo sabe no es honesto (§5.2). */
    const minutos = f.servicio?.duracion || CFG.duracionPorDefecto || 60;
    const estimada = !f.servicio;

    if (f.fecha > hoy()) {
      pintarDisponibilidad({ futuro: true });
      return;
    }

    try {
      const filas = await masajistasDisponibles(f.fecha, `${hora}:00`, minutos);
      pintarDisponibilidad({ filas, minutos, estimada, hora });
    } catch (e) {
      pintarDisponibilidad(null);
    }
  }, 350);

  function pintarDisponibilidad(datos) {
    if (!datos) { lineaDisponibles.textContent = ''; return; }

    if (datos.futuro) {
      lineaDisponibles.textContent = 'Para fechas futuras se muestran todas las srtas. activas.';
      return;
    }

    const libres = datos.filas.filter((m) => m.disponible).map((m) => m.nombre);
    const ocupadas = datos.filas.filter((m) => !m.disponible).map((m) => {
      const hasta = m.ocupada_hasta ? hora12(m.ocupada_hasta) : null;
      if (!hasta) return m.nombre;
      return m.duracion_estimada
        ? `${m.nombre} (posiblemente hasta ~${hasta})`
        : `${m.nombre} (hasta ${hasta})`;
    });

    const ventana = `${hora12(`${datos.hora}:00`)} – ${horaFin(`${datos.hora}:00`, datos.minutos)}`;
    const partes = [];
    partes.push(`Disponibles ${ventana}${datos.estimada ? ' (duración estimada)' : ''}: ${libres.join(' · ') || 'ninguna'}`);
    if (ocupadas.length) partes.push(`Ocupadas: ${ocupadas.join(' · ')}`);
    lineaDisponibles.textContent = partes.join('  ·  ');
  }

  /* ── Crear cliente con aviso de posible duplicado (§5.5) ──────────── */

  async function crearClienteConAviso(texto) {
    const parecidos = await buscarClientes(texto, 3).catch(() => []);
    const candidato = parecidos.find((c) => Number(c.similitud ?? 0) > 0.6);

    if (candidato) {
      const esElMismo = await confirmar({
        titulo: `¿Te refieres a ${candidato.nombre}?`,
        texto: candidato.visitas
          ? `Ya existe con ${candidato.visitas} ${candidato.visitas === 1 ? 'visita' : 'visitas'} registradas.`
          : 'Ya existe un cliente con un nombre muy parecido.',
        aceptar: 'Sí, es este cliente',
        cancelar: 'No, crear uno nuevo'
      });
      if (esElMismo) return { id: candidato.id, nombre: candidato.nombre };
    }

    try {
      const nuevo = await crearCliente({ nombre: texto });
      aviso(`Cliente "${nuevo.nombre}" creado`);
      return { id: nuevo.id, nombre: nuevo.nombre };
    } catch (e) {
      avisoError(e.amable ? e.message : traducirError(e));
      return null;
    }
  }

  /* ── Recuperar una reserva existente (R12) ────────────────────────── */

  if (existente) volcar(existente);

  function volcar(r) {
    /* Todo lo que se guardó tiene que volver a leerse. El nombre suelto
       incluido: perder lo ya escrito al reabrir es de los fallos más
       irritantes posibles. */
    if (r.cliente?.id) busCliente.fijar({ id: r.cliente.id, nombre: r.cliente.nombre });
    else if (r.cliente_texto) busCliente.fijarTexto(r.cliente_texto);

    if (r.servicio?.id) {
      busMasaje.fijar({ id: r.servicio.masaje, nombre: r.servicio.masaje });
      elegirFamilia(r.servicio.masaje);
      const fila = catalogo.find((s) => s.id === r.servicio.id) || r.servicio;
      elegirServicio(fila);
    }

    if (r.precio_cobrado !== null && r.precio_cobrado !== undefined) {
      f.precioCobrado = Number(r.precio_cobrado);
      entradaPrecio.value = decimales(r.precio_cobrado);
    }

    if (r.hora_ingreso) entradaHora.value = String(r.hora_ingreso).slice(0, 5);

    const [m1, m2] = r.masajistas || [];
    if (m1?.id) busMasajista1.fijar({ id: m1.id, nombre: m1.nombre });
    if (m2?.id) {
      entradaDos.checked = true;
      entradaDos.dispatchEvent(new Event('change'));
      busMasajista2.fijar({ id: m2.id, nombre: m2.nombre });
    }

    const medios = Object.entries(r.pagos || {});
    if (medios.length > 1) {
      entradaMixto.checked = true;
      entradaMixto.dispatchEvent(new Event('change'));
      medios.forEach(([medio, monto]) => {
        f.montos[medio] = Number(monto);
        entradasMonto[medio].value = decimales(monto);
      });
    } else if (medios.length === 1) {
      f.medioSimple = medios[0][0];
      Array.from(opcionesMedio.children).forEach((b) => {
        b.setAttribute('aria-pressed', b.dataset.medio === f.medioSimple ? 'true' : 'false');
      });
    }

    if (r.dinero_recibido) {
      f.recibido = Number(r.dinero_recibido);
      entradaRecibido.value = decimales(r.dinero_recibido);
    }
    if (r.vuelto_metodo) {
      f.vueltoMetodo = r.vuelto_metodo;
      Array.from(opcionesVuelto.children).forEach((b) => {
        b.setAttribute('aria-pressed', b.dataset.vuelto === r.vuelto_metodo ? 'true' : 'false');
      });
    }
    if (r.motivo_descuento) selectMotivo.value = r.motivo_descuento;
    if (r.motivo_descuento_texto) {
      campoMotivoTexto.hidden = false;
      entradaMotivoTexto.value = r.motivo_descuento_texto;
    }
    if (r.notas) entradaNotas.value = r.notas;

    pintarDiferencia();
    pintarHoraFin();
    pintarPagos();
    pintarEfectivo();
    pedirDisponibilidad();
  }

  /* ── Armar el paquete y validarlo ─────────────────────────────────── */

  function armarDatos(estadoDestino) {
    const cliente = busCliente.obtener();
    const uno = busMasajista1.obtener();
    const dos = entradaDos.checked ? busMasajista2.obtener() : { id: null };

    const pagos = f.mixto
      ? MEDIOS.filter((m) => Number(f.montos[m.clave]) > 0)
              .map((m) => ({ metodo: m.clave, monto: Number(f.montos[m.clave]) }))
      : (f.medioSimple && f.precioCobrado
          ? [{ metodo: f.medioSimple, monto: Number(f.precioCobrado) }]
          : []);

    const efectivo = porcionEfectivo();
    const vuelto = (efectivo > 0 && f.recibido) ? +(Number(f.recibido) - efectivo).toFixed(2) : null;

    return {
      estado: estadoDestino,
      fecha: f.fecha,
      hora_ingreso: entradaHora.value ? `${entradaHora.value}:00` : null,
      servicio_id: f.servicio?.id || null,
      // Copia histórica del referencial: este sí se congela para siempre (§4)
      precio_referencial: f.servicio ? Number(f.servicio.precio_referencial) : null,
      precio_cobrado: f.precioCobrado,
      cliente_id: cliente.id,
      cliente_texto: cliente.id ? null : (cliente.texto || null),
      masajistas: [uno.id, dos.id].filter(Boolean),
      pagos,
      dinero_recibido: efectivo > 0 ? f.recibido : null,
      vuelto,
      vuelto_metodo: (vuelto && vuelto > 0) ? f.vueltoMetodo : null,
      motivo_descuento: selectMotivo.value || null,
      motivo_descuento_texto: selectMotivo.value === 'Otro' ? (entradaMotivoTexto.value.trim() || null) : null,
      notas: entradaNotas.value.trim() || null
    };
  }

  function validar(datos) {
    const cliente = busCliente.obtener();

    /* RESERVA: casi todo opcional. Basta un dato identificable. */
    if (datos.estado === 'reserva') {
      const hayAlgo = cliente.texto || datos.hora_ingreso || datos.masajistas.length || datos.servicio_id;
      if (!hayAlgo) {
        return { ok: false, mensaje: 'Anota al menos un dato: un nombre, una hora o la srta. que atenderá.' };
      }
      // Una masajista escrita a mano que no existe no se puede guardar
      if (busMasajista1.entrada.value.trim() && !busMasajista1.resuelto()) {
        busMasajista1.marcarFalta('Elige a la srta. de la lista de sugerencias.');
        return { ok: false, mensaje: 'La srta. tiene que elegirse de la lista.' };
      }
      return { ok: true };
    }

    /* ATENDIDO: ahí sí se exige todo. */
    if (!datos.servicio_id) {
      return { ok: false, mensaje: 'Falta elegir el masaje, la modalidad y el tiempo.' };
    }
    if (!datos.masajistas.length) {
      busMasajista1.marcarFalta('Falta elegir la srta. que atendió.');
      return { ok: false, mensaje: 'Falta elegir la srta. que atendió.' };
    }
    if (entradaDos.checked && !busMasajista2.resuelto()) {
      busMasajista2.marcarFalta('Elige a la segunda srta. de la lista.');
      return { ok: false, mensaje: 'Falta elegir la segunda srta.' };
    }
    if (datos.masajistas.length === 2 && datos.masajistas[0] === datos.masajistas[1]) {
      return { ok: false, mensaje: 'No puedes elegir dos veces a la misma srta.' };
    }
    if (datos.precio_cobrado === null || datos.precio_cobrado < 0) {
      return { ok: false, mensaje: 'Escribe cuánto se cobró. Puede ser distinto de la tarifa referencial.' };
    }

    /* La forma de pago NO es requisito para atendido: puede quedar como
       "no registrado". Pero si se asignaron montos, tienen que cuadrar. */
    if (datos.pagos.length) {
      const suma = datos.pagos.reduce((s, p) => s + p.monto, 0);
      const resto = +(datos.precio_cobrado - suma).toFixed(2);
      if (Math.abs(resto) >= 0.005) {
        return {
          ok: false,
          mensaje: resto > 0
            ? `Falta asignar ${soles(resto)} entre las formas de pago.`
            : `Las formas de pago suman ${soles(Math.abs(resto))} de más.`
        };
      }
    }

    if (porcionEfectivo() > 0 && f.recibido && Number(f.recibido) < porcionEfectivo()) {
      return { ok: false, mensaje: 'El monto recibido es insuficiente.' };
    }

    return { ok: true };
  }

  async function enviar(estadoDestino) {
    /* Conversión a cliente (§5.3): al marcar como atendido, un nombre que
       quedó suelto en la reserva se convierte en ficha y se vincula, para
       que empiece a acumular visitas e historial. La detección de
       duplicados corre antes, dentro de crearClienteConAviso. */
    if (estadoDestino === 'atendido') {
      const cliente = busCliente.obtener();
      if (!cliente.id && cliente.texto) {
        const creado = await crearClienteConAviso(cliente.texto);
        if (creado) busCliente.fijar(creado);
        // Si no se pudo crear, se sigue igual: el nombre suelto se conserva
        // y la venta no se pierde por no haber podido crear una ficha.
      }
    }

    const datos = armarDatos(estadoDestino);
    const revision = validar(datos);

    if (!revision.ok) { avisoError(revision.mensaje); return; }

    /* Si eligió a alguien ocupada, se advierte con claridad pero se deja
       guardar: la línea de disponibilidad informa, nunca bloquea. */
    botonReserva.disabled = true;
    botonAtendido.disabled = true;
    const textoPrevio = botonAtendido.textContent;
    botonAtendido.textContent = 'Guardando…';

    try {
      if (existente) await actualizarRegistro(existente.id, datos);
      else await guardarRegistro(datos);

      aviso(corrigiendo ? 'Cambios guardados'
        : (estadoDestino === 'atendido' ? 'Masaje guardado' : 'Reserva guardada'));
      await alGuardar?.();
    } catch (e) {
      avisoError(e.amable ? e.message : traducirError(e));
    } finally {
      botonReserva.disabled = false;
      botonAtendido.disabled = false;
      botonAtendido.textContent = textoPrevio;
    }
  }

  /* Arranque del formulario */
  pintarHoraFin();
  pedirDisponibilidad();

  return {
    nodo,
    fecha: () => f.fecha,
    enfocar: () => busCliente.enfocar()
  };
}

/* ══════════════════════════════════════════════════════════════════════
   AYUDAS
   ══════════════════════════════════════════════════════════════════════ */

function agruparPorMasaje(filas) {
  const mapa = new Map();
  filas.forEach((s) => {
    if (!mapa.has(s.masaje)) mapa.set(s.masaje, []);
    mapa.get(s.masaje).push(s);
  });
  return Array.from(mapa.entries()).map(([masaje, filas_]) => ({ masaje, filas: filas_ }));
}

function agruparPorModalidad(filas) {
  const mapa = new Map();
  filas.forEach((s) => {
    if (!mapa.has(s.modalidad)) {
      mapa.set(s.modalidad, { modalidad: s.modalidad, filas: [], terapeutas: s.terapeutas_requeridas || 1 });
    }
    mapa.get(s.modalidad).filas.push(s);
  });
  return Array.from(mapa.values()).map((g) => ({
    ...g,
    filas: g.filas.sort((a, b) => a.duracion - b.duracion)
  }));
}

/** Coincidencia local, sin tildes y por cualquier palabra: "egi" → Egipcio. */
function coincideFamilia(nombre, texto) {
  const limpiar = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return limpiar(nombre).includes(limpiar(texto).trim());
}

/** Solo masajistas Activas. La misma restricción está en la base. */
function buscarActivas(texto) {
  return buscarMasajistas(texto).then(
    (filas) => filas.map((m) => ({
      id: m.id,
      nombre: [m.nombre, m.apellido].filter(Boolean).join(' '),
      dato: m.especialidades || ''
    }))
  );
}
