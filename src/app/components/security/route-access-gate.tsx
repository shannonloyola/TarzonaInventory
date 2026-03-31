import { Navigate, useLocation } from "react-router";
import { ReactNode, useEffect } from "react";
import { useAuth } from "../../context/auth-context";
import { getSession } from "../../../lib/db-utils";

const LAST_PROTECTED_ROUTE_KEY = "tarzona_last_protected_route";
const PENDING_LOGIN_REDIRECT_KEY = "tarzona_pending_login_redirect";
const SUPPRESS_NEXT_PROTECTED_REDIRECT_KEY = "suppressNextProtectedRedirect";

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
    const suppressNextProtectedRedirect =
      sessionStorage.getItem(SUPPRESS_NEXT_PROTECTED_REDIRECT_KEY) === "1";
    if (suppressNextProtectedRedirect) {
      sessionStorage.removeItem(SUPPRESS_NEXT_PROTECTED_REDIRECT_KEY);
      try {
        sessionStorage.removeItem(PENDING_LOGIN_REDIRECT_KEY);
      } catch {
        // noop
      }
      return <Navigate to="/login" replace />;
    }

    const fromWithSearch = `${location.pathname}${location.search || ""}`;
    if (isProtectedPath(location.pathname)) {
      try {
        sessionStorage.setItem(PENDING_LOGIN_REDIRECT_KEY, fromWithSearch);
      } catch {
        // noop
      }
    }
    return <Navigate to="/login" replace state={{ from: fromWithSearch }} />;
  }

  return <>{children}</>;
}
