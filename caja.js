/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — caja.js
   Resumen del día y cierre diario (§5.12). Solo Administrador.

   Las cuatro reglas de dinero que gobiernan este archivo:

   1. La caja usa SIEMPRE precio_cobrado, nunca el referencial, y solo
      cuenta registros 'atendido'. Reservas y cancelados quedan fuera.
   2. El fondo inicial NO ES UNA VENTA. Va aparte, nunca sumado a las
      ventas del día.
   3. Efectivo esperado = fondo inicial + ventas en efectivo − vuelto
      entregado EN EFECTIVO. El vuelto por Yape no se resta, porque ese
      dinero nunca salió físicamente de la caja.
   4. El sistema AVISA, NO OBSTACULIZA. Se puede cerrar con reservas sin
      completar, con pagos sin registrar y con una diferencia sin
      justificar. Nunca se obliga a inventar un motivo.

   ─────────────────────────────────────────────────────────────────────
   Forma que debe devolver resumen_dia(p_fecha) (contrato con el SQL):

     { total_servicios, reservas_pendientes, atenciones_sin_pago,
       ventas_referenciales, descuentos, ventas_reales, ticket_promedio,
       efectivo, tarjeta, yape,
       vuelto_efectivo, vuelto_yape,
       fondo_inicial, efectivo_esperado,
       cierre: { id, hora_cierre, efectivo_contado, monto_retirado,
                 caja_fija_siguiente, diferencia, diferencia_justificada,
                 estado, reabierto, modificado_en } | null }
   ────────────────────────────────────────────────────────────────────── */

import { crear, vaciar, traducirError } from './core.js';
import {
  resumenDia, guardarFondoInicial, cerrarDia, reabrirDia,
  ajustesCierre, agregarAjuste
} from './datos.js';
import {
  cabeceraVista, lineaCalculo, esqueleto, vacio, confirmar,
  aviso, avisoError, campo, celda, abrirHoja
} from './ui.js';
import { hoy, sumarDias, fechaLarga, fechaCorta, fechaHora, soles, aNumero, decimales, plural } from './formato.js';

export const tablas = ['registros_servicios', 'pagos_registro', 'cierres_diarios'];

let contenedor = null;
let seccion = 'caja';
let fecha = hoy();
let datos = null;

/* ══════════════════════════════════════════════════════════════════════
   MONTAJE
   ══════════════════════════════════════════════════════════════════════ */

export async function montar(donde, opciones = {}) {
  contenedor = donde;
  seccion = opciones.seccion === 'resumen' ? 'resumen' : 'caja';
  fecha = opciones.fecha || hoy();
  await cargar();
}

export function desmontar() {
  contenedor = null;
  datos = null;
}

export async function refrescar() {
  if (contenedor) await cargar({ silencioso: true });
}

async function cargar({ silencioso = false } = {}) {
  if (!silencioso) vaciar(contenedor).appendChild(esqueleto(6));
  try {
    datos = await resumenDia(fecha);
  } catch (e) {
    vaciar(contenedor).appendChild(vacio('No se pudo cargar la caja', e.amable ? e.message : traducirError(e)));
    return;
  }
  pintar();
}

function pintar() {
  vaciar(contenedor);
  contenedor.appendChild(cabeceraVista(
    seccion === 'resumen' ? `Resumen · ${fechaLarga(fecha)}` : `Caja · ${fechaLarga(fecha)}`
  ));
  contenedor.appendChild(barraFecha());

  if (!datos) return;

  contenedor.appendChild(cuadroVentas());
  contenedor.appendChild(cuadroMetodos());

  if (seccion === 'resumen') {
    contenedor.appendChild(crear('button', {
      clase: 'boton-secundario',
      texto: 'Ir a Caja y cierre',
      atributos: { type: 'button', style: 'width:auto;margin-top:8px' },
      datos: { vista: 'caja' }
    }));
    return;
  }

  contenedor.appendChild(cuadroFondo());
  contenedor.appendChild(cuadroEfectivo());

  if (datos.cierre) contenedor.appendChild(cuadroCierre());
  else contenedor.appendChild(botonFinalizar());
}

