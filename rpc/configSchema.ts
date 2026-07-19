import { z } from "zod";
import { ConfigUIPluginSchemaSchema } from "../config/uiSchema.ts";

export const ConfigIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

const ApplyResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), restartRequired: z.boolean() }),
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
        restartRequired: z.boolean(),
        overridesFile: z.string(),
        overlayError: z.string().nullable(),
      }),
    },
    getConfigValues: {
      type: "query" as const,
      input: z.object({}),
      result: z.object({
        effective: z.record(z.string(), z.unknown()),
        overrides: z.record(z.string(), z.unknown()),
      }),
    },
    validateConfig: {
      type: "mutation" as const,
      input: z.object({ overrides: z.record(z.string(), z.unknown()) }),
      result: z.discriminatedUnion("ok", [z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), issues: z.array(ConfigIssueSchema) })]),
    },
    // `overrides` is the FULL desired override set (idempotent PUT semantics, not a patch).
    applyConfig: {
      type: "mutation" as const,
      input: z.object({ overrides: z.record(z.string(), z.unknown()) }),
      result: ApplyResultSchema,
    },
    resetConfig: {
      type: "mutation" as const,
      input: z.object({ path: z.array(z.string()) }),
      result: ApplyResultSchema,
    },
  },
};

export default ConfigRpcSchema;
