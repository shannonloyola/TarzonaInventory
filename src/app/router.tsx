import { createBrowserRouter, Navigate } from "react-router";
import { Sidebar } from "./components/layout/sidebar";
import { LoginPage } from "./pages/login";
import { DashboardPage } from "./pages/dashboard";
import { InventoryPage } from "./pages/inventory";
import { ActivityLogPage } from "./pages/activity-log";
import { SettingsLayout } from "./pages/settings/layout";
import { HashGenerator } from "./pages/hash-generator";
import { LoginDiagnostic } from "./pages/login-diagnostic";

// Protected Route Wrapper
function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full min-h-screen">
      <Sidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    path: "/login",
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
    path: "/dashboard",
    element: (
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/inventory",
    element: (
      <ProtectedRoute>
        <InventoryPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/activity-log",
    element: (
      <ProtectedRoute>
        <ActivityLogPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/settings",
    element: (
      <ProtectedRoute>
        <SettingsLayout />
      </ProtectedRoute>
    ),
  },
]);