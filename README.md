Yes, it's absolutely possible! You can expose port 4444 publicly using cloudflared in a GitHub workflow. Let me help you set this up.

## Architecture Summary
- **Port 3000**: AdultEmpire TMDB-Style API
- **Port 2000**: SpeedPorn API with streams
- **Port 4444**: Combined API gateway (the one that will be exposed publicly)

## GitHub Workflow Configuration

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy API with Cloudflare Tunnel

on:
  push:
    branches: [ main ]
  workflow_dispatch:  # Allow manual trigger

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
    
    - name: Install dependencies
      run: |
        cd /home/runner/work/project
        npm install express axios cheerio node-cache compression xml2js
        # Install cloudflared
        curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
        chmod +x cloudflared
    
    - name: Start all servers
      run: |
        # Start server on port 3000 (AdultEmpire API)
        node server1.js &
        
        # Start server on port 2000 (SpeedPorn API)
        node server2.js &
        
        # Start server on port 4444 (Gateway API)
        node server3.js &
        
        # Wait for servers to start
        sleep 10
    
    - name: Create Cloudflare Tunnel
      run: |
        # Run cloudflared tunnel to expose port 4444
        ./cloudflared tunnel --url http://localhost:4444 --no-autoupdate &
        
        # Wait for tunnel to establish and capture URL
        sleep 5
        
        # Get the public URL
        TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')
        echo "PUBLIC_URL=$TUNNEL_URL" >> $GITHUB_ENV
        
        echo "✅ Tunnel established at: $TUNNEL_URL"
        
        # Keep the workflow running
        wait
```

## Alternative: More Robust Workflow with cloudflared Action

```yaml
name: Expose API via Cloudflare

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  expose-api:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
    
    - name: Install dependencies
      run: npm install
      working-directory: ./
    
    - name: Start all backend servers
      run: |
        # Save server files
        echo "${{ secrets.SERVER1_CONTENT }}" > server1.js
        echo "${{ secrets.SERVER2_CONTENT }}" > server2.js
        echo "${{ secrets.SERVER3_CONTENT }}" > server3.js
        
        # Start servers in background
        node server1.js &
        node server2.js &
        node server3.js &
        
        # Give servers time to initialize
        sleep 5
        
        # Verify servers are running
        curl -f http://localhost:3000/health || exit 1
        curl -f http://localhost:2000/health || exit 1
        curl -f http://localhost:4444/health || exit 1
        
    - name: Setup cloudflared
      uses: cloudflare/cloudflared-action@v1
      with:
        tunnel-url: http://localhost:4444
    
    - name: Keep workflow alive
      run: |
        echo "✅ API is publicly accessible via Cloudflare Tunnel"
        echo "🔗 Access your API at: https://your-tunnel-name.trycloudflare.com"
        echo ""
        echo "📚 Available endpoints:"
        echo "   GET /discover/movie?page=1"
        echo "   GET /movie/:id"
        echo "   GET /person/:id"
        echo "   GET /person/popular"
        echo "   GET /genre/movie/list"
        echo ""
        echo "⏱️  This workflow will run for up to 6 hours (GitHub Actions limit)"
        echo "💡 For 24/7 uptime, consider deploying to a VPS or using Cloudflare Argo Tunnel"
        
        # Keep the workflow alive
        tail -f /dev/null
```

## Server File Consolidation

Create a single `package.json`:

```json
{
  "name": "combined-api",
  "version": "1.0.0",
  "scripts": {
    "start:3000": "node server1.js",
    "start:2000": "node server2.js",
    "start:4444": "node server3.js",
    "start:all": "concurrently \"npm run start:3000\" \"npm run start:2000\" \"npm run start:4444\""
  },
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "cheerio": "^1.0.0-rc.12",
    "node-cache": "^5.1.2",
    "compression": "^1.7.4",
    "xml2js": "^0.6.2",
    "concurrently": "^8.2.2"
  }
}
```

## Enhanced Server 3 (Port 4444) with Health Check

Add this to your port 4444 server file:

```javascript
// Add to your existing port 4444 server
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      gateway: 'running on port 4444',
      adultempire_api: 'http://localhost:3000',
      speedporn_api: 'http://localhost:2000'
    }
  });
});

// Add service status endpoint
app.get('/services/status', async (req, res) => {
  const services = {
    adultempire: { url: 'http://localhost:3000/health', status: 'unknown' },
    speedporn: { url: 'http://localhost:2000/health', status: 'unknown' }
  };
  
  for (const [name, service] of Object.entries(services)) {
    try {
      const response = await axios.get(service.url, { timeout: 5000 });
      service.status = response.status === 200 ? 'up' : 'down';
    } catch (error) {
      service.status = 'down';
      service.error = error.message;
    }
  }
  
  res.json(services);
});
```

## Important Notes

1. **GitHub Actions Limitations**:
   - Workflows can run maximum 6 hours
   - For 24/7 operation, you'd need a VPS or dedicated server

2. **For Permanent Solution** (Recommended):
   ```bash
   # Install cloudflared on a VPS
   cloudflared tunnel --url http://localhost:4444
   ```

3. **Security Considerations**:
   - Add rate limiting to your port 4444 server
   - Consider adding API key authentication
   - Use environment variables for sensitive data

4. **Testing Your Setup**:
   ```bash
   # After workflow runs, you'll get a URL like:
   # https://random-name.trycloudflare.com
   
   # Test endpoints:
   curl https://random-name.trycloudflare.com/health
   curl https://random-name.trycloudflare.com/discover/movie?page=1
   curl https://random-name.trycloudflare.com/movie/12345
   ```

Would you like me to help you set up a permanent deployment solution or add authentication to your API?
