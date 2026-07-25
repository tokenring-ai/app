import { z } from "zod";
import { configScopes } from "../config/scopes.ts";
import { ConfigUIPluginSchemaSchema } from "../config/uiSchema.ts";

export const ConfigIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

/** Which override layer a read or write targets. `project` takes precedence over `user`. */
export const ConfigScopeSchema = z.enum(configScopes);

const ScopedRecordSchema = z.object(
  Object.fromEntries(configScopes.map(scope => [scope, z.record(z.string(), z.unknown())])) as Record<
    (typeof configScopes)[number],
    z.ZodRecord<z.ZodString, z.ZodUnknown>
  >,
);

const ApplyResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), issues: z.array(ConfigIssueSchema) }),
]);

/**
 * RPC surface for the configuration UI.
 *
 * Sensitive values never cross the wire in plaintext on reads — they arrive as
 * `{ __sensitive: true, isSet }`. On writes the client sends
 * `{ __sensitive: "keep" }` to preserve a stored secret (see
 * ../config/uiSchema.ts for the shared sentinels).
 */
const ConfigRpcSchema = {
  name: "Config RPC",
  path: "/rpc/config",
  methods: {
    getConfigSchema: {
      type: "query" as const,
      input: z.object({}),
      result: z.object({
        plugins: z.array(ConfigUIPluginSchemaSchema),
        /** The file each scope is persisted to. */
        overridesFiles: z.object(Object.fromEntries(configScopes.map(scope => [scope, z.string()])) as Record<(typeof configScopes)[number], z.ZodString>),
        overlayError: z.string().nullable(),
      }),
    },
    getConfigValues: {
      type: "query" as const,
      input: z.object({}),
      result: z.object({
        effective: z.record(z.string(), z.unknown()),
        /** Overrides per scope, so the UI can show which layer a value comes from. */
        overrides: ScopedRecordSchema,
      }),
    },
    validateConfig: {
      type: "mutation" as const,
      input: z.object({ scope: ConfigScopeSchema, overrides: z.record(z.string(), z.unknown()) }),
      result: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), issues: z.array(ConfigIssueSchema) })]),
    },
    // `overrides` is the FULL desired override set for `scope` (idempotent PUT semantics, not a patch).
    applyConfig: {
      type: "mutation" as const,
      input: z.object({ scope: ConfigScopeSchema, overrides: z.record(z.string(), z.unknown()) }),
      result: ApplyResultSchema,
    },
    resetConfig: {
      type: "mutation" as const,
      input: z.object({ scope: ConfigScopeSchema, path: z.array(z.string()) }),
      result: ApplyResultSchema,
    },
  },
};

export default ConfigRpcSchema;
