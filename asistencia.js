// ===========================================================================
//  ASISTENCIA
//
//  Registro INDEPENDIENTE de los masajes. El sistema nunca asume que una
//  masajista estuvo presente solo porque realizó un masaje: alguien puede
//  estar presente y no atender a nadie.
// ===========================================================================
import { hoy, fechaLarga, hora12, escapar, mensajeError } from './core.js';
import { $, avisar, esqueleto, vacio } from './ui.js';
import * as D from './datos.js';

const ESTADOS = ['presente', 'falta', 'tardanza', 'descanso', 'vacaciones', 'licencia', 'justificada'];
const ETIQUETA = {
  presente: 'Presente', falta: 'Falta', tardanza: 'Tardanza', descanso: 'Descanso',
  vacaciones: 'Vacaciones', licencia: 'Licencia', justificada: 'Justificada'
};

export async function vistaAsistencia(fecha = hoy()) {
  const v = $('#vista');
  v.innerHTML = `
    <div class="barra-acciones">
      <input type="date" id="as-fecha" value="${fecha}"
             style="padding:12px 14px;border-radius:10px;font-size:15px;
                    border:1.5px solid var(--borde-fuerte);background:var(--superficie);color:inherit">
    </div>
    <p class="eyebrow" style="margin:-8px 0 16px">${escapar(fechaLarga(fecha))}</p>
    <div id="as-lista">${esqueleto(5)}</div>`;

  $('#as-fecha').onchange = e => vistaAsistencia(e.target.value);

  try {
    const [activas, ya] = await Promise.all([D.masajistas('activa'), D.asistenciasDe(fecha)]);
    if (!activas.length) { $('#as-lista').innerHTML = vacio('No hay masajistas activas.'); return; }

    const previo = Object.fromEntries(ya.map(a => [a.masajista_id, a]));

    $('#as-lista').innerHTML = `
      <div class="panel"><div class="panel__cuerpo">
        ${activas.map(m => {
          const a = previo[m.id] || {};
          return `<div style="padding:14px 0;border-bottom:1px solid var(--borde)" data-fila="${m.id}">
            <strong style="font-size:18px">${escapar(`${m.nombre} ${m.apellido || ''}`.trim())}</strong>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0">
              ${ESTADOS.map(e => `<button class="btn ${a.estado === e ? 'btn--suave' : 'btn--neutro'}"
                  data-estado="${e}" style="padding:9px 14px;min-height:44px;font-size:14.5px">
                  ${ETIQUETA[e]}</button>`).join('')}
            </div>
            <div class="fila">
              <label class="campo" style="margin-bottom:8px"><span>Entrada</span>
                <input type="time" data-campo="hora_ingreso" value="${a.hora_ingreso?.slice(0,5) || ''}"></label>
              <label class="campo" style="margin-bottom:8px"><span>Salida</span>
                <input type="time" data-campo="hora_salida" value="${a.hora_salida?.slice(0,5) || ''}"></label>
            </div>
            <input type="text" data-campo="observaciones" placeholder="Observación (opcional)"
                   value="${escapar(a.observaciones || '')}"
                   style="width:100%;padding:11px 13px;border-radius:10px;font-size:15px;
                          border:1.5px solid var(--borde);background:var(--superficie);color:inherit">
          </div>`;
        }).join('')}
        <button class="btn btn--principal btn--bloque" id="as-guardar"
                style="margin-top:18px">Guardar asistencia</button>
      </div></div>`;

    // Marcado rápido: se elige el estado sin abrir ningún formulario.
    $('#as-lista').querySelectorAll('[data-fila]').forEach(fila => {
      fila.querySelectorAll('[data-estado]').forEach(b => b.onclick = () => {
        fila.querySelectorAll('[data-estado]').forEach(x => {
          x.classList.toggle('btn--suave', x === b);
          x.classList.toggle('btn--neutro', x !== b);
        });
        // Al marcar presente sin hora, se precarga la hora actual.
        const entrada = fila.querySelector('[data-campo=hora_ingreso]');
        if ((b.dataset.estado === 'presente' || b.dataset.estado === 'tardanza') && !entrada.value) {
          const d = new Date();
          entrada.value = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        }
      });
    });

    $('#as-guardar').onclick = async e => {
      e.currentTarget.disabled = true;
      try {
        for (const fila of $('#as-lista').querySelectorAll('[data-fila]')) {
          const elegido = fila.querySelector('.btn--suave[data-estado]');
          if (!elegido) continue;
          await D.guardarAsistencia({
            masajista_id: fila.dataset.fila,
            fecha,
            estado: elegido.dataset.estado,
            hora_ingreso: fila.querySelector('[data-campo=hora_ingreso]').value || null,
            hora_salida:  fila.querySelector('[data-campo=hora_salida]').value || null,
            observaciones: fila.querySelector('[data-campo=observaciones]').value.trim() || null
          });
        }
        avisar('Asistencia guardada', 'exito');
        vistaAsistencia(fecha);
      } catch (ex) { avisar(mensajeError(ex), 'error'); e.currentTarget.disabled = false; }
    };
  } catch (ex) { $('#as-lista').innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
}
