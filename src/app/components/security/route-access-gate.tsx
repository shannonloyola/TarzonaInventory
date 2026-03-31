import { Navigate, useLocation } from "react-router";
import { ReactNode, useEffect } from "react";
import { useAuth } from "../../context/auth-context";
import { getSession } from "../../../lib/db-utils";

const LAST_PROTECTED_ROUTE_KEY = "tarzona_last_protected_route";

function isProtectedPath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname === "/inventory" ||
    pathname === "/activity-log" ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/")
  );
}

export function RouteAccessGate({ children }: { children: ReactNode }) {
  const { user, isAuthReady } = useAuth();
  const location = useLocation();
  const hasStoredSession = !!getSession();

  useEffect(() => {
    if (!isAuthReady || !user || !hasStoredSession) return;
    if (!isProtectedPath(location.pathname)) return;
    const pathWithSearch = `${location.pathname}${location.search || ""}`;
    localStorage.setItem(LAST_PROTECTED_ROUTE_KEY, pathWithSearch);
  }, [isAuthReady, user, hasStoredSession, location.pathname, location.search]);

  // Wait for session restore to avoid redirecting authenticated users during initial load.
  if (!isAuthReady) return null;

  if (!user || !hasStoredSession) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
