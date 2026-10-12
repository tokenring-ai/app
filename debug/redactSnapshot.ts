import { isPlainObject } from "@tokenring-ai/utility/object/isPlainObject";
import type { ConfigUINode, ConfigUIPluginSchema } from "../config/uiSchema.ts";

/** What a redacted credential is replaced with in a debug snapshot. */
export const REDACTED = "[REDACTED]";

/**
 * Key-name suffixes (lowercased, punctuation stripped) whose string values are
 * treated as credentials even when no config schema marks them sensitive.
 */
const SECRET_KEY_SUFFIXES = ["password", "passwd", "passphrase", "secret", "apikey", "privatekey", "authorization", "token", "cookie"];

/** Whether a property name looks like it holds a credential. */
export function isSecretKeyName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_KEY_SUFFIXES.some(suffix => normalized.endsWith(suffix));
}

/**
 * Deep-copies `value`, replacing every non-empty string held under a
 * credential-looking key with {@link REDACTED}. Numbers and booleans are left
 * alone, so counters such as `maxTokens` survive. Expects JSON-shaped input:
 * class instances are passed through untouched.
 */
export function redactSecretKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => redactSecretKeys(item));
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = isSecretKeyName(key) && typeof child === "string" && child !== "" ? REDACTED : redactSecretKeys(child);
  }
  return out;
}

/**
 * Replaces the values the config UI schema marks sensitive with
 * {@link REDACTED}. Unlike the UI's own redaction it keeps keys the schema does
 * not describe, since a debug snapshot should stay complete.
 */
function redactBySchema(node: ConfigUINode, value: unknown): unknown {
  if (value === undefined || value === null) return value;

  switch (node.kind) {
    case "field":
    case "opaque":
      return node.sensitive && value !== "" ? REDACTED : value;
    case "secret":
      // Env and vault references are pointers, not credentials.
      return node.sensitive && typeof value === "string" && value !== "" ? REDACTED : value;
    case "group": {
      if (!isPlainObject(value)) return value;
      const out: Record<string, unknown> = { ...value };
      for (const child of node.children) {
        if (child.key in out) out[child.key] = redactBySchema(child, out[child.key]);
      }
      return out;
    }
    case "list":
      return Array.isArray(value) ? value.map(item => redactBySchema(node.item, item)) : value;
    case "map": {
      if (!isPlainObject(value)) return value;
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactBySchema(node.value, entry)]));
    }
    case "variant": {
      if (!isPlainObject(value)) return value;
      const variant = node.variants[String(value[node.discriminator])];
      return variant ? redactBySchema(variant, value) : value;
    }
  }
}

/**
 * Redacts a config layer (top-level config key -> slice) using the sensitive
 * markers of the installed plugins' config UI schemas.
 */
export function redactConfigLayer(layer: unknown, uiSchemas: ConfigUIPluginSchema[]): unknown {
  if (!isPlainObject(layer)) return layer;
  const out: Record<string, unknown> = { ...layer };
  for (const uiSchema of uiSchemas) {
    for (const [key, node] of Object.entries(uiSchema.slices)) {
      if (key in out) out[key] = redactBySchema(node, out[key]);
    }
  }
  return out;
}
