#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lifestory}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/lifestory}"
STAMP="$(date +%F-%H%M)"

DB_PATH="$APP_DIR/data/lifestory.sqlite"
MEDIA_DIR="$APP_DIR/data/media"
DB_BACKUP="$BACKUP_DIR/lifestory-$STAMP.sqlite"
MEDIA_BACKUP="$BACKUP_DIR/media-$STAMP.tar.gz"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for consistent SQLite backups." >&2
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "SQLite database not found at $DB_PATH" >&2
  exit 1
fi

if [[ ! -d "$MEDIA_DIR" ]]; then
  echo "Private media directory not found at $MEDIA_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_PATH" ".backup '$DB_BACKUP'"
tar -czf "$MEDIA_BACKUP" -C "$APP_DIR/data" media

echo "Created SQLite backup: $DB_BACKUP"
echo "Created media backup: $MEDIA_BACKUP"
