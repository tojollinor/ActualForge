# Docker layout

ActualForge uses two containers in the initial application stack.

```text
browser
  |
  v
actualforge:5006
  |
  +---- internal Docker network ---- finance-engine:5010
                                      |
                                      v
                              finance-engine-data
```

## Services

### actualforge

The `actualforge` service is built from `sync-server.Dockerfile` and exposes the application on host port `5006` by default.

Persistent data:

```text
actualforge-data -> /data
```

### finance-engine

The `finance-engine` service is built from `finance-engine.Dockerfile`.

Port `5010` is exposed only inside the Docker network. It is not published on the host by the default Compose configuration.

Persistent data:

```text
finance-engine-data -> /data
```

## Start locally

```bash
cp .env.example .env
docker compose up --build -d
```

Open ActualForge at:

```text
http://localhost:5006
```

Check container state with:

```bash
docker compose ps
```

The finance engine health check is automatic.

## Updates and Komodo

The stack uses stable service names and named volumes so it can later be managed by Komodo without changing the persistence model.

Release images are intended for GHCR:

- `ghcr.io/tojollinor/actualforge:<version>`
- `ghcr.io/tojollinor/actualforge-finance-engine:<version>`

The current `dev` tag is only the local/pre-release default.

Upstream Actual updates remain manual and are independent from container restart/update behavior.