function barraFecha() {
  const caja = crear('div', { clase: 'pie-agenda', atributos: { style: 'margin:0 0 18px' } });
  caja.appendChild(crear('button', {
    clase: 'boton-icono', texto: '‹',
    atributos: { type: 'button', 'aria-label': 'Día anterior', style: 'font-size:26px' },
    al: { click: () => cambiarFecha(sumarDias(fecha, -1)) }
  }));
  caja.appendChild(crear('strong', { texto: fechaCorta(fecha) }));
  caja.appendChild(crear('button', {
    clase: 'boton-icono', texto: '›',
    atributos: { type: 'button', 'aria-label': 'Día siguiente', style: 'font-size:26px' },
    al: { click: () => cambiarFecha(sumarDias(fecha, 1)) }
  }));
  if (fecha !== hoy()) {
    caja.appendChild(crear('button', {
      clase: 'boton-enlace', texto: 'Volver a hoy',
      atributos: { type: 'button' },
      al: { click: () => cambiarFecha(hoy()) }
    }));
  }
  return caja;
}

async function cambiarFecha(nueva) {
  fecha = nueva;
  await cargar();
}

/* ══════════════════════════════════════════════════════════════════════
   CUADROS
   ══════════════════════════════════════════════════════════════════════ */

function cuadroVentas() {
  const caja = crear('div', { clase: 'tarjeta' });
  caja.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Ventas del día' }));

  caja.appendChild(lineaCalculo('Servicios atendidos', null));
  caja.lastChild.lastChild.textContent = String(datos.total_servicios ?? 0);

  if (datos.reservas_pendientes) {
    const linea = lineaCalculo('Reservas sin completar', null);
    linea.lastChild.textContent = `${datos.reservas_pendientes}  ⚠`;
    linea.lastChild.style.color = 'var(--bronce-texto)';
    caja.appendChild(linea);
  }

  caja.appendChild(lineaCalculo('Ventas referenciales', datos.ventas_referenciales || 0));
  caja.appendChild(lineaCalculo('Descuentos', -(datos.descuentos || 0)));
  caja.appendChild(lineaCalculo('Ventas reales', datos.ventas_reales || 0, { total: true }));

  if (datos.ticket_promedio) {
    caja.appendChild(crear('p', {
      clase: 'campo-ayuda',
      texto: `Ticket promedio: ${soles(datos.ticket_promedio)}`
    }));
  }
  return caja;
}

function cuadroMetodos() {
  const caja = crear('div', { clase: 'tarjeta' });
  caja.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Formas de pago' }));

  /* Estos totales salen de pagos_registro, no de la columna forma_pago:
     una atención mixta reparte su monto entre sus medios. */
  caja.appendChild(lineaCalculo('Efectivo', datos.efectivo || 0));
  caja.appendChild(lineaCalculo('Tarjeta', datos.tarjeta || 0));
  caja.appendChild(lineaCalculo('Yape', datos.yape || 0));

  if (datos.atenciones_sin_pago) {
    const linea = lineaCalculo('Sin registrar', null);
    linea.lastChild.textContent = `${plural(datos.atenciones_sin_pago, 'atención', 'atenciones')}  ⚠`;
    linea.lastChild.style.color = 'var(--bronce-texto)';
    caja.appendChild(linea);
  }

  if (datos.vuelto_efectivo || datos.vuelto_yape) {
    caja.appendChild(crear('p', {
      clase: 'campo-etiqueta',
      atributos: { style: 'margin-top:14px' },
      texto: 'Vuelto entregado'
    }));
    caja.appendChild(lineaCalculo('En efectivo', datos.vuelto_efectivo || 0));
    caja.appendChild(lineaCalculo('Enviado por Yape', datos.vuelto_yape || 0));
    caja.appendChild(crear('p', {
      clase: 'campo-ayuda',
      texto: 'El vuelto enviado por Yape no es una venta por Yape y no se resta del efectivo: ese dinero nunca salió de la caja.'
    }));
  }
  return caja;
}

function cuadroFondo() {
  const caja = crear('div', { clase: 'tarjeta' });
  caja.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Efectivo con el que se inició el día' }));
  caja.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'La caja fija para dar vuelto. No es una venta ni un ingreso: va aparte de todo lo demás.'
  }));

  const { campo: c, entrada } = campo('Monto', {
    valor: datos.fondo_inicial !== null && datos.fondo_inicial !== undefined ? decimales(datos.fondo_inicial) : '',
    atributos: { inputmode: 'decimal', placeholder: '0.00' }
  });
  entrada.classList.add('entrada-monto');
  c.style.maxWidth = '260px';

  entrada.addEventListener('change', async () => {
    const valor = aNumero(entrada.value);
    if (valor === null || valor < 0) { avisoError('Escribe un monto válido.'); return; }
    try {
      await guardarFondoInicial(fecha, valor);
      aviso('Efectivo inicial guardado');
      await refrescar();
    } catch (e) {
      avisoError(e.amable ? e.message : traducirError(e));
    }
  });

  caja.appendChild(c);

  if (datos.fondo_inicial === null || datos.fondo_inicial === undefined) {
    caja.appendChild(crear('p', {
      clase: 'campo-ayuda',
      texto: 'Si te olvidaste de anotarlo en la mañana, puedes escribirlo ahora: se registra igual.'
    }));
  }
  return caja;
}

