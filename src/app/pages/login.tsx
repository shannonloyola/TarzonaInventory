import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../context/auth-context";
import { Role } from "../types";
import { toast } from "sonner";
import { Settings, ChevronDown } from "lucide-react";
import { AdminDevSetupModal } from "../components/admin-dev-setup-modal";
import logoImg from "../../assets/23cc4f10c8c227246e4dd99a2116314104e701d4.png";

export function LoginPage() {
  const [role, setRole] = useState<Role>("Admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showDevSetup, setShowDevSetup] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const showDevSetupButton =
    (import.meta.env.VITE_ENABLE_DEV_SETUP as string | undefined) === "true";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const success = await login(username, password, role);
      if (success) {
        const routeState = location.state as { from?: string } | null;
        const redirectFromQuery = new URLSearchParams(location.search).get("redirect");
        const redirectTo =
          routeState?.from && routeState.from !== "/login"
            ? routeState.from
            : redirectFromQuery && redirectFromQuery !== "/login"
              ? redirectFromQuery
            : "/dashboard";
        navigate(redirectTo, { replace: true });
      } else {
        toast.error("Invalid credentials");
      }
    } catch (error: any) {
      const rawMessage = String(error?.message || "");
      const isRoleMismatch = rawMessage.startsWith("ROLE_MISMATCH:");

      if (isRoleMismatch) {
        const actualRole = rawMessage.split(":")[1] === "admin" ? "Admin" : "Staff";
        toast.error(`Login Error: Role Mismatch.`);
      } else {
        toast.error(error.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "mt-1 h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm placeholder:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#7A2D2D]/20";
  const labelClass = "text-xs font-semibold text-[#7A2D2D]";

  return (
    <div className="relative min-h-screen bg-white overflow-hidden">
      {/* Background blobs (keep them OUTSIDE the card like the prototype) */}
      <div className="pointer-events-none absolute -top-[320px] -right-[320px] h-[620px] w-[620px] rounded-full bg-[#7A2D2D]" />
      <div className="pointer-events-none absolute -bottom-[360px] -left-[360px] h-[720px] w-[720px] rounded-full bg-[#7A2D2D]" />

      {/* Centered Card */}
      <div className="mx-auto flex min-h-screen items-center justify-center px-6">
        <div className="relative w-full max-w-5xl overflow-hidden rounded-2xl bg-[#F7FAFC] shadow-xl">
          {/* Admin Dev Setup Gear Icon */}
          {showDevSetupButton && (
            <button
              onClick={() => setShowDevSetup(true)}
              className="absolute top-4 right-4 z-10 p-2 text-gray-400 hover:text-[#B23A3A] transition-colors rounded-lg hover:bg-gray-100"
              title="Admin Developer Setup"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* Left: Logo (match prototype: centered and larger) */}
            <div className="flex items-center justify-center p-10">
              <img
                src={logoImg}
                alt="TARZONA"
                className="max-h-[380px] w-auto object-contain"
              />
            </div>

            {/* Right: Form */}
            <div className="p-10">
              <h2 className="text-4xl font-extrabold text-[#5B1F1F]">
                Welcome Back!
              </h2>
              <p className="mt-1 text-sm text-[#7A2D2D]">
                Login to your account.
              </p>

              <form
                onSubmit={handleSubmit}
                className="mt-8 space-y-5"
              >
                <div>
                  <label className={labelClass}>Role</label>
                  <div className="relative">
                    <select
                      value={role}
                      onChange={(e) =>
                        setRole(e.target.value as Role)
                      }
                      className={`${inputClass} h-10 pr-9 appearance-none`}
                    >
                      <option value="Admin">Admin</option>
                      <option value="Staff">Staff</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>
                    Username or Email
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) =>
                      setUsername(e.target.value)
                    }
                    required
                    className={inputClass}
                    placeholder="Username or Email"
                  />
                </div>

                <div>
                  <label className={labelClass}>Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) =>
                      setPassword(e.target.value)
                    }
                    required
                    className={inputClass}
                    placeholder="Password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="h-10 w-full rounded-md bg-[#F2B233] text-sm font-semibold text-black hover:bg-[#E9A91E] transition-colors disabled:opacity-50"
                >
                  {loading ? "Logging in..." : "Log in"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(true);
                  }}
                  className="block text-[11px] text-[#7A2D2D] underline underline-offset-2"
                >
                  Forgot Password?
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="fixed inset-0 bg-white/15 backdrop-blur-[2px] flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              Forgot Password
            </h3>
            <p className="text-gray-600 mb-6">
              Password reset email is not configured yet. Please contact the admin.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowForgotPassword(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setRole("Admin");
                  setShowForgotPassword(false);
                  toast.info("Role switched to Admin.");
                }}
                className="flex-1 px-4 py-2 bg-[#7A2D2D] text-white rounded-lg hover:bg-[#5B1F1F]"
              >
                Login as Admin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Dev Setup Modal */}
      <AdminDevSetupModal
        open={showDevSetup}
        onOpenChange={setShowDevSetup}
      />
    </div>
  );
}
