import { Link, useLocation, useNavigate } from "react-router";
import { LayoutGrid, Archive, Settings, LogOut, BarChart3 } from "lucide-react";
import { useAuth } from "../../context/auth-context";
import logoImg from "../../../assets/15825036d4201b31b7d5ae419f0c1967c2e8fb77.png";

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
    logout();
    navigate("/login");
  };

  return (
    <div className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-6 fixed left-0 top-0 h-screen">
      {/* Logo */}
      <div className="mb-8">
        <img src={logoImg} alt="TARZONA" className="w-10 h-10 object-contain" />
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
