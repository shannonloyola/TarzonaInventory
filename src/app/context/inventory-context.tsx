import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import {
  InventoryContextType,
  Product,
  NewProductInput,
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
  actor_profile_id: string | null;
  actor_username: string;
  actor_role: string;
  product_id: string | null;
  product_name: string | null;
  note: string | null;
};

type ProfileLookupRow = {
  id: string;
  full_name: string | null;
  email: string | null;
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

const uiDateFormat = "M-d-yyyy";
const legacyUiDateFormat = "M-d-yy";
const dbDateFormat = "yyyy-MM-dd";
const selectedDateStorageKey = "tarzona_selected_date";

function todayUiDate(): string {
  return format(new Date(), uiDateFormat);
}

function parseFlexibleUiDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Avoid ambiguous parsing such as "9-20-25" being interpreted as year 0025.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = parse(trimmed, dbDateFormat, new Date());
    return isValid(parsed) ? parsed : null;
  }

  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(trimmed)) {
    const parsed = parse(trimmed, uiDateFormat, new Date());
    return isValid(parsed) ? parsed : null;
  }

  if (/^\d{1,2}-\d{1,2}-\d{2}$/.test(trimmed)) {
    const parsed = parse(trimmed, legacyUiDateFormat, new Date());
    return isValid(parsed) ? parsed : null;
  }

  return null;
}

function isValidUiDateString(value: string): boolean {
  return parseFlexibleUiDate(value) !== null;
}

function toDbDate(uiDate: string): string {
  const parsed = parseFlexibleUiDate(uiDate);
  if (!isValid(parsed)) return "";
  return format(parsed, dbDateFormat);
}

