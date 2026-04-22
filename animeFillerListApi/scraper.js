const axios = require('axios');
const cheerio = require('cheerio');

async function getFillerData(animeSlug) {
    const { slugify } = require('./utils');
    
    // Function to actually do the scraping
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
            return null; // Return null on 404 or other errors
        }
    };

    // --- LOGIC FLOW ---
    
    // 1. Try the "Raw" slug first (handles names that already have dashes)
    console.log(`Attempting raw slug: ${animeSlug}`);
    let result = await scrape(animeSlug);

    // 2. If it failed, try the "Clean" slugify version
    if (!result) {
        const cleanSlug = slugify(animeSlug);
        if (cleanSlug !== animeSlug) { // Only retry if the slug is actually different
            console.log(`Raw failed. Attempting clean slug: ${cleanSlug}`);
            result = await scrape(cleanSlug);
        }
    }

    // 3. Final verdict
    if (result) return result;
    return { error: "Anime not found or site structure changed." };
}

module.exports = { getFillerData };