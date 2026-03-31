import { createBrowserRouter, Navigate, redirect } from "react-router";
import { Sidebar } from "./components/layout/sidebar";
import { LoginPage } from "./pages/login";
import { DashboardPage } from "./pages/dashboard";
import { InventoryPage } from "./pages/inventory";
import { ActivityLogPage } from "./pages/activity-log";
import { SettingsLayout } from "./pages/settings/layout";
import { HashGenerator } from "./pages/hash-generator";
import { LoginDiagnostic } from "./pages/login-diagnostic";
import { ResetPasswordPage } from "./pages/reset-password";
import { RouteAccessGate } from "./components/security/route-access-gate";
import { getSession } from "../lib/db-utils";

const LAST_PROTECTED_ROUTE_KEY = "tarzona_last_protected_route";

function isSafeProtectedRoute(path: string): boolean {
  if (!path) return false;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  let pathname = normalized;
  try {
    pathname = new URL(normalized, "http://local").pathname;
  } catch {
    pathname = normalized.split("?")[0].split("#")[0];
  }
  return (
    pathname === "/dashboard" ||
    pathname === "/inventory" ||
    pathname === "/activity-log" ||
    pathname === "/settings" ||
    pathname.startsWith("/settings/")
  );
}

// Protected Route Wrapper
function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RouteAccessGate>
      <div className="flex w-full min-h-screen">
        <Sidebar />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </RouteAccessGate>
  );
}

async function requireLegacySession({ request }: { request: Request }) {
  const session = getSession();
  if (session) return null;

  const url = new URL(request.url);
  const requestedPath = `${url.pathname}${url.search || ""}`;
  throw redirect(`/login?redirect=${encodeURIComponent(requestedPath)}`);
}

async function redirectAuthenticatedFromLogin() {
  const session = getSession();
  if (!session) return null;

  const remembered = localStorage.getItem(LAST_PROTECTED_ROUTE_KEY) || "";
  const safeTarget = isSafeProtectedRoute(remembered) ? remembered : "/dashboard";
  throw redirect(safeTarget);
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
    loader: redirectAuthenticatedFromLogin,
    element: <LoginPage />,
  },
  {
    path: "/hash-generator",
    element: <HashGenerator />,
  },
  {
    path: "/login-diagnostic",
    element: <LoginDiagnostic />,
  },
  {
    path: "/reset-password",
    element: <ResetPasswordPage />,
  },
  {
    path: "/dashboard",
    loader: requireLegacySession,
    element: (
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/inventory",
    loader: requireLegacySession,
    element: (
      <ProtectedRoute>
        <InventoryPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/activity-log",
    loader: requireLegacySession,
    element: (
      <ProtectedRoute>
        <ActivityLogPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/settings",
    loader: requireLegacySession,
    element: (
      <ProtectedRoute>
        <SettingsLayout />
      </ProtectedRoute>
    ),
  },
]);
