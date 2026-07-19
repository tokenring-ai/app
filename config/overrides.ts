import { isPlainObject } from "@tokenring-ai/utility/object/isPlainObject";
import { deepEquals } from "bun";
import { type ConfigUINode, isRedactedSensitiveValue, isSensitiveKeepSentinel, type RedactedSensitiveValue } from "./uiSchema.ts";

/**
 * Helpers for manipulating sparse configuration override objects — the
 * deep-partial config the user has explicitly set, persisted to
 * ~/.tokenring/config.yaml.
 */

/**
 * Replaces sensitive values with `{ __sensitive: true, isSet }` sentinels,
 * guided by the UI schema. Group values are rebuilt from known child keys only,
 * so values of hidden fields never reach the client.
 */
export function redactSensitiveValues(node: ConfigUINode, value: unknown): unknown {
  if (value === undefined) return undefined;

  switch (node.kind) {
    case "field":
    case "opaque":
      if (node.sensitive) {
        return { __sensitive: true, isSet: value !== null && value !== "" } satisfies RedactedSensitiveValue;
      }
      return value;
    case "group": {
      if (!isPlainObject(value)) return value;
      const out: Record<string, unknown> = {};
      for (const child of node.children) {
        const childValue = redactSensitiveValues(child, (value as Record<string, unknown>)[child.key]);
        if (childValue !== undefined) out[child.key] = childValue;
      }
      return out;
    }
    case "list": {
      if (!Array.isArray(value)) return value;
      return value.map(item => redactSensitiveValues(node.item, item));
    }
    case "map": {
      if (!isPlainObject(value)) return value;
      const out: Record<string, unknown> = {};
      for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
        out[entryKey] = redactSensitiveValues(node.value, entryValue);
      }
      return out;
    }
    case "variant": {
      if (!isPlainObject(value)) return value;
      const record = value as Record<string, unknown>;
      const variant = node.variants[String(record[node.discriminator])];
      if (!variant) return value;
      const out = redactSensitiveValues(variant, value) as Record<string, unknown>;
      // The variant group excludes the discriminator field — carry it through.
      return { [node.discriminator]: record[node.discriminator], ...out };
    }
  }
}

/**
 * Resolves sensitive write sentinels in an incoming override object against
 * the currently stored overrides: `{ __sensitive: "keep" }` (or an echoed
 * redacted read value) becomes the stored value at the same path, or is
 * removed entirely when there is no stored override there.
 */
export function resolveSensitiveSentinels(candidate: unknown, stored: unknown): unknown {
  const resolved = resolveSentinel(candidate, stored);
  return resolved === REMOVE ? {} : resolved;
}

const REMOVE = Symbol("remove");

function resolveSentinel(candidate: unknown, stored: unknown): unknown {
  if (isSensitiveKeepSentinel(candidate) || isRedactedSensitiveValue(candidate)) {
    return stored === undefined ? REMOVE : stored;
  }
  if (Array.isArray(candidate)) {
    return candidate.map((item, index) => {
      const resolved = resolveSentinel(item, Array.isArray(stored) ? stored[index] : undefined);
      return resolved === REMOVE ? null : resolved;
    });
  }
  if (isPlainObject(candidate)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
      const resolved = resolveSentinel(value, isPlainObject(stored) ? (stored as Record<string, unknown>)[key] : undefined);
      if (resolved !== REMOVE) out[key] = resolved;
    }
    return out;
  }
  return candidate;
}

/**
 * Prunes an override object down to actual deviations from the base config:
 * leaves (and whole arrays) equal to the base value are dropped, and objects
 * left empty are dropped — unless the base has no object at that path, in
 * which case the empty object is kept (presence of a config key is meaningful:
 * it enables plugins).
 *
 * Returns undefined when nothing remains.
 */
export function pruneToOverrides(candidate: unknown, base: unknown): unknown {
  if (candidate === undefined) return undefined;
  if (isPlainObject(candidate)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
      const pruned = pruneToOverrides(value, isPlainObject(base) ? (base as Record<string, unknown>)[key] : undefined);
      if (pruned !== undefined) out[key] = pruned;
    }
    if (Object.keys(out).length > 0) return out;
    return isPlainObject(base) ? undefined : {};
  }
  return deepEquals(candidate, base, true) ? undefined : candidate;
}

/**
 * Deletes the value at `path` inside a (mutable) override object, removing
 * parent objects that become empty. An empty path clears everything.
 */
export function deleteAtPath(overrides: Record<string, unknown>, path: string[]): void {
  if (path.length === 0) {
    for (const key of Object.keys(overrides)) delete overrides[key];
    return;
  }
  const [head, ...rest] = path;
  if (rest.length === 0) {
    delete overrides[head!];
    return;
  }
  const child = overrides[head!];
  if (isPlainObject(child)) {
    deleteAtPath(child as Record<string, unknown>, rest);
    if (Object.keys(child as Record<string, unknown>).length === 0) delete overrides[head!];
  }
}
