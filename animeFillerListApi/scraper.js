const axios = require('axios');
const cheerio = require('cheerio');

async function getFillerData(animeSlug, manualSlug = null) {
    const { slugify } = require('./utils');
    
    const scrape = async (slug) => {
        const url = `https://www.animefillerlist.com/shows/${slug}`;
        try {
            const { data } = await axios.get(url);
            const $ = cheerio.load(data);
            const episodes = [];

            $('table.EpisodeList tr').each((i, el) => {
                const number = $(el).find('td.Number').text().trim();
                const title = $(el).find('td.Title a').text().trim();
                const type = $(el).find('td.Type span').text().trim();
                if (number && title) episodes.push({ number, title, type });
            });

            return episodes.length > 0 ? { anime: slug, total_episodes: episodes.length, episodes } : null;
        } catch (error) {
            return null; 
        }
    };

    // --- LOGIC FLOW ---

    // 1. If user provided a manual slug, ONLY test that one
    if (manualSlug) {
        console.log(`Attempting user-provided manual slug: ${manualSlug}`);
        const result = await scrape(manualSlug);
        if (result) return result;
        return { error: "User-provided link was invalid or page not found." };
    }
    
    // 2. Try the "Raw" slug first 
    console.log(`Attempting raw slug: ${animeSlug}`);
    let result = await scrape(animeSlug);

    // 3. Try the "Clean" slugify version
    if (!result) {
        const cleanSlug = slugify(animeSlug);
        if (cleanSlug !== animeSlug) { 
            console.log(`Raw failed. Attempting clean slug: ${cleanSlug}`);
            result = await scrape(cleanSlug);
        }
    }

    // 4. Final verdict
    if (result) return result;
    return { error: "Anime not found or site structure changed." };
}

module.exports = { getFillerData };