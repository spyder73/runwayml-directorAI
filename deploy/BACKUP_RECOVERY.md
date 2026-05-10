# Backup And Recovery

These are manual VPS steps for preserving production data.

## What To Back Up

Production data should live under:

```txt
/opt/lifestory/data/lifestory.sqlite
/opt/lifestory/data/media/
```

Backups should be written outside the app directory, for example:

```txt
/opt/backups/lifestory
```

## Create A Backup

Run from `/opt/lifestory` on the VPS:

```bash
bash deploy/backup-lifestory.sh
```

The script runs the equivalent of:

```bash
mkdir -p /opt/backups/lifestory
sqlite3 /opt/lifestory/data/lifestory.sqlite ".backup '/opt/backups/lifestory/lifestory-$(date +%F-%H%M).sqlite'"
tar -czf "/opt/backups/lifestory/media-$(date +%F-%H%M).tar.gz" -C /opt/lifestory/data media
```

Keep at least one local copy before hackathon judging:

```bash
scp user@your-vps:/opt/backups/lifestory/lifestory-YYYY-MM-DD-HHMM.sqlite .
scp user@your-vps:/opt/backups/lifestory/media-YYYY-MM-DD-HHMM.tar.gz .
```

## Recovery Check

Use a staging copy first if possible.

```bash
cd /opt/lifestory
docker compose -p lifestory stop web
cp /opt/backups/lifestory/lifestory-YYYY-MM-DD-HHMM.sqlite /opt/lifestory/data/lifestory.sqlite
rm -rf /opt/lifestory/data/media
mkdir -p /opt/lifestory/data/media
tar -xzf /opt/backups/lifestory/media-YYYY-MM-DD-HHMM.tar.gz -C /opt/lifestory/data
chmod 700 /opt/lifestory/data
docker compose -p lifestory up -d web
```

Restore DB and media into `/opt/lifestory/data/`, then Log in and open a completed session to confirm the database and private media agree with each other.

Also confirm:

```bash
docker compose -p lifestory ps
docker compose -p lifestory logs --tail=100 web
```
