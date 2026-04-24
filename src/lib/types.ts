export type BowMessageType = 0 | 1 | 2 | 3 | 4 | number;

export interface BowMessage {
  type: BowMessageType;
  target: number;
  source: number | null;
  size: number | null;
  message: number[];
  previous: BowMessage | null;
}

export interface NamedMaps {
  types: Record<number, string>;
  devices: Record<number, string>;
  dataIds: Record<number, string>;
  commands: Record<number, string>;
}

export type WorkflowName =
  | "scanMotor"
  | "scanBattery"
  | "scanCu3"
  | "pairDisplay"
  | "pairBattery"
  | "clearErr";
