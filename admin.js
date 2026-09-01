/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — admin.js
   Tres secciones de administración y una que ve todo el mundo:

     · USUARIOS Y DISPOSITIVOS (§3.1, §3.3) — solo Administrador
     · AUDITORÍA (§5.14)                    — solo Administrador
     · CONFIGURACIÓN                        — ambos roles, cada uno lo suyo

   Aquí es donde el sistema dice en pantalla el límite real de la
   revocación por dispositivo, en vez de disimularlo. No es un descuido
   dejarlo escrito: alguien tiene que saberlo el día que pierda un equipo.
   ══════════════════════════════════════════════════════════════════════ */

import { estado, esAdmin, crear, vaciar, preferencia, traducirError } from './core.js';
import {
  usuarios as traerUsuarios, cambiarRol, activarUsuario,
  dispositivos as traerDispositivos, revocarDispositivo, auditoria as traerAuditoria
} from './datos.js';
import { pedirCambioDePin, cambiarMinutosBloqueo, cerrarSesion } from './acceso.js';
import {
  cabeceraVista, celda, esqueleto, vacio, confirmar,
  aviso, avisoError, campo, abrirHoja
} from './ui.js';
import { fechaCorta, fechaHora, hoy, sumarDias } from './formato.js';

export const tablas = ['perfiles', 'dispositivos', 'auditoria'];

let contenedor = null;
let seccion = 'configuracion';

export async function montar(donde, opciones = {}) {
  contenedor = donde;
  seccion = opciones.seccion || 'configuracion';
  await cargar();
}

export function desmontar() {
  contenedor = null;
}

export async function refrescar() {
  if (contenedor) await cargar({ silencioso: true });
}

async function cargar({ silencioso = false } = {}) {
  if (!silencioso) vaciar(contenedor).appendChild(esqueleto(5));
  if (seccion === 'usuarios') await pintarUsuarios();
  else if (seccion === 'auditoria') await pintarAuditoria();
  else pintarConfiguracion();
}

/* ══════════════════════════════════════════════════════════════════════
   USUARIOS Y DISPOSITIVOS  [admin]
   ══════════════════════════════════════════════════════════════════════ */

async function pintarUsuarios() {
  vaciar(contenedor);
  contenedor.appendChild(cabeceraVista('Usuarios y dispositivos'));

  /* Las cuentas se crean desde el panel de Supabase, no desde aquí: crear
     un usuario requiere privilegios que jamás pueden estar en el
     navegador. Lo que sí se hace aquí es asignar rol y activar o
     desactivar. */
  contenedor.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'Las cuentas nuevas se crean desde el panel de Supabase (Authentication → Users). Aquí se les asigna el rol y se activan o desactivan.'
  }));

  let lista = [];
  try {
    lista = await traerUsuarios();
  } catch (e) {
    contenedor.appendChild(vacio('No se pudieron cargar los usuarios', e.amable ? e.message : ''));
    return;
  }

  const envoltura = crear('div', { clase: 'tabla-envoltura' });
  const tabla = crear('table', { clase: 'tabla' });
  const thead = crear('thead');
  const tr = crear('tr');
  ['Nombre', 'Rol', 'Estado', 'Desde', ''].forEach((t) => tr.appendChild(crear('th', { texto: t })));
  thead.appendChild(tr);
  tabla.appendChild(thead);

  const tbody = crear('tbody');
  lista.forEach((u) => {
    const fila = crear('tr');
    fila.appendChild(celda(u.nombre));

    const tdRol = crear('td');
    const sRol = crear('select', { atributos: { style: 'min-height:44px' } });
    [['recepcion', 'Recepción'], ['admin', 'Administración']].forEach(([v, t]) =>
      sRol.appendChild(crear('option', { texto: t, atributos: { value: v } })));
    sRol.value = u.rol;
    sRol.disabled = u.id === estado.perfil.id;   // nadie se quita a sí mismo el rol
    sRol.addEventListener('change', async () => {
      try {
        await cambiarRol(u.id, sRol.value);
        aviso('Rol actualizado');
      } catch (e) {
        sRol.value = u.rol;
        avisoError(e.amable ? e.message : traducirError(e));
      }
    });
    tdRol.appendChild(sRol);
    fila.appendChild(tdRol);

    const tdEstado = crear('td');
    tdEstado.appendChild(crear('span', {
      clase: `pastilla ${u.activo ? 'pastilla-atendido' : 'pastilla-cancelado'}`,
      texto: u.activo ? 'Activo' : 'Desactivado'
    }));
    fila.appendChild(tdEstado);

    fila.appendChild(celda(fechaCorta(u.created_at)));

    const tdAccion = crear('td');
    if (u.id !== estado.perfil.id) {
      tdAccion.appendChild(crear('button', {
        clase: 'boton-enlace',
        texto: u.activo ? 'Desactivar' : 'Activar',
        atributos: { type: 'button' },
        al: { click: () => cambiarActivo(u) }
      }));
    }
    fila.appendChild(tdAccion);

    tbody.appendChild(fila);
  });
  tabla.appendChild(tbody);
  envoltura.appendChild(tabla);
  contenedor.appendChild(envoltura);

  await pintarDispositivos();
}

