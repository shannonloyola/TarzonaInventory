import { useState, useMemo, useEffect, useRef } from "react";
import { Search, ChevronDown, X, Download, ImageIcon } from "lucide-react";
import { useInventory } from "../context/inventory-context";
import { ActivityLog } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { CurrentDateTime } from "../components/current-datetime";
import { getSupabase, isSupabaseConfigured } from "../../lib/supabase";
import { toast } from "sonner";
import { useAuth } from "../context/auth-context";
import { formatDateForDB, logActivity as logDbActivity } from "../../lib/db-utils";

type UserOption = {
  id: string;
  fullName: string;
  email: string;
};

export function ActivityLogPage() {
  const { activityLogs, getProductById } = useInventory();
  const { user, isAdmin, hasPermission } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"Newest First" | "Oldest">("Newest First");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportMode, setExportMode] = useState<"date" | "user" | "custom" | "range">("date");
  const [exportDate, setExportDate] = useState("");
  const [exportRangeStart, setExportRangeStart] = useState("");
  const [exportRangeEnd, setExportRangeEnd] = useState("");
  const [exportUserId, setExportUserId] = useState("all");
  const [exportFilterByUser, setExportFilterByUser] = useState(false);
  const [isHeaderCompact, setIsHeaderCompact] = useState(false);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const canExportActivity = isAdmin || hasPermission("exportData");

  useEffect(() => {
    const updateCompactState = () => {
      const containerScrollTop = mainScrollRef.current?.scrollTop || 0;
      const shouldCompact = window.scrollY > 12 || containerScrollTop > 12;
      setIsHeaderCompact((prev) => (prev === shouldCompact ? prev : shouldCompact));
    };

    const container = mainScrollRef.current;
    window.addEventListener("scroll", updateCompactState, { passive: true });
    container?.addEventListener("scroll", updateCompactState, { passive: true });
    updateCompactState();

    return () => {
      window.removeEventListener("scroll", updateCompactState);
      container?.removeEventListener("scroll", updateCompactState);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabase();

    const loadUsers = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Failed to load users for activity log filter:", error);
        return;
      }

      const mapped = (data || []).map((row) => {
        const profile = row as { id: string; full_name: string | null; email: string | null };
        return {
          id: profile.id,
          fullName: profile.full_name || "Unknown",
          email: profile.email || "",
        };
      });
      setUserOptions(mapped);
    };

    void loadUsers();

    const channel = supabase
      .channel("activity-log-users-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void loadUsers();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const dedupedLogs = useMemo(
    () => Array.from(new Map(activityLogs.map((log) => [log.id, log])).values()),
    [activityLogs]
  );

  const filteredLogs = useMemo(() => {
    const uniqueLogs = dedupedLogs;

    return uniqueLogs
      .filter((log) => {
        const query = searchQuery.toLowerCase();
        const matchesUser = userFilter === "all" || log.userId === userFilter;
        if (!matchesUser) return false;
        return (
          log.userName.toLowerCase().includes(query) ||
          log.userEmail.toLowerCase().includes(query) ||
          log.activity.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        if (sortBy === "Oldest") {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        }
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
  }, [dedupedLogs, searchQuery, sortBy, userFilter]);

  const handleRowClick = (log: ActivityLog) => {
    if (log.productId) setSelectedLog(log);
  };

  const toIsoDate = (value: string): string | null => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const exportActivityLogs = () => {
    if (!canExportActivity) {
      toast.error("You do not have permission to export activity logs.");
      return;
    }

    const inRange = (isoDate: string, start: string, end: string) =>
      isoDate >= start && isoDate <= end;

    const rows = dedupedLogs.filter((log) => {
      if (exportMode === "date") {
        if (!exportDate) return false;
        const logIsoDate = toIsoDate(log.timestamp);
        if (logIsoDate !== exportDate) return false;
        if (!exportFilterByUser) return true;
        if (exportUserId === "all") return false;
        return log.userId === exportUserId;
      }
      if (exportMode === "range") {
        if (!exportRangeStart || !exportRangeEnd) return false;
        const logIsoDate = toIsoDate(log.timestamp);
        if (!logIsoDate) return false;
        const start = exportRangeStart <= exportRangeEnd ? exportRangeStart : exportRangeEnd;
        const end = exportRangeStart <= exportRangeEnd ? exportRangeEnd : exportRangeStart;
        if (!inRange(logIsoDate, start, end)) return false;
        if (!exportFilterByUser) return true;
        if (exportUserId === "all") return false;
        return log.userId === exportUserId;
      }
      if (exportMode === "custom") {
        if (!exportDate || exportUserId === "all") return false;
        const logIsoDate = toIsoDate(log.timestamp);
        return logIsoDate === exportDate && log.userId === exportUserId;
      }
      if (exportUserId === "all") return true;
      return log.userId === exportUserId;
    });

    if (rows.length === 0) {
      toast.info("No activity log data found for the selected export filter.");
      return;
    }

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

    const byDate = new Map<string, ActivityLog[]>();
    rows.forEach((row) => {
      const isoDate = toIsoDate(row.timestamp) || "Unknown-Date";
      const list = byDate.get(isoDate) || [];
      list.push(row);
      byDate.set(isoDate, list);
    });

    const headers = ["Date & Time", "Name", "Email", "Role", "Activity", "Product"];
    const usedSheetNames = new Set<string>();
    const buildSheetName = (dateValue: string): string => {
      const base = (dateValue || "Sheet").replace(/[:\\/?*\[\]]/g, "-").slice(0, 31) || "Sheet";
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

    const worksheetXml = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, dateRows]) => {
        const sheetName = buildSheetName(dateKey);
        const bodyRows = dateRows
          .map((log) =>
            buildRow([
              log.timestamp,
              log.userName,
              log.userEmail,
              log.userRole,
              log.activity,
              log.productName || "",
            ])
          )
          .join("");

        return `<Worksheet ss:Name="${escapeXml(sheetName)}"><Table>${buildRow(headers)}${bodyRows}</Table></Worksheet>`;
      })
      .join("");

    const workbookXml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 ${worksheetXml}
</Workbook>`;

    const blob = new Blob([workbookXml], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      exportMode === "date"
        ? `activity-log-date-${exportDate || "date"}.xls`
        : exportMode === "range"
        ? `activity-log-range-${exportRangeStart || "start"}-${exportRangeEnd || "end"}.xls`
        : exportMode === "user"
        ? `activity-log-user-${exportUserId === "all" ? "all" : exportUserId}.xls`
        : `activity-log-custom-${exportDate || "date"}-${exportUserId}.xls`;
    a.click();
    URL.revokeObjectURL(url);

    if (user) {
      void logDbActivity({
        snapshot_date: formatDateForDB(new Date()),
        actor_profile_id: user.id,
        actor_username: user.username,
        actor_role: user.role.toLowerCase(),
        txn_type: "export",
        note: `Exported activity log (${rows.length} rows, ${byDate.size} sheet${byDate.size > 1 ? "s" : ""})`,
      });
    }

    setShowExportModal(false);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <div ref={mainScrollRef} className="flex-1 ml-16 p-6 overflow-y-auto bg-gray-50">
        <div>
          <div className={isHeaderCompact ? "mb-5" : "mb-6"}>
            {isHeaderCompact && <div className="h-[56px]" aria-hidden="true" />}
            <div
              className={`${isHeaderCompact ? "transition-all duration-200" : "transition-none"} ${
                isHeaderCompact
                  ? `fixed top-0 left-16 z-40 px-6 py-2 border-b border-gray-200 bg-gray-50/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/85 ${
                      selectedLog ? "right-80" : "right-0"
                    }`
                  : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h1 className={`font-bold text-gray-900 ${isHeaderCompact ? "text-xl mb-0" : "text-2xl mb-1"}`}>
                    Activity Log
                  </h1>
                  {!isHeaderCompact && (
                    <p className="text-sm text-gray-500">Track all system activities and changes</p>
                  )}
                </div>
                {!selectedLog && <CurrentDateTime className={isHeaderCompact ? "!px-2.5 !py-1.5 !gap-2" : "text-xs text-gray-500"} />}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Quick Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500 w-64"
              />
            </div>

            <div className="relative flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => {
                    setShowUserDropdown((prev) => !prev);
                    setShowSortDropdown(false);
                  }}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 bg-white"
                >
                  {userFilter === "all"
                    ? "All Users"
                    : userOptions.find((u) => u.id === userFilter)?.fullName || "Selected User"}
                  <ChevronDown className="w-4 h-4" />
                </button>
                {showUserDropdown && (
                  <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded shadow-lg z-10 min-w-[260px] max-h-72 overflow-y-auto">
                    <button
                      onClick={() => {
                        setUserFilter("all");
                        setShowUserDropdown(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      All Users
                    </button>
                    {userOptions.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => {
                          setUserFilter(user.id);
                          setShowUserDropdown(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        <div className="font-medium text-gray-900">{user.fullName}</div>
                        <div className="text-xs text-gray-500">{user.email}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => {
                    setShowSortDropdown((prev) => !prev);
                    setShowUserDropdown(false);
                  }}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 bg-white"
                >
                  {sortBy}
                  <ChevronDown className="w-4 h-4" />
                </button>
                {showSortDropdown && (
                  <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded shadow-lg z-10 min-w-[150px]">
                    <button
                      onClick={() => {
                        setSortBy("Newest First");
                        setShowSortDropdown(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      Newest First
                    </button>
                    <button
                      onClick={() => {
                        setSortBy("Oldest");
                        setShowSortDropdown(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                    >
                      Oldest
                    </button>
                  </div>
                )}
              </div>

              {canExportActivity && (
                <button
                  onClick={() => setShowExportModal(true)}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 bg-white"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-gray-300 rounded overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-300">
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-600">Date & Time</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-600">Name</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-600">Email</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-600">Role</th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-600">Activity</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const isSelected = selectedLog?.id === log.id;
                  const hasProduct = Boolean(log.productId);

                  return (
                    <tr
                      key={log.id}
                      onClick={() => handleRowClick(log)}
                      className={`border-b border-gray-200 transition-colors ${
                        hasProduct ? "cursor-pointer" : ""
                      } ${isSelected ? "bg-blue-50" : hasProduct ? "hover:bg-gray-50" : ""}`}
                    >
                      <td className="py-3 px-4 text-xs text-gray-600">{log.timestamp}</td>
                      <td className="py-3 px-4 text-sm text-gray-900">{log.userName}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">{log.userEmail}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs ${
                            log.userRole === "Admin"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {log.userRole.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-900">{log.activity}</td>
                    </tr>
                  );
                })}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-10 px-4 text-center text-sm text-gray-500"
                    >
                      No activity log found for the selected filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showExportModal && (
        <div className="fixed inset-0 bg-white/15 backdrop-blur-[2px] flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 border border-gray-200 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Export Activity Log</h3>
            <p className="text-sm text-gray-600 mb-4">
              Choose how you want to export the activity log.
            </p>

            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={exportMode === "date"}
                    onChange={() => setExportMode("date")}
                  />
                  Per Date
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={exportMode === "user"}
                    onChange={() => setExportMode("user")}
                  />
                  Per User
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={exportMode === "custom"}
                    onChange={() => setExportMode("custom")}
                  />
                  Custom
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={exportMode === "range"}
                    onChange={() => setExportMode("range")}
                  />
                  Date Range
                </label>
              </div>

              {exportMode === "date" && (
                <div className="space-y-3">
                  <label className="text-xs text-gray-500 mb-1 block">Select Date</label>
                  <input
                    type="date"
                    value={exportDate}
                    onChange={(e) => setExportDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={exportFilterByUser}
                      onChange={(e) => setExportFilterByUser(e.target.checked)}
                    />
                    Filter by user
                  </label>
                  {exportFilterByUser && (
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Select User</label>
                      <div className="relative">
                        <select
                          value={exportUserId}
                          onChange={(e) => setExportUserId(e.target.value)}
                          className="w-full h-10 px-3 pr-9 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500 appearance-none"
                        >
                          <option value="all">Select specific user</option>
                          {userOptions.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.fullName} {user.email ? `(${user.email})` : ""}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {exportMode === "user" && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Select User</label>
                  <div className="relative">
                    <select
                      value={exportUserId}
                      onChange={(e) => setExportUserId(e.target.value)}
                      className="w-full h-10 px-3 pr-9 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500 appearance-none"
                    >
                      <option value="all">All Users</option>
                      {userOptions.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.fullName} {user.email ? `(${user.email})` : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  </div>
                </div>
              )}

              {exportMode === "custom" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Select Date</label>
                    <input
                      type="date"
                      value={exportDate}
                      onChange={(e) => setExportDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Select User</label>
                    <div className="relative">
                      <select
                        value={exportUserId}
                        onChange={(e) => setExportUserId(e.target.value)}
                        className="w-full h-10 px-3 pr-9 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500 appearance-none"
                      >
                        <option value="all">Select specific user</option>
                        {userOptions.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.fullName} {user.email ? `(${user.email})` : ""}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    </div>
                  </div>
                </div>
              )}

              {exportMode === "range" && (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Start Date</label>
                    <input
                      type="date"
                      value={exportRangeStart}
                      onChange={(e) => setExportRangeStart(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">End Date</label>
                    <input
                      type="date"
                      value={exportRangeEnd}
                      onChange={(e) => setExportRangeEnd(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={exportFilterByUser}
                      onChange={(e) => setExportFilterByUser(e.target.checked)}
                    />
                    Filter by user
                  </label>
                  {exportFilterByUser && (
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Select User</label>
                      <div className="relative">
                        <select
                          value={exportUserId}
                          onChange={(e) => setExportUserId(e.target.value)}
                          className="w-full h-10 px-3 pr-9 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-500 appearance-none"
                        >
                          <option value="all">Select specific user</option>
                          {userOptions.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.fullName} {user.email ? `(${user.email})` : ""}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowExportModal(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={exportActivityLogs}
                className="flex-1 px-4 py-2 bg-[#8B2E2E] text-white rounded text-sm hover:bg-[#B23A3A]"
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {(() => {
        const relatedProduct =
          selectedLog?.productId ? getProductById(selectedLog.productId) : undefined;
        const relatedProductImage = relatedProduct?.imageUrl;
        return (
      <AnimatePresence>
        {selectedLog && selectedLog.productId && (
          <motion.div
            className="fixed right-0 top-0 bottom-0 w-80 bg-[#2d2d2d] text-white shadow-2xl z-50 flex flex-col"
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            transition={{ duration: 0.3 }}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-700">
              <h2 className="text-sm font-semibold tracking-wider">RELATED PRODUCT</h2>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              <div className="w-40 h-40 bg-white rounded-[20px] mx-auto flex items-center justify-center shadow-lg">
                {relatedProductImage ? (
                  <img
                    src={relatedProductImage}
                    alt={selectedLog.productName || "Related product"}
                    className="w-full h-full object-cover rounded-[20px]"
                  />
                ) : (
                  <ImageIcon className="w-16 h-16 text-gray-300" />
                )}
              </div>
              <div className="space-y-5 text-sm">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Product Name</p>
                  <p className="text-white font-medium">{selectedLog.productName || "N/A"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Activity</p>
                  <p className="text-white font-medium">{selectedLog.activity}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">User</p>
                  <p className="text-white font-medium">{selectedLog.userName}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Date & Time</p>
                  <p className="text-white font-medium">{selectedLog.timestamp}</p>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-700">
              <button
                onClick={() => setSelectedLog(null)}
                className="w-full py-3 bg-white text-gray-900 rounded-xl font-semibold hover:bg-gray-100 transition-all duration-200 uppercase text-sm"
              >
                CLOSE
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
        );
      })()}
    </div>
  );
}
