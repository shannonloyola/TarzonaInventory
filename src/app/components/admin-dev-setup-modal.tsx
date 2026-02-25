import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { initSupabase, testConnection, clearSupabaseConfig } from '../../lib/supabase';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

interface AdminDevSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function AdminDevSetupModal({ open, onOpenChange, onSuccess }: AdminDevSetupModalProps) {
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTestConnection = async () => {
    if (!url || !anonKey) {
      toast.error('Please enter both URL and Anon Key');
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      // Initialize Supabase with provided credentials
      initSupabase({ url, anonKey });

      // Test the connection
      const result = await testConnection();

      if (result.success) {
        setTestResult({
          success: true,
          message: 'Connection successful! Database is reachable.',
        });
        toast.success('Supabase connected successfully!');
        
        // Auto-close after success
        setTimeout(() => {
          onOpenChange(false);
          onSuccess?.();
        }, 1500);
      } else {
        setTestResult({
          success: false,
          message: result.error || 'Connection failed',
        });
        toast.error('Connection failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      toast.error('Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const handleClearConfig = () => {
    clearSupabaseConfig();
    setUrl('');
    setAnonKey('');
    setTestResult(null);
    toast.success('Configuration cleared');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900">
            Admin Developer Setup
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-600">
            Configure your Supabase connection. These credentials will be stored locally in your browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="supabase-url" className="text-sm font-medium text-gray-900">
              Supabase URL
            </Label>
            <Input
              id="supabase-url"
              placeholder="https://xxxxx.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="supabase-key" className="text-sm font-medium text-gray-900">
              Supabase Anon Key
            </Label>
            <Input
              id="supabase-key"
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              className="w-full"
            />
          </div>

          {testResult && (
            <div
              className={`flex items-center gap-2 p-3 rounded-xl text-sm ${
                testResult.success
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleClearConfig}
            className="rounded-xl"
          >
            Clear Config
          </Button>
          <Button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !url || !anonKey}
            className="bg-[#B23A3A] hover:bg-[#8B2E2E] text-white rounded-xl"
          >
            {testing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              'Test Connection'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}