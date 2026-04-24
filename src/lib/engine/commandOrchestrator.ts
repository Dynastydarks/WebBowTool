import type { BowMessage } from "../types";
import { crc8Bow } from "../protocol/crc8";
import { isHandoff, isPingOrPong } from "../protocol/decoder";
import { MessageParser } from "../protocol/messageParser";
import { WebSerialTransport } from "../serial/webSerialTransport";

const ids = { motor: 0x00, bat: 0x02, pc: 0x04, display: 0x0c };
type Mode = "WAKEUP_BAT" | "CHECK_BAT" | "DIRECT";
type LoopResult = "CONTINUE" | "SEND_COMMAND" | "DONE";

export interface WorkflowContext {
  log: (line: string) => void;
  sendCmd: (target: number, cmd: number, ...data: number[]) => Promise<void>;
  sendGetData: (target: number, type: number, id: number) => Promise<void>;
  sendGetDataArray: (target: number, type: number, id: number, offset: number) => Promise<void>;
  sendPutData: (target: number, type: number, id: number, ...data: number[]) => Promise<void>;
  sendPutDataArray: (target: number, type: number, id: number, from: number, to: number, length: number, ...data: number[]) => Promise<void>;
}
export interface Workflow {
  mode: Mode;
  sendCommand: (ctx: WorkflowContext) => Promise<void>;
  handleResponse: (message: BowMessage, ctx: WorkflowContext) => Promise<LoopResult>;
}

export class CommandOrchestrator {
  private transport = new WebSerialTransport();
  private runningAbort: AbortController | null = null;

  async refreshPorts(): Promise<SerialPort[]> { return this.transport.refreshPorts(); }
  async requestPort(): Promise<SerialPort> { return this.transport.requestPort(); }
  async connect(port: SerialPort, baudRate: number): Promise<void> { await this.transport.connect(port, baudRate); }
  async disconnect(): Promise<void> { await this.transport.disconnect(); }
  stop(): void { this.runningAbort?.abort(); }

  async run(workflow: Workflow, onMessage: (m: BowMessage) => void, log: (line: string) => void): Promise<void> {
    const abort = new AbortController();
    this.runningAbort = abort;
    let state: "FLUSH" | "WAIT_FOR_BAT" | "SEND_COMMAND" | "WAIT_RESPONSE" = workflow.mode === "DIRECT" ? "FLUSH" : "WAIT_FOR_BAT";
    let done = false;
    let waited = 0;
    const parser = new MessageParser((msg) => { onMessage(msg); handle(msg).catch(() => {}); }, () => {});
    const ctx: WorkflowContext = {
      log,
      sendCmd: (target, command, ...data) => this.sendCmd(target, command, ...data),
      sendGetData: (target, type, id) => this.sendCmd(target, 0x08, type, id),
      sendGetDataArray: (target, type, id, offset) => this.sendCmd(target, 0x08, type, id, offset),
      sendPutData: (target, type, id, ...data) => this.sendCmd(target, 0x09, type, id, ...data),
      sendPutDataArray: (target, type, id, from, to, length, ...data) => this.sendCmd(target, 0x09, type, id, from, to, length, ...data),
    };
    const handle = async (message: BowMessage): Promise<void> => {
      if (state === "WAIT_FOR_BAT" && message.target === ids.pc) {
        if (isPingOrPong(message) && message.source !== null) await this.sendPong(message.source);
        else if (isHandoff(message)) await this.sendCmd(ids.bat, 0x14);
        else if (message.type === 0x02 && message.source === ids.bat && message.message[3] === 0x14) state = "SEND_COMMAND";
      }
      if (state === "WAIT_RESPONSE") {
        const r = await workflow.handleResponse(message, ctx);
        if (r === "SEND_COMMAND") state = "SEND_COMMAND";
        if (r === "DONE") done = true;
      }
    };

    while (!abort.signal.aborted && !done) {
      if (state === "SEND_COMMAND") {
        await workflow.sendCommand(ctx);
        state = "WAIT_RESPONSE";
        continue;
      }
      const bytes = await this.transport.readChunk(225);
      if (state === "FLUSH") {
        if (bytes.length === 0) state = workflow.mode === "DIRECT" ? "SEND_COMMAND" : "WAIT_FOR_BAT";
        continue;
      }
      if (bytes.length === 0) {
        if (state === "WAIT_RESPONSE") state = "SEND_COMMAND";
        if (state === "WAIT_FOR_BAT") {
          waited += 1;
          if (waited % 5 === 0) {
            if (workflow.mode === "CHECK_BAT" && waited === 20) state = "SEND_COMMAND";
            await this.transport.write([0x00]);
          }
        }
        continue;
      }
      for (const b of bytes) parser.feed(b);
    }
  }

  private async sendPong(target: number): Promise<void> {
    await this.sendRawEncoded(this.byte1(target, 0x03), this.byte2(ids.pc, 0x00));
  }
  private async sendCmd(target: number, command: number, ...data: number[]): Promise<void> {
    await this.sendRawEncoded(this.byte1(target, 0x01), this.byte2(ids.pc, data.length), command, ...data);
  }
  private byte1(target: number, type: number): number { return ((target << 4) | type) & 0xff; }
  private byte2(source: number, dataSize: number): number { return ((source << 4) | dataSize) & 0xff; }
  private async sendRawEncoded(...payload: number[]): Promise<void> {
    const frame = [0x10, ...payload];
    frame.push(crc8Bow(frame));
    const escaped = frame.flatMap((b, i) => (i > 0 && b === 0x10 ? [0x10, 0x10] : [b]));
    await this.transport.write(escaped);
  }
}
