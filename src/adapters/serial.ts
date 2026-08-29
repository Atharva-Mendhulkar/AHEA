import { ReadlineParser } from "@serialport/parser-readline";
import { SerialPort } from "serialport";
import type { AdapterResult, ExperimentTool, HardwareAdapter } from "../types.js";

interface PendingRequest {
  resolve: (result: AdapterResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class SerialHardwareAdapter implements HardwareAdapter {
  readonly identity;
  private readonly port: SerialPort;
  private readonly pending = new Map<string, PendingRequest>();

  private constructor(path: string, baudRate: number) {
    this.identity = {
      source: "physical" as const,
      adapter: "esp32" as const,
      deviceId: path,
      firmwareVersion: "unknown"
    };
    this.port = new SerialPort({ path, baudRate, autoOpen: false });
    const parser = this.port.pipe(new ReadlineParser({ delimiter: "\n" }));
    parser.on("data", (line: string) => this.handleLine(line));
    this.port.on("close", () => this.rejectAll(new Error("Serial connection closed.")));
    this.port.on("error", (error) => this.rejectAll(error));
  }

  static async connect(path: string, baudRate: number): Promise<SerialHardwareAdapter> {
    const adapter = new SerialHardwareAdapter(path, baudRate);
    await new Promise<void>((resolve, reject) => adapter.port.open((error) => error ? reject(error) : resolve()));
    const hello = await adapter.execute("scan_i2c", `hello-${Date.now()}`);
    if (hello.firmwareVersion) adapter.identity.firmwareVersion = hello.firmwareVersion;
    return adapter;
  }

  static async listPorts(): Promise<Array<{ path: string; manufacturer?: string; serialNumber?: string }>> {
    const ports = await SerialPort.list();
    return ports.map((port) => ({
      path: port.path,
      ...(port.manufacturer ? { manufacturer: port.manufacturer } : {}),
      ...(port.serialNumber ? { serialNumber: port.serialNumber } : {})
    }));
  }

  execute(tool: ExperimentTool, requestId: string): Promise<AdapterResult> {
    if (!this.port.isOpen) return Promise.reject(new Error("Serial port is not open."));
    if (this.pending.size > 0 && tool !== "emergency_stop") {
      return Promise.reject(new Error("Another hardware command is active."));
    }
    return new Promise<AdapterResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Hardware request ${requestId} timed out.`));
      }, 5000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.port.write(`${JSON.stringify({ id: requestId, cmd: tool, args: {} })}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(requestId);
          reject(error);
        }
      });
    });
  }

  async close(): Promise<void> {
    this.rejectAll(new Error("Adapter closed."));
    if (!this.port.isOpen) return;
    await new Promise<void>((resolve) => this.port.close(() => resolve()));
  }

  private handleLine(line: string): void {
    try {
      const message = JSON.parse(line) as AdapterResult & { id?: string };
      const id = message.requestId ?? message.id;
      if (!id) return;
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve({ ...message, requestId: id });
    } catch {
      // Malformed unsolicited data is ignored; the matching request will time out closed.
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
