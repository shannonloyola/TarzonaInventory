import { Link, useLocation, useNavigate } from "react-router";
import { LayoutGrid, Archive, Settings, LogOut, BarChart3 } from "lucide-react";
import { useAuth } from "../../context/auth-context";
import logoImg from "../../../assets/15825036d4201b31b7d5ae419f0c1967c2e8fb77.png";

const LAST_PROTECTED_ROUTE_KEY = "tarzona_last_protected_route";
const PENDING_LOGIN_REDIRECT_KEY = "tarzona_pending_login_redirect";
const LOGOUT_LANDING_MODE_KEY = "logoutLandingMode";
const SUPPRESS_NEXT_PROTECTED_REDIRECT_KEY = "suppressNextProtectedRedirect";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const isActive = (path: string) => {
    if (path === "/dashboard" && location.pathname === "/dashboard") return true;
    if (path !== "/dashboard" && location.pathname.startsWith(path)) return true;
    return false;
  };

  const handleLogout = () => {
    localStorage.removeItem(LAST_PROTECTED_ROUTE_KEY);
    sessionStorage.removeItem(PENDING_LOGIN_REDIRECT_KEY);
    sessionStorage.setItem(LOGOUT_LANDING_MODE_KEY, "dashboard");
    sessionStorage.setItem(SUPPRESS_NEXT_PROTECTED_REDIRECT_KEY, "1");
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-6 fixed left-0 top-0 h-screen">
      {/* Logo */}
      <div className="mb-8">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/30"
          title="Reload current page"
          aria-label="Reload current page"
        >
          <img src={logoImg} alt="TARZONA" className="w-10 h-10 object-contain" />
        </button>
      </div>

      {/* Navigation Icons */}
      <nav className="flex-1 flex flex-col gap-4">
        <Link
          to="/dashboard"
          className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
            isActive("/dashboard")
              ? "bg-red-100 text-red-700"
              : "text-gray-600 hover:bg-gray-100"
          }`}
          title="Dashboard"
        >
          <LayoutGrid className="w-5 h-5" />
        </Link>

        <Link
          to="/inventory"
          className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
            isActive("/inventory")
              ? "bg-red-700 text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
          title="Inventory"
        >
          <Archive className="w-5 h-5" />
        </Link>

        <Link
          to="/activity-log"
          className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
            isActive("/activity-log")
              ? "bg-red-100 text-red-700"
              : "text-gray-600 hover:bg-gray-100"
          }`}
          title="Activity Log"
        >
          <BarChart3 className="w-5 h-5" />
        </Link>

        <Link
          to="/settings"
          className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
            isActive("/settings")
              ? "bg-red-100 text-red-700"
              : "text-gray-600 hover:bg-gray-100"
          }`}
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </Link>
      </nav>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
        title="Logout"
      >
        <LogOut className="w-5 h-5" />
      </button>
    </div>
  );
}
