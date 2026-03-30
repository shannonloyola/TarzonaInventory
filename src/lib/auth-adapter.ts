import { Role, StaffPermissions, User } from "../app/types";

export type AuthAdapterLoginInput = {
  username: string;
  password: string;
  selectedRole: Role;
};

export type AuthAdapterLoginResult = {
  success: boolean;
  user?: User;
  permissions?: StaffPermissions;
};

export interface AuthAdapter {
  mode: "legacy" | "supabase_auth";
  login: (input: AuthAdapterLoginInput) => Promise<AuthAdapterLoginResult>;
  restoreSession: () => Promise<User | null>;
  logout: () => Promise<void>;
}

// Legacy adapter preserves current behavior by delegating to existing custom auth flow.
export function createLegacyAuthAdapter(
  impl: Pick<AuthAdapter, "login" | "restoreSession" | "logout">
): AuthAdapter {
  return {
    mode: "legacy",
    login: impl.login,
    restoreSession: impl.restoreSession,
    logout: impl.logout,
  };
}

// Supabase Auth adapter is intentionally non-cutover groundwork.
export function createSupabaseAuthAdapterNotReady(): AuthAdapter {
  return {
    mode: "supabase_auth",
    login: async () => {
      throw new Error("SUPABASE_AUTH_CUTOVER_NOT_ENABLED");
    },
    restoreSession: async () => null,
    logout: async () => undefined,
  };
}

