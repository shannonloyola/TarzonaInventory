import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

function getEnvSupabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

// Extend Window interface to include our global Supabase client
declare global {
  interface Window {
    __TARZONA_SUPABASE_CLIENT__?: SupabaseClient;
    __TARZONA_SUPABASE_INITIALIZING__?: boolean;
  }
}

export function initSupabase(config: SupabaseConfig, persistLocal = true): SupabaseClient {
  // Return existing client if already initialized
  if (window.__TARZONA_SUPABASE_CLIENT__) {
    return window.__TARZONA_SUPABASE_CLIENT__;
  }

  // Prevent multiple initializations
  if (window.__TARZONA_SUPABASE_INITIALIZING__) {
    throw new Error('Supabase is already being initialized');
  }

  window.__TARZONA_SUPABASE_INITIALIZING__ = true;

  try {
    // Compatibility mode: keep manual session handling until Supabase Auth cutover is explicitly enabled.
    window.__TARZONA_SUPABASE_CLIENT__ = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: false, // We handle sessions manually
        autoRefreshToken: false,
        storage: undefined, // Don't use any storage to prevent auth conflicts
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });
    
    if (persistLocal) {
      localStorage.setItem('supabase_config', JSON.stringify(config));
    }
    
    return window.__TARZONA_SUPABASE_CLIENT__;
  } finally {
    window.__TARZONA_SUPABASE_INITIALIZING__ = false;
  }
}

export function getSupabase(): SupabaseClient {
  if (window.__TARZONA_SUPABASE_CLIENT__) {
    return window.__TARZONA_SUPABASE_CLIENT__;
  }

  // Prefer environment variables when available to avoid stale localStorage config.
  // This keeps local development aligned with the current .env file.
  const envConfig = getEnvSupabaseConfig();
  if (envConfig) {
    return initSupabase(envConfig, false);
  }

  // Try to restore from localStorage
  const configStr = localStorage.getItem('supabase_config');
  if (configStr) {
    const config: SupabaseConfig = JSON.parse(configStr);
    return initSupabase(config);
  }
  
  throw new Error('Supabase not initialized. Please configure in Admin Developer Setup.');
}

export function isSupabaseConfigured(): boolean {
  return !!localStorage.getItem('supabase_config') || !!getEnvSupabaseConfig();
}

export function clearSupabaseConfig(): void {
  localStorage.removeItem('supabase_config');
  window.__TARZONA_SUPABASE_CLIENT__ = undefined;
}

// Test connection by fetching one profile
export async function testConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username')
      .limit(1);
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    return { success: true };
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Unknown error' 
    };
  }
}
