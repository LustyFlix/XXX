const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache'); // <-- NEW: Import node-cache

const app = express();
const port = 4444;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// Replace this with your actual TMDB API Key for the fallback endpoints
const TMDB_API_KEY = '7789cead69879c44ca9038698525cb39';

// ==========================================
// NODE-CACHE CONFIGURATION (1 Day = 86400 seconds)
// ==========================================
const tmdbCache = new NodeCache({ 
    stdTTL: 86400,        // Cache keys for 24 hours
    checkperiod: 600      // Automatic deletion check every 10 minutes
});

// Custom middleware to handle zero-latency caching
const cacheMiddleware = (req, res, next) => {
    // req.originalUrl captures the exact path + query variables (e.g. /discover/movie?page=2)
    const key = req.originalUrl; 
    const cachedData = tmdbCache.get(key);

    if (cachedData) {
        console.log(`[Cache Hit] Serving from memory: ${key}`);
        return res.json(cachedData);
    }

    // Intercept res.json to seamlessly cache the data on a successful upstream resolution
    const originalJson = res.json;
    res.json = function (data) {
        if (res.statusCode === 200) {
            tmdbCache.set(key, data);
        }
        originalJson.call(this, data);
    };

    next();
};

// Apply node-cache middleware globally to all routes
app.use(cacheMiddleware);

// ==========================================
// 1. Discover Movies Endpoint (Custom)
// ==========================================
app.get('/discover/movie', async (req, res) => {
    const page = req.query.page || 1;
    console.log(`Requesting route /discover/movie?page=${page}`);
    try {
        // const customDiscoverUrl = `http://localhost:2000/discover/movie?page=${page}`;
        const customDiscoverUrl = `http://localhost:2000/discover/movie?page=${page}`;
        const response = await axios.get(customDiscoverUrl);
        res.json(response.data);
    } catch (error) {
        console.error("Error in discover endpoint:", error.message);
        const statusCode = error.response ? error.response.status : 500;
        res.status(statusCode).json({ 
            error: 'Failed to fetch discover data from TMDB',
            details: error.message 
        });
    }
});

// ==========================================
// 3. Movie ID Endpoint (Custom Resolver)
// ==========================================
app.get('/movie/:id', async (req, res) => {
    const id = req.params.id;
    console.log(`Requesting route /movie/${id}`);

    try {
        // --- STEP 1: Resolve the Temp ID ---
        const resolverUrl = `http://localhost:2000/search/${id}`;
        const resolverResponse = await axios.get(resolverUrl);
        
        const tmdbId = resolverResponse.data.adultempire_id; 
        const videosData = resolverResponse.data.videos; // Renamed for clarity

        if (!tmdbId) {
            return res.status(404).json({ error: 'Could not resolve a TMDB ID for the provided temp ID.' });
        }

        // --- STEP 2: Fetch the actual data ---
        const tmdbUrl = `http://localhost:3000/movie/${tmdbId}`;
        const tmdbResponse = await axios.get(tmdbUrl);

        // --- STEP 3: Return the TMDB data + original ID to the client ---
        const finalResponse = {
            ...tmdbResponse.data,
            id: id,
            // Format videos to match TMDB structure: { results: [...] }
            videos: {
                results: videosData 
            }
        };

        res.json(finalResponse);

    } catch (error) {
        console.error("Error fetching data:", error.message);
        const statusCode = error.response ? error.response.status : 500;
        res.status(statusCode).json({ 
            error: 'Failed to process request',
            details: error.message 
        });
    }
});
// // ==========================================
// // 3. Movie ID Endpoint (Custom Resolver)
// // ==========================================
// app.get('/movie/:id', async (req, res) => {
//     const id = req.params.id;
//     console.log(`Requesting route /movie/${id}`);

//     try {
//         // --- STEP 1: Resolve the Temp ID to a TMDB ID ---
//         const resolverUrl = `http://localhost:2000/search/${id}`;
//         const resolverResponse = await axios.get(resolverUrl);
        
//         const tmdbId = resolverResponse.data.adultempire_id; 

//         if (!tmdbId) {
//             return res.status(404).json({ error: 'Could not resolve a TMDB ID for the provided temp ID.' });
//         }

//         // --- STEP 2: Fetch the actual data from TMDB ---
//         const tmdbUrl = `http://localhost:3000/movie/${tmdbId}`;
//         const tmdbResponse = await axios.get(tmdbUrl);

//         // --- STEP 3: Return the TMDB data to the client ---
//         res.json(tmdbResponse.data);

