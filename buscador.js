/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — buscador.js
   El campo con sugerencias predictivas (§5.5). Lo usan Registrar servicio,
   Clientes, Historial y Asistencia.

   Regla técnica innegociable: el campo MUESTRA texto, pero lo que se
   guarda es SIEMPRE el id. Si lo escrito no se resolvió a un registro
   existente, obtener() devuelve id nulo y quien llama decide qué hacer
   —crear el cliente, o impedir el guardado si es una masajista—.

   Nunca se guarda un nombre escrito a mano como si fuera la relación:
   así es como se rompe el historial de un cliente.
   ══════════════════════════════════════════════════════════════════════ */

import { crear, vaciar, esperarUnPoco, idUnico } from './core.js';
import { normalizar } from './formato.js';

/**
 * @param {object} opciones
 * @param {string} opciones.etiqueta          Texto de la etiqueta
 * @param {function} opciones.buscar          async (texto) => [{ id, nombre, dato }]
 * @param {boolean} opciones.permitirCrear    Muestra "Crear …" al final de la lista
 * @param {function} opciones.alCrear         async (texto) => { id, nombre } | null
 * @param {function} opciones.alElegir        (item|null) => void
 * @param {object}   opciones.valorInicial    { id, nombre } para reabrir un registro
 * @param {string}   opciones.ayuda           Texto de ayuda bajo el campo
 * @param {string}   opciones.marcador        Placeholder
 */
