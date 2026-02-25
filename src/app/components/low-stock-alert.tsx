import { AlertTriangle, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Product } from "../types";

interface LowStockAlertProps {
  lowStockItems: Array<{
    product: Product;
    current: number;
    beginning: number;
    percentage: number;
  }>;
}

export function LowStockAlert({ lowStockItems }: LowStockAlertProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasLowStock = lowStockItems.length > 0;

  return (
    <div 
      className={`mb-6 border-l-4 rounded-[16px] shadow-sm overflow-hidden transition-all duration-300 ease-out ${
        hasLowStock 
          ? 'bg-red-50 border-[#B23A3A]' 
          : 'bg-green-50 border-green-600'
      }`}
    >
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center justify-between p-4 transition-colors duration-200 ${
          hasLowStock ? 'hover:bg-red-100' : 'hover:bg-green-100'
        }`}
      >
        <div className="flex items-center gap-3">
          {hasLowStock ? (
            <AlertTriangle className="w-5 h-5 text-[#B23A3A] flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
          )}
          <div className="text-left">
            {hasLowStock ? (
              <>
                <h3 className="text-sm font-semibold text-gray-900">
                  Low Stock Alert - {lowStockItems.length} {lowStockItems.length === 1 ? 'Product' : 'Products'}
                </h3>
                {!isExpanded && (
                  <p className="text-xs text-gray-600">
                    Products at or below 20% of beginning stock
                  </p>
                )}
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-gray-900">
                  Stock Status
                </h3>
                {!isExpanded && (
                  <p className="text-xs text-gray-600">
                    All products have sufficient stock
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0" />
        )}
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="px-4 pb-4 animate-fade-in">
          {hasLowStock ? (
            <>
              <p className="text-xs text-gray-600 mb-3">
                The following products are at or below 20% of their beginning stock:
              </p>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {lowStockItems.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between py-2 px-3 bg-white rounded-lg border border-red-100"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{item.product.name}</p>
                      <p className="text-xs text-gray-500">{item.product.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-[#B23A3A]">
                        {item.current} / {item.beginning}
                      </p>
                      <p className="text-xs text-gray-500">
                        {item.percentage.toFixed(0)}% remaining
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 py-2 px-3 bg-white rounded-lg border border-green-100">
              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
              <p className="text-sm text-gray-700">
                All products are above the 20% stock threshold. No low stock alerts for today.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}