import { useEffect, useMemo, useRef, useState } from "react";
import { namedMaps } from "./lib/config";
import { CommandOrchestrator } from "./lib/engine/commandOrchestrator";
import { parseImportedFile } from "./lib/fileParser";
import { checkMessage, cmd, decodeMessage, isHandoff, isPingOrPong } from "./lib/protocol/decoder";
import { hex, withName } from "./lib/protocol/format";
import type { BowMessage } from "./lib/types";
import { calibrateTorqueWorkflow, clearErrWorkflow, pairBatteryWorkflow, pairDisplayWorkflow, probeSetMaxSpeedWorkflow, readMaxSpeedWorkflow, resetMaintenanceIntervalWorkflow, scanWorkflow } from "./lib/workflows/workflows";

const orchestrator = new CommandOrchestrator();
const aliasesKey = "bowtool.portAliases.v1";

type PortContextMenuState = {
  portIndex: number;
  x: number;
  y: number;
} | null;

export function App() {
  const serialSupported = typeof navigator !== "undefined" && "serial" in navigator;
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [selectedPort, setSelectedPort] = useState<number>(0);
  const [portAliases, setPortAliases] = useState<Record<string, string>>(() => {
    const raw = localStorage.getItem(aliasesKey);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [portMenu, setPortMenu] = useState<PortContextMenuState>(null);
  const [baudRate, setBaudRate] = useState<number>(19200);
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<BowMessage[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [showCredits, setShowCredits] = useState(false);
  const [followMessages, setFollowMessages] = useState(true);
  const [maxSpeedProbeValue, setMaxSpeedProbeValue] = useState<number>(250);
  const [safeTestMode, setSafeTestMode] = useState(true);
  const [filters, setFilters] = useState({ handoff: true, ping: true, invalid: true, getDataOnly: false, putDataOnly: false });
  const selectedPortObj = ports[selectedPort];
  const riskyWriteBlocked = safeTestMode;
  const messageScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(aliasesKey, JSON.stringify(portAliases));
  }, [portAliases]);

  useEffect(() => {
    if (!portMenu) return;
    const close = () => setPortMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [portMenu]);

  const portId = (port: SerialPort, index: number): string => {
    const info = port.getInfo();
    return `${info.usbVendorId ?? "na"}:${info.usbProductId ?? "na"}:${index}`;
  };
  const portLabel = (port: SerialPort, index: number): string => {
    const id = portId(port, index);
    const alias = portAliases[id];
    const info = port.getInfo();
    const base = `Port ${index + 1} (${(info.usbVendorId ?? 0).toString(16)}:${(info.usbProductId ?? 0).toString(16)})`;
    return alias ? `${alias} - ${base}` : base;
  };

  const visibleMessages = useMemo(() => messages.filter((m) => {
    if (!filters.handoff && isHandoff(m)) return false;
    if (!filters.ping && isPingOrPong(m)) return false;
    if (!filters.invalid && checkMessage(m).length > 0) return false;
    if (filters.getDataOnly && cmd(m) !== 0x08) return false;
    if (filters.putDataOnly && cmd(m) !== 0x09) return false;
    return true;
  }), [messages, filters]);

  const pushLog = (line: string) => setLogs((prev) => [line, ...prev].slice(0, 200));

  useEffect(() => {
    if (!followMessages) return;
    const node = messageScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [visibleMessages.length, followMessages]);

  const refresh = async () => {
    const refreshed = await orchestrator.refreshPorts();
    setPorts(refreshed);
    setSelectedPort((prev) => Math.min(prev, Math.max(refreshed.length - 1, 0)));
  };
  const requestPort = async () => { await orchestrator.requestPort(); await refresh(); };
  const connect = async () => {
    const port = selectedPortObj;
    if (!port) return;
    await orchestrator.connect(port, baudRate);
    setConnected(true);
    pushLog("Connected.");
  };
  const disconnect = async () => { await orchestrator.disconnect(); setConnected(false); pushLog("Disconnected."); };
  const stop = () => { orchestrator.stop(); setRunning(false); pushLog("Stop requested."); };
  const renamePort = (index: number) => {
    const port = ports[index];
    if (!port) return;
    const id = portId(port, index);
    const current = portAliases[id] ?? "";
    const next = window.prompt("Port Alias (leer = entfernen):", current);
    if (next === null) return;
    setPortAliases((prev) => {
      const copy = { ...prev };
      if (next.trim().length === 0) delete copy[id];
      else copy[id] = next.trim();
      return copy;
    });
    pushLog("Port alias updated.");
  };

  const forgetPort = async (index: number) => {
    const port = ports[index];
    if (!port) return;
    if (!port.forget) {
      pushLog("Browser does not support SerialPort.forget().");
      return;
    }
    if (!window.confirm("Forget this port permission?")) return;
    try {
      if (connected && index === selectedPort) {
        await disconnect();
      }
      await port.forget();
      setPortAliases((prev) => {
        const copy = { ...prev };
        delete copy[portId(port, index)];
        return copy;
      });
      pushLog("Port permission forgotten.");
      await refresh();
    } catch (error) {
      pushLog(`Port forget failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const run = async (
    workflow:
      | ReturnType<typeof scanWorkflow>
      | ReturnType<typeof pairDisplayWorkflow>
      | ReturnType<typeof pairBatteryWorkflow>
      | ReturnType<typeof clearErrWorkflow>
      | ReturnType<typeof readMaxSpeedWorkflow>
      | ReturnType<typeof probeSetMaxSpeedWorkflow>
      | ReturnType<typeof calibrateTorqueWorkflow>
      | ReturnType<typeof resetMaintenanceIntervalWorkflow>,
  ) => {
    if (!connected) return;
    setMessages([]);
    setRunning(true);
    try {
      await orchestrator.run(workflow, (m) => setMessages((prev) => [...prev, m]), pushLog);
    } finally {
      setRunning(false);
    }
  };

  const importFile = async (binary: boolean) => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const parsed = await parseImportedFile(file, binary);
      setMessages(parsed);
      pushLog(`Imported ${parsed.length} messages from ${file.name}`);
    };
    input.click();
  };

  return (
    <div className="container">
      <div className="topBar">
        <h1>BowTool Web</h1>
        <button onClick={() => setShowCredits(true)}>Credits</button>
      </div>
      <section className="card">
        <h2>Connection</h2>
        <p className={serialSupported ? "ok" : "warn"} style={{ marginTop: 0 }}>
          Web Serial API: {serialSupported ? "supported" : "not supported in this browser"}
          {!serialSupported ? " (use Chrome or Edge on desktop over https/localhost)" : ""}
        </p>
        <div className="row">
          <button onClick={refresh}>Port refresh</button>
          <button onClick={requestPort}>Port permission</button>
          <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}><option value={9600}>9600</option><option value={19200}>19200</option></select>
          {!connected ? <button onClick={connect}>Connect</button> : <button onClick={disconnect}>Disconnect</button>}
          <span className={connected ? "ok" : "warn"}>{connected ? "Connected" : "Disconnected"}</span>
        </div>
        <div className="portList">
          {ports.map((port, index) => (
            <div
              key={portId(port, index)}
              className={`portChip${selectedPort === index ? " selected" : ""}`}
              onClick={() => setSelectedPort(index)}
              onContextMenu={(event) => {
                event.preventDefault();
                setSelectedPort(index);
                setPortMenu({ portIndex: index, x: event.clientX, y: event.clientY });
              }}
              title="Rechtsklick: Rename / Forget"
            >
              {portLabel(port, index)}
            </div>
          ))}
        </div>
        {portMenu && (
          <div className="menu" style={{ left: `${portMenu.x}px`, top: `${portMenu.y}px` }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { renamePort(portMenu.portIndex); setPortMenu(null); }}>Rename port</button>
            <button onClick={() => { forgetPort(portMenu.portIndex).catch(() => {}); setPortMenu(null); }}>Forget port permission</button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Actions</h2>
        <p className={safeTestMode ? "ok" : "warn"} style={{ marginTop: 0 }}>
          Safe Test Mode: {safeTestMode ? "ON (persistent/risky writes blocked)" : "OFF (risky writes enabled)"}
        </p>
        <div className="row">
          <label>
            <input
              type="checkbox"
              checked={safeTestMode}
              onChange={(e) => {
                const next = e.target.checked;
                if (!next) {
                  const confirmed = window.confirm(
                    "Disable Safe Test Mode? This enables potentially persistent writes.",
                  );
                  if (!confirmed) return;
                }
                setSafeTestMode(next);
              }}
            />
            Safe Test Mode
          </label>
          <button disabled={!connected || running} onClick={() => run(scanWorkflow(0x00))}>Scan motor</button>
          <button disabled={!connected || running} onClick={() => run(scanWorkflow(0x02))}>Scan battery</button>
          <button disabled={!connected || running} onClick={() => run(scanWorkflow(0x0c))}>Scan CU3</button>
          <button disabled={!connected || running || riskyWriteBlocked} onClick={() => run(pairDisplayWorkflow())}>Pair display</button>
          <button disabled={!connected || running || riskyWriteBlocked} onClick={() => run(pairBatteryWorkflow())}>Pair battery</button>
          <button disabled={!connected || running || riskyWriteBlocked} onClick={() => run(clearErrWorkflow())}>Clear E0003</button>
          <button
            disabled={!connected || running || riskyWriteBlocked}
            onClick={() => {
              if (!window.confirm("Reset maintenance interval? Writes PUT DATA 0x3b (four zeros) to battery, then read-back.")) return;
              run(resetMaintenanceIntervalWorkflow());
            }}
          >
            Reset maintenance (0x3b)
          </button>
          <button
            disabled={!connected || running}
            onClick={() => {
              if (!window.confirm("Start torque calibration now? Keep pedals unloaded and bike stable.")) return;
              run(calibrateTorqueWorkflow());
            }}
          >
            Calibrate torque sensor
          </button>
          <button disabled={!connected || running} onClick={() => run(readMaxSpeedWorkflow())}>Read max speed</button>
          <input
            type="number"
            value={maxSpeedProbeValue}
            min={0}
            max={65535}
            onChange={(e) => setMaxSpeedProbeValue(Number(e.target.value))}
            style={{ width: "110px" }}
          />
          <button
            disabled={!connected || running || riskyWriteBlocked}
            onClick={() => {
              if (!window.confirm("Experimental: probe a PUT DATA write for max speed. Continue?")) return;
              run(probeSetMaxSpeedWorkflow(maxSpeedProbeValue));
            }}
          >
            Probe set max speed
          </button>
          <button disabled={!running} className="danger" onClick={stop}>Stop</button>
          <button onClick={() => importFile(true)}>Open binary</button>
          <button onClick={() => importFile(false)}>Open hex</button>
        </div>
      </section>

      <section className="card">
        <h2>Filters</h2>
        <div className="row">
          <label><input type="checkbox" checked={filters.handoff} onChange={(e) => setFilters((f) => ({ ...f, handoff: e.target.checked }))} />HANDOFF</label>
          <label><input type="checkbox" checked={filters.ping} onChange={(e) => setFilters((f) => ({ ...f, ping: e.target.checked }))} />PING/PONG</label>
          <label><input type="checkbox" checked={filters.invalid} onChange={(e) => setFilters((f) => ({ ...f, invalid: e.target.checked }))} />Invalid</label>
          <label><input type="checkbox" checked={filters.getDataOnly} onChange={(e) => setFilters((f) => ({ ...f, getDataOnly: e.target.checked }))} />GET DATA only</label>
          <label><input type="checkbox" checked={filters.putDataOnly} onChange={(e) => setFilters((f) => ({ ...f, putDataOnly: e.target.checked }))} />PUT DATA only</label>
        </div>
      </section>

      <section className="card grid">
        <div>
          <h2>Messages ({visibleMessages.length}) {followMessages}</h2>
          <div
            ref={messageScrollRef}
            className="messageTableScroll"
            onScroll={(event) => {
              const node = event.currentTarget;
              const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 8;
              if (atBottom !== followMessages) setFollowMessages(atBottom);
            }}
          >
            <table>
              <thead><tr><th>message</th><th>type</th><th>target</th><th>source</th><th>decoded</th></tr></thead>
              <tbody>
                {visibleMessages.map((m, i) => (
                  <tr key={i}>
                    <td>{hex(m.message)}</td>
                    <td>{withName(m.type, namedMaps.types)}</td>
                    <td>{withName(m.target, namedMaps.devices)}</td>
                    <td>{withName(m.source, namedMaps.devices)}</td>
                    <td>{checkMessage(m) || decodeMessage(m, namedMaps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2>Live log</h2>
          <pre>{logs.join("\n")}</pre>
        </div>
      </section>

      {showCredits && (
        <div className="modalOverlay" onClick={() => setShowCredits(false)}>
          <div className="modalCard" onClick={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <h2>Credits</h2>
              <button onClick={() => setShowCredits(false)}>Close</button>
            </div>
            <p>
              Big thanks to everyone who pushed ION reverse-engineering forward. Primary credit first to{" "}
              <a href="https://github.com/void-spark" target="_blank" rel="noreferrer">void-spark</a>, followed by other key contributors:
            </p>
            <ul className="creditsList">
              <li><a href="https://github.com/void-spark" target="_blank" rel="noreferrer">void-spark</a> (major protocol analysis, tooling, calibration/assist insights)</li>
              <li><a href="https://github.com/stancecoke" target="_blank" rel="noreferrer">stancecoke</a> (ION translator work and docs)</li>
              <li><a href="https://github.com/InfantEudora" target="_blank" rel="noreferrer">InfantEudora</a> (early protocol groundwork and bus research)</li>
              <li><a href="https://www.pedelecforum.de/forum/index.php?threads/zweiter-fruehling-fuer-ion-antrieb-sparta-batavus-koga.90186/" target="_blank" rel="noreferrer">Pedelec-Forum contributors</a> including gpu7990, Gast1867 and Mike747</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
