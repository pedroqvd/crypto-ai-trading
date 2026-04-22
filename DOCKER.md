# Docker Setup Guide

This project includes a complete Docker setup for local development and production deployment.

## Quick Start

### 1. Build and Run with Docker Compose

```bash
# Copy environment variables template
cp .env.example .env

# Edit .env with your configuration
nano .env

# Start the bot in the background
docker compose up -d

# View logs
docker compose logs -f

# Stop the bot
docker compose down
```

### 2. Manual Docker Build

```bash
# Build the image
docker build -t polymarket-bot:latest .

# Run with environment variables
docker run -d \
  --name polymarket-bot \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  --env-file .env \
  polymarket-bot:latest

# View logs
docker logs -f polymarket-bot

# Stop the container
docker stop polymarket-bot
```

## Configuration

### Environment Variables

All configuration is done via environment variables in `.env`:

- **PRIVATE_KEY** - Polygon wallet private key (required for live trading)
- **DRY_RUN** - Set to `true` for simulation, `false` for live trading
- **BANKROLL** - Starting capital in USDC
- **KELLY_FRACTION** - Kelly sizing fraction (0.25 = quarter-Kelly, recommended)
- **MIN_EDGE** - Minimum edge threshold (0.01 = 1%)
- **SCAN_INTERVAL_MS** - Scan interval in milliseconds (60000 = 60 seconds)
- **DASHBOARD_PORT** - Port for web dashboard (default: 3000)
- **LOG_FORMAT** - Log format: `text` (default) or `json`

See `.env.example` for complete list and descriptions.

## Volumes

The docker-compose setup persists:

- **./data** - Trade history, backups, and learning data
- **./logs** - Application logs

These directories are created automatically and survive container restarts.

## Resource Limits

By default, the container is limited to 700MB RAM with a 256MB reservation. Adjust in `docker-compose.yml` if needed:

```yaml
deploy:
  resources:
    limits:
      memory: 700M
    reservations:
      memory: 256M
```

## Health Checks

The container includes an automatic health check that:

- Runs every 30 seconds
- Checks if the dashboard API is responding (`/api/health`)
- Marks container unhealthy after 3 failed checks
- Waits 60 seconds before first check

View health status:

```bash
docker ps --filter "name=polymarket-bot"
```

## Development

### Build with Caching

The Dockerfile uses multi-stage builds for efficiency:

1. **Builder stage** - Compiles TypeScript (includes devDependencies)
2. **Runtime stage** - Only includes compiled code and production dependencies

This results in a ~180MB final image size.

### Rebuild After Code Changes

```bash
# Rebuild and restart
docker compose up -d --build
```

## Production Deployment

For production on Fly.io, Railway, or similar platforms:

1. Set `DRY_RUN=false` and provide `PRIVATE_KEY`
2. Mount persistent volumes for `/app/data`
3. Set appropriate resource limits
4. Enable auto-restart policy (`restart: unless-stopped`)
5. Configure health checks
6. Use environment variables for all secrets (never in `.env` file)

### Fly.io Deployment

```bash
# Install Fly CLI and authenticate
flyctl auth login

# Create an app
flyctl apps create

# Deploy
flyctl deploy

# View logs
flyctl logs

# Scale resources
flyctl scale memory 512
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs

# Check for port conflicts
lsof -i :3000

# Verify environment variables
docker compose config | grep -A 50 environment
```

### Out of memory

Increase memory limits in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 1G
    reservations:
      memory: 512M
```

### Data persistence issues

Ensure volumes are mounted correctly:

```bash
# Check volume mounts
docker compose exec bot ls -la /app/data

# Verify volume exists
docker volume ls
```

## Docker Networking

The `polymarket-bot` service:

- Exposes port `3000` for the dashboard
- Can be accessed at `http://localhost:3000` locally
- Can be accessed at `http://<container-name>:3000` from other containers

For connecting multiple containers, create a custom network:

```yaml
networks:
  polymarket-net:

services:
  bot:
    networks:
      - polymarket-net
```

## Security Considerations

1. **Private Key** - Always use environment variables, never commit to git
2. **Non-root user** - Container runs as `nodejs` user for security
3. **Minimal image** - Only production dependencies included
4. **.dockerignore** - Excludes sensitive files and dev dependencies
5. **Secrets** - Use secret management in production (Fly.io, K8s secrets, etc.)

## Performance Tips

- Use SSD storage for data volume for better performance
- Increase scan interval (`SCAN_INTERVAL_MS`) if CPU is high
- Use `docker stats` to monitor resource usage
- Enable JSON logging (`LOG_FORMAT=json`) for better log aggregation

## Further Reading

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Fly.io Documentation](https://fly.io/docs/)
