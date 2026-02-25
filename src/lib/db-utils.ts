import { getSupabase } from './supabase';

export type TransactionType =
  | 'add_product'
  | 'edit_product'
  | 'archive_product'
  | 'archive_all'
  | 'delete_product'
  | 'delete_all'
  | 'export'
  | 'profile_edit'
  | 'permission_change'
  | 'beginning_set'
  | 'stock_in'
  | 'stock_out';

export interface ActivityLogEntry {
  snapshot_date: string; // YYYY-MM-DD
  actor_profile_id: string;
  actor_username: string;
  actor_role: string;
  txn_type: TransactionType;
  product_id?: string | null;
  product_name?: string | null;
  qty_delta?: number | null;
  before_beginning?: number | null;
  after_beginning?: number | null;
  before_in?: number | null;
  after_in?: number | null;
  before_out?: number | null;
  after_out?: number | null;
  before_end?: number | null;
  after_end?: number | null;
  note?: string | null;
}

export interface SessionData {
  profile_id: string;
  username: string;
  full_name: string;
  role: 'admin' | 'staff';
  email?: string | null;
}

export async function logActivity(entry: ActivityLogEntry): Promise<void> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('inventory_transactions')
      .insert({
        snapshot_date: entry.snapshot_date,
        actor_profile_id: entry.actor_profile_id,
        actor_username: entry.actor_username,
        actor_role: entry.actor_role,
        product_id: entry.product_id,
        product_name: entry.product_name,
        txn_type: entry.txn_type,
        qty_delta: entry.qty_delta,
        before_beginning: entry.before_beginning,
        after_beginning: entry.after_beginning,
        before_in: entry.before_in,
        after_in: entry.after_in,
        before_out: entry.before_out,
        after_out: entry.after_out,
        before_end: entry.before_end,
        after_end: entry.after_end,
        note: entry.note,
      });
    
    if (error) {
      console.error('Failed to log activity:', error);
    }
  } catch (err) {
    console.error('Activity logging error:', err);
  }
}

export function getSession(): SessionData | null {
  const sessionStr = localStorage.getItem('tarzona_session');
  if (!sessionStr) return null;
  try {
    return JSON.parse(sessionStr);
  } catch {
    return null;
  }
}

export function setSession(session: SessionData): void {
  localStorage.setItem('tarzona_session', JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem('tarzona_session');
}

export function formatDateForDB(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
