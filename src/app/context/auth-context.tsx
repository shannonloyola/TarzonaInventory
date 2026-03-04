import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { AuthContextType, User, Role, StaffPermissions } from "../types";
import { getSupabase, isSupabaseConfigured } from "../../lib/supabase";
import { getSession, setSession, clearSession, SessionData } from "../../lib/db-utils";
import bcrypt from "bcryptjs";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type StaffPermissionRow = {
  can_add_product?: boolean | null;
  can_delete_product?: boolean | null;
  can_edit_product?: boolean | null;
  can_grant_admin?: boolean | null;
};

function normalizeStaffPermissions(perms: StaffPermissionRow | null | undefined): StaffPermissions {
  const canEdit = !!perms?.can_edit_product;
  return {
    addProduct: !!perms?.can_add_product,
    deleteProduct: !!perms?.can_delete_product,
    editProduct: canEdit,
    // Current schema has no separate item-level flags, so edit access also unlocks edit-mode item controls.
    addItem: canEdit,
    deleteItem: canEdit,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  // Restore session on mount
  useEffect(() => {
    const session = getSession();
    if (session) {
      // Restore user from session
      loadUserFromSession(session);
    }
  }, []);

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
    try {
      const supabase = getSupabase();

      // Query profile by username
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username)
        .single();

      if (profileError || !profile) {
        return false; // User not found
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

      // Check if selected role matches profile role
      const actualRole = profile.role as 'admin' | 'staff';
      const selectedRoleLower = selectedRole.toLowerCase() as 'admin' | 'staff';

      if (actualRole !== selectedRoleLower) {
        throw new Error(
          `This account is ${actualRole === "admin" ? "Admin" : "Staff"}. Select ${
            actualRole === "admin" ? "Admin" : "Staff"
          } role.`
        );
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
      value={{ user, login, logout, isAdmin, hasPermission }}
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
