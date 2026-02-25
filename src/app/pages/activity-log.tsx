import { useState, useMemo } from "react";
import { Search, ChevronDown, X } from "lucide-react";
import { useInventory } from "../context/inventory-context";
import { ActivityLog } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { CurrentDateTime } from "../components/current-datetime";

export function ActivityLogPage() {
  const { activityLogs } = useInventory();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterBy, setFilterBy] = useState("Newest First");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);

  // Filter and sort logs with deduplication
  const filteredLogs = useMemo(() => {
    // First deduplicate by ID
    const uniqueLogs = Array.from(
      new Map(activityLogs.map(log => [log.id, log])).values()
    );

    return uniqueLogs
      .filter((log) => {
        const query = searchQuery.toLowerCase();
        return (
          log.userName.toLowerCase().includes(query) ||
          log.userEmail.toLowerCase().includes(query) ||
          log.activity.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        // Sort based on filter
        if (filterBy === "Oldest") {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        } else if (filterBy === "Newest First") {
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        } else if (filterBy === "A-Z") {
          return a.userName.localeCompare(b.userName);
        }
        return 0;
      });
  }, [activityLogs, searchQuery, filterBy]);

  const handleRowClick = (log: ActivityLog) => {
    if (log.productId) {
      setSelectedLog(log);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Main Content */}
      <div className="flex-1 ml-16 p-6 overflow-y-auto bg-gray-50">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">Activity Log</h1>
              <p className="text-sm text-gray-500">Track all system activities and changes</p>
            </div>
            {!selectedLog && <CurrentDateTime className="text-xs text-gray-500" />}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between mb-4">
            {/* Search */}
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

            {/* Filter Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50 bg-white"
              >
                {filterBy}
                <ChevronDown className="w-4 h-4" />
              </button>
              {showFilterDropdown && (
                <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded shadow-lg z-10 min-w-[150px]">
                  <button
                    onClick={() => {
                      setFilterBy("Oldest");
                      setShowFilterDropdown(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    Oldest
                  </button>
                  <button
                    onClick={() => {
                      setFilterBy("A-Z");
                      setShowFilterDropdown(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    A-Z
                  </button>
                  <button
                    onClick={() => {
                      setFilterBy("Newest First");
                      setShowFilterDropdown(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    Newest First
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-gray-300 rounded overflow-hidden shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-300">
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-600">
                    Date & Time
                  </th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-600">
                    Name
                  </th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-600">
                    Email
                  </th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-600">
                    Role
                  </th>
                  <th className="text-left py-2 px-4 text-xs font-bold text-gray-600">
                    Activity
                  </th>
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
                      <td className="py-3 px-4 text-xs text-gray-600">
                        {log.timestamp}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-900">
                        {log.userName}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {log.userEmail}
                      </td>
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
                      <td className="py-3 px-4 text-sm text-gray-900">
                        {log.activity}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right Panel - Related Product (Overlay when selected) */}
      <AnimatePresence>
        {selectedLog && selectedLog.productId && (
          <motion.div
            className="fixed right-0 top-0 bottom-0 w-80 bg-[#2d2d2d] text-white shadow-2xl z-50 flex flex-col"
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            transition={{ duration: 0.3 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-700">
              <h2 className="text-sm font-semibold tracking-wider">RELATED PRODUCT</h2>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              {/* Product Image */}
              <div className="w-40 h-40 bg-white rounded-[20px] mx-auto flex items-center justify-center shadow-lg">
                <div className="w-24 h-32 bg-orange-400 rounded"></div>
              </div>

              {/* Product Details */}
              <div className="space-y-5 text-sm">
                <div>
                  <p className="text-xs text-gray-400 mb-1">Product Name</p>
                  <p className="text-white font-medium">{selectedLog.productName || "N/A"}</p>
                </div>
                {/* Note: In a real app we'd fetch product details by ID, but log might have snapshots or we fetch live */}
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

            {/* Footer Button */}
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
    </div>
  );
}