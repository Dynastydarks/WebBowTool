import type { BowMessage } from "../types";
import type { Workflow } from "../engine/commandOrchestrator";

const ids = { motor: 0x00, bat: 0x02, pc: 0x04, display: 0x0c };
const cmd = (m: BowMessage): number => m.message[3] ?? -1;
const data = (m: BowMessage): number[] => m.message.slice(4, -1);

export const scanWorkflow = (target: number): Workflow => ({
  mode: target === ids.bat ? "WAKEUP_BAT" : "CHECK_BAT",
  sendCommand: async ({ sendGetData }) => sendGetData(target, 0x40, 0x5b),
  handleResponse: async (message) => {
    if (message.target === ids.pc && message.type === 0x02 && message.source === target && cmd(message) === 0x08) return "DONE";
    return "CONTINUE";
  },
});

export const pairDisplayWorkflow = (): Workflow => {
  let state = 0;
  let displaySerial: number[] = [];
  return {
    mode: "CHECK_BAT",
    sendCommand: async ({ sendCmd, sendGetDataArray, sendPutDataArray }) => {
      if (state === 0) await sendCmd(ids.display, 0x20);
      if (state === 1) await sendGetDataArray(ids.motor, 0x40, 0x5c, 0x00);
      if (state === 2) await sendPutDataArray(ids.motor, 0x40, 0x5c, 0x00, displaySerial.length, displaySerial.length, ...displaySerial);
      if (state === 3) await sendGetDataArray(ids.motor, 0x40, 0x5c, 0x00);
    },
    handleResponse: async (message, { log }) => {
      if (message.target !== ids.pc || message.type !== 0x02) return "CONTINUE";
      if (state === 0 && message.source === ids.display && cmd(message) === 0x20) { displaySerial = message.message.slice(4, -1); log(`Display serial: ${displaySerial.map((v) => v.toString(16).padStart(2, "0")).join("")}`); state = 1; return "SEND_COMMAND"; }
      if (state === 1 && message.source === ids.motor && cmd(message) === 0x08) { state = 2; return "SEND_COMMAND"; }
      if (state === 2 && message.source === ids.motor && cmd(message) === 0x09) { state = 3; return "SEND_COMMAND"; }
      if (state === 3 && message.source === ids.motor && cmd(message) === 0x08) return "DONE";
      return "CONTINUE";
    },
  };
};

export const pairBatteryWorkflow = (): Workflow => ({
  mode: "CHECK_BAT",
  sendCommand: async ({ sendGetDataArray }) => sendGetDataArray(ids.motor, 0x70, 0xd1, 0x00),
  handleResponse: async (m) => (m.target === ids.pc && m.type === 0x02 && m.source === ids.motor && cmd(m) === 0x08 ? "DONE" : "CONTINUE"),
});

export const clearErrWorkflow = (): Workflow => {
  let state = 0;
  return {
    mode: "WAKEUP_BAT",
    sendCommand: async ({ sendGetData, sendPutData }) => {
      if (state === 0) await sendGetData(ids.bat, 0x00, 0x29);
      if (state === 1) await sendPutData(ids.bat, 0x00, 0x29, 0x00);
      if (state === 2) await sendGetData(ids.bat, 0x00, 0x29);
    },
    handleResponse: async (m) => {
      if (m.target !== ids.pc || m.type !== 0x02 || m.source !== ids.bat) return "CONTINUE";
      if (state === 0 && cmd(m) === 0x08) { state = 1; return "SEND_COMMAND"; }
      if (state === 1 && cmd(m) === 0x09) { state = 2; return "SEND_COMMAND"; }
      if (state === 2 && cmd(m) === 0x08) return "DONE";
      return "CONTINUE";
    },
  };
};

