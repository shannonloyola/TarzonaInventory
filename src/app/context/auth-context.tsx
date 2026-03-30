import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { AuthContextType, User, Role, StaffPermissions } from "../types";
import { getSupabase, isSupabaseConfigured } from "../../lib/supabase";
import { getSession, setSession, clearSession, SessionData } from "../../lib/db-utils";
import bcrypt from "bcryptjs";
import {
  createLegacyAuthAdapter,
  createSupabaseAuthAdapterNotReady,
  AuthAdapter,
} from "../../lib/auth-adapter";
import { getSecurityConfig } from "../../lib/security-config";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type StaffPermissionRow = {
  can_add_product?: boolean | null;
  can_delete_product?: boolean | null;
  can_edit_product?: boolean | null;
  can_archive_product?: boolean | null;
  can_grant_admin?: boolean | null;
};

function normalizeStaffPermissions(perms: StaffPermissionRow | null | undefined): StaffPermissions {
  const canEdit = !!perms?.can_edit_product;
  return {
    addProduct: !!perms?.can_add_product,
    deleteProduct: !!perms?.can_delete_product,
    editProduct: canEdit,
    archiveProduct:
      typeof perms?.can_archive_product === "boolean"
        ? perms.can_archive_product
        : canEdit,
    // Current schema has no separate item-level flags, so edit access also unlocks edit-mode item controls.
    addItem: canEdit,
    deleteItem: canEdit,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const security = getSecurityConfig();

  // Restore session on mount
  useEffect(() => {
    const run = async () => {
      if (security.authProviderMode === "legacy") {
        const session = getSession();
        if (session) {
          // Restore user from session
          await loadUserFromSession(session);
        }
        return;
      }

      // Supabase Auth mode scaffold only. Cutover remains disabled by default.
      await restoreFromSupabaseAuthSession();
    };

    void run();
  }, []);

  const restoreFromSupabaseAuthSession = async (): Promise<User | null> => {
    return null;
  };

  const loadUserFromSession = async (session: SessionData) => {
    try {
      // Check if Supabase is configured first (local storage or env)
      if (!isSupabaseConfigured()) {
        // Supabase not configured, clear session
        clearSession();
        return;
      }

      const supabase = getSupabase();
      
      // Load staff permissions if staff role
      let userPermissions: StaffPermissions | undefined = undefined;
      if (session.role === 'staff') {
        const { data: perms } = await supabase
          .from('staff_permissions')
          .select('*')
          .eq('staff_profile_id', session.profile_id)
          .maybeSingle();
        userPermissions = normalizeStaffPermissions((perms || null) as StaffPermissionRow | null);
      }

      setUser({
        id: session.profile_id,
        username: session.username,
        name: session.full_name,
        email: session.email || '',
        role: session.role === 'admin' ? 'Admin' : 'Staff',
        password: '', // Don't store password in memory
        permissions: userPermissions,
      });
    } catch (err) {
      console.error('Failed to load user from session:', err);
      clearSession();
    }
  };

  const login = async (
    username: string,
    password: string,
    selectedRole: Role
  ): Promise<boolean> => {
    if (security.authProviderMode === "supabase_auth") {
      const supabaseAuthAdapter = createSupabaseAuthAdapterNotReady();
      await supabaseAuthAdapter.login({ username, password, selectedRole });
      return false;
    }

    try {
      const supabase = getSupabase();
      const loginIdentifier = username.trim();
      if (!loginIdentifier) return false;

      // Query profile by username first, then fallback to email.
      let profile: any = null;
      const { data: profileByUsername, error: profileByUsernameError } = await supabase
        .from("profiles")
        .select("*")
        .eq("username", loginIdentifier)
        .maybeSingle();

      if (profileByUsernameError && profileByUsernameError.code !== "PGRST116") {
        throw profileByUsernameError;
      }
      profile = profileByUsername;

      if (!profile) {
        const { data: profileByEmail, error: profileByEmailError } = await supabase
          .from("profiles")
          .select("*")
          .ilike("email", loginIdentifier)
          .maybeSingle();

        if (profileByEmailError && profileByEmailError.code !== "PGRST116") {
          throw profileByEmailError;
        }
        profile = profileByEmail;
      }

      if (!profile) {
        return false; // User not found by username or email
      }

      // Query user_accounts by profile_id
      const { data: account, error: accountError } = await supabase
        .from('user_accounts')
        .select('*')
        .eq('profile_id', profile.id)
        .eq('is_active', true)
        .single();

      if (accountError || !account) {
        return false; // Account not found or inactive
      }

      // Compare password with bcrypt
      const passwordMatch = await bcrypt.compare(password, account.password_hash);
      if (!passwordMatch) {
        return false; // Password mismatch
      }

      // Check if selected role matches profile role (case-insensitive for DB values).
      const rawRole = String(profile.role || "").toLowerCase();
      const actualRole: "admin" | "staff" = rawRole === "admin" ? "admin" : "staff";
      const selectedRoleLower = selectedRole.toLowerCase() as 'admin' | 'staff';

      if (actualRole !== selectedRoleLower) {
        throw new Error(`ROLE_MISMATCH:${actualRole}`);
      }

      // Load staff permissions if staff role
      let userPermissions: StaffPermissions | undefined = undefined;
      if (actualRole === 'staff') {
        const { data: perms } = await supabase
          .from('staff_permissions')
          .select('*')
          .eq('staff_profile_id', profile.id)
          .maybeSingle();
        userPermissions = normalizeStaffPermissions((perms || null) as StaffPermissionRow | null);
      }

      // Create session
      const sessionData: SessionData = {
        profile_id: profile.id,
        username: profile.username,
        full_name: profile.full_name,
        role: actualRole,
        email: profile.email,
      };
      setSession(sessionData);

      // Set user state
      setUser({
        id: profile.id,
        username: profile.username,
        name: profile.full_name,
        email: profile.email || '',
        role: actualRole === 'admin' ? 'Admin' : 'Staff',
        password: '', // Don't store password
        permissions: userPermissions,
      });

      return true;
    } catch (err) {
      console.error('Login error:', err);
      throw err;
    }
  };

  const logout = () => {
    setUser(null);
    clearSession();
  };

  const legacyAuthAdapter: AuthAdapter = createLegacyAuthAdapter({
    // Scaffold only: business flow still uses existing legacy login/logout above.
    login: async () => ({ success: false }),
    restoreSession: async () => null,
    logout: async () => undefined,
  });

  // Keep adapter scaffold referenced for zero-behavior-change hardening groundwork.
  void legacyAuthAdapter;

  const updateUserLocal = (updates: Partial<Pick<User, "name" | "email" | "username">>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };

      const session = getSession();
      if (session && session.profile_id === prev.id) {
        setSession({
          ...session,
          full_name: next.name,
          email: next.email || null,
          username: next.username,
        });
      }

      return next;
    });
  };

  // Keep current staff permission flags in sync with Admin changes.
  useEffect(() => {
    if (!user?.id || user.role !== "Staff" || !isSupabaseConfigured()) return;

    let disposed = false;

    const refreshStaffPermissions = async () => {
      try {
        const supabase = getSupabase();
        const { data: perms } = await supabase
          .from("staff_permissions")
          .select("*")
          .eq("staff_profile_id", user.id)
          .maybeSingle();

        if (disposed) return;

        const normalized = normalizeStaffPermissions((perms || null) as StaffPermissionRow | null);
        setUser((prev) => {
          if (!prev || prev.id !== user.id) return prev;
          return { ...prev, permissions: normalized };
        });
      } catch (err) {
        console.error("Failed to refresh staff permissions:", err);
      }
    };

    void refreshStaffPermissions();
    const timer = window.setInterval(() => {
      void refreshStaffPermissions();
    }, 5000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [user?.id, user?.role]);

  const isAdmin = user?.role === "Admin";

  const hasPermission = (permission: keyof StaffPermissions): boolean => {
    if (isAdmin) return true;
    if (!user?.permissions) return false;
    return user.permissions[permission] === true;
  };

  return (
    <AuthContext.Provider
      value={{ user, login, logout, isAdmin, hasPermission, updateUserLocal }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
