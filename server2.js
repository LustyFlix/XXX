const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const compression = require('compression');
const http = require('http');
const https = require('https');

// GROK MODIFIED

const app = express();
const PORT = process.env.PORT || 2000;

// ================== MIDDLEWARE ==================
app.use(compression()); // Gzip compression = faster responses
app.use(express.json());

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    next();
});

// ================== CONFIG & CACHE ==================
const CACHE_TTL = 3600; // 1 hour
const cache = new NodeCache({ 
    stdTTL: CACHE_TTL, 
    checkperiod: 600,
    useClones: false 
});

// Optimized Axios Instance
const axiosInstance = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br'
    },
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
});

// Proxy helper
const fetchWithProxy = (url) => {
    const proxyUrl = `https://a.abcdefghijklmnopqrstuvwxyz.workers.dev/?url=${encodeURIComponent(url)}`;
    return axiosInstance.get(proxyUrl);
};

// ================== SCRAPING FUNCTIONS ==================
const blockedStreamHosts = ["doodstream", "mixdrop", "lulustream", "streamtape"];
const allowedDownloadHosts = ["freedl"];

const scrapeStreams = async (postId) => {
    try {
        const url = `https://speedporn.net/?p=${postId}`;
        const { data } = await fetchWithProxy(url);
        const $ = cheerio.load(data);

        const streams = [];

        // STREAM TAB
        const streamTab = $('#pettabs').eq(0);
        const rawStreamLinks = [];

        streamTab.find('.Rtable1-cell a').each((_, el) => {
            const link = $(el).attr('href');
            const name = $(el).text().toLowerCase();
            if (!link || link === "#" || blockedStreamHosts.some(host => name.includes(host))) return;
            rawStreamLinks.push(link);
        });

        // Chunk into groups of 3
        for (let i = 0; i < rawStreamLinks.length; i += 3) {
            const chunk = rawStreamLinks.slice(i, i + 3);
            const combined = chunk.join(',');

            streams.push({
                name: `Premium V${Math.floor(i / 3) + 1}`,
                raw_url: `https://proxy.adult.lustyflix.com/play?url=${encodeURIComponent(combined)}`,
                url: encodeURIComponent(combined),
                type: "embed"
            });
        }

        // DOWNLOAD TAB
        const downloadTab = $('#pettabs').eq(1);
        downloadTab.find('.Rtable1-cell a').each((_, el) => {
            const link = $(el).attr('href');
            const name = $(el).text().toLowerCase();
            if (!link || link === "#" || !allowedDownloadHosts.some(host => name.includes(host))) return;

            streams.push({
                name: $(el).text().trim(),
                url: link,
                type: "download"
            });
        });

        return streams;
    } catch (e) {
        console.error(`Stream scrape error for ${postId}:`, e.message);
        return [];
    }
};

// ================== HELPERS ==================
const extractNameFromTitle = (title) => 
    title.replace(/Watch | Full Porn Movie Online Free - Spread The Love with Speed Porn./gi, '')
         .replace(/\s+/g, ' ')
         .trim();

const extractImageId = (url) => {
    const match = url.match(/\/(\d+)[^\/]*?\.jpg$/);
    return match ? match[1] : null;
};

// AdultEmpire Search (Cached)
const searchAdultEmpire = async (name) => {
    if (!name) return { found: false };

    const cacheKey = `ae:${name.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
        const encodedName = encodeURIComponent(name);
        const { data } = await fetchWithProxy(
            `https://www.adultempire.com/search/SearchAutoComplete_Agg_EmpireDTRank?rows=30&name_startsWith=${encodedName}&search_type=All`
        );

        if (!data?.Results?.length) {
            const result = { found: false };
            cache.set(cacheKey, result);
            return result;
        }

        let bestMatch = null;
        let bestScore = 0;
        const lowerName = name.toLowerCase();

        for (const result of data.Results) {
            const desc = result.BasicResponseGroup?.description;
            if (!desc) continue;

            const lowerDesc = desc.toLowerCase();

            if (lowerDesc === lowerName) {
                bestMatch = result;
                break;
            }

            const score = 
                (lowerDesc.includes(lowerName) ? 0.8 : 0) +
                (lowerName.includes(lowerDesc) ? 0.6 : 0) +
                (1 - Math.abs(desc.length - name.length) / Math.max(desc.length, name.length));

            if (score > bestScore) {
                bestScore = score;
                bestMatch = result;
            }
        }

        if (bestMatch) {
            const boxcover = bestMatch.BasicResponseGroup.boxcover;
            const idMatch = boxcover.match(/products\/(\d+)\/(\d+)/);

            const result = {
                found: true,
                adultempire_id: idMatch ? idMatch[2] : null,
                adultempire_title: bestMatch.BasicResponseGroup.description,
                adultempire_image_url: idMatch 
                    ? `https://imgs1cdn.adultempire.com/products/${idMatch[1]}/${idMatch[2]}h.jpg` 
                    : null
            };

            cache.set(cacheKey, result);
            return result;
        }

        const noResult = { found: false };
        cache.set(cacheKey, noResult);
        return noResult;

    } catch (error) {
        console.error('AdultEmpire Error:', error.message);
        return { found: false };
    }
};

