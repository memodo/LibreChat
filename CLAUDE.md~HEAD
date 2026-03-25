# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

LibreChat is a multi-user AI chat platform that provides a unified interface for interacting with multiple AI models (OpenAI, Anthropic, Google, Azure, AWS Bedrock, Ollama, and custom endpoints). It's built as a monorepo with separate backend (Node.js/Express) and frontend (React) workspaces, plus shared packages.

## Project Structure

```
LibreChat/
├── api/                      # Backend Express server
├── client/                   # React frontend
├── packages/
│   ├── data-provider/       # Client-side API calls and React Query hooks
│   ├── data-schemas/        # Mongoose schemas and database methods
│   ├── api/                 # Backend utilities, MCP services, file handling
│   └── client/              # Reusable React components
├── config/                   # CLI tools for user management, migrations
├── e2e/                      # Playwright tests
├── librechat.yaml           # Main configuration (endpoints, models, features)
└── .env                      # Environment variables (API keys, secrets)
```

## Common Commands

### Development

```bash
# Install dependencies (from root)
npm install

# Build all packages (required before running dev servers)
npm run build:packages

# Run backend in development mode
npm run backend:dev

# Run frontend in development mode
npm run frontend:dev

# Run both (in separate terminals)
npm run backend:dev
npm run frontend:dev
```

### Testing

```bash
# Run all backend tests
npm run test:api

# Run all frontend tests
npm run test:client

# Run e2e tests locally
npm run e2e

# Run e2e tests in headed mode
npm run e2e:headed

# Run e2e tests with debug mode
npm run e2e:debug

# Run a single test file (from api/ or client/ directory)
cd api && npm test -- path/to/test.spec.js
cd client && npm test -- path/to/test.test.tsx
```

### Building

```bash
# Build frontend for production
npm run frontend

# Build individual packages
npm run build:data-provider
npm run build:data-schemas
npm run build:api
npm run build:client-package
```

### Linting & Formatting

```bash
# Lint all files
npm run lint

# Lint and fix issues
npm run lint:fix

# Format all files with Prettier
npm run format
```

### User Management (from root)

```bash
npm run create-user
npm run invite-user
npm run list-users
npm run reset-password
npm run ban-user
npm run delete-user
```

### Database Utilities

```bash
npm run reset-meili-sync       # Reset MeiliSearch sync
npm run flush-cache            # Clear Redis cache
```

### Docker

```bash
# Start with docker-compose
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f
```

## Architecture

### Backend (api/)

**Entry point:** `api/server/index.js`
- Express server with Mongoose (MongoDB)
- Passport.js authentication (JWT, Local, OAuth, LDAP, SAML)
- AI model clients extend `BaseClient` (api/app/clients/)
- Routes organized by domain in `api/server/routes/`
- Mongoose models in `api/models/`

**Key directories:**
- `api/server/routes/` - Express route handlers (auth, messages, convos, files, agents, etc.)
- `api/server/middleware/` - Auth, validation, rate limiting, error handling
- `api/server/controllers/` - Business logic for routes
- `api/server/services/` - Reusable service layer (Config, MCP, etc.)
- `api/app/clients/` - AI provider integrations (OpenAI, Anthropic, Google, etc.)
- `api/models/` - Mongoose models and database methods
- `api/strategies/` - Passport authentication strategies
- `api/cache/` - Redis caching utilities
- `api/utils/` - Shared utilities (tokens, files, etc.)

**AI Model Integration:**
All AI clients inherit from `BaseClient` (api/app/clients/BaseClient.js):
- Standardized methods: `getCompletion()`, `saveMessage()`, `saveConvo()`
- Token counting, streaming, vision support
- Tool/function calling support

### Frontend (client/)

**Entry point:** `client/src/main.jsx` → `client/src/App.jsx`
- React 18 with Vite build system
- State management: Recoil (global state) + React Query (server state)
- Routing: React Router
- UI: Radix UI components + Tailwind CSS

**Key directories:**
- `client/src/components/` - React UI components
- `client/src/data-provider/` - React Query hooks organized by domain
- `client/src/store/` - Recoil atoms and selectors
- `client/src/hooks/` - Custom React hooks
- `client/src/routes/` - Route components
- `client/src/utils/` - Frontend utilities
- `client/src/Providers/` - Context providers (Theme, DND, etc.)

### Shared Packages

**packages/data-provider** - Client-side data fetching
- Exports `dataService` for API calls
- React Query hooks (queries/mutations)
- Type definitions for agents, files, assistants, etc.

**packages/data-schemas** - Database schemas
- Exports `createModels(mongoose)` to generate Mongoose models
- Exports `createMethods(mongoose)` for database operations
- Shared schema definitions

**packages/api** - Backend utilities
- MCP (Model Context Protocol) manager and registry
- File handling (S3, Azure Blob, local)
- Token counting utilities
- OAuth reconnection management
- Configuration helpers

