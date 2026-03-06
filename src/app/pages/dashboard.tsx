import { useState, useEffect } from "react";
import { SquareArrowRight, SquareArrowLeft, ExternalLink, ChevronDown, X } from "lucide-react";
import { useInventory } from "../context/inventory-context";
import { format, getDaysInMonth, startOfMonth, getDay, parse, addMonths, subMonths, startOfDay, isBefore, isAfter, isValid } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { CurrentDateTime } from "../components/current-datetime";
import { LowStockAlert } from "../components/low-stock-alert";

type MetricType = "products" | "items" | "stockIn" | "stockOut" | null;

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
  const { products, getInventoryForDate, selectedDate, setSelectedDate } = useInventory();
  
  // Parse selected date
  const parsedSelectedDate = parseUiDate(selectedDate) || new Date();
  
  // State for calendar navigation
  const [calendarMonth, setCalendarMonth] = useState(parsedSelectedDate);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);

  useEffect(() => {
    const today = new Date();
    const todayStr = format(today, "M-d-yyyy");
    setSelectedDate(todayStr);
    setCalendarMonth(today);
  }, []);
  
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
  const totalProducts = activeProducts.length;
  
  const currentInventory = getInventoryForDate(selectedDate);
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

  // Calculate low stock items (end <= 20% of beginning)
  const lowStockItems = currentInventory
    .filter(item => {
      if (item.beg === 0) return false; // Skip if no beginning stock
      const threshold = item.beg * 0.2;
      return item.end <= threshold;
    })
    .map(item => {
      const product = products.find(p => p.id === item.productId);
      return {
        product: product!,
        current: item.end,
        beginning: item.beg,
        percentage: (item.end / item.beg) * 100
      };
    })
    .filter(item => item.product); // Remove items where product wasn't found

  // Get top products for overview panel
  const getTopProducts = () => {
    if (selectedMetric === "products") {
      // For products, just show distinct products (doesn't matter which data)
      return currentInventory
        .map(item => {
          const product = products.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            quantity: item.end
          };
        })
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 7);
    } else if (selectedMetric === "items") {
      // For items, show by end stock quantity
      return currentInventory
        .map(item => {
          const product = products.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            quantity: item.end
          };
        })
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 7);
    } else if (selectedMetric === "stockIn") {
      // For stock in, show by "in" value
      return currentInventory
        .filter(item => item.in > 0)
        .map(item => {
          const product = products.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            quantity: item.in
          };
        })
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 7);
    } else if (selectedMetric === "stockOut") {
      // For stock out, show by "out" value
      return currentInventory
        .filter(item => item.out > 0)
        .map(item => {
          const product = products.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            quantity: item.out
          };
        })
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 7);
    }
    
    return [];
  };

  // Get ALL products sorted by quantity for expand modal
  const getAllProductsSorted = () => {
    if (selectedMetric === "products") {
      return currentInventory
        .map(item => {
          const product = products.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            category: product?.category || "Unknown",
            quantity: item.end
          };
        })
        .sort((a, b) => b.quantity - a.quantity);
    } else if (selectedMetric === "items") {
      return currentInventory
        .map(item => {
          const product = products.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            category: product?.category || "Unknown",
            quantity: item.end
          };
        })
        .sort((a, b) => b.quantity - a.quantity);
    } else if (selectedMetric === "stockIn") {
      return currentInventory
        .filter(item => item.in > 0)
        .map(item => {
          const product = products.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
            category: product?.category || "Unknown",
            quantity: item.in
          };
        })
        .sort((a, b) => b.quantity - a.quantity);
    } else if (selectedMetric === "stockOut") {
      return currentInventory
        .filter(item => item.out > 0)
        .map(item => {
          const product = products.find(p => p.id === item.productId);
          return {
            name: product?.name || "Unknown",
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
        className={`flex-1 min-w-0 ml-16 p-4 sm:p-6 lg:p-8 overflow-y-auto transition-all duration-300 ease-in-out ${
          selectedMetric ? "xl:mr-80" : "mr-0"
        }`}
      >
        {/* Header with Date/Time */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          {!selectedMetric && <CurrentDateTime className="text-xs text-gray-500" />}
        </div>

        {/* Low Stock Alert */}
        <LowStockAlert lowStockItems={lowStockItems} />

        {/* 3-Column Grid: 2 cols for metrics (2x2), 1 col for calendar */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
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
                  <span className="text-sm text-gray-300">{product.name}</span>
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
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600">Category</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600">Quantity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {getAllProductsSorted().length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-sm text-gray-500">No products available.</td>
                  </tr>
                ) : (
                  getAllProductsSorted().map((product, index) => (
                    <tr key={index} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 text-sm font-medium text-gray-900">{product.name}</td>
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
            <table className="w-full">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Product</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-gray-600">Category</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-600">Beg</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-600 text-green-600">In</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-600 text-red-600">Out</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-gray-600">End</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {currentInventory.filter(i => i.in > 0 || i.out > 0).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-gray-500">No stock movements for this date.</td>
                  </tr>
                ) : (
                  currentInventory
                    .filter(i => i.in > 0 || i.out > 0)
                    .sort((a, b) => b.out - a.out) // Sort by most "out" first
                    .map((item) => {
                    const product = products.find(p => p.id === item.productId);
                    return (
                      <tr key={item.productId}>
                        <td className="py-2 px-3 text-sm">{product?.name || "Unknown"}</td>
                        <td className="py-2 px-3 text-sm text-gray-500">{product?.category}</td>
                        <td className="py-2 px-3 text-sm text-right">{item.beg}</td>
                        <td className="py-2 px-3 text-sm text-right text-green-600">{item.in > 0 ? `+${item.in}` : "-"}</td>
                        <td className="py-2 px-3 text-sm text-right text-red-600">{item.out > 0 ? `-${item.out}` : "-"}</td>
                        <td className="py-2 px-3 text-sm text-right font-medium">{item.end}</td>
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
