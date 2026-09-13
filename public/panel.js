// Panel de caja: todo pasa por la misma API que usa el ESP32, con X-Staff-Key.
// La clave vive en sessionStorage: se borra al cerrar la pestaña y nunca se escribe en la URL.
const $ = (id) => document.getElementById(id);

const aviso = (texto, ok = true) => {
  const el = $('aviso');
  el.textContent = texto;
  el.className = ok ? 'ok' : 'err';
};

const clave = () => sessionStorage.getItem('staffKey') ?? '';

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

async function buscar() {
  try {
    pintarSaldo(await api('GET', `/recargas/${$('cedula').value.trim()}`));
    aviso('Saldo actualizado');
  } catch (e) {
    $('saldo').innerHTML = '';
    aviso(e.message, false);
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

$('entrar').onclick = async () => {
  sessionStorage.setItem('staffKey', $('staffKey').value);
  try {
    await cargarCatalogos();
    $('panel').classList.remove('oculto');
    aviso('Sesión iniciada');
  } catch (e) {
    aviso(e.message, false);
  }
};

$('buscar').onclick = buscar;

$('recargar').onclick = async () => {
  try {
    const res = await api('POST', '/recargas', {
      cedula: $('cedula').value.trim(),
      packageId: $('paquete').value,
      registradoPor: $('registradoPor').value.trim() || undefined,
    });
    aviso(`Recargado a ${res.paciente}: ${res.sesionesRestantes} sesiones, ${res.creditosRestantes} créditos`);
    await buscar();
  } catch (e) {
    aviso(e.message, false);
  }
};

$('checkin').onclick = async () => {
  try {
    const res = await api('POST', '/checkin/manual', {
      cedula: $('cedula').value.trim(),
      terminalId: $('terminal').value,
      registradoPor: $('registradoPor').value.trim() || undefined,
    });
    aviso(res.ok ? `OK ${res.paciente} — ${res.modo ?? 'SESIONES'}` : `Rechazado: ${res.resultado}`, res.ok);
    await buscar();
  } catch (e) {
    aviso(e.message, false);
  }
};

$('crear').onclick = async () => {
  try {
    const res = await api('POST', '/admin/pacientes', {
      cedula: $('nuevaCedula').value.trim(),
      nombre: $('nuevoNombre').value.trim(),
      uid: $('nuevoUid').value.trim() || undefined,
    });
    aviso(`Paciente ${res.nombre} creado${res.uid ? ` con tarjeta ${res.uid}` : ''}`);
    $('cedula').value = res.cedula;
    await buscar();
  } catch (e) {
    aviso(e.message, false);
  }
};

if (clave()) $('staffKey').value = clave();