function toUiDate(dbDate: string): string {
  const parsed = parse(String(dbDate).slice(0, 10), dbDateFormat, new Date());
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

function normalizeCategoryKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function toTitleCaseWords(value: string): string {
  return value
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeSizeForSave(rawSize: string): string {
  const trimmed = rawSize.trim().replace(/\s+/g, " ");
  const compact = trimmed.replace(/\s+/g, "");
  if (!compact) return "";

  const lower = compact.toLowerCase();
  const numericWithUnit = lower.match(
    /^(\d+(?:\.\d+)?)(ml|milliliter|milliliters|millilitre|millilitres|cl|centiliter|centiliters|centilitre|centilitres|l|lt|ltr|liter|liters|litre|litres)$/
  );

  if (numericWithUnit) {
    const sizeNumber = Number(numericWithUnit[1]);
    const unitRaw = numericWithUnit[2];
    const numberText = Number.isFinite(sizeNumber)
      ? sizeNumber.toString()
      : numericWithUnit[1];

    const isMilliliter =
      unitRaw === "ml" ||
      unitRaw === "milliliter" ||
      unitRaw === "milliliters" ||
      unitRaw === "millilitre" ||
      unitRaw === "millilitres";
    const isCentiliter =
      unitRaw === "cl" ||
      unitRaw === "centiliter" ||
      unitRaw === "centiliters" ||
      unitRaw === "centilitre" ||
      unitRaw === "centilitres";

    if (isMilliliter) return `${numberText}mL`;
    if (isCentiliter) return `${numberText}CL`;
    return `${numberText}L`;
  }

  // Fallback: normalize known suffix terms without forcing unknown formats.
  const normalizedFallback = compact
    .replace(/(milliliters?|millilitres?|ml)$/i, "mL")
    .replace(/(centiliters?|centilitres?|cl)$/i, "CL")
    .replace(/(liters?|litres?|ltr|lt|l)$/i, "L");
  if (normalizedFallback !== compact) return normalizedFallback;

  return trimmed;
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

function mapTxnToActivityLog(
  row: TxnRow,
  profileById: Map<string, { fullName: string; email: string }>
): ActivityLog {
  const parsedTimestamp = new Date(row.created_at);
  const safeTimestamp = isValid(parsedTimestamp)
    ? format(parsedTimestamp, "EEE, MMM d, yyyy h:mm a")
    : "Unknown time";
  const actorProfileId = row.actor_profile_id || "";
  const matchedProfile = actorProfileId ? profileById.get(actorProfileId) : undefined;
  const resolvedName = matchedProfile?.fullName || row.actor_username || "Unknown";
  const resolvedEmail = matchedProfile?.email || "";

  return {
    id: row.id,
    userId: row.actor_profile_id || undefined,
    timestamp: safeTimestamp,
    userName: resolvedName,
    userEmail: resolvedEmail,
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

function parseUiDateValue(date: string): Date | null {
  return parseFlexibleUiDate(date);
}

async function fetchAllInventorySnapshots(): Promise<SnapshotRow[]> {
  const supabase = getSupabase();
  const pageSize = 1000;
  let from = 0;
  let keepFetching = true;
  const rows: SnapshotRow[] = [];

  while (keepFetching) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("inventory_snapshot")
      .select("product_id, snapshot_date, beginning_qty, stock_in_qty, stock_out_qty, end_qty")
      .order("snapshot_date", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const batch = (data || []) as SnapshotRow[];
    rows.push(...batch);

    if (batch.length < pageSize) {
      keepFetching = false;
    } else {
      from += pageSize;
    }
  }

  return rows;
}

export function InventoryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>(() =>
    isSupabaseConfigured() ? [] : mockProducts
  );
  const [inventorySheets, setInventorySheets] = useState<InventorySheet[]>(() =>
    isSupabaseConfigured() ? [] : mockInventorySheets
  );
  const [selectedDate, setSelectedDateState] = useState<string>(() => {
    const stored = localStorage.getItem(selectedDateStorageKey);
    if (stored) {
      const parsed = parseFlexibleUiDate(stored);
      if (parsed) return format(parsed, uiDateFormat);
    }
    return todayUiDate();
  });
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(() =>
    isSupabaseConfigured() ? [] : mockActivityLogs
  );
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean>(isSupabaseConfigured());

  const normalizeCategoryForSave = (rawCategory: string): string => {
    const trimmed = rawCategory.trim().replace(/\s+/g, " ");
    if (!trimmed) return "";

    const normalizedKey = normalizeCategoryKey(trimmed);
    const existing = products.find(
      (p) => normalizeCategoryKey(p.category || "") === normalizedKey
    );
    if (existing?.category) return existing.category;

    return toTitleCaseWords(trimmed);
  };

  const setSelectedDate = (date: string) => {
    const parsed = parseFlexibleUiDate(date);
    const safeDate = parsed ? format(parsed, uiDateFormat) : todayUiDate();
    setSelectedDateState(safeDate);
    localStorage.setItem(selectedDateStorageKey, safeDate);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = isSupabaseConfigured();
      setSupabaseConfigured((prev) => (prev === next ? prev : next));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) {
      setProducts(mockProducts);
      setInventorySheets(mockInventorySheets);
      setActivityLogs(mockActivityLogs);
    }
  }, [supabaseConfigured]);

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

        const snapshotRows = await fetchAllInventorySnapshots();

        const { data: txnRows, error: txnError } = await supabase
          .from("inventory_transactions")
          .select("id, created_at, actor_profile_id, actor_username, actor_role, product_id, product_name, note")
          .order("created_at", { ascending: false })
          .limit(500);
        if (txnError) {
          console.warn("Failed to read inventory_transactions. Continuing without logs:", txnError);
        }

        const { data: stagingRows, error: stagingError } = await supabase
          .from("staging_snapshots")
          .select("*")
          .limit(20000);
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

        const actorProfileIds = Array.from(
          new Set(
            (txnRows || [])
              .map((row) => String((row as TxnRow).actor_profile_id || "").trim())
              .filter((id) => id.length > 0)
          )
        );

        const profileById = new Map<string, { fullName: string; email: string }>();
        if (actorProfileIds.length > 0) {
          const { data: profileRows, error: profileError } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", actorProfileIds);

          if (profileError) {
            console.warn("Failed to read profiles for activity logs:", profileError);
          } else {
            (profileRows || []).forEach((row) => {
              const profile = row as ProfileLookupRow;
              profileById.set(profile.id, {
                fullName: profile.full_name || "",
                email: profile.email || "",
              });
            });
          }
        }

        const mappedLogs = (txnRows || []).map((row) =>
          mapTxnToActivityLog(row as TxnRow, profileById)
        );

        setProducts(mappedProducts);
        setInventorySheets(mappedSheets);
        setActivityLogs(mappedLogs);
        setSelectedDateState((prev) => {
          // Keep user's currently selected date even when no explicit snapshot row exists for that day.
          // getInventoryForDate() can synthesize carry-over rows for missing dates.
          const parsedPrev = parseFlexibleUiDate(prev);
          const next = parsedPrev
            ? format(parsedPrev, uiDateFormat)
            : mappedSheets.length > 0
            ? mappedSheets[0].date
            : todayUiDate();
          localStorage.setItem(selectedDateStorageKey, next);
          return next;
        });
      } catch (err) {
        console.error("Failed to load Supabase inventory data:", err);
        const errorMessage =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: unknown }).message || "Unknown error")
            : "Unknown error";
        toast.error(`Failed to load Supabase inventory data: ${errorMessage}`);
        setProducts([]);
        setInventorySheets([]);
        setActivityLogs([]);
      }
    };

    void loadFromSupabase();
  }, [supabaseConfigured, user?.id]);

  useEffect(() => {
    if (!supabaseConfigured) return;

    const supabase = getSupabase();
    const productsChannel = supabase
      .channel("products-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { id?: string };
            if (!oldRow?.id) return;
            setProducts((prev) => prev.filter((p) => p.id !== oldRow.id));
            return;
          }

          const row = payload.new as ProductRow;
          if (!row?.id) return;
          const mapped = mapProductRow(row);
          setProducts((prev) => {
            const exists = prev.some((p) => p.id === mapped.id);
            if (exists) return prev.map((p) => (p.id === mapped.id ? mapped : p));
            return [...prev, mapped];
          });
        }
      )
      .subscribe();

    const snapshotChannel = supabase
      .channel("inventory-snapshot-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_snapshot" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { product_id?: string; snapshot_date?: string };
            if (!oldRow?.product_id || !oldRow.snapshot_date) return;
            const uiDate = toUiDate(oldRow.snapshot_date);
            setInventorySheets((prev) =>
              prev
                .map((sheet) =>
                  sheet.date !== uiDate
                    ? sheet
                    : {
                        ...sheet,
                        items: sheet.items.filter((item) => item.productId !== oldRow.product_id),
                      }
                )
                .filter((sheet) => sheet.items.length > 0)
            );
            return;
          }

          const row = payload.new as SnapshotRow;
          if (!row?.product_id || !row.snapshot_date) return;
          const uiDate = toUiDate(row.snapshot_date);
          setInventorySheets((prev) =>
            upsertLocalInventorySheet(prev, uiDate, {
              productId: row.product_id,
              beg: Number(row.beginning_qty || 0),
              in: Number(row.stock_in_qty || 0),
              total: Number(row.beginning_qty || 0) + Number(row.stock_in_qty || 0),
              out: Number(row.stock_out_qty || 0),
              end: Number(row.end_qty || 0),
            })
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(productsChannel);
      void supabase.removeChannel(snapshotChannel);
    };
  }, [supabaseConfigured]);

  const normalizedInventoryByDate = useMemo(() => {
    const result = new Map<string, DailyInventory[]>();
    const sortedSheets = [...inventorySheets]
      .map((sheet) => ({ sheet, parsed: parseUiDateValue(sheet.date) }))
      .filter((entry): entry is { sheet: InventorySheet; parsed: Date } => entry.parsed !== null)
      .sort((a, b) => a.parsed.getTime() - b.parsed.getTime());

    const knownProductIds = products.map((product) => product.id);
    const carryEndByProduct = new Map<string, number>();

    sortedSheets.forEach(({ sheet }) => {
      const currentByProduct = new Map(sheet.items.map((item) => [item.productId, item]));
      const dateRows: DailyInventory[] = [];

      knownProductIds.forEach((productId) => {
        const raw = currentByProduct.get(productId);
        const hasCarry = carryEndByProduct.has(productId);
        const carryBeg = hasCarry ? carryEndByProduct.get(productId)! : 0;

        // Keep day-to-day continuity: if we already have prior-day end, use it as beginning.
        // For the first explicit row of a product (no carry yet), honor DB beginning qty.
        const beg = raw
          ? hasCarry
            ? carryBeg
            : Math.max(0, raw.beg)
          : carryBeg;
        const stockIn = Math.max(0, raw?.in ?? 0);
        const total = beg + stockIn;
        const stockOut = Math.max(0, Math.min(raw?.out ?? 0, total));
        const end = total - stockOut;

        dateRows.push({
          productId,
          beg,
          in: stockIn,
          total,
          out: stockOut,
          end,
        });

        // Do not start carry chain for products that have no historical row yet.
        // This prevents synthetic zeroes from overriding first real beginning_qty.
        if (raw || hasCarry) {
          carryEndByProduct.set(productId, end);
        }
      });

      result.set(sheet.date, dateRows);
    });

    return result;
  }, [inventorySheets, products]);

  const getInventoryForDate = (date: string): DailyInventory[] => {
    const exact = normalizedInventoryByDate.get(date);
    if (exact) return exact;

    const targetDate = parseUiDateValue(date);
    if (!targetDate) return [];

    let nearestPastDate: string | null = null;
    let nearestPastTime = -Infinity;
    normalizedInventoryByDate.forEach((_, dateKey) => {
      const parsed = parseUiDateValue(dateKey);
      if (!parsed) return;
      const ts = parsed.getTime();
      if (ts <= targetDate.getTime() && ts > nearestPastTime) {
        nearestPastTime = ts;
        nearestPastDate = dateKey;
      }
    });

    const carryRows = nearestPastDate ? normalizedInventoryByDate.get(nearestPastDate) || [] : [];
    const carryByProduct = new Map(carryRows.map((row) => [row.productId, row.end]));

    return products.map((product) => {
      const beg = carryByProduct.get(product.id) ?? 0;
      return {
        productId: product.id,
        beg,
        in: 0,
        total: beg,
        out: 0,
        end: beg,
      };
    });
  };

  const getProductById = (id: string): Product | undefined => {
    return products.find((p) => p.id === id);
  };

  const pushLocalActivity = (activity: string, productId?: string, productName?: string) => {
    if (!user) return;

    const newLog: ActivityLog = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      userId: user.id,
      timestamp: format(new Date(), "EEE, MMM d, yyyy h:mm a"),
      userName: user.name || user.username,
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
    const dbSnapshotDate = toDbDate(selectedDate);
    if (!dbSnapshotDate) {
      console.error("Invalid selectedDate for activity logging:", selectedDate);
      return;
    }

    await logDbActivity({
      snapshot_date: dbSnapshotDate,
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

  const addProduct = async (product: NewProductInput): Promise<boolean> => {
    const normalizedPrice = Math.max(0, Number(product.cost) || 0);
    const normalizedBeginningStock = Math.max(0, Math.floor(Number(product.beginningStock) || 0));
    const normalizedCategory = normalizeCategoryForSave(product.category);
    const normalizedSize = normalizeSizeForSave(product.size);

    if (supabaseConfigured) {
      try {
        const dbSnapshotDate = toDbDate(selectedDate);
        if (!dbSnapshotDate) {
          toast.error(`Invalid selected date: ${selectedDate}`);
          return false;
        }
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from("products")
          .insert({
            display_name: product.name,
            brand: product.brand || "",
            size: normalizedSize,
            category: normalizedCategory,
            price: normalizedPrice,
            image_url: null,
            archived: !!product.archived,
          })
          .select("id, display_name, brand, size, category, price, image_url, archived")
          .single();

        if (error) throw error;

        const inserted = data as ProductRow;
        let imageUrl: string | null = null;

        if (product.imageFile) {
          const extension = product.imageFile.type === "image/png" ? "png" : "jpg";
          const filePath = `products/${inserted.id}/${Date.now()}.${extension}`;
          const { error: uploadError } = await supabase.storage
            .from("product-images")
            .upload(filePath, product.imageFile, {
              cacheControl: "3600",
              upsert: true,
              contentType: product.imageFile.type,
            });

          if (uploadError) throw uploadError;

          const { data: publicUrlData } = supabase.storage
            .from("product-images")
            .getPublicUrl(filePath);
          imageUrl = publicUrlData.publicUrl;

          const { error: imageUpdateError } = await supabase
            .from("products")
            .update({ image_url: imageUrl })
            .eq("id", inserted.id);

          if (imageUpdateError) throw imageUpdateError;
        }

        const { error: snapshotError } = await supabase.from("inventory_snapshot").upsert(
          {
            product_id: inserted.id,
            snapshot_date: dbSnapshotDate,
            beginning_qty: normalizedBeginningStock,
            stock_in_qty: 0,
            stock_out_qty: 0,
            end_qty: normalizedBeginningStock,
          },
          { onConflict: "product_id,snapshot_date" }
        );

        if (snapshotError) throw snapshotError;

        const mapped = mapProductRow({
          ...inserted,
          price: normalizedPrice,
          image_url: imageUrl,
        });

        setProducts((prev) => [...prev, mapped]);
        setInventorySheets((prev) =>
          upsertLocalInventorySheet(prev, selectedDate, {
            productId: mapped.id,
            beg: normalizedBeginningStock,
            in: 0,
            total: normalizedBeginningStock,
            out: 0,
            end: normalizedBeginningStock,
          })
        );

        pushLocalActivity(`Added new product: ${product.name}`, mapped.id, product.name);
        await persistDbActivity("add_product", `Added new product: ${product.name}`, mapped.id, product.name);
        toast.success("Product added successfully");
        return true;
      } catch (err) {
        console.error("Failed to add product in Supabase:", err);
        toast.error("Failed to add product in Supabase");
        return false;
      }
    }

    toast.error("Supabase is not configured. Product was not saved.");
    return false;
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
          if (updates.size !== undefined) payload.size = normalizeSizeForSave(updates.size);
          if (updates.category !== undefined) payload.category = normalizeCategoryForSave(updates.category);
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
      } else {
        toast.error("Supabase is not configured. Product update was not saved.");
      }
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
      } else {
        toast.error("Supabase is not configured. Product delete was not saved.");
      }
    };

    void remove();
  };

  const updateDailyInventory = (date: string, productId: string, updates: Partial<DailyInventory>) => {
    const update = async () => {
      const dbSnapshotDate = toDbDate(date);
      if (!dbSnapshotDate) {
        toast.error(`Invalid selected date: ${date}`);
        return;
      }
      const existing = getInventoryForDate(date).find((item) => item.productId === productId);
      const baseBeginning = existing?.beg ?? 0;
      const base: DailyInventory = existing
        ? { ...existing, beg: baseBeginning }
        : { productId, beg: baseBeginning, in: 0, total: baseBeginning, out: 0, end: baseBeginning };

      const next: DailyInventory = {
        ...base,
        ...updates,
      };
      next.beg = baseBeginning;
      next.in = Math.max(0, next.in);
      next.total = next.beg + next.in;
      next.out = Math.max(0, Math.min(next.out, next.total));
      next.end = next.total - next.out;

      if (supabaseConfigured) {
        try {
          const supabase = getSupabase();
          const { error } = await supabase.from("inventory_snapshot").upsert(
            {
              product_id: productId,
              snapshot_date: dbSnapshotDate,
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
          const errorMessage =
            err && typeof err === "object" && "message" in err
              ? String((err as { message?: unknown }).message || "Unknown error")
              : "Unknown error";
          toast.error(`Failed to update inventory in Supabase: ${errorMessage}`);
          return;
        }
      } else {
        toast.error("Supabase is not configured. Inventory update was not saved.");
        return;
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

  const deleteAllProducts = async (): Promise<boolean> => {
    if (supabaseConfigured) {
      try {
        const supabase = getSupabase();

        // Remove dependent inventory rows first to avoid FK errors.
        const { error: snapshotDeleteError } = await supabase
          .from("inventory_snapshot")
          .delete()
          .neq("product_id", "");
        if (snapshotDeleteError) throw snapshotDeleteError;

        const { error: productDeleteError } = await supabase
          .from("products")
          .delete()
          .neq("id", "");
        if (productDeleteError) throw productDeleteError;
      } catch (err) {
        console.error("Failed to delete all products in Supabase:", err);
        const errorMessage =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: unknown }).message || "Unknown error")
            : "Unknown error";
        toast.error(`Failed to delete all products in Supabase: ${errorMessage}`);
        return false;
      }
    } else {
      toast.error("Supabase is not configured. Delete all was not saved.");
      return false;
    }

    setProducts([]);
    setInventorySheets([]);
    pushLocalActivity("Deleted all products");
    await persistDbActivity("delete_product", "Deleted all products");
    toast.success("All products deleted successfully");
    return true;
  };

  const exportData = (targetDates?: string[]) => {
    const requestedDates = (targetDates || []).filter((d) => d && d.trim().length > 0);
    const exportDates = requestedDates.length > 0 ? requestedDates : [selectedDate];

    const headers = [
      "Name",
      "Size",
      "category",
      "cost",
      "Beginning Inventory (Qty)",
      "Additional Stock In",
      "Total Stock in Warehouse",
      "Stock out from Warehouse",
      "Total End Stock",
    ];

    const escapeXml = (value: string): string =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    const buildCell = (value: string | number): string => {
      const stringValue = String(value);
      return `<Cell><Data ss:Type="String">${escapeXml(stringValue)}</Data></Cell>`;
    };

    const buildRow = (values: Array<string | number>): string => {
      return `<Row>${values.map((v) => buildCell(v)).join("")}</Row>`;
    };

    const usedSheetNames = new Set<string>();
    const buildSheetName = (dateValue: string): string => {
      const normalized = toDbDate(dateValue) || dateValue;
      let base = normalized.replace(/[:\\/?*\[\]]/g, "-").slice(0, 31) || "Sheet";
      let name = base;
      let counter = 2;
      while (usedSheetNames.has(name)) {
        const suffix = `-${counter}`;
        name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
        counter += 1;
      }
      usedSheetNames.add(name);
      return name;
    };

    const worksheetsXml = exportDates
      .map((exportDate) => {
        const inventoryForDate = getInventoryForDate(exportDate);
        const inventoryByProductId = new Map(inventoryForDate.map((item) => [item.productId, item]));
        const sheetName = buildSheetName(exportDate);

        const dataRows = products.map((product) => {
          const inv = inventoryByProductId.get(product.id);
          return buildRow([
            product.name,
            product.size,
            product.category,
            product.cost.toFixed(2),
            inv?.beg ?? 0,
            inv?.in ?? 0,
            inv?.total ?? 0,
            inv?.out ?? 0,
            inv?.end ?? 0,
          ]);
        });

        const tableRows = [buildRow(headers), ...dataRows].join("");
        return `<Worksheet ss:Name="${escapeXml(sheetName)}"><Table>${tableRows}</Table></Worksheet>`;
      })
      .join("");

    const workbookXml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 ${worksheetsXml}
</Workbook>`;

    const blob = new Blob([workbookXml], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tarzona-inventory-export-${exportDates.length}-sheet${exportDates.length > 1 ? "s" : ""}.xls`;
    a.click();
    URL.revokeObjectURL(url);

    const exportedDateLabels = exportDates.map((d) => toDbDate(d) || d).join(", ");
    pushLocalActivity(`Exported inventory data for ${exportedDateLabels}`);
    void persistDbActivity("export", `Exported inventory data for ${exportedDateLabels}`);
    toast.success(`Data exported successfully (${exportDates.length} sheet${exportDates.length > 1 ? "s" : ""})`);
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
        deleteAllProducts,
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