// ================== ROUTES ==================

// Main Movie Data + Streams
app.get('/search/:id', async (req, res) => {
    const id = req.params.id;
    const cacheKey = `search:${id}`;

    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
        const [streams, pageResponse] = await Promise.all([
            scrapeStreams(id),
            fetchWithProxy(`https://speedporn.net/?p=${id}`)
        ]);

        const $ = cheerio.load(pageResponse.data);

        let videoData = null;
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const json = JSON.parse($(el).html());
                if (json['@type'] === 'VideoObject') {
                    videoData = json;
                    return false;
                }
            } catch {}
        });

        if (!videoData) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const title = extractNameFromTitle(videoData.name || '');
        const thumbnailUrl = videoData.thumbnailUrl;
        const imageId = extractImageId(thumbnailUrl);

        const adultEmpireResult = await searchAdultEmpire(title);

        const responseData = {
            speedporn_id: id,
            speedporn_title: title,
            speedporn_image_id: imageId,
            speedporn_image_url: thumbnailUrl,
            videos: streams.map((stream, index) => ({
                name: stream.name,
                key: stream.url,
                site: stream.type === 'embed' ? 'YouTube' : 'direct',
                type: stream.type === 'embed' ? 'Full' : 'download',
                id: `${id}_${index}_${Date.now()}`,
                published_at: new Date().toISOString(),
                embed: stream.raw_url || stream.url
            })),
            found: adultEmpireResult.found,
            ...(adultEmpireResult.found && {
                adultempire_id: adultEmpireResult.adultempire_id,
                adultempire_title: adultEmpireResult.adultempire_title,
                adultempire_image_url: adultEmpireResult.adultempire_image_url,
            })
        };

        cache.set(cacheKey, responseData);
        res.json(responseData);

    } catch (error) {
        console.error('Search Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch movie', message: error.message });
    }
});

// Videos Only Route (Optimized)
app.get('/movie/:id/videos', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'ID is required' });

    try {
        const streams = await scrapeStreams(id);

        const results = streams.map((stream, index) => ({
            name: stream.name,
            key: Buffer.from(stream.url, 'utf-8').toString('base64'),
            site: stream.type === 'embed' ? 'YouTube' : 'direct',
            type: stream.type === 'embed' ? 'Full' : 'download',
            id: `${id}_${index}_${Date.now()}`,
            published_at: new Date().toISOString()
        }));

        res.json({
            id: parseInt(id),
            results
        });

    } catch (error) {
        console.error('Videos Route Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch videos' });
    }
});

// Discover Movies
app.get('/discover/movie', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const cacheKey = `discover:${page}`;

    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    try {
        const { data } = await axiosInstance.get(
            `https://a.abcdefghijklmnopqrstuvwxyz.workers.dev/?url=https://speedporn.net/page/${page}/`
        );

        const $ = cheerio.load(data);

        const totalPagesText = $('.pagination li:nth-last-child(2) a').text();
        const totalPages = parseInt(totalPagesText.replace(/,/g, ''), 10) || 1;

        const results = [];

        $('.col-6.col-md-4.col-lg-3.col-xl-3').each((_, el) => {
            const title = $(el).find('span.title').text().trim();
            const link = $(el).find('a').attr('href');
            const poster = $(el).find('img').attr('src');
            const id = $(el).find('div.video-block.thumbs-rotation').attr('data-post-id');

            if (id && title) {
                results.push({
                    adult: false,
                    backdrop_path: poster,
                    id: id,
                    title: title,
                    original_title: title,
                    overview: title,
                    popularity: 0,
                    poster_path: poster,
                    release_date: null,
                    softcore: false,
                    video: false,
                    vote_average: 0,
                    vote_count: 0
                });
            }
        });

        const responseData = {
            page,
            results,
            total_pages: totalPages,
            total_results: totalPages * 49
        };

        cache.set(cacheKey, responseData);
        res.json(responseData);

    } catch (error) {
        console.error('Discover Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch discover page' });
    }
});

// Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        cacheSize: cache.getStats().keys,
        uptime: process.uptime()
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Blazing Fast API Running on http://localhost:${PORT}`);
});
