const INIT = 0x07;
const POLY = 0x42;

export const crc8Bow = (data: number[]): number => {
  let crc = INIT;
  for (const value of data) {
    for (let bit = 0; bit < 8; bit += 1) {
      const bitTrue = (((crc ^ (value >>> bit)) & 0x01) > 0);
      if (bitTrue) crc ^= POLY;
      crc = ((crc >>> 1) & 0x7f);
      if (bitTrue) crc |= 0x80;
    }
  }
  return crc & 0xff;
};
