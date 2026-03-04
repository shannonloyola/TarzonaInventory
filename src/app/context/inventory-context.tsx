import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  InventoryContextType,
  Product,
  InventorySheet,
  DailyInventory,
  ActivityLog,
} from "../types";
import { mockProducts, mockInventorySheets } from "../data/mock-excel-data";
import { mockActivityLogs } from "../data/mock-activity-logs";
import { toast } from "sonner";
import { useAuth } from "./auth-context";
import { format, isValid, parse } from "date-fns";
import { getSupabase, isSupabaseConfigured } from "../../lib/supabase";
import { logActivity as logDbActivity, TransactionType } from "../../lib/db-utils";

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

type ProductRow = {
  id: string;
  display_name: string;
  brand: string | null;
  size: string;
  category: string;
  price: number;
  image_url: string | null;
  archived: boolean | null;
};

type SnapshotRow = {
  product_id: string;
  snapshot_date: string;
  beginning_qty: number;
  stock_in_qty: number;
  stock_out_qty: number;
  end_qty: number;
};

type TxnRow = {
  id: string;
  created_at: string;
  actor_username: string;
  actor_role: string;
  product_id: string | null;
  product_name: string | null;
  note: string | null;
};

type GenericRow = Record<string, unknown>;

type NormalizedSnapshot = {
  productId: string;
  snapshotDate: string; // YYYY-MM-DD
  beginningQty: number;
  stockInQty: number;
  stockOutQty: number;
  endQty: number;
};

const uiDateFormat = "M-d-yy";
const dbDateFormat = "yyyy-MM-dd";

function todayUiDate(): string {
  return format(new Date(), uiDateFormat);
}

function toDbDate(uiDate: string): string {
  const parsed = parse(uiDate, uiDateFormat, new Date());
  if (!isValid(parsed)) return format(new Date(), dbDateFormat);
  return format(parsed, dbDateFormat);
}

function toUiDate(dbDate: string): string {
  const parsed = new Date(`${dbDate}T00:00:00`);
  if (!isValid(parsed)) return todayUiDate();
  return format(parsed, uiDateFormat);
}

function getStringValue(row: GenericRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

function getNumberValue(row: GenericRow, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function normalizeNameKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeSnapshotRow(
  row: GenericRow,
  productNameToId: Map<string, string>
): NormalizedSnapshot | null {
  const snapshotDate = getStringValue(row, ["snapshot_date", "date", "inventory_date", "business_date"]);
  if (!snapshotDate) return null;

  const asDbDate = snapshotDate.slice(0, 10);
  const parsedDbDate = parse(asDbDate, dbDateFormat, new Date());
  if (!isValid(parsedDbDate)) return null;
  const normalizedDate = format(parsedDbDate, dbDateFormat);

  let productId = getStringValue(row, ["product_id", "productid", "product_uuid"]);
  if (!productId) {
    const productName = getStringValue(row, ["product_name", "display_name", "name", "item_name"]);
    if (!productName) return null;
    productId = productNameToId.get(normalizeNameKey(productName)) || null;
    if (!productId) return null;
  }

  const beginningQty = getNumberValue(row, ["beginning_qty", "beg_qty", "beg", "opening_qty"]);
  const stockInQty = getNumberValue(row, ["stock_in_qty", "stockin_qty", "stock_in", "in_qty", "in"]);
  const stockOutQty = getNumberValue(row, ["stock_out_qty", "stockout_qty", "stock_out", "out_qty", "out"]);
  const endQty = getNumberValue(row, ["end_qty", "ending_qty", "end"], beginningQty + stockInQty - stockOutQty);

  return {
    productId,
    snapshotDate: normalizedDate,
    beginningQty,
    stockInQty,
    stockOutQty,
    endQty,
  };
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeCode = (error as { code?: unknown }).code;
  const maybeMessage = String((error as { message?: unknown }).message || "");
  return maybeCode === "42P01" || maybeMessage.toLowerCase().includes("does not exist");
}

function mapProductRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.display_name,
    brand: row.brand || "",
    size: row.size,
    category: row.category,
    cost: Number(row.price || 0),
    imageUrl: row.image_url || undefined,
    archived: !!row.archived,
  };
}

