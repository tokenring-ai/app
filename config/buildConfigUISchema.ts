import type { TokenRingPlugin } from "../types.ts";
import { type ConfigFieldMeta, humanizeKey } from "./metadata.ts";
import type { ConfigFieldNode, ConfigFieldSpec, ConfigOpaqueNode, ConfigUINode, ConfigUIPluginSchema } from "./uiSchema.ts";

/**
 * Introspects a plugin's zod config schema into a serializable ConfigUINode
 * tree for the configuration UI.
 *
 * The walker derives field types and constraints from the zod definition and
 * overlays ConfigFieldMeta attached via `.meta()`. It never throws: any
 * construct it cannot map becomes an `opaque` node the UI renders as a raw
 * YAML editor.
 *
 * Zod v4 internals note: all unwrapping goes through `defOf`/`unwrap` below so
 * a zod upgrade only touches this file.
 */

interface ZodDef {
  type: string;
  [key: string]: any;
}

function defOf(schema: any): ZodDef {
  return schema._zod?.def ?? schema.def;
}

function metaOf(schema: any): ConfigFieldMeta | undefined {
  return typeof schema?.meta === "function" ? (schema.meta() as ConfigFieldMeta | undefined) : undefined;
}

interface Unwrapped {
  def: ZodDef;
  required: boolean;
  defaultValue: unknown;
  meta: ConfigFieldMeta;
}

const WRAPPER_TYPES = new Set(["optional", "nullable", "default", "prefault", "readonly", "catch", "nonoptional"]);

/**
 * Peels wrapper types down to the underlying node, tracking required-ness and
 * default value, and merging `.meta()` from every layer (innermost wins).
 */
function unwrap(schema: any): Unwrapped {
  let required = true;
  let defaultValue: unknown;
  let meta: ConfigFieldMeta = {};
  // oxlint-disable typescript/no-unsafe-assignment
  let current = schema;

  for (let depth = 0; depth < 32; depth++) {
    const layerMeta = metaOf(current);
    if (layerMeta) meta = { ...meta, ...layerMeta };

    const def = defOf(current);
    if (WRAPPER_TYPES.has(def.type)) {
      if (def.type === "nonoptional") {
        required = true;
      } else {
        required = false;
      }
      if ((def.type === "default" || def.type === "prefault") && defaultValue === undefined) {
        defaultValue = def.defaultValue;
      }
      // oxlint-disable typescript/no-unsafe-assignment
      current = def.innerType;
      continue;
    }
    if (def.type === "pipe") {
      // Transforms: the UI edits the input side.
      // oxlint-disable typescript/no-unsafe-assignment
      current = def.in;
      continue;
    }
    return { def, required, defaultValue, meta };
  }
  return { def: defOf(current), required, defaultValue, meta };
}

interface WalkResult {
  node: ConfigUINode;
  order: number | undefined;
}

interface NodeBase {
  key: string;
  path: string[];
  label: string;
  description?: string | undefined;
}

interface ZodCheckDef {
  check?: unknown;
  value?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  format?: unknown;
}

function checkDefOf(check: any): ZodCheckDef {
  return (check._zod?.def ?? check.def ?? check) as ZodCheckDef;
}

function numberChecks(def: ZodDef): { min?: number; max?: number; decimals?: number } {
  const out: { min?: number; max?: number; decimals?: number } = {};
  for (const check of def.checks ?? []) {
    const checkDef = checkDefOf(check);
    if (checkDef.check === "greater_than" && typeof checkDef.value === "number") out.min = checkDef.value;
    if (checkDef.check === "less_than" && typeof checkDef.value === "number") out.max = checkDef.value;
    if (checkDef.check === "number_format" && typeof checkDef.format === "string" && checkDef.format.includes("int")) out.decimals = 0;
  }
  return out;
}

function stringChecks(def: ZodDef): { minLength?: number; maxLength?: number } {
  const out: { minLength?: number; maxLength?: number } = {};
  for (const check of def.checks ?? []) {
    const checkDef = checkDefOf(check);
    if (checkDef.check === "min_length" && typeof checkDef.minimum === "number") out.minLength = checkDef.minimum;
    if (checkDef.check === "max_length" && typeof checkDef.maximum === "number") out.maxLength = checkDef.maximum;
  }
  return out;
}

function selectOptionsFrom(def: ZodDef): { label: string; value: string }[] | undefined {
  if (def.type === "enum") {
    return Object.values(def.entries as Record<string, string | number>).map(value => ({ label: String(value), value: String(value) }));
  }
  if (def.type === "literal") {
    return (def.values as unknown[]).map(value => ({ label: String(value), value: String(value) }));
  }
  if (def.type === "union") {
    const options: { label: string; value: string }[] = [];
    for (const option of def.options) {
      const inner = unwrap(option);
      const optionValues = selectOptionsFrom(inner.def);
      if (!optionValues) return undefined;
      options.push(...optionValues);
    }
    return options;
  }
  return undefined;
}

