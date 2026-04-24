import type { BowMessage, NamedMaps } from "../types";
import { crc8Bow } from "./crc8";
import { dataOf, hex, isBitSet, withName } from "./format";
import { TypeFlags } from "./typeFlags";

export const isReq = (m: BowMessage): boolean => m.type === 0x01;
export const isRsp = (m: BowMessage): boolean => m.type === 0x02;
export const isHandoff = (m: BowMessage): boolean => m.type === 0x00;
export const isPingOrPong = (m: BowMessage): boolean => m.type === 0x03 || m.type === 0x04;
export const cmd = (m: BowMessage): number => m.message[3] ?? -1;

export const checkMessage = (message: BowMessage): string => {
  let result = "";
  if (message.size !== null && message.message.length !== message.size) result += " SIZE MISMATCH";
  if (crc8Bow(message.message.slice(0, -1)) !== message.message[message.message.length - 1]) result += " CRC MISMATCH";
  return result.trim();
};

export const decodeMessage = (message: BowMessage, maps: NamedMaps): string => {
  if (message.type === 0x04) return "PING!";
  if (message.type === 0x03) return "PONG!";
  if (message.type === 0x00) return "HANDOFF";
  if (!isReq(message) && !isRsp(message)) return "";
  const command = cmd(message);
  const commandName = withName(command, maps.commands);
  if (command === 0x08) return `${commandName}${isRsp(message) ? " - OK" : ""} ${createGetDataString(message, maps)}`.trim();
  if (command === 0x09) return `${commandName}${isRsp(message) ? " - OK" : ""} ${createPutDataString(message, maps)}`.trim();
  if (command === 0x20 && isRsp(message)) return `${commandName} - OK ${hex(dataOf(message).slice(0, 2))} ${hex(dataOf(message).slice(6, 8))} (${hex(dataOf(message))})`;
  if (command === 0x17 && isReq(message)) return `${commandName}: E-00${hex(dataOf(message).slice(0, 1))}`;
  if ((command === 0x26 || command === 0x27) && isReq(message)) return `${commandName}${createCu2UpdateDisplayString(message)}`;
  if (command === 0x28 && isReq(message)) return `${commandName}${createCu3DisplayString(message)}`;
  if (command === 0x34 && isReq(message)) return `${commandName}${createAssistLevelString(message)}`;
  return isRsp(message) ? `${commandName} - OK ${hex(dataOf(message))}` : `${commandName} ${hex(dataOf(message))}`;
};

const createGetDataString = (message: BowMessage, maps: NamedMaps): string => {
  if (isReq(message)) return toReqParts(dataOf(message), maps).map((part) => part.label).join("");
  const data = dataOf(message);
  if (data.length === 0) return "";
  if (data[0] === 0x01) return "NOT FOUND";
  if (data[0] !== 0x00) return "";
  const prev = message.previous;
  const prevReqParts = prev && cmd(prev) === cmd(message) ? toReqParts(dataOf(prev), maps) : null;
  const resp = toRespParts(data.slice(1), maps);
  if (prevReqParts) {
    return prevReqParts
      .map((req, index) => `${req.label}${resp[index]?.dataString ?? ""}`)
      .join("");
  }
  return resp.map((p) => p.label + p.dataString).join("");
};

const createPutDataString = (message: BowMessage, maps: NamedMaps): string => {
  if (!isReq(message)) return "";
  const data = dataOf(message);
  const result: string[] = [];
  let index = 0;
  let more = true;
  while (more && index < data.length) {
    const type = new TypeFlags(data[index]);
    const headerSize = type.array ? 5 : 2;
    const elementCount = type.array ? data[index + 4] : 1;
    const partSize = headerSize + type.elementSize * elementCount;
    const part = data.slice(index, index + partSize);
    index += partSize;
    const id = part[1];
    const offset = type.array ? part[2] : null;
    const elementsData = part.slice(headerSize);
    const elements = splitElements(type, elementsData, elementCount);
    const values = type.array && type.size !== 0 ? `[${elements.map(type.formatter).join(", ")}]` : type.formatter(elements[0] ?? []);
    result.push(` ${toHexType(type.typeValue)}:${toHexType(id)}(${maps.dataIds[id] ?? "Unknown"})${offset !== null ? `[${offset}]` : ""}: ${values}`);
    more = type.more;
  }
  return result.join("");
};

