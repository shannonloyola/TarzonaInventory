import { useState, useEffect } from "react";
import { format } from "date-fns";

interface CurrentDateTimeProps {
  className?: string;
}

export function CurrentDateTime({ className = "" }: CurrentDateTimeProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000); // Update every second

    return () => clearInterval(timer);
  }, []);

  const formattedDate = format(currentTime, "EEE, MMM d, yyyy");
  const formattedTime = format(currentTime, "hh:mm:ss a");

  return (
    <div
      className={`inline-flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm ${className}`}
    >
      <div className="text-right">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Today</p>
        <p className="text-xs font-semibold text-gray-700">{formattedDate}</p>
        <p className="text-xs font-semibold text-[#8B2E2E] tabular-nums">{formattedTime}</p>
      </div>
    </div>
  );
}
