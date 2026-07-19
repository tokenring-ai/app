import { describe, expect, it } from "bun:test";
import { z } from "zod";
import buildConfigUISchema, { walkConfigSchema } from "../config/buildConfigUISchema.ts";
import type { ConfigFieldMeta } from "../config/metadata.ts";
import { humanizeKey } from "../config/metadata.ts";
import type { ConfigFieldNode, ConfigGroupNode, ConfigListNode, ConfigMapNode, ConfigOpaqueNode, ConfigVariantNode } from "../config/uiSchema.ts";
import { ConfigUIPluginSchemaSchema } from "../config/uiSchema.ts";
import type { TokenRingPlugin } from "../types.ts";

function walkField(schema: unknown, key = "field"): ConfigFieldNode {
  const node = walkConfigSchema(schema, key, [key]);
  expect(node?.kind).toBe("field");
  return node as ConfigFieldNode;
}

describe("humanizeKey", () => {
  it("humanizes camelCase, snake_case and kebab-case", () => {
    expect(humanizeKey("maxFileSize")).toBe("Max File Size");
    expect(humanizeKey("api_key")).toBe("Api Key");
    expect(humanizeKey("web-host")).toBe("Web Host");
    expect(humanizeKey("port")).toBe("Port");
  });
});

describe("walkConfigSchema type mapping", () => {
  it("maps strings to text fields with length constraints", () => {
    const node = walkField(z.string().min(2).max(10));
    expect(node.field).toEqual({ type: "text", minLength: 2, maxLength: 10 });
    expect(node.required).toBe(true);
  });

  it("maps numbers to number fields with min/max", () => {
    const node = walkField(z.number().min(1).max(5));
    expect(node.field).toEqual({ type: "number", min: 1, max: 5 });
  });

  it("maps integers to decimals: 0", () => {
    const node = walkField(z.number().int().min(0));
    expect(node.field).toEqual({ type: "number", min: 0, decimals: 0 });
  });

  it("maps booleans to checkboxes", () => {
    expect(walkField(z.boolean()).field).toEqual({ type: "checkbox" });
  });

  it("maps enums to selects with derived options", () => {
    const node = walkField(z.enum(["posix", "docker"]));
    expect(node.field).toEqual({
      type: "select",
      options: [
        { label: "posix", value: "posix" },
        { label: "docker", value: "docker" },
      ],
    });
  });

  it("maps literal unions to selects", () => {
    const node = walkField(z.union([z.literal("a"), z.literal("b")]));
    expect(node.field).toEqual({
      type: "select",
      options: [
        { label: "a", value: "a" },
        { label: "b", value: "b" },
      ],
    });
  });

  it("maps non-literal unions to opaque nodes", () => {
    const node = walkConfigSchema(z.union([z.string(), z.object({ a: z.string() })]), "u", ["u"]) as ConfigOpaqueNode;
    expect(node.kind).toBe("opaque");
    expect(node.reason).toContain("Union");
  });

  it("maps discriminated unions of objects to variant nodes", () => {
    const schema = z.discriminatedUnion("provider", [
      z.object({ provider: z.literal("anthropic"), apiKey: z.string().meta({ sensitive: true }) }),
      z.object({ provider: z.literal("openai"), baseUrl: z.string() }),
    ]);
    const node = walkConfigSchema(schema, "p", ["providers"]) as ConfigVariantNode;
    expect(node.kind).toBe("variant");
    expect(node.discriminator).toBe("provider");
    expect(Object.keys(node.variants).sort()).toEqual(["anthropic", "openai"]);

    const anthropic = node.variants.anthropic!;
    expect(anthropic.children.map(child => child.key)).toEqual(["apiKey"]);
    expect((anthropic.children[0] as ConfigFieldNode).sensitive).toBe(true);
    // discriminator is the selector, not a field
    expect(anthropic.children.some(child => child.key === "provider")).toBe(false);
  });

  it("maps string arrays to stringList fields", () => {
    expect(walkField(z.array(z.string())).field).toEqual({ type: "stringList", itemType: "string" });
    expect(walkField(z.array(z.number())).field).toEqual({ type: "stringList", itemType: "number" });
    expect(walkField(z.array(z.enum(["a", "b"]))).field).toEqual({ type: "stringList", itemType: "string" });
  });

  it("maps object arrays to list nodes with relative item paths", () => {
    const node = walkConfigSchema(z.array(z.object({ path: z.string() })), "matches", ["fs", "matches"]) as ConfigListNode;
    expect(node.kind).toBe("list");
    expect(node.item.kind).toBe("group");
    const item = node.item as ConfigGroupNode;
    expect(item.children[0]!.path).toEqual(["path"]);
  });

  it("maps objects to groups with full child paths", () => {
    const node = walkConfigSchema(z.object({ fileRead: z.object({ maxFileSize: z.number() }) }), "filesystem", ["filesystem"]) as ConfigGroupNode;
    expect(node.kind).toBe("group");
    const fileRead = node.children[0] as ConfigGroupNode;
    expect(fileRead.kind).toBe("group");
    expect(fileRead.children[0]!.path).toEqual(["filesystem", "fileRead", "maxFileSize"]);
  });

  it("maps records to map nodes with relative value paths", () => {
    const node = walkConfigSchema(z.record(z.string(), z.object({ url: z.string() })), "databases", ["databases"]) as ConfigMapNode;
    expect(node.kind).toBe("map");
    expect(node.value.kind).toBe("group");
    expect((node.value as ConfigGroupNode).children[0]!.path).toEqual(["url"]);
  });

  it("falls back to opaque for unmappable schemas without throwing", () => {
    for (const schema of [z.any(), z.unknown(), z.tuple([z.string(), z.number()]), z.lazy(() => z.string())]) {
      const node = walkConfigSchema(schema, "x", ["x"]);
      expect(node?.kind).toBe("opaque");
    }
  });
});

