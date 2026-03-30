import { useState, useEffect, useRef } from "react";
import { Search, Plus, Download, Archive, ChevronDown, ImageIcon, Minus, Pencil, X, Filter } from "lucide-react";
import { useInventory } from "../context/inventory-context";
import { useAuth } from "../context/auth-context";
import { Product, DailyInventory, NewProductInput } from "../types";
import { LowStockAlert } from "../components/low-stock-alert";
import { motion, AnimatePresence } from "motion/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { CurrentDateTime } from "../components/current-datetime";
import { format, isValid, parse, subDays } from "date-fns";
import { getSupabase, isSupabaseConfigured } from "../../lib/supabase";
import { toast } from "sonner";
import bcrypt from "bcryptjs";
import { AdminPasswordConfirmModal } from "../components/admin-password-confirm-modal";

const Edit = Pencil;

type DrawerState = null | "item-view" | "edit-mode";
type SelectionMode = "none" | "delete" | "archive";

function parseUiDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = parse(trimmed, "yyyy-MM-dd", new Date());
    return isValid(parsed) ? parsed : null;
  }

  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(trimmed)) {
    const parsed = parse(trimmed, "M-d-yyyy", new Date());
    return isValid(parsed) ? parsed : null;
  }

  if (/^\d{1,2}-\d{1,2}-\d{2}$/.test(trimmed)) {
    const parsed = parse(trimmed, "M-d-yy", new Date());
    return isValid(parsed) ? parsed : null;
  }

  return null;
}

function normalizeOptionValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isOtherOption(value: string): boolean {
  const key = normalizeOptionValue(value);
  return key === "other" || key === "others";
}

function buildUniqueOptions(values: string[], keepOtherLast = false): string[] {
  const unique = new Map<string, string>();
  values.forEach((value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = normalizeOptionValue(trimmed);
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  });
  return Array.from(unique.values()).sort((a, b) => {
    if (keepOtherLast) {
      const aIsOther = isOtherOption(a);
      const bIsOther = isOtherOption(b);
      if (aIsOther && !bIsOther) return 1;
      if (!aIsOther && bIsOther) return -1;
    }
    return a.localeCompare(b);
  });
}

function formatOptionDisplay(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  // If source value is all uppercase letters (plus spaces/punctuation), show title case.
  const looksAllCaps = /[A-Z]/.test(trimmed) && trimmed === trimmed.toUpperCase();
  if (!looksAllCaps) return trimmed;

  return trimmed
    .split(" ")
    .map((part) =>
      part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    )
    .join(" ");
}

const NON_DEFAULT_CATEGORY_STYLES = [
  "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "bg-violet-50 text-violet-700 border border-violet-200",
  "bg-cyan-50 text-cyan-700 border border-cyan-200",
  "bg-orange-50 text-orange-700 border border-orange-200",
  "bg-lime-50 text-lime-700 border border-lime-200",
  "bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200",
] as const;

