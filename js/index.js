// Import shared components
import "./components/AppLoader.js";

// Import necessary modules and functions
import { loadConfig as fetchConfig } from "./core/config.js";
import { getSupabaseClient } from "./core/supabase.js";
import { normalizeOpenLibraryId, filterMediaItems, renderMediaBadge } from "./core/media.js";

import {
    INDEX_TRENDING_LIMIT,
    INDEX_FOR_YOU_LIMIT,
    indexScope,
    mediaKey,
    classifyIndexItems,
    fetchIndexTrending,
    indexHistory,
    indexTaste,
    fetchIndexForYou,
} from "./logic/index-feed.js";
import {
    calculateWeight,
    evaluateProviderAvailability,
    sortSearchResults,
    resolveBookImage,
    attributionHtml,
    buildDiscoverUrls,
    backgroundStyle,
    extractYouTubeId,
    normalizeUserItem,
    normalizeTMDBItem,
} from "./logic/index-logic.js";
// Load configuration and initialize Supabase client
let PROXY_URL = "";
let supabaseClient = null;

// Global vars
let isSignUpMode = false;
let currentTab = "movie";
let currentAnimeSubfilter = "all";
let contentRequestId = 0;
let activeContentController = null;
const customImgsMap = new Map();
let userStreamingProviderIds = [];
const fallbackGradient = "linear-gradient(135deg, #2a2f3a, #1b1f27)";
const waitMs = (ms) => new Promise((res) => setTimeout(res, ms));

// DOM element queiries
const searchInput = document.getElementById("search-input");
const resultsGrid = document.getElementById("results-grid");
const loader = document.getElementById("loader");
const indexTabContent = document.getElementById("index-tab-content");
const authModal = document.getElementById("auth-modal");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authConfirmBtn = document.getElementById("auth-confirm-btn");
const authSwitch = document.getElementById("auth-switch");
const closeModal = document.getElementById("close-auth");
const modalTitle = document.getElementById("modal-title");
const authName = document.getElementById("auth-name");
const authUsername = document.getElementById("auth-username");
const authReferral = document.getElementById("auth-referral");
const authRetype = document.getElementById("auth-retype");
const signupFields = document.getElementById("signup-fields");

// ----------------------------------------
// Initialization and Config
// ----------------------------------------
async function loadConfig() {
    try {
        const config = await fetchConfig();

        PROXY_URL = config.proxy_url;

        await checkEmailConfirmation();

        supabaseClient = await getSupabaseClient();

        await checkUserStatus();

        searchInput.disabled = false;
        searchInput.placeholder = "Search for movies, shows, books, authors, ...";
        searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") unifiedSearch(searchInput.value);
        });

        const searchFilter = document.getElementById("search-filter");
        searchFilter.addEventListener("change", () => {
            // If they change the filter while text is in the box, automatically research!
            if (searchInput.value.trim() !== "") {
                unifiedSearch(searchInput.value);
            }
        });

        const urlParams = new URLSearchParams(window.location.search);
        const searchQuery = urlParams.get("search");
        const filterQuery = urlParams.get("filter"); // NEW: Grab the filter from the URL

        // If a filter was passed from the details page, apply it to the dropdown!
        if (filterQuery) {
            document.getElementById("search-filter").value = filterQuery;
        }

        if (searchQuery) {
            searchInput.value = searchQuery;
            unifiedSearch(searchQuery);
        } else {
            loadTabContent("movie");
        }
    } catch (err) {
        console.error("Critical Start Error:", err);

        loader.showMessage(`Error: ${err.message}`);
    }
}

function checkEmailConfirmation() {
    const hash = window.location.hash;
    if (!hash) return;

    // Supabase passes session data and errors in the URL hash fragment
    const hashParams = new URLSearchParams(hash.substring(1));

    if (hashParams.has("error")) {
        const errorDesc = hashParams.get("error_description") || "Unknown error";
        console.error("Email confirmation failed:", errorDesc);
        alert("Failed to confirm email. The link may be invalid or has expired.");

        // Clean the URL so the alert doesn't show again on refresh
        window.history.replaceState(null, null, window.location.pathname + window.location.search);
    } else if (hashParams.has("access_token")) {
        const type = hashParams.get("type");
        // 'signup' handles standard registration, 'invite' handles the queue worker invites
        if (type === "signup" || type === "invite") {
            alert("Email successfully confirmed! Welcome to Catalogd.");
            window.history.replaceState(
                null,
                null,
                window.location.pathname + window.location.search,
            );
        }
    }
}

// ----------------------------------------
// Auth & User Data Management
// ----------------------------------------
async function handleAuth() {
    const email = authEmail.value;
    const password = authPassword.value;
    try {
        if (isSignUpMode) {
            await performSignUp(
                email,
                password,
                authName.value,
                authUsername.value,
                authRetype.value,
                authReferral.value,
            );
        } else {
            await performSignIn(email, password);
        }
    } catch (err) {
        alert(err.message);
    }
}

