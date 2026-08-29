import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { DiagnosisSession, TimelineEvent } from "../shared/domain.js";
import { storedSessionHeaderSchema } from "../shared/schemas.js";

export class JsonStore {
  constructor(private readonly root: string) {}

  private sessionPath(id: string): string {
    return path.join(this.root, "sessions", `${id}.json`);
  }

  async saveSession(session: DiagnosisSession): Promise<void> {
    const directory = path.join(this.root, "sessions");
    await mkdir(directory, { recursive: true });
    const target = this.sessionPath(session.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(session, null, 2), "utf8");
    await rename(temporary, target);
  }

  async appendEvent(event: TimelineEvent): Promise<void> {
    const directory = path.join(this.root, "audit");
    await mkdir(directory, { recursive: true });
    await appendFile(path.join(directory, `${event.sessionId}.ndjson`), `${JSON.stringify(event)}\n`, "utf8");
  }

  async loadSession(id: string): Promise<DiagnosisSession | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.sessionPath(id), "utf8"));
      if (!parsed || typeof parsed !== "object" || !("schemaVersion" in parsed)) throw new Error("Legacy session schema is unsupported; preserve the file for audit and create a new session.");
      storedSessionHeaderSchema.parse(parsed);
      return parsed as DiagnosisSession;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}
