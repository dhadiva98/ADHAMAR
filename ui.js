/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — ui.js
   Las piezas visuales que usan todos los módulos.

   R16: aquí no existen alert(), confirm() ni prompt(). Todo lo que
   pregunta o avisa pasa por este archivo, con la estética del sistema y
   comportándose bien en celular.
   ══════════════════════════════════════════════════════════════════════ */

import { $, crear, vaciar, vibrar } from './core.js';
import { soles, hora12 } from './formato.js';

/* ── AVISOS ──────────────────────────────────────────────────────────────
   La confirmación de guardado tiene que ser imposible de no ver (§2.4):
   la duda de "¿se habrá guardado?" es la principal causa de registros
   duplicados.
   ────────────────────────────────────────────────────────────────────── */

const DURACION_AVISO = { ok: 3200, info: 4200, error: 6000 };

export function aviso(texto, tipo = 'ok') {
  const caja = $('#avisos');
  if (!caja) return;

  const el = crear('div', {
    clase: `aviso aviso-${tipo}`,
    texto,
    atributos: { role: tipo === 'error' ? 'alert' : 'status' }
  });
  el.style.pointerEvents = 'auto';
  caja.appendChild(el);

  if (tipo === 'ok') vibrar(12);
  if (tipo === 'error') vibrar([12, 60, 12]);

  const quitar = () => {
    el.classList.add('aviso-saliendo');
    setTimeout(() => el.remove(), 220);
  };
  const reloj = setTimeout(quitar, DURACION_AVISO[tipo] || 3500);
  el.addEventListener('click', () => { clearTimeout(reloj); quitar(); });
}

export const avisoOk    = (t) => aviso(t, 'ok');
export const avisoError = (t) => aviso(t, 'error');
export const avisoInfo  = (t) => aviso(t, 'info');

/* ── FOCO ATRAPADO ───────────────────────────────────────────────────────
   Mientras hay un diálogo o una hoja abiertos, el teclado no debe poder
   escaparse a la pantalla de atrás.
   ────────────────────────────────────────────────────────────────────── */

const ENFOCABLES = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function atraparFoco(contenedor) {
  const previo = document.activeElement;

  const alTabular = (e) => {
    if (e.key !== 'Tab') return;
    const lista = Array.from(contenedor.querySelectorAll(ENFOCABLES))
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!lista.length) return;
    const primero = lista[0];
    const ultimo = lista[lista.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };

  contenedor.addEventListener('keydown', alTabular);

  const primero = contenedor.querySelector(ENFOCABLES);
  if (primero) setTimeout(() => primero.focus(), 60);

  return () => {
    contenedor.removeEventListener('keydown', alTabular);
    if (previo && document.contains(previo)) previo.focus();
  };
}

let capasAbiertas = 0;

function bloquearFondo() {
  capasAbiertas += 1;
  document.body.style.overflow = 'hidden';
}

function liberarFondo() {
  capasAbiertas = Math.max(0, capasAbiertas - 1);
  if (capasAbiertas === 0) document.body.style.overflow = '';
}

/* ── DIÁLOGO ─────────────────────────────────────────────────────────────
   Sustituye a confirm(). Devuelve una promesa: true si aceptó.
   ────────────────────────────────────────────────────────────────────── */

export function confirmar({
  titulo,
  texto = '',
  aceptar = 'Aceptar',
  cancelar = 'Cancelar',
  peligro = false,
  extra = null,        // Nodo opcional: una tabla, un campo, un detalle
  soloAviso = false    // Sin botón de cancelar: solo informa
} = {}) {
  return new Promise((resolver) => {
    const capa = $('#capa-dialogo');
    const btnAceptar = $('#dialogo-aceptar');
    const btnCancelar = $('#dialogo-cancelar');
    const cajaExtra = $('#dialogo-extra');

    $('#dialogo-titulo').textContent = titulo || '';
    $('#dialogo-texto').textContent = texto;
    $('#dialogo-texto').hidden = !texto;

    vaciar(cajaExtra);
    if (extra) cajaExtra.appendChild(extra);

    btnAceptar.textContent = aceptar;
    btnAceptar.className = peligro ? 'boton-peligro' : 'boton-primario';
    btnCancelar.textContent = cancelar;
    btnCancelar.hidden = soloAviso;

    capa.hidden = false;
    bloquearFondo();
    const soltarFoco = atraparFoco(capa);

    const cerrar = (resultado) => {
      capa.hidden = true;
      soltarFoco();
      liberarFondo();
      btnAceptar.removeEventListener('click', alAceptar);
      btnCancelar.removeEventListener('click', alCancelar);
      capa.removeEventListener('click', alFondo);
      document.removeEventListener('keydown', alTeclado);
      vaciar(cajaExtra);
      resolver(resultado);
    };

    const alAceptar = () => cerrar(true);
    const alCancelar = () => cerrar(false);
    const alFondo = (e) => { if (e.target.dataset.cerrarDialogo !== undefined) cerrar(false); };
    const alTeclado = (e) => {
      if (e.key === 'Escape') cerrar(false);
      if (e.key === 'Enter' && document.activeElement?.tagName !== 'TEXTAREA') cerrar(true);
    };

    btnAceptar.addEventListener('click', alAceptar);
    btnCancelar.addEventListener('click', alCancelar);
    capa.addEventListener('click', alFondo);
    document.addEventListener('keydown', alTeclado);
  });
}

