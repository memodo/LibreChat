# Local Development Notes

## User Management (Docker)

### Reset Password

```bash
docker exec -it LibreChat npm run reset-password <email>
```

### List Users

```bash
docker exec -it LibreChat npm run list-users
```

### Add Users

In your .env:

```bash
ALLOW_REGISTRATION=true
```

Restart LibreChat.

#### Option 1: via UI

Have the user sign up in the UI. Link to on the login page.

#### Option 2: Use the registration endpoint via curl

```bash
curl -X POST http://localhost:3080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "User Name",
    "username": "username",
    "email": "user@example.com",
    "password": "securepassword",
    "confirm_password": "securepassword"
  }'
```

This uses LibreChat's own registration logic to properly hash the password.

## Docker Networking

### Connecting to Services on Host Machine

When LibreChat runs in Docker and needs to connect to a service running on the host (e.g., a local API server), use `host.docker.internal` instead of `localhost`:

```yaml
# In librechat.yaml
baseURL: "http://host.docker.internal:8000"  # NOT localhost:8000
```

`localhost` inside a container refers to the container itself, not the host machine.

## Building and Deploying Local Fixes

When using pre-built Docker images (`ghcr.io/danny-avila/librechat-dev:latest`), you can apply local code fixes by building packages locally and mounting them into the container.

### Prerequisites

```bash
# Install dependencies (from repo root)
npm install

# Build all packages in correct dependency order
npm run build:packages
```

To build only a specific package (must build dependencies first):

```bash
npm run build:data-provider   # no dependencies
npm run build:data-schemas    # no dependencies
npm run build:api             # depends on data-provider, data-schemas
npm run build:client-package  # depends on data-provider
```

### Applying Fixes via Volume Mounts

Add volume mounts to `docker-compose.override.yml` to overlay your built packages. **Only mount packages you've actually modified:**

```yaml
services:
  api:
    volumes:
      # Mount only the packages you've modified
      - type: bind
        source: ./packages/api/dist
        target: /app/node_modules/@librechat/api/dist
```

Available package mount paths:

| Package | Source | Target |
|---------|--------|--------|
| @librechat/api | `./packages/api/dist` | `/app/node_modules/@librechat/api/dist` |
| @librechat/data-schemas | `./packages/data-schemas/dist` | `/app/node_modules/@librechat/data-schemas/dist` |
| librechat-data-provider | `./packages/data-provider/dist` | `/app/node_modules/librechat-data-provider/dist` |

### Deploying to Server

1. **Build packages locally:**
   ```bash
   npm run build:packages
   ```

2. **Copy to server:**
   - `docker-compose.override.yml`
   - `packages/*/dist/` directories for any modified packages

3. **Restart on server:**
   ```bash
   docker-compose up -d api
   ```

### Example: S3/MinIO Path Style Fix

If using MinIO or S3-compatible storage and getting `ENOTFOUND bucket.endpoint` errors, the S3 client needs `forcePathStyle: true`.

Edit `packages/api/src/cdn/s3.ts`:

```typescript
const config = {
  region,
  ...(endpoint ? { endpoint } : {}),
  // Use path-style addressing for S3-compatible storage (MinIO, etc.)
  forcePathStyle: true,
};
```

Then build and deploy:

```bash
npm run build:api
# Copy packages/api/dist/ and docker-compose.override.yml to server
# Restart: docker-compose up -d api
```
