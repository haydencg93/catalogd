const { getFillerData } = require('../../animeFillerListApi/scraper');

async function run() {
    const anime = process.argv[2];

    const manualAfl = process.argv[3] || null;
    const manualAfg = process.argv[4] || null;

    if (!anime) {
        console.error(
            'Usage: node test-scraper.js "<anime name or slug>" [AnimeFillerList URL/slug] [AnimeFillerGuide URL/slug]'
        );
        process.exit(1);
    }

    console.log('\n========================================');
    console.log(`Testing scraper for: ${anime}`);
    console.log('========================================\n');

    try {
        const result = await getFillerData(
            anime,
            manualAfl,
            manualAfg
        );

        console.dir(result, {
            depth: null,
            colors: true
        });

        console.log('\n========================================');
        console.log('SUMMARY');
        console.log('========================================');

        if (result.error) {
            console.log('Overall result: FAILED');
            console.log('Error:', result.error);
            return;
        }

        console.log('Schema version:', result.schema_version);
        console.log('Partial result:', result.partial);
        console.log(
            'Status:',
            result.source_status_message
        );

        console.log(
            'Anime:',
            result.anime
        );

        console.log(
            'Total episodes:',
            result.total_episodes
        );

        console.log(
            'Detected episodes:',
            result.detected_episode_count
        );

        console.log(
            'Merged episode count:',
            result.episodes?.length || 0
        );

        console.log(
            'Season count:',
            result.seasons?.length || 0
        );

        console.log(
            'Media markers:',
            result.media?.length || 0
        );

        console.log(
            'Numbering matches:',
            result.source_alignment?.numbering_matches
        );

        console.log(
            'AnimeFillerList classifications used:',
            result.source_alignment
                ?.anime_filler_list_classifications_used
        );

        if (
            result.source_alignment?.warning
        ) {
            console.log(
                'Alignment warning:',
                result.source_alignment.warning
            );
        }

        console.log('\nFirst 10 merged episodes:');

        console.table(
            (result.episodes || [])
                .slice(0, 10)
                .map(ep => ({
                    episode: ep.number,
                    season: ep.season,
                    title: ep.title,
                    type: ep.type,
                    typeSource: ep.type_source,
                    chapters: ep.manga_chapters
                }))
        );

        console.log('\nSeasons:');

        console.table(
            (result.seasons || []).map(
                season => ({
                    season: season.number,
                    name: season.name,
                    episodeCount:
                        season.detected_episode_count,
                    statedEpisodes:
                        season.episode_count,
                    opening:
                        season.opening,
                    ending:
                        season.ending,
                    mangaRange:
                        season.manga_range
                })
            )
        );

        if (
            result.media?.length
        ) {
            console.log('\nMovies / OVAs / Specials:');

            console.table(
                result.media.map(
                    item => ({
                        type:
                            item.media_type,
                        title:
                            item.title,
                        season:
                            item.season,
                        afterEpisode:
                            item.after_episode,
                        beforeEpisode:
                            item.before_episode
                    })
                )
            );
        }

        console.log('\nContinuation information:');

        console.dir(
            result.continuation,
            {
                depth: null,
                colors: true
            }
        );
    } catch (error) {
        console.error('\nTEST CRASHED');
        console.error(error);
        process.exit(1);
    }
}

run();