import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { getSupabase, isSupabaseConfigured } from "../../lib/supabase";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const handleSubmit = () => {
    const run = async () => {
      if (!token) {
        toast.error("Invalid reset link.");
        return;
      }
      if (newPassword.length < 6) {
        toast.error("Password must be at least 6 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        toast.error("Passwords do not match.");
        return;
      }
      if (!isSupabaseConfigured()) {
        toast.error("Supabase is not configured.");
        return;
      }

      setIsSubmitting(true);
      try {
        const supabase = getSupabase();
        const { error } = await supabase.functions.invoke("password-reset", {
          body: {
            action: "reset_password",
            token,
            newPassword,
          },
        });
        if (error) throw error;

        toast.success("Password reset successful. You can now log in.");
        navigate("/login");
      } catch (err) {
        console.error("Failed to reset password:", err);
        toast.error("Reset link is invalid/expired or reset failed.");
      } finally {
        setIsSubmitting(false);
      }
    };
    void run();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Set New Password</h1>
        <p className="text-sm text-gray-600 mb-6">
          Enter your new password to complete account recovery.
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-600">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
              placeholder="At least 6 characters"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E2E]/20"
              placeholder="Re-enter new password"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={() => navigate("/login")}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-2 bg-[#8B2E2E] text-white rounded-lg text-sm hover:bg-[#B23A3A] disabled:opacity-50"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save Password"}
          </button>
        </div>
      </div>
    </div>
  );
}

