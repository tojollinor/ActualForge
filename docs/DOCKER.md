# Docker layout

ActualForge uses two containers.

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

## Development stack

`compose.yaml` is the source/development stack. Both images include local build definitions.

```bash
cp .env.example .env
docker compose up --build -d
```

Open `http://localhost:5006`.

The application server and finance engine both have health checks. Port 5010 stays internal.

## Release stack

`compose.release.yaml` contains no build definitions. It pulls pinned GHCR images.

```bash
cp .env.release.example .env
docker compose -f compose.release.yaml pull
docker compose -f compose.release.yaml up -d
```

The first release defaults to version `0.1.0`.

## Persistent data

```text
actualforge-data      -> /data
finance-engine-data   -> /data
```

Back up both volumes together before an upgrade. Container recreation keeps named volumes. Do not use `docker compose down -v` in production unless the data is intentionally being deleted.

## Health checks

```bash
docker compose -f compose.release.yaml ps
curl --fail http://127.0.0.1:5006/health
```

Both services should become healthy.

## Komodo

Use `compose.release.yaml` for published deployments. Keep the named volumes unchanged and change the explicit version only when deliberately upgrading.

See [OPERATIONS.md](./OPERATIONS.md).
