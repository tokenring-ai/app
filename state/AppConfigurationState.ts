import deepClone from "@tokenring-ai/utility/object/deepClone";
import { z } from "zod";
import { LooseTokenRingAppConfigSchema } from "../schema.ts";
import type { TokenRingAppConfig } from "../schema.ts";
import type TokenRingApp from "../TokenRingApp.ts";
import { AppStateSlice } from "../types.ts";


const serializationSchema = z.object({
  config: LooseTokenRingAppConfigSchema
});

export class AppConfigurationState extends AppStateSlice<typeof serializationSchema> {
  config: TokenRingAppConfig;
  requiresRestartToFullyApplyConfig: boolean = false;

  constructor(readonly initialConfig: TokenRingAppConfig) {
    super("AppConfigurationState", serializationSchema);
    this.config = initialConfig;
  }

  serialize(): z.output<typeof serializationSchema> {
    return {
      config: this.config,
    };
  }

  deserialize(data: z.output<typeof serializationSchema>): void {
    this.config = data.config;;
  }

  /**
   * Swaps the app configuration in place, keeping the same object identity so
   * services holding a reference to `this.config` observe the update. Called
   * by ConfigurationService after plugins have been reconfigured.
   */
  static replaceConfig(newConfig: TokenRingAppConfig, app: TokenRingApp): void {
    app.stateManager.mutateState(AppConfigurationState, state => {
      for (const key of Object.keys(state.config)) {
        if (!(key in newConfig)) delete state.config[key];
      }
      state.config = deepClone(state.config, newConfig);
    });
  }
}
