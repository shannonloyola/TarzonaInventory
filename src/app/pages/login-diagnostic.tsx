import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { getSupabase, isSupabaseConfigured } from '../../lib/supabase';
import bcrypt from 'bcryptjs';

export function LoginDiagnostic() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [diagnosticResult, setDiagnosticResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runDiagnostic = async () => {
    setLoading(true);
    const result: any = {
      timestamp: new Date().toISOString(),
      steps: [],
    };

    try {
      // STEP 1: Check Supabase Configuration
      result.steps.push({
        step: 'STEP 1: Supabase Configuration Check',
        configured: isSupabaseConfigured(),
        configData: localStorage.getItem('supabase_config'),
      });

      if (!isSupabaseConfigured()) {
        result.steps.push({
          step: 'ERROR',
          message: 'Supabase is not configured. Please configure in Admin Dev Setup.',
        });
        setDiagnosticResult(result);
        setLoading(false);
        return;
      }

      const supabase = getSupabase();

      // STEP 2: Test Basic Connection
      try {
        const { data: testData, error: testError } = await supabase
          .from('profiles')
          .select('id, username')
          .limit(1);

        result.steps.push({
          step: 'STEP 2: Basic Connection Test',
          success: !testError,
          error: testError?.message,
          data: testData,
        });

        if (testError) {
          result.steps.push({
            step: 'ERROR',
            message: `Connection failed: ${testError.message}`,
            hint: 'Check your Supabase URL and Anon Key. Also check RLS policies.',
          });
        }
      } catch (err: any) {
        result.steps.push({
          step: 'STEP 2: Basic Connection Test',
          success: false,
          error: err.message,
        });
      }

      // STEP 3: Check RLS Policies
      result.steps.push({
        step: 'STEP 3: RLS Policy Check',
        message: 'Checking if we can read from profiles and user_accounts tables',
      });

      // Try to read profiles table
      const { data: profilesTest, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .limit(1);

      result.steps.push({
        step: 'STEP 3a: profiles table SELECT',
        success: !profilesError,
        error: profilesError?.message,
        rlsBlocked: profilesError?.message?.includes('policy'),
        data: profilesTest,
      });

      // Try to read user_accounts table
      const { data: accountsTest, error: accountsError } = await supabase
        .from('user_accounts')
        .select('*')
        .limit(1);

      result.steps.push({
        step: 'STEP 3b: user_accounts table SELECT',
        success: !accountsError,
        error: accountsError?.message,
        rlsBlocked: accountsError?.message?.includes('policy'),
        data: accountsTest,
      });

      if (!username || !password) {
        result.steps.push({
          step: 'INFO',
          message: 'Enter username and password to test login flow',
        });
        setDiagnosticResult(result);
        setLoading(false);
        return;
      }

      // STEP 4: Query Profile by Username
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('username', username)
        .single();

      result.steps.push({
        step: 'STEP 4: Query profile by username',
        username,
        found: !!profile,
        error: profileError?.message,
        profileData: profile ? {
          id: profile.id,
          username: profile.username,
          full_name: profile.full_name,
          role: profile.role,
        } : null,
      });

      if (!profile) {
        result.steps.push({
          step: 'ERROR',
          message: `No profile found with username: ${username}`,
          hint: 'Check if user exists in profiles table',
        });
        setDiagnosticResult(result);
        setLoading(false);
        return;
      }

      // STEP 5: Query User Account
      const { data: account, error: accountError } = await supabase
        .from('user_accounts')
        .select('*')
        .eq('profile_id', profile.id)
        .eq('is_active', true)
        .single();

      result.steps.push({
        step: 'STEP 5: Query user_accounts by profile_id',
        profileId: profile.id,
        found: !!account,
        error: accountError?.message,
        accountData: account ? {
          profile_id: account.profile_id,
          is_active: account.is_active,
          password_hash_format: account.password_hash?.substring(0, 10) + '...',
          password_hash_length: account.password_hash?.length,
          password_hash_starts_with: account.password_hash?.substring(0, 4),
        } : null,
      });

      if (!account) {
        result.steps.push({
          step: 'ERROR',
          message: `No active account found for profile_id: ${profile.id}`,
          hint: 'Check if user_accounts row exists and is_active = true',
        });
        setDiagnosticResult(result);
        setLoading(false);
        return;
      }

      // STEP 6: Password Hash Analysis
      result.steps.push({
        step: 'STEP 6: Password Hash Analysis',
        hashFormat: account.password_hash?.substring(0, 4),
        expectedFormat: '$2a$ or $2b$ (bcrypt)',
        isBcryptFormat: account.password_hash?.startsWith('$2a$') || account.password_hash?.startsWith('$2b$'),
        hashLength: account.password_hash?.length,
        expectedLength: '60 characters for bcrypt',
      });

      // STEP 7: Password Comparison
      try {
        const passwordMatch = await bcrypt.compare(password, account.password_hash);
        
        result.steps.push({
          step: 'STEP 7: bcrypt.compare() result',
          inputPassword: password,
          inputPasswordLength: password.length,
          passwordMatch,
          hashUsed: account.password_hash?.substring(0, 20) + '...',
        });

        if (!passwordMatch) {
          result.steps.push({
            step: 'ERROR',
            message: 'Password does not match hash',
            hint: 'Either the password is wrong, or the hash in database is incorrect',
            solution: 'Use the hash-generator page to create a proper bcrypt hash',
          });
        } else {
          result.steps.push({
            step: 'SUCCESS',
            message: 'Login would succeed! Password matches.',
          });
        }
      } catch (err: any) {
        result.steps.push({
          step: 'STEP 7: bcrypt.compare() ERROR',
          error: err.message,
          message: 'Failed to compare password',
        });
      }

    } catch (err: any) {
      result.steps.push({
        step: 'FATAL ERROR',
        error: err.message,
        stack: err.stack,
      });
    }

    setDiagnosticResult(result);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold mb-2 text-gray-900">Login Diagnostic Tool</h1>
        <p className="text-gray-600 mb-8">
          This tool will analyze your authentication system step-by-step to identify why login is failing.
        </p>

        <div className="bg-gray-50 border rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Test Login</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Username</label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g., raphcru"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="e.g., admin123"
              />
            </div>
            <Button 
              onClick={runDiagnostic}
              disabled={loading}
              className="bg-[#B23A3A] hover:bg-[#8B2E2E] text-white"
            >
              {loading ? 'Running Diagnostic...' : 'Run Full Diagnostic'}
            </Button>
          </div>
        </div>

        {diagnosticResult && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <h3 className="font-semibold text-blue-900 mb-2">Diagnostic Report</h3>
              <p className="text-sm text-blue-700">Timestamp: {diagnosticResult.timestamp}</p>
            </div>

            {diagnosticResult.steps.map((step: any, index: number) => (
              <div 
                key={index}
                className={`border rounded-xl p-4 ${
                  step.step.includes('ERROR') ? 'bg-red-50 border-red-200' :
                  step.step.includes('SUCCESS') ? 'bg-green-50 border-green-200' :
                  step.step.includes('INFO') ? 'bg-yellow-50 border-yellow-200' :
                  'bg-white'
                }`}
              >
                <h4 className="font-semibold mb-2">{step.step}</h4>
                <pre className="text-xs bg-gray-900 text-green-400 p-3 rounded overflow-auto max-h-96">
                  {JSON.stringify(step, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
