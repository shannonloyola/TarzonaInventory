import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type AdminPasswordConfirmModalProps = {
  open: boolean;
  actionLabel: string;
  password: string;
  errorMessage: string;
  isSubmitting: boolean;
  onPasswordChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AdminPasswordConfirmModal({
  open,
  actionLabel,
  password,
  errorMessage,
  isSubmitting,
  onPasswordChange,
  onCancel,
  onConfirm,
}: AdminPasswordConfirmModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-[420px] rounded-[16px]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-gray-900">Confirm Admin Password</DialogTitle>
          <DialogDescription className="text-sm text-gray-600">
            Enter your admin password to {actionLabel}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="admin-password-confirm-input" className="text-xs text-gray-600 uppercase tracking-wide">
            Password
          </Label>
          <Input
            id="admin-password-confirm-input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => onPasswordChange(e.target.value)}
            disabled={isSubmitting}
            placeholder="Admin password"
          />
          {errorMessage ? <p className="text-red-600 text-xs">{errorMessage}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={isSubmitting} onClick={onConfirm}>
            {isSubmitting ? "Verifying..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
