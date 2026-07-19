import type { ConfigUIType } from "./uiSchema.ts";

/**
 * UI metadata that plugin authors attach to zod schema nodes via `.meta()`.
 *
 * Everything is optional — the introspection walker in buildConfigUISchema.ts
 * derives a usable field spec from the zod definition itself, and this metadata
 * only refines the result. Metadata placed on an inner node wins over metadata
 * on wrappers (`.optional()`, `.default()`, ...).
 */
export interface ConfigFieldMeta {
  /** Human name for the field. Default: humanized key ("maxFileSize" -> "Max File Size"). */
  label?: string;
  /** Help text rendered under the field. */
  description?: string;
  /** Override the auto-derived control type. */
  uiType?: ConfigUIType;
  /** Options for a select control (default: derived from the enum/literal values). */
  options?: { label: string; value: string }[];
  /** Grouped options for a categorySelect control. */
  categories?: Record<string, { label: string; value: string }[]>;
  /** Redact on read, mask input, write-only round-trip. */
  sensitive?: boolean;
  /** Changing this field always requires an app restart. */
  restartRequired?: boolean;
  /** Collapse into an "Advanced" disclosure in the UI. */
  advanced?: boolean;
  /** Sort weight within the parent group (lower first; unweighted fields keep schema order). */
  order?: number;
  /** Exclude from the configuration UI entirely (runtime-injected values, computed paths). */
  hidden?: boolean;
  /** Input placeholder text. */
  placeholder?: string;
  /** Unit suffix rendered next to the input ("ms", "KB", "tokens"). */
  unit?: string;
}

/**
 * Turn a schema key into a human-readable label:
 * "maxFileSize" -> "Max File Size", "api_key" -> "Api Key", "web-host" -> "Web Host".
 */
export function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
