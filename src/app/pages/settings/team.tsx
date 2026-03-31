import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/auth-context";
import { User, StaffPermissions } from "../../types";
import { toast } from "sonner";
import { getSupabase, isSupabaseConfigured } from "../../../lib/supabase";
import bcrypt from "bcryptjs";
import { UserPlus, ChevronDown } from "lucide-react";
import { formatDateForDB, logActivity as logDbActivity } from "../../../lib/db-utils";

type ProfileRow = {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  role: "admin" | "staff";
};

type StaffPermRow = {
  staff_profile_id: string;
  can_add_product: boolean;
  can_delete_product: boolean;
  can_edit_product: boolean;
  can_archive_product?: boolean | null;
  can_export_data?: boolean | null;
  can_grant_admin: boolean;
};

type NewUserForm = {
  fullName: string;
  username: string;
  email: string;
  role: "Admin" | "Staff";
  password: string;
  confirmPassword: string;
};

const defaultNewUserForm: NewUserForm = {
  fullName: "",
  username: "",
  email: "",
  role: "Staff",
  password: "",
  confirmPassword: "",
};

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const defaultStaffPerms: StaffPermissions = {
  addProduct: false,
  deleteProduct: false,
  editProduct: true,
  archiveProduct: false,
  exportData: false,
  addItem: false,
  deleteItem: false,
};

function isMissingOptionalPermissionColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  return (
    (message.includes("can_archive_product") && message.includes("column")) ||
    (message.includes("can_export_data") && message.includes("column"))
  );
}

function removeMissingPermissionColumnFromPayload<T extends Record<string, unknown>>(
  payload: T,
  error: unknown
): T {
  if (!error || typeof error !== "object") return payload;
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  const next = { ...payload };
  if (message.includes("can_archive_product") && message.includes("column")) {
    delete next.can_archive_product;
  }
  if (message.includes("can_export_data") && message.includes("column")) {
    delete next.can_export_data;
  }
  return next as T;
}

function getMissingPermissionColumns(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const message = String((error as { message?: unknown }).message || "").toLowerCase();
  const missing: string[] = [];
  if (message.includes("can_archive_product") && message.includes("column")) {
    missing.push("can_archive_product");
  }
  if (message.includes("can_export_data") && message.includes("column")) {
    missing.push("can_export_data");
  }
  return missing;
}

