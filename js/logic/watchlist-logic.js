import {
    filterMediaItems
} from '../core/media.js';

export function calculatePagination(
    items,
    currentPage,
    pageSize,
    filterType
) {

    const filtered = filterMediaItems(
        items,
        filterType
    );

    const totalFilteredItems = filtered.length;

    const totalPages =
        Math.ceil(totalFilteredItems / pageSize) || 1;

    let boundedCurrentPage = currentPage;

    if (boundedCurrentPage < 1) {
        boundedCurrentPage = 1;
    }

    if (boundedCurrentPage > totalPages) {
        boundedCurrentPage = totalPages;
    }

    const startIndex =
        (boundedCurrentPage - 1) * pageSize;

    const endIndex = startIndex + pageSize;

    const paginatedItems = filtered.slice(
        startIndex,
        endIndex
    );

    return {
        paginatedItems,
        totalPages,
        boundedCurrentPage,
        totalFilteredItems
    };
}
