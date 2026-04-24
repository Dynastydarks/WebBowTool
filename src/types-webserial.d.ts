interface SerialOptions {
  baudRate: number;
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  forget?: () => Promise<void>;
}

interface Serial {
  getPorts(): Promise<SerialPort[]>;
  requestPort(): Promise<SerialPort>;
}

interface Navigator {
  serial: Serial;
}