/** Applies a meta uiType override onto the derived spec, carrying constraints over. */
function applyUiTypeOverride(spec: ConfigFieldSpec, meta: ConfigFieldMeta): ConfigFieldSpec {
  const uiType = meta.uiType;
  if (!uiType || uiType === spec.type) return spec;

  const lengths = "minLength" in spec ? { minLength: spec.minLength, maxLength: spec.maxLength } : {};
  const range = "min" in spec ? { min: spec.min, max: spec.max, decimals: spec.decimals } : {};

  switch (uiType) {
    case "text":
    case "multilineText":
      return stripUndefined({ type: uiType, ...lengths });
    case "password":
      return { type: "password" };
    case "number":
    case "slider":
      return stripUndefined({ type: uiType, ...range });
    case "checkbox":
      return { type: "checkbox" };
    case "date":
      return { type: "date" };
    case "json":
      return { type: "json" };
    case "keyValueMap":
      return { type: "keyValueMap" };
    case "stringList":
      return { type: "stringList" };
    case "select": {
      const options = meta.options ?? ("options" in spec ? spec.options : undefined);
      return options ? { type: "select", options } : spec;
    }
    case "categorySelect":
      return meta.categories ? { type: "categorySelect", categories: meta.categories } : spec;
    default:
      return spec;
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

function fieldNode(base: NodeBase, spec: ConfigFieldSpec, unwrapped: Unwrapped): ConfigFieldNode {
  const { meta, required, defaultValue } = unwrapped;
  const finalSpec = applyUiTypeOverride(spec, meta);
  return stripUndefined({
    kind: "field" as const,
    ...base,
    field: meta.sensitive && finalSpec.type === "text" ? { type: "password" as const } : finalSpec,
    required,
    defaultValue,
    sensitive: meta.sensitive,
    restartRequired: meta.restartRequired,
    advanced: meta.advanced,
    placeholder: meta.placeholder,
    unit: meta.unit,
  });
}

function opaqueNode(base: NodeBase, reason: string, meta: ConfigFieldMeta = {}): ConfigOpaqueNode {
  return stripUndefined({
    kind: "opaque" as const,
    ...base,
    reason,
    sensitive: meta.sensitive,
    restartRequired: meta.restartRequired,
    advanced: meta.advanced,
  });
}

export function walkConfigSchema(schema: unknown, key: string, path: string[]): ConfigUINode | null {
  return walkNode(schema, key, path)?.node ?? null;
}

function walkNode(schema: unknown, key: string, path: string[]): WalkResult | null {
  let unwrapped: Unwrapped;
  try {
    unwrapped = unwrap(schema);
  } catch (error: unknown) {
    return {
      node: opaqueNode({ key, path, label: humanizeKey(key) }, `Failed to introspect schema: ${(error as Error).message}`),
      order: undefined,
    };
  }

  const { def, meta } = unwrapped;
  if (meta.hidden) return null;

  const base: NodeBase = stripUndefined({
    key,
    path,
    label: meta.label ?? humanizeKey(key),
    description: meta.description,
  });

  try {
    const node = walkDef(def, base, unwrapped);
    return { node, order: meta.order };
  } catch (error: unknown) {
    return {
      node: opaqueNode(base, `Failed to introspect schema: ${(error as Error).message}`, meta),
      order: meta.order,
    };
  }
}

function walkDef(def: ZodDef, base: NodeBase, unwrapped: Unwrapped): ConfigUINode {
  const { meta } = unwrapped;

  // An explicit uiType on a structured node (object/array/record) collapses it
  // into a single field — the escape hatch for "just edit this as JSON".
  if (meta.uiType && (def.type === "object" || def.type === "array" || def.type === "record")) {
    if (def.type === "array" && meta.uiType === "stringList") {
      return fieldNode(base, { type: "stringList" }, unwrapped);
    }
    if (def.type === "record" && meta.uiType === "keyValueMap") {
      return fieldNode(base, { type: "keyValueMap" }, unwrapped);
    }
    if (meta.uiType === "json") {
      return fieldNode(base, { type: "json" }, unwrapped);
    }
  }

  switch (def.type) {
    case "string":
      return fieldNode(base, { type: "text", ...stringChecks(def) }, unwrapped);
    case "number":
      return fieldNode(base, { type: "number", ...numberChecks(def) }, unwrapped);
    case "boolean":
      return fieldNode(base, { type: "checkbox" }, unwrapped);
    case "date":
      return fieldNode(base, { type: "date" }, unwrapped);
    case "enum":
    case "literal": {
      const options = selectOptionsFrom(def) ?? [];
      return fieldNode(base, { type: "select", options: meta.options ?? options }, unwrapped);
    }
    case "union": {
      const options = selectOptionsFrom(def);
      if (options) {
        return fieldNode(base, { type: "select", options: meta.options ?? options }, unwrapped);
      }
      const variantNode = buildVariantNode(def, base);
      if (variantNode) return variantNode;
      return opaqueNode(base, "Union type — edit as YAML", meta);
    }
    case "array": {
      const element = unwrap(def.element);
      if (element.def.type === "string" || element.def.type === "enum" || element.def.type === "literal") {
        return fieldNode(base, { type: "stringList", itemType: "string" }, unwrapped);
      }
      if (element.def.type === "number") {
        return fieldNode(base, { type: "stringList", itemType: "number" }, unwrapped);
      }
      // Item paths are relative to the item root; the frontend composes indices.
      const item = walkNode(def.element, "item", []);
      if (!item) {
        return opaqueNode(base, "Array of hidden items — edit as YAML", meta);
      }
      return { kind: "list", ...base, item: item.node };
    }
    case "object": {
      const shape = def.shape as Record<string, unknown>;
      const children: { node: ConfigUINode; order: number | undefined }[] = [];
      for (const [childKey, childSchema] of Object.entries(shape)) {
        const child = walkNode(childSchema, childKey, [...base.path, childKey]);
        if (child) children.push(child);
      }
      // Stable sort: weighted nodes first by weight, unweighted keep schema order.
      children.sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY));
      return stripUndefined({
        kind: "group" as const,
        ...base,
        children: children.map(child => child.node),
        advanced: meta.advanced,
      });
    }
    case "record": {
      const value = walkNode(def.valueType, "value", []);
      if (!value) {
        return opaqueNode(base, "Record of hidden values — edit as YAML", meta);
      }
      return { kind: "map", ...base, value: value.node };
    }
    default:
      return opaqueNode(base, `Unsupported schema type "${def.type}" — edit as YAML`, meta);
  }
}

