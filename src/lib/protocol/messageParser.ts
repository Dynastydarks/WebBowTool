import type { BowMessage } from "../types";

export class MessageParser {
  private cnt = 0;
  private target: number | null = null;
  private source: number | null = null;
  private type: number | null = null;
  private size: number | null = null;
  private message: number[] = [];
  private escaping = false;
  private last: BowMessage | null = null;

  constructor(
    private readonly onMessage: (message: BowMessage) => void,
    private readonly onIncomplete: (message: number[]) => void,
  ) {}

  feed(inputByte: number): void {
    const input: number[] = [];
    if (this.escaping) {
      if (inputByte === 0x10) input.push(0x10);
      else {
        input.push(0x10, inputByte);
        if (this.cnt !== 0) this.onIncomplete([...this.message]);
        this.reset();
      }
      this.escaping = false;
    } else if (inputByte === 0x10) {
      this.escaping = true;
      return;
    } else {
      input.push(inputByte);
    }

    for (const value of input) {
      const low = value & 0x0f;
      const high = (value >> 4) & 0x0f;
      if (this.cnt === 0) {
        if (value === 0x00) return;
        this.type = null;
        this.size = null;
        this.message = [];
      } else if (this.cnt === 1) {
        this.target = high;
        this.type = low;
      } else if (this.cnt === 2) {
        if (this.type === 0x00) this.size = 3;
        else {
          this.source = high;
          this.size = this.type === 0x03 || this.type === 0x04 ? 4 : low + 5;
        }
      }

      this.message.push(value);
      this.cnt += 1;
      if (this.cnt > 2 && this.size !== null && this.cnt === this.size) {
        const msg: BowMessage = {
          type: this.type ?? 0,
          target: this.target ?? 0,
          source: this.source,
          size: this.size,
          message: [...this.message],
          previous: this.last,
        };
        this.last = msg;
        this.onMessage(msg);
        this.cnt = 0;
      }
    }
  }

  private reset(): void {
    this.cnt = 0;
    this.target = null;
    this.source = null;
    this.type = null;
    this.size = null;
    this.message = [];
  }
}
