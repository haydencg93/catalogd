import { getSupabaseClient } from './core/supabase.js';

async function checkUserStatus() {
    const supabaseClient = await getSupabaseClient();
    
    // Wait for the web component to render before selecting it
    await customElements.whenDefined('app-header');
    const header = document.querySelector('app-header');
    
    // Calls the method to evaluate auth state and display the profile menu
    await header.initializeAuth(supabaseClient);
}

checkUserStatus();