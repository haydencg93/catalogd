function slugify(name) {
    return name
        .toLowerCase()
        // Step 1: Normalize special characters (ū -> u, ō -> o, etc.)
        .normalize('NFD') 
        .replace(/[\u0300-\u036f]/g, '') 
        // Step 2: Remove "the", "of", "on"
        .replace(/\b(the|of|on)\b/g, '')
        // Step 3: Remove remaining special characters and format dashes
        .replace(/[^a-z0-9 ]/g, '')
        .trim()
        .replace(/\s+/g, '-');
}

// This check allows the file to work in both Node and the Browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { slugify };
}