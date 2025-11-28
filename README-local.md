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

## Docker Networking

### Connecting to Services on Host Machine

When LibreChat runs in Docker and needs to connect to a service running on the host (e.g., a local API server), use `host.docker.internal` instead of `localhost`:

```yaml
# In librechat.yaml
baseURL: "http://host.docker.internal:8000"  # NOT localhost:8000
```

`localhost` inside a container refers to the container itself, not the host machine.