async function ensureCatalogdFollow(user) {
    if (!user?.id || !supabaseClient) return;

    try {
        const { data: existingProfile, error: profileLookupError } = await supabaseClient
            .from("profiles")
            .select("id")
            .eq("id", user.id)
            .maybeSingle();

        if (profileLookupError && profileLookupError.code !== "PGRST116") {
            console.warn("Unable to verify user profile before auto-follow:", profileLookupError);
            return;
        }

        if (!existingProfile) {
            const usernameSeed = String(
                user.user_metadata?.username ||
                    user.user_metadata?.display_name ||
                    user.email ||
                    "user",
            )
                .trim()
                .replace(/^@/, "")
                .replace(/\s+/g, "")
                .toLowerCase();

            const displayName =
                user.user_metadata?.display_name || user.email?.split("@")[0] || "User";
            const { error: profileInsertError } = await supabaseClient.from("profiles").upsert(
                {
                    id: user.id,
                    username: usernameSeed,
                    display_name: displayName,
                    avatar_url: user.user_metadata?.avatar_url || null,
                },
                { onConflict: "id" },
            );

            if (profileInsertError) {
                console.warn("Unable to create profile row for auto-follow:", profileInsertError);
                return;
            }
        }

        const { data: profileRows, error: officialLookupError } = await supabaseClient
            .from("profiles")
            .select("id, username, display_name")
            .limit(200);

        if (officialLookupError) {
            console.warn(
                "Unable to load profiles for official account lookup:",
                officialLookupError,
            );
            return;
        }

        const normalizeHandle = (value) =>
            String(value || "")
                .toLowerCase()
                .replace(/^@/, "")
                .trim();
        const officialProfile = (profileRows || []).find((profile) => {
            const username = normalizeHandle(profile.username);
            const displayName = normalizeHandle(profile.display_name);
            return (
                username === "catalogd" ||
                displayName === "catalogd" ||
                username === "catalogd official" ||
                displayName === "catalogd official"
            );
        });

        if (!officialProfile) return;

        const { data: existingFollow, error: followCheckError } = await supabaseClient
            .from("follows")
            .select("id")
            .eq("follower_id", user.id)
            .eq("following_id", officialProfile.id)
            .maybeSingle();

        if (followCheckError && followCheckError.code !== "PGRST116") {
            console.warn("Unable to verify default Catalogd follow:", followCheckError);
            return;
        }

        if (existingFollow) return;

        const { error: followInsertError } = await supabaseClient
            .from("follows")
            .insert({ follower_id: user.id, following_id: officialProfile.id });

        if (followInsertError && followInsertError.code !== "23505") {
            console.warn("Unable to auto-follow Catalogd:", followInsertError);
        }
    } catch (err) {
        console.warn("Catalogd follow default failed:", err);
    }
}

async function checkUserStatus() {
    await customElements.whenDefined("app-header");
    const header = document.querySelector("app-header");

    // Call the component's method and pass the custom callback!
    const user = await header.initializeAuth(supabaseClient, () => openAuthModal());

    if (user) {
        await ensureCatalogdFollow(user);

        const { data: customImgs } = await supabaseClient
            .from("custom_imgs")
            .select("*")
            .eq("user_id", user.id);
        if (customImgs) {
            customImgs.forEach((img) =>
                customImgsMap.set(`${img.media_type}_${img.media_id}`, img),
            );
        }

        try {
            const { data: profileServices } = await supabaseClient
                .from("profiles")
                .select("services")
                .eq("id", user.id)
                .single();
            userStreamingProviderIds = (
                (profileServices &&
                    profileServices.services &&
                    profileServices.services.streaming) ||
                []
            ).map(String);
        } catch (e) {
            userStreamingProviderIds = [];
        }
    }
}

async function performSignUp(email, password, name, username, retype, referral) {
    if (!email || !password || !name || !username || !referral)
        return alert("Please fill in all fields.");
    if (password !== retype) return alert("Passwords do not match!");
    if (password.length < 6) return alert("Password must be at least 6 characters.");

    // 1. Verify the Referral Code matches the master config (ID = 1)
    const { data: configRow, error: configError } = await supabaseClient
        .from("email_managament")
        .select("referral")
        .eq("id", 1)
        .single();

    if (configError || configRow?.referral !== referral) {
        return alert("Invalid referral code.");
    }

    // 2. Check the Rate Limit (Rolling 1-Hour Window)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Count all successfully processed emails in the last hour
    const { count, error: countError } = await supabaseClient
        .from("email_managament")
        .select("*", { count: "exact", head: true })
        .gte("time_stamp_curr", oneHourAgo)
        .eq("done", true);

    if (countError) return alert("Error checking server capacity.");

    // Supabase's default SMTP server only allows 2 emails per hour
    if (count >= 2) {
        // LIMIT MET: Safely queue the invite and discard the password
        const { error: insertError } = await supabaseClient.from("email_managament").insert({
            person_id: email,
            action: "invite_scheduled",
            referral,
        });

        if (insertError) throw insertError;

        alert(
            "Due to high traffic, we have reserved your spot! You will receive an invite link via email shortly to complete your account setup.",
        );
        closeAuthModal();
        return;
    }

    // 3. LIMIT NOT MET: Proceed with standard Sign-Up
    const { data: signUpData, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { display_name: name, username } },
    });

    if (error) throw error;

    // Log the successful action to keep the rate limit count accurate
    await supabaseClient.from("email_managament").insert({
        person_id: email,
        action: "signup",
        done: true,
        success: true,
        referral,
    });

    if (signUpData?.user) {
        await ensureCatalogdFollow(signUpData.user);
    }

    alert("Success! Check your email for a confirmation link.");
    closeAuthModal();
}

async function performSignIn(email, password) {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    closeAuthModal();
    await checkUserStatus();
}

async function handleForgotPassword() {
    const email = authEmail.value;
    if (!email) {
        alert("Please enter your email address first.");
        authEmail.focus();
        return;
    }
    try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: new URL("settings.html", document.baseURI).href,
        });
        if (error) throw error;
        alert("Success! Check your email for a password reset link.");
        closeAuthModal();
    } catch (err) {
        alert(`Error: ${err.message}`);
    }
}