const toReqParts = (data: number[], maps: NamedMaps): { label: string; type: TypeFlags }[] => {
  const result: { label: string; type: TypeFlags }[] = [];
  let index = 0;
  let more = true;
  while (more && index < data.length) {
    const type = new TypeFlags(data[index]);
    const partSize = type.array ? 3 : 2;
    const part = data.slice(index, index + partSize);
    index += partSize;
    const id = part[1];
    const offset = type.array ? part[2] : null;
    result.push({ type, label: ` ${toHexType(type.typeValue)}:${toHexType(id)}(${maps.dataIds[id] ?? "Unknown"})${offset !== null ? `[${offset}]` : ""}` });
    more = type.more;
  }
  return result;
};

const toRespParts = (data: number[], maps: NamedMaps): { label: string; dataString: string }[] => {
  const result: { label: string; dataString: string }[] = [];
  let index = 0;
  let more = true;
  while (more && index < data.length) {
    const type = new TypeFlags(data[index]);
    const elementCount = type.array ? data[index + 2] : 1;
    const headerSize = type.array ? 3 : 2;
    const partSize = headerSize + type.elementSize * elementCount;
    const part = data.slice(index, index + partSize);
    index += partSize;
    const id = part[1];
    const elementsData = part.slice(headerSize);
    const elements = splitElements(type, elementsData, elementCount);
    const value = type.array && type.size !== 0 ? `[${elements.map(type.formatter).join(", ")}]` : type.formatter(elements[0] ?? []);
    result.push({ label: ` ${toHexType(type.typeValue)}:${toHexType(id)}(${maps.dataIds[id] ?? "Unknown"})`, dataString: `: ${value}` });
    more = type.more;
  }
  return result;
};

const splitElements = (type: TypeFlags, elementsData: number[], elementCount: number): number[][] => {
  if (!type.array) return [elementsData];
  if (type.size === 0) return [elementsData];
  const out: number[][] = [];
  for (let i = 0; i < elementCount; i += 1) {
    out.push(elementsData.slice(i * type.elementSize, (i + 1) * type.elementSize));
  }
  return out;
};

const createBlinkString = (name: string, input: number, shift: number): string => {
  const value = (input >> shift) & 0x03;
  if (value === 0x00) return "";
  if (value === 0x01) return `${name}:FST `;
  if (value === 0x02) return `${name}:SLW `;
  return `${name}:SOL `;
};

const createCu2UpdateDisplayString = (message: BowMessage): string => {
  const d = dataOf(message);
  if (d.length < 9) return "";
  const spd = hex(d.slice(4, 6));
  return `: ${createBlinkString("OFF", d[0], 0)}${createBlinkString("ECO", d[0], 2)}${createBlinkString("NRM", d[0], 4)}${createBlinkString("POW", d[0], 6)}${createBlinkString("WRE", d[1], 0)}${createBlinkString("TOT", d[1], 2)}${createBlinkString("TRP", d[1], 4)}${createBlinkString("LIG", d[1], 6)}${createBlinkString("BAR", d[2], 0)}${createBlinkString("COM", d[2], 4)}${createBlinkString("KM", d[2], 6)}${d[3]}% '${spd.slice(1, 3)}.${spd.slice(3)}'`;
};

const createCu3DisplayString = (message: BowMessage): string => {
  const d = dataOf(message);
  if (d.length < 13) return "";
  const scr = ["SCR:MAIN", "SCR:BAT+CHRG", "SCR:BAT", "SCR:MAIN"][d[0]] ?? "SCR:???";
  const ass = ["ASS:OFF", "ASS:1 or 2", "ASS:2 or 3", "ASS:3 or 4", "ASS:P", "ASS:R", "ASS:4 or 1", "ASS:5"][d[1]] ?? "ASS:???";
  const flags = `${isBitSet(d[2], 3) ? "SCR:ON " : ""}${isBitSet(d[2], 0) ? "LIGHT " : ""}${isBitSet(d[2], 2) ? "RANGE_EXT " : ""}`;
  const speed = (d[3] << 8) + d[4];
  const trip1 = (((d[5] << 24) >>> 0) + (d[6] << 16) + (d[7] << 8) + d[8]) >>> 0;
  const trip2 = (((d[9] << 24) >>> 0) + (d[10] << 16) + (d[11] << 8) + d[12]) >>> 0;
  return `: ${scr}(${d[0]}) ${ass}(${d[1]}) ${flags}speed:${speed} trip1:${trip1} trip2:${trip2}`;
};

const createAssistLevelString = (message: BowMessage): string => {
  const value = dataOf(message)[0];
  if (value === 0x01) return " > ECO";
  if (value === 0x02) return " > NORMAL";
  if (value === 0x03) return " > POWER";
  if (value === 0x00) return "";
  return ` > ???(${value})`;
};

const toHexType = (value: number): string => value.toString(16).padStart(2, "0");