async function cambiarActivo(u) {
  /* Desactivar a la persona SÍ es una barrera dura: sus consultas dejan
     de devolver datos en todas las policies. */
  const seguro = await confirmar({
    titulo: u.activo ? `Desactivar a ${u.nombre}` : `Activar a ${u.nombre}`,
    texto: u.activo
      ? 'No podrá entrar ni consultar nada desde ningún dispositivo, aunque tenga la sesión abierta. Es la forma más segura de cortarle el acceso.'
      : 'Volverá a poder entrar con su correo y contraseña.',
    aceptar: u.activo ? 'Desactivar' : 'Activar',
    peligro: u.activo
  });
  if (!seguro) return;

  try {
    await activarUsuario(u.id, !u.activo);
    aviso(u.activo ? 'Usuario desactivado' : 'Usuario activado');
    await refrescar();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}

async function pintarDispositivos() {
  contenedor.appendChild(crear('p', {
    clase: 'campo-etiqueta',
    atributos: { style: 'margin-top:26px' },
    texto: 'Dispositivos activos'
  }));

  let lista = [];
  try {
    lista = await traerDispositivos();
  } catch (e) {
    contenedor.appendChild(crear('p', { clase: 'campo-ayuda', texto: 'No se pudieron cargar los dispositivos.' }));
    return;
  }

  if (!lista.length) {
    contenedor.appendChild(crear('p', { clase: 'campo-ayuda', texto: 'Todavía no hay dispositivos registrados.' }));
  } else {
    const envoltura = crear('div', { clase: 'tabla-envoltura' });
    const tabla = crear('table', { clase: 'tabla' });
    const thead = crear('thead');
    const tr = crear('tr');
    ['Dispositivo', 'Usuario', 'Último acceso', 'Estado', ''].forEach((t) =>
      tr.appendChild(crear('th', { texto: t })));
    thead.appendChild(tr);
    tabla.appendChild(thead);

    const tbody = crear('tbody');
    lista.forEach((d) => {
      const fila = crear('tr');
      fila.appendChild(celda(d.nombre));
      fila.appendChild(celda(d.usuario?.nombre));
      fila.appendChild(celda(d.ultimo_acceso ? fechaHora(d.ultimo_acceso) : null));

      const tdEstado = crear('td');
      tdEstado.appendChild(crear('span', {
        clase: `pastilla ${d.revocado ? 'pastilla-cancelado' : 'pastilla-atendido'}`,
        texto: d.revocado ? 'Revocado' : 'Autorizado'
      }));
      fila.appendChild(tdEstado);

      const tdAccion = crear('td');
      if (!d.revocado) {
        tdAccion.appendChild(crear('button', {
          clase: 'boton-enlace',
          texto: 'Revocar',
          atributos: { type: 'button' },
          al: { click: () => revocar(d) }
        }));
      }
      fila.appendChild(tdAccion);
      tbody.appendChild(fila);
    });
    tabla.appendChild(tbody);
    envoltura.appendChild(tabla);
    contenedor.appendChild(envoltura);
  }

  /* Lo que la aplicación declara en pantalla, sin adornos (§3.3). */
  const aviso_ = crear('div', { clase: 'tarjeta', atributos: { style: 'margin-top:16px' } });
  aviso_.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Qué protege revocar un dispositivo, y qué no' }));
  [
    'La revocación es casi inmediata, pero no instantánea: si la pantalla de ese equipo ya está cargada, esos datos siguen viéndose hasta que se refresque o intente cualquier acción.',
    'La identificación del dispositivo viaja en un dato que controla el navegador y alguien con conocimientos técnicos puede falsificarla. Por eso, si de verdad hay que cortar el acceso, la barrera dura es DESACTIVAR A LA PERSONA, no revocar el equipo.',
    'Si roban un equipo con la aplicación abierta y desbloqueada, el PIN no protege nada en ese momento. La única defensa real en esa ventana es un tiempo de bloqueo corto.'
  ].forEach((t) => aviso_.appendChild(crear('p', { clase: 'campo-ayuda', atributos: { style: 'margin-top:8px' }, texto: t })));
  contenedor.appendChild(aviso_);
}

async function revocar(d) {
  const seguro = await confirmar({
    titulo: `Revocar "${d.nombre}"`,
    texto: 'Ese equipo dejará de poder consultar datos. Si quien lo tiene sigue siendo un usuario activo, podría volver a entrar desde otro dispositivo.',
    aceptar: 'Revocar',
    peligro: true
  });
  if (!seguro) return;

  try {
    await revocarDispositivo(d.id);
    aviso('Dispositivo revocado');
    await refrescar();
  } catch (e) {
    avisoError(e.amable ? e.message : traducirError(e));
  }
}

/* ══════════════════════════════════════════════════════════════════════
   AUDITORÍA  [admin]
   ══════════════════════════════════════════════════════════════════════ */

const ACCIONES = {
  INSERT: 'Creó', UPDATE: 'Modificó', DELETE: 'Eliminó'
};

async function pintarAuditoria() {
  vaciar(contenedor);
  contenedor.appendChild(cabeceraVista('Auditoría'));

  const caja = crear('div', { atributos: { style: 'display:flex;flex-wrap:wrap;gap:14px;margin-bottom:18px' } });
  const { campo: c1, entrada: e1 } = campo('Desde', { tipo: 'date', valor: sumarDias(hoy(), -7) });
  const { campo: c2, entrada: e2 } = campo('Hasta', { tipo: 'date', valor: hoy() });
  [c1, c2].forEach((c) => { c.style.flex = '1 1 150px'; c.style.marginBottom = '0'; });

  const lugar = crear('div');

  const boton = crear('button', {
    clase: 'boton-secundario',
    texto: 'Ver movimientos',
    atributos: { type: 'button', style: 'width:auto;align-self:flex-end' },
    al: { click: () => listar(e1.value, e2.value) }
  });

  caja.append(c1, c2, boton);
  contenedor.append(caja, lugar);

  async function listar(desde, hasta) {
    vaciar(lugar).appendChild(esqueleto(5, { conTitulo: false }));
    try {
      const filas = await traerAuditoria({ desde, hasta, limite: 300 });
      vaciar(lugar);

      if (!filas.length) {
        lugar.appendChild(vacio('Sin movimientos en ese rango', 'Prueba ampliando las fechas.'));
        return;
      }

      const envoltura = crear('div', { clase: 'tabla-envoltura' });
      const tabla = crear('table', { clase: 'tabla' });
      const thead = crear('thead');
      const tr = crear('tr');
      ['Cuándo', 'Quién', 'Qué hizo', 'Dónde', ''].forEach((t) => tr.appendChild(crear('th', { texto: t })));
      thead.appendChild(tr);
      tabla.appendChild(thead);

      const tbody = crear('tbody');
      filas.forEach((a) => {
        const fila = crear('tr', { datos: { abrible: 'si' } });
        fila.addEventListener('click', () => verDetalle(a));
        fila.appendChild(celda(fechaHora(a.created_at)));
        fila.appendChild(celda(a.usuario?.nombre));
        fila.appendChild(celda(ACCIONES[a.accion] || a.accion));
        fila.appendChild(celda(a.tabla_afectada));
        fila.appendChild(celda('Ver detalle'));
        tbody.appendChild(fila);
      });
      tabla.appendChild(tbody);
      envoltura.appendChild(tabla);
      lugar.appendChild(envoltura);
    } catch (e) {
      vaciar(lugar).appendChild(vacio('No se pudo cargar la auditoría', e.amable ? e.message : ''));
    }
  }

  listar(sumarDias(hoy(), -7), hoy());
}

function verDetalle(a) {
  const cuerpo = crear('div');

  [['Cuándo', fechaHora(a.created_at)],
   ['Quién', a.usuario?.nombre || '—'],
   ['Qué hizo', ACCIONES[a.accion] || a.accion],
   ['Dónde', a.tabla_afectada]].forEach(([etiqueta, valor]) => {
    const linea = crear('div', { clase: 'linea-calculo' });
    linea.append(crear('span', { texto: etiqueta }), crear('span', { texto: valor }));
    cuerpo.appendChild(linea);
  });

  [['Antes', a.datos_anteriores], ['Después', a.datos_nuevos]].forEach(([titulo, datos]) => {
    if (!datos) return;
    cuerpo.appendChild(crear('p', { clase: 'campo-etiqueta', atributos: { style: 'margin-top:16px' }, texto: titulo }));
    const pre = crear('pre', {
      texto: JSON.stringify(datos, null, 2),
      atributos: { style: 'white-space:pre-wrap;word-break:break-word;font-size:13px;background:var(--superficie-alt);padding:12px;border-radius:10px;overflow-x:auto' }
    });
    cuerpo.appendChild(pre);
  });

  abrirHoja({ titulo: 'Movimiento', contenido: cuerpo });
}

/* ══════════════════════════════════════════════════════════════════════
   CONFIGURACIÓN  (ambos roles)
   ══════════════════════════════════════════════════════════════════════ */

function pintarConfiguracion() {
  vaciar(contenedor);
  contenedor.appendChild(cabeceraVista('Configuración'));

  /* Mi cuenta */
  const cuenta = crear('div', { clase: 'tarjeta' });
  cuenta.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Mi cuenta' }));
  [['Nombre', estado.perfil?.nombre], ['Correo', estado.perfil?.correo],
   ['Rol', esAdmin() ? 'Administración' : 'Recepción']].forEach(([e, v]) => {
    const linea = crear('div', { clase: 'linea-calculo' });
    linea.append(crear('span', { texto: e }), crear('span', { texto: v || '—' }));
    cuenta.appendChild(linea);
  });

  cuenta.appendChild(crear('button', {
    clase: 'boton-secundario',
    texto: 'Cambiar PIN',
    atributos: { type: 'button', style: 'width:auto;margin-top:14px' },
    al: { click: () => pedirCambioDePin() }
  }));
  contenedor.appendChild(cuenta);

  /* Bloqueo */
  const bloqueo = crear('div', { clase: 'tarjeta' });
  bloqueo.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Bloqueo por inactividad' }));
  bloqueo.appendChild(crear('p', {
    clase: 'campo-ayuda',
    texto: 'Cuanto más corto, más seguro. Quince minutos es cómodo, pero deja una ventana más larga si alguien se lleva el equipo desbloqueado.'
  }));

  const opciones = crear('div', { clase: 'opciones', atributos: { style: 'margin-top:10px' } });
  [[1, '1 minuto'], [5, '5 minutos'], [10, '10 minutos'], [15, '15 minutos'], [0, 'Nunca']]
    .forEach(([minutos, texto]) => {
      opciones.appendChild(crear('button', {
        clase: 'opcion',
        texto,
        atributos: {
          type: 'button',
          'aria-pressed': Number(estado.perfil?.bloqueo_minutos ?? 15) === minutos ? 'true' : 'false'
        },
        al: {
          click: async (e) => {
            try {
              await cambiarMinutosBloqueo(minutos);
              Array.from(opciones.children).forEach((b) => b.setAttribute('aria-pressed', 'false'));
              e.currentTarget.setAttribute('aria-pressed', 'true');
              aviso(minutos ? `Se bloqueará tras ${texto.toLowerCase()} sin uso` : 'La aplicación ya no se bloqueará sola');
            } catch (err) {
              avisoError(err.amable ? err.message : traducirError(err));
            }
          }
        }
      }));
    });
  bloqueo.appendChild(opciones);
  contenedor.appendChild(bloqueo);

  /* Apariencia */
  const tema = crear('div', { clase: 'tarjeta' });
  tema.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Apariencia' }));
  const opcionesTema = crear('div', { clase: 'opciones' });
  const actual = preferencia('tema') || 'automatico';
  [['automatico', 'Como el sistema'], ['claro', 'Claro'], ['oscuro', 'Oscuro']].forEach(([clave, texto]) => {
    opcionesTema.appendChild(crear('button', {
      clase: 'opcion',
      texto,
      atributos: { type: 'button', 'aria-pressed': actual === clave ? 'true' : 'false' },
      al: {
        click: (e) => {
          preferencia('tema', clave);
          if (clave === 'automatico') document.documentElement.removeAttribute('data-tema');
          else document.documentElement.setAttribute('data-tema', clave);
          Array.from(opcionesTema.children).forEach((b) => b.setAttribute('aria-pressed', 'false'));
          e.currentTarget.setAttribute('aria-pressed', 'true');
        }
      }
    }));
  });
  tema.appendChild(opcionesTema);
  contenedor.appendChild(tema);

  /* Este dispositivo */
  const equipo = crear('div', { clase: 'tarjeta' });
  equipo.appendChild(crear('p', { clase: 'titulo-tarjeta', texto: 'Este dispositivo' }));

  const { campo: cNombre, entrada: eNombre } = campo('Nombre con el que se identifica', {
    valor: preferencia('dispositivoNombre') || '',
    ayuda: 'Es el que aparece en la lista de dispositivos de administración.'
  });
  eNombre.addEventListener('change', () => {
    preferencia('dispositivoNombre', eNombre.value.trim());
    aviso('Nombre guardado. Se aplicará la próxima vez que entres.');
  });
  equipo.appendChild(cNombre);

  equipo.appendChild(crear('button', {
    clase: 'boton-peligro',
    texto: 'Cerrar sesión en este dispositivo',
    atributos: { type: 'button', style: 'width:auto;margin-top:10px' },
    al: {
      click: async () => {
        const seguro = await confirmar({
          titulo: 'Cerrar sesión',
          texto: 'Para volver a entrar harán falta el correo y la contraseña.',
          aceptar: 'Cerrar sesión',
          peligro: true
        });
        if (seguro) await cerrarSesion();
      }
    }
  }));
  contenedor.appendChild(equipo);
}