function cuadroEfectivo() {
  const caja = crear('div', { clase: 'tarjeta' });
  caja.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Efectivo que debería haber en caja' }));

  caja.appendChild(lineaCalculo('Fondo inicial', datos.fondo_inicial || 0));
  caja.appendChild(lineaCalculo('+ Ventas en efectivo', datos.efectivo || 0));
  caja.appendChild(lineaCalculo('− Vuelto en efectivo', -(datos.vuelto_efectivo || 0)));
  caja.appendChild(lineaCalculo('Efectivo esperado', datos.efectivo_esperado || 0, { total: true }));

  return caja;
}

function botonFinalizar() {
  const caja = crear('div', { clase: 'dialogo-acciones' });
  caja.appendChild(crear('button', {
    clase: 'boton-primario',
    texto: 'Finalizar el día',
    atributos: { type: 'button' },
    al: { click: abrirCierre }
  }));
  return caja;
}

/* ══════════════════════════════════════════════════════════════════════
   CIERRE
   ══════════════════════════════════════════════════════════════════════ */

async function abrirCierre() {
  const cuerpo = crear('div');

  /* Avisos que NO bloquean: se dicen y se deja continuar. */
  const pendientes = [];
  if (datos.reservas_pendientes) {
    pendientes.push(`${plural(datos.reservas_pendientes, 'reserva sin completar', 'reservas sin completar')}`);
  }
  if (datos.atenciones_sin_pago) {
    pendientes.push(`${plural(datos.atenciones_sin_pago, 'atención sin forma de pago', 'atenciones sin forma de pago')}`);
  }
  if (pendientes.length) {
    cuerpo.appendChild(crear('p', {
      clase: 'mensaje-error',
      texto: `Quedan ${pendientes.join(' y ')}. Puedes finalizar el día de todas formas.`
    }));
  }
  if (datos.fondo_inicial === null || datos.fondo_inicial === undefined) {
    cuerpo.appendChild(crear('p', {
      clase: 'mensaje-error',
      texto: 'No se registró el efectivo inicial, así que la diferencia puede no ser confiable. Puedes escribirlo abajo antes de cerrar.'
    }));
    const { campo: cFondo, entrada: eFondo } = campo('Efectivo con el que se inició el día', {
      atributos: { inputmode: 'decimal', placeholder: '0.00' }
    });
    eFondo.classList.add('entrada-monto');
    eFondo.addEventListener('change', async () => {
      const valor = aNumero(eFondo.value);
      if (valor === null || valor < 0) return;
      try {
        await guardarFondoInicial(fecha, valor);
        datos = await resumenDia(fecha);
        actualizarCuadro();
        aviso('Efectivo inicial registrado');
      } catch (e) { avisoError(e.amable ? e.message : traducirError(e)); }
    });
    cuerpo.appendChild(cFondo);
  }

  const cuadro = crear('div', { clase: 'tarjeta' });
  cuerpo.appendChild(cuadro);

  const { campo: cContado, entrada: eContado } = campo('¿Cuánto efectivo hay contado en caja?', {
    atributos: { inputmode: 'decimal', placeholder: '0.00' }
  });
  eContado.classList.add('entrada-monto');
  cuerpo.appendChild(cContado);

  const lineaDiferencia = crear('div', { clase: 'linea-calculo linea-calculo-total' });
  lineaDiferencia.append(crear('span', { texto: 'Diferencia' }), crear('span', { clase: 'monto', texto: '—' }));
  cuerpo.appendChild(lineaDiferencia);

  const notaDiferencia = crear('p', { clase: 'campo-ayuda' });
  cuerpo.appendChild(notaDiferencia);

  const { campo: cRetiro, entrada: eRetiro } = campo('Se retira', {
    atributos: { inputmode: 'decimal', readonly: 'true' },
    ayuda: 'Calculado: lo contado menos la caja fija que dejas para mañana.'
  });
  eRetiro.classList.add('entrada-monto');
  cuerpo.appendChild(cRetiro);

  const { campo: cFija, entrada: eFija } = campo('Caja fija para mañana', {
    valor: decimales(datos.fondo_inicial || 0),
    atributos: { inputmode: 'decimal' }
  });
  eFija.classList.add('entrada-monto');
  cuerpo.appendChild(cFija);

  const { campo: cObs, entrada: eObs } = campo('Observaciones (opcional)', { multilinea: true });
  cuerpo.appendChild(cObs);

  function actualizarCuadro() {
    vaciar(cuadro);
    cuadro.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Resumen del día' }));
    cuadro.appendChild(lineaCalculo('Ventas reales', datos.ventas_reales || 0));
    cuadro.appendChild(lineaCalculo('Fondo inicial', datos.fondo_inicial || 0));
    cuadro.appendChild(lineaCalculo('+ Ventas en efectivo', datos.efectivo || 0));
    cuadro.appendChild(lineaCalculo('− Vuelto en efectivo', -(datos.vuelto_efectivo || 0)));
    cuadro.appendChild(lineaCalculo('Efectivo esperado', datos.efectivo_esperado || 0, { total: true }));
    recalcular();
  }

  function recalcular() {
    const contado = aNumero(eContado.value);
    const esperado = Number(datos.efectivo_esperado || 0);

    if (contado === null) {
      lineaDiferencia.lastChild.textContent = '—';
      notaDiferencia.textContent = '';
      eRetiro.value = '';
      return;
    }

    const diferencia = +(contado - esperado).toFixed(2);
    lineaDiferencia.lastChild.textContent = soles(diferencia, { signo: true });
    lineaDiferencia.lastChild.style.color = Math.abs(diferencia) < 0.005 ? '' : 'var(--bronce-texto)';

    if (Math.abs(diferencia) < 0.005) notaDiferencia.textContent = 'La caja cuadra.';
    else if (diferencia < 0) notaDiferencia.textContent = `Falta ${soles(Math.abs(diferencia))}. Podrás justificarlo después de cerrar, o dejarlo sin justificar.`;
    else notaDiferencia.textContent = `Sobra ${soles(diferencia)}. Puedes dejar una nota explicándolo, o cerrar así.`;

    const fija = aNumero(eFija.value) || 0;
    eRetiro.value = decimales(Math.max(0, contado - fija));
  }

  eContado.addEventListener('input', recalcular);
  eFija.addEventListener('input', recalcular);
  actualizarCuadro();

  abrirHoja({
    titulo: `Finalizar el día · ${fechaCorta(fecha)}`,
    contenido: cuerpo,
    acciones: [{
      texto: 'Finalizar día',
      tipo: 'primario',
      al: async ({ cerrar }) => {
        const contado = aNumero(eContado.value);
        if (contado === null || contado < 0) { avisoError('Escribe cuánto efectivo hay contado en caja.'); return; }

        const fija = aNumero(eFija.value) || 0;
        try {
          await cerrarDia(fecha, {
            efectivo_contado: contado,
            caja_fija_siguiente: fija,
            monto_retirado: Math.max(0, contado - fija),
            observaciones: eObs.value.trim() || null
          });
          aviso('Día finalizado');
          cerrar();
          await refrescar();
        } catch (e) {
          avisoError(e.amable ? e.message : traducirError(e));
        }
      }
    }]
  });
}

