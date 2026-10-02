# ActualForge operations

## Install a published release

```bash
cp .env.release.example .env
docker compose -f compose.release.yaml pull
docker compose -f compose.release.yaml up -d
```

Open `http://<host>:5006`. Change the host port with `ACTUALFORGE_PORT`.

## Verify health

```bash
docker compose -f compose.release.yaml ps
curl --fail http://127.0.0.1:5006/health
```

Both containers should report healthy.

## Persistent data

- `actualforge-data`: Actual server/budget data.
- `finance-engine-data`: ActualForge contracts, links, matches, clarifications and predictions.

Treat both volumes as one backup set. Backing up only one side can create a point-in-time mismatch.

## Update

Before an update:

1. stop application writes,
2. back up both named volumes,
3. record the deployed ActualForge version,
4. read the target release notes and pinned Actual Budget base,
5. change both image tags to the target version.

Then:

```bash
docker compose -f compose.release.yaml pull
docker compose -f compose.release.yaml up -d
docker compose -f compose.release.yaml ps
```

## Rollback

If the newer release changed persisted schemas, restore **both** pre-upgrade volume backups before starting older containers. Do not run an older finance-engine against a database migrated by a newer version unless downgrade compatibility is explicitly documented.

## Logs

```bash
docker compose -f compose.release.yaml logs --tail=200 actualforge
docker compose -f compose.release.yaml logs --tail=200 finance-engine
docker compose -f compose.release.yaml logs -f
```

## Komodo

Use `compose.release.yaml`, preserve both named volumes and change only explicit version tags when deliberately upgrading. Do not configure automatic Actual-upstream merges.

## Release provenance

`ACTUALFORGE_RELEASE.json` records the ActualForge version, Actual Budget base, component/schema versions and image names. Release CI validates it before publication.

Each GitHub Release includes the deployment bundle, SHA-256 checksums and exact published image digests.
