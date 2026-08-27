const configPath = 'config/config.json';
let configPromise;

function validateConfig(config) {
    const requiredFields = ['supabase_url', 'supabase_key'];
    const missingFields = requiredFields.filter((field) => !config?.[field]);

    if (missingFields.length > 0) {
        throw new Error(`Missing configuration: ${missingFields.join(', ')}`);
    }

    return config;
}

export function loadConfig() {
    if (!configPromise) {
        configPromise = fetch(configPath, { credentials: 'same-origin' })
            .then((response) => {
                if (!response.ok) throw new Error(`Unable to load ${configPath}`);
                return response.json();
            })
            .then(validateConfig);
    }

    return configPromise;
}
