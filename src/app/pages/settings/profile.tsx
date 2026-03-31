import { useState } from "react";
import { useAuth } from "../../context/auth-context";
import { toast } from "sonner";
import { getSupabase, isSupabaseConfigured } from "../../../lib/supabase";
import bcrypt from "bcryptjs";
import { formatDateForDB, logActivity as logDbActivity } from "../../../lib/db-utils";

type EditableField = "Name" | "Email" | "Username";

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function ProfilePage() {
  const { user, updateUserLocal } = useAuth();
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changePasswordError, setChangePasswordError] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  if (!user) return null;

  const handleEdit = (field: EditableField, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
    setPasswordError("");
  };

  const handleSave = () => {
    if (!editingField) return;
    const value = editValue.trim();

    if (!value) {
      toast.error(`${editingField} cannot be empty.`);
      return;
    }

    if (editingField === "Email" && !isValidEmailAddress(value)) {
      toast.error("Please enter a valid email address.");
      return;
    }

    setShowPasswordConfirm(true);
    setConfirmPassword("");
    setPasswordError("");
  };

  const handleCancel = () => {
    setEditingField(null);
    setEditValue("");
    setShowPasswordConfirm(false);
    setConfirmPassword("");
    setPasswordError("");
  };

  const handleOpenChangePassword = () => {
    setShowChangePasswordModal(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setChangePasswordError("");
  };

  const handleConfirmSave = () => {
    const run = async () => {
      if (!editingField || !user?.id) return;
      if (!isSupabaseConfigured()) {
        toast.error("Supabase is not configured.");
        return;
      }
      if (!confirmPassword) {
        setPasswordError("Please enter your current password.");
        return;
      }

      setIsSaving(true);
      try {
        const supabase = getSupabase();
        const nextValue = editValue.trim();

        const { data: account, error: accountError } = await supabase
          .from("user_accounts")
          .select("password_hash")
          .eq("profile_id", user.id)
          .eq("is_active", true)
          .single();

        if (accountError || !account?.password_hash) {
          setPasswordError("Unable to verify your password.");
          return;
        }

        const validPassword = await bcrypt.compare(confirmPassword, account.password_hash);
        if (!validPassword) {
          setPasswordError("Incorrect password.");
          return;
        }

        const payload: Record<string, string | null> = {};
        if (editingField === "Name") payload.full_name = nextValue;
        if (editingField === "Email") payload.email = nextValue.toLowerCase();
        if (editingField === "Username") payload.username = nextValue;

        const { error: updateError } = await supabase.from("profiles").update(payload).eq("id", user.id);

        if (updateError) {
          if (updateError.code === "23505") {
            toast.error(`${editingField} is already in use.`);
            return;
          }
          throw updateError;
        }

        if (editingField === "Name") updateUserLocal({ name: nextValue });
        if (editingField === "Email") updateUserLocal({ email: nextValue.toLowerCase() });
        if (editingField === "Username") updateUserLocal({ username: nextValue });

        await logDbActivity({
          snapshot_date: formatDateForDB(new Date()),
          actor_profile_id: user.id,
          actor_username: user.username,
          actor_role: user.role.toLowerCase(),
          txn_type: "profile_edit",
          note: `Updated profile field: ${editingField}`,
          product_id: null,
          product_name: null,
        });

        toast.success(`${editingField} updated successfully.`);
        handleCancel();
      } catch (err) {
        console.error("Failed to update profile field:", err);
        toast.error(`Failed to update ${editingField}.`);
      } finally {
        setIsSaving(false);
      }
    };

    void run();
  };

  const handleConfirmChangePassword = () => {
    const run = async () => {
      if (!user?.id) return;
      if (!isSupabaseConfigured()) {
        toast.error("Supabase is not configured.");
        return;
      }
      if (!currentPassword || !newPassword || !confirmNewPassword) {
        setChangePasswordError("Please fill in all password fields.");
        return;
      }
      if (currentPassword.toLowerCase() === newPassword.toLowerCase()) {
        setChangePasswordError("New password must be different from current password (including letter case changes only).");
        return;
      }
      if (newPassword.length < 6) {
        setChangePasswordError("New password must be at least 6 characters.");
        return;
      }
      if (newPassword !== confirmNewPassword) {
        setChangePasswordError("New password and confirm password do not match.");
        return;
      }

      setIsChangingPassword(true);
      try {
        const supabase = getSupabase();
        const { data: account, error: accountError } = await supabase
          .from("user_accounts")
          .select("password_hash")
          .eq("profile_id", user.id)
          .eq("is_active", true)
          .single();

        if (accountError || !account?.password_hash) {
          setChangePasswordError("Unable to verify your current password.");
          return;
        }

        const validPassword = await bcrypt.compare(currentPassword, account.password_hash);
        if (!validPassword) {
          setChangePasswordError("Current password is incorrect.");
          return;
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        const { error: updateError } = await supabase
          .from("user_accounts")
          .update({ password_hash: newHash })
          .eq("profile_id", user.id)
          .eq("is_active", true);

        if (updateError) throw updateError;

        await logDbActivity({
          snapshot_date: formatDateForDB(new Date()),
          actor_profile_id: user.id,
          actor_username: user.username,
          actor_role: user.role.toLowerCase(),
          txn_type: "profile_edit",
          note: "Changed account password",
          product_id: null,
          product_name: null,
        });

        toast.success("Password changed successfully.");
        setShowChangePasswordModal(false);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
        setChangePasswordError("");
      } catch (err) {
        console.error("Failed to change password:", err);
        toast.error("Failed to change password.");
      } finally {
        setIsChangingPassword(false);
      }
    };

    void run();
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-8">Profile</h2>

      <div className="bg-white border border-gray-200 rounded-[16px] divide-y divide-gray-200 shadow-sm">
        <div className="p-6">
          <p className="text-sm font-medium text-gray-600 mb-2">Your Role</p>
          <p className="text-sm text-gray-400 uppercase tracking-wide">{user.role}</p>
        </div>

        <ProfileField
          label="Name"
          value={user.name}
          isEditing={editingField === "Name"}
          editValue={editValue}
          onEdit={() => handleEdit("Name", user.name)}
          onSave={handleSave}
          onCancel={handleCancel}
          onValueChange={setEditValue}
        />

        <ProfileField
          label="Email"
          value={user.email}
          isEditing={editingField === "Email"}
          editValue={editValue}
          onEdit={() => handleEdit("Email", user.email)}
          onSave={handleSave}
          onCancel={handleCancel}
          onValueChange={setEditValue}
        />

        <ProfileField
          label="Username"
          value={user.username}
          isEditing={editingField === "Username"}
          editValue={editValue}
          onEdit={() => handleEdit("Username", user.username)}
          onSave={handleSave}
          onCancel={handleCancel}
          onValueChange={setEditValue}
        />

        <div className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-2">Password</p>
              <p className="text-sm text-gray-500">**************</p>
            </div>
            <div className="ml-6">
              <button
                onClick={handleOpenChangePassword}
                className="px-5 py-2 text-sm font-medium border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors duration-200"
              >
                Change Password
              </button>
            </div>
          </div>
        </div>
      </div>

      {showPasswordConfirm && editingField && (
        <div className="fixed inset-0 bg-black/10 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Confirm Password</h3>
            <p className="text-sm text-gray-600 mb-4">
              Enter your current password to confirm updating your {editingField.toLowerCase()}.
            </p>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPasswordError("");
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
              placeholder="Current password"
            />
            {passwordError && <p className="text-red-600 text-xs mt-2">{passwordError}</p>}
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => {
                  setShowPasswordConfirm(false);
                  setConfirmPassword("");
                  setPasswordError("");
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSave}
                className="flex-1 px-4 py-2 bg-[#8B2E2E] text-white rounded-lg text-sm hover:bg-[#B23A3A] disabled:opacity-50"
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showChangePasswordModal && (
        <div className="fixed inset-0 bg-black/10 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl border border-gray-200">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Change Password</h3>
            <p className="text-sm text-gray-600 mb-4">
              Enter your current password and your new password.
            </p>

            <div className="space-y-3">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setChangePasswordError("");
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
                placeholder="Current password"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setChangePasswordError("");
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
                placeholder="New password"
              />
              <input
                type="password"
                value={confirmNewPassword}
                onChange={(e) => {
                  setConfirmNewPassword(e.target.value);
                  setChangePasswordError("");
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
                placeholder="Confirm new password"
              />
            </div>

            {changePasswordError && <p className="text-red-600 text-xs mt-2">{changePasswordError}</p>}

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => {
                  setShowChangePasswordModal(false);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmNewPassword("");
                  setChangePasswordError("");
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                disabled={isChangingPassword}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmChangePassword}
                className="flex-1 px-4 py-2 bg-[#8B2E2E] text-white rounded-lg text-sm hover:bg-[#B23A3A] disabled:opacity-50"
                disabled={isChangingPassword}
              >
                {isChangingPassword ? "Saving..." : "Change Password"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ProfileFieldProps {
  label: string;
  value: string;
  isEditing: boolean;
  editValue: string;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onValueChange: (value: string) => void;
}

function ProfileField({
  label,
  value,
  isEditing,
  editValue,
  onEdit,
  onSave,
  onCancel,
  onValueChange,
}: ProfileFieldProps) {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>
          {isEditing ? (
            <input
              type={label === "Email" ? "email" : "text"}
              value={editValue}
              onChange={(e) => onValueChange(e.target.value)}
              className="w-full max-w-md px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20 focus:border-[#8B2E2E] transition-all duration-200"
              autoFocus
            />
          ) : (
            <p className="text-sm text-gray-500">{value}</p>
          )}
        </div>
        <div className="ml-6">
          {isEditing ? (
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="px-5 py-2 text-sm font-medium border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors duration-200"
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                className="px-5 py-2 text-sm font-medium bg-[#B23A3A] text-white rounded-xl hover:bg-[#8B2E2E] transition-colors duration-200"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              onClick={onEdit}
              className="px-5 py-2 text-sm font-medium border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors duration-200"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
