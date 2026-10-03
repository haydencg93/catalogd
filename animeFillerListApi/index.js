const path = require('node:path');

require('dotenv').config({
    path: path.join(__dirname, '../misc/.env')
});

const { createClient } = require('@supabase/supabase-js');
const { getFillerData } = require('./scraper');

// ============================================================
// CLI / runtime configuration
// ============================================================

const cliArgs = process.argv.slice(2);

// Allow either:
// DRY_RUN=true node index.js ...
//
// or:
//
// node index.js ... --dry-run
const DRY_RUN =
    String(process.env.DRY_RUN || '').toLowerCase() === 'true' ||
    cliArgs.includes('--dry-run');

const positionalArgs = cliArgs.filter(
    arg => arg !== '--dry-run'
);

// CLI layout:
//
// node index.js "Anime Name"
//
// OR:
//
// node index.js "Anime Name" "AFL URL/slug" "AFG URL/slug"
//
// OR:
//
// node index.js "Anime Name" "AFL URL/slug" "AFG URL/slug" --dry-run
const manualInput = positionalArgs[0] || null;
const cliManualAfl = positionalArgs[1] || null;
const cliManualAfg = positionalArgs[2] || null;

// ============================================================
// Supabase
// ============================================================

const supabaseUrl =
    process.env.SUPABASE_URL;

const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

/*
 * In dry-run mode we intentionally DO NOT require Supabase
 * credentials and we DO NOT create a Supabase client.
 */
if (!DRY_RUN) {
    if (
        !supabaseUrl ||
        !supabaseServiceKey
    ) {
        console.error(
            'CRITICAL ERROR: Missing Supabase environment variables.'
        );

        process.exit(1);
    }

    supabase =
        createClient(
            supabaseUrl,
            supabaseServiceKey
        );
}

// ============================================================
// Helpers
// ============================================================

function isSourceSuccessful(
    fillerResult,
    sourceKey
) {
    return (
        fillerResult?.sources?.[sourceKey]?.status ===
        'success'
    );
}

function hasUsableFillerContent(
    fillerResult
) {
    return (
        fillerResult &&
        !fillerResult.error &&
        Array.isArray(fillerResult.episodes) &&
        fillerResult.episodes.length > 0
    );
}

/**
 * Preserve the last known successful source result if one source
 * temporarily fails during an update.
 *
 * IMPORTANT:
 *
 * The preserved snapshot is NOT silently re-applied to the new
 * merged episode list.
 *
 * This matters because stale AnimeFillerList canon information
 * must not override AnimeFillerGuide when the current scrape says
 * the sources no longer align.
 *
 * We preserve it only for diagnostics / future recovery.
 */
function preservePreviousSuccessfulSources(
    currentResult,
    previousContent
) {
    if (
        !currentResult ||
        !previousContent ||
        typeof previousContent !== 'object'
    ) {
        return currentResult;
    }

    if (
        currentResult.schema_version !== 2 ||
        previousContent.schema_version !== 2
    ) {
        return currentResult;
    }

    const sourceKeys = [
        'anime_filler_list',
        'anime_filler_guide'
    ];

    for (const sourceKey of sourceKeys) {
        const currentSource =
            currentResult.sources?.[sourceKey];

        const previousSource =
            previousContent.sources?.[sourceKey];

        if (
            !currentSource ||
            !previousSource
        ) {
            continue;
        }

        const currentSucceeded =
            currentSource.status === 'success';

        const previousSucceeded =
            previousSource.status === 'success';

        if (
            !currentSucceeded &&
            previousSucceeded
        ) {
            currentSource.previous_successful_snapshot = {
                preserved_at:
                    new Date().toISOString(),

                source:
                    previousSource
            };
        }
    }

    return currentResult;
}

function buildDatabaseNotes(
    fillerResult
) {
    if (!fillerResult) {
        return 'Scraper returned no result.';
    }

    if (fillerResult.error) {
        return fillerResult.error;
    }

    if (fillerResult.partial) {
        return (
            fillerResult.source_status_message ||
            'Partial scrape completed.'
        );
    }

    return (
        fillerResult.source_status_message ||
        'Successfully scraped.'
    );
}

