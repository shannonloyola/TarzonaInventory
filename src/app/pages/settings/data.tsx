import { useRef, useState } from "react";
import { useInventory } from "../../context/inventory-context";
import { useAuth } from "../../context/auth-context";
import { toast } from "sonner";
import { getSupabase, isSupabaseConfigured } from "../../../lib/supabase";
import bcrypt from "bcryptjs";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { format, isValid, parse } from "date-fns";
import { AdminPasswordConfirmModal } from "../../components/admin-password-confirm-modal";

export function DataManagementPage() {
  const {
    products,
    selectedDate,
    updateProduct,
    deleteProduct,
    archiveAllProducts,
    deleteAllProducts,
    exportData,
  } = useInventory();
  const { user, isAdmin, hasPermission } = useAuth();
  const [showArchivedModal, setShowArchivedModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [showArchiveAllModal, setShowArchiveAllModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPasswordConfirmOpen, setIsPasswordConfirmOpen] = useState(false);
  const [passwordConfirmActionLabel, setPasswordConfirmActionLabel] = useState("");
  const [passwordConfirmValue, setPasswordConfirmValue] = useState("");
  const [passwordConfirmError, setPasswordConfirmError] = useState("");
  const [isPasswordConfirming, setIsPasswordConfirming] = useState(false);
  const passwordConfirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const [exportDateMode, setExportDateMode] = useState<"single" | "range">("single");
  const [singleExportDate, setSingleExportDate] = useState<string>(() => {
    const parsed = parse(selectedDate, "M-d-yy", new Date());
    return isValid(parsed) ? format(parsed, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  });
  const [rangeStartDate, setRangeStartDate] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [rangeEndDate, setRangeEndDate] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [exportProductMode, setExportProductMode] = useState<"all_active_products" | "movement_only">("all_active_products");

  const canExportData = isAdmin || hasPermission("exportData");
  const canManageArchived = isAdmin || hasPermission("archiveProduct");

  const archivedProducts = products.filter((product) => product.archived);

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

  const closePasswordPrompt = (result: boolean) => {
    const resolver = passwordConfirmResolverRef.current;
    passwordConfirmResolverRef.current = null;
    setIsPasswordConfirmOpen(false);
    setPasswordConfirmActionLabel("");
    setPasswordConfirmValue("");
    setPasswordConfirmError("");
    if (resolver) resolver(result);
  };

  const requestAdminPasswordVerification = async (actionLabel: string): Promise<boolean> => {
    setPasswordConfirmActionLabel(actionLabel);
    setPasswordConfirmValue("");
    setPasswordConfirmError("");
    setIsPasswordConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      passwordConfirmResolverRef.current = resolve;
    });
  };

  const handlePasswordPromptCancel = () => {
    if (isPasswordConfirming) return;
    closePasswordPrompt(false);
  };

  const handlePasswordPromptConfirm = async () => {
    if (isPasswordConfirming) return;
    const entered = passwordConfirmValue.trim();
    if (!entered) {
      setPasswordConfirmError("Please enter your admin password.");
      return;
    }
    setIsPasswordConfirming(true);
    try {
      const valid = await verifyCurrentAdminPassword(entered);
      if (!valid) {
        setPasswordConfirmError("Incorrect admin password.");
        return;
      }
      closePasswordPrompt(true);
    } finally {
      setIsPasswordConfirming(false);
    }
  };

  const handleArchiveAll = () => {
    if (!isAdmin) {
      toast.error("Only Admin can archive all products.");
      return;
    }
    setShowArchiveAllModal(true);
    setAdminPassword("");
    setPasswordError("");
  };

  const handleConfirmArchiveAll = () => {
    const run = async () => {
      if (isProcessing) return;
      setIsProcessing(true);
      const valid = await verifyCurrentAdminPassword(adminPassword);
      if (!valid) {
        setPasswordError("Incorrect admin password");
        setIsProcessing(false);
        return;
      }
      const success = await archiveAllProducts();
      if (!success) {
        setIsProcessing(false);
        return;
      }
      setShowArchiveAllModal(false);
      setAdminPassword("");
      setPasswordError("");
      setIsProcessing(false);
    };
    void run();
  };

  const handleDeleteAll = () => {
    if (!isAdmin) {
      toast.error("Only Admin can delete all products.");
      return;
    }
    setShowDeleteAllModal(true);
    setAdminPassword("");
    setPasswordError("");
  };

  const handleConfirmDeleteAll = () => {
    const run = async () => {
      if (isProcessing) return;
      setIsProcessing(true);
      const valid = await verifyCurrentAdminPassword(adminPassword);
      if (!valid) {
        setPasswordError("Incorrect admin password");
        setIsProcessing(false);
        return;
      }
      const success = await deleteAllProducts();
      if (!success) {
        setIsProcessing(false);
        return;
      }
      setShowDeleteAllModal(false);
      setAdminPassword("");
      setIsProcessing(false);
    };
    void run();
  };

  const handleRestoreArchivedProduct = (productId: string, productName: string) => {
    const run = async () => {
      if (!canManageArchived) {
        toast.error("You do not have permission to manage archived products.");
        return;
      }
      if (isProcessing) return;
      const valid = await requestAdminPasswordVerification(`restore ${productName}`);
      if (!valid) return;
      setIsProcessing(true);
      try {
        const success = await updateProduct(productId, { archived: false });
        if (!success) return;
        toast.success(`Restored ${productName}`);
      } finally {
        setIsProcessing(false);
      }
    };
    void run();
  };

  const handleDeleteArchivedProduct = (productId: string, productName: string) => {
    const run = async () => {
      if (!canManageArchived) {
        toast.error("You do not have permission to manage archived products.");
        return;
      }
      if (isProcessing) return;
      const valid = await requestAdminPasswordVerification(`delete ${productName}`);
      if (!valid) return;
      setIsProcessing(true);
      try {
        const success = await deleteProduct(productId);
        if (!success) return;
        toast.success(`Deleted ${productName}`);
      } finally {
        setIsProcessing(false);
      }
    };
    void run();
  };

  const handleRestoreAllArchivedProducts = () => {
    const run = async () => {
      if (!canManageArchived) {
        toast.error("You do not have permission to manage archived products.");
        return;
      }
      if (archivedProducts.length === 0 || isProcessing) return;
      const valid = await requestAdminPasswordVerification("restore all archived products");
      if (!valid) return;
      setIsProcessing(true);
      try {
        const results = await Promise.all(
          archivedProducts.map((product) => updateProduct(product.id, { archived: false }))
        );
        const successCount = results.filter(Boolean).length;
        if (successCount === 0) return;
        toast.success(`Restored ${successCount} archived product(s)`);
      } finally {
        setIsProcessing(false);
      }
    };
    void run();
  };

  const handleExportByDate = () => {
    if (!canExportData) {
      toast.error("You do not have permission to export data.");
      return;
    }

    if (exportDateMode === "single") {
      if (!singleExportDate) {
        toast.error("Please select a date before exporting.");
        return;
      }
      exportData({
        targetDates: [singleExportDate],
        mode: exportProductMode,
      });
      return;
    }

    if (!rangeStartDate || !rangeEndDate) {
      toast.error("Please select a valid date range before exporting.");
      return;
    }
    exportData({
      rangeStart: rangeStartDate,
      rangeEnd: rangeEndDate,
      mode: exportProductMode,
    });
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-8">Data Controls</h2>

      {!canManageArchived && !canExportData ? (
        <div className="bg-white border border-gray-200 rounded-[16px] p-6 text-sm text-gray-600 shadow-sm">
          No data control permissions were granted to your account.
        </div>
      ) : null}

      {(canManageArchived || canExportData) && (
        <div className="bg-white border border-gray-200 rounded-[16px] divide-y divide-gray-200 shadow-sm">
        {/* Archived Products */}
        {canManageArchived && (
          <div className="p-6 flex items-center justify-between">
            <div>
              <h3 className="font-medium text-gray-900 text-sm">
                Archived Products
              </h3>
            </div>
            <button
              onClick={() => setShowArchivedModal(true)}
              className="px-5 py-2 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors duration-200"
            >
              Manage
            </button>
          </div>
        )}

        {/* Archive All Products */}
        {isAdmin && (
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
        )}

        {/* Delete All Products */}
        {isAdmin && (
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
        )}

        {/* Export Data */}
        {canExportData && (
          <div className="p-6">
            <div>
              <h3 className="font-medium text-gray-900 text-sm">Export Data</h3>
              <p className="text-xs text-gray-500 mt-1">
                Export by single date or date range. The workbook keeps one sheet per date.
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-5 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={exportDateMode === "single"}
                  onChange={() => setExportDateMode("single")}
                />
                Single Date
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={exportDateMode === "range"}
                  onChange={() => setExportDateMode("range")}
                />
                Date Range
              </label>
            </div>

            {exportDateMode === "single" ? (
              <div className="mt-3">
                <input
                  type="date"
                  value={singleExportDate}
                  onChange={(e) => setSingleExportDate(e.target.value)}
                  className="h-10 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
                />
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={rangeStartDate}
                  onChange={(e) => setRangeStartDate(e.target.value)}
                  className="h-10 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
                />
                <span className="text-xs text-gray-500">to</span>
                <input
                  type="date"
                  value={rangeEndDate}
                  onChange={(e) => setRangeEndDate(e.target.value)}
                  className="h-10 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
                />
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-xs text-gray-500">Rows:</label>
              <select
                value={exportProductMode}
                onChange={(e) =>
                  setExportProductMode(e.target.value as "all_active_products" | "movement_only")
                }
                className="h-10 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20 bg-white"
              >
                <option value="all_active_products">All Products (Active)</option>
                <option value="movement_only">Movement Only</option>
              </select>
              <button
                onClick={handleExportByDate}
                className="px-5 py-2 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors duration-200"
              >
                Export
              </button>
            </div>
          </div>
        )}
        </div>
      )}

      {/* Archived Products Modal */}
      <AnimatePresence>
        {showArchivedModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 bg-transparent flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto shadow-2xl border border-gray-200 will-change-transform"
            >
            <div className="flex items-start justify-between gap-4 mb-2">
              <h3 className="text-lg font-bold text-gray-900">Manage Archived Products</h3>
              <button
                onClick={() => setShowArchivedModal(false)}
                className="text-gray-400 hover:text-gray-700 transition-colors"
                aria-label="Close archived products modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Restore products to make them visible again in inventory, or permanently delete them.
            </p>

            {archivedProducts.length === 0 ? (
              <p className="text-sm text-gray-500">No archived products found.</p>
            ) : (
              <div className="space-y-3">
                {archivedProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{product.name}</p>
                      <p className="text-xs text-gray-500">
                        {product.brand || "No brand"} - {product.size} - {product.category}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRestoreArchivedProduct(product.id, product.name)}
                        disabled={isProcessing}
                        className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-xs font-medium hover:bg-gray-50"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => handleDeleteArchivedProduct(product.id, product.name)}
                        disabled={isProcessing}
                        className="px-3 py-1.5 border border-red-300 text-red-600 rounded text-xs font-medium hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center mt-6">
              <button
                onClick={handleRestoreAllArchivedProducts}
                disabled={archivedProducts.length === 0 || isProcessing}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Restore All
              </button>
              <button
                onClick={() => setShowArchivedModal(false)}
                className="px-4 py-2 bg-gray-800 text-white rounded text-sm hover:bg-gray-900"
              >
                Close
              </button>
            </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Archive All Confirmation Modal */}
      <AnimatePresence>
        {showArchiveAllModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 bg-transparent flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl border border-gray-200 will-change-transform"
            >
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              Archive All Products
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              This will archive all products and hide them from the main inventory view.
            </p>
            <p className="text-sm text-gray-700 mb-4">
              To revert this, go to <strong>Data Controls -&gt; Archived Products -&gt; Manage</strong> and click
              <strong> Restore</strong> on the items you want to bring back.
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
                  setShowArchiveAllModal(false);
                  setAdminPassword("");
                  setPasswordError("");
                }}
                disabled={isProcessing}
                className="flex-1 px-4 py-2 bg-gray-800 text-white rounded text-sm hover:bg-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmArchiveAll}
                disabled={isProcessing}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50"
              >
                {isProcessing ? "Archiving..." : "Archive All"}
              </button>
            </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete All Confirmation Modal */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 bg-transparent flex items-center justify-center z-50">
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
                disabled={isProcessing}
                className="flex-1 px-4 py-2 bg-gray-800 text-white rounded text-sm hover:bg-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteAll}
                disabled={isProcessing}
                className="flex-1 px-4 py-2 bg-red-700 text-white rounded text-sm hover:bg-red-800"
              >
                {isProcessing ? "Deleting..." : "Delete All"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AdminPasswordConfirmModal
        open={isPasswordConfirmOpen}
        actionLabel={passwordConfirmActionLabel}
        password={passwordConfirmValue}
        errorMessage={passwordConfirmError}
        isSubmitting={isPasswordConfirming}
        onPasswordChange={(value) => {
          setPasswordConfirmValue(value);
          setPasswordConfirmError("");
        }}
        onCancel={handlePasswordPromptCancel}
        onConfirm={handlePasswordPromptConfirm}
      />
    </div>
  );
}
