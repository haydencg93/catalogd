export function processFetchedLists(ownedLists, collabRecords, listOwnerId, currentUserId, visitorCollabs, isViewerOwner) {
    const collaborativeLists = (collabRecords || []).map(record => record.media_lists).filter(Boolean);
    const allListsMap = new Map();

    [...(ownedLists || []), ...collaborativeLists].forEach(list => {
        if (!isViewerOwner) {
            const isVisitorOwner = list.user_id === currentUserId;
            const isVisitorCollab = visitorCollabs.has(list.id);
            if (!list.is_public && !isVisitorOwner && !isVisitorCollab) return; 
        }
        allListsMap.set(list.id, list);
    });

    return Array.from(allListsMap.values()).sort((a, b) => {
        const rankA = a.sort_rank ?? 999999;
        const rankB = b.sort_rank ?? 999999;
        if (rankA !== rankB) return rankA - rankB;
        return new Date(b.created_at) - new Date(a.created_at);
    });
}

export function filterListsByCategory(lists, currentListTab, listOwnerId) {
    if (currentListTab === 'owned') {
        return lists.filter(l => l.user_id === listOwnerId && !l.is_tiered);
    } else if (currentListTab === 'shared') {
        return lists.filter(l => l.user_id !== listOwnerId && !l.is_tiered);
    } else if (currentListTab === 'tier') {
        return lists.filter(l => l.is_tiered);
    }
    return [];
}