function printDryRunSummary(
    originalName,
    fillerResult
) {
    console.log('\n========================================');
    console.log('DRY RUN - NO SUPABASE WRITE');
    console.log('========================================');

    console.log(
        'Anime:',
        originalName
    );

    console.log(
        'Schema version:',
        fillerResult?.schema_version
    );

    console.log(
        'Partial:',
        fillerResult?.partial
    );

    console.log(
        'Status:',
        fillerResult?.source_status_message ||
        fillerResult?.error
    );

    console.log(
        'Total episodes:',
        fillerResult?.total_episodes
    );

    console.log(
        'Merged episodes:',
        fillerResult?.episodes?.length || 0
    );

    console.log(
        'Seasons:',
        fillerResult?.seasons?.length || 0
    );

    console.log(
        'Media markers:',
        fillerResult?.media?.length || 0
    );

    console.log(
        'AFL status:',
        fillerResult?.sources
            ?.anime_filler_list
            ?.status
    );

    console.log(
        'AFG status:',
        fillerResult?.sources
            ?.anime_filler_guide
            ?.status
    );

    console.log(
        'Episode numbering matches:',
        fillerResult?.source_alignment
            ?.numbering_matches
    );

    console.log(
        'AFL classifications used:',
        fillerResult?.source_alignment
            ?.anime_filler_list_classifications_used
    );

    if (
        fillerResult?.source_alignment
            ?.warning
    ) {
        console.log(
            'Alignment warning:',
            fillerResult
                .source_alignment
                .warning
        );
    }

    console.log('\nFirst 15 merged episodes:');

    console.table(
        (fillerResult?.episodes || [])
            .slice(0, 15)
            .map(ep => ({
                episode:
                    ep.number,

                season:
                    ep.season,

                title:
                    ep.title,

                type:
                    ep.type,

                typeSource:
                    ep.type_source,

                chapters:
                    ep.manga_chapters
            }))
    );

    console.log('\nDatabase-style notes value:');

    console.log(
        buildDatabaseNotes(
            fillerResult
        )
    );

    console.log(
        '\nNothing was sent to Supabase.'
    );

    console.log('========================================\n');
}

// ============================================================
// Scrape + save
// ============================================================

async function saveAnimeData(
    originalName,
    requestId = null,
    manualSlug = null,
    manualGuideSlug = null,
    previousContent = null
) {
    console.log(
        `\n--- Processing: ${originalName} ---`
    );

    if (manualSlug) {
        console.log(
            'AnimeFillerList manual override:',
            manualSlug
        );
    }

    if (manualGuideSlug) {
        console.log(
            'AnimeFillerGuide manual override:',
            manualGuideSlug
        );
    }

    // --------------------------------------------------------
    // Run both source scrapers through scraper.js
    // --------------------------------------------------------

    let fillerResult =
        await getFillerData(
            originalName,
            manualSlug,
            manualGuideSlug
        );

    // --------------------------------------------------------
    // Preserve previous successful source snapshots
    // --------------------------------------------------------

    fillerResult =
        preservePreviousSuccessfulSources(
            fillerResult,
            previousContent
        );

    // --------------------------------------------------------
    // Dry run stops here.
    // --------------------------------------------------------

    if (DRY_RUN) {
        printDryRunSummary(
            originalName,
            fillerResult
        );

        return fillerResult;
    }

    // --------------------------------------------------------
    // Total failure
    // --------------------------------------------------------

    if (
        !hasUsableFillerContent(
            fillerResult
        )
    ) {
        const failureMessage =
            buildDatabaseNotes(
                fillerResult
            );

        console.error(
            `Scrape failed for ${originalName}: ${failureMessage}`
        );

        /*
         * If this came from the queue, update ONLY its status.
         *
         * Existing filler_content is intentionally retained.
         * That way a temporary total failure does not destroy
         * previously usable data.
         */
        if (requestId) {
            const {
                error: failureUpdateError
            } =
                await supabase
                    .from(
                        'filler_list_mgnt'
                    )
                    .update({
                        notes:
                            failureMessage
                    })
                    .eq(
                        'id',
                        requestId
                    );

            if (failureUpdateError) {
                console.error(
                    'Failed to save scrape failure status:',
                    failureUpdateError
                );
            }
        }

        return fillerResult;
    }

    // --------------------------------------------------------
    // Determine individual source success
    // --------------------------------------------------------

    const aflSucceeded =
        isSourceSuccessful(
            fillerResult,
            'anime_filler_list'
        );

    const afgSucceeded =
        isSourceSuccessful(
            fillerResult,
            'anime_filler_guide'
        );

    const notes =
        buildDatabaseNotes(
            fillerResult
        );

    // --------------------------------------------------------
    // Build database payload
    // --------------------------------------------------------

    const dbPayload = {
        name:
            originalName,

        filler_exists:
            true,

        filler_content:
            fillerResult,

        notes
    };

    /*
     * Only clear a source's manual override if that
     * particular source succeeded.
     *
     * If it failed, leave the supplied manual value intact
     * so it can be inspected/corrected later.
     */
    if (aflSucceeded) {
        dbPayload.manual_slug =
            null;
    } else if (manualSlug) {
        dbPayload.manual_slug =
            manualSlug;
    }

    if (afgSucceeded) {
        dbPayload.manual_guide_slug =
            null;
    } else if (manualGuideSlug) {
        dbPayload.manual_guide_slug =
            manualGuideSlug;
    }

    // --------------------------------------------------------
    // Save
    // --------------------------------------------------------

    const {
        error: saveError
    } =
        await supabase
            .from(
                'filler_list_mgnt'
            )
            .upsert(
                dbPayload,
                {
                    onConflict:
                        'name'
                }
            );

    if (saveError) {
        console.error(
            `Database update failed for ${originalName}:`,
            saveError
        );

        throw saveError;
    }

    if (fillerResult.partial) {
        console.log(
            `Database Updated with PARTIAL scrape: ${originalName}`
        );

        console.log(
            fillerResult
                .source_status_message
        );
    } else {
        console.log(
            `Database Updated with COMPLETE scrape: ${originalName}`
        );
    }

    return fillerResult;
}

