import { useState } from "react";
import { useInventory } from "../../context/inventory-context";
import { useAuth } from "../../context/auth-context";
import { toast } from "sonner";
import { getSupabase, isSupabaseConfigured } from "../../../lib/supabase";
import bcrypt from "bcryptjs";

export function DataManagementPage() {
  const { archiveAllProducts, exportData } = useInventory();
  const { user } = useAuth();
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [showArchiveAllModal, setShowArchiveAllModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const verifyCurrentAdminPassword = async (
    plainPassword: string
  ): Promise<boolean> => {
    if (!user?.id || !isSupabaseConfigured()) return false;
    const supabase = getSupabase();

    const { data: account, error } = await supabase
      .from("user_accounts")
      .select("password_hash")
      .eq("profile_id", user.id)
      .eq("is_active", true)
      .single();

    if (error || !account?.password_hash) return false;
    return bcrypt.compare(plainPassword, account.password_hash);
  };

  const handleArchiveAll = () => {
    setShowArchiveAllModal(true);
    setPasswordError("");
  };

  const handleConfirmArchiveAll = () => {
    const run = async () => {
      const valid = await verifyCurrentAdminPassword(adminPassword);
      if (!valid) {
        setPasswordError("Incorrect admin password");
        return;
      }
      archiveAllProducts();
      setShowArchiveAllModal(false);
      setAdminPassword("");
    };
    void run();
  };

  const handleDeleteAll = () => {
    setShowDeleteAllModal(true);
    setPasswordError("");
  };

  const handleConfirmDeleteAll = () => {
    const run = async () => {
      const valid = await verifyCurrentAdminPassword(adminPassword);
      if (!valid) {
        setPasswordError("Incorrect admin password");
        return;
      }
      toast.success("All products deleted");
      setShowDeleteAllModal(false);
      setAdminPassword("");
    };
    void run();
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-8">Data Controls</h2>

      <div className="bg-white border border-gray-200 rounded-[16px] divide-y divide-gray-200 shadow-sm">
        {/* Archived Products */}
        <div className="p-6 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-900 text-sm">
              Archived Products
            </h3>
          </div>
          <button className="px-5 py-2 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors duration-200">
            Manage
          </button>
        </div>

        {/* Archive All Products */}
        <div className="p-6 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-900 text-sm">
              Archive All Products
            </h3>
          </div>
          <button
            onClick={handleArchiveAll}
            className="px-5 py-2 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors duration-200"
          >
            Archive All
          </button>
        </div>

        {/* Delete All Products */}
        <div className="p-6 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-900 text-sm">
              Delete All Products
            </h3>
          </div>
          <button
            onClick={handleDeleteAll}
            className="px-5 py-2 border border-red-300 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 transition-colors duration-200"
          >
            Delete All
          </button>
        </div>

        {/* Export Data */}
        <div className="p-6 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-900 text-sm">Export Data</h3>
          </div>
          <button
            onClick={exportData}
            className="px-5 py-2 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors duration-200"
          >
            Export
          </button>
        </div>
      </div>

      {/* Archive All Confirmation Modal */}
      {showArchiveAllModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Archive All Products
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to archive all products? They can be
              restored later.
            </p>

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
              {passwordError && (
                <p className="text-red-600 text-xs mt-2">{passwordError}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowArchiveAllModal(false);
                  setAdminPassword("");
                  setPasswordError("");
                }}
                className="flex-1 px-4 py-2 bg-gray-800 text-white rounded text-sm hover:bg-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmArchiveAll}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
              >
                Archive All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Confirmation Modal */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-red-700 mb-2">
              Delete All Products
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              This action is <strong>permanent</strong> and cannot be undone.
              All products will be permanently deleted.
            </p>

            <div className="mb-4">
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => {
                  setAdminPassword(e.target.value);
                  setPasswordError("");
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                placeholder="Please type in your admin password"
              />
              {passwordError && (
                <p className="text-red-600 text-xs mt-2">{passwordError}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteAllModal(false);
                  setAdminPassword("");
                  setPasswordError("");
                }}
                className="flex-1 px-4 py-2 bg-gray-800 text-white rounded text-sm hover:bg-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteAll}
                className="flex-1 px-4 py-2 bg-red-700 text-white rounded text-sm hover:bg-red-800"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
