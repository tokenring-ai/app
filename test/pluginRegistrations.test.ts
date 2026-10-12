import { describe, expect, it } from "bun:test";
import AgentCommandService from "@tokenring-ai/agent/services/AgentCommandService";
import type { TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import createLocalRPCClient from "@tokenring-ai/rpc/createLocalRPCClient";
import RpcService from "@tokenring-ai/rpc/RpcService";
import type { RpcEndpoint } from "@tokenring-ai/rpc/types";
import { z } from "zod";
import PluginManager from "../PluginManager.ts";
import { noteRegistration } from "../registrationOwner.ts";
import appRpc from "../rpc/app.ts";
import AppRpcSchema from "../rpc/schema.ts";
import type { TokenRingPlugin, TokenRingService } from "../types.ts";
import createTestingApp from "./createTestingApp.test.ts";

type TokenRingToolDefinition = {
  name: string;
  displayName: string;
  description: string;
  inputSchema: z.ZodType;
  execute: () => { message: string; result: string };
};

type NamedTool = {
  name: string;
  displayName: string;
  tool: () => never;
};

type ChatToolConfig = {
  agentType: string;
  displayName: string;
  description: string;
  category: string;
  inputArguments: Record<string, unknown>;
  steps: string[];
  subAgent: Record<string, unknown>;
};

function tool(name: string): TokenRingToolDefinition {
  return {
    name,
    displayName: name,
    description: name,
    inputSchema: z.object({}),
    execute: () => ({ message: "ok", result: "ok" }),
  };
}

function namedTool(name: string): NamedTool {
  return { name, displayName: name, tool: () => ({}) as never };
}

function command(name: string, alias?: string): TokenRingAgentCommand {
  return {
    name,
    ...(alias ? { alias } : {}),
    description: name,
    help: name,
    inputSchema: { args: {} },
    execute: () => "ok",
  };
}

function endpoint(path: string, methodName: string): RpcEndpoint {
  return {
    name: `${path}.${methodName}`,
    path,
    methods: {
      [methodName]: {
        type: "query",
        inputSchema: z.object({}),
        resultSchema: z.object({}),
        execute: () => ({}),
      },
    },
  };
}

const configuredTool: ChatToolConfig = {
  agentType: "default",
  displayName: "Configured",
  description: "from config",
  category: "User-Created Tools",
  inputArguments: {},
  steps: ["hello"],
  subAgent: {},
};

/** Local stand-in. The class name is the recorded service name; do not import `@tokenring-ai/chat` (that package already depends on this one). */
class ChatService implements TokenRingService {
  readonly name = "ChatService";
  description = "Stand-in for the chat tool registry";
  private readonly tools = new Map<string, unknown>();

  constructor(private readonly app: { forgetRegistration(kind: "tools", name: string): void }) {}

  addTools(definitions: TokenRingToolDefinition[]): void {
    for (const definition of definitions) {
      noteRegistration("tools", definition.name);
      this.tools.set(definition.name, definition);
    }
  }

  registerTool(name: string, tool: NamedTool): void {
    noteRegistration("tools", name);
    this.tools.set(name, tool);
  }

  unregisterTool(name: string): void {
    this.app.forgetRegistration("tools", name);
    this.tools.delete(name);
  }

  /** Config tools are reconciled, not attributed to a plugin. */
  reconfigureTools(toolDefinitions: Record<string, ChatToolConfig>): void {
    for (const [name, definition] of Object.entries(toolDefinitions)) {
      this.tools.set(name, definition);
    }
  }

  getAvailableToolNames(): string[] {
    return [...this.tools.keys()];
  }
}

class EarlyService implements TokenRingService {
  readonly name = "EarlyService";
  description = "Registered from earlyInstall";
}

class WidgetService implements TokenRingService {
  readonly name = "WidgetService";
  description = "Registered from install";
}

describe("plugin registration ownership", () => {
  it("attributes services, tools, commands, and RPC methods to the plugin that registered them", async () => {
    const app = createTestingApp();
    const pluginManager = app.addService(PluginManager, new PluginManager(app));

    // Installed first, so its waitForService callbacks run later, inside the host plugin's install.
    const widget: TokenRingPlugin<any, any> = {
      name: "@tokenring-ai/widget",
      displayName: "Widget",
      version: "1.0.0",
      description: "Widget plugin",
      earlyInstall(installApp) {
        installApp.addService(EarlyService, new EarlyService());
      },
      install(installApp) {
        installApp.addService(WidgetService, new WidgetService());
        installApp.waitForService(ChatService, chat => chat.addTools([tool("widget_spin")]));
        installApp.waitForService(AgentCommandService, commands => commands.addAgentCommands(command("widget spin", "ws")));
        // The callback is async on purpose: skills register commands after an await inside waitForService.
        installApp.waitForService(AgentCommandService, async commands => {
          await Promise.resolve();
          commands.addAgentCommands(command("widget after-await"));
        });
        installApp.waitForService(RpcService, rpc => rpc.registerEndpoint(endpoint("/rpc/widget", "ping")));
      },
      reconfigure(installApp) {
        installApp.requireService(ChatService).registerTool("widget_extra", namedTool("widget_extra"));
      },
      start(installApp) {
        installApp.requireService(RpcService).registerEndpoint(endpoint("/rpc/widget", "boot"));
      },
    };

    const host: TokenRingPlugin<any, any> = {
      name: "@tokenring-ai/host",
      displayName: "Host",
      version: "1.0.0",
      description: "Provides the registries",
      install(installApp) {
        installApp.addService(ChatService, new ChatService(installApp));
        installApp.addService(AgentCommandService, new AgentCommandService());
        installApp.addService(RpcService, new RpcService());
      },
      reconfigure(installApp) {
        // Package-config tools are reconciled, not registered by a plugin.
        installApp.requireService(ChatService).reconfigureTools({ configured_tool: configuredTool });
      },
    };

    const quiet: TokenRingPlugin<any, any> = {
      name: "@tokenring-ai/quiet",
      displayName: "Quiet",
      version: "1.0.0",
      description: "Registers nothing",
    };

    await pluginManager.installPlugins([widget, host, quiet]);

    expect(app.registrationsFor("@tokenring-ai/widget")).toEqual({
      services: ["EarlyService", "WidgetService"],
      tools: ["widget_extra", "widget_spin"],
      commands: ["widget after-await", "widget spin"],
      rpcMethods: ["/rpc/widget.boot", "/rpc/widget.ping"],
    });
    expect(app.registrationsFor("@tokenring-ai/host")).toEqual({
      services: ["AgentCommandService", "ChatService", "RpcService"],
      tools: [],
      commands: [],
      rpcMethods: [],
    });
    expect(app.registrationsFor("@tokenring-ai/quiet")).toEqual({
      services: [],
      tools: [],
      commands: [],
      rpcMethods: [],
    });

    const commands = app.requireService(AgentCommandService);
    expect(commands.getCommand("ws")?.name).toBe("widget spin");
    expect(app.requireService(ChatService).getAvailableToolNames()).toContain("configured_tool");

    // After the lifecycle frame ends, later registrations are not attributed to any plugin.
    commands.addAgentCommands(command("stray"));
    app.requireService(ChatService).addTools([tool("stray_tool")]);
    expect(app.registrationsFor("@tokenring-ai/widget").commands).toEqual(["widget after-await", "widget spin"]);
    expect(app.registrationsFor("@tokenring-ai/host").tools).toEqual([]);
    expect(app.registrationsFor("@tokenring-ai/quiet").commands).toEqual([]);

    app.requireService(ChatService).unregisterTool("widget_spin");
    expect(app.registrationsFor("@tokenring-ai/widget").tools).toEqual(["widget_extra"]);

    const client = createLocalRPCClient<typeof AppRpcSchema>(appRpc, app);
    const listed = await client.listPlugins({});
    expect(() => AppRpcSchema.methods.listPlugins.result.parse(listed)).not.toThrow();
    expect(listed.plugins.find(plugin => plugin.name === "@tokenring-ai/widget")).toMatchObject({
      services: ["EarlyService", "WidgetService"],
      tools: ["widget_extra"],
      commands: ["widget after-await", "widget spin"],
      rpcMethods: ["/rpc/widget.boot", "/rpc/widget.ping"],
    });
    expect(listed.plugins.find(plugin => plugin.name === "@tokenring-ai/quiet")).toMatchObject({
      services: [],
      tools: [],
      commands: [],
      rpcMethods: [],
    });
  });
});
