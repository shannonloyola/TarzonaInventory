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

function enumerateInclusiveDbDates(startDbDate: string, endDbDate: string): string[] {
  const start = parse(startDbDate, dbDateFormat, new Date());
  const end = parse(endDbDate, dbDateFormat, new Date());
  if (!isValid(start) || !isValid(end)) return [];

  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const cursor = new Date(from);
  const values: string[] = [];

  while (cursor.getTime() <= to.getTime()) {
    values.push(format(cursor, dbDateFormat));
    cursor.setDate(cursor.getDate() + 1);
  }

  return values;
}

function isFutureUiDate(value: string): boolean {
  const parsed = parseFlexibleUiDate(value);
  if (!parsed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidate = new Date(parsed);
  candidate.setHours(0, 0, 0, 0);
  return candidate.getTime() > today.getTime();
}

function toNonNegativeInteger(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.floor(fallback));
  return Math.max(0, Math.floor(numeric));
}

function isStrictNonNegativeInteger(value: unknown): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isInteger(numeric) && numeric >= 0;
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
  const { user, isAuthReady } = useAuth();
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
    if (parsed && isFutureUiDate(date)) {
      toast.error("Future dates are not allowed for inventory operations.");
      return;
    }
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

  // Reset selected date to today only after auth is confirmed logged out.
  useEffect(() => {
    if (!isAuthReady || user) return;
    const today = todayUiDate();
    setSelectedDateState(today);
    localStorage.setItem(selectedDateStorageKey, today);
  }, [isAuthReady, user?.id]);

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

    const activeProducts = products.filter((product) => !product.archived);
    const knownProductIds = activeProducts.map((product) => product.id);
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

    return products
      .filter((product) => !product.archived)
      .map((product) => {
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
    qtyDelta?: number,
    beforeAfter?: {
      beforeBeginning?: number | null;
      afterBeginning?: number | null;
      beforeIn?: number | null;
      afterIn?: number | null;
      beforeOut?: number | null;
      afterOut?: number | null;
      beforeEnd?: number | null;
      afterEnd?: number | null;
    }
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
      before_beginning: beforeAfter?.beforeBeginning ?? null,
      after_beginning: beforeAfter?.afterBeginning ?? null,
      before_in: beforeAfter?.beforeIn ?? null,
      after_in: beforeAfter?.afterIn ?? null,
      before_out: beforeAfter?.beforeOut ?? null,
      after_out: beforeAfter?.afterOut ?? null,
      before_end: beforeAfter?.beforeEnd ?? null,
      after_end: beforeAfter?.afterEnd ?? null,
      note: activity,
    });
  };

  const logActivity = (activity: string, productId?: string, productName?: string) => {
    pushLocalActivity(activity, productId, productName);
    void persistDbActivity("edit_product", activity, productId, productName);
  };

  const addProduct = async (product: NewProductInput): Promise<boolean> => {
    const normalizedPrice = Math.max(0, Number(product.cost) || 0);
    if (!isStrictNonNegativeInteger(product.beginningStock)) {
      toast.error("Beginning stock must be a non-negative whole number.");
      return false;
    }
    const normalizedBeginningStock = toNonNegativeInteger(product.beginningStock, 0);
    const normalizedCategory = normalizeCategoryForSave(product.category);
    const normalizedSize = normalizeSizeForSave(product.size);

    if (supabaseConfigured) {
      try {
        const dbSnapshotDate = toDbDate(selectedDate);
        if (!dbSnapshotDate) {
          toast.error(`Invalid selected date: ${selectedDate}`);
          return false;
        }
        if (isFutureUiDate(selectedDate)) {
          toast.error("Future dates are not allowed for inventory operations.");
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
        await persistDbActivity(
          "add_product",
          `Added new product: ${product.name}`,
          mapped.id,
          product.name,
          undefined,
          {
            beforeBeginning: null,
            afterBeginning: normalizedBeginningStock,
            beforeIn: null,
            afterIn: 0,
            beforeOut: null,
            afterOut: 0,
            beforeEnd: null,
            afterEnd: normalizedBeginningStock,
          }
        );
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

  const updateProduct = async (id: string, updates: Partial<Product>): Promise<boolean> => {
    const current = getProductById(id);
    if (!current) return false;
    const beforeSnapshot = getInventoryForDate(selectedDate).find((item) => item.productId === id);

    if (!supabaseConfigured) {
      toast.error("Supabase is not configured. Product update was not saved.");
      return false;
    }

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
      await persistDbActivity("edit_product", activity, id, mapped.name, undefined, {
        beforeBeginning: beforeSnapshot?.beg ?? null,
        afterBeginning: beforeSnapshot?.beg ?? null,
        beforeIn: beforeSnapshot?.in ?? null,
        afterIn: beforeSnapshot?.in ?? null,
        beforeOut: beforeSnapshot?.out ?? null,
        afterOut: beforeSnapshot?.out ?? null,
        beforeEnd: beforeSnapshot?.end ?? null,
        afterEnd: beforeSnapshot?.end ?? null,
      });
      toast.success("Product updated successfully");
      return true;
    } catch (err) {
      console.error("Failed to update product in Supabase:", err);
      toast.error("Failed to update product in Supabase");
      return false;
    }
  };

  const deleteProduct = async (id: string): Promise<boolean> => {
    const product = getProductById(id);
    if (!product) return false;
    const beforeSnapshot = getInventoryForDate(selectedDate).find((item) => item.productId === id);

    if (!supabaseConfigured) {
      toast.error("Supabase is not configured. Product delete was not saved.");
      return false;
    }

    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
      setProducts((prev) => prev.filter((p) => p.id !== id));
      setInventorySheets((prev) =>
        prev
          .map((sheet) => ({
            ...sheet,
            items: sheet.items.filter((item) => item.productId !== id),
          }))
          .filter((sheet) => sheet.items.length > 0)
      );
      pushLocalActivity(`Deleted product: ${product.name}`, id, product.name);
      await persistDbActivity("delete_product", `Deleted product: ${product.name}`, id, product.name, undefined, {
        beforeBeginning: beforeSnapshot?.beg ?? null,
        afterBeginning: null,
        beforeIn: beforeSnapshot?.in ?? null,
        afterIn: null,
        beforeOut: beforeSnapshot?.out ?? null,
        afterOut: null,
        beforeEnd: beforeSnapshot?.end ?? null,
        afterEnd: null,
      });
      return true;
    } catch (err) {
      console.error("Failed to delete product in Supabase:", err);
      toast.error("Failed to delete product in Supabase");
      return false;
    }
  };

  const updateDailyInventory = async (
    date: string,
    productId: string,
    updates: Partial<DailyInventory>
  ): Promise<boolean> => {
    if (isFutureUiDate(date)) {
      toast.error("Future dates are not allowed for inventory operations.");
      return false;
    }

    const product = getProductById(productId);
    if (!product) return false;
    if (product.archived) {
      toast.error("Archived products are excluded from active inventory updates.");
      return false;
    }

    const dbSnapshotDate = toDbDate(date);
    if (!dbSnapshotDate) {
      toast.error(`Invalid selected date: ${date}`);
      return false;
    }

    const existing = getInventoryForDate(date).find((item) => item.productId === productId);
    const baseBeginning = existing?.beg ?? 0;
    const base: DailyInventory = existing
      ? { ...existing, beg: baseBeginning }
      : { productId, beg: baseBeginning, in: 0, total: baseBeginning, out: 0, end: baseBeginning };

    if (updates.beg !== undefined && !isStrictNonNegativeInteger(updates.beg)) {
      toast.error("Beginning stock must be a non-negative whole number.");
      return false;
    }
    if (updates.in !== undefined && !isStrictNonNegativeInteger(updates.in)) {
      toast.error("Stock-in must be a non-negative whole number.");
      return false;
    }
    if (updates.out !== undefined && !isStrictNonNegativeInteger(updates.out)) {
      toast.error("Stock-out must be a non-negative whole number.");
      return false;
    }

    const requestedIn = toNonNegativeInteger(updates.in ?? base.in, base.in);
    const requestedOut = toNonNegativeInteger(updates.out ?? base.out, base.out);
    const requestedBeg = toNonNegativeInteger(updates.beg ?? base.beg, base.beg);

    const next: DailyInventory = {
      ...base,
      ...updates,
      beg: requestedBeg,
      in: requestedIn,
      out: requestedOut,
      total: 0,
      end: 0,
    };
    next.total = next.beg + next.in;
    next.out = Math.max(0, Math.min(next.out, next.total));
    next.end = next.total - next.out;

    if (!supabaseConfigured) {
      toast.error("Supabase is not configured. Inventory update was not saved.");
      return false;
    }

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
      return false;
    }

    setInventorySheets((prev) => upsertLocalInventorySheet(prev, date, next));

    const beforeBeg = existing?.beg || 0;
    const beforeIn = existing?.in || 0;
    const beforeOut = existing?.out || 0;
    const changedBeg = next.beg !== beforeBeg;
    const changedIn = next.in !== beforeIn;
    const changedOut = next.out !== beforeOut;
    const changedCount = Number(changedBeg) + Number(changedIn) + Number(changedOut);

    let activityStr = `Updated inventory for ${product.name || "Unknown"}`;
    let txnType: TransactionType = "edit_product";
    let qtyDelta: number | undefined = undefined;

    if (changedCount === 1 && changedIn) {
      activityStr = `Updated stock IN for ${product.name || "Unknown"}`;
      txnType = "stock_in";
      qtyDelta = next.in - beforeIn;
    } else if (changedCount === 1 && changedOut) {
      activityStr = `Updated stock OUT for ${product.name || "Unknown"}`;
      txnType = "stock_out";
      qtyDelta = next.out - beforeOut;
    } else if (changedCount === 1 && changedBeg) {
      activityStr = `Updated beginning inventory for ${product.name || "Unknown"}`;
      txnType = "beginning_set";
      qtyDelta = next.beg - beforeBeg;
    }

    pushLocalActivity(activityStr, productId, product.name);
    await persistDbActivity(txnType, activityStr, productId, product.name, qtyDelta, {
      beforeBeginning: existing?.beg ?? null,
      afterBeginning: next.beg,
      beforeIn: existing?.in ?? null,
      afterIn: next.in,
      beforeOut: existing?.out ?? null,
      afterOut: next.out,
      beforeEnd: existing?.end ?? null,
      afterEnd: next.end,
    });
    toast.success("Inventory updated successfully");
    return true;
  };

  const archiveProduct = async (id: string): Promise<boolean> => {
    const product = getProductById(id);
    if (!product) return false;
    if (product.archived) return true;

    const beforeSnapshot = getInventoryForDate(selectedDate).find((item) => item.productId === id);

    if (!supabaseConfigured) {
      toast.error("Supabase is not configured. Product archive was not saved.");
      return false;
    }

    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("products")
        .update({ archived: true })
        .eq("id", id)
        .select("id, display_name, brand, size, category, price, image_url, archived")
        .single();

      if (error) throw error;
      const mapped = mapProductRow(data as ProductRow);
      setProducts((prev) => prev.map((p) => (p.id === id ? mapped : p)));

      const activity = `Archived product: ${mapped.name}`;
      pushLocalActivity(activity, id, mapped.name);
      await persistDbActivity("archive_product", activity, id, mapped.name, undefined, {
        beforeBeginning: beforeSnapshot?.beg ?? null,
        afterBeginning: beforeSnapshot?.beg ?? null,
        beforeIn: beforeSnapshot?.in ?? null,
        afterIn: beforeSnapshot?.in ?? null,
        beforeOut: beforeSnapshot?.out ?? null,
        afterOut: beforeSnapshot?.out ?? null,
        beforeEnd: beforeSnapshot?.end ?? null,
        afterEnd: beforeSnapshot?.end ?? null,
      });
      return true;
    } catch (err) {
      console.error("Failed to archive product in Supabase:", err);
      toast.error("Failed to archive product in Supabase");
      return false;
    }
  };

  const archiveAllProducts = async (): Promise<boolean> => {
    if (!supabaseConfigured) {
      toast.error("Supabase is not configured. Archive all was not saved.");
      return false;
    }

    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("products").update({ archived: true }).eq("archived", false);
      if (error) throw error;
    } catch (err) {
      console.error("Failed to archive all products in Supabase:", err);
      toast.error("Failed to archive all products in Supabase");
      return false;
    }

    setProducts((prev) => prev.map((p) => ({ ...p, archived: true })));
    pushLocalActivity("Archived all products");
    await persistDbActivity("archive_all", "Archived all products", undefined, undefined, undefined, {
      beforeBeginning: null,
      afterBeginning: null,
      beforeIn: null,
      afterIn: null,
      beforeOut: null,
      afterOut: null,
      beforeEnd: null,
      afterEnd: null,
    });
    toast.success("All products archived");
    return true;
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
    await persistDbActivity("delete_all", "Deleted all products");
    toast.success("All products deleted successfully");
    return true;
  };

  const exportData = (
    options?:
      | string[]
      | {
          targetDates?: string[];
          rangeStart?: string;
          rangeEnd?: string;
          mode?: "all_active_products" | "movement_only";
        }
  ) => {
    const exportMode =
      typeof options === "object" && options !== null && !Array.isArray(options)
        ? options.mode || "all_active_products"
        : "all_active_products";
    const requestedDatesRaw =
      Array.isArray(options)
        ? options
        : (options?.targetDates || []);

    const normalizedRequestedDates = requestedDatesRaw
      .map((d) => toDbDate(d) || d)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

    const rangeStartDb =
      typeof options === "object" && options !== null && !Array.isArray(options)
        ? toDbDate(options.rangeStart || "") || options.rangeStart || ""
        : "";
    const rangeEndDb =
      typeof options === "object" && options !== null && !Array.isArray(options)
        ? toDbDate(options.rangeEnd || "") || options.rangeEnd || ""
        : "";

    const rangeDates =
      rangeStartDb && rangeEndDb
        ? enumerateInclusiveDbDates(rangeStartDb, rangeEndDb)
        : [];
    const exportDbDates =
      rangeDates.length > 0
        ? rangeDates
        : normalizedRequestedDates.length > 0
        ? normalizedRequestedDates
        : [toDbDate(selectedDate) || format(new Date(), dbDateFormat)];
    const exportDates = exportDbDates.map((dbDate) => toUiDate(dbDate));

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
        const activeProducts = products.filter((product) => !product.archived);
        const sheetProducts =
          exportMode === "movement_only"
            ? activeProducts.filter((product) => {
                const inv = inventoryByProductId.get(product.id);
                return !!inv && (inv.in > 0 || inv.out > 0);
              })
            : activeProducts;

        const dataRows = sheetProducts.map((product) => {
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

    const exportedDateLabels = exportDbDates.join(", ");
    const modeLabel = exportMode === "movement_only" ? "Movement Only" : "All Active Products";
    pushLocalActivity(`Exported inventory data (${modeLabel}) for ${exportedDateLabels}`);
    void persistDbActivity("export", `Exported inventory data (${modeLabel}) for ${exportedDateLabels}`);
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
