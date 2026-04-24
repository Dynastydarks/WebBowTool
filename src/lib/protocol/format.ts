import type { BowMessage } from "../types";

export const hexByte = (value: number): string => value.toString(16).padStart(2, "0");
export const hex = (bytes: number[]): string => bytes.map(hexByte).join("");
export const withName = (value: number | null, map: Record<number, string>): string => {
  if (value === null) return "-";
  const named = map[value];
  return named ? `${named}(${hexByte(value)})` : hexByte(value);
};

export const isBitSet = (value: number, index: number): boolean => ((value >> index) & 0x01) === 1;
export const asUint = (value: number[]): string => value.reduce((acc, cur) => (acc << 8) + cur, 0).toString();
export const asInt = (value: number[]): string => {
  const u = value.reduce((acc, cur) => (acc << 8) + cur, 0);
  const bits = value.length * 8;
  const sign = 1 << (bits - 1);
  return ((u & sign) !== 0 ? u - (1 << bits) : u).toString();
};
export const asFloat32 = (value: number[]): string => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  value.slice(0, 4).forEach((b, i) => view.setUint8(i, b));
  return view.getFloat32(0, false).toString();
};
export const asString = (value: number[]): string => `'${String.fromCharCode(...value)}'`;

export const dataOf = (message: BowMessage): number[] => message.message.slice(4, -1);
