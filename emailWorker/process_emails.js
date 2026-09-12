const { createClient } = require('@supabase/supabase-js');

// Initialize the Supabase client with the Service Role Key to access the Admin API
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function processEmailQueue() {
  console.log('Starting hourly email queue processor...');

  // 1. Fetch up to 2 pending invites from the queue to respect the hourly limit
  const { data: pendingInvites, error: fetchError } = await supabase
    .from('email_managament')
    .select('*')
    .eq('action', 'invite_scheduled')
    .eq('done', false)
    .order('time_stamp_curr', { ascending: true }) // Process oldest first
    .limit(2);

  if (fetchError) {
    console.error('Error fetching from email_managament:', fetchError);
    process.exit(1);
  }

  if (!pendingInvites || pendingInvites.length === 0) {
    console.log('No pending invites to process. Exiting.');
    process.exit(0);
  }

  console.log(`Found ${pendingInvites.length} pending invites. Processing...`);

  // 2. Loop through the results and send the admin invites
  for (const record of pendingInvites) {
    const targetEmail = record.person_id; // Using person_id for the email string based on your schema plan

    console.log(`Sending invite to: ${targetEmail}`);
    
    // Fire the Admin API invite email
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(targetEmail);

    const isSuccess = !inviteError;

    if (inviteError) {
      console.error(`Failed to send invite to ${targetEmail}:`, inviteError.message);
    } else {
      console.log(`Successfully sent invite to ${targetEmail}`);
    }

    // 3. Update the management table with the results
    const { error: updateError } = await supabase
      .from('email_managament')
      .update({
        done: true,
        success: isSuccess
      })
      .eq('id', record.id);

    if (updateError) {
      console.error(`Failed to update status for record ${record.id}:`, updateError.message);
    }
  }

  console.log('Hourly queue processing complete.');
}

processEmailQueue();