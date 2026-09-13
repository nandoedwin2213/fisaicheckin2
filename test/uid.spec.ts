import { normalizarUid } from '../src/checkin/uid';

describe('normalizarUid', () => {
  it('pasa a mayúsculas y quita separadores', () => {
    expect(normalizarUid('a1:b2:c3:d4')).toBe('A1B2C3D4');
    expect(normalizarUid('a1 b2-c3.d4')).toBe('A1B2C3D4');
  });

  it('rechaza cadenas no hexadecimales en vez de recortarlas', () => {
    expect(normalizarUid('MANUAL')).toBeNull();
    expect(normalizarUid('A1B2C3G4')).toBeNull();
  });

  it('rechaza longitudes fuera de rango', () => {
    expect(normalizarUid('A1B2C3')).toBeNull();
    expect(normalizarUid('A'.repeat(21))).toBeNull();
  });
});
