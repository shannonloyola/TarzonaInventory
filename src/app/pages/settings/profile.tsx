import { useState } from "react";
import { useAuth } from "../../context/auth-context";
import { toast } from "sonner";

export function ProfilePage() {
  const { user } = useAuth();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  if (!user) return null;

  const handleEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  };

  const handleSave = () => {
    toast.success(`${editingField} updated successfully`);
    setEditingField(null);
  };

  const handleCancel = () => {
    setEditingField(null);
    setEditValue("");
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-8">Profile</h2>
      
      <div className="bg-white border border-gray-200 rounded-[16px] divide-y divide-gray-200 shadow-sm">
        {/* Role (non-editable) */}
        <div className="p-6">
          <p className="text-sm font-medium text-gray-600 mb-2">Your Role</p>
          <p className="text-sm text-gray-400 uppercase tracking-wide">{user.role}</p>
        </div>

        {/* Name */}
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

        {/* Email */}
        <ProfileField
          label="Email Address"
          value={user.email}
          isEditing={editingField === "Email"}
          editValue={editValue}
          onEdit={() => handleEdit("Email", user.email)}
          onSave={handleSave}
          onCancel={handleCancel}
          onValueChange={setEditValue}
        />

        {/* Username */}
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

        {/* Password */}
        <ProfileField
          label="Password"
          value="**************"
          isEditing={editingField === "Password"}
          editValue={editValue}
          onEdit={() => handleEdit("Password", "")}
          onSave={handleSave}
          onCancel={handleCancel}
          onValueChange={setEditValue}
          isPassword
        />
      </div>
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
  isPassword?: boolean;
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
  isPassword,
}: ProfileFieldProps) {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-2">{label}</p>
          {isEditing ? (
            <input
              type={isPassword ? "password" : "text"}
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