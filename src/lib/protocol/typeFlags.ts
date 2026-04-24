import { asFloat32, asInt, asString, asUint, hex, isBitSet } from "./format";

export class TypeFlags {
  readonly more: boolean;
  readonly array: boolean;
  readonly size: number;
  readonly string: boolean;
  readonly elementSize: number;
  readonly typeValue: number;
  readonly formatter: (value: number[]) => string;

  constructor(flags: number) {
    this.more = isBitSet(flags, 7);
    this.array = isBitSet(flags, 6);
    this.size = (flags & 0b1110) >> 1;
    const unsigned = !isBitSet(flags, 5) && !isBitSet(flags, 4);
    const signed = !isBitSet(flags, 5) && isBitSet(flags, 4);
    const float = isBitSet(flags, 5) && !isBitSet(flags, 4);
    this.string = isBitSet(flags, 5) && isBitSet(flags, 4);
    this.elementSize = this.size === 0 ? 1 : this.size;
    this.typeValue = flags & 0b01111111;
    this.formatter = unsigned && this.size > 0 ? asUint : signed && this.size > 0 ? asInt : float && this.size === 4 ? asFloat32 : this.string && this.size === 0 ? asString : hex;
  }
}
