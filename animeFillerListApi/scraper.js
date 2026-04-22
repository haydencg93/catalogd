const axios = require('axios');
const cheerio = require('cheerio');

async function getFillerData(animeSlug) {
    const url = `https://www.animefillerlist.com/shows/${animeSlug}`;
    
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const episodes = [];

        // AnimeFillerList organizes episodes in a table with specific classes
        $('table.EpisodeList tr').each((i, el) => {
            const number = $(el).find('td.Number').text().trim();
            const title = $(el).find('td.Title a').text().trim();
            const type = $(el).find('td.Type span').text().trim(); // "Filler" or "Manga Canon"

            if (number && title) {
                episodes.push({ number, title, type });
            }
        });

        return { 
            anime: animeSlug, // Change animeName to animeSlug
            total_episodes: episodes.length, 
            episodes 
        };
    } catch (error) {
        console.error(error.message); // Add this to see the REAL error in your terminal
        return { error: "Anime not found or site structure changed." };
    }
}

module.exports = { getFillerData };