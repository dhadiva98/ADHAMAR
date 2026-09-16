// ===========================================================================
//  COMPONENTES DE INTERFAZ
// ===========================================================================
import { esperar, escapar, vibrar } from './core.js';

export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// --- Aviso flotante ---------------------------------------------------------
// La confirmación al guardar debe verse sin buscarla: la duda de "¿se habrá
// guardado?" es la principal causa de registros duplicados.
export function avisar(texto, tipo = '') {
  const n = document.createElement('div');
  n.className = 'nota' + (tipo ? ` nota--${tipo}` : '');
  n.innerHTML = (tipo === 'exito' ? '✓ ' : tipo === 'error' ? '⚠ ' : '') + escapar(texto);
  $('#avisos').append(n);
  if (tipo === 'exito') vibrar(14);
  if (tipo === 'error') vibrar([12, 60, 12]);
  setTimeout(() => {
    n.style.transition = 'opacity .25s, transform .25s';
    n.style.opacity = 0; n.style.transform = 'translateY(10px)';
    setTimeout(() => n.remove(), 260);
  }, tipo === 'error' ? 5200 : 3000);
}

// --- Hoja inferior (móvil) / modal centrado (escritorio) -------------------
let alCerrarHoja = null;

export function abrirHoja(titulo, html, alCerrar) {
  $('#hoja-titulo').textContent = titulo;
  $('#hoja-cuerpo').innerHTML = html;
  $('#hoja').classList.remove('oculto');
  document.body.style.overflow = 'hidden';
  alCerrarHoja = alCerrar || null;
  return $('#hoja-cuerpo');
}

export function cerrarHoja() {
  const h = $('#hoja');
  if (h.classList.contains('oculto')) return;
  const panel = $('.hoja__panel');
  panel.style.transition = 'transform .22s cubic-bezier(.4,0,.2,1), opacity .22s';
  panel.style.opacity = 0;
  panel.style.transform = window.innerWidth <= 900
    ? 'translateY(100%)' : 'translate(-50%, calc(-50% + 12px))';
  setTimeout(() => {
    h.classList.add('oculto');
    panel.style.cssText = '';
    $('#hoja-cuerpo').innerHTML = '';
    document.body.style.overflow = '';
    if (alCerrarHoja) { alCerrarHoja(); alCerrarHoja = null; }
  }, 210);
}

export function iniciarHoja() {
  $('#hoja-cerrar').onclick = cerrarHoja;
  $('.hoja__fondo').onclick = cerrarHoja;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#hoja').classList.contains('oculto')) cerrarHoja();
  });

  // Cerrar arrastrando hacia abajo en móvil. Solo se anima transform.
  const panel = $('.hoja__panel');
  let y0 = null, dy = 0;
  panel.addEventListener('touchstart', e => {
    if (window.innerWidth > 900) return;
    if (panel.scrollTop > 2) return;                 // deja hacer scroll dentro
    y0 = e.touches[0].clientY; dy = 0;
    panel.style.transition = 'none';
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', () => {
    if (y0 === null) return;
    panel.style.transition = 'transform .24s cubic-bezier(.4,0,.2,1)';
    if (dy > 110) cerrarHoja(); else panel.style.transform = '';
    y0 = null;
  });
}

// --- Confirmación -----------------------------------------------------------
export function confirmar({ titulo, texto, aceptar = 'Continuar', peligro = false, doble = false }) {
  return new Promise(resolve => {
    const cuerpo = abrirHoja(titulo, `
      <p style="font-size:16.5px;line-height:1.55;margin:0 0 22px">${escapar(texto)}</p>
      ${doble ? `<label class="casilla"><input type="checkbox" id="conf-doble">
                 <span>Entiendo lo que va a pasar</span></label>` : ''}
      <div class="barra-acciones" style="margin:0">
        <button class="btn btn--neutro" id="conf-no" style="flex:1">Cancelar</button>
        <button class="btn ${peligro ? 'btn--peligro' : 'btn--principal'}" id="conf-si"
                style="flex:1" ${doble ? 'disabled' : ''}>${escapar(aceptar)}</button>
      </div>`, () => resolve(false));

    if (doble) {
      cuerpo.querySelector('#conf-doble').onchange = e =>
        cuerpo.querySelector('#conf-si').disabled = !e.target.checked;
    }
    cuerpo.querySelector('#conf-no').onclick = () => { alCerrarHoja = null; cerrarHoja(); resolve(false); };
    cuerpo.querySelector('#conf-si').onclick = () => { alCerrarHoja = null; cerrarHoja(); resolve(true); };
  });
}

// --- Esqueleto de carga -----------------------------------------------------
// La estructura aparece primero y se rellena. Nunca ruedas giratorias.
export function esqueleto(filas = 5) {
  return `<div class="panel"><div class="panel__cuerpo">${
    Array.from({ length: filas }, (_, i) => `
      <div style="display:flex;gap:14px;align-items:center;padding:11px 0">
        <div class="esqueleto" style="width:74px"></div>
        <div class="esqueleto" style="flex:1;max-width:${180 - i * 12}px"></div>
        <div class="esqueleto" style="width:64px;margin-left:auto"></div>
      </div>`).join('')
  }</div></div>`;
}