/** Same as legacy sendStoreDisableServiceCounter: PUT DATA 0x08/0x3b + four zeros on battery (maintenance / service counter). */
export const resetMaintenanceIntervalWorkflow = (): Workflow => {
  let state = 0;
  return {
    mode: "WAKEUP_BAT",
    sendCommand: async ({ sendGetData, sendPutData, log }) => {
      if (state === 0) {
        log("Maintenance reset: read 0x3b (distance to maintenance) before write.");
        await sendGetData(ids.bat, 0x08, 0x3b);
      }
      if (state === 1) {
        log("Maintenance reset: PUT 0x08/0x3b with 00 00 00 00 (disable service counter).");
        await sendPutData(ids.bat, 0x08, 0x3b, 0x00, 0x00, 0x00, 0x00);
      }
      if (state === 2) {
        log("Maintenance reset: read 0x3b after write.");
        await sendGetData(ids.bat, 0x08, 0x3b);
      }
    },
    handleResponse: async (m, { log }) => {
      if (m.target !== ids.pc || m.type !== 0x02 || m.source !== ids.bat) return "CONTINUE";
      if (state === 0 && cmd(m) === 0x08) {
        log(`Before: ${data(m).map((v) => v.toString(16).padStart(2, "0")).join("")}`);
        state = 1;
        return "SEND_COMMAND";
      }
      if (state === 1 && cmd(m) === 0x09) {
        log("PUT DATA for 0x3b acknowledged.");
        state = 2;
        return "SEND_COMMAND";
      }
      if (state === 2 && cmd(m) === 0x08) {
        log(`After: ${data(m).map((v) => v.toString(16).padStart(2, "0")).join("")}`);
        return "DONE";
      }
      return "CONTINUE";
    },
  };
};

export const setAssistModeWorkflow = (
  level: 0 | 1 | 2 | 3,
  originalLikePath: boolean,
): Workflow => {
  let state: "SEND" | "WAIT_ACK" = "SEND";
  return {
    mode: "CHECK_BAT",
    sendCommand: async ({ sendCmd, log }) => {
      if (state !== "SEND") return;
      if (originalLikePath) {
        log(`Setting assist via original-like path (0x1d${level.toString(16)})`);
        await sendCmd(ids.bat, 0x1d, level);
      } else {
        log(`Setting assist via motor path (0x34 -> ${level})`);
        await sendCmd(ids.motor, 0x34, level);
      }
      state = "WAIT_ACK";
    },
    handleResponse: async (message, { log }) => {
      if (message.target !== ids.pc || message.type !== 0x02) return "CONTINUE";
      if (!originalLikePath && message.source === ids.motor && cmd(message) === 0x34) {
        log("SET ASSIST LEVEL acknowledged by motor.");
        return "DONE";
      }
      if (originalLikePath && message.source === ids.bat && cmd(message) === 0x1d) {
        log("Original-like assist command acknowledged by battery.");
        return "DONE";
      }
      if (state === "WAIT_ACK" && (cmd(message) === 0x34 || cmd(message) === 0x1d)) {
        log(`Assist command got response from src=0x${(message.source ?? 0).toString(16)} cmd=0x${cmd(message).toString(16)}`);
        return "DONE";
      }
      return "CONTINUE";
    },
  };
};

export const calibrateTorqueWorkflow = (): Workflow => {
  let state: "SEND_CALIB_CMD" | "SEND_CALIB_READ" | "WAIT_DATA_PUSH" = "SEND_CALIB_CMD";
  return {
    mode: "CHECK_BAT",
    sendCommand: async ({ sendCmd, log }) => {
      if (state === "SEND_CALIB_CMD") {
        log("Calibration step 1/3: send motor calibration command (0x35).");
        await sendCmd(ids.motor, 0x35);
        return;
      }
      if (state === "SEND_CALIB_READ") {
        log("Calibration step 2/3: request calibration data snapshot (GET DATA 0x00df).");
        await sendCmd(ids.motor, 0x08, 0x22, 0x00, 0xdf);
      }
    },
    handleResponse: async (message, { log }) => {
      if (message.target !== ids.pc || message.type !== 0x02) return "CONTINUE";

      if (state === "SEND_CALIB_CMD" && message.source === ids.motor && cmd(message) === 0x35) {
        log("Calibration command acknowledged by motor.");
        state = "SEND_CALIB_READ";
        return "SEND_COMMAND";
      }

      if (state === "SEND_CALIB_READ" && message.source === ids.motor && cmd(message) === 0x08) {
        log("Calibration readback request acknowledged, waiting for motor push data.");
        state = "WAIT_DATA_PUSH";
        return "CONTINUE";
      }

      if (state === "WAIT_DATA_PUSH" && message.source === ids.motor && cmd(message) === 0x09) {
        log(`Calibration data update received: ${data(message).map((v) => v.toString(16).padStart(2, "0")).join("")}`);
        return "DONE";
      }

      return "CONTINUE";
    },
  };
};