export function TeamManagementPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editedPermissions, setEditedPermissions] = useState<StaffPermissions | null>(null);
  const [grantAdminAccess, setGrantAdminAccess] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [deleteTargetUser, setDeleteTargetUser] = useState<User | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePasswordError, setDeletePasswordError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserForm, setNewUserForm] = useState<NewUserForm>(defaultNewUserForm);
  const [newStaffPermissions, setNewStaffPermissions] =
    useState<StaffPermissions>(defaultStaffPerms);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [addUserError, setAddUserError] = useState("");

  const canManageUsers = useMemo(() => currentUser?.role === "Admin", [currentUser?.role]);

  const loadUsers = async () => {
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }

    try {
      const supabase = getSupabase();
      const [
        { data: profiles, error: profileError },
        { data: perms, error: permsError },
        { data: accounts, error: accountsError },
      ] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, username, full_name, email, role")
            .order("created_at", { ascending: true }),
          supabase
            .from("staff_permissions")
            .select("*"),
          supabase
            .from("user_accounts")
            .select("profile_id, is_active"),
        ]);

      if (profileError) throw profileError;
      if (permsError) throw permsError;
      if (accountsError) throw accountsError;

      const permsMap = new Map<string, StaffPermRow>();
      (perms || []).forEach((perm) => {
        const row = perm as StaffPermRow;
        permsMap.set(row.staff_profile_id, row);
      });

      const activeMap = new Map<string, boolean>();
      (accounts || []).forEach((account) => {
        const row = account as { profile_id: string; is_active: boolean };
        activeMap.set(row.profile_id, !!row.is_active);
      });

      const mapped: User[] = (profiles || []).map((p) => {
        const profile = p as ProfileRow;
        const staffPerm = permsMap.get(profile.id);
        const isStaff = profile.role === "staff";

        return {
          id: profile.id,
          name: profile.full_name,
          email: profile.email || "",
          username: profile.username,
          password: "",
          role: isStaff ? "Staff" : "Admin",
          permissions: isStaff
            ? {
                addProduct: !!staffPerm?.can_add_product,
                deleteProduct: !!staffPerm?.can_delete_product,
                editProduct: !!staffPerm?.can_edit_product,
                archiveProduct: !!staffPerm?.can_archive_product,
                exportData: !!staffPerm?.can_export_data,
                addItem: false,
                deleteItem: false,
              }
            : undefined,
        };
      }).filter((row) => activeMap.get(row.id) !== false);

      setUsers(mapped);
    } catch (err) {
      console.error("Failed to load team data:", err);
      toast.error("Failed to load team data from Supabase");
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const handleEditPermissions = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    setEditingUserId(userId);
    if (user.role === "Staff") {
      setEditedPermissions(
        user.permissions || {
          addProduct: false,
          editProduct: false,
          deleteProduct: false,
          archiveProduct: false,
          exportData: false,
          addItem: false,
          deleteItem: false,
        }
      );
      setGrantAdminAccess(false);
      return;
    }

    setEditedPermissions({
      addProduct: true,
      editProduct: true,
      deleteProduct: true,
      archiveProduct: true,
      exportData: true,
      addItem: false,
      deleteItem: false,
    });
    setGrantAdminAccess(true);
  };

  const handlePermissionChange = (permission: keyof StaffPermissions) => {
    if (!editedPermissions) return;
    setEditedPermissions({
      ...editedPermissions,
      [permission]: !editedPermissions[permission],
    });
  };

  const handleSaveChanges = () => {
    setShowConfirmModal(true);
    setPasswordError("");
  };

  const verifyCurrentAdminPassword = async (plainPassword: string): Promise<boolean> => {
    if (!currentUser?.id) return false;
    const supabase = getSupabase();

    const { data: account, error } = await supabase
      .from("user_accounts")
      .select("password_hash")
      .eq("profile_id", currentUser.id)
      .eq("is_active", true)
      .single();

    if (error || !account?.password_hash) return false;
    return bcrypt.compare(plainPassword, account.password_hash);
  };

  const handleConfirmSave = () => {
    const run = async () => {
      if (!editingUserId || !editedPermissions) return;
      if (!isSupabaseConfigured()) {
        setPasswordError("Supabase is not configured");
        return;
      }

      setIsSaving(true);
      try {
        const isValidPassword = await verifyCurrentAdminPassword(adminPassword);
        if (!isValidPassword) {
          setPasswordError("Incorrect admin password");
          return;
        }

        const supabase = getSupabase();

        if (grantAdminAccess) {
          const { error: profileError } = await supabase
            .from("profiles")
            .update({ role: "admin" })
            .eq("id", editingUserId);
          if (profileError) throw profileError;

          const { error: deletePermError } = await supabase
            .from("staff_permissions")
            .delete()
            .eq("staff_profile_id", editingUserId);
          if (deletePermError) throw deletePermError;
        } else {
          const { error: profileError } = await supabase
            .from("profiles")
            .update({ role: "staff" })
            .eq("id", editingUserId);
          if (profileError) throw profileError;

          const upsertPayload = {
            staff_profile_id: editingUserId,
            can_add_product: editedPermissions.addProduct,
            can_delete_product: editedPermissions.deleteProduct,
            can_edit_product: editedPermissions.editProduct,
            can_archive_product: editedPermissions.archiveProduct,
            can_export_data: editedPermissions.exportData,
            can_grant_admin: false,
          };

          let { error: permsError } = await supabase
            .from("staff_permissions")
            .upsert(upsertPayload, { onConflict: "staff_profile_id" });

          // Backward compatibility: support databases without optional permission columns yet.
          if (permsError && isMissingOptionalPermissionColumn(permsError)) {
            const missingColumns = getMissingPermissionColumns(permsError);
            if (missingColumns.length > 0) {
              const warningMessage = `Database is missing staff permission column(s): ${missingColumns.join(", ")}. Permissions may not persist until schema is updated.`;
              console.warn(warningMessage, permsError);
              toast.warning(warningMessage);
            }
            const retryPayload = removeMissingPermissionColumnFromPayload(upsertPayload, permsError);
            ({ error: permsError } = await supabase
              .from("staff_permissions")
              .upsert(retryPayload, { onConflict: "staff_profile_id" }));
          }
          if (permsError) throw permsError;
        }

        if (currentUser) {
          await logDbActivity({
            snapshot_date: formatDateForDB(new Date()),
            actor_profile_id: currentUser.id,
            actor_username: currentUser.username,
            actor_role: currentUser.role.toLowerCase(),
            txn_type: "permission_change",
            note: `Updated permissions for ${editingUser.username} (${grantAdminAccess ? "admin" : "staff"})`,
            product_id: null,
            product_name: null,
          });
        }

        await loadUsers();
        toast.success("User updated successfully");
        setShowConfirmModal(false);
        setEditingUserId(null);
        setEditedPermissions(null);
        setGrantAdminAccess(false);
        setAdminPassword("");
        setPasswordError("");
      } catch (err) {
        console.error("Failed to save team permissions:", err);
        toast.error("Failed to save changes to Supabase");
      } finally {
        setIsSaving(false);
      }
    };

    void run();
  };

  const resetAddUserForm = () => {
    setNewUserForm(defaultNewUserForm);
    setNewStaffPermissions(defaultStaffPerms);
    setAddUserError("");
  };

  const handleCreateUser = () => {
    const run = async () => {
      if (!canManageUsers) return;
      if (!isSupabaseConfigured()) {
        setAddUserError("Supabase is not configured.");
        return;
      }

      const fullName = newUserForm.fullName.trim();
      const username = newUserForm.username.trim();
      const email = newUserForm.email.trim();
      const password = newUserForm.password;
      const confirmPassword = newUserForm.confirmPassword;

      if (!fullName || !username || !email || !password) {
        setAddUserError("Full name, username, email, and password are required.");
        return;
      }
      if (!isValidEmailAddress(email)) {
        setAddUserError("Please enter a valid email address.");
        return;
      }
      if (password.length < 6) {
        setAddUserError("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setAddUserError("Passwords do not match.");
        return;
      }

      setIsCreatingUser(true);
      setAddUserError("");
      let createdProfileId: string | null = null;

      try {
        const supabase = getSupabase();
        const passwordHash = await bcrypt.hash(password, 10);
        const role = newUserForm.role.toLowerCase() as "admin" | "staff";

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .insert({
            username,
            full_name: fullName,
            email: email || null,
            role,
          })
          .select("id")
          .single();

        if (profileError) throw profileError;
        createdProfileId = profile.id;

        const { error: accountError } = await supabase
          .from("user_accounts")
          .insert({
            profile_id: profile.id,
            password_hash: passwordHash,
            is_active: true,
          });
        if (accountError) throw accountError;

        if (role === "staff") {
          const insertPayload = {
            staff_profile_id: profile.id,
            can_add_product: newStaffPermissions.addProduct,
            can_delete_product: newStaffPermissions.deleteProduct,
            can_edit_product: newStaffPermissions.editProduct,
            can_archive_product: newStaffPermissions.archiveProduct,
            can_export_data: newStaffPermissions.exportData,
            can_grant_admin: false,
          };

          let { error: permsError } = await supabase
            .from("staff_permissions")
            .insert(insertPayload);

          // Backward compatibility: support databases without optional permission columns yet.
          if (permsError && isMissingOptionalPermissionColumn(permsError)) {
            const missingColumns = getMissingPermissionColumns(permsError);
            if (missingColumns.length > 0) {
              const warningMessage = `Database is missing staff permission column(s): ${missingColumns.join(", ")}. Permissions may not persist until schema is updated.`;
              console.warn(warningMessage, permsError);
              toast.warning(warningMessage);
            }
            const retryPayload = removeMissingPermissionColumnFromPayload(insertPayload, permsError);
            ({ error: permsError } = await supabase
              .from("staff_permissions")
              .insert(retryPayload));
          }
          if (permsError) throw permsError;
        }

        if (currentUser) {
          await logDbActivity({
            snapshot_date: formatDateForDB(new Date()),
            actor_profile_id: currentUser.id,
            actor_username: currentUser.username,
            actor_role: currentUser.role.toLowerCase(),
            txn_type: "permission_change",
            note: `Created user ${username} (${role})`,
            product_id: null,
            product_name: null,
          });
        }

        await loadUsers();
        toast.success("New user created successfully");
        setShowAddUserModal(false);
        resetAddUserForm();
      } catch (err: any) {
        if (createdProfileId) {
          const supabase = getSupabase();
          await supabase.from("profiles").delete().eq("id", createdProfileId);
        }

        const message =
          err?.code === "23505"
            ? "Username already exists. Please use another username."
            : "Failed to create user.";
        setAddUserError(message);
      } finally {
        setIsCreatingUser(false);
      }
    };

    void run();
  };

  const handleDiscardChanges = () => {
    setEditingUserId(null);
    setEditedPermissions(null);
    setGrantAdminAccess(false);
  };

  const handleAskDeleteUser = (target: User) => {
    if (target.id === currentUser?.id) {
      toast.error("You cannot delete your own account.");
      return;
    }
    setDeleteTargetUser(target);
    setDeletePassword("");
    setDeletePasswordError("");
    setShowDeleteUserModal(true);
  };

  const handleConfirmDeleteUser = () => {
    const run = async () => {
      if (!deleteTargetUser || !isSupabaseConfigured()) return;
      if (!deletePassword) {
        setDeletePasswordError("Please enter your admin password.");
        return;
      }

      setIsDeletingUser(true);
      try {
        const valid = await verifyCurrentAdminPassword(deletePassword);
        if (!valid) {
          setDeletePasswordError("Incorrect admin password.");
          return;
        }

        const supabase = getSupabase();
        const profileId = deleteTargetUser.id;

        // Delete dependent rows first.
        const { error: deletePermError } = await supabase
          .from("staff_permissions")
          .delete()
          .eq("staff_profile_id", profileId);
        if (deletePermError) throw deletePermError;

        const { error: deleteAccountError } = await supabase
          .from("user_accounts")
          .delete()
          .eq("profile_id", profileId);
        if (deleteAccountError) throw deleteAccountError;

        const { error: deleteProfileError } = await supabase
          .from("profiles")
          .delete()
          .eq("id", profileId);

        if (deleteProfileError) {
          // FK-safe fallback: keep historical logs immutable, deactivate account instead.
          if (deleteProfileError.code === "23503") {
            const softDeletedUsername = `deleted_${profileId.replace(/-/g, "").slice(0, 12)}_${Date.now()}`;
            const { error: restoreAccountAsInactiveError } = await supabase
              .from("user_accounts")
              .insert({
                profile_id: profileId,
                password_hash: await bcrypt.hash(`disabled-${Date.now()}`, 10),
                is_active: false,
              });

            if (restoreAccountAsInactiveError && restoreAccountAsInactiveError.code !== "23505") {
              throw restoreAccountAsInactiveError;
            }

            const { error: deactivateError } = await supabase
              .from("user_accounts")
              .update({ is_active: false })
              .eq("profile_id", profileId);
            if (deactivateError) throw deactivateError;

            const { error: anonymizeProfileError } = await supabase
              .from("profiles")
              .update({
                username: softDeletedUsername,
                full_name: "[Deleted User]",
                email: null,
                role: "staff",
              })
              .eq("id", profileId);
            if (anonymizeProfileError) throw anonymizeProfileError;

            toast.success("User removed (historical logs preserved).");
          } else {
            throw deleteProfileError;
          }
        } else {
          toast.success("User deleted successfully.");
        }

        if (currentUser) {
          await logDbActivity({
            snapshot_date: formatDateForDB(new Date()),
            actor_profile_id: currentUser.id,
            actor_username: currentUser.username,
            actor_role: currentUser.role.toLowerCase(),
            txn_type: "permission_change",
            note: `Removed user ${deleteTargetUser.username}`,
            product_id: null,
            product_name: null,
          });
        }

        await loadUsers();
        setShowDeleteUserModal(false);
        setDeleteTargetUser(null);
        setDeletePassword("");
        setDeletePasswordError("");
      } catch (err) {
        console.error("Failed to delete user:", err);
        toast.error("Failed to remove user from Supabase.");
      } finally {
        setIsDeletingUser(false);
      }
    };

    void run();
  };

  const editingUser = users.find((u) => u.id === editingUserId);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Admin Controls</h2>
        {canManageUsers && (
          <button
            onClick={() => {
              resetAddUserForm();
              setShowAddUserModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#8B2E2E] text-white text-sm font-semibold hover:bg-[#B23A3A] transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-[16px] overflow-hidden mb-4 shadow-sm">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Name</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Username</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Email</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Role</th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isEditing = editingUserId === user.id;
              const isCurrentUser = user.id === currentUser?.id;

              return (
                <tr key={user.id} className="border-b border-gray-100">
                  <td className="py-3 px-4 text-sm text-gray-900">{user.name}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">{user.username}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">{user.email}</td>
                  <td className="py-3 px-4 text-sm">
                    <span className="text-gray-600">
                      {user.role.toUpperCase()}
                      {isCurrentUser && <span className="ml-2 text-xs text-gray-500">(YOU)</span>}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        onClick={() => handleEditPermissions(user.id)}
                        className={`px-4 py-1.5 text-xs rounded border transition-colors ${
                          isEditing
                            ? "border-red-600 text-red-600 bg-red-50"
                            : "border-gray-300 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        Permissions
                      </button>
                      {canManageUsers && !isCurrentUser && (
                        <button
                          onClick={() => handleAskDeleteUser(user)}
                          className="px-4 py-1.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50 transition-colors"
                        >
                          Delete User
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingUserId && editingUser && (
        <>
          <div className="bg-white border border-gray-200 rounded p-4 mb-4">
            <div className="flex flex-wrap gap-8 mb-4">
              <PermissionCheckbox
                label="Add Product"
                checked={!!editedPermissions?.addProduct}
                onChange={() => handlePermissionChange("addProduct")}
                disabled={grantAdminAccess}
              />
              <PermissionCheckbox
                label="Delete Product"
                checked={!!editedPermissions?.deleteProduct}
                onChange={() => handlePermissionChange("deleteProduct")}
                disabled={grantAdminAccess}
              />
              <PermissionCheckbox
                label="Edit Product"
                checked={!!editedPermissions?.editProduct}
                onChange={() => handlePermissionChange("editProduct")}
                disabled={grantAdminAccess}
              />
              <PermissionCheckbox
                label="Archive Product"
                checked={!!editedPermissions?.archiveProduct}
                onChange={() => handlePermissionChange("archiveProduct")}
                disabled={grantAdminAccess}
              />
              <PermissionCheckbox
                label="Export"
                checked={!!editedPermissions?.exportData}
                onChange={() => handlePermissionChange("exportData")}
                disabled={grantAdminAccess}
              />
              <PermissionCheckbox
                label="Grant Admin Access"
                checked={grantAdminAccess}
                onChange={() => setGrantAdminAccess(!grantAdminAccess)}
              />
            </div>
          </div>

          <div className="flex justify-center gap-3">
            <button
              onClick={handleDiscardChanges}
              className="px-8 py-2 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
            >
              Discard Changes
            </button>
            <button
              onClick={handleSaveChanges}
              className="px-8 py-2 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
            >
              Save Changes
            </button>
          </div>
        </>
      )}

      {showAddUserModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-[16px] p-6 max-w-xl w-full mx-4 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900 mb-1">Add New User</h3>
            <p className="text-sm text-gray-500 mb-5">Create a staff or admin account for your team.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Full Name"
                value={newUserForm.fullName}
                onChange={(v) => setNewUserForm((p) => ({ ...p, fullName: v }))}
              />
              <Field
                label="Username"
                value={newUserForm.username}
                onChange={(v) => setNewUserForm((p) => ({ ...p, username: v }))}
              />
              <Field
                label="Email"
                type="email"
                value={newUserForm.email}
                onChange={(v) => setNewUserForm((p) => ({ ...p, email: v }))}
              />
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Role</label>
                <div className="relative">
                  <select
                    className="w-full h-10 rounded-lg border border-gray-300 px-3 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20 appearance-none"
                    value={newUserForm.role}
                    onChange={(e) => setNewUserForm((p) => ({ ...p, role: e.target.value as "Admin" | "Staff" }))}
                  >
                    <option value="Staff">Staff</option>
                    <option value="Admin">Admin</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                </div>
              </div>
              <Field
                label="Temporary Password"
                type="password"
                value={newUserForm.password}
                onChange={(v) => setNewUserForm((p) => ({ ...p, password: v }))}
              />
              <Field
                label="Confirm Password"
                type="password"
                value={newUserForm.confirmPassword}
                onChange={(v) => setNewUserForm((p) => ({ ...p, confirmPassword: v }))}
              />
            </div>

            {newUserForm.role === "Staff" && (
              <div className="mt-5 border border-gray-200 rounded-xl p-4 bg-gray-50">
                <p className="text-xs font-semibold text-gray-600 mb-3">Initial Staff Permissions</p>
                <div className="flex flex-wrap gap-6">
                  <PermissionCheckbox
                    label="Add Product"
                    checked={newStaffPermissions.addProduct}
                    onChange={() =>
                      setNewStaffPermissions((prev) => ({ ...prev, addProduct: !prev.addProduct }))
                    }
                  />
                  <PermissionCheckbox
                    label="Delete Product"
                    checked={newStaffPermissions.deleteProduct}
                    onChange={() =>
                      setNewStaffPermissions((prev) => ({ ...prev, deleteProduct: !prev.deleteProduct }))
                    }
                  />
                  <PermissionCheckbox
                    label="Edit Product"
                    checked={newStaffPermissions.editProduct}
                    onChange={() =>
                      setNewStaffPermissions((prev) => ({ ...prev, editProduct: !prev.editProduct }))
                    }
                  />
                  <PermissionCheckbox
                    label="Archive Product"
                    checked={newStaffPermissions.archiveProduct}
                    onChange={() =>
                      setNewStaffPermissions((prev) => ({
                        ...prev,
                        archiveProduct: !prev.archiveProduct,
                      }))
                    }
                  />
                  <PermissionCheckbox
                    label="Export"
                    checked={newStaffPermissions.exportData}
                    onChange={() =>
                      setNewStaffPermissions((prev) => ({
                        ...prev,
                        exportData: !prev.exportData,
                      }))
                    }
                  />
                </div>
              </div>
            )}

            {addUserError && <p className="text-xs text-red-600 mt-3">{addUserError}</p>}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowAddUserModal(false);
                  resetAddUserForm();
                }}
                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-800"
                disabled={isCreatingUser}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateUser}
                className="flex-1 px-4 py-2 bg-[#8B2E2E] text-white rounded-lg text-sm hover:bg-[#B23A3A] disabled:opacity-50"
                disabled={isCreatingUser}
              >
                {isCreatingUser ? "Creating..." : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Confirm Changes</h3>
            <p className="text-sm text-gray-600 mb-4">Are you sure you want to apply changes made?</p>

            <div className="mb-4">
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => {
                  setAdminPassword(e.target.value);
                  setPasswordError("");
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Please type in your admin password"
              />
              {passwordError && <p className="text-red-600 text-xs mt-2">{passwordError}</p>}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setAdminPassword("");
                  setPasswordError("");
                }}
                className="flex-1 px-4 py-2 bg-gray-800 text-white rounded text-sm hover:bg-gray-900"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSave}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteUserModal && deleteTargetUser && (
        <div className="fixed inset-0 bg-black/10 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl border border-gray-200">
            <h3 className="text-lg font-bold text-red-700 mb-2">Delete User</h3>
            <p className="text-sm text-gray-600 mb-3">
              You are deleting <strong>{deleteTargetUser.name}</strong> ({deleteTargetUser.username}).
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Enter your admin password to confirm removal.
            </p>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => {
                setDeletePassword(e.target.value);
                setDeletePasswordError("");
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="Admin password"
            />
            {deletePasswordError && (
              <p className="text-red-600 text-xs mt-2">{deletePasswordError}</p>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => {
                  setShowDeleteUserModal(false);
                  setDeleteTargetUser(null);
                  setDeletePassword("");
                  setDeletePasswordError("");
                }}
                className="flex-1 px-4 py-2 bg-gray-800 text-white rounded text-sm hover:bg-gray-900"
                disabled={isDeletingUser}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteUser}
                className="flex-1 px-4 py-2 bg-red-700 text-white rounded text-sm hover:bg-red-800 disabled:opacity-50"
                disabled={isDeletingUser}
              >
                {isDeletingUser ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
      />
    </div>
  );
}

interface PermissionCheckboxProps {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

function PermissionCheckbox({ label, checked, onChange, disabled }: PermissionCheckboxProps) {
  return (
    <label className={`flex items-center gap-2 cursor-pointer ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500 disabled:opacity-50"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}