describe("walkConfigSchema wrappers and defaults", () => {
  it("treats optional/default/prefault/exactOptional as not required and captures defaults", () => {
    expect(walkField(z.string().optional()).required).toBe(false);
    expect(walkField(z.string().exactOptional()).required).toBe(false);

    const withDefault = walkField(z.number().default(42));
    expect(withDefault.required).toBe(false);
    expect(withDefault.defaultValue).toBe(42);

    const group = walkConfigSchema(z.object({ a: z.string().default("x") }).prefault({}), "g", ["g"]) as ConfigGroupNode;
    expect(group.kind).toBe("group");
    expect((group.children[0] as ConfigFieldNode).defaultValue).toBe("x");
  });

  it("walks the input side of transforms", () => {
    const node = walkField(z.string().transform(value => value.length));
    expect(node.field.type).toBe("text");
  });
});

describe("walkConfigSchema meta overlay", () => {
  it("applies label, description, placeholder and unit", () => {
    const node = walkField(z.number().meta({ label: "Max size", description: "Largest file", unit: "bytes", placeholder: "131072" } satisfies ConfigFieldMeta));
    expect(node.label).toBe("Max size");
    expect(node.description).toBe("Largest file");
    expect(node.unit).toBe("bytes");
    expect(node.placeholder).toBe("131072");
  });

  it("survives wrapping when meta is on the inner node, and inner meta wins", () => {
    const node = walkField(z.string().meta({ label: "Inner" }).optional());
    expect(node.label).toBe("Inner");

    const both = walkField(z.string().meta({ label: "Inner" }).optional().meta({ label: "Outer", description: "outer desc" }));
    expect(both.label).toBe("Inner");
    expect(both.description).toBe("outer desc");
  });

  it("overrides the control via uiType, carrying constraints", () => {
    expect(walkField(z.string().min(2).meta({ uiType: "multilineText" })).field).toEqual({ type: "multilineText", minLength: 2 });
    expect(walkField(z.number().min(0).max(1).meta({ uiType: "slider" })).field).toEqual({ type: "slider", min: 0, max: 1 });
  });

  it("treats sensitive text fields as password inputs", () => {
    const node = walkField(z.string().meta({ sensitive: true }));
    expect(node.sensitive).toBe(true);
    expect(node.field).toEqual({ type: "password" });
  });

  it("prunes hidden nodes", () => {
    const group = walkConfigSchema(z.object({ shown: z.string(), secret: z.string().meta({ hidden: true }) }), "g", ["g"]) as ConfigGroupNode;
    expect(group.children.map(child => child.key)).toEqual(["shown"]);
  });

  it("collapses structured nodes to a json field via uiType", () => {
    const node = walkConfigSchema(z.object({ a: z.string() }).meta({ uiType: "json" }), "blob", ["blob"]);
    expect(node?.kind).toBe("field");
    expect((node as ConfigFieldNode).field.type).toBe("json");
  });

  it("propagates restartRequired and advanced flags", () => {
    const node = walkField(z.number().meta({ restartRequired: true, advanced: true }));
    expect(node.restartRequired).toBe(true);
    expect(node.advanced).toBe(true);
  });

  it("sorts weighted children first, keeping schema order for the rest", () => {
    const group = walkConfigSchema(
      z.object({
        c: z.string(),
        b: z.string().meta({ order: 1 }),
        a: z.string(),
      }),
      "g",
      ["g"],
    ) as ConfigGroupNode;
    expect(group.children.map(child => child.key)).toEqual(["b", "c", "a"]);
  });
});

describe("buildConfigUISchema", () => {
  const configSchema = z.object({
    filesystem: z
      .object({
        provider: z.enum(["posix", "docker"]).default("posix"),
        workingDirectory: z.string().meta({ hidden: true }),
        fileRead: z.object({ maxFileSize: z.number().min(1).default(1024) }).prefault({}),
      })
      .optional(),
  });

  const plugin = {
    name: "@tokenring-ai/filesystem",
    displayName: "Filesystem",
    version: "1.0.0",
    description: "Filesystem plugin",
    config: configSchema,
  } satisfies TokenRingPlugin<typeof configSchema>;

  it("produces one slice per top-level config key", () => {
    const uiSchema = buildConfigUISchema(plugin);
    expect(uiSchema).not.toBeNull();
    expect(Object.keys(uiSchema!.slices)).toEqual(["filesystem"]);
    expect(uiSchema!.pluginName).toBe("@tokenring-ai/filesystem");

    const slice = uiSchema!.slices.filesystem as ConfigGroupNode;
    expect(slice.kind).toBe("group");
    expect(slice.children.map(child => child.key)).toEqual(["provider", "fileRead"]);
  });

  it("output validates against the wire schema", () => {
    const uiSchema = buildConfigUISchema(plugin);
    expect(() => ConfigUIPluginSchemaSchema.parse(uiSchema)).not.toThrow();
  });
});
