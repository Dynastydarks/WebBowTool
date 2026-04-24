export class WebSerialTransport {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  async refreshPorts(): Promise<SerialPort[]> {
    if (!("serial" in navigator)) return [];
    return navigator.serial.getPorts();
  }

  async requestPort(): Promise<SerialPort> {
    const selected = await navigator.serial.requestPort();
    return selected;
  }

  async connect(port: SerialPort, baudRate: number): Promise<void> {
    this.port = port;
    await this.port.open({ baudRate, flowControl: "none", bufferSize: 1024 });
    this.reader = this.port.readable?.getReader() ?? null;
    this.writer = this.port.writable?.getWriter() ?? null;
  }

  async readChunk(timeoutMs = 225): Promise<number[]> {
    if (!this.reader) return [];
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const readPromise = this.reader.read();
    const result = await Promise.race([timeout, readPromise]);
    if (result === null || result.done) return [];
    return Array.from(result.value);
  }

  async write(bytes: number[]): Promise<void> {
    if (!this.writer) throw new Error("No writer");
    await this.writer.write(Uint8Array.from(bytes));
  }

  async disconnect(): Promise<void> {
    try {
      await this.reader?.cancel();
      this.reader?.releaseLock();
      this.writer?.releaseLock();
      await this.port?.close();
    } finally {
      this.reader = null;
      this.writer = null;
      this.port = null;
    }
  }
}
