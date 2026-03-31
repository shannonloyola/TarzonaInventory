import { useState } from "react";
import { useAuth } from "../../context/auth-context";
import { ProfilePage } from "./profile";
import { TeamManagementPage } from "./team";
import { DataManagementPage } from "./data";
import { CurrentDateTime } from "../../components/current-datetime";

type SettingsTab = "profile" | "team" | "data";

export function SettingsLayout() {
  const { isAdmin, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const canViewDataControls = isAdmin || hasPermission("exportData") || hasPermission("archiveProduct");

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Main Content Area */}
      <div className="flex-1 ml-16 py-8 pl-8 pr-8 mr-60 overflow-y-auto transition-all duration-300 ease-out">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <CurrentDateTime className="text-xs text-gray-500" />
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === "profile" && <ProfilePage />}
          {activeTab === "team" && isAdmin && <TeamManagementPage />}
          {activeTab === "data" && canViewDataControls && <DataManagementPage />}
        </div>
      </div>

      {/* Right Sidebar - Fixed */}
      <div className="fixed right-0 top-0 bottom-0 w-60 bg-[#2d2d2d] text-white flex-shrink-0 flex flex-col shadow-2xl z-50">
        {/* Header */}
        <div className="flex items-center justify-center p-6 border-b border-gray-600">
          <h2 className="text-sm font-semibold tracking-wider">SETTINGS</h2>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 p-6">
          <div className="space-y-2">
            <button
              onClick={() => setActiveTab("profile")}
              className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors duration-200 ${
                activeTab === "profile"
                  ? "bg-[#B23A3A]/20 text-red-300"
                  : "text-gray-400 hover:bg-gray-600/30 hover:text-white"
              }`}
            >
              Your Profile
            </button>
            
            {isAdmin && (
              <>
                <button
                  onClick={() => setActiveTab("team")}
                  className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors duration-200 ${
                    activeTab === "team"
                      ? "bg-[#B23A3A]/20 text-red-300"
                      : "text-gray-400 hover:bg-gray-600/30 hover:text-white"
                  }`}
                >
                  Admin Controls
                </button>
                
              </>
            )}

            {canViewDataControls && (
              <button
                onClick={() => setActiveTab("data")}
                className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  activeTab === "data"
                    ? "bg-[#B23A3A]/20 text-red-300"
                    : "text-gray-400 hover:bg-gray-600/30 hover:text-white"
                }`}
              >
                Data Controls
              </button>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}
