export function normalizeOpenLibraryId(mediaId) {
    let value = decodeURIComponent(String(mediaId || '')).trim();
    if (!value) return '';

    try {
        if (value.startsWith('http://') || value.startsWith('https://')) {
            value = new URL(value).pathname;
        }
    } catch {
        return '';
    }

    if (/^OL\d+[A-Z]$/i.test(value)) return `/works/${value}`;
    if (/^\/?(works|books)\/OL\d+[A-Z]$/i.test(value)) {
        return value.startsWith('/') ? value : `/${value}`;
    }

    return value.startsWith('/') ? value : `/${value}`;
}