/** Aviso que solo informa y espera un "Entendido". */
export function informar(titulo, texto, extra = null) {
  return confirmar({ titulo, texto, extra, aceptar: 'Entendido', soloAviso: true });
}

/**
 * Pregunta un texto corto sin usar prompt().
 * Devuelve el texto escrito, o null si canceló.
 */
export function pedirTexto({ titulo, texto = '', etiqueta, valor = '', multilinea = false, aceptar = 'Guardar' }) {
  const campo = crear('label', { clase: 'campo' });
  campo.appendChild(crear('span', { clase: 'campo-etiqueta', texto: etiqueta }));
  const entrada = crear(multilinea ? 'textarea' : 'input');
  entrada.value = valor;
  if (!multilinea) entrada.type = 'text';
  campo.appendChild(entrada);

  return confirmar({ titulo, texto, extra: campo, aceptar })
    .then((ok) => (ok ? entrada.value.trim() : null));
}

/* ── HOJA INFERIOR / PANEL LATERAL ───────────────────────────────────────
   La misma pieza: hoja inferior arrastrable en celular, panel lateral en
   escritorio (lo decide el CSS).
   ────────────────────────────────────────────────────────────────────── */

let cerrarHojaActual = null;

export function abrirHoja({ titulo, contenido, acciones = [], alCerrar = null }) {
  cerrarHojaActual?.();

  const capa = $('#capa-hoja');
  const hoja = capa.querySelector('.hoja');
  const cuerpo = $('#hoja-cuerpo');
  const pie = $('#hoja-pie');

  $('#hoja-titulo').textContent = titulo || '';
  vaciar(cuerpo);
  if (contenido) cuerpo.appendChild(contenido);

  vaciar(pie);
  acciones.forEach(({ texto, tipo = 'secundario', al }) => {
    pie.appendChild(crear('button', {
      clase: `boton-${tipo}`,
      texto,
      atributos: { type: 'button' },
      al: { click: () => al?.({ cerrar }) }
    }));
  });

  capa.hidden = false;
  bloquearFondo();
  const soltarFoco = atraparFoco(capa);
  const soltarArrastre = habilitarArrastre(hoja, () => cerrar());

  function cerrar() {
    capa.hidden = true;
    hoja.style.transform = '';
    soltarFoco();
    soltarArrastre();
    liberarFondo();
    capa.removeEventListener('click', alFondo);
    document.removeEventListener('keydown', alTeclado);
    cerrarHojaActual = null;
    vaciar(cuerpo);
    vaciar(pie);
    alCerrar?.();
  }

  const alFondo = (e) => { if (e.target.dataset.cerrarHoja !== undefined) cerrar(); };
  const alTeclado = (e) => { if (e.key === 'Escape') cerrar(); };

  capa.addEventListener('click', alFondo);
  document.addEventListener('keydown', alTeclado);
  cerrarHojaActual = cerrar;

  return { cerrar };
}

export function cerrarHoja() {
  cerrarHojaActual?.();
}

/** Arrastrar hacia abajo para cerrar. Solo mueve transform: nunca dispara reflow. */
function habilitarArrastre(hoja, alSoltarAbajo) {
  let inicioY = null;
  let desplazamiento = 0;

  const empezar = (e) => {
    const y = e.touches ? e.touches[0].clientY : null;
    if (y === null) return;
    const zona = e.target.closest('.hoja-agarre, .hoja-cabecera');
    if (!zona) return;
    inicioY = y;
    hoja.style.transition = 'none';
  };

  const mover = (e) => {
    if (inicioY === null) return;
    desplazamiento = Math.max(0, e.touches[0].clientY - inicioY);
    hoja.style.transform = `translateY(${desplazamiento}px)`;
  };

  const soltar = () => {
    if (inicioY === null) return;
    hoja.style.transition = '';
    if (desplazamiento > 110) alSoltarAbajo();
    else hoja.style.transform = '';
    inicioY = null;
    desplazamiento = 0;
  };

  hoja.addEventListener('touchstart', empezar, { passive: true });
  hoja.addEventListener('touchmove', mover, { passive: true });
  hoja.addEventListener('touchend', soltar);

  return () => {
    hoja.removeEventListener('touchstart', empezar);
    hoja.removeEventListener('touchmove', mover);
    hoja.removeEventListener('touchend', soltar);
  };
}

/* ── ESQUELETOS Y ESTADOS VACÍOS ─────────────────────────────────────────
   Esqueletos, nunca ruedas giratorias (§2.5).
   ────────────────────────────────────────────────────────────────────── */

export function esqueleto(filas = 5, { conTitulo = true } = {}) {
  const caja = crear('div', { clase: 'esqueleto-pantalla', atributos: { 'aria-hidden': 'true' } });
  if (conTitulo) caja.appendChild(crear('div', { clase: 'esqueleto esqueleto-titulo' }));
  for (let i = 0; i < filas; i += 1) {
    caja.appendChild(crear('div', { clase: 'esqueleto esqueleto-fila' }));
  }
  return caja;
}