// ----------------------------------------
// API Data Fetching
// ----------------------------------------
async function loadTabContent(type, subtype = currentAnimeSubfilter) {
    const controller = beginContentRequest();
    const signal = controller.signal;
    const requestId = ++contentRequestId;
    const isCurrent = () => requestId === contentRequestId && !signal.aborted;
    const scope = indexScope(type, subtype);
    const supportsForYou = ["movie", "tv", "anime"].includes(type);
    const supportsVibe = ["movie", "tv", "anime", "book", "album"].includes(type);

    // =========================================
    // 1. CLEAR PREVIOUS CONTENT AND SHOW LOADER
    // =========================================
    document.getElementById("section-title").style.display = "none";
    document.querySelector(".filter-nav").style.display = "flex";
    syncAnimeSubfilters();

    // Hide the entire feed before preparing new content.
    indexTabContent.hidden = true;

    // Remove the previous tab's Vibe and media cards.
    document.querySelector(".vibe-container")?.remove();
    resultsGrid.replaceChildren();
    resultsGrid.setAttribute("aria-busy", "true");

    // Activate the reusable Catalogd loader.
    loader.start();

    // Prevent an indefinitely stalled request.
    const timeout = setTimeout(() => {
        if (!isCurrent()) return;
        controller.abort();
        loader.showMessage("Loading took too long. Select the tab again to retry.");
        resultsGrid.setAttribute("aria-busy", "false");
    }, 120000);
    signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });

    try {
        // =========================================
        // 2. CHECK USER SESSION
        // =========================================
        const { data, error } = await supabaseClient.auth.getSession();
        if (!isCurrent()) return;
        if (error) throw error;
        const user = data.session?.user || null;
        const trendingLimit =
            supportsForYou && user
                ? INDEX_TRENDING_LIMIT + INDEX_FOR_YOU_LIMIT
                : INDEX_TRENDING_LIMIT;

        // =========================================
        // 3. FETCH ALL THREE SECTIONS CONCURRENTLY
        // =========================================
        const settled = await Promise.allSettled([
            getTrendingItems(type, subtype, signal, trendingLimit),
            supportsForYou && user
                ? fetchIndexForYou(
                      supabaseClient,
                      user.id,
                      PROXY_URL,
                      scope,
                      userStreamingProviderIds,
                      signal,
                  )
                : Promise.resolve([]),
            supportsVibe && user
                ? calculateIndexVibe(type, requestId, subtype, signal)
                : Promise.resolve(null),
        ]);
        if (!isCurrent()) return;

        // =========================================
        // 4. PROCESS COMPLETED RESULTS
        // =========================================
        const failures = [];
        function resultAt(index, fallback, label) {
            const result = settled[index];
            if (result.status === "fulfilled") {
                return result.value ?? fallback;
            }
            console.error(`${label} loading failed:`, result.reason);
            failures.push(label);
            return fallback;
        }
        const trendingPool = resultAt(0, [], "Trending");
        const forYouItems = resultAt(1, [], "For You");
        const vibe = resultAt(2, null, "Your Vibe");

        // =========================================
        // 5. REMOVE DUPLICATE TITLES
        // =========================================
        const forYouIds = new Set(forYouItems.map(mediaKey));
        const trendingItems = trendingPool
            .filter((item) => !forYouIds.has(mediaKey(item)))
            .slice(0, INDEX_TRENDING_LIMIT);
        const combined = [...forYouItems, ...trendingItems];

        // =========================================
        // 6. BUILD EVERYTHING OFF-SCREEN
        // =========================================
        const stagingGrid = document.createElement("div");
        renderResults(combined, stagingGrid, true);
        const vibeNode = vibe ? buildIndexVibe(vibe) : null;

        // =========================================
        // 7. WAIT FOR EVERY IMAGE
        // =========================================
        await Promise.all([
            prepareIndexImages(stagingGrid, signal),
            prepareIndexImages(vibeNode, signal),
        ]);
        if (!isCurrent()) return;

        // =========================================
        // 8. PREPARE ANY STATUS MESSAGES
        // =========================================
        if (failures.length || !combined.length) {
            const message = document.createElement("p");
            message.className = "meta";
            message.style.cssText = "grid-column: 1/-1; text-align: center;";
            message.textContent = failures.length
                ? `${failures.join(", ")} could not be loaded.`
                : "No titles found.";
            stagingGrid.prepend(message);
        }

        // =========================================
        // 9. REVEAL ALL CONTENT TOGETHER
        // =========================================
        // Insert the Vibe inside the hidden tab container,
        // directly above the media grid.
        if (vibeNode) {
            resultsGrid.before(vibeNode);
        }

        // Insert all prepared media cards.
        resultsGrid.replaceChildren(...stagingGrid.childNodes);

        // Stop and hide the reusable Catalogd loader.
        loader.stop();

        // Reveal the entire completed feed.
        indexTabContent.hidden = false;
        resultsGrid.setAttribute("aria-busy", "false");

        // Only display the services reminder
        // after the complete feed is visible.
        if (supportsForYou && user) {
            maybeShowServicesNudge(isCurrent);
        }
    } catch (error) {
        if (!isCurrent()) return;
        console.error("Index feed loading failed:", error);
        loader.showMessage("Failed to load Catalogd. Select the tab to retry.");
        resultsGrid.setAttribute("aria-busy", "false");
    } finally {
        clearTimeout(timeout);
    }
}

async function unifiedSearch(query) {
    const signal = beginContentRequest().signal;
    const requestId = ++contentRequestId;
    const filterNav = document.querySelector(".filter-nav");
    const filterValue = document.getElementById("search-filter").value;
    const sectionTitle = document.getElementById("section-title");

    if (!query?.trim()) {
        const url = new URL(window.location);
        url.searchParams.delete("search");
        window.history.pushState({}, "", url);
        if (filterNav) filterNav.style.display = "flex";
        if (currentTab === "youtube") {
            switchTab("youtube");
        } else {
            syncAnimeSubfilters();
            loadTabContent(currentTab, currentAnimeSubfilter);
        }
        return;
    }

    const extractedId = extractYouTubeId(query);
    if (extractedId || currentTab === "youtube") {
        if (extractedId) {
            window.location.href = `details.html?id=${extractedId}&type=youtube`;
        } else {
            loader.showMessage("Please enter a valid YouTube URL.");
        }
        return;
    }

    if (filterNav) {
        filterNav.style.display = "none";
    }

    const animeNav = document.getElementById("anime-subfilters");
    if (animeNav) {
        animeNav.hidden = true;
    }

    document.querySelector(".vibe-container")?.remove();

    // Global search uses the same content container.
    indexTabContent.hidden = false;

    if (sectionTitle) {
        sectionTitle.textContent = `Search Results for "${query}"`;

        sectionTitle.style.display = "block";
    }

    loader.start("Exploring the archives...");
    resultsGrid.innerHTML = "";

    try {
        const payload = {
            tmdbRes: { results: [] },
            bookData: [],
            authorData: [],
            users: [],
            lastfmAlbums: [],
        };
        await fetchSearchData(query, filterValue, payload);
        if (requestId !== contentRequestId) return;

        const seenNames = new Set();
        const mappedUsers = payload.users.map((u) => normalizeUserItem(u));
        const processedAuthors = payload.authorData.filter((author) => {
            const nameKey = author.title.toLowerCase();
            if (seenNames.has(nameKey)) return false;
            seenNames.add(nameKey);
            return true;
        });

        const classifiedTMDBResults = await classifyIndexItems(
            payload.tmdbRes.results || [],
            PROXY_URL,
            signal,
        );

        if (requestId !== contentRequestId || signal.aborted) {
            return;
        }

        const tmdbResults = classifiedTMDBResults
            .map((item) => normalizeTMDBItem(item, filterValue, seenNames))
            .filter(Boolean);

        let combined = [
            ...mappedUsers,
            ...processedAuthors,
            ...tmdbResults,
            ...payload.bookData,
            ...payload.lastfmAlbums,
        ];

        if (["movie", "tv"].includes(filterValue)) {
            // Intentional exception:
            // Search includes anime in the original
            // Movie and TV categories.
            combined = filterMediaItems(combined, filterValue, {
                includeAnimeInBaseTypes: true,
            });
        } else if (filterValue === "anime") {
            combined = filterMediaItems(combined, "anime");
        } else if (filterValue !== "all") {
            combined = combined.filter((item) => item.type === filterValue);
        }

        sortSearchResults(combined, query);
        if (combined.length === 0) {
            loader.showMessage("No results found.");
        } else {
            renderResults(combined);
            loader.stop();
        }
    } catch (err) {
        if (signal.aborted || err.name === "AbortError") {
            return;
        }
        if (requestId !== contentRequestId) return;
        console.error("Search failed:", err);
        loader.showMessage("Search failed.");
    }
}

