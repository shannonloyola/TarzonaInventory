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

  // Format: "Thu Feb 12 15:28 PM"
  const formattedDate = format(currentTime, "EEE MMM dd");
  const formattedTime = format(currentTime, "hh:mm a");

  return (
    <div className={className}>
      {formattedDate} {formattedTime}
    </div>
  );
}