import fs from "node:fs";
import path from "node:path";
import { YAML } from "bun";

/**
 * Writes a value as block-style YAML via a temp file + rename so a crash never
 * leaves a half-written config file behind.
 */
export default function writeYamlAtomic(filePath: string, value: unknown, header?: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const isEmptyObject = typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
  const yaml = isEmptyObject ? "" : YAML.stringify(value, null, 2).trimEnd();
  const content = `${header ? `${header.trimEnd()}\n` : ""}${yaml ? `${yaml}\n` : ""}`;

  const tmpFile = `${filePath}.tmp`;
  fs.writeFileSync(tmpFile, content);
  fs.renameSync(tmpFile, filePath);
}
