import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import { AuthContextType, User, Role } from "../types";
import { getSupabase, isSupabaseConfigured } from "../../lib/supabase";
import { getSession, setSession, clearSession, SessionData } from "../../lib/db-utils";
import bcrypt from "bcryptjs";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<any>({});

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
      let userPermissions = {};
      if (session.role === 'staff') {
        const { data: perms } = await supabase
          .from('staff_permissions')
          .select('*')
          .eq('staff_profile_id', session.profile_id)
          .single();
        
        if (perms) {
          userPermissions = {
            addProduct: perms.can_add_product,
            deleteProduct: perms.can_delete_product,
            editProduct: perms.can_edit_product,
            grantAdmin: perms.can_grant_admin,
          };
        }
      }

      setUser({
        id: session.profile_id,
        username: session.username,
        fullName: session.full_name,
        email: session.email || '',
        role: session.role === 'admin' ? 'Admin' : 'Staff',
        password: '', // Don't store password in memory
        permissions: userPermissions,
      });
      setPermissions(userPermissions);
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
      let userPermissions = {};
      if (actualRole === 'staff') {
        const { data: perms } = await supabase
          .from('staff_permissions')
          .select('*')
          .eq('staff_profile_id', profile.id)
          .single();
        
        if (perms) {
          userPermissions = {
            addProduct: perms.can_add_product,
            deleteProduct: perms.can_delete_product,
            editProduct: perms.can_edit_product,
            grantAdmin: perms.can_grant_admin,
          };
        }
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
        fullName: profile.full_name,
        email: profile.email || '',
        role: actualRole === 'admin' ? 'Admin' : 'Staff',
        password: '', // Don't store password
        permissions: userPermissions,
      });
      setPermissions(userPermissions);

      return true;
    } catch (err) {
      console.error('Login error:', err);
      throw err;
    }
  };

  const logout = () => {
    setUser(null);
    setPermissions({});
    clearSession();
  };

  const isAdmin = user?.role === "Admin";

  const hasPermission = (permission: keyof typeof user.permissions): boolean => {
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