export function crearBuscador({
  etiqueta,
  buscar,
  permitirCrear = false,
  alCrear = null,
  alElegir = null,
  valorInicial = null,
  ayuda = '',
  marcador = ''
}) {
  const id = idUnico('buscador');

  const caja = crear('div', { clase: 'campo buscador' });
  const etiquetaEl = crear('label', {
    clase: 'campo-etiqueta',
    texto: etiqueta,
    atributos: { for: id }
  });

  const entrada = crear('input', {
    atributos: {
      id,
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-autocomplete': 'list',
      placeholder: marcador
    }
  });

  const lista = crear('ul', {
    clase: 'sugerencias',
    atributos: { role: 'listbox', hidden: '' }
  });

  caja.append(etiquetaEl, entrada, lista);
  if (ayuda) caja.appendChild(crear('span', { clase: 'campo-ayuda', texto: ayuda }));

  /* Estado interno: lo elegido de verdad, con su id. */
  let elegido = valorInicial && valorInicial.id ? { ...valorInicial } : null;
  let opciones = [];
  let resaltado = -1;
  let pidiendo = 0;

  if (valorInicial?.nombre) entrada.value = valorInicial.nombre;

  /* ── Pintar sugerencias ─────────────────────────────────────────────── */

  function cerrar() {
    lista.hidden = true;
    lista.innerHTML = '';
    entrada.setAttribute('aria-expanded', 'false');
    entrada.removeAttribute('aria-activedescendant');
    resaltado = -1;
  }

  function pintar(resultados, texto) {
    vaciar(lista);
    opciones = resultados.slice();
    resaltado = -1;

    const textoNormalizado = normalizar(texto);

    resultados.forEach((item, indice) => {
      const fila = crear('li', {
        clase: 'sugerencia',
        atributos: {
          role: 'option',
          id: `${id}-op-${indice}`,
          'aria-selected': 'false'
        }
      });
      fila.appendChild(crear('span', { texto: item.nombre }));
      if (item.dato) fila.appendChild(crear('span', { clase: 'sugerencia-dato', texto: item.dato }));

      /* Si hay una coincidencia exacta se resalta, pero NO se selecciona
         sola: elegir por la usuaria, no por el sistema. */
      if (normalizar(item.nombre) === textoNormalizado) {
        fila.style.fontWeight = '600';
      }

      fila.addEventListener('mousedown', (e) => { e.preventDefault(); elegir(item); });
      lista.appendChild(fila);
    });

    /* "Crear nuevo" SIEMPRE al final, nunca arriba: así la acción por
       defecto es reutilizar lo que ya existe. */
    if (permitirCrear && texto.trim()) {
      const fila = crear('li', {
        clase: 'sugerencia sugerencia-crear',
        atributos: { role: 'option', id: `${id}-op-crear`, 'aria-selected': 'false' },
        texto: `+ Crear "${texto.trim()}"`
      });
      fila.dataset.crear = 'si';
      fila.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        await crearNuevo(texto.trim());
      });
      lista.appendChild(fila);
      opciones.push({ crear: true, nombre: texto.trim() });
    }

    const hay = lista.children.length > 0;
    lista.hidden = !hay;
    entrada.setAttribute('aria-expanded', hay ? 'true' : 'false');
  }

  function marcarResaltado() {
    Array.from(lista.children).forEach((el, i) => {
      el.setAttribute('aria-selected', i === resaltado ? 'true' : 'false');
    });
    if (resaltado >= 0) {
      const el = lista.children[resaltado];
      entrada.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ── Elegir ─────────────────────────────────────────────────────────── */

  function elegir(item) {
    elegido = item ? { id: item.id, nombre: item.nombre, extra: item } : null;
    entrada.value = item ? item.nombre : '';
    cerrar();
    alElegir?.(elegido);
  }

  async function crearNuevo(texto) {
    if (!alCrear) return;
    cerrar();
    const nuevo = await alCrear(texto);
    if (nuevo) elegir(nuevo);
    else entrada.focus();
  }

  /* ── Escribir ───────────────────────────────────────────────────────── */

  const consultar = esperarUnPoco(async (texto) => {
    const turno = ++pidiendo;
    try {
      const resultados = await buscar(texto);
      if (turno !== pidiendo) return;          // llegó tarde: ya hay otra consulta
      pintar(resultados || [], texto);
    } catch (e) {
      console.warn('[buscador] no se pudo buscar', e);
      pintar([], texto);
    }
  }, 180);

  entrada.addEventListener('input', () => {
    /* Al escribir se pierde lo elegido: el texto y el id vuelven a estar
       desalineados hasta que se elija de la lista. */
    if (elegido && entrada.value !== elegido.nombre) {
      elegido = null;
      alElegir?.(null);
    }
    const texto = entrada.value;
    if (!texto.trim()) { cerrar(); return; }
    consultar(texto);                           // sugerencias desde el primer carácter
  });

  entrada.addEventListener('focus', () => {
    if (entrada.value.trim() && !elegido) consultar(entrada.value);
  });

  entrada.addEventListener('blur', () => setTimeout(cerrar, 120));

  entrada.addEventListener('keydown', (e) => {
    if (lista.hidden) {
      if (e.key === 'ArrowDown' && entrada.value.trim()) consultar(entrada.value);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      resaltado = Math.min(resaltado + 1, lista.children.length - 1);
      marcarResaltado();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      resaltado = Math.max(resaltado - 1, 0);
      marcarResaltado();
    } else if (e.key === 'Enter') {
      if (resaltado >= 0) {
        e.preventDefault();
        const item = opciones[resaltado];
        if (item?.crear) crearNuevo(item.nombre);
        else elegir(item);
      }
    } else if (e.key === 'Escape') {
      cerrar();
    }
  });

  /* ── Interfaz pública ───────────────────────────────────────────────── */

  return {
    campo: caja,
    entrada,

    /** { id, nombre, texto } — id es null si lo escrito no se resolvió. */
    obtener() {
      return {
        id: elegido?.id ?? null,
        nombre: elegido?.nombre ?? null,
        texto: entrada.value.trim(),
        extra: elegido?.extra ?? null
      };
    },

    /** ¿Lo escrito corresponde a un registro real? */
    resuelto() {
      return Boolean(elegido?.id);
    },

    fijar(item) {
      elegido = item?.id ? { id: item.id, nombre: item.nombre, extra: item } : null;
      entrada.value = item?.nombre || '';
      cerrar();
    },

    /** Texto suelto, sin id: para reabrir una reserva guardada con
        cliente_texto y no perder lo ya escrito (R12). */
    fijarTexto(texto) {
      elegido = null;
      entrada.value = texto || '';
      cerrar();
    },

    limpiar() {
      elegido = null;
      entrada.value = '';
      cerrar();
    },

    enfocar() { entrada.focus(); },

    marcarFalta(mensaje) {
      entrada.style.borderColor = 'var(--error)';
      const previo = caja.querySelector('.campo-ayuda.texto-error');
      if (previo) previo.remove();
      caja.appendChild(crear('span', { clase: 'campo-ayuda texto-error', texto: mensaje }));
      entrada.addEventListener('input', function limpiarMarca() {
        entrada.style.borderColor = '';
        caja.querySelector('.campo-ayuda.texto-error')?.remove();
        entrada.removeEventListener('input', limpiarMarca);
      });
    }
  };
}