/* ══════════════════════════════════════════════════════════════════════
   DÍA YA CERRADO
   ══════════════════════════════════════════════════════════════════════ */

function cuadroCierre() {
  const c = datos.cierre;
  const caja = crear('div', { clase: 'tarjeta' });

  caja.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Día cerrado' }));
  caja.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: `Cerrado el ${fechaHora(c.hora_cierre)}${c.reabierto ? ' · fue reabierto' : ''}`
  }));

  if (c.modificado_en) {
    /* Nunca se deja un cierre mostrando cifras que ya no corresponden a
       sus registros: si algo se corrigió, se recalcula y se avisa. */
    caja.appendChild(crear('p', {
      clase: 'mensaje-error',
      texto: `Este cierre se recalculó el ${fechaHora(c.modificado_en)} porque se corrigió un registro del día.`
    }));
  }

  caja.appendChild(lineaCalculo('Efectivo esperado', datos.efectivo_esperado || 0));
  caja.appendChild(lineaCalculo('Efectivo contado', c.efectivo_contado || 0));
  caja.appendChild(lineaCalculo('Diferencia', c.diferencia || 0, { total: true, signo: true }));
  caja.appendChild(lineaCalculo('Se retiró', c.monto_retirado || 0));
  caja.appendChild(lineaCalculo('Caja fija dejada', c.caja_fija_siguiente || 0));

  const diferencia = Number(c.diferencia || 0);
  const justificado = Number(c.diferencia_justificada || 0);
  const porJustificar = +(Math.abs(diferencia) - Math.abs(justificado)).toFixed(2);

  if (Math.abs(diferencia) >= 0.005) {
    if (porJustificar >= 0.005) {
      caja.appendChild(crear('p', {
        clase: 'pastilla pastilla-aviso',
        atributos: { style: 'display:inline-block;margin-top:12px' },
        texto: `Diferencia sin justificar: ${soles(porJustificar)}`
      }));
    }
    caja.appendChild(crear('button', {
      clase: 'boton-secundario',
      texto: 'Justificar diferencia',
      atributos: { type: 'button', style: 'width:auto;margin-top:12px' },
      al: { click: () => justificar(c, porJustificar) }
    }));
  }

  const cajaAjustes = crear('div', { atributos: { style: 'margin-top:16px' } });
  caja.appendChild(cajaAjustes);
  pintarAjustes(c.id, cajaAjustes);

  caja.appendChild(crear('button', {
    clase: 'boton-enlace',
    texto: 'Reabrir este día',
    atributos: { type: 'button', style: 'margin-top:14px' },
    al: { click: () => reabrir(c) }
  }));

  caja.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'Aunque el día esté cerrado, puedes corregir un registro: el cierre se recalcula solo y queda marcado como modificado.'
  }));

  return caja;
}

