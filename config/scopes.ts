/**
 * The configuration override layers a user can edit, lowest precedence first:
 * `project` overrides `user`, and both override the app and plugin defaults.
 *
 * Kept dependency-free so the RPC schema and the web client can import it
 * without pulling in the app runtime.
 */
export const configScopes = ["user", "project"] as const;

export type ConfigScope = (typeof configScopes)[number];

export const configScopeLabels: Record<ConfigScope, string> = {
  user: "User",
  project: "Project",
};
