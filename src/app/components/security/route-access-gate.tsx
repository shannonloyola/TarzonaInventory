import { Navigate, useLocation } from "react-router";
import { ReactNode } from "react";
import { useAuth } from "../../context/auth-context";
import { getSecurityConfig } from "../../../lib/security-config";

export function RouteAccessGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const security = getSecurityConfig();

  // Disabled by default to preserve existing behavior until cutover.
  if (!security.enableRouteGuard) return <>{children}</>;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}

