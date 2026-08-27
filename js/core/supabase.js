import { loadConfig } from './config.js';

let clientPromise;

export function getSupabaseClient() {
    if (!clientPromise) {
        clientPromise = loadConfig().then((config) => {
            if (!window.supabase?.createClient) {
                throw new Error('Supabase client library is unavailable');
            }

            return window.supabase.createClient(config.supabase_url, config.supabase_key);
        });
    }

    return clientPromise;
}
