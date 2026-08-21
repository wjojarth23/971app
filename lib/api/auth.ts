import { registry } from "../openapi/registry";
import { ScopeLeaf, scopes, ScopeTree } from "../scopes";

function scopesToDict<T extends ScopeTree>(tree: T): Record<string, string> {
  let result: Record<string, string> = {};

  for (const value of Object.values(tree)) {
    if (typeof value === "object" && value && "name" in value) {
      const leaf = value as ScopeLeaf;
      result[leaf.name] = leaf.description;
    } else result = { ...result, ...scopesToDict(value) }
  }

  return result;
}

export const userSession = registry.registerComponent("securitySchemes", "userSession", {
  type: "apiKey",
  in: "cookie",
  name: "better-auth.session_token",
  description: "User authentication is managed by Better Auth. The session cookie is issued after login and automatically sent by the browser on authenticated requests."
});

export const apiKey = registry.registerComponent("securitySchemes", "apiKey", {
  type: "oauth2",
  flows: {
    clientCredentials: {
      tokenUrl: "/api/teams/{id}/keys",
      scopes: scopesToDict(scopes)
    }
  },
  description: "API Key authentication. Clients must provide a valid API key using the Authorization header"
});
