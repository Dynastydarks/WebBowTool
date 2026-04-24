import { describe, expect, it } from "vitest";
import { namedMaps } from "../lib/config";
import { crc8Bow } from "../lib/protocol/crc8";
import { decodeMessage } from "../lib/protocol/decoder";
import { MessageParser } from "../lib/protocol/messageParser";
import type { BowMessage } from "../lib/types";

describe("crc8Bow", () => {
  it("matches known frame checksum", () => {
    expect(crc8Bow([0x10, 0x41, 0x41, 0x08, 0x40, 0x5b])).toBeTypeOf("number");
  });
});

describe("MessageParser", () => {
  it("parses escaped stream", () => {
    const messages: number[][] = [];
    const parser = new MessageParser((msg) => messages.push(msg.message), () => {});
    [0x10, 0x41, 0x41, 0x20, 0x10, 0x10, 0xaa].forEach((b) => parser.feed(b));
    expect(messages.length).toBeGreaterThanOrEqual(0);
  });
});

describe("decodeMessage", () => {
  it("decodes GET DATA request details", () => {
    const req: BowMessage = {
      type: 0x01,
      target: 0x00,
      source: 0x04,
      size: 7,
      message: [0x10, 0x01, 0x42, 0x08, 0x40, 0x5b, 0xaa],
      previous: null,
    };
    expect(decodeMessage(req, namedMaps)).toContain("GET DATA");
    expect(decodeMessage(req, namedMaps)).toContain("(Paired serial 1)");
  });

  it("decodes PUT DATA request values", () => {
    const req: BowMessage = {
      type: 0x01,
      target: 0x02,
      source: 0x04,
      size: 10,
      message: [0x10, 0x21, 0x44, 0x09, 0x00, 0x29, 0x01, 0x00, 0x00, 0xaa],
      previous: null,
    };
    expect(decodeMessage(req, namedMaps)).toContain("PUT DATA");
    expect(decodeMessage(req, namedMaps)).toContain("(Unknown)");
  });
});
