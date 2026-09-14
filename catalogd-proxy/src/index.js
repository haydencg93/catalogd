// Define CORS headers to allow your frontend to access this worker
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // Change "*" to your frontend URL in production (e.g., "https://my-app.vercel.app")
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. Handle CORS Preflight Requests (Crucial for GitHub Pages)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
      });
    }

    // Standard CORS headers attached to all successful responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    };

    try {
      // ----------------------------------------
      // TMDB ROUTE
      // ----------------------------------------
      if (path.startsWith("/api/tmdb/")) {
        const targetPath = path.replace("/api/tmdb/", "");
        const targetUrl = `https://api.themoviedb.org/3/${targetPath}${url.search}`;
        
        const response = await fetch(targetUrl, {
          headers: {
            "Authorization": `Bearer ${env.TMDB_TOKEN}`,
            "Accept": "application/json"
          }
        });
        
        const data = await response.json();
        return new Response(JSON.stringify(data), { headers: corsHeaders, status: response.status });
      }

      // ----------------------------------------
      // LAST.FM ROUTE
      // ----------------------------------------
      if (path.startsWith("/api/lastfm")) {
        const targetUrl = new URL(`http://ws.audioscrobbler.com/2.0/`);
        
        // Copy all the query parameters from your frontend (like ?method=album.search&album=believe)
        url.searchParams.forEach((value, key) => targetUrl.searchParams.append(key, value));
        
        // Inject the hidden Last.fm API Key on the server side
        targetUrl.searchParams.append("api_key", env.LASTFM_KEY);
        if (!targetUrl.searchParams.has("format")) targetUrl.searchParams.append("format", "json");

        const response = await fetch(targetUrl.toString());
        const data = await response.json();
        return new Response(JSON.stringify(data), { headers: corsHeaders, status: response.status });
      }

      // ----------------------------------------
      // TVDB ROUTE (2-Step Authentication)
      // ----------------------------------------
      if (path.startsWith("/api/tvdb/")) {
        // Only include the PIN in the payload if it exists
        const loginPayload = { apikey: env.TVDB_KEY };
        if (env.TVDB_PIN && env.TVDB_PIN.trim() !== "") {
          loginPayload.pin = env.TVDB_PIN;
        }

        const loginResp = await fetch("https://api4.thetvdb.com/v4/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(loginPayload)
        });
        
        // If login fails, extract the exact error from TVDB and throw it
        if (!loginResp.ok) {
          const errorDetails = await loginResp.text();
          throw new Error(`TVDB API Rejected Login: ${loginResp.status} - ${errorDetails}`);
        }
        
        const loginData = await loginResp.json();
        const tvdbToken = loginData.data.token;

        const targetPath = path.replace("/api/tvdb/", "");
        const targetUrl = `https://api4.thetvdb.com/v4/${targetPath}${url.search}`;

        const response = await fetch(targetUrl, {
          headers: {
            "Authorization": `Bearer ${tvdbToken}`,
            "Accept": "application/json"
          }
        });
        
        const data = await response.json();
        return new Response(JSON.stringify(data), { headers: corsHeaders, status: response.status });
      }

      // ----------------------------------------
      // FALLBACK (If path doesn't match above)
      // ----------------------------------------
      return new Response(JSON.stringify({ error: "Endpoint not found" }), { 
        status: 404, 
        headers: corsHeaders 
      });

    } catch (error) {
      // Catch any unexpected crashes and return them safely as JSON
      return new Response(JSON.stringify({ error: error.message }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  }
};