**packages/client** - Reusable React components
- UI component library
- React hooks and providers

## Configuration

### librechat.yaml

Main configuration file that defines:
- AI endpoints (OpenAI, Anthropic, Google, custom endpoints)
- Model configurations
- Feature flags (agents, file search, web search)
- Interface customization
- File storage strategy (local, S3, Firebase)

Example structure:
```yaml
version: 1.2.1
cache: true
interface:
  agents: true
  fileSearch: true
endpoints:
  custom:
    - name: "MyCustomEndpoint"
      apiKey: "${MY_API_KEY}"
      baseURL: "https://api.example.com/v1"
      models:
        default: ["model-name"]
```

### Environment Variables (.env)

Required variables:
- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET` - JWT token secret
- API keys for providers (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
- `HOST`, `PORT` - Server configuration
- `REDIS_URI` - Redis connection (optional but recommended)

See `.env.example` for full list.

## Database

**MongoDB with Mongoose ODM**
- Connection setup: `api/db/connect.js`
- Models created via `packages/data-schemas`
- Indexes defined in schema files

**Key Models:**
- User, Conversation, Message, File
- Agent, Assistant, Prompt, Preset
- Transaction (token tracking)
- Role, Permission (access control)

## Authentication Flow

1. User logs in via `/api/auth/login` (local) or OAuth routes
2. Passport.js validates credentials using strategy (api/strategies/)
3. JWT token issued and stored in HTTP-only cookie
4. Subsequent requests validated via JWT middleware
5. User permissions checked via Role/Permission models

**Supported auth methods:**
- Local (username/password)
- OAuth (Google, GitHub, Discord, Facebook, Apple)
- LDAP
- SAML/OpenID

## Message Flow

1. User sends message via frontend
2. POST to `/api/messages` or `/api/ask`
3. Authentication middleware validates JWT
4. Route handler determines endpoint/model
5. Appropriate AI client instantiated (extends BaseClient)
6. Client formats request and streams response
7. Message saved to database with tokens/metadata
8. Response streamed back to client via Server-Sent Events (SSE)

## Testing Conventions

- Backend tests: `*.spec.js` files in `api/models/`, `api/server/`
- Package tests: `*.test.ts` files in `packages/*/src/`
- Frontend tests: `*.test.tsx` or `*.test.ts` in `client/src/`
- E2E tests: Playwright tests in `e2e/`
- Run tests with `npm test` from respective directories
- Use `npm run test:ci` for CI environments

## Development Tips

### Adding a New AI Endpoint

1. Extend `BaseClient` in `api/app/clients/`
2. Implement required methods: `getCompletion()`, `buildMessages()`
3. Register in `librechat.yaml` under `endpoints.custom`
4. Add environment variables for API keys

### Adding a New Route

1. Create route file in `api/server/routes/`
2. Add authentication middleware
3. Implement controller logic
4. Register route in `api/server/index.js`

### Adding a New Database Model

1. Define schema in `packages/data-schemas/src/schemas/`
2. Add to `createModels()` in `packages/data-schemas/src/models.ts`
3. Add database methods in `packages/data-schemas/src/methods/`
4. Use model in API via imports from `@librechat/data-schemas`

### Working with Packages

**Important:** Always rebuild packages after making changes:
```bash
npm run build:packages
```

Packages use TypeScript and are built with Rollup/TSC before being consumed by api/client.

### Path Aliases

Backend uses path aliases defined in `api/jsconfig.json`:
- `~/` maps to `api/`
- Example: `import { User } from '~/models'`

Frontend uses aliases from Vite config:
- `~/` maps to `client/src/`

## Code Style

- ESLint configuration in `eslint.config.mjs`
- Prettier for formatting (`.prettierrc`)
- Use `npm run lint:fix` before committing
- Pre-commit hooks run via Husky (`.husky/`)

## Deployment

- Docker images: `Dockerfile`, `Dockerfile.multi`
- Docker Compose: `docker-compose.yml`
- Helm charts available in `helm/`
- Production build: `npm run frontend` + `npm run backend`
- Serve static frontend from Express in production

## MCP (Model Context Protocol)

LibreChat supports MCP servers for tool integrations:
- MCP manager: `packages/api/src/mcp/MCPManager.ts`
- OAuth reconnection for MCP tools: `packages/api/src/mcp/oauth/`
- Configure MCP servers in `librechat.yaml`

## Key Technologies

**Backend:** Express, Mongoose, Passport.js, Redis, Winston (logging)
**Frontend:** React, Vite, Recoil, React Query, Radix UI, Tailwind
**AI SDKs:** OpenAI, Anthropic, Google Generative AI, LangChain
**Database:** MongoDB
**Cache:** Redis
**Testing:** Jest, Playwright, Supertest, React Testing Library
