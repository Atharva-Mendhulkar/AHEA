import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonStore } from "../server/store.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("session persistence", () => {
  it("preserves but explicitly rejects legacy session files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ahea-store-")); roots.push(root);
    await mkdir(path.join(root, "sessions"), { recursive: true });
    await writeFile(path.join(root, "sessions", "legacy.json"), JSON.stringify({ schemaVersion: 2, id: "legacy", lifecycle: "READY" }));
    await expect(new JsonStore(root).loadSession("legacy")).rejects.toThrow(/Legacy session schema is unsupported/);
  });
});