function mapTxnToActivityLog(row: TxnRow): ActivityLog {
  return {
    id: row.id,
    timestamp: format(new Date(row.created_at), "EEE, MMM d, yyyy h:mm a"),
    userName: row.actor_username || "Unknown",
    userEmail: "",
    userRole: row.actor_role === "admin" ? "Admin" : "Staff",
    activity: row.note || "Inventory activity",
    productId: row.product_id || undefined,
    productName: row.product_name || undefined,
  };
}

function upsertLocalInventorySheet(
  prev: InventorySheet[],
  date: string,
  updatedItem: DailyInventory
): InventorySheet[] {
  const sheetIdx = prev.findIndex((s) => s.date === date);
  if (sheetIdx === -1) {
    return [...prev, { date, items: [updatedItem] }];
  }

  const targetSheet = prev[sheetIdx];
  const itemIdx = targetSheet.items.findIndex((i) => i.productId === updatedItem.productId);
  const nextItems =
    itemIdx === -1
      ? [...targetSheet.items, updatedItem]
      : targetSheet.items.map((item, idx) => (idx === itemIdx ? updatedItem : item));

  return prev.map((sheet, idx) => (idx === sheetIdx ? { ...sheet, items: nextItems } : sheet));
}

export function InventoryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>(mockProducts);
  const [inventorySheets, setInventorySheets] = useState<InventorySheet[]>(mockInventorySheets);
  const [selectedDate, setSelectedDate] = useState<string>(todayUiDate());
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(mockActivityLogs);
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean>(isSupabaseConfigured());

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = isSupabaseConfigured();
      setSupabaseConfigured((prev) => (prev === next ? prev : next));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadFromSupabase = async () => {
      if (!supabaseConfigured) return;

      try {
        const supabase = getSupabase();

        const { data: productRows, error: productError } = await supabase
          .from("products")
          .select("id, display_name, brand, size, category, price, image_url, archived")
          .order("created_at", { ascending: true });

        if (productError) throw productError;

        const mappedProducts = (productRows || []).map((row) => mapProductRow(row as ProductRow));
        const productNameToId = new Map<string, string>();
        mappedProducts.forEach((product) => {
          productNameToId.set(normalizeNameKey(product.name), product.id);
        });

        const [
          { data: snapshotRows, error: snapshotError },
          { data: txnRows, error: txnError },
          { data: stagingRows, error: stagingError },
        ] = await Promise.all([
          supabase
            .from("inventory_snapshot")
            .select("product_id, snapshot_date, beginning_qty, stock_in_qty, stock_out_qty, end_qty")
            .order("snapshot_date", { ascending: false }),
          supabase
            .from("inventory_transactions")
            .select("id, created_at, actor_username, actor_role, product_id, product_name, note")
            .order("created_at", { ascending: false })
            .limit(500),
          supabase.from("staging_snapshots").select("*").limit(20000),
        ]);

        if (snapshotError) throw snapshotError;
        if (txnError) throw txnError;
        if (stagingError && !isMissingTableError(stagingError)) {
          console.warn("Failed to read staging_snapshots:", stagingError);
        }

        const normalizedPrimarySnapshots: NormalizedSnapshot[] = (snapshotRows || []).map((row) => {
          const snapshot = row as SnapshotRow;
          return {
            productId: snapshot.product_id,
            snapshotDate: snapshot.snapshot_date,
            beginningQty: Number(snapshot.beginning_qty || 0),
            stockInQty: Number(snapshot.stock_in_qty || 0),
            stockOutQty: Number(snapshot.stock_out_qty || 0),
            endQty: Number(snapshot.end_qty || 0),
          };
        });

        const normalizedStagingSnapshots: NormalizedSnapshot[] = ((stagingRows || []) as GenericRow[])
          .map((row) => normalizeSnapshotRow(row, productNameToId))
          .filter((row): row is NormalizedSnapshot => row !== null);

        const primaryKeys = new Set(
          normalizedPrimarySnapshots.map((s) => `${s.productId}__${s.snapshotDate}`)
        );
        const stagingOnly = normalizedStagingSnapshots.filter(
          (s) => !primaryKeys.has(`${s.productId}__${s.snapshotDate}`)
        );

        if (stagingOnly.length > 0) {
          const { error: backfillError } = await supabase.from("inventory_snapshot").upsert(
            stagingOnly.map((s) => ({
              product_id: s.productId,
              snapshot_date: s.snapshotDate,
              beginning_qty: s.beginningQty,
              stock_in_qty: s.stockInQty,
              stock_out_qty: s.stockOutQty,
              end_qty: s.endQty,
            })),
            { onConflict: "product_id,snapshot_date" }
          );

          if (backfillError) {
            console.warn("Failed to backfill staging snapshots into inventory_snapshot:", backfillError);
          }
        }

        const mergedSnapshots = [...normalizedPrimarySnapshots];
        const mergedKeys = new Set(mergedSnapshots.map((s) => `${s.productId}__${s.snapshotDate}`));
        stagingOnly.forEach((s) => {
          const key = `${s.productId}__${s.snapshotDate}`;
          if (!mergedKeys.has(key)) {
            mergedSnapshots.push(s);
            mergedKeys.add(key);
          }
        });

        const sheetMap = new Map<string, DailyInventory[]>();
        mergedSnapshots.forEach((snapshot) => {
          const uiDate = toUiDate(snapshot.snapshotDate);
          const item: DailyInventory = {
            productId: snapshot.productId,
            beg: snapshot.beginningQty,
            in: snapshot.stockInQty,
            total: snapshot.beginningQty + snapshot.stockInQty,
            out: snapshot.stockOutQty,
            end: snapshot.endQty,
          };

          const existing = sheetMap.get(uiDate) || [];
          existing.push(item);
          sheetMap.set(uiDate, existing);
        });

        const mappedSheets: InventorySheet[] = Array.from(sheetMap.entries())
          .map(([date, items]) => ({ date, items }))
          .sort((a, b) => {
            const dateA = parse(a.date, uiDateFormat, new Date());
            const dateB = parse(b.date, uiDateFormat, new Date());
            return dateB.getTime() - dateA.getTime();
          });

        const mappedLogs = (txnRows || []).map((row) => mapTxnToActivityLog(row as TxnRow));

        setProducts(mappedProducts);
        setInventorySheets(mappedSheets);
        setActivityLogs(mappedLogs);
        if (mappedSheets.length > 0) {
          setSelectedDate((prev) =>
            mappedSheets.some((sheet) => sheet.date === prev) ? prev : mappedSheets[0].date
          );
        }
      } catch (err) {
        console.error("Failed to load Supabase inventory data:", err);
        toast.error("Failed to load Supabase inventory data. Using local mock data.");
      }
    };

    void loadFromSupabase();
  }, [supabaseConfigured, user?.id]);

  const getInventoryForDate = (date: string): DailyInventory[] => {
    const sheet = inventorySheets.find((s) => s.date === date);
    return sheet?.items || [];
  };

  const getProductById = (id: string): Product | undefined => {
    return products.find((p) => p.id === id);
  };

  const pushLocalActivity = (activity: string, productId?: string, productName?: string) => {
    if (!user) return;

    const newLog: ActivityLog = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: format(new Date(), "EEE, MMM d, yyyy h:mm a"),
      userName: user.username,
      userEmail: user.email,
      userRole: user.role,
      activity,
      productId,
      productName,
    };

    setActivityLogs((prev) => [newLog, ...prev]);
  };

  const persistDbActivity = async (
    txnType: TransactionType,
    activity: string,
    productId?: string,
    productName?: string,
    qtyDelta?: number
  ) => {
    if (!supabaseConfigured || !user) return;

    await logDbActivity({
      snapshot_date: toDbDate(selectedDate),
      actor_profile_id: user.id,
      actor_username: user.username,
      actor_role: user.role.toLowerCase(),
      txn_type: txnType,
      product_id: productId || null,
      product_name: productName || null,
      qty_delta: qtyDelta ?? null,
      note: activity,
    });
  };

  const logActivity = (activity: string, productId?: string, productName?: string) => {
    pushLocalActivity(activity, productId, productName);
    void persistDbActivity("edit_product", activity, productId, productName);
  };

  const addProduct = (product: Omit<Product, "id">) => {
    const add = async () => {
      if (supabaseConfigured) {
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase
            .from("products")
            .insert({
              display_name: product.name,
              brand: product.brand || "",
              size: product.size,
              category: product.category,
              price: product.cost,
              image_url: product.imageUrl || null,
              archived: !!product.archived,
            })
            .select("id, display_name, brand, size, category, price, image_url, archived")
            .single();

          if (error) throw error;
          const mapped = mapProductRow(data as ProductRow);
          setProducts((prev) => [...prev, mapped]);
          pushLocalActivity(`Added new product: ${product.name}`, mapped.id, product.name);
          await persistDbActivity("add_product", `Added new product: ${product.name}`, mapped.id, product.name);
          toast.success("Product added successfully");
          return;
        } catch (err) {
          console.error("Failed to add product in Supabase:", err);
          toast.error("Failed to add product in Supabase");
          return;
        }
      }

      const newProduct: Product = {
        ...product,
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      };
      setProducts((prev) => [...prev, newProduct]);
      pushLocalActivity(`Added new product: ${product.name}`, newProduct.id, product.name);
      toast.success("Product added successfully");
    };

    void add();
  };

  const updateProduct = (id: string, updates: Partial<Product>) => {
    const update = async () => {
      const current = getProductById(id);
      if (!current) return;

      if (supabaseConfigured) {
        try {
          const supabase = getSupabase();
          const payload: Record<string, unknown> = {};
          if (updates.name !== undefined) payload.display_name = updates.name;
          if (updates.brand !== undefined) payload.brand = updates.brand;
          if (updates.size !== undefined) payload.size = updates.size;
          if (updates.category !== undefined) payload.category = updates.category;
          if (updates.cost !== undefined) payload.price = updates.cost;
          if (updates.imageUrl !== undefined) payload.image_url = updates.imageUrl;
          if (updates.archived !== undefined) payload.archived = updates.archived;

          const { data, error } = await supabase
            .from("products")
            .update(payload)
            .eq("id", id)
            .select("id, display_name, brand, size, category, price, image_url, archived")
            .single();

          if (error) throw error;
          const mapped = mapProductRow(data as ProductRow);
          setProducts((prev) => prev.map((p) => (p.id === id ? mapped : p)));

          const activity = `Updated product details for ${mapped.name}`;
          pushLocalActivity(activity, id, mapped.name);
          await persistDbActivity("edit_product", activity, id, mapped.name);
          toast.success("Product updated successfully");
          return;
        } catch (err) {
          console.error("Failed to update product in Supabase:", err);
          toast.error("Failed to update product in Supabase");
          return;
        }
      }

      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
      const product = getProductById(id);
      pushLocalActivity(`Updated product details for ${product?.name || "Unknown"}`, id, product?.name);
      toast.success("Product updated successfully");
    };

    void update();
  };

  const deleteProduct = (id: string) => {
    const remove = async () => {
      const product = getProductById(id);
      if (!product) return;

      if (supabaseConfigured) {
        try {
          const supabase = getSupabase();
          const { error } = await supabase.from("products").delete().eq("id", id);
          if (error) throw error;
        } catch (err) {
          console.error("Failed to delete product in Supabase:", err);
          toast.error("Failed to delete product in Supabase");
          return;
        }
      }

      setProducts((prev) => prev.filter((p) => p.id !== id));
      setInventorySheets((prev) =>
        prev.map((sheet) => ({
          ...sheet,
          items: sheet.items.filter((item) => item.productId !== id),
        }))
      );

      const activity = `Deleted product: ${product.name}`;
      pushLocalActivity(activity, id, product.name);
      await persistDbActivity("delete_product", activity, id, product.name);
      toast.success("Product deleted successfully");
    };

    void remove();
  };

  const updateDailyInventory = (date: string, productId: string, updates: Partial<DailyInventory>) => {
    const update = async () => {
      const existing = getInventoryForDate(date).find((item) => item.productId === productId);
      const base = existing || { productId, beg: 0, in: 0, total: 0, out: 0, end: 0 };

      const next: DailyInventory = {
        ...base,
        ...updates,
      };
      next.total = next.beg + next.in;
      next.end = next.total - next.out;

      if (supabaseConfigured) {
        try {
          const supabase = getSupabase();
          const { error } = await supabase.from("inventory_snapshot").upsert(
            {
              product_id: productId,
              snapshot_date: toDbDate(date),
              beginning_qty: next.beg,
              stock_in_qty: next.in,
              stock_out_qty: next.out,
              end_qty: next.end,
            },
            { onConflict: "product_id,snapshot_date" }
          );

          if (error) throw error;
        } catch (err) {
          console.error("Failed to update inventory snapshot:", err);
          toast.error("Failed to update inventory in Supabase");
          return;
        }
      }

      setInventorySheets((prev) => upsertLocalInventorySheet(prev, date, next));

      const product = getProductById(productId);
      let activityStr = `Updated inventory for ${product?.name || "Unknown"}`;
      let txnType: TransactionType = "edit_product";
      let qtyDelta: number | undefined = undefined;

      if (updates.in !== undefined) {
        activityStr = `Updated stock IN for ${product?.name || "Unknown"}`;
        txnType = "stock_in";
        qtyDelta = updates.in - (existing?.in || 0);
      } else if (updates.out !== undefined) {
        activityStr = `Updated stock OUT for ${product?.name || "Unknown"}`;
        txnType = "stock_out";
        qtyDelta = updates.out - (existing?.out || 0);
      } else if (updates.beg !== undefined) {
        activityStr = `Updated beginning inventory for ${product?.name || "Unknown"}`;
        txnType = "beginning_set";
        qtyDelta = updates.beg - (existing?.beg || 0);
      }

      pushLocalActivity(activityStr, productId, product?.name);
      await persistDbActivity(txnType, activityStr, productId, product?.name, qtyDelta);
      toast.success("Inventory updated successfully");
    };

    void update();
  };

  const archiveProduct = (id: string) => {
    updateProduct(id, { archived: true });
    const product = getProductById(id);
    void persistDbActivity("archive_product", `Archived product: ${product?.name || "Unknown"}`, id, product?.name);
    toast.success("Product archived");
  };

  const archiveAllProducts = () => {
    const archiveAll = async () => {
      if (supabaseConfigured) {
        try {
          const supabase = getSupabase();
          const { error } = await supabase.from("products").update({ archived: true }).eq("archived", false);
          if (error) throw error;
        } catch (err) {
          console.error("Failed to archive all products in Supabase:", err);
          toast.error("Failed to archive all products in Supabase");
          return;
        }
      }

      setProducts((prev) => prev.map((p) => ({ ...p, archived: true })));
      pushLocalActivity("Archived all products");
      await persistDbActivity("archive_all", "Archived all products");
      toast.success("All products archived");
    };

    void archiveAll();
  };

  const exportData = () => {
    const csvContent = products.map((p) => `${p.name},${p.size},${p.category},${p.cost}`).join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tarzona-inventory-export.csv";
    a.click();

    pushLocalActivity("Exported inventory data");
    void persistDbActivity("export", "Exported inventory data");
    toast.success("Data exported successfully");
  };

  return (
    <InventoryContext.Provider
      value={{
        products,
        inventorySheets,
        selectedDate,
        activityLogs,
        getInventoryForDate,
        getProductById,
        addProduct,
        updateProduct,
        deleteProduct,
        updateDailyInventory,
        archiveProduct,
        archiveAllProducts,
        exportData,
        setSelectedDate,
        logActivity,
      }}
    >
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventory() {
  const context = useContext(InventoryContext);
  if (context === undefined) {
    throw new Error("useInventory must be used within an InventoryProvider");
  }
  return context;
}
