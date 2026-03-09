let supabaseClient = null;

async function initSettings() {
    const response = await fetch('config.json');
    const config = await response.json();
    supabaseClient = supabase.createClient(config.supabase_url, config.supabase_key);

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) { window.location.href = 'index.html'; return; }

    // Prefill current data
    document.getElementById('edit-name').value = user.user_metadata.display_name || '';
    document.getElementById('edit-username').value = user.user_metadata.username || '';

    // --- Update Profile ---
    document.getElementById('save-profile-btn').onclick = async () => {
        const newName = document.getElementById('edit-name').value;
        const newUsername = document.getElementById('edit-username').value;

        const { error } = await supabaseClient.auth.updateUser({
            data: { display_name: newName, username: newUsername }
        });

        if (error) alert(error.message);
        else alert("Profile updated successfully!");
    };

    // --- Change Password ---
    document.getElementById('change-password-btn').onclick = async () => {
        const pass = document.getElementById('new-password').value;
        const confirmPass = document.getElementById('confirm-new-password').value;

        if (pass !== confirmPass) return alert("Passwords do not match!");
        if (pass.length < 6) return alert("Password too short!");

        const { error } = await supabaseClient.auth.updateUser({ password: pass });

        if (error) alert(error.message);
        else {
            alert("Password changed!");
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-new-password').value = '';
        }
    };

    // --- Delete Account ---
    document.getElementById('final-delete-btn').onclick = async () => {
        const password = document.getElementById('delete-confirm-password').value;
        if (!password) return alert("Enter password to confirm deletion.");

        if (confirm("This will permanently delete your data. Continue?")) {
            // Re-auth check
            const { error: authErr } = await supabaseClient.auth.signInWithPassword({
                email: user.email,
                password: password
            });

            if (authErr) return alert("Incorrect password.");

            const { error: delErr } = await supabaseClient.rpc('delete_user_account');
            if (delErr) alert(delErr.message);
            else {
                await supabaseClient.auth.signOut();
                window.location.href = 'index.html';
            }
        }
    };
}

initSettings();