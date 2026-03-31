import { useState, useEffect, useMemo, useRef } from "react";
import { SquareArrowRight, SquareArrowLeft, ExternalLink, ChevronDown, X } from "lucide-react";
import { useInventory } from "../context/inventory-context";
import { format, getDaysInMonth, startOfMonth, getDay, parse, addMonths, subMonths, startOfDay, isBefore, isAfter, isValid } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { CurrentDateTime } from "../components/current-datetime";
import { LowStockAlert } from "../components/low-stock-alert";

type MetricType = "products" | "items" | "stockIn" | "stockOut" | null;
type DashboardViewMode = "selected-date" | "monthly" | "yearly";

type TrendItem = {
  productId: string;
  productName: string;
  productSize: string;
  totalStockOut: number;
  movementDays: number;
  lastMovementDate: Date | null;
};

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

export function DashboardPage() {
  const { products, inventorySheets, getInventoryForDate, selectedDate, setSelectedDate } = useInventory();
  
  // Parse selected date
  const parsedSelectedDate = parseUiDate(selectedDate) || new Date();
  const selectedDateLabel = format(parsedSelectedDate, "MMMM d, yyyy");
  
  // State for calendar navigation
  const [calendarMonth, setCalendarMonth] = useState(parsedSelectedDate);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!parsedSelectedDate) return;
    setCalendarMonth(parsedSelectedDate);
  }, [selectedDate]);
  
  // Generate year and month options
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const years = Array.from({ length: 10 }, (_, i) => currentYear - i); // Last 10 years
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  // Calculate metrics based on SELECTED DATE
  const activeProducts = products.filter((p) => !p.archived);
  const activeProductIds = new Set(activeProducts.map((p) => p.id));
  const totalProducts = activeProducts.length;
  
  const currentInventory = getInventoryForDate(selectedDate).filter((item) =>
    activeProductIds.has(item.productId)
  );
  const totalItems = currentInventory.reduce((sum, item) => sum + item.end, 0);
  const totalStockIn = currentInventory.reduce((sum, item) => sum + item.in, 0);
  const totalStockOut = currentInventory.reduce((sum, item) => sum + item.out, 0);

  // Calendar data
  const displayDate = calendarMonth; 
  const daysInMonth = getDaysInMonth(displayDate);
  const firstDayOfMonth = getDay(startOfMonth(displayDate));
  const monthYear = format(displayDate, "MMMM yyyy").toUpperCase();
  const today = startOfDay(new Date());

  const handleDateClick = (day: number) => {
    const clickedDate = new Date(displayDate.getFullYear(), displayDate.getMonth(), day);
    const clickedDateStart = startOfDay(clickedDate);
    
    // Only allow clicking on today or past dates
    if (isAfter(clickedDateStart, today)) {
      return; // Don't allow future dates
    }
    
    const dateStr = `${format(displayDate, "M")}-${day}-${format(displayDate, "yyyy")}`;
    setSelectedDate(dateStr);
  };

  const handlePreviousMonth = () => {
    setCalendarMonth(subMonths(calendarMonth, 1));
  };

  const handleNextMonth = () => {
    const nextMonth = addMonths(calendarMonth, 1);
    const nextMonthStart = startOfMonth(nextMonth);
    
    // Only allow navigation if next month is not entirely in the future
    if (!isAfter(nextMonthStart, today)) {
      setCalendarMonth(nextMonth);
    }
  };

  const [isViewAllOpen, setIsViewAllOpen] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<MetricType>(null);
  const [isExpandModalOpen, setIsExpandModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<DashboardViewMode>("selected-date");
  const [isHeaderCompact, setIsHeaderCompact] = useState(false);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);

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
    if (!isMonthPickerOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!monthPickerRef.current?.contains(target)) {
        setIsMonthPickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isMonthPickerOpen]);

  // Calculate low stock items (end <= 20% of beginning)
  const lowStockItems = currentInventory
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

  const trendPeriodLabel = useMemo(() => {
    if (viewMode === "monthly") return format(parsedSelectedDate, "MMMM yyyy");
    if (viewMode === "yearly") return format(parsedSelectedDate, "yyyy");
    return format(parsedSelectedDate, "MMMM d, yyyy");
  }, [viewMode, selectedDate]);

  const trendSummary = useMemo(() => {
    const anchorDate = parseUiDate(selectedDate) || new Date();
    const isInScope = (date: Date): boolean => {
      if (viewMode === "monthly") {
        return (
          date.getFullYear() === anchorDate.getFullYear() &&
          date.getMonth() === anchorDate.getMonth()
        );
      }
      if (viewMode === "yearly") {
        return date.getFullYear() === anchorDate.getFullYear();
      }
      return (
        date.getFullYear() === anchorDate.getFullYear() &&
        date.getMonth() === anchorDate.getMonth() &&
        date.getDate() === anchorDate.getDate()
      );
    };

    const byProduct = new Map<string, TrendItem>();
    activeProducts.forEach((product) => {
        byProduct.set(product.id, {
          productId: product.id,
          productName: product.name,
          productSize: product.size,
          totalStockOut: 0,
          movementDays: 0,
          lastMovementDate: null,
        });
    });

    inventorySheets.forEach((sheet) => {
      const parsedSheetDate = parseUiDate(sheet.date);
      if (!parsedSheetDate || !isInScope(parsedSheetDate)) return;

      sheet.items.forEach((item) => {
        if (!activeProductIds.has(item.productId)) return;
        const trendItem = byProduct.get(item.productId);
        if (!trendItem) return;

        const stockOut = Math.max(0, Number(item.out || 0));
        trendItem.totalStockOut += stockOut;
        if (stockOut > 0) {
          trendItem.movementDays += 1;
          if (!trendItem.lastMovementDate || parsedSheetDate > trendItem.lastMovementDate) {
            trendItem.lastMovementDate = parsedSheetDate;
          }
        }
      });
    });

    const all = Array.from(byProduct.values());
    const fastMoving = all
      .filter((item) => item.totalStockOut > 0)
      .sort((a, b) => b.totalStockOut - a.totalStockOut || b.movementDays - a.movementDays)
      .slice(0, 5);
    const slowMoving = all
      .filter((item) => item.totalStockOut > 0)
      .sort((a, b) => a.totalStockOut - b.totalStockOut || a.movementDays - b.movementDays)
      .slice(0, 5);
    const nonMoving = all.filter((item) => item.totalStockOut === 0).slice(0, 5);

    return { fastMoving, slowMoving, nonMoving };
  }, [inventorySheets, activeProducts, selectedDate, viewMode]);

  // Get top products for overview panel
  const getTopProducts = () => {
    const limit = selectedMetric === "stockIn" || selectedMetric === "stockOut" ? 5 : 7;
    if (selectedMetric === "products") {
      // For products, just show distinct products (doesn't matter which data)
      return currentInventory
        .map(item => {
          const product = activeProducts.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            size: product?.size || "",
            quantity: item.end
          };
        })
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit);
    } else if (selectedMetric === "items") {
      // For items, show by end stock quantity
      return currentInventory
        .map(item => {
          const product = activeProducts.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            size: product?.size || "",
            quantity: item.end
          };
        })
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit);
    } else if (selectedMetric === "stockIn") {
      // For stock in, show by "in" value
      return currentInventory
        .filter(item => item.in > 0)
        .map(item => {
          const product = activeProducts.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            size: product?.size || "",
            quantity: item.in
          };
        })
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit);
    } else if (selectedMetric === "stockOut") {
      // For stock out, show by "out" value
      return currentInventory
        .filter(item => item.out > 0)
        .map(item => {
          const product = activeProducts.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            size: product?.size || "",
            quantity: item.out
          };
        })
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, limit);
    }
    
    return [];
  };

  // Get ALL products sorted by quantity for expand modal
  const getAllProductsSorted = () => {
    if (selectedMetric === "products") {
      return currentInventory
        .map(item => {
          const product = activeProducts.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            size: product?.size || "",
            category: product?.category || "Unknown",
            quantity: item.end
          };
        })
        .sort((a, b) => b.quantity - a.quantity);
    } else if (selectedMetric === "items") {
      return currentInventory
        .map(item => {
          const product = activeProducts.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            size: product?.size || "",
            category: product?.category || "Unknown",
            quantity: item.end
          };
        })
        .sort((a, b) => b.quantity - a.quantity);
    } else if (selectedMetric === "stockIn") {
      return currentInventory
        .filter(item => item.in > 0)
        .map(item => {
          const product = activeProducts.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            size: product?.size || "",
            category: product?.category || "Unknown",
            quantity: item.in
          };
        })
        .sort((a, b) => b.quantity - a.quantity);
    } else if (selectedMetric === "stockOut") {
      return currentInventory
        .filter(item => item.out > 0)
        .map(item => {
          const product = activeProducts.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            size: product?.size || "",
            category: product?.category || "Unknown",
            quantity: item.out
          };
        })
        .sort((a, b) => b.quantity - a.quantity);
    }
    
    return [];
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Main Content - shifts left when overview panel is open */}
      <div 
        ref={mainScrollRef}
        className={`flex-1 min-w-0 ml-16 p-4 sm:p-6 lg:p-8 overflow-y-auto transition-all duration-300 ease-in-out ${
          selectedMetric ? "xl:mr-80" : "mr-0"
        }`}
      >
        {/* Header with Date/Time */}
        <div className={isHeaderCompact ? "mb-5" : "mb-8"}>
          {isHeaderCompact && <div className="h-[56px]" aria-hidden="true" />}
          <div
            className={`${isHeaderCompact ? "transition-all duration-200" : "transition-none"} ${
              isHeaderCompact
                ? `fixed top-0 left-16 z-40 px-4 sm:px-6 lg:px-8 py-2 border-b border-gray-200 bg-gray-50/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/85 ${
                    selectedMetric ? "right-0 xl:right-80" : "right-0"
                  }`
                : ""
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className={`font-bold text-gray-900 ${isHeaderCompact ? "text-xl" : "text-2xl"}`}>Dashboard</h1>
              <div className="flex items-center gap-3 ml-auto">
                <div
                  className={`inline-flex items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all ${
                    isHeaderCompact ? "gap-1.5 px-2.5 py-1.5" : "gap-2 px-3 py-2"
                  }`}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Date Selected</span>
                  <span className={`${isHeaderCompact ? "text-xs" : "text-sm"} font-semibold text-[#8B2E2E]`}>
                    {selectedDateLabel}
                  </span>
                </div>
                {!selectedMetric && (
                  <CurrentDateTime className={isHeaderCompact ? "!px-2.5 !py-1.5 !gap-2" : ""} />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Low Stock Alert */}
        <LowStockAlert lowStockItems={lowStockItems} />

        {/* 3-Column Grid: 2 cols for metrics (2x2), 1 col for calendar */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
          {/* Column 1 - Row 1: Total Products */}
          <MetricCard
            icon={<BottleGlassIcon />}
            label="TOTAL NO. OF PRODUCTS"
            value={totalProducts}
            showAsOfToday={false}
            onClick={() => setSelectedMetric(selectedMetric === "products" ? null : "products")}
            isActive={selectedMetric === "products"}
          />

          {/* Column 2 - Row 1: Total Items */}
          <MetricCard
            icon={<TwoBottlesIcon />}
            label="TOTAL NO. OF ITEMS"
            value={totalItems}
            showAsOfToday={true}
            onClick={() => setSelectedMetric(selectedMetric === "items" ? null : "items")}
            isActive={selectedMetric === "items"}
          />

          {/* Column 3 - Row 1 & 2: Calendar (spans 2 rows vertically) */}
          <div className="xl:row-span-2 bg-white border border-gray-200 rounded-[16px] p-6 shadow-sm relative">
            <div ref={monthPickerRef}>
              {/* Month/Year Header - Clickable Dropdown */}
              <button 
                onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen)}
                className="flex items-center justify-between w-full mb-4 hover:opacity-70 transition-opacity"
              >
                <h3 className="text-sm font-semibold text-[#8B2E2E]">{monthYear}</h3>
                <ChevronDown className={`w-4 h-4 text-[#8B2E2E] transition-transform duration-200 ${isMonthPickerOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Month/Year Picker Dropdown - Absolute positioned overlay */}
              {isMonthPickerOpen && (
                <div className="absolute top-16 left-6 right-6 z-50 p-4 bg-white rounded-lg border-2 border-[#8B2E2E] shadow-xl space-y-3">
                  {/* Year Selector */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-2">Year</label>
                    <div className="relative">
                      <select
                        value={calendarMonth.getFullYear()}
                        onChange={(e) => {
                          const newYear = parseInt(e.target.value);
                          const newMonth = calendarMonth.getMonth();

                          // If selecting current year, make sure month is not in future
                          if (newYear === currentYear && newMonth > currentMonth) {
                            setCalendarMonth(new Date(newYear, currentMonth, 1));
                          } else {
                            setCalendarMonth(new Date(newYear, newMonth, 1));
                          }
                        }}
                        className="w-full h-10 px-3 pr-9 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E2E] focus:border-transparent appearance-none"
                      >
                        {years.map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    </div>
                  </div>

                  {/* Month Selector */}
                  <div>
                    <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-2">Month</label>
                    <div className="relative">
                      <select
                        value={calendarMonth.getMonth()}
                        onChange={(e) => {
                          const newMonth = parseInt(e.target.value);
                          const newYear = calendarMonth.getFullYear();
                          const newDate = new Date(newYear, newMonth, 1);

                          // Check if this month/year combination is in the future
                          if (newYear > currentYear || (newYear === currentYear && newMonth > currentMonth)) {
                            return; // Don't allow future months
                          }

                          setCalendarMonth(newDate);
                        }}
                        className="w-full h-10 px-3 pr-9 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E2E] focus:border-transparent appearance-none"
                      >
                        {months.map((month, index) => {
                          const isDisabled = calendarMonth.getFullYear() === currentYear && index > currentMonth;
                          return (
                            <option key={index} value={index} disabled={isDisabled}>
                              {month}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    </div>
                  </div>

                  {/* Go to Today Button */}
                  <button
                    onClick={() => {
                      const today = new Date();
                      setCalendarMonth(today);
                      // Also set the selected date to today
                      const todayStr = `${today.getMonth() + 1}-${today.getDate()}-${format(today, "yyyy")}`;
                      setSelectedDate(todayStr);
                      setIsMonthPickerOpen(false);
                    }}
                    className="w-full px-3 py-2 text-xs font-medium text-gray-700 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg transition-colors"
                  >
                    Go to Today
                  </button>
                </div>
              )}
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 text-[10px] font-semibold text-gray-500 text-center mb-3">
              <div>SUN</div>
              <div>MON</div>
              <div>TUE</div>
              <div>WED</div>
              <div>THU</div>
              <div>FRI</div>
              <div>SAT</div>
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7 gap-2 mb-6">
              {/* Empty cells for days before month starts */}
              {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                <div key={`empty-${i}`} className="w-9 h-9" />
              ))}

              {/* Days of month */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dayDate = new Date(displayDate.getFullYear(), displayDate.getMonth(), day);
                const dayDateStart = startOfDay(dayDate);
                const isFutureDate = isAfter(dayDateStart, today);
                const isSelectedDay = 
                  day === parsedSelectedDate.getDate() &&
                  displayDate.getMonth() === parsedSelectedDate.getMonth() &&
                  displayDate.getFullYear() === parsedSelectedDate.getFullYear();
                
                return (
                  <button
                    key={day}
                    onClick={() => handleDateClick(day)}
                    disabled={isFutureDate}
                    className={`w-9 h-9 text-sm rounded-lg flex items-center justify-center transition-all duration-200 ${
                      isSelectedDay
                        ? "bg-[#8B2E2E] text-white font-semibold shadow-sm"
                        : isFutureDate
                        ? "text-gray-300 cursor-not-allowed"
                        : "hover:bg-gray-100 text-gray-700 cursor-pointer"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            <button 
              onClick={() => setIsViewAllOpen(true)}
              className="w-full py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50 border border-gray-300 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              View All <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Column 1 - Row 2: Total Stock In */}
          <MetricCard
            icon={<SquareArrowRight className="w-6 h-6 text-[#B23A3A]" />}
            label="TOTAL NO. OF STOCK IN"
            value={totalStockIn}
            showAsOfToday={true}
            onClick={() => setSelectedMetric(selectedMetric === "stockIn" ? null : "stockIn")}
            isActive={selectedMetric === "stockIn"}
          />

          {/* Column 2 - Row 2: Total Stock Out */}
          <MetricCard
            icon={<SquareArrowLeft className="w-6 h-6 text-[#B23A3A]" />}
            label="TOTAL NO. OF STOCK OUT"
            value={totalStockOut}
            showAsOfToday={true}
            onClick={() => setSelectedMetric(selectedMetric === "stockOut" ? null : "stockOut")}
            isActive={selectedMetric === "stockOut"}
          />
        </div>

        {/* Stock Movement Trends */}
        <div className="bg-white border border-gray-200 rounded-[16px] p-6 shadow-sm mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Stock Movement Trends</h2>
              <p className="text-xs text-gray-500">Period: {trendPeriodLabel}</p>
            </div>
            <div className="inline-flex items-center rounded-xl border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => setViewMode("selected-date")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  viewMode === "selected-date"
                    ? "bg-white text-[#8B2E2E] shadow-sm"
                    : "text-gray-600 hover:text-gray-800"
                }`}
              >
                Selected Date
              </button>
              <button
                type="button"
                onClick={() => setViewMode("monthly")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  viewMode === "monthly"
                    ? "bg-white text-[#8B2E2E] shadow-sm"
                    : "text-gray-600 hover:text-gray-800"
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setViewMode("yearly")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                  viewMode === "yearly"
                    ? "bg-white text-[#8B2E2E] shadow-sm"
                    : "text-gray-600 hover:text-gray-800"
                }`}
              >
                Yearly
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <TrendList
              title="Fast-moving"
              rows={trendSummary.fastMoving}
              emptyMessage="No stock-out movement for this period."
            />
            <TrendList
              title="Slow-moving"
              rows={trendSummary.slowMoving}
              emptyMessage="No low-volume movers in this period."
            />
            <TrendList
              title="Non-moving"
              rows={trendSummary.nonMoving}
              emptyMessage="All active items moved in this period."
            />
          </div>
        </div>
      </div>

      {/* Overview Panel - slides in from right */}
      {selectedMetric && (
        <div className="fixed right-0 top-0 bottom-0 w-full sm:w-80 bg-[#2d2d2d] text-white shadow-2xl z-50 flex flex-col animate-slide-in">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-700">
            <h2 className="text-sm font-semibold tracking-wider">OVERVIEW</h2>
            <button
              onClick={() => setSelectedMetric(null)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="mb-6">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">
                {selectedMetric === "products" && "TOTAL NO. OF"}
                {selectedMetric === "items" && "TOTAL NO. OF"}
                {selectedMetric === "stockIn" && "TOTAL NO. OF"}
                {selectedMetric === "stockOut" && "TOTAL NO. OF"}
              </p>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                {selectedMetric === "products" && "PRODUCTS"}
                {selectedMetric === "items" && "ITEMS"}
                {selectedMetric === "stockIn" && "STOCK IN"}
                {selectedMetric === "stockOut" && "STOCK OUT"}
              </p>
              <p className="text-5xl font-bold">
                {selectedMetric === "products" && totalProducts}
                {selectedMetric === "items" && totalItems}
                {selectedMetric === "stockIn" && totalStockIn}
                {selectedMetric === "stockOut" && totalStockOut}
              </p>
            </div>

            {/* Top Products List */}
            <div className="space-y-3">
              {getTopProducts().map((product, index) => (
                <div key={index} className="flex items-center justify-between py-3 border-b border-gray-700">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-300 truncate">{product.name}</p>
                    {(selectedMetric === "stockOut" || selectedMetric === "stockIn") && product.size ? (
                      <p className="text-[11px] text-gray-500 truncate">{product.size}</p>
                    ) : null}
                  </div>
                  <span className="text-base font-semibold">{product.quantity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Footer Button */}
          <div className="p-6 border-t border-gray-700">
            <button 
              onClick={() => setIsExpandModalOpen(true)}
              className="w-full py-3 bg-white text-gray-900 rounded-[12px] text-sm font-semibold hover:bg-gray-100 transition-colors duration-300 ease-out"
            >
              EXPAND
            </button>
          </div>
        </div>
      )}

      {/* Expand Modal - Shows all products */}
      <Dialog open={isExpandModalOpen} onOpenChange={setIsExpandModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedMetric === "products" && "All Products"}
              {selectedMetric === "items" && "All Items"}
              {selectedMetric === "stockIn" && "All Stock In"}
              {selectedMetric === "stockOut" && "All Stock Out"}
              {" - "}{format(parsedSelectedDate, "MMM d, yyyy")}
            </DialogTitle>
            <DialogDescription>
              Complete list sorted by quantity
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Product</th>
                  {(selectedMetric === "stockIn" || selectedMetric === "stockOut") && (
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Size</th>
                  )}
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Category</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600">Quantity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {getAllProductsSorted().length === 0 ? (
                  <tr>
                    <td
                      colSpan={selectedMetric === "stockIn" || selectedMetric === "stockOut" ? 4 : 3}
                      className="py-8 text-center text-sm text-gray-500"
                    >
                      No products available.
                    </td>
                  </tr>
                ) : (
                  getAllProductsSorted().map((product, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">{product.name}</td>
                      {(selectedMetric === "stockIn" || selectedMetric === "stockOut") && (
                        <td className="py-3 px-4 text-sm text-gray-500">{product.size || "-"}</td>
                      )}
                      <td className="py-3 px-4 text-sm text-gray-500">{product.category}</td>
                      <td className="py-3 px-4 text-sm text-right font-semibold text-[#8B2E2E]">{product.quantity}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* View All Modal - Shows stock movement records from calendar */}
      <Dialog open={isViewAllOpen} onOpenChange={setIsViewAllOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Stock Movement Records - {format(parsedSelectedDate, "MMM d, yyyy")}</DialogTitle>
            <DialogDescription>View detailed stock movements for the selected date.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full table-fixed">
              <colgroup>
                <col style={{ width: "30%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "21%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-600">Product</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-600">Size</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-600">Category</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">Beg</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600 text-green-600">In</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600 text-red-600">Out</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-gray-600">End</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {currentInventory.filter(i => i.in > 0 || i.out > 0).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-gray-500">No stock movements for this date.</td>
                  </tr>
                ) : (
                  currentInventory
                    .filter(i => i.in > 0 || i.out > 0)
                    .sort((a, b) => b.out - a.out) // Sort by most "out" first
                    .map((item) => {
                    const product = activeProducts.find(p => p.id === item.productId);
                    return (
                      <tr key={item.productId}>
                        <td className="py-2.5 px-4 text-sm font-medium text-gray-900">{product?.name || "Unknown"}</td>
                        <td className="py-2.5 px-4 text-sm text-gray-600 whitespace-nowrap">{product?.size || "-"}</td>
                        <td className="py-2.5 px-4 text-sm text-gray-500 break-words">{product?.category}</td>
                        <td className="py-2 px-2 text-sm text-right">{item.beg}</td>
                        <td className="py-2 px-2 text-sm text-right text-green-600">{item.in > 0 ? `+${item.in}` : "-"}</td>
                        <td className="py-2 px-2 text-sm text-right text-red-600">{item.out > 0 ? `-${item.out}` : "-"}</td>
                        <td className="py-2 px-2 text-sm text-right font-medium">{item.end}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      <style>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 300ms ease-out;
        }
      `}</style>
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  showAsOfToday: boolean;
  onClick: () => void;
  isActive: boolean;
}

function MetricCard({ icon, label, value, showAsOfToday, onClick, isActive }: MetricCardProps) {
  const [displayValue, setDisplayValue] = useState(value);

  // Animate number changes
  useEffect(() => {
    if (displayValue === value) return;
    
    const duration = 400;
    const steps = 30;
    const increment = (value - displayValue) / steps;
    const stepDuration = duration / steps;
    
    let currentStep = 0;
    const timer = setInterval(() => {
      currentStep++;
      if (currentStep >= steps) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(prev => Math.round(prev + increment));
      }
    }, stepDuration);

    return () => clearInterval(timer);
  }, [value]);

  return (
    <button
      onClick={onClick}
      className={`bg-white border rounded-[16px] p-6 shadow-sm flex flex-col justify-between text-left transition-all duration-200 hover:shadow-md ${
        isActive ? "border-[#8B2E2E] border-2" : "border-gray-200"
      }`}
    >
      <div className="flex items-center gap-3 mb-6">
        {icon}
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
          {label}
        </p>
      </div>
      <div>
        <p className="text-5xl font-bold text-[#8B2E2E] mb-1">{displayValue}</p>
        {showAsOfToday && (
          <p className="text-xs text-gray-400 italic">as of today</p>
        )}
      </div>
    </button>
  );
}

// Custom SVG Icons
function BottleGlassIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#B23A3A] flex-shrink-0">
      <path
        d="M7 2h3v7l-3 3v8a2 2 0 002 2h2a2 2 0 002-2v-8l-3-3V2h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 8v12a2 2 0 002 2h1a2 2 0 002-2V8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 8h5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TwoBottlesIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#B23A3A] flex-shrink-0">
      <path
        d="M7 2h3v7l-3 3v8a2 2 0 002 2h2a2 2 0 002-2v-8l-3-3V2h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 2h3v7l-3 3v8a2 2 0 002 2h2a2 2 0 002-2v-8l-3-3V2h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface TrendListProps {
  title: string;
  rows: TrendItem[];
  emptyMessage: string;
}

function TrendList({ title, rows, emptyMessage }: TrendListProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.productId} className="rounded-lg bg-white border border-gray-100 px-3 py-2">
              <p className="text-sm font-medium text-gray-900 leading-tight">{row.productName}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{row.productSize}</p>
              <p className="text-xs text-gray-600 mt-1">
                Out: <span className="font-semibold text-gray-800">{row.totalStockOut}</span>
                {" • "}
                Days: <span className="font-semibold text-gray-800">{row.movementDays}</span>
                {row.lastMovementDate
                  ? ` • Last: ${format(row.lastMovementDate, "MMM d, yyyy")}`
                  : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