//     } catch (error) {
//         console.error("Error fetching data:", error.message);
//         const statusCode = error.response ? error.response.status : 500;
//         res.status(statusCode).json({ 
//             error: 'Failed to process request',
//             details: error.message 
//         });
//     }
// });

// ==========================================
// 3. Movie ID Endpoint (Custom Resolver)
// ==========================================
app.get('/movie/:id', async (req, res) => {
    const id = req.params.id;
    console.log(`Requesting route /movie/${id}`);

    try {
        // --- STEP 1: Resolve the Temp ID to a TMDB ID ---
        const resolverUrl = `http://localhost:2000/search/${id}`;
        const resolverResponse = await axios.get(resolverUrl);
        
        const tmdbId = resolverResponse.data.adultempire_id; 

        if (!tmdbId) {
            return res.status(404).json({ error: 'Could not resolve a TMDB ID for the provided temp ID.' });
        }

        // --- STEP 2: Fetch the actual data from TMDB ---
        const tmdbUrl = `http://localhost:3000/movie/${tmdbId}`;
        const tmdbResponse = await axios.get(tmdbUrl);

        // --- STEP 3: Return the TMDB data + original ID to the client ---
        // Create a new object that spreads all TMDB data, then adds the original ID
        const finalResponse = {
            ...tmdbResponse.data,
            id: id 
        };

        res.json(finalResponse);

    } catch (error) {
        console.error("Error fetching data:", error.message);
        const statusCode = error.response ? error.response.status : 500;
        res.status(statusCode).json({ 
            error: 'Failed to process request',
            details: error.message 
        });
    }
});

// ==========================================
// 4. Popular Person Endpoint (Custom)
// ==========================================
app.get('/person/popular', async (req, res) => {
    const page = req.query.page || 1;
    console.log(`Requesting route /person/popular?page=${page}`);
    try {
        const customPopularPersonUrl = `http://localhost:3000/person/popular?page=${page}`;
        const response = await axios.get(customPopularPersonUrl);
        res.json(response.data);
    } catch (error) {
        console.error("Error in popular person endpoint:", error.message);
        const statusCode = error.response ? error.response.status : 500;
        res.status(statusCode).json({ 
            error: 'Failed to fetch popular person data',
            details: error.message 
        });
    }
});

// ==========================================
// 5. Person ID Endpoint (Custom)
// ==========================================
app.get('/person/:id', async (req, res) => {
    const id = req.params.id;
    console.log(`Requesting route /person/${id}`);

    try {
        const customPersonUrl = `http://localhost:3000/person/${id}`;
        const tmdbResponse = await axios.get(customPersonUrl);
        res.json(tmdbResponse.data);
    } catch (error) {
        console.error("Error fetching data:", error.message);
        const statusCode = error.response ? error.response.status : 500;
        res.status(statusCode).json({ 
            error: 'Failed to process request',
            details: error.message 
        });
    }
});

// ==========================================
// 6. Genre List Endpoint (Custom)
// ==========================================
app.get('/genre/movie/list', async (req, res) => {
    console.log(`Requesting route /genre/movie/list`);
    try {
        const customGenreListUrl = `http://localhost:3000/genre/movie/list`;
        const response = await axios.get(customGenreListUrl);
        res.json(response.data);
    } catch (error) {
        console.error("Error in genre list endpoint:", error.message);
        const statusCode = error.response ? error.response.status : 500;
        res.status(statusCode).json({ 
            error: 'Failed to fetch genre list data',
            details: error.message 
        });
    }
});

// ==========================================
// 7. FALLBACK CATCH-ALL: Pass-through to Original TMDB
// ==========================================
app.get(/.*/, async (req, res) => {
    const fallbackPath = req.path;
    
    // Read existing query params from client request and inject API key
    const queryParams = new URLSearchParams(req.query);
    if (!queryParams.has('api_key')) {
        queryParams.append('api_key', TMDB_API_KEY);
    }

    try {
        // Build the target endpoint on the official TMDB server
        const tmdbUrl = `https://api.themoviedb.org/3${fallbackPath}?${queryParams.toString()}`;
        console.log(`Fallback Proxying to: ${tmdbUrl}`);

        const response = await axios.get(tmdbUrl);
        res.json(response.data);
    } catch (error) {
        console.error(`Error in fallback proxy for ${fallbackPath}:`, error.message);
        const statusCode = error.response ? error.response.status : 500;
        res.status(statusCode).json({ 
            error: 'Failed to fetch data from TMDB fallback API',
            details: error.message 
        });
    }
});

// Start Server
app.listen(port, () => {
    console.log(`Custom TMDB Mod API listening on http://localhost:${port}`);
});
