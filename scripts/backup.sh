#!/bin/bash
# ---------------------------------------------------------------
# Procurement Agent — Daily Backup Script
#
# What it backs up:
#   1. MongoDB full dump (all collections)
#   2. Product Dictionary export (JSON — your competitive moat)
#   3. Vendor config export (JSON)
#   4. Session files (if any)
#
# Usage:
#   ./scripts/backup.sh                    # backup to ./backups/
#   ./scripts/backup.sh /mnt/nas/backups   # backup to custom dir
#
# Schedule via cron:
#   0 2 * * * cd /path/to/procurement-agent && ./scripts/backup.sh
# ---------------------------------------------------------------

set -euo pipefail

BACKUP_ROOT="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

MONGO_URI="${MONGODB_URI:-mongodb://admin:admin123@localhost:27017/procurement?authSource=admin}"
DB_NAME="procurement"

echo "=== Procurement Agent Backup — $TIMESTAMP ==="
mkdir -p "$BACKUP_DIR"

# 1. MongoDB dump
echo "[1/4] MongoDB dump..."
if command -v mongodump &> /dev/null; then
  mongodump --uri="$MONGO_URI" --db="$DB_NAME" --out="$BACKUP_DIR/mongodump" --quiet
  echo "  -> mongodump complete"
else
  # Fallback: dump via Docker container if mongodump not installed locally
  echo "  mongodump not found locally, trying Docker..."
  docker exec procurement-mongodb mongodump \
    --username=admin --password=admin123 --authenticationDatabase=admin \
    --db="$DB_NAME" --out=/tmp/backup --quiet 2>/dev/null
  docker cp procurement-mongodb:/tmp/backup "$BACKUP_DIR/mongodump"
  docker exec procurement-mongodb rm -rf /tmp/backup
  echo "  -> mongodump via Docker complete"
fi

# 2. Product Dictionary export (the moat)
echo "[2/4] Product Dictionary export..."
if command -v mongoexport &> /dev/null; then
  mongoexport --uri="$MONGO_URI" --db="$DB_NAME" \
    --collection=items --out="$BACKUP_DIR/dictionary.json" --quiet
else
  docker exec procurement-mongodb mongoexport \
    --username=admin --password=admin123 --authenticationDatabase=admin \
    --db="$DB_NAME" --collection=items --out=/tmp/dictionary.json --quiet 2>/dev/null
  docker cp procurement-mongodb:/tmp/dictionary.json "$BACKUP_DIR/dictionary.json"
  docker exec procurement-mongodb rm /tmp/dictionary.json
fi
echo "  -> dictionary.json exported"

# 3. Vendor config export
echo "[3/4] Vendor config export..."
if command -v mongoexport &> /dev/null; then
  mongoexport --uri="$MONGO_URI" --db="$DB_NAME" \
    --collection=vendors --out="$BACKUP_DIR/vendors.json" --quiet
else
  docker exec procurement-mongodb mongoexport \
    --username=admin --password=admin123 --authenticationDatabase=admin \
    --db="$DB_NAME" --collection=vendors --out=/tmp/vendors.json --quiet 2>/dev/null
  docker cp procurement-mongodb:/tmp/vendors.json "$BACKUP_DIR/vendors.json"
  docker exec procurement-mongodb rm /tmp/vendors.json
fi
echo "  -> vendors.json exported"

# 4. Session files
echo "[4/4] Session files..."
if [ -d "./sessions" ] && [ "$(ls -A ./sessions 2>/dev/null)" ]; then
  cp -r ./sessions "$BACKUP_DIR/sessions"
  echo "  -> sessions copied"
else
  echo "  -> no sessions to backup"
fi

# Prune old backups (keep last 14 days)
echo ""
echo "Pruning backups older than 14 days..."
find "$BACKUP_ROOT" -maxdepth 1 -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true

# Summary
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo ""
echo "=== Backup complete ==="
echo "  Location: $BACKUP_DIR"
echo "  Size:     $BACKUP_SIZE"
echo ""
echo "To restore: ./scripts/restore.sh $BACKUP_DIR"
