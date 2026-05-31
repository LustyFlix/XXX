const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const xml2js = require('xml2js');
const NodeCache = require('node-cache');
const https = require('https');

// FAST API - IMPROVED BY GEMINI

const app = express();
const PORT = 3000;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// ==================== AXIOS IMPROVEMENTS ====================
const axiosInstance = axios.create({
    timeout: 30000,
    maxRedirects: 5,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    },
    httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000
    }),
    decompress: true
});

async function axiosWithRetry(url, options = {}, retries = 3) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await axiosInstance.get(url, options);
        } catch (error) {
            lastError = error;
            console.log(`[AXIOS] Request failed (attempt ${i + 1}/${retries}): ${error.message}`);
            if (i < retries - 1) {
                const delay = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

// ==================== MIDDLEWARE ====================
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Max-Age", "86400");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[REQUEST] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
    });
    next();
});

app.use((err, req, res, next) => {
    console.error('[ERROR MIDDLEWARE]', err.stack);
    res.status(500).json({ 
        error: "Internal server error",
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Cache config (TTL acts as an absolute expiration, but SWR handles soft refreshes)
const myCache = new NodeCache({ 
    stdTTL: 86400, 
    checkperiod: 3600,
    useClones: false,
    deleteOnExpire: true
});

// ==================== NEW: STALE-WHILE-REVALIDATE HELPER ====================
async function getCachedOrFetch(cacheKey, fetchFunction, res) {
    const cachedItem = myCache.get(cacheKey);

    if (cachedItem) {
        // 1. Serve instantly from cache
        res.json(cachedItem.data);

        // 2. Check if data is "stale" (older than 1 hour)
        const isStale = (Date.now() - cachedItem.timestamp) > (3600 * 1000); 
        
        if (isStale) {
            console.log(`[BACKGROUND] Refreshing stale cache for: ${cacheKey}`);
            // Fire and forget - do not await
            fetchFunction().then(freshData => {
                myCache.set(cacheKey, { data: freshData, timestamp: Date.now() });
                console.log(`[BACKGROUND] Cache refreshed for: ${cacheKey}`);
            }).catch(err => console.error(`[BACKGROUND ERROR]`, err.message));
        }
        return;
    }

    // Hard miss - User waits this one time
    console.log(`[CACHE MISS] Fetching fresh data for: ${cacheKey}`);
    try {
        const freshData = await fetchFunction();
        myCache.set(cacheKey, { data: freshData, timestamp: Date.now() });
        res.json(freshData);
    } catch (error) {
        console.error(`[API ERROR] Failed to fetch data for ${cacheKey}:`, error.message);
        res.status(500).json({ error: "Failed to fetch data", details: error.message });
    }
}

// Helper functions
const safeParseInt = (val, fallback = 0) => {
    if (!val) return fallback;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
};

const extractNumericId = (str) => {
    if (!str) return null;
    const match = str.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
};

const formatTMDBSortableDate = (dateStr) => {
    if (!dateStr) return null;
    const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const parts = dateStr.split(' ');
    if (parts.length < 2) return null;
    const month = months[parts[0].toLowerCase().substring(0, 3)];
    const day = parts[1].padStart(2, '0');
    return month ? `2000-${month}-${day}` : null;
};

// ==================== ROUTES ====================

app.get('/cache/stats', (req, res) => {
    res.json({
        keys: myCache.keys(),
        stats: myCache.getStats(),
        size: myCache.keys().length
    });
});

app.get('/configuration/languages', async (req, res) => {
    try {
        const response = await axios.get('https://api.themoviedb.org/3/configuration/languages?api_key=7789cead69879c44ca9038698525cb39');
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch config', details: error.message });
    }
});

app.get('/configuration/jobs', async (req, res) => {
    try {
        const response = await axios.get('https://api.themoviedb.org/3/configuration/jobs?api_key=7789cead69879c44ca9038698525cb39');
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch config', details: error.message });
    }
});

app.get('/configuration/countries', async (req, res) => {
    try {
        const response = await axios.get('https://api.themoviedb.org/3/configuration/countries?api_key=7789cead69879c44ca9038698525cb39');
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch config', details: error.message });
    }
});

app.get('/genre/tv/list', async (req, res) => {
    try {
        const response = await axios.get('https://api.themoviedb.org/3/genre/tv/list?api_key=7789cead69879c44ca9038698525cb39&language=en-US');
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch config', details: error.message });
    }
});

app.get('/genre/movie/list', async (req, res) => {
    const cacheKey = 'genre_movie_list';
    console.log(`[API] GET /genre/movie/list`);
    
    const scrapeGenres = async () => {
        const response = await axiosWithRetry('https://a.abcdefghijklmnopqrstuvwxyz.workers.dev/?url=https://www.adultdvdempire.com/sitemaps/category/sitemap.xml', {
            timeout: 100000
        });
        
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(response.data);
        const urlArray = Array.isArray(result.urlset.url) ? result.urlset.url : [result.urlset.url];
        
        const categories = urlArray.map(url => {
            const match = url.loc.match(/^\/(\d+)\/category\/(.+?)\.html$/);
            if (match) {
                const id = parseInt(match[1]);
                let name = match[2].replace('-porn-movies', '').replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                return { id, name };
            }
            return null;
        }).filter(cat => cat !== null).sort((a, b) => a.id - b.id);
        
        return { genres: categories };
    };

    await getCachedOrFetch(cacheKey, scrapeGenres, res);
});

app.get('/person/popular', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const cacheKey = `ae_popular_people_page_${page}`;
    console.log(`[API] GET /person/popular - Page: ${page}`);

    const scrapePopularPeople = async (pageNum) => {
        const targetUrl = `https://www.adultempire.com/hottest-pornstars.html?page=${pageNum}&fq=ag_cast_gender%3aF`;
        const proxyUrl = `https://a.abcdefghijklmnopqrstuvwxyz.workers.dev/?url=${encodeURIComponent(targetUrl)}`;
        
        const { data } = await axiosWithRetry(proxyUrl, { timeout: 100000 });
        const $ = cheerio.load(data, { xmlMode: false, decodeEntities: false }); // Cheerio optimization

        const results = [];
        $('#performerlist > div').each((i, el) => {
            const $el = $(el);
            const anchor = $el.find('a[category="Pornstars Home - Popular"]');
            const href = anchor.attr('href');
            const name = anchor.attr('label');
            const aeId = extractNumericId(href);
            const img = $el.find('picture source').first().attr('srcset');

            if (aeId && name) {
                results.push({
                    id: aeId,
                    name: name,
                    original_name: name,
                    known_for_department: "Acting",
                    profile_path: img || "",
                    popularity: 0,
                    adult: false
                });
            }
        });

        const lastPageHref = $('.list-footer .pagination a[aria-label="Go to Last Page"]').attr('href');
        let totalPages = 54;
        if (lastPageHref) {
            const match = lastPageHref.match(/page=(\d+)/);
            if (match) totalPages = safeParseInt(match[1], 54);
        }

        return {
            page: pageNum,
            results: results,
            total_pages: totalPages,
            total_results: results.length * totalPages
        };
    };

    // Use SWR to serve the current page
    await getCachedOrFetch(cacheKey, () => scrapePopularPeople(page), res);

    // PREFETCH NEXT PAGE IN BACKGROUND
    const nextPage = page + 1;
    const nextCacheKey = `ae_popular_people_page_${nextPage}`;
    if (!myCache.has(nextCacheKey) && page < 54) {
        scrapePopularPeople(nextPage).then(data => {
            myCache.set(nextCacheKey, { data, timestamp: Date.now() });
        }).catch(() => {}); // Fail silently in background
    }
});

app.get('/person/:id', async (req, res) => {
    const personId = req.params.id;
    console.log(`[API] GET /person/${personId}`);
    if (isNaN(personId)) return res.status(400).json({ error: "Invalid ID format" });

    const cacheKey = `ae_person_${personId}`;

    const scrapePerson = async () => {
        const targetUrl = `https://www.adultempire.com/${personId}/`;
        const proxyUrl = `https://a.abcdefghijklmnopqrstuvwxyz.workers.dev/?url=${encodeURIComponent(targetUrl)}`;
        
        const { data } = await axiosWithRetry(proxyUrl, { timeout: 100000 });
        const $ = cheerio.load(data, { xmlMode: false, decodeEntities: false }); // Cheerio optimization

        const name = $('h1').text().trim();
        const profilePath = `https://imgs1cdn.adultempire.com/actors/${personId}h.jpg`;

        let alsoKnownAs = [];
        $('.m-b-1').each((i, el) => {
            const text = $(el).text().trim();
            if (text.startsWith('Alias:')) {
                alsoKnownAs = text.replace('Alias:', '').split(',').map(n => n.trim()).filter(n => n !== "");
            }
        });

        const cleanBio = ($('.modal-body.text-md').html() || "").trim();

        const details = {};
        $('.list-unstyled li').each((i, el) => {
            const text = $(el).text();
            if (text.includes(':')) {
                const [key, value] = text.split(':');
                details[key.trim().toLowerCase()] = value.trim();
            }
        });

        const cast = [];
        $('.grid-list .product-card').each((index, el) => {
            if (index < 50) {
                const $el = $(el);
                const titleAnchor = $el.find('.product-details__item-title a');
                const movieHref = titleAnchor.attr('href');
                const movieImg = $el.find('.boxcover img').attr('src');
                
                cast.push({
                    adult: false,
                    backdrop_path: movieImg ? movieImg.replace(/[a-z]\d*(?=\.jpg)/i, 'h') : "",
                    genre_ids: [],
                    id: extractNumericId(movieHref),
                    imdb_id: `nm${extractNumericId(movieHref)}`,
                    title: titleAnchor.text().trim(),
                    original_language: "en",
                    original_title: titleAnchor.text().trim(),
                    overview: "",
                    popularity: "",
                    poster_path: movieImg ? movieImg.replace(/[a-z]\d*(?=\.jpg)/i, 'h') : "",
                    release_date: "",
                    softcore: false,
                    video: false,
                    vote_average: "0.0",
                    vote_count: 0,
                    character: name,
                    credit_id: `credit_${personId}_${index}`,
                    order: index,
                    media_type: "Movie"
                });
            }
        });

        return {
            adult: false,
            also_known_as: alsoKnownAs,
            biography: cleanBio,
            birthday: formatTMDBSortableDate(details['born']) || "2000-01-01",
            deathday: null,
            gender: 1,
            homepage: null,
            id: safeParseInt(personId),
            tmdb_id: safeParseInt(personId),
            known_for_department: "Acting",
            name: name,
            place_of_birth: details['from'] || "",
            popularity: 0,
            profile_path: profilePath,
            combined_credits: { cast: cast, crew: [] },
            measurements: details['measurements'] || "",
            height: details['height'] || "",
        };
    };

    await getCachedOrFetch(cacheKey, scrapePerson, res);
});

app.get('/discover/movie', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const cacheKey = `discover_ae_page_${page}`;
    console.log(`[API] GET /discover/movie - Page: ${page}`);

    const scrapeDiscover = async (pageNum) => {
        const targetUrl = `https://www.adultempire.com/best-selling-porn-videos.html?view=list&page=${pageNum}`;
        const proxyUrl = `https://a.abcdefghijklmnopqrstuvwxyz.workers.dev/?url=${encodeURIComponent(targetUrl)}`;
        
        const { data } = await axiosWithRetry(proxyUrl, { timeout: 100000 });
        const $ = cheerio.load(data, { xmlMode: false, decodeEntities: false }); // Cheerio optimization

        const results = [];
        $('.item-list .list-view-item').each((i, el) => {
            const $el = $(el);
            const titleAnchor = $el.find('.list-view-item-info__title a');
            const href = titleAnchor.attr('href');
            const aeId = extractNumericId(href);

            const voteAverage = $el.find('.rating-stars-avg').first().text().trim() || "0";
            const imgElement = $el.find('.boxcover img');
            let img = imgElement.attr('data-src') || imgElement.attr('src');
            const posterPath = img && !img.includes('blank') ? img.replace(/m\.jpg$/, 'h.jpg') : "";

            let releaseDate = "";
            const releaseText = $el.find('.item-details li:contains("released")').text().replace('released', '').trim();
            if (releaseText) {
                const parts = releaseText.split('/');
                if (parts.length === 3) releaseDate = `${parts[2]}-${parts[0]}-${parts[1]}`;
            }

            if (aeId) {
                results.push({
                    adult: false,
                    backdrop_path: "",
                    genre_ids: [],
                    id: aeId,
                    title: titleAnchor.text().trim(),
                    original_language: "en",
                    original_title: titleAnchor.text().trim(),
                    overview: "",
                    popularity: 0,
                    poster_path: posterPath,
                    release_date: releaseDate,
                    softcore: false,
                    video: false,
                    vote_average: voteAverage ? parseFloat(voteAverage) : 0,
                    vote_count: 0
                });
            }
        });

        const total_pages = safeParseInt($('.pagination a[label="Goto Last Page"]').text().replace(/,/g, ''), 1);
        const total_results = safeParseInt($('.list-page__results strong').text().replace(/,/g, ''), results.length);

        return {
            page: pageNum,
            results: results,
            total_pages,
            total_results
        };
    };

    // Use SWR to serve current page
    await getCachedOrFetch(cacheKey, () => scrapeDiscover(page), res);

    // PREFETCH NEXT PAGE IN BACKGROUND
    const nextPage = page + 1;
    const nextCacheKey = `discover_ae_page_${nextPage}`;
    if (!myCache.has(nextCacheKey)) {
        scrapeDiscover(nextPage).then(data => {
            myCache.set(nextCacheKey, { data, timestamp: Date.now() });
        }).catch(() => {}); 
    }
});

app.get('/movie/:id', async (req, res) => {
    const aeId = req.params.id;
    console.log(`[API] GET /movie/${aeId}`);
    if (isNaN(aeId)) return res.status(400).json({ error: "Invalid ID format" });

    const cacheKey = `ae_movie_${aeId}`;

    const scrapeMovie = async () => {
        const targetUrl = `https://www.adultempire.com/${aeId}/`;
        const proxyUrl = `https://a.abcdefghijklmnopqrstuvwxyz.workers.dev/?url=${encodeURIComponent(targetUrl)}`;
        
        const { data } = await axiosWithRetry(proxyUrl, { timeout: 100000 });
        const $ = cheerio.load(data, { xmlMode: false, decodeEntities: false }); // Cheerio optimization

        const titleElement = $('h1.movie-page__heading__title').clone();
        titleElement.find('span, a, small').remove(); 
        let title = titleElement.text().trim() || $('h1').first().text().trim();

        const synopsis = $('.synopsis-content p').text().trim() || $('.synopsis-content').text().trim();
        const vote_average = $('.rating-stars-avg').first().text().trim() || "0.0";

        // CACHED DOM QUERY: Querying .list-unstyled once is much faster
        const $listUnstyled = $('.list-unstyled');
        
        let releaseDateFormatted = "";
        const releaseText = $listUnstyled.find('li:contains("Released:")').text().replace('Released:', '').trim();
        if (releaseText) {
            const dateObj = new Date(releaseText);
            if (!isNaN(dateObj.getTime())) {
                releaseDateFormatted = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
            }
        }

        const studioLink = $('.movie-page__heading__movie-info a').first();
        const studioName = studioLink.text().trim();
        const studioId = extractNumericId(studioLink.attr('href'));
        
        let poster = $('meta[property="og:image"]').attr('content') || $('#front-cover img').first().attr('src') || "";
        const backCover = poster.replace('h.jpg', 'bh.jpg');

        const cast = [];
        $('.movie-page__content-tags__performers a').each((index, el) => {
            const performerLink = $(el);
            const performerId = extractNumericId(performerLink.attr('href'));
            let name = performerLink.find('.hover-popover-container').contents().first().text().trim() || performerLink.text().trim();
            let profileImg = performerLink.find('.hover-popover-detail img').attr('src') || (performerId ? `https://imgs1cdn.adultempire.com/actors/${performerId}h.jpg` : "");
            
            if (performerId && name) {
                cast.push({
                    adult: false, gender: 1, id: performerId, known_for_department: "Acting",
                    name: name, original_name: name, popularity: 0, profile_path: profileImg,
                    character: name, credit_id: `credit_${aeId}_${index}`, order: index
                });
            }
        });

        const genres = [];
        $('.movie-page__content-tags__categories a').each((i, el) => {
            const genreLink = $(el);
            const genreId = extractNumericId(genreLink.attr('href'));
            const genreName = genreLink.text().trim();
            if (genreId && genreName) genres.push({ id: genreId, name: genreName });
        });

        const backdrops = [];
        $('.screen img[data-bgsrc]').each((i, el) => {
            let imgUrl = $(el).attr('data-bgsrc');
            if (imgUrl) backdrops.push({ file_path: imgUrl.replace('320', '1920').replace('320c', '1920c'), width: 1920, height: 1080 });
        });
        
        if (backdrops.length === 0) {
            $('a.fancy.screen[rel="scenescreenshots"]').each((i, el) => {
                let imgUrl = $(el).attr('href');
                if (imgUrl && imgUrl.includes('720b.jpg')) backdrops.push({ file_path: imgUrl.replace('720b.jpg', '1920c.jpg'), width: 1920, height: 1080 });
            });
        }

        let runtime = 0;
        const lengthText = $listUnstyled.find('li:contains("Length:")').text() || $("small:contains('Length:')").parent().text().trim();
        if (lengthText) {
            const hourMatch = lengthText.match(/(\d+)\s*hr/i);
            const minuteMatch = lengthText.match(/(\d+)\s*min/i);
            runtime = ((hourMatch ? safeParseInt(hourMatch[1]) : 0) * 60) + (minuteMatch ? safeParseInt(minuteMatch[1]) : 0);
        }

        const voteCount = safeParseInt($('e-user-actions[\\:variant="\'like\'"]').attr(':count'), 0);
        const productionYear = $listUnstyled.find('li:contains("Production Year:")').text().replace('Production Year:', '').trim();

        return {
            adult: false,
            backdrop_path: backdrops[0]?.file_path || "",
            belongs_to_collection: null,
            budget: 0,
            genres: genres,
            homepage: targetUrl,
            id: safeParseInt(aeId),
            imdb_id: `tt${safeParseInt(aeId)}`,
            origin_country: ["US"],
            original_language: "en",
            original_title: title,
            overview: synopsis,
            popularity: 0,
            poster_path: poster,
            production_companies: studioId ? [{ id: studioId, logo_path: `https://imgs1cdn.adultempire.com/studio/${studioId}.png`, name: studioName, origin_country: "US" }] : [],
            production_countries: [{ iso_3166_1: "US", name: "United States of America" }],
            release_date: releaseDateFormatted || `${productionYear}-01-01`,
            revenue: 0,
            runtime: runtime,
            softcore: false,
            spoken_languages: [{ english_name: "English", iso_639_1: "en", name: "English" }],
            status: "Released",
            tagline: "",
            title: title,
            video: false,
            vote_average: vote_average,
            vote_count: voteCount,
            credits: {
                cast: cast,
                crew: studioId ? [{ adult: false, gender: 2, id: studioId, known_for_department: "Directing", name: studioName, original_name: studioName, popularity: 0, profile_path: `https://imgs1cdn.adultempire.com/studio/${studioId}.png`, credit_id: `credit_${aeId}`, department: "Directing", job: "Director" }] : []
            },
            images: { backdrops: backdrops.slice(0, 20), posters: [{ file_path: poster }, { file_path: backCover }].filter(p => p.file_path) },
            videos: { results: [] }
        };
    };

    await getCachedOrFetch(cacheKey, scrapeMovie, res);
});

// Cache control endpoints
app.post('/genre/movie/list/clear-cache', (req, res) => {
    const deleted = myCache.del('genre_movie_list');
    res.json({ message: deleted ? 'Genre cache cleared' : 'No cache found', deleted: deleted !== 0 });
});

app.get('/health', (req, res) => {
    const genreCache = myCache.get('genre_movie_list');
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        cache_size: myCache.keys().length,
        genre_cache_status: genreCache ? `active (${genreCache.data?.genres?.length || 0} genres)` : 'empty',
        uptime: process.uptime()
    });
});

process.on('SIGTERM', () => {
    console.log('[SYSTEM] SIGTERM received, closing server...');
    myCache.flushAll();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`[SYSTEM] Pure AdultEmpire TMDB-Style API Live: http://localhost:${PORT}`);
});