async function fetchSearchData(query, filterValue, payload) {
    const fetchPromises = [];

    if (filterValue === "anime") {
        const animeRequest = Promise.all(
            ["movie", "tv"].map((type) =>
                contentFetch(
                    `${PROXY_URL}/api/tmdb/search/${type}?query=${encodeURIComponent(query)}`,
                )
                    .then((r) => r.json())
                    .then((data) =>
                        (data.results || []).map((item) => ({
                            ...item,
                            media_type: type,
                        })),
                    ),
            ),
        ).then((results) => {
            payload.tmdbRes = {
                results: results.flat(),
            };
        });

        fetchPromises.push(animeRequest);
    } else if (["all", "movie", "tv", "person"].includes(filterValue)) {
        const endpoint = filterValue === "all" ? "search/multi" : `search/${filterValue}`;

        fetchPromises.push(
            contentFetch(`${PROXY_URL}/api/tmdb/${endpoint}?query=${encodeURIComponent(query)}`)
                .then((r) => r.json())
                .then((data) => {
                    payload.tmdbRes = {
                        ...data,
                        results: (data.results || []).map((item) => ({
                            ...item,
                            media_type: item.media_type || filterValue,
                        })),
                    };
                }),
        );
    }
    if (["all", "book"].includes(filterValue)) {
        fetchPromises.push(fetchBooks(query).then((d) => (payload.bookData = d)));
    }
    if (["all", "author"].includes(filterValue)) {
        fetchPromises.push(fetchAuthors(query).then((d) => (payload.authorData = d)));
    }
    if (["all", "user"].includes(filterValue)) {
        fetchPromises.push(
            supabaseClient
                .from("profiles")
                .select("id, username, display_name, avatar_url")
                .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
                .limit(10)
                .then((res) => (payload.users = res.data || [])),
        );
    }
    if (["all", "album"].includes(filterValue)) {
        fetchPromises.push(
            contentFetch(
                `${PROXY_URL}/api/lastfm?method=album.search&album=${encodeURIComponent(query)}`,
            )
                .then((r) => r.json())
                .then((res) => {
                    if (res.results?.albummatches?.album) {
                        payload.lastfmAlbums = res.results.albummatches.album.map((a) => ({
                            id: encodeURIComponent(`${a.artist}|||${a.name}`),
                            title: a.name,
                            type: "album",
                            image:
                                a.image?.[3]?.["#text"] ||
                                "https://via.placeholder.com/500x750?text=No+Image",
                            author: a.artist,
                        }));
                    }
                })
                .catch((err) => console.error("Last.fm search error:", err)),
        );
    }
    await Promise.all(fetchPromises);
}

// Fetch Books
async function fetchBooks(query) {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=50`;
    const res = await contentFetch(url);
    const data = await res.json();
    return (data.docs || []).map((doc) => {
        const author = doc.author_name?.[0] || null;
        const image = doc.cover_i
            ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
            : `https://via.placeholder.com/500x750?text=${encodeURIComponent(doc.title)}`;

        return {
            title: doc.title,
            year: doc.first_publish_year,
            author,
            image,
            type: "book",
            id: doc.key,
        };
    });
}

// Authors Search
async function fetchAuthors(query) {
    const url = `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=5`;
    try {
        const res = await contentFetch(url);
        const data = await res.json();

        const seenAuthorNames = new Set();
        return (data.docs || [])
            .map((doc) => {
                const nameKey = doc.name.toLowerCase();
                if (seenAuthorNames.has(nameKey)) return null;
                seenAuthorNames.add(nameKey);

                const image = doc.key
                    ? `https://covers.openlibrary.org/a/olid/${doc.key}-M.jpg`
                    : `https://ui-avatars.com/api/?name=${encodeURIComponent(doc.name)}&background=1b2228&color=9ab&size=512`;

                return {
                    title: doc.name,
                    year: "Author",
                    image,
                    type: "author",
                    id: doc.key,
                };
            })
            .filter(Boolean);
    } catch (e) {
        return [];
    }
}

async function getTrendingItems(type, subtype = "all", signal, limit = INDEX_TRENDING_LIMIT) {
    if (type === "book") {
        return (await fetchTrendingBooks(signal)).slice(0, limit);
    }

    if (type === "album") {
        return (await fetchTrendingAlbums(signal)).slice(0, limit);
    }

    if (["movie", "tv", "anime"].includes(type)) {
        return fetchIndexTrending(
            PROXY_URL,

            indexScope(type, subtype),

            signal,

            limit,
        );
    }

    return [];
}

