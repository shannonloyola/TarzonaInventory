import { useState } from 'react';
import bcrypt from 'bcryptjs';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

export function HashGenerator() {
  const [password, setPassword] = useState('');
  const [hash, setHash] = useState('');
  const [loading, setLoading] = useState(false);

  const generateHash = async () => {
    if (!password) return;
    setLoading(true);
    try {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      setHash(hashedPassword);
    } catch (error) {
      console.error('Error generating hash:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateDefaultHashes = async () => {
    setLoading(true);
    try {
      const adminSalt = await bcrypt.genSalt(10);
      const adminHash = await bcrypt.hash('admin123', adminSalt);
      
      const staffSalt = await bcrypt.genSalt(10);
      const staffHash = await bcrypt.hash('staff123', staffSalt);
      
      const sql = `-- Run this SQL in Supabase SQL Editor

-- Delete existing test users
DELETE FROM user_accounts WHERE profile_id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

DELETE FROM staff_permissions WHERE staff_profile_id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

DELETE FROM profiles WHERE id IN (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222'
);

-- Insert profiles
INSERT INTO profiles (id, username, full_name, email, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'raphcru', 'Raphael Crucillo', 'raphaelcrucillo@gmail.com', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'gingvmb', 'Georgia Mae Bongo', 'georgeime@gmail.com', 'staff');

-- Insert user accounts with real bcrypt hashes
-- Admin: raphcru / admin123
-- Staff: gingvmb / staff123
INSERT INTO user_accounts (profile_id, password_hash) VALUES
  ('11111111-1111-1111-1111-111111111111', '${adminHash}'),
  ('22222222-2222-2222-2222-222222222222', '${staffHash}');

-- Insert staff permissions
INSERT INTO staff_permissions (staff_profile_id, can_add_product, can_delete_product, can_edit_product, can_grant_admin) VALUES
  ('22222222-2222-2222-2222-222222222222', true, false, true, false);`;
      
      setHash(sql);
    } catch (error) {
      console.error('Error generating hashes:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">Bcrypt Hash Generator</h1>
        
        <div className="space-y-6">
          <div className="p-6 border rounded-lg bg-gray-50">
            <h2 className="text-lg font-semibold mb-4">Generate SQL for Default Users</h2>
            <Button 
              onClick={generateDefaultHashes}
              disabled={loading}
              className="bg-[#B23A3A] hover:bg-[#8B2E2E]"
            >
              {loading ? 'Generating...' : 'Generate SQL Script'}
            </Button>
            
            {hash && !password && (
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">Copy and run this SQL in Supabase:</p>
                <textarea 
                  value={hash}
                  readOnly
                  className="w-full h-96 p-4 font-mono text-xs border rounded bg-white"
                  onClick={(e) => e.currentTarget.select()}
                />
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(hash);
                    alert('Copied to clipboard!');
                  }}
                  className="mt-2"
                  variant="outline"
                >
                  Copy to Clipboard
                </Button>
              </div>
            )}
          </div>

          <div className="p-6 border rounded-lg">
            <h2 className="text-lg font-semibold mb-4">Generate Custom Hash</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Password</label>
                <Input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                />
              </div>
              
              <Button 
                onClick={generateHash}
                disabled={!password || loading}
              >
                {loading ? 'Generating...' : 'Generate Hash'}
              </Button>
              
              {hash && password && (
                <div className="mt-4">
                  <p className="text-sm font-medium mb-2">Bcrypt Hash:</p>
                  <textarea 
                    value={hash}
                    readOnly
                    className="w-full h-24 p-3 font-mono text-xs border rounded"
                    onClick={(e) => e.currentTarget.select()}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