// ============================================================
// Queue worker
// ============================================================

async function runWorker() {
    /*
     * CLI/manual execution:
     *
     * node index.js "Hunter x Hunter"
     *
     * node index.js \
     *   "Hunter x Hunter" \
     *   "AFL URL" \
     *   "AFG URL"
     *
     * PowerShell users should keep this on one line
     * or use PowerShell backticks.
     */
    if (
        manualInput &&
        manualInput.trim() !== ''
    ) {
        console.log(
            `Manual Input Detected: "${manualInput}"`
        );

        await saveAnimeData(
            manualInput,
            null,
            cliManualAfl,
            cliManualAfg,
            null
        );

        return;
    }

    /*
     * Dry-run queue processing makes no sense because it would
     * require connecting to Supabase to discover the queue.
     *
     * Require an anime name when --dry-run is active.
     */
    if (DRY_RUN) {
        console.error(
            'Dry-run mode requires an anime name.'
        );

        console.error(
            'Example:'
        );

        console.error(
            'node index.js "Hunter x Hunter" --dry-run'
        );

        process.exitCode = 1;

        return;
    }

    console.log(
        'No manual input. Checking Supabase queue for pending requests...'
    );

    const {
        data: queue,
        error
    } =
        await supabase
            .from(
                'filler_list_mgnt'
            )
            .select('*')
            .is(
                'notes',
                null
            );

    if (error) {
        console.error(
            'Error fetching queue:',
            error
        );

        return;
    }

    if (
        !queue ||
        queue.length === 0
    ) {
        console.log(
            'Queue is empty. Nothing to do.'
        );

        return;
    }

    console.log(
        `Found ${queue.length} pending requests.`
    );

    for (const item of queue) {
        try {
            await saveAnimeData(
                item.name,
                item.id,

                // Existing AnimeFillerList override
                item.manual_slug ||
                null,

                // New AnimeFillerGuide override
                item.manual_guide_slug ||
                null,

                // Preserve any previous scraper information
                item.filler_content ||
                null
            );
        } catch (error) {
            /*
             * One broken anime should not stop the entire
             * scheduled queue.
             */
            console.error(
                `Unexpected worker failure for ${item.name}:`,
                error
            );
        }
    }

    console.log(
        '--- Worker Task Complete ---'
    );
}

// ============================================================
// Start
// ============================================================

runWorker().catch(error => {
    console.error(
        'Fatal worker error:',
        error
    );

    process.exitCode = 1;
});