// Books Trending
async function fetchTrendingBooks(signal) {
    let res = await contentFetch(
        `https://openlibrary.org/trending/daily.json?limit=${INDEX_TRENDING_LIMIT}`,
        { signal },
    );
    let text = await res.text();
    if (text.trim().startsWith("<")) {
        res = await contentFetch(
            `https://openlibrary.org/search.json?q=subject:fiction&sort=editions&limit=${INDEX_TRENDING_LIMIT}`,
            { signal },
        );
        text = await res.text();
    }
    const data = JSON.parse(text);
    const itemsList = data.works || data.docs || [];

    return itemsList.map((work) => ({
        title: work.title,
        year: work.first_publish_year || work.publish_year?.[0] || "",
        author: work.author_name?.[0] || null,
        image: resolveBookImage(work),
        type: "book",
        id: work.key,
        isTrending: true,
    }));
}

// Music Trending
async function fetchTrendingAlbums(signal) {
    const res = await contentFetch(
        `${PROXY_URL}/api/lastfm?method=tag.gettopalbums&tag=pop&limit=${INDEX_TRENDING_LIMIT}`,
        { signal },
    );
    const data = await res.json();
    return (data.albums.album || []).map((a) => {
        let img = "https://via.placeholder.com/500x750?text=No+Image";
        if (a.image?.[3]?.["#text"]) img = a.image[3]["#text"];
        const compositeId = encodeURIComponent(`${a.artist.name}|||${a.name}`);

        return {
            title: a.name,
            year: "",
            author: a.artist?.name || null,
            image: img,
            type: "album",
            id: compositeId,
            isTrending: true,
            trendingLabel: "Popular",
        };
    });
}

// ----------------------------------------
// Data Processing & Business Logic
// ----------------------------------------
async function calculateIndexVibe(mediaType, requestId, subtype = "all", signal) {
    const isCurrent = () => requestId === contentRequestId && !signal?.aborted;
    try {
        const {
            data: { user },
            error: authError,
        } = await supabaseClient.auth.getUser();
        if (!isCurrent() || !user) return;
        if (authError) throw authError;
        const scope = indexScope(mediaType, subtype);
        let topGenre = "";
        let topTheme = "";

        if (["movie", "tv", "anime"].includes(mediaType)) {
            // Vibes reflect the selected category's
            // actual history rather than borrowing.
            const logs = await indexHistory(supabaseClient, user.id, scope, false);
            if (!isCurrent()) return;
            const taste = await indexTaste(logs, PROXY_URL, signal, mediaType === "anime");
            topGenre = taste.topGenre;
            topTheme = taste.topTheme;
        } else if (["book", "album"].includes(mediaType)) {
            // Preserve existing Book and Music
            // Vibe calculations.
            const { data: logs, error } = await supabaseClient
                .from("media_logs")
                .select("media_id, media_type, rating")
                .eq("user_id", user.id)
                .eq("media_type", mediaType)
                .gte("rating", 4)
                .order("rating", {
                    ascending: false,
                })
                .order("created_at", {
                    ascending: false,
                })
                .limit(25);

            if (error) throw error;

            if (!isCurrent()) return;

            if (mediaType === "book") {
                topGenre = await tallyBookVibe(logs || [], signal);
            } else {
                topGenre = await tallyAlbumVibe(logs || [], signal);
            }
        }

        if (!isCurrent()) return;

        console.log(`[VIBE] ${scope.vibeKey}`, {
            genre: topGenre,
            theme: topTheme,
        });

        return await prepareIndexVibeFromDB(
            scope.vibeKey,
            topGenre,
            topTheme,
            requestId,
            signal,
            user.id,
        );
    } catch (error) {
        if (signal?.aborted || error.name === "AbortError") {
            return;
        }

        throw error;
    }
}