export function vacio(titulo, texto = '', accion = null) {
  const caja = crear('div', { clase: 'vacio' });
  caja.appendChild(crear('p', { clase: 'vacio-titulo', texto: titulo }));
  if (texto) caja.appendChild(crear('p', { clase: 'vacio-texto', texto }));
  if (accion) {
    caja.appendChild(crear('button', {
      clase: 'boton-secundario',
      texto: accion.texto,
      atributos: { type: 'button', style: 'margin-top:18px;width:auto' },
      al: { click: accion.al }
    }));
  }
  return caja;
}

/** Pinta un esqueleto mientras se resuelve la promesa, y luego el contenido. */
export async function conEsqueleto(contenedor, promesa, filas = 5) {
  vaciar(contenedor).appendChild(esqueleto(filas));
  try {
    const nodo = await promesa;
    vaciar(contenedor);
    if (nodo) contenedor.appendChild(nodo);
  } catch (e) {
    vaciar(contenedor).appendChild(
      vacio('No se pudo cargar', e.amable ? e.message : 'Vuelve a intentarlo en unos segundos.')
    );
    throw e;
  }
}

/* ── PIEZAS PEQUEÑAS ─────────────────────────────────────────────────── */

const TEXTO_ESTADO = { atendido: 'Atendido', reserva: 'Reserva', cancelado: 'Cancelado' };

/** Pastilla de estado. El champagne de marca nunca se usa para estados (§2.1). */
export function pastilla(estado) {
  return crear('span', {
    clase: `pastilla pastilla-${estado}`,
    texto: TEXTO_ESTADO[estado] || estado
  });
}

/** Celda de dinero: mono, tabular, alineada a la derecha. */
export function celdaMonto(valor, { vacio: textoVacio = '—' } = {}) {
  const td = crear('td', { clase: 'monto' });
  if (valor === null || valor === undefined) {
    td.appendChild(crear('span', { clase: 'dato-faltante', texto: textoVacio }));
  } else {
    td.textContent = soles(valor);
  }
  return td;
}

/** Celda de texto que puede faltar. Nunca una celda vacía sin explicación (§5.1). */
export function celda(texto, { clase = '', vacio: textoVacio = '—' } = {}) {
  const td = crear('td', { clase });
  if (texto === null || texto === undefined || texto === '') {
    td.appendChild(crear('span', { clase: 'dato-faltante', texto: textoVacio }));
  } else {
    td.textContent = texto;
  }
  return td;
}

/** Fila "concepto ······ monto" de los cuadros de caja. */
export function lineaCalculo(concepto, monto, { total = false, signo = false } = {}) {
  const fila = crear('div', { clase: `linea-calculo${total ? ' linea-calculo-total' : ''}` });
  fila.appendChild(crear('span', { texto: concepto }));
  fila.appendChild(crear('span', { clase: 'monto', texto: soles(monto, { signo }) }));
  return fila;
}

/** Cabecera de una pantalla, con sus acciones a la derecha. */
export function cabeceraVista(titulo, acciones = []) {
  const caja = crear('div', { clase: 'vista-cabecera' });
  caja.appendChild(crear('h1', { clase: 'titulo-pantalla', texto: titulo }));
  if (acciones.length) {
    const derecha = crear('div', { clase: 'vista-acciones' });
    acciones.forEach(({ texto, tipo = 'secundario', al, id }) => {
      derecha.appendChild(crear('button', {
        clase: `boton-${tipo}`,
        texto,
        atributos: { type: 'button', style: 'width:auto', ...(id ? { id } : {}) },
        al: { click: al }
      }));
    });
    caja.appendChild(derecha);
  }
  return caja;
}

/** Campo de formulario con etiqueta. Devuelve { campo, entrada }. */
export function campo(etiqueta, { tipo = 'text', valor = '', ayuda = '', atributos = {}, multilinea = false } = {}) {
  const caja = crear('label', { clase: 'campo' });
  caja.appendChild(crear('span', { clase: 'campo-etiqueta', texto: etiqueta }));

  const entrada = crear(multilinea ? 'textarea' : 'input');
  if (!multilinea) entrada.type = tipo;
  entrada.value = valor ?? '';
  for (const a in atributos) entrada.setAttribute(a, atributos[a]);
  caja.appendChild(entrada);

  if (ayuda) caja.appendChild(crear('span', { clase: 'campo-ayuda', texto: ayuda }));
  return { campo: caja, entrada };
}

/** Casilla grande, cómoda de tocar. Devuelve { casilla, entrada }. */
export function casilla(etiqueta, marcada = false) {
  const caja = crear('label', { clase: 'casilla' });
  const entrada = crear('input');
  entrada.type = 'checkbox';
  entrada.checked = marcada;
  caja.appendChild(entrada);
  caja.appendChild(crear('span', { texto: etiqueta }));
  return { casilla: caja, entrada };
}

/** Hora con formato de 12 horas, ya lista para pintar. */
export const horaVisible = hora12;