function hashCategoryKey(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getCategoryBadgeClass(category: string): string {
  const key = normalizeOptionValue(category);
  if (key === "beer") return "bg-amber-50 text-amber-700 border border-amber-200";
  if (key === "wine") return "bg-rose-50 text-rose-700 border border-rose-200";
  if (
    key === "spirits" ||
    key === "rum" ||
    key === "whiskey" ||
    key === "whisky" ||
    key === "vodka" ||
    key === "gin" ||
    key === "tequila" ||
    key === "brandy"
  ) {
    return "bg-sky-50 text-sky-700 border border-sky-200";
  }
  if (key === "others") return "bg-slate-100 text-slate-700 border border-slate-300";
  return NON_DEFAULT_CATEGORY_STYLES[
    hashCategoryKey(key) % NON_DEFAULT_CATEGORY_STYLES.length
  ];
}

const SIZE_UNIT_OPTIONS = ["CL", "L", "mL", "Other"] as const;
type SizeUnitOption = (typeof SIZE_UNIT_OPTIONS)[number];

function parseSizeInput(rawSize: string): { value: string; unit: SizeUnitOption; other: string } {
  const compact = rawSize.trim().replace(/\s+/g, "");
  const normalized = compact.toLowerCase();
  const matched = normalized.match(
    /^(\d+(?:\.\d+)?)(ml|milliliter|milliliters|millilitre|millilitres|cl|centiliter|centiliters|centilitre|centilitres|l|lt|ltr|liter|liters|litre|litres)$/
  );
  if (!matched) {
    return { value: "", unit: "Other", other: rawSize.trim() };
  }

  const unitRaw = matched[2];
  let unit: SizeUnitOption = "L";
  if (
    unitRaw === "ml" ||
    unitRaw === "milliliter" ||
    unitRaw === "milliliters" ||
    unitRaw === "millilitre" ||
    unitRaw === "millilitres"
  ) {
    unit = "mL";
  } else if (
    unitRaw === "cl" ||
    unitRaw === "centiliter" ||
    unitRaw === "centiliters" ||
    unitRaw === "centilitre" ||
    unitRaw === "centilitres"
  ) {
    unit = "CL";
  }

  return { value: matched[1], unit, other: "" };
}

function composeSizeInput(value: string, unit: SizeUnitOption, other: string): string {
  if (unit === "Other") return other.trim();
  const normalizedNumber = value.trim();
  if (!normalizedNumber) return "";
  return `${normalizedNumber}${unit}`;
}

export function InventoryPage() {
  const { products, getInventoryForDate, selectedDate, updateDailyInventory, updateProduct, addProduct, deleteProduct, archiveProduct } = useInventory();
  const { hasPermission, user } = useAuth();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Category:");
  const [brandFilter, setBrandFilter] = useState("Brand:");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [showMovementOnly, setShowMovementOnly] = useState(false);
  const [drawerState, setDrawerState] = useState<DrawerState>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedInventory, setSelectedInventory] = useState<DailyInventory | null>(null);
  
  // Edit mode state
  const [editedProduct, setEditedProduct] = useState<Product | null>(null);
  const [editedInventory, setEditedInventory] = useState<DailyInventory | null>(null);

  // Add Product Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Delete mode state
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("none");
  const [selectedForAction, setSelectedForAction] = useState<Set<string>>(new Set());
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);
  const [isSavingDrawer, setIsSavingDrawer] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [isArchivingSelected, setIsArchivingSelected] = useState(false);
  const [isPasswordConfirmOpen, setIsPasswordConfirmOpen] = useState(false);
  const [passwordConfirmActionLabel, setPasswordConfirmActionLabel] = useState("");
  const [passwordConfirmValue, setPasswordConfirmValue] = useState("");
  const [passwordConfirmError, setPasswordConfirmError] = useState("");
  const [isPasswordConfirming, setIsPasswordConfirming] = useState(false);
  const passwordConfirmResolverRef = useRef<((value: boolean) => void) | null>(null);

  const activeProducts = products.filter((p) => !p.archived);
  const inventory = getInventoryForDate(selectedDate);

  const getPreviousDayEndStock = (productId: string): number => {
    const parsedSelectedDate = parseUiDate(selectedDate);
    if (!parsedSelectedDate) return 0;

    const previousDate = subDays(parsedSelectedDate, 1);
    const previousDateStr = format(previousDate, "M-d-yyyy");
    const previousInventory = getInventoryForDate(previousDateStr);
    const previousProductInventory = previousInventory.find((item) => item.productId === productId);

    return previousProductInventory?.end || 0;
  };

  // Get unique categories and brands
  const categories = buildUniqueOptions(activeProducts.map((p) => p.category), true);
  const brands = buildUniqueOptions(
    (activeProducts.map((p) => p.brand).filter(Boolean) as string[]).map(formatOptionDisplay)
  );

  // Filter products
  const filteredProducts = activeProducts.filter((product) => {
    const matchesSearch =
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.size.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      categoryFilter === "Category:" ||
      normalizeOptionValue(product.category) === normalizeOptionValue(categoryFilter);
    const matchesBrand =
      brandFilter === "Brand:" ||
      normalizeOptionValue(product.brand || "") === normalizeOptionValue(brandFilter);

    return matchesSearch && matchesCategory && matchesBrand;
  });

  const movedProductIds = new Set(
    inventory
      .filter((item) => item.in > 0 || item.out > 0)
      .map((item) => item.productId)
  );

  const displayedProducts = showMovementOnly
    ? filteredProducts.filter((product) => movedProductIds.has(product.id))
    : filteredProducts;

  const handleRowClick = (product: Product) => {
    const inv = inventory.find((i) => i.productId === product.id);
    setSelectedProduct(product);
    setSelectedInventory(inv || null);
    setDrawerState("item-view");
  };

  const handleEdit = () => {
    if (!selectedProduct) return;

    const previousDayEnd = getPreviousDayEndStock(selectedProduct.id);
    const baseInventory: DailyInventory =
      selectedInventory || {
        productId: selectedProduct.id,
        beg: previousDayEnd,
        in: 0,
        total: previousDayEnd,
        out: 0,
        end: previousDayEnd,
      };

    const normalizedInventory: DailyInventory = {
      ...baseInventory,
      beg: previousDayEnd,
      total: previousDayEnd + baseInventory.in,
      end: previousDayEnd + baseInventory.in - baseInventory.out,
    };

    setEditedProduct(selectedProduct);
    setEditedInventory(normalizedInventory);
    setDrawerState("edit-mode");
  };

  const handleSave = async () => {
    if (!selectedProduct || isSavingDrawer) return;
    setIsSavingDrawer(true);
    try {
      let productOk = true;
      let inventoryOk = true;

      if (editedProduct) {
        productOk = await updateProduct(selectedProduct.id, editedProduct);
      }
      if (editedInventory) {
        inventoryOk = await updateDailyInventory(selectedDate, selectedProduct.id, editedInventory);
      }

      if (!productOk || !inventoryOk) return;

      setDrawerState("item-view");
      setSelectedProduct(editedProduct);
      setSelectedInventory(editedInventory);
    } finally {
      setIsSavingDrawer(false);
    }
  };

  const handleCloseDrawer = () => {
    setDrawerState(null);
    setSelectedProduct(null);
    setSelectedInventory(null);
  }

  const handleToggleDeleteMode = () => {
    setSelectionMode((prev) => (prev === "delete" ? "none" : "delete"));
    setSelectedForAction(new Set());
  };

  const handleToggleArchiveMode = () => {
    setSelectionMode((prev) => (prev === "archive" ? "none" : "archive"));
    setSelectedForAction(new Set());
  };

  const handleToggleSelect = (productId: string) => {
    const newSet = new Set(selectedForAction);
    if (newSet.has(productId)) {
      newSet.delete(productId);
    } else {
      newSet.add(productId);
    }
    setSelectedForAction(newSet);
  };

  const handleDeleteSelected = () => {
    if (selectedForAction.size === 0) return;
    setIsDeleteConfirmOpen(true);
  };

  const verifyCurrentAdminPassword = async (plainPassword: string): Promise<boolean> => {
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
    if (user?.role !== "Admin") return true;
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

  const handleConfirmDeleteSelected = async () => {
    if (isDeletingSelected) return;
    const idsToDelete = Array.from(selectedForAction);
    if (idsToDelete.length === 0) return;
    const valid = await requestAdminPasswordVerification("delete selected products");
    if (!valid) return;
    setIsDeletingSelected(true);

    try {
      const results = await Promise.all(idsToDelete.map((id) => deleteProduct(id)));
      const successCount = results.filter(Boolean).length;
      if (successCount === 0) return;
      toast.success(`Deleted ${successCount} product${successCount > 1 ? "s" : ""}`);

      setIsDeleteConfirmOpen(false);
      setSelectedForAction(new Set());
      setSelectionMode("none");
    } finally {
      setIsDeletingSelected(false);
    }
  };

  const handleArchiveSelected = () => {
    if (selectedForAction.size === 0) return;
    setIsArchiveConfirmOpen(true);
  };

  const handleConfirmArchiveSelected = async () => {
    if (isArchivingSelected) return;
    const idsToArchive = Array.from(selectedForAction);
    if (idsToArchive.length === 0) return;
    const valid = await requestAdminPasswordVerification("archive selected products");
    if (!valid) return;
    setIsArchivingSelected(true);

    try {
      const results = await Promise.all(idsToArchive.map((id) => archiveProduct(id)));
      const successCount = results.filter(Boolean).length;
      if (successCount === 0) return;

      toast.success(`${successCount} product${successCount > 1 ? "s" : ""} archived`);
      setIsArchiveConfirmOpen(false);
      setSelectedForAction(new Set());
      setSelectionMode("none");
    } finally {
      setIsArchivingSelected(false);
    }
  };

  const totalItems = inventory.reduce((sum, item) => sum + item.end, 0);

  // Calculate low stock items (end <= 20% of beginning)
  const lowStockItems = inventory
    .filter(item => {
      if (item.beg === 0) return false; // Skip if no beginning stock
      const threshold = item.beg * 0.2;
      return item.end <= threshold;
    })
    .map(item => {
      const product = activeProducts.find(p => p.id === item.productId);
      return {
        product: product!,
        current: item.end,
        beginning: item.beg,
        percentage: (item.end / item.beg) * 100
      };
    })
    .filter(item => item.product); // Remove items where product wasn't found

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Main Content - shifts left when drawer is open */}
      <div 
        className={`flex-1 min-w-0 ml-16 py-4 sm:py-6 lg:py-8 pl-4 sm:pl-6 lg:pl-8 pr-4 sm:pr-6 lg:pr-8 overflow-y-auto transition-all duration-300 ease-out ${
          drawerState ? "xl:mr-80" : "mr-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <CurrentDateTime className="text-xs text-gray-500" />
        </div>

        {/* Low Stock Alert */}
        <LowStockAlert lowStockItems={lowStockItems} />

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-6">
          {hasPermission("addProduct") && (
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1.5 text-sm font-semibold text-[#8B2E2E] hover:text-[#B23A3A] transition-colors px-0"
            >
              + Add product
            </button>
          )}

          {hasPermission("deleteProduct") && (
            <>
              {selectionMode !== "delete" ? (
                <button 
                  onClick={handleToggleDeleteMode}
                  className="flex items-center gap-1.5 text-sm font-semibold text-[#8B2E2E] hover:text-[#B23A3A] transition-colors px-0"
                >
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <button 
                    onClick={handleDeleteSelected}
                    disabled={selectedForAction.size === 0}
                    className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete Selected ({selectedForAction.size})
                  </button>
                  <button 
                    onClick={handleToggleDeleteMode}
                    className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}

          {hasPermission("archiveProduct") && (
            <>
              {selectionMode !== "archive" ? (
                <button
                  onClick={handleToggleArchiveMode}
                  className="flex items-center gap-1.5 text-sm font-semibold text-[#8B2E2E] hover:text-[#B23A3A] transition-colors px-0"
                >
                  Archive
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleArchiveSelected}
                    disabled={selectedForAction.size === 0}
                    className="px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Archive Selected ({selectedForAction.size})
                  </button>
                  <button
                    onClick={handleToggleArchiveMode}
                    className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}

          <div className="flex flex-wrap items-center gap-3 ml-0 sm:ml-auto">
            <button
              onClick={() => setShowMovementOnly((prev) => !prev)}
              className={`flex items-center gap-2 px-3 py-2 border rounded-xl text-xs font-semibold transition-all duration-200 ${
                showMovementOnly
                  ? "border-[#8B2E2E] bg-[#8B2E2E]/10 text-[#8B2E2E]"
                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              }`}
              title="Show only products with stock movement for selected date"
            >
              <Filter className="w-3.5 h-3.5" />
              {showMovementOnly ? "Movement Only" : "All Products"}
            </button>

            {/* Category Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowCategoryDropdown(!showCategoryDropdown);
                  setShowBrandDropdown(false);
                }}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-xl text-sm hover:bg-gray-50 bg-white transition-all duration-200 hover:border-gray-400"
              >
                {categoryFilter}
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </button>
              <AnimatePresence>
                {showCategoryDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg z-10 min-w-[180px] overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        setCategoryFilter("Category:");
                        setShowCategoryDropdown(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors"
                    >
                      All Categories
                    </button>
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => {
                          setCategoryFilter(cat);
                          setShowCategoryDropdown(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors"
                      >
                        {cat}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Brand Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowBrandDropdown(!showBrandDropdown);
                  setShowCategoryDropdown(false);
                }}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-xl text-sm hover:bg-gray-50 bg-white transition-all duration-200 hover:border-gray-400"
              >
                {brandFilter}
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </button>
              <AnimatePresence>
                {showBrandDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full mt-2 bg-white border border-gray-200 rounded-xl shadow-lg z-10 min-w-[180px] overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        setBrandFilter("Brand:");
                        setShowBrandDropdown(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors"
                    >
                      All Brands
                    </button>
                    {brands.map((brand) => (
                      <button
                        key={brand}
                        onClick={() => {
                          setBrandFilter(brand);
                          setShowBrandDropdown(false);
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors"
                      >
                        {brand}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Quick Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20 focus:border-[#8B2E2E] w-56 bg-white transition-all duration-200"
              />
            </div>
          </div>
        </div>

        {/* Table Card */}
        <div className="bg-white border border-gray-200 rounded-[16px] shadow-sm overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {selectionMode !== "none" && (
                  <th className="w-[5%] text-left py-3 px-4 text-xs font-bold text-gray-600 uppercase tracking-wide">
                    Select
                  </th>
                )}
                <th className={`${selectionMode !== "none" ? 'w-[10%]' : 'w-[12%]'} text-left py-3 px-4 text-xs font-bold text-gray-600 uppercase tracking-wide`}>
                  Image
                </th>
                <th className={`${selectionMode !== "none" ? 'w-[20%]' : 'w-[23%]'} text-left py-3 px-4 text-xs font-bold text-gray-600 uppercase tracking-wide`}>
                  Name
                </th>
                <th className="w-[10%] text-left py-3 px-4 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  Size
                </th>
                <th className="w-[10%] text-left py-3 px-4 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  Category
                </th>
                <th className="w-[10%] text-left py-3 px-4 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  <span>Cost </span>
                  <span className="normal-case text-[10px] italic font-medium tracking-normal text-gray-500">
                    /bottle
                  </span>
                </th>
                <th className="w-[8%] text-left py-3 px-4 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  Beg.
                </th>
                <th className="w-[8%] text-left py-3 px-4 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  In
                </th>
                <th className="w-[8%] text-left py-3 px-4 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  Out
                </th>
                <th className="w-[8%] text-left py-3 px-4 text-xs font-bold text-gray-600 uppercase tracking-wide">
                  End.
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedProducts.map((product) => {
                const inv = inventory.find((i) => i.productId === product.id);
                const isSelected = selectedProduct?.id === product.id;
                const isSelectedForAction = selectedForAction.has(product.id);
                 
                return (
                  <TableRow
                    key={product.id}
                    product={product}
                    inventory={inv}
                    isSelected={isSelected}
                    onClick={() => {
                      if (selectionMode === "none") {
                        handleRowClick(product);
                      } else {
                        handleToggleSelect(product.id);
                      }
                    }}
                    selectionMode={selectionMode}
                    isSelectedForAction={isSelectedForAction}
                    onToggleSelect={() => handleToggleSelect(product.id)}
                  />
                );
              })}
              {displayedProducts.length === 0 && (
                <tr>
                  <td
                      colSpan={selectionMode !== "none" ? 11 : 10}
                      className="py-8 text-center text-sm text-gray-500"
                  >
                    {showMovementOnly
                      ? "No products with movement for this date."
                      : "No products match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right Drawer with overlay */}
      <AnimatePresence>
        {drawerState && (
          <>
            {/* Subtle dim overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-black/10 z-40 ml-16"
              onClick={handleCloseDrawer}
            />
            
            {/* Drawer Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.3, ease: "easeOut" }}
              className="fixed right-0 top-0 bottom-0 w-full sm:w-80 bg-[#2d2d2d] text-white flex-shrink-0 flex flex-col shadow-2xl z-50"
            >
              <RightDrawerContent
                state={drawerState}
                product={selectedProduct}
                inventory={selectedInventory}
                editedProduct={editedProduct}
                editedInventory={editedInventory}
                onClose={handleCloseDrawer}
                onEdit={handleEdit}
                onSave={handleSave}
                onProductChange={setEditedProduct}
                onInventoryChange={setEditedInventory}
                hasEditPermission={hasPermission("editProduct")}
                hasAddItemPermission={hasPermission("addItem")}
                hasDeleteItemPermission={hasPermission("deleteItem")}
                isSaving={isSavingDrawer}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AddProductModal 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
        onAdd={addProduct}
        brandSuggestions={brands}
        categorySuggestions={categories}
      />

      <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[460px] rounded-[16px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-red-600">
              Are you sure?
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              You are about to delete {selectedForAction.size} selected product
              {selectedForAction.size > 1 ? "s" : ""}. You can't revert this process.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={isDeletingSelected}
              onClick={() => setIsDeleteConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-red-600 hover:bg-red-700"
              disabled={isDeletingSelected}
              onClick={handleConfirmDeleteSelected}
            >
              {isDeletingSelected ? "Deleting..." : "Yes, Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isArchiveConfirmOpen} onOpenChange={setIsArchiveConfirmOpen}>
        <DialogContent className="sm:max-w-[460px] rounded-[16px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-amber-600">
              Archive selected products?
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              You are about to archive {selectedForAction.size} selected product
              {selectedForAction.size > 1 ? "s" : ""}. You can restore them later in Settings &gt; Data Controls.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={isArchivingSelected}
              onClick={() => setIsArchiveConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-amber-600 hover:bg-amber-700"
              disabled={isArchivingSelected}
              onClick={handleConfirmArchiveSelected}
            >
              {isArchivingSelected ? "Archiving..." : "Yes, Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

interface TableRowProps {
  product: Product;
  inventory: DailyInventory | undefined;
  isSelected: boolean;
  onClick: () => void;
  selectionMode: SelectionMode;
  isSelectedForAction: boolean;
  onToggleSelect: () => void;
}

function TableRow({ product, inventory, isSelected, onClick, selectionMode, isSelectedForAction, onToggleSelect }: TableRowProps) {
  const [displayEnd, setDisplayEnd] = useState(inventory?.end || 0);

  // Animate End value changes
  useEffect(() => {
    const targetValue = inventory?.end || 0;
    if (displayEnd === targetValue) return;
    
    const duration = 300;
    const steps = 20;
    const increment = (targetValue - displayEnd) / steps;
    const stepDuration = duration / steps;
    
    let currentStep = 0;
    const timer = setInterval(() => {
      currentStep++;
      if (currentStep >= steps) {
        setDisplayEnd(targetValue);
        clearInterval(timer);
      } else {
        setDisplayEnd(prev => Math.round(prev + increment));
      }
    }, stepDuration);

    return () => clearInterval(timer);
  }, [inventory?.end]);

  return (
    <tr
      onClick={onClick}
      className={`border-b border-gray-100 cursor-pointer transition-all duration-200 group ${
        isSelected 
          ? "bg-gray-50 border-l-4 border-l-[#8B2E2E]" 
          : "hover:bg-gray-50/50 border-l-4 border-l-transparent"
      }`}
      style={{ height: "72px" }}
    >
      {selectionMode !== "none" && (
        <td className="py-4 px-4">
          <input
            type="checkbox"
            className="w-4 h-4 rounded border-gray-300 text-[#8B2E2E] focus:ring-[#8B2E2E] cursor-pointer transition-all duration-200"
            onClick={(e) => e.stopPropagation()}
            checked={isSelectedForAction}
            onChange={onToggleSelect}
          />
        </td>
      )}
      <td className="py-4 px-4">
        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center shadow-sm">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-cover rounded-lg"
            />
          ) : (
            <ImageIcon className="w-6 h-6 text-gray-400" />
          )}
        </div>
      </td>
      <td className="py-4 px-4 text-sm font-medium text-gray-900 truncate">
        {product.name}
      </td>
      <td className="py-4 px-4 text-sm text-gray-600">{product.size}</td>
      <td className="py-4 px-4">
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getCategoryBadgeClass(product.category)}`}
        >
          {product.category}
        </span>
      </td>
      <td className="py-4 px-4 text-sm text-gray-900 font-medium">₱ {product.cost.toFixed(2)}</td>
      <td className="py-4 px-4 text-sm text-gray-700">
        {inventory ? inventory.beg : "-"}
      </td>
      <td className="py-4 px-4 text-sm text-green-600 font-semibold">
        {inventory && inventory.in > 0 ? `+${inventory.in}` : "-"}
      </td>
      <td className="py-4 px-4 text-sm text-red-600 font-semibold">
        {inventory && inventory.out > 0 ? `-${inventory.out}` : "-"}
      </td>
      <td className="py-4 px-4 text-sm text-gray-900 font-bold">
        {inventory ? displayEnd : "-"}
      </td>
    </tr>
  );
}