export function vacio(texto, accion = '') {
  return `<div class="mensaje-vacio">
    <svg class="marca"><use href="#logo"/></svg>
    <p>${escapar(texto)}</p>${accion}</div>`;
}

// ===========================================================================
//  AUTOCOMPLETADO PREDICTIVO
//
//  Campo de texto con sugerencias en vivo. Se escribe, aparecen coincidencias
//  debajo, se elige una. Lo que se guarda es SIEMPRE el id de la entidad,
//  nunca el texto escrito a mano.
// ===========================================================================
export function autocompletar({
  contenedor, etiqueta, buscar, pintar, alElegir,
  permitirCrear = null, textoCrear = 'Crear', valorInicial = null, requerido = false
}) {
  const id = 'b' + Math.random().toString(36).slice(2, 8);
  contenedor.innerHTML = `
    <div class="campo buscador" id="${id}">
      <span>${escapar(etiqueta)}${requerido ? '' : ' <em style="text-transform:none;font-style:normal">(opcional)</em>'}</span>
      <div class="caja"></div>
    </div>`;

  const raiz = contenedor.querySelector('#' + id);
  const caja = raiz.querySelector('.caja');
  let elegido = null, opciones = [], marcada = -1, abierta = false;

  function modoSeleccionado(item) {
    elegido = item;
    caja.innerHTML = `<div class="seleccionado">
        <span>${escapar(pintar(item).titulo)}</span>
        <button type="button" class="btn-icono" aria-label="Quitar">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18"
            stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
        </button></div>`;
    caja.querySelector('button').onclick = () => { modoBusqueda(); alElegir(null); };
    alElegir(item);
  }

  function modoBusqueda(texto = '') {
    elegido = null;
    caja.innerHTML = `<input type="text" autocomplete="off" value="${escapar(texto)}"
                       placeholder="Escribe para buscar…">`;
    const input = caja.querySelector('input');

    const consultar = esperar(async () => {
      const t = input.value.trim();
      opciones = t ? await buscar(t) : [];
      mostrar(t);
    }, 170);

    input.addEventListener('input', consultar);
    input.addEventListener('focus', consultar);
    input.addEventListener('keydown', e => {
      if (!abierta) return;
      const total = opciones.length + (permitirCrear && input.value.trim() ? 1 : 0);
      if (e.key === 'ArrowDown') { e.preventDefault(); marcada = (marcada + 1) % total; resaltar(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); marcada = (marcada - 1 + total) % total; resaltar(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const btn = raiz.querySelectorAll('.buscador__op')[marcada < 0 ? 0 : marcada];
        btn?.click();
      } else if (e.key === 'Escape') cerrar();
    });
    input.addEventListener('blur', () => setTimeout(cerrar, 160));
    setTimeout(() => input.focus(), 30);
  }

  function mostrar(texto) {
    cerrar();
    if (!texto) return;
    const lista = document.createElement('div');
    lista.className = 'buscador__lista';

    opciones.forEach(o => {
      const d = pintar(o);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'buscador__op';
      b.innerHTML = `<span>${escapar(d.titulo)}</span>${d.nota ? `<small>${escapar(d.nota)}</small>` : ''}`;
      b.onmousedown = e => e.preventDefault();
      b.onclick = () => { cerrar(); modoSeleccionado(o); };
      lista.append(b);
    });

    // "Crear nuevo" SIEMPRE al final: la acción por defecto es reutilizar
    // un registro existente, no fabricar otro duplicado.
    if (permitirCrear) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'buscador__op buscador__op--crear';
      b.innerHTML = `<span>+ ${escapar(textoCrear)} “${escapar(texto)}”</span>`;
      b.onmousedown = e => e.preventDefault();
      b.onclick = async () => {
        cerrar();
        const nuevo = await permitirCrear(texto, opciones);
        if (nuevo) modoSeleccionado(nuevo);
      };
      lista.append(b);
    }

    if (!lista.children.length) return;
    raiz.append(lista);
    abierta = true; marcada = -1;
  }

  function resaltar() {
    raiz.querySelectorAll('.buscador__op').forEach((b, i) => b.classList.toggle('marcada', i === marcada));
    raiz.querySelectorAll('.buscador__op')[marcada]?.scrollIntoView({ block: 'nearest' });
  }

  function cerrar() { raiz.querySelector('.buscador__lista')?.remove(); abierta = false; }

  valorInicial ? modoSeleccionado(valorInicial) : modoBusqueda();

  return {
    valor: () => elegido,
    limpiar: () => modoBusqueda(),
    fijar: item => item ? modoSeleccionado(item) : modoBusqueda(),
    texto: () => caja.querySelector('input')?.value.trim() || ''
  };
}