async function prepareIndexVibeFromDB(mediaType, genreName, themeName, requestId, signal, userId) {
    const isCurrent = () => requestId === contentRequestId && !signal?.aborted;
    if (!isCurrent()) return;
    if (!genreName && !themeName) {
        return null;
    }
    const cleanGenre = (genreName || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
    const cleanTheme = (themeName || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
    try {
        // Retry if another tab or the nightly
        // worker updates the Vibe queue concurrently.
        for (let attempt = 0; attempt < 4; attempt++) {
            if (!isCurrent()) return;
            const { data: vibeData, error } = await supabaseClient
                .from("vibes_control")
                .select("*")
                .eq("user_id", userId)
                .maybeSingle();
            if (error) throw error;
            if (!isCurrent()) return;
            if (!vibeData) {
                const { error: insertError } = await supabaseClient.from("vibes_control").upsert(
                    {
                        user_id: userId,
                        needs_update: true,
                        new_top_genre: {
                            [mediaType]: cleanGenre,
                        },
                        new_top_theme: {
                            [mediaType]: cleanTheme,
                        },
                    },
                    {
                        onConflict: "user_id",
                        ignoreDuplicates: true,
                    },
                );

                if (insertError) {
                    throw insertError;
                }
                // Retrieve the row again so
                // existing queued keys are preserved.
                continue;
            }
            const queued = await processVibeQueueUpdate(
                vibeData,
                mediaType,
                cleanGenre,
                cleanTheme,
            );
            if (!queued) continue;
            if (!isCurrent()) return;

            // Only display cached images that
            // correspond to the CURRENT Vibe labels.
            const genreMatches = cleanGenre === (vibeData.current_top_genre?.[mediaType] || "");
            const themeMatches = cleanTheme === (vibeData.current_top_theme?.[mediaType] || "");
            const genreImg = genreMatches ? vibeData.image_genre?.[mediaType] || "" : "";
            const themeImg = themeMatches ? vibeData.image_theme?.[mediaType] || "" : "";
            const genreAttrText = genreMatches
                ? vibeData.image_genre_attribution?.[mediaType]
                : null;
            const themeAttrText = themeMatches
                ? vibeData.image_theme_attribution?.[mediaType]
                : null;
            const genreAttr = genreAttrText
                ? {
                      text: genreAttrText,
                      url: vibeData.image_genre_attribution_url?.[mediaType] || null,
                  }
                : null;
            const themeAttr = themeAttrText
                ? {
                      text: themeAttrText,
                      url: vibeData.image_theme_attribution_url?.[mediaType] || null,
                  }
                : null;
            return {
                genreName: cleanGenre,
                themeName: cleanTheme,
                genreImg,
                themeImg,
                genreAttr,
                themeAttr,
            };
        }

        throw new Error("Unable to update the Vibe queue after multiple attempts.");
    } catch (error) {
        console.error("Failed to load or queue Vibe:", error);

        // The calculated Vibe is still useful
        // without its cached images.
        if (!isCurrent()) return null;

        return {
            genreName: cleanGenre,
            themeName: cleanTheme,
            genreImg: "",
            themeImg: "",
            genreAttr: null,
            themeAttr: null,
        };
    }
}

async function processVibeQueueUpdate(vibeData, mediaType, cleanGenre, cleanTheme) {
    const updatedNewGenre = {
        ...(vibeData.new_top_genre || {}),
    };

    const updatedNewTheme = {
        ...(vibeData.new_top_theme || {}),
    };

    function queueValue(queue, current, key, value) {
        if (Object.hasOwn(queue, key)) {
            if (queue[key] === value) {
                return false;
            }
        } else if ((current?.[key] || "") === value) {
            return false;
        }
        queue[key] = value;
        return true;
    }

    const genreChanged = queueValue(
        updatedNewGenre,
        vibeData.current_top_genre,
        mediaType,
        cleanGenre,
    );

    const themeChanged = queueValue(
        updatedNewTheme,
        vibeData.current_top_theme,
        mediaType,
        cleanTheme,
    );

    if (!genreChanged && !themeChanged) {
        return true;
    }

    let query = supabaseClient
        .from("vibes_control")
        .update({
            needs_update: true,
            new_top_genre: updatedNewGenre,
            new_top_theme: updatedNewTheme,
        })
        .eq("id", vibeData.id);

    // Only update if the queue has not changed
    // since we retrieved the original row.
    for (const column of ["new_top_genre", "new_top_theme"]) {
        query =
            vibeData[column] == null
                ? query.is(column, null)
                : query.eq(column, JSON.stringify(vibeData[column]));
    }

    const { data, error } = await query.select("id");
    if (error) throw error;

    return Boolean(data?.length);
}

// Book Vibe Tallying
async function tallyBookVibe(logs, signal) {
    const bookCounts = {};
    const bookPromises = logs.map((log) =>
        contentFetch(`https://openlibrary.org${normalizeOpenLibraryId(log.media_id)}.json`, {
            signal,
        })
            .then((r) => r.json())
            .catch((error) => {
                if (error.name === "AbortError") throw error;
                return null;
            }),
    );
    const booksData = await Promise.all(bookPromises);

    booksData.forEach((book, index) => {
        if (book?.subjects) {
            const r = logs[index].rating;
            const w = calculateWeight(r);
            book.subjects.forEach((s) => {
                const subjectName = typeof s === "string" ? s : s.name || "";
                if (subjectName) {
                    const cleanName = subjectName.toLowerCase().trim();
                    bookCounts[cleanName] = (bookCounts[cleanName] || 0) + w;
                }
            });
        }
    });
    const sortedBooks = Object.keys(bookCounts).sort((a, b) => bookCounts[b] - bookCounts[a]);
    return sortedBooks.length > 0 ? sortedBooks[0] : "";
}

// Album Vibe Tallying
async function tallyAlbumVibe(logs, signal) {
    const musicCounts = {};
    const musicPromises = logs.map((log) => {
        const decodedId = decodeURIComponent(log.media_id);
        const [artist, album] = decodedId.split("|||");
        return contentFetch(
            `${PROXY_URL}/api/lastfm?method=album.getinfo&artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`,
            { signal },
        )
            .then((r) => r.json())
            .catch(() => null);
    });
    const musicData = await Promise.all(musicPromises);

    musicData.forEach((res, index) => {
        if (res?.album?.tags?.tag) {
            const r = logs[index].rating;
            const w = calculateWeight(r);
            res.album.tags.tag.forEach((t) => {
                if (t.name) {
                    const cleanName = t.name.toLowerCase().trim();
                    musicCounts[cleanName] = (musicCounts[cleanName] || 0) + w;
                }
            });
        }
    });
    const sortedMusic = Object.keys(musicCounts).sort((a, b) => musicCounts[b] - musicCounts[a]);
    return sortedMusic.length > 0 ? sortedMusic[0] : "";
}

function maybeShowServicesNudge(isCurrent = () => true) {
    if (!isCurrent()) return;
    if (userStreamingProviderIds.filter(Boolean).length > 0) return;
    if (localStorage.getItem("catalogd_services_nudge_dismissed") === "true") return;
    if (document.getElementById("services-nudge-modal")) return;

    supabaseClient.auth
        .getUser()
        .then(({ data: { user } }) => {
            if (!user || !isCurrent() || document.getElementById("services-nudge-modal")) {
                return;
            }

            const modal = document.createElement("div");
            modal.id = "services-nudge-modal";

            modal.style.cssText =
                "position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; justify-content: center; align-items: center; z-index: 9999; backdrop-filter: blur(5px);";

            modal.innerHTML = `
            <div class="auth-card" style="max-width: 380px; background: #1b2228; padding: 40px; border-radius: 16px; text-align: center; border: 1px solid #2c3440; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
                <h2 style="margin-top:0; color: #fff;">Get Picks You Can Watch</h2>
                <p class="meta" style="margin-bottom: 25px; color: #9ab; line-height: 1.5; font-size: 0.95rem;">
                    Add your streaming services in Settings so your "For You" recommendations
                    only include movies and shows available on platforms you actually have.
                </p>
                <button id="services-nudge-goto" class="primary-btn" style="background: var(--accent); color: #000; border: none; padding: 12px 20px; border-radius: 20px; font-weight: bold; cursor: pointer; width: 100%; font-size: 1rem; transition: transform 0.2s;">Go to Settings</button>
                <p id="services-nudge-dismiss" style="color:#9ab; cursor:pointer; font-size:0.85rem; margin-top:20px; text-decoration: underline; transition: color 0.2s;">Maybe later</p>
            </div>
        `;
            document.body.appendChild(modal);

            document.getElementById("services-nudge-goto").onclick = () => {
                window.location.href = "settings.html";
            };
            document.getElementById("services-nudge-dismiss").onclick = () => {
                localStorage.setItem("catalogd_services_nudge_dismissed", "true");
                modal.remove();
            };

            // Add native hover effects to the dismiss text
            document.getElementById("services-nudge-dismiss").onmouseover = (e) =>
                (e.target.style.color = "#fff");
            document.getElementById("services-nudge-dismiss").onmouseout = (e) =>
                (e.target.style.color = "#9ab");
        })
        .catch((err) => {
            console.warn("Nudge check failed:", err);
        });
}

// =========================================
// INDEX IMAGE PREPARATION
// =========================================
const indexPosterFallback = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 750"><rect width="500" height="750" fill="#1b2228"/><text x="250" y="375" text-anchor="middle" fill="#9ab" font-size="26" font-family="sans-serif">No Image</text></svg>',
)}`;

function waitForIndexImage(image, signal, timeout = 12000) {
    if (signal.aborted) {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        let done = false;

        const timer = setTimeout(() => finish(false), timeout);

        function finish(ok) {
            if (done) return;

            done = true;

            clearTimeout(timer);

            signal.removeEventListener("abort", cancel);

            image.removeEventListener("load", loaded);

            image.removeEventListener("error", cancel);

            resolve(ok);
        }

        function cancel() {
            finish(false);
        }

        async function loaded() {
            try {
                await image.decode();

                finish(image.naturalWidth > 0);
            } catch {
                finish(false);
            }
        }

        signal.addEventListener("abort", cancel, { once: true });

        image.addEventListener("load", loaded, { once: true });

        image.addEventListener("error", cancel, { once: true });

        // Cached images may already be ready.

        if (image.complete) {
            if (image.naturalWidth > 0) {
                loaded();
            } else {
                finish(false);
            }
        }
    });
}

async function prepareIndexImages(root, signal) {
    if (!root) return;

    await Promise.all(
        [...root.querySelectorAll("img")].map(async (image) => {
            const ok = await waitForIndexImage(image, signal);

            if (ok || signal.aborted) return;

            if (image.classList.contains("vibe-background")) {
                // Failed Vibe images retain
                // the original gradient.

                const half = image.parentElement;

                image.remove();

                half.querySelector(".vibe-attribution, .vibe-attribution-link")?.remove();
            } else {
                // Use a local placeholder instead
                // of requesting another external image.

                image.src = indexPosterFallback;

                await waitForIndexImage(image, signal, 2000);
            }
        }),
    );
}

// ----------------------------------------
// UI Rendering
// ----------------------------------------
function renderResults(items, targetGrid = resultsGrid, prepareImages = false) {
    targetGrid.innerHTML = "";

    items.forEach((item) => {
        const card = document.createElement("div");
        card.className = "media-card";
        card.dataset.type = item.type;

        card.onclick = () => {
            if (item.type === "person") window.location.href = `cast.html?personId=${item.id}`;
            else if (item.type === "author") window.location.href = `cast.html?authorId=${item.id}`;
            else if (item.type === "user") window.location.href = `profile.html?id=${item.id}`;
            else
                window.location.href = `details.html?id=${encodeURIComponent(item.id)}&type=${item.type}`;
        };

        let finalImage = item.image;
        const customArt = customImgsMap.get(`${item.type}_${String(item.id)}`);
        if (customArt && customArt.custom_poster) finalImage = customArt.custom_poster;

        // Display badges based on the flags embedded inside the item data
        const trendingBadge =
            item.isTrending && item.type !== "user"
                ? `<div class="trending-label">${item.trendingLabel || "Trending Today"}</div>`
                : "";
        const userBadge = item.type === "user" ? `<div class="trending-label">Member</div>` : "";
        const forYouBadge = item.isForYou ? `<div class="foryou-label">For You</div>` : "";

        card.innerHTML = `
            <div class="poster-wrapper">
                ${trendingBadge}
                ${userBadge}
                ${forYouBadge}
                <img alt="${item.title}"
                    loading="${prepareImages ? "eager" : "lazy"}"
                    decoding="async">
                ${
                    ["person", "author", "user"].includes(item.type)
                        ? `<span class="badge badge-${item.type}">${item.type}</span>`
                        : renderMediaBadge(item)
                }
            </div>
            <div class="media-info">
                <div class="title">${item.title}</div>
                ${item.author ? `<div class="meta" style="color: var(--accent); font-weight: 500;">${item.author}</div>` : ""}
                <div class="meta">${item.year || ""}</div>
            </div>`;
        const poster = card.querySelector("img");

        if (!prepareImages) {
            poster.addEventListener(
                "error",

                () => {
                    poster.src = indexPosterFallback;
                },

                { once: true },
            );
        }

        poster.src = finalImage || indexPosterFallback;

        targetGrid.appendChild(card);
    });
}

function buildIndexVibe(vibe) {
    let { genreName, themeName, genreImg, themeImg, genreAttr, themeAttr } = vibe;

    // Support meaningful themes even if the
    // title has no eligible primary genre.

    if (!genreName && themeName) {
        genreName = themeName;
        genreImg = themeImg;
        genreAttr = themeAttr;

        themeName = "";
        themeImg = "";
        themeAttr = null;
    }

    if (!genreName) return null;

    const vibeContainer = document.createElement("div");

    vibeContainer.className = "vibe-container";

    if (themeName) {
        vibeContainer.innerHTML = `

            <div class="vibe-title">
                Your Vibe
            </div>

            <div class="vibe-box">

                <div class="vibe-half"
                     style="${backgroundStyle("", fallbackGradient)}">

                    <span class="vibe-text">
                        ${genreName}
                    </span>

                    ${attributionHtml(genreAttr)}

                </div>

                <div class="vibe-half"
                     style="${backgroundStyle("", fallbackGradient)}">

                    <span class="vibe-text">
                        ${themeName}
                    </span>

                    ${attributionHtml(themeAttr)}

                </div>

                <div class="vibe-blend"></div>

            </div>
        `;
    } else {
        vibeContainer.innerHTML = `

            <div class="vibe-title">
                Your Vibe
            </div>

            <div class="vibe-box">

                <div class="vibe-half"
                     style="${backgroundStyle("", fallbackGradient)}; flex: 100%;">

                    <span class="vibe-text">
                        ${genreName}
                    </span>

                    ${attributionHtml(genreAttr)}

                </div>

            </div>
        `;
    }

    // Prepare the actual image elements rather
    // than loading CSS backgrounds after rendering.

    const halves = vibeContainer.querySelectorAll(".vibe-half");

    [genreImg, themeImg].forEach((url, index) => {
        if (!url || !halves[index]) return;

        const image = document.createElement("img");

        image.className = "vibe-background";

        image.alt = "";

        image.loading = "eager";

        image.decoding = "async";

        image.src = url;

        halves[index].prepend(image);
    });

    // Return the finished element without
    // inserting it into the visible document.
    return vibeContainer;
}

function syncAnimeSubfilters() {
    const nav = document.getElementById("anime-subfilters");

    if (!nav) return;

    nav.hidden = currentTab !== "anime";

    nav.querySelectorAll("[data-anime-subfilter]").forEach((button) => {
        const active = button.dataset.animeSubfilter === currentAnimeSubfilter;

        button.classList.toggle("active", active);

        button.setAttribute("aria-pressed", String(active));
    });
}

function switchAnimeSubfilter(subtype) {
    if (currentTab !== "anime") {
        return;
    }

    if (!["all", "movie", "tv"].includes(subtype)) {
        return;
    }

    if (currentAnimeSubfilter === subtype) {
        return;
    }

    currentAnimeSubfilter = subtype;

    syncAnimeSubfilters();

    loadTabContent("anime", currentAnimeSubfilter);
}

// ----------------------------------------
// Event Listeners
// ----------------------------------------
window.switchTab = function (type) {
    if (searchInput.disabled) return;

    currentTab = type;

    // Always reset Anime to All when switching
    // between the main media tabs.

    currentAnimeSubfilter = "all";

    document.querySelectorAll("[data-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === type);
    });

    const filterNav = document.querySelector(".filter-nav");

    if (filterNav) {
        filterNav.style.display = "flex";
    }

    syncAnimeSubfilters();

    searchInput.value = "";

    const sectionTitle = document.getElementById("section-title");

    if (type === "youtube") {
        // Cancel the previous feed request.
        abortContentRequest();
        contentRequestId++;
        loader.stop();
        indexTabContent.hidden = false;
        searchInput.placeholder = "Paste a YouTube link here...";

        if (sectionTitle) {
            sectionTitle.style.display = "block";
            sectionTitle.textContent = "Add a YouTube Video";
        }

        resultsGrid.innerHTML = `
            <p class="meta"
               style="grid-column: 1/-1; text-align: center;">
                Paste a valid YouTube URL in the search bar above to log it!
            </p>
        `;

        document.querySelector(".vibe-container")?.remove();
    } else {
        searchInput.placeholder =
            type === "album"
                ? "Search for albums or artists..."
                : "Search for movies, shows, anime, books, authors, ...";

        loadTabContent(type, currentAnimeSubfilter);
    }
};

document.addEventListener("mousemove", (e) => {
    // Only run this animation if the screen width is greater than 768px (Desktop)
    if (window.innerWidth <= 768) return;

    const cards = document.querySelectorAll(".media-card");

    cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left; // Mouse position inside card
        const y = e.clientY - rect.top;

        // Calculate tilt
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = (y - centerY) / 20; // Adjust 20 for intensity
        const rotateY = (centerX - x) / 20;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
    });
});

// Reset tilt when mouse leaves
document.addEventListener("mouseleave", () => {
    // Only run this animation if the screen width is greater than 768px (Desktop)
    if (window.innerWidth <= 768) return;

    const cards = document.querySelectorAll(".media-card");
    cards.forEach((card) => {
        card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)";
    });
});

authConfirmBtn.addEventListener("click", handleAuth);
closeModal.addEventListener("click", closeAuthModal);
document.querySelectorAll("[data-navigation]").forEach((button) => {
    button.addEventListener("click", () => {
        window.location.href = button.dataset.navigation;
    });
});
document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
});
document.querySelectorAll("[data-anime-subfilter]").forEach((button) => {
    button.addEventListener(
        "click",

        () => switchAnimeSubfilter(button.dataset.animeSubfilter),
    );
});
document.getElementById("forgot-password-link")?.addEventListener("click", handleForgotPassword);
authSwitch.addEventListener("click", toggleAuthMode);

// Auth Modal
function openAuthModal() {
    authModal.style.display = "flex";
}
function closeAuthModal() {
    authModal.style.display = "none";
}

function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    modalTitle.textContent = isSignUpMode ? "Create Account" : "Welcome Back";
    authConfirmBtn.textContent = isSignUpMode ? "Sign Up" : "Sign In";
    authSwitch.textContent = isSignUpMode
        ? "Already have an account? Sign In"
        : "Need an account? Sign Up";
    signupFields.style.display = isSignUpMode ? "block" : "none";
    authRetype.style.display = isSignUpMode ? "block" : "none";
}

function beginContentRequest() {
    abortContentRequest();
    activeContentController = new AbortController();
    return activeContentController;
}

function abortContentRequest() {
    activeContentController?.abort();

    // Hide any active loader or previous status message.
    loader.stop();
    resultsGrid.setAttribute("aria-busy", "false");
}

function contentFetch(url, options = {}) {
    return fetch(url, {
        ...options,

        signal: options.signal ?? activeContentController?.signal,
    });
}

function throwIfContentAborted() {
    if (activeContentController?.signal.aborted)
        throw new DOMException("Content request superseded", "AbortError");
}

loadConfig();
