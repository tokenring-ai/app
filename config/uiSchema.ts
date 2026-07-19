import { z } from "zod";

/**
 * Serializable UI schema for plugin configuration, generated server-side from
 * plugin zod config schemas by buildConfigUISchema.ts and shipped to the
 * frontend over RPC. The frontend renders these nodes directly and never sees
 * zod schemas.
 */

export const CONFIG_UI_TYPES = [
  "text",
  "multilineText",
  "password",
  "number",
  "slider",
  "checkbox",
  "date",
  "select",
  "categorySelect",
  "stringList",
  "keyValueMap",
  "json",
] as const;

export type ConfigUIType = (typeof CONFIG_UI_TYPES)[number];

const SelectOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

/** The control to render for a leaf field, plus its constraints. */
export const ConfigFieldSpecSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
  }),
  z.object({
    type: z.literal("multilineText"),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
  }),
  z.object({ type: z.literal("password") }),
  z.object({
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
    decimals: z.number().optional(),
  }),
  z.object({
    type: z.literal("slider"),
    min: z.number().optional(),
    max: z.number().optional(),
    decimals: z.number().optional(),
  }),
  z.object({ type: z.literal("checkbox") }),
  z.object({ type: z.literal("date") }),
  z.object({
    type: z.literal("select"),
    options: z.array(SelectOptionSchema),
  }),
  z.object({
    type: z.literal("categorySelect"),
    categories: z.record(z.string(), z.array(SelectOptionSchema)),
  }),
  z.object({
    type: z.literal("stringList"),
    itemType: z.enum(["string", "number"]).optional(),
  }),
  z.object({ type: z.literal("keyValueMap") }),
  z.object({ type: z.literal("json") }),
]);

export type ConfigFieldSpec = z.output<typeof ConfigFieldSpecSchema>;

interface ConfigUINodeBase {
  /** Key of this node within its parent ("filesystem", "maxFileSize"). */
  key: string;
  /**
   * Path from the config root to this node ("filesystem.agentDefaults.fileRead.maxFileSize").
   * Children of `list` and `map` nodes carry paths RELATIVE to the item root
   * (the frontend composes the absolute path with the index/entry key).
   */
  path: string[];
  label: string;
  description?: string | undefined;
}

export interface ConfigGroupNode extends ConfigUINodeBase {
  kind: "group";
  children: ConfigUINode[];
  advanced?: boolean | undefined;
}

export interface ConfigFieldNode extends ConfigUINodeBase {
  kind: "field";
  field: ConfigFieldSpec;
  required: boolean;
  defaultValue?: unknown;
  sensitive?: boolean | undefined;
  restartRequired?: boolean | undefined;
  advanced?: boolean | undefined;
  placeholder?: string | undefined;
  unit?: string | undefined;
}

/** A homogeneous array of structured items (z.array of objects). */
export interface ConfigListNode extends ConfigUINodeBase {
  kind: "list";
  item: ConfigUINode;
}

/** Dynamic named entries (z.record) — e.g. provider registries keyed by name. */
export interface ConfigMapNode extends ConfigUINodeBase {
  kind: "map";
  value: ConfigUINode;
}

/**
 * A discriminated union of object shapes (z.discriminatedUnion) — the UI shows
 * a select for the discriminator and the matching variant's fields. Variant
 * group children carry paths in the same frame as the variant node itself.
 */
export interface ConfigVariantNode extends ConfigUINodeBase {
  kind: "variant";
  discriminator: string;
  /** Discriminator value -> group node for that variant (discriminator field excluded). */
  variants: Record<string, ConfigGroupNode>;
}

/** Subtree the walker could not map — the UI falls back to a raw YAML editor. */
export interface ConfigOpaqueNode extends ConfigUINodeBase {
  kind: "opaque";
  reason: string;
  sensitive?: boolean | undefined;
  restartRequired?: boolean | undefined;
  advanced?: boolean | undefined;
}

export type ConfigUINode = ConfigGroupNode | ConfigFieldNode | ConfigListNode | ConfigMapNode | ConfigVariantNode | ConfigOpaqueNode;

const ConfigUINodeBaseShape = {
  key: z.string(),
  path: z.array(z.string()),
  label: z.string(),
  description: z.string().optional(),
};

export const ConfigUINodeSchema: z.ZodType<ConfigUINode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      ...ConfigUINodeBaseShape,
      kind: z.literal("group"),
      children: z.array(ConfigUINodeSchema),
      advanced: z.boolean().optional(),
    }),
    z.object({
      ...ConfigUINodeBaseShape,
      kind: z.literal("field"),
      field: ConfigFieldSpecSchema,
      required: z.boolean(),
      defaultValue: z.unknown().optional(),
      sensitive: z.boolean().optional(),
      restartRequired: z.boolean().optional(),
      advanced: z.boolean().optional(),
      placeholder: z.string().optional(),
      unit: z.string().optional(),
    }),
    z.object({
      ...ConfigUINodeBaseShape,
      kind: z.literal("list"),
      item: ConfigUINodeSchema,
    }),
    z.object({
      ...ConfigUINodeBaseShape,
      kind: z.literal("map"),
      value: ConfigUINodeSchema,
    }),
    z.object({
      ...ConfigUINodeBaseShape,
      kind: z.literal("variant"),
      discriminator: z.string(),
      variants: z.record(z.string(), ConfigUINodeSchema),
    }),
    z.object({
      ...ConfigUINodeBaseShape,
      kind: z.literal("opaque"),
      reason: z.string(),
      sensitive: z.boolean().optional(),
      restartRequired: z.boolean().optional(),
      advanced: z.boolean().optional(),
    }),
  ]),
) as z.ZodType<ConfigUINode>;

export const ConfigUIPluginSchemaSchema = z.object({
  pluginName: z.string(),
  displayName: z.string(),
  description: z.string(),
  version: z.string(),
  /** One entry per top-level config key the plugin owns ("filesystem", "webHost"). */
  slices: z.record(z.string(), ConfigUINodeSchema),
});

export type ConfigUIPluginSchema = z.output<typeof ConfigUIPluginSchemaSchema>;

/**
 * Wire sentinels for sensitive values.
 *
 * Reads: the server replaces the stored value with `{ __sensitive: true, isSet }`.
 * Writes: the client sends `{ __sensitive: "keep" }` to preserve the stored
 * value, or a plaintext replacement.
 */
export const SENSITIVE_REDACTED = { __sensitive: true } as const;
export const SENSITIVE_KEEP = { __sensitive: "keep" } as const;

export interface RedactedSensitiveValue {
  __sensitive: true;
  isSet: boolean;
}

export function isRedactedSensitiveValue(value: unknown): value is RedactedSensitiveValue {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).__sensitive === true;
}

export function isSensitiveKeepSentinel(value: unknown): value is typeof SENSITIVE_KEEP {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).__sensitive === "keep";
}