async function pintarAjustes(cierreId, donde) {
  try {
    const filas = await ajustesCierre(cierreId);
    vaciar(donde);
    if (!filas.length) return;

    donde.appendChild(crear('p', { clase: 'campo-etiqueta', texto: 'Diferencias justificadas' }));

    const envoltura = crear('div', { clase: 'tabla-envoltura' });
    const tabla = crear('table', { clase: 'tabla' });
    const thead = crear('thead');
    const tr = crear('tr');
    ['Motivo', 'Monto', 'Registrado por', 'Cuándo'].forEach((t, i) =>
      tr.appendChild(crear('th', { texto: t, clase: i === 1 ? 'derecha' : '' })));
    thead.appendChild(tr);
    tabla.appendChild(thead);

    const tbody = crear('tbody');
    filas.forEach((a) => {
      const fila = crear('tr');
      fila.appendChild(celda(a.motivo));
      fila.appendChild(celda(soles(a.monto), { clase: 'monto' }));
      fila.appendChild(celda(a.usuario?.nombre));
      fila.appendChild(celda(fechaHora(a.created_at)));
      tbody.appendChild(fila);
    });
    tabla.appendChild(tbody);
    envoltura.appendChild(tabla);
    donde.appendChild(envoltura);
  } catch (e) {
    // Si no se pueden leer los ajustes, el resto del cierre sigue visible
    console.warn('[caja] no se pudieron cargar los ajustes', e);
  }
}

async function justificar(cierre, maximo) {
  const caja = crear('div');
  caja.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'Esto no es un registro de gastos: existe solo para explicar por qué falta o sobra dinero en el cierre.'
  }));

  const { campo: c1, entrada: eMotivo } = campo('Motivo', {
    ayuda: 'Por ejemplo: "Se pagó el agua".'
  });
  const { campo: c2, entrada: eMonto } = campo('Monto', { atributos: { inputmode: 'decimal' } });
  eMonto.classList.add('entrada-monto');
  caja.append(c1, c2);

  caja.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: `Puedes justificar hasta ${soles(maximo)}.`
  }));

  const ok = await confirmar({ titulo: 'Justificar diferencia', extra: caja, aceptar: 'Guardar' });
  if (!ok) return;

  const motivo = eMotivo.value.trim();
  const monto = aNumero(eMonto.value);

  if (!motivo) { avisoError('Escribe el motivo.'); return; }
  if (monto === null || monto <= 0) { avisoError('Escribe el monto.'); return; }
  if (monto > maximo + 0.005) {
    avisoError(`No puedes justificar más que la diferencia detectada (${soles(maximo)}).`);
    return;
  }

  try {
    await agregarAjuste(cierre.id, motivo, monto, Number(cierre.diferencia) < 0 ? 'faltante' : 'sobrante');
    aviso('Justificación registrada');
    await refrescar();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}

async function reabrir(cierre) {
  const seguro = await confirmar({
    titulo: 'Reabrir este día',
    texto: 'El día volverá a quedar abierto y podrás registrar y corregir con normalidad. Queda constancia en la auditoría.',
    aceptar: 'Reabrir'
  });
  if (!seguro) return;

  try {
    await reabrirDia(fecha);
    aviso('Día reabierto');
    await refrescar();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}
