import { MessageParser } from "./protocol/messageParser";
import type { BowMessage } from "./types";

export const parseImportedFile = async (file: File, binary: boolean): Promise<BowMessage[]> => {
  const parserOutput: BowMessage[] = [];
  const parser = new MessageParser((m) => parserOutput.push(m), () => {});
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (binary) {
    bytes.forEach((b) => parser.feed(b));
  } else {
    const text = new TextDecoder().decode(bytes);
    const cleaned = text.match(/[a-fA-F0-9]{2}/g) ?? [];
    cleaned.forEach((hex) => parser.feed(parseInt(hex, 16)));
  }
  return parserOutput;
};
