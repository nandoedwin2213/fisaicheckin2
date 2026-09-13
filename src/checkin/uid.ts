const SEPARADORES = /[\s:.-]/g;

export const UID_REGEX = /^[0-9A-F]{8,20}$/;

/**
 * Normaliza el UID que envía el terminal: quita separadores habituales y pasa a mayúsculas.
 * Devuelve null si lo que queda no es un UID hexadecimal válido; nunca "repara" la entrada
 * descartando caracteres, porque eso puede transformar una cadena inválida en el UID de otra tarjeta.
 */
export function normalizarUid(uid: string): string | null {
  const limpio = uid.replace(SEPARADORES, '').toUpperCase();
  return UID_REGEX.test(limpio) ? limpio : null;
}
