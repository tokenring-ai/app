import { describe, expect, it } from "bun:test";
import type { ConfigUIPluginSchema } from "../config/uiSchema.ts";
import { isSecretKeyName, REDACTED, redactConfigLayer, redactSecretKeys } from "../debug/redactSnapshot.ts";

const field = (key: string, sensitive = false) => ({
  kind: "field" as const,
  key,
  path: [key],
  label: key,
  field: { type: "string" as const },
  required: false,
  sensitive,
});

const uiSchemas = [
  {
    pluginName: "p",
    displayName: "P",
    description: "",
    version: "1",
    slices: {
      provider: {
        kind: "group",
        key: "provider",
        path: ["provider"],
        label: "Provider",
        children: [
          field("bearerValue", true),
          field("host"),
          { kind: "secret", key: "credential", path: ["credential"], label: "Credential", required: false, sensitive: true },
        ],
      },
    },
  },
] as unknown as ConfigUIPluginSchema[];

describe("redactConfigLayer", () => {
  it("redacts schema-marked sensitive values and keeps everything else", () => {
    const layer = { provider: { bearerValue: "abc", host: "h", credential: { env: "KEY" }, extra: 1 }, other: { x: 1 } };
    expect(redactConfigLayer(layer, uiSchemas)).toEqual({
      provider: { bearerValue: REDACTED, host: "h", credential: { env: "KEY" }, extra: 1 },
      other: { x: 1 },
    });
  });

  it("redacts a literal secret-source value", () => {
    expect(redactConfigLayer({ provider: { credential: "literal" } }, uiSchemas)).toEqual({ provider: { credential: REDACTED } });
  });
});

describe("redactSecretKeys", () => {
  it("matches common credential key names but not counters", () => {
    for (const key of ["password", "apiKey", "api_key", "privateKey", "Authorization", "accessToken", "clientSecret"]) {
      expect(isSecretKeyName(key)).toBe(true);
    }
    for (const key of ["maxTokens", "name", "secretsEnabled"]) expect(isSecretKeyName(key)).toBe(false);
  });

  it("only replaces non-empty strings", () => {
    expect(redactSecretKeys([{ token: "t", password: "", apiKey: 5 }])).toEqual([{ token: REDACTED, password: "", apiKey: 5 }]);
  });
});
