// ===========================================================================
//  USUARIOS Y EQUIPOS · AUDITORÍA · CONFIGURACIÓN
// ===========================================================================
import { sb, estado, esAdmin, fechaCorta, escapar, mensajeError, DISPOSITIVO } from './core.js';
import { $, abrirHoja, cerrarHoja, avisar, confirmar, esqueleto, vacio } from './ui.js';
import * as D from './datos.js';

// ---------------------------------------------------------------------------
//  USUARIOS Y EQUIPOS
// ---------------------------------------------------------------------------
export async function vistaUsuarios() {
  const v = $('#vista');
  v.innerHTML = esqueleto(4);
  try {
    const [gente, equipos] = await Promise.all([D.perfiles(), D.dispositivos()]);

    v.innerHTML = `
      <div class="panel">
        <div class="panel__cabecera"><span class="eyebrow">Personas</span></div>
        <div class="tabla-envoltura"><table class="a-tarjetas">
          <thead><tr><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody>${gente.map(p => `<tr>
            <td class="destacado">${escapar(p.nombre)}</td>
            <td data-etiqueta="Rol">${p.rol === 'admin' ? 'Administradora' : 'Recepción'}</td>
            <td data-etiqueta="Estado">${p.activo
              ? '<span class="insignia insignia--atendido">Activa</span>'
              : '<span class="insignia insignia--cancelado">Desactivada</span>'}</td>
            <td>${p.id === estado.usuario.id ? '<span class="vacio">Tú</span>'
              : `<button class="btn btn--neutro" data-usuario="${p.id}"
                   style="padding:9px 15px;min-height:44px">Gestionar</button>`}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="panel__cuerpo" style="border-top:1px solid var(--borde)">
          <p class="ayuda" style="margin:0">Las cuentas nuevas se crean desde Supabase, en
             Authentication → Users, con la metadata <code>{"nombre":"…","rol":"recepcion"}</code>.</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel__cabecera"><span class="eyebrow">Equipos con acceso</span></div>
        <div class="tabla-envoltura"><table class="a-tarjetas">
          <thead><tr><th>Equipo</th><th>Persona</th><th>Último acceso</th><th></th></tr></thead>
          <tbody>${equipos.map(d => `<tr>
            <td class="destacado">${escapar(d.nombre)}${d.device_id === DISPOSITIVO ? ' · este' : ''}</td>
            <td data-etiqueta="Persona">${escapar(d.usuario?.nombre || '—')}</td>
            <td data-etiqueta="Último acceso">${fechaCorta(d.ultimo_acceso?.slice(0,10))}</td>
            <td>${d.revocado ? '<span class="insignia insignia--cancelado">Revocado</span>'
              : `<button class="btn btn--peligro" data-equipo="${d.id}"
                   style="padding:9px 15px;min-height:44px">Revocar</button>`}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="panel__cuerpo" style="border-top:1px solid var(--borde)">
          <p class="ayuda" style="margin:0">
            Si roban un equipo, lo más seguro es <strong>desactivar a la persona</strong>: eso es una
            barrera real que no se puede saltar. Revocar solo el equipo funciona en la práctica, pero
            alguien con conocimientos técnicos podría eludirlo.</p>
        </div>
      </div>`;

    v.querySelectorAll('[data-usuario]').forEach(b => b.onclick = () =>
      gestionar(gente.find(p => p.id === b.dataset.usuario)));

    v.querySelectorAll('[data-equipo]').forEach(b => b.onclick = async () => {
      const ok = await confirmar({ titulo: 'Revocar equipo', peligro: true, aceptar: 'Revocar',
        texto: 'Ese equipo dejará de poder leer y escribir información. Si ya tiene una pantalla cargada, seguirá viéndola hasta que intente cualquier acción.' });
      if (!ok) return;
      try { await D.revocarDispositivo(b.dataset.equipo); avisar('Equipo revocado', 'exito'); vistaUsuarios(); }
      catch (ex) { avisar(mensajeError(ex), 'error'); }
    });
  } catch (ex) { v.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
}

function gestionar(p) {
  const cuerpo = abrirHoja(p.nombre, `
    <label class="campo"><span>Rol</span>
      <select id="u-rol">
        <option value="recepcion" ${p.rol === 'recepcion' ? 'selected' : ''}>Recepción</option>
        <option value="admin" ${p.rol === 'admin' ? 'selected' : ''}>Administradora</option>
      </select></label>
    <p class="ayuda" style="margin:-10px 0 20px">Recepción hace el mismo trabajo diario, pero no ve
       el dinero acumulado: Resumen, Caja, Reportes ni el cierre.</p>
    <button class="btn ${p.activo ? 'btn--peligro' : 'btn--principal'} btn--bloque" id="u-activo">
      ${p.activo ? 'Desactivar esta persona' : 'Volver a activar'}</button>
    ${p.activo ? '<p class="ayuda">Desactivar corta el acceso desde todos sus equipos, de inmediato y sin excepción.</p>' : ''}`);

  cuerpo.querySelector('#u-rol').onchange = async e => {
    try { await D.cambiarRol(p.id, e.target.value); avisar('Rol actualizado', 'exito'); }
    catch (ex) { avisar(mensajeError(ex), 'error'); }
  };

  cuerpo.querySelector('#u-activo').onclick = async () => {
    try {
      await D.activarUsuario(p.id, !p.activo);
      avisar(p.activo ? 'Persona desactivada' : 'Persona activada', 'exito');
      cerrarHoja(); vistaUsuarios();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  };
}

// ---------------------------------------------------------------------------
//  AUDITORÍA
// ---------------------------------------------------------------------------
export async function vistaAuditoria() {
  const v = $('#vista');
  v.innerHTML = esqueleto(8);
  try {
    const filas = await D.auditoria(200);
    v.innerHTML = filas.length ? `
      <div class="panel"><div class="tabla-envoltura"><table class="a-tarjetas">
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué pasó</th></tr></thead>
        <tbody>${filas.map(a => {
          const f = new Date(a.created_at);
          return `<tr>
            <td data-etiqueta="Cuándo">${f.toLocaleString('es-PE', { day: '2-digit', month: '2-digit',
              hour: 'numeric', minute: '2-digit', hour12: true })}</td>
            <td data-etiqueta="Quién">${escapar(a.usuario?.nombre || 'Sistema')}</td>
            <td class="destacado">${escapar(a.descripcion || `${a.accion} en ${a.tabla_afectada}`)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div></div>` : vacio('Todavía no hay movimientos registrados.');
  } catch (ex) { v.innerHTML = `<p class="error">${escapar(mensajeError(ex))}</p>`; }
}

// ---------------------------------------------------------------------------
//  CONFIGURACIÓN
// ---------------------------------------------------------------------------
export async function vistaConfiguracion() {
  const v = $('#vista');
  const min = estado.usuario.bloqueo_minutos;

  v.innerHTML = `
    <div class="panel">
      <div class="panel__cabecera"><span class="eyebrow">Bloqueo por inactividad</span></div>
      <div class="panel__cuerpo">
        <p class="ayuda" style="margin:0 0 12px">¿Cuánto tiempo sin tocar la aplicación antes de pedir el PIN?</p>
        <div class="barra-acciones" style="margin:0">
          ${[[1,'1 minuto'],[5,'5 minutos'],[10,'10 minutos'],[15,'15 minutos'],[0,'Nunca']].map(([k,t]) =>
            `<button class="btn ${min === k ? 'btn--suave' : 'btn--neutro'}" data-bloqueo="${k}">${t}</button>`).join('')}
        </div>
        <p class="ayuda">15 minutos es cómodo para el día a día, pero si roban el equipo con la aplicación
           abierta quedan hasta 15 minutos de acceso libre. Bajarlo a 5 es la única defensa real en esa ventana.</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel__cabecera"><span class="eyebrow">Tu cuenta</span></div>
      <div class="panel__cuerpo">
        <button class="btn btn--neutro btn--bloque" id="cf-pin">Cambiar mi PIN</button>
      </div>
    </div>`;

  v.querySelectorAll('[data-bloqueo]').forEach(b => b.onclick = async () => {
    const n = Number(b.dataset.bloqueo);
    try {
      await sb.from('perfiles').update({ bloqueo_minutos: n }).eq('id', estado.usuario.id);
      estado.usuario.bloqueo_minutos = n;
      avisar('Guardado', 'exito');
      vistaConfiguracion();
    } catch (ex) { avisar(mensajeError(ex), 'error'); }
  });

  $('#cf-pin').onclick = cambiarPin;
}

function cambiarPin() {
  const cuerpo = abrirHoja('Cambiar mi PIN', `
    <label class="campo"><span>PIN actual</span>
      <input type="password" id="p-actual" inputmode="numeric" maxlength="4"></label>
    <label class="campo"><span>PIN nuevo</span>
      <input type="password" id="p-nuevo" inputmode="numeric" maxlength="4"></label>
    <label class="campo"><span>Repite el PIN nuevo</span>
      <input type="password" id="p-repite" inputmode="numeric" maxlength="4"></label>
    <p class="error" id="p-error" hidden></p>
    <button class="btn btn--principal btn--bloque" id="p-ok">Guardar PIN</button>`);

  cuerpo.querySelector('#p-ok').onclick = async () => {
    const err = cuerpo.querySelector('#p-error');
    const a = cuerpo.querySelector('#p-nuevo').value;
    err.hidden = true;
    if (!/^[0-9]{4}$/.test(a)) { err.textContent = 'El PIN son cuatro números.'; err.hidden = false; return; }
    if (a !== cuerpo.querySelector('#p-repite').value) {
      err.textContent = 'Los dos PIN nuevos no coinciden.'; err.hidden = false; return;
    }
    try {
      const { data, error } = await sb.rpc('cambiar_pin', {
        p_actual: cuerpo.querySelector('#p-actual').value, p_nuevo: a
      });
      if (error) throw error;
      if (!data) { err.textContent = 'El PIN actual no es correcto.'; err.hidden = false; return; }
      avisar('PIN cambiado', 'exito');
      cerrarHoja();
    } catch (ex) { err.textContent = mensajeError(ex); err.hidden = false; }
  };
}

// Adhamar es siempre blanco y dorado: no hay tema oscuro.
// Se conserva la función (y su firma) porque app.js la llama al arrancar.
export function aplicarTema() {
  try { localStorage.removeItem('adhamar.tema'); } catch {}
  document.documentElement.setAttribute('data-tema', 'claro');
  document.querySelectorAll('meta[name=theme-color]').forEach(m =>
    m.setAttribute('content', '#FFFFFF'));
}