/**
 * Maps a discriminated union of object shapes to a variant node: one group per
 * discriminator value, with the discriminator field itself excluded (the UI
 * renders it as the variant selector). Returns null when the union doesn't fit
 * that shape, letting the caller fall back to opaque.
 */
function buildVariantNode(def: ZodDef, base: NodeBase): ConfigUINode | null {
  const discriminator = def.discriminator as string | undefined;
  if (typeof discriminator !== "string") return null;

  const variants: Record<string, ConfigUINode> = {};
  for (const option of def.options as unknown[]) {
    const optionDef = unwrap(option).def;
    if (optionDef.type !== "object") return null;
    const shape = optionDef.shape as Record<string, unknown>;
    const discriminatorSchema = shape[discriminator];
    if (!discriminatorSchema) return null;
    const values = selectOptionsFrom(unwrap(discriminatorSchema).def);
    if (!values || values.length === 0) return null;

    const children: { node: ConfigUINode; order: number | undefined }[] = [];
    for (const [childKey, childSchema] of Object.entries(shape)) {
      if (childKey === discriminator) continue;
      const child = walkNode(childSchema, childKey, [...base.path, childKey]);
      if (child) children.push(child);
    }
    children.sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY));

    for (const value of values) {
      variants[value.value] = {
        kind: "group",
        key: value.value,
        path: base.path,
        label: humanizeKey(value.value),
        children: children.map(child => child.node),
      };
    }
  }
  return { kind: "variant", ...base, discriminator, variants } as ConfigUINode;
}

/**
 * Builds the per-plugin UI schema from `plugin.config`, one slice per
 * top-level config key the plugin owns. Returns null for plugins without
 * config.
 */
export default function buildConfigUISchema(plugin: TokenRingPlugin<any>): ConfigUIPluginSchema | null {
  if (!("config" in plugin)) return null;

  // oxlint-disable typescript/no-unsafe-assignment
  const config = plugin.config;
  const shape = (config.shape ?? defOf(config).shape) as Record<string, unknown> | undefined;
  if (!shape) return null;

  const slices: Record<string, ConfigUINode> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const result = walkNode(schema, key, [key]);
    if (result) slices[key] = result.node;
  }

  return {
    pluginName: plugin.name,
    displayName: plugin.displayName,
    description: plugin.description,
    version: plugin.version,
    slices,
  };
}
