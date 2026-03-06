import { useState } from "react";
import { useInventory } from "../../context/inventory-context";
import { useAuth } from "../../context/auth-context";
import { toast } from "sonner";
import { getSupabase, isSupabaseConfigured } from "../../../lib/supabase";
import bcrypt from "bcryptjs";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { format, isValid, parse } from "date-fns";

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
  const { user } = useAuth();
  const [showArchivedModal, setShowArchivedModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [showArchiveAllModal, setShowArchiveAllModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [exportDateInput, setExportDateInput] = useState<string>(() => {
    const parsed = parse(selectedDate, "M-d-yy", new Date());
    return isValid(parsed) ? format(parsed, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  });
  const [selectedExportDates, setSelectedExportDates] = useState<string[]>([]);

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

  const handleArchiveAll = () => {
    setShowArchiveAllModal(true);
    setAdminPassword("");
    setPasswordError("");
  };

  const handleConfirmArchiveAll = () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      archiveAllProducts();
      setShowArchiveAllModal(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteAll = () => {
    setShowDeleteAllModal(true);
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
    updateProduct(productId, { archived: false });
    toast.success(`Restored ${productName}`);
  };

  const handleDeleteArchivedProduct = (productId: string, productName: string) => {
    deleteProduct(productId);
    toast.success(`Deleted ${productName}`);
  };

  const handleRestoreAllArchivedProducts = () => {
    if (archivedProducts.length === 0) return;
    archivedProducts.forEach((product) => {
      updateProduct(product.id, { archived: false });
    });
    toast.success(`Restored ${archivedProducts.length} archived product(s)`);
  };

  const handleAddExportDate = () => {
    if (!exportDateInput) return;
    setSelectedExportDates((prev) => {
      if (prev.includes(exportDateInput)) return prev;
      return [...prev, exportDateInput];
    });
  };

  const handleRemoveExportDate = (dateValue: string) => {
    setSelectedExportDates((prev) => prev.filter((date) => date !== dateValue));
  };

  const handleExportByDate = () => {
    if (selectedExportDates.length === 0) {
      toast.error("Please add at least one date before exporting.");
      return;
    }
    exportData(selectedExportDates);
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
          <button
            onClick={() => setShowArchivedModal(true)}
            className="px-5 py-2 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors duration-200"
          >
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
        <div className="p-6">
          <div>
            <h3 className="font-medium text-gray-900 text-sm">Export Data</h3>
            <p className="text-xs text-gray-500 mt-1">
              Select one or more dates. Each selected date will be exported as a separate sheet.
            </p>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input
              type="date"
              value={exportDateInput}
              onChange={(e) => setExportDateInput(e.target.value)}
              className="h-10 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
            />
            <button
              onClick={handleAddExportDate}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors duration-200"
            >
              Add Date
            </button>
            <button
              onClick={handleExportByDate}
              className="px-5 py-2 border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors duration-200"
            >
              Export ({selectedExportDates.length})
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedExportDates.length === 0 ? (
              <p className="text-xs text-gray-500">No dates selected.</p>
            ) : (
              selectedExportDates.map((dateValue) => (
                <span
                  key={dateValue}
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-xs text-gray-700"
                >
                  {dateValue}
                  <button
                    onClick={() => handleRemoveExportDate(dateValue)}
                    className="text-gray-500 hover:text-gray-700"
                    aria-label={`Remove ${dateValue}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </div>

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
                        className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-xs font-medium hover:bg-gray-50"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => handleDeleteArchivedProduct(product.id, product.name)}
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
                disabled={archivedProducts.length === 0}
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
    </div>
  );
}