interface RightDrawerContentProps {
  state: DrawerState;
  product: Product | null;
  inventory: DailyInventory | null;
  editedProduct: Product | null;
  editedInventory: DailyInventory | null;
  onClose: () => void;
  onEdit: () => void;
  onSave: () => Promise<void> | void;
  onProductChange: (product: Product | null) => void;
  onInventoryChange: (inventory: DailyInventory | null) => void;
  hasEditPermission: boolean;
  hasAddItemPermission: boolean;
  hasDeleteItemPermission: boolean;
  isSaving: boolean;
}

function RightDrawerContent({
  state,
  product,
  inventory,
  editedProduct,
  editedInventory,
  onClose,
  onEdit,
  onSave,
  onProductChange,
  onInventoryChange,
  hasEditPermission,
  hasAddItemPermission,
  hasDeleteItemPermission,
  isSaving,
}: RightDrawerContentProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [editSizeValue, setEditSizeValue] = useState("");
  const [editSizeUnit, setEditSizeUnit] = useState<SizeUnitOption>("mL");
  const [editSizeOther, setEditSizeOther] = useState("");

  useEffect(() => {
    if (state !== "edit-mode" || !editedProduct) return;
    const parsed = parseSizeInput(editedProduct.size || "");
    setEditSizeValue(parsed.value);
    setEditSizeUnit(parsed.unit);
    setEditSizeOther(parsed.other);
  }, [state, editedProduct?.id, editedProduct?.size]);

  const handleInventoryChange = (field: "in" | "out", delta: number) => {
    if (!editedInventory) return;
    
    const updated = { ...editedInventory };
    const currentValue = updated[field] as number;
    const maxValue = field === "out" ? updated.total : Number.POSITIVE_INFINITY;
    const newValue = Math.max(0, Math.min(maxValue, currentValue + delta));
    
    updated[field] = newValue as never;
    
    // Auto-calculate
    updated.in = Math.max(0, updated.in);
    updated.total = updated.beg + updated.in;
    updated.out = Math.max(0, Math.min(updated.out, updated.total));
    updated.end = updated.total - updated.out;
    
    onInventoryChange(updated);
  };

  const handleInventoryInputChange = (field: "in" | "out", rawValue: string) => {
    if (!editedInventory) return;

    const digitsOnly = rawValue.replace(/\D/g, "");
    const parsedValue = digitsOnly ? parseInt(digitsOnly, 10) : 0;

    const updated = { ...editedInventory };
    if (field === "in") {
      updated.in = Math.max(0, parsedValue);
      updated.total = updated.beg + updated.in;
      updated.out = Math.max(0, Math.min(updated.out, updated.total));
      updated.end = updated.total - updated.out;
    } else {
      updated.out = Math.max(0, Math.min(parsedValue, updated.total));
      updated.total = updated.beg + updated.in;
      updated.end = updated.total - updated.out;
    }

    onInventoryChange(updated);
  };

  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoClick = () => {
    if (state !== "edit-mode") return;
    fileInputRef.current?.click();
  };

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editedProduct) return;

    const allowedTypes = new Set(["image/png", "image/jpeg", "image/jpg"]);
    if (!allowedTypes.has(file.type)) {
      toast.error("Only PNG, JPG, or JPEG files are allowed.");
      return;
    }

    setIsUploadingImage(true);
    try {
      let imageUrl = "";

      if (isSupabaseConfigured()) {
        const supabase = getSupabase();
        const extension = file.type === "image/png" ? "png" : "jpg";
        const filePath = `products/${editedProduct.id}/${Date.now()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(filePath, file, {
            cacheControl: "3600",
            upsert: true,
            contentType: file.type,
          });

        if (uploadError) {
          throw uploadError;
        }

        const { data: publicUrlData } = supabase.storage
          .from("product-images")
          .getPublicUrl(filePath);

        imageUrl = publicUrlData.publicUrl;
      } else {
        imageUrl = await fileToDataUrl(file);
      }

      onProductChange({
        ...editedProduct,
        imageUrl,
      });
      toast.success("Photo selected. Click SAVE to apply changes.");
    } catch (err) {
      console.error("Image upload failed:", err);
      toast.error(
        "Failed to upload image. Check if 'product-images' bucket exists and has proper policies."
      );
    } finally {
      setIsUploadingImage(false);
    }
  };

  const updateEditedSize = (nextValue: string, nextUnit: SizeUnitOption, nextOther: string) => {
    if (!editedProduct) return;
    onProductChange({
      ...editedProduct,
      size: composeSizeInput(nextValue, nextUnit, nextOther),
    });
  };

  if (state === "item-view" && product) {
    return (
      <>
        {/* Header */}
        <div className="flex items-center justify-center p-6 border-b border-gray-700 relative">
          <h2 className="text-sm font-semibold tracking-wider">ITEM OVERVIEW</h2>
          {hasEditPermission && (
            <button
              onClick={onEdit}
              className="absolute right-6 text-gray-400 hover:text-white transition-colors"
              title="Edit"
            >
              <Edit className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {/* Product Image */}
          <div className="w-40 h-40 bg-white rounded-[20px] mx-auto flex items-center justify-center shadow-lg mb-6">
            {product.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.name}
                className="w-full h-full object-cover rounded-[20px]"
              />
            ) : (
              <ImageIcon className="w-16 h-16 text-gray-300" />
            )}
          </div>

          {/* Product Details */}
          <div className="space-y-5 text-sm">
            <InfoRow label="Display Name" value={product.name} />
            <InfoRow label="Size" value={product.size} />
            <InfoRow label="Category" value={product.category} />
            <InfoRow label="Price" value={product.cost.toFixed(2)} />

            {inventory && (
              <>
                <div className="pt-2" />
                
                <div className="space-y-4">
                  <ValueRow label="Additional Stock In" value={inventory.in} />
                  <ValueRow label="Total Stock in Warehouse" value={inventory.total} />
                  <ValueRow label="Stock out from Warehouse" value={inventory.out} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer Button */}
        <div className="p-6">
          <button
            onClick={onClose}
            className="w-full py-3 bg-white text-gray-900 rounded-xl font-semibold hover:bg-gray-100 transition-all duration-200 uppercase text-sm"
          >
            CLOSE
          </button>
        </div>
      </>
    );
  }

  if (state === "edit-mode" && editedProduct && editedInventory) {
    return (
      <>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-sm font-semibold tracking-wider">EDIT MODE</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-red-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            className="hidden"
            onChange={handleImageSelected}
          />

          {/* Product Image */}
          <div
            className="w-40 h-40 bg-white rounded-[16px] mx-auto flex items-center justify-center relative group cursor-pointer shadow-lg mb-6 overflow-hidden"
            onClick={handlePhotoClick}
            title="Change photo"
          >
            {editedProduct.imageUrl ? (
              <img
                src={editedProduct.imageUrl}
                alt={editedProduct.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <ImageIcon className="w-16 h-16 text-gray-300" />
            )}
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-[16px]">
              <span className="text-sm text-white font-medium">
                {isUploadingImage ? "Uploading..." : "Change"}
              </span>
            </div>
          </div>

          {/* Editable Fields */}
          <div className="space-y-4">
            <EditField
              label="Display Name"
              value={editedProduct.name}
              onChange={(val) => onProductChange({ ...editedProduct, name: val })}
            />
            <EditField
              label="Size"
              value={
                editSizeUnit === "Other"
                  ? editSizeOther
                  : editSizeValue
              }
              onChange={(val) => {
                if (editSizeUnit === "Other") {
                  setEditSizeOther(val);
                  updateEditedSize(editSizeValue, editSizeUnit, val);
                  return;
                }
                setEditSizeValue(val);
                updateEditedSize(val, editSizeUnit, editSizeOther);
              }}
              type={editSizeUnit === "Other" ? "text" : "number"}
              min={editSizeUnit === "Other" ? undefined : 0}
              step={editSizeUnit === "Other" ? undefined : "0.01"}
              rightSlot={
                <Select
                  value={editSizeUnit}
                  onValueChange={(value) => {
                    const nextUnit = value as SizeUnitOption;
                    setEditSizeUnit(nextUnit);
                    updateEditedSize(editSizeValue, nextUnit, editSizeOther);
                  }}
                >
                  <SelectTrigger className="h-10 w-[110px] border-gray-700 bg-[#B23A3A]/5 text-white">
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {SIZE_UNIT_OPTIONS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            <EditField
              label="Category"
              value={editedProduct.category}
              onChange={(val) => onProductChange({ ...editedProduct, category: val })}
            />
            <EditField
              label="Price"
              value={editedProduct.cost.toString()}
              onChange={(val) =>
                onProductChange({
                  ...editedProduct,
                  cost: Math.max(0, parseFloat(val) || 0),
                })
              }
              type="number"
              min={0}
            />

            <div className="pt-6 border-t border-gray-700 space-y-4">
              <ReadOnlyQuantityRow
                label="Beginning Inventory (Qty)"
                value={editedInventory.beg}
              />
              <QuantityRow
                label="Additional Stock In"
                value={editedInventory.in}
                onDecrease={() => handleInventoryChange("in", -1)}
                onIncrease={() => handleInventoryChange("in", 1)}
                onInputChange={(val) => handleInventoryInputChange("in", val)}
                disabled={!hasAddItemPermission}
              />
              <div className="flex justify-between text-sm pt-4 border-t border-gray-700">
                <span className="text-gray-300 font-bold">Total Stock in Warehouse</span>
                <span className="font-bold text-2xl">{editedInventory.total}</span>
              </div>
              <QuantityRow
                label="Stock out from Warehouse"
                value={editedInventory.out}
                onDecrease={() => handleInventoryChange("out", -1)}
                onIncrease={() => handleInventoryChange("out", 1)}
                onInputChange={(val) => handleInventoryInputChange("out", val)}
                disabled={!hasDeleteItemPermission}
              />
              <div className="flex justify-between text-sm pt-4 border-t border-gray-700">
                <span className="text-gray-300 font-bold">Total End Stock</span>
                <span className="font-bold text-2xl">{editedInventory.end}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="p-6">
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-gray-700 text-white rounded-xl font-semibold hover:bg-gray-600 transition-all duration-200"
            >
              CLOSE
            </button>
            <button
              onClick={onSave}
              disabled={isSaving}
              className="flex-1 py-3 bg-white text-gray-900 rounded-xl font-semibold hover:bg-gray-100 transition-all duration-200"
            >
              {isSaving ? "SAVING..." : "SAVE"}
            </button>
          </div>
        </div>
      </>
    );
  }

  return null;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-white font-medium">{value}</p>
    </div>
  );
}

function ValueRow({ label, value, highlight }: { label: string; value: number; highlight?: "green" | "red" }) {
  return (
    <div className="flex justify-between items-center py-2">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`font-semibold ${
        highlight === "green" ? "text-green-400" : 
        highlight === "red" ? "text-red-400" : 
        "text-white"
      }`}>
        {value}
      </span>
    </div>
  );
}

function EditField({ 
  label, 
  value, 
  onChange, 
  type = "text",
  min,
  step,
  rightSlot,
}: { 
  label: string; 
  value: string; 
  onChange: (val: string) => void; 
  type?: string;
  min?: number;
  step?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-2">{label}</label>
      <div className={rightSlot ? "grid grid-cols-[1fr_auto] gap-2" : ""}>
        <input
          type={type}
          step={type === "number" ? step || "0.01" : undefined}
          min={type === "number" ? min : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-[#B23A3A]/5 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#B23A3A]/50 focus:bg-[#B23A3A]/10 transition-colors"
        />
        {rightSlot}
      </div>
    </div>
  );
}

interface QuantityRowProps {
  label: string;
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  onInputChange: (value: string) => void;
  disabled?: boolean;
}

function QuantityRow({ label, value, onDecrease, onIncrease, onInputChange, disabled }: QuantityRowProps) {
  const isDecreaseDisabled = !!disabled || value <= 0;
  const isIncreaseDisabled = !!disabled;

  return (
    <div className="flex justify-between items-center py-2">
      <span className="text-xs text-gray-400">{label}</span>
      <div className="flex items-center gap-3">
        <button
          onClick={onDecrease}
          disabled={isDecreaseDisabled}
          className="w-8 h-8 bg-gray-700 rounded-lg flex items-center justify-center hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
        >
          <Minus className="w-4 h-4" />
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={!!disabled}
          className="w-16 h-8 text-center text-sm font-semibold text-white bg-[#B23A3A]/5 border border-gray-700 rounded-lg focus:outline-none focus:border-[#B23A3A]/50 disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <button
          onClick={onIncrease}
          disabled={isIncreaseDisabled}
          className="w-8 h-8 bg-gray-700 rounded-lg flex items-center justify-center hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ReadOnlyQuantityRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between items-center py-2">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="font-semibold w-10 text-center text-gray-100">{value}</span>
    </div>
  );
}

function AddProductModal({
  isOpen,
  onClose,
  onAdd,
  brandSuggestions,
  categorySuggestions,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (p: NewProductInput) => Promise<boolean>;
  brandSuggestions: string[];
  categorySuggestions: string[];
}) {
  const [formData, setFormData] = useState({
    name: "",
    brand: "",
    category: "",
    cost: "",
    beginningStock: "0",
  });
  const [sizeValue, setSizeValue] = useState("");
  const [sizeUnit, setSizeUnit] = useState<SizeUnitOption>("mL");
  const [sizeOther, setSizeOther] = useState("");
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetForm = () => {
    setFormData({
      name: "",
      brand: "",
      category: "",
      cost: "",
      beginningStock: "0",
    });
    setSizeValue("");
    setSizeUnit("mL");
    setSizeOther("");
    setSelectedImageFile(null);
    setImagePreviewUrl("");
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      resetForm();
    }
  };

  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const allowedTypes = new Set(["image/png", "image/jpeg", "image/jpg"]);
    if (!allowedTypes.has(file.type)) {
      toast.error("Only PNG, JPG, or JPEG files are allowed.");
      return;
    }

    setSelectedImageFile(file);
    try {
      const preview = await fileToDataUrl(file);
      setImagePreviewUrl(preview);
    } catch {
      setImagePreviewUrl("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const parsedPrice = Number(formData.cost);
    const parsedBeginningStock = Number(formData.beginningStock);

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      toast.error("Price must be 0 or higher.");
      return;
    }

    if (!Number.isFinite(parsedBeginningStock) || parsedBeginningStock < 0) {
      toast.error("Beginning stock must be 0 or higher.");
      return;
    }

    if (!formData.category) {
      toast.error("Category is required.");
      return;
    }

    const composedSize = composeSizeInput(sizeValue, sizeUnit, sizeOther);
    if (!composedSize) {
      toast.error("Size is required.");
      return;
    }

    setIsSaving(true);
    try {
      const ok = await onAdd({
        name: formData.name.trim(),
        brand: formData.brand.trim(),
        size: composedSize,
        category: formData.category,
        cost: parsedPrice,
        beginningStock: Math.floor(parsedBeginningStock),
        archived: false,
        imageFile: selectedImageFile,
        imageUrl: imagePreviewUrl || undefined,
      });

      if (!ok) return;

      onClose();
      resetForm();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-[500px] rounded-[16px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Add New Product</DialogTitle>
          <DialogDescription>
            Enter the product details below to add it to the inventory.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-5 py-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            className="hidden"
            onChange={handleImageSelect}
          />
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="image" className="text-right text-sm font-medium">
              Image
            </Label>
            <div className="col-span-3 flex items-center gap-4">
              <div className="w-20 h-20 bg-gray-100 rounded-xl flex items-center justify-center border-2 border-dashed border-gray-300 overflow-hidden">
                {imagePreviewUrl ? (
                  <img
                    src={imagePreviewUrl}
                    alt="Selected product"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-8 h-8 text-gray-400" />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right text-sm font-medium">
              Name
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="col-span-3 rounded-xl"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="brand" className="text-right text-sm font-medium">
              Brand
            </Label>
            <div className="col-span-3">
              <Input
                id="brand"
                list="brand-suggestions"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                className="rounded-xl"
              />
              <datalist id="brand-suggestions">
                {brandSuggestions
                  .filter((brand) => !!brand)
                  .map((brand) => (
                    <option key={brand} value={brand} />
                  ))}
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="size" className="text-right text-sm font-medium">
              Size
            </Label>
            <div className="col-span-3 grid grid-cols-[1fr_120px] gap-2">
              {sizeUnit === "Other" ? (
                <Input
                  id="size"
                  value={sizeOther}
                  onChange={(e) => setSizeOther(e.target.value)}
                  className="rounded-xl"
                  placeholder="Type size"
                  required
                />
              ) : (
                <Input
                  id="size"
                  type="number"
                  min={0}
                  step="0.01"
                  value={sizeValue}
                  onChange={(e) => setSizeValue(e.target.value)}
                  className="rounded-xl"
                  placeholder="e.g. 500"
                  required
                />
              )}
              <Select
                value={sizeUnit}
                onValueChange={(value) => setSizeUnit(value as SizeUnitOption)}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Unit" />
                </SelectTrigger>
                <SelectContent>
                  {SIZE_UNIT_OPTIONS.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="category" className="text-right text-sm font-medium">
              Category
            </Label>
            <div className="col-span-3">
              <Select
                value={formData.category}
                onValueChange={(val) => setFormData({ ...formData, category: val })}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categorySuggestions.length === 0 ? (
                    <SelectItem value="__no_category_available" disabled>
                      No categories from database
                    </SelectItem>
                  ) : (
                    categorySuggestions.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="price" className="text-right text-sm font-medium">
              Price
            </Label>
            <Input
              id="price"
              type="number"
              step="0.01"
              min={0}
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
              className="col-span-3 rounded-xl"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="beg" className="text-right text-sm font-medium">
              Beg. Stock
            </Label>
            <Input
              id="beg"
              type="number"
              min={0}
              step="1"
              value={formData.beginningStock}
              onChange={(e) => setFormData({ ...formData, beginningStock: e.target.value })}
              className="col-span-3 rounded-xl"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" className="rounded-xl" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
