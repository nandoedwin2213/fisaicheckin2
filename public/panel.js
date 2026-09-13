// Panel de caja: todo pasa por la misma API que usa el ESP32, con X-Staff-Key.
// La clave vive en sessionStorage: se borra al cerrar la pestaña y nunca se escribe en la URL.
const $ = (id) => document.getElementById(id);

const aviso = (texto, ok = true) => {
  const el = $('aviso');
  el.textContent = texto;
  el.className = ok ? 'ok' : 'err';
};

const clave = () => sessionStorage.getItem('staffKey') ?? '';

/** Bloquea el botón mientras dura la acción: dos clics no pueden cobrar dos veces. */
async function conBoton(boton, accion) {
  if (boton.disabled) return;
  boton.disabled = true;
  const etiqueta = boton.textContent;
  boton.textContent = 'Procesando…';
  try {
    await accion();
  } catch (e) {
    aviso(e.message, false);
  } finally {
    boton.disabled = false;
    boton.textContent = etiqueta;
  }
}

async function api(metodo, ruta, cuerpo) {
  const res = await fetch(ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Staff-Key': clave() },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(Array.isArray(datos.message) ? datos.message.join(', ') : (datos.message ?? `HTTP ${res.status}`));
  return datos;
}

const fecha = (iso) => new Date(iso).toLocaleDateString('es-EC');

function pintarSaldo(datos) {
  if (!datos.paquetes.length) {
    $('saldo').innerHTML = `<p><strong>${datos.paciente}</strong> no tiene paquetes.</p>`;
    return;
  }
  const filas = datos.paquetes
    .map(
      (p) => `<tr class="${p.vigente ? '' : 'vencido'}">
        <td>${p.paquete}</td><td>${p.serviceType}</td>
        <td>${p.sesionesRestantes}</td><td>${p.creditosRestantes}</td>
        <td>${fecha(p.venceEn)}${p.vigente ? '' : ' (vencido)'}</td>
      </tr>`,
    )
    .join('');
  $('saldo').innerHTML = `<p><strong>${datos.paciente}</strong></p>
    <table><thead><tr><th>Paquete</th><th>Servicio</th><th>Sesiones</th><th>Créditos</th><th>Vence</th></tr></thead>
    <tbody>${filas}</tbody></table>`;
}

/** `silencioso` refresca la tabla sin pisar el mensaje de la recarga o del check-in. */
async function buscar(silencioso = false) {
  const cedula = $('cedula').value.trim();
  if (!cedula) {
    $('saldo').innerHTML = '';
    if (!silencioso) aviso('Ingresa la cédula del paciente', false);
    return;
  }
  try {
    pintarSaldo(await api('GET', `/recargas/${cedula}`));
    if (!silencioso) aviso('Saldo actualizado');
  } catch (e) {
    $('saldo').innerHTML = '';
    if (!silencioso) aviso(e.message, false);
  }
}

async function cargarCatalogos() {
  const [paquetes, terminales] = await Promise.all([api('GET', '/admin/paquetes'), api('GET', '/admin/terminales')]);
  $('paquete').innerHTML = paquetes
    .map((p) => `<option value="${p.id}">${p.nombre} — ${p.sesiones} ses. / ${p.creditos} cr. — $${p.precio}</option>`)
    .join('');
  $('terminal').innerHTML = terminales
    .map((t) => `<option value="${t.id}">${t.nombre}${t.equipo ? ` (${t.equipo}, ${t.modo})` : ''}</option>`)
    .join('');
}

$('entrar').onclick = (ev) =>
  conBoton(ev.currentTarget, async () => {
    sessionStorage.setItem('staffKey', $('staffKey').value);
    await cargarCatalogos();
    $('panel').classList.remove('oculto');
    aviso('Sesión iniciada');
  });

$('buscar').onclick = (ev) => conBoton(ev.currentTarget, () => buscar());

$('recargar').onclick = (ev) =>
  conBoton(ev.currentTarget, async () => {
    const res = await api('POST', '/recargas', {
      cedula: $('cedula').value.trim(),
      packageId: $('paquete').value,
      registradoPor: $('registradoPor').value.trim() || undefined,
    });
    await buscar(true);
    aviso(`Recargado a ${res.paciente}: ${res.sesionesRestantes} sesiones, ${res.creditosRestantes} créditos`);
  });

$('checkin').onclick = (ev) =>
  conBoton(ev.currentTarget, async () => {
    const res = await api('POST', '/checkin/manual', {
      cedula: $('cedula').value.trim(),
      terminalId: $('terminal').value,
      registradoPor: $('registradoPor').value.trim() || undefined,
    });
    await buscar(true);
    aviso(res.ok ? `OK ${res.paciente} — ${res.modo ?? 'SESIONES'}` : `Rechazado: ${res.resultado}`, res.ok);
  });

$('crear').onclick = (ev) =>
  conBoton(ev.currentTarget, async () => {
    const res = await api('POST', '/admin/pacientes', {
      cedula: $('nuevaCedula').value.trim(),
      nombre: $('nuevoNombre').value.trim(),
      uid: $('nuevoUid').value.trim() || undefined,
    });
    $('cedula').value = res.cedula;
    await buscar(true);
    aviso(`Paciente ${res.nombre} creado${res.uid ? ` con tarjeta ${res.uid}` : ''}`);
  });

if (clave()) $('staffKey').value = clave();
