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
