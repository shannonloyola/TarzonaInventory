export type AuthProviderMode = "legacy" | "supabase_auth";

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "true";
}

function parseAuthMode(value: string | undefined): AuthProviderMode {
  if (value === "supabase_auth") return "supabase_auth";
  return "legacy";
}

export interface SecurityConfig {
  authProviderMode: AuthProviderMode;
  enableRouteGuard: boolean;
  enableSupabaseAuthShadowMode: boolean;
  enableRlsShadowMode: boolean;
}

export function getSecurityConfig(): SecurityConfig {
  return {
    // Keep legacy as default to preserve current user-facing behavior.
    authProviderMode: parseAuthMode(import.meta.env.VITE_AUTH_PROVIDER_MODE as string | undefined),
    enableRouteGuard: parseBooleanFlag(
      import.meta.env.VITE_ENABLE_ROUTE_GUARD as string | undefined,
      false
    ),
    enableSupabaseAuthShadowMode: parseBooleanFlag(
      import.meta.env.VITE_ENABLE_SUPABASE_AUTH_SHADOW_MODE as string | undefined,
      false
    ),
    enableRlsShadowMode: parseBooleanFlag(
      import.meta.env.VITE_ENABLE_RLS_SHADOW_MODE as string | undefined,
      false
    ),
  };
}

