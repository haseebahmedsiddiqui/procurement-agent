#!/bin/bash
# ---------------------------------------------------------------
# Procurement Agent — Restore from Backup
#
# Usage:
#   ./scripts/restore.sh ./backups/20260409_020000
#
# WARNING: This will REPLACE the current database contents.
# The script creates a pre-restore backup first for safety.
# ---------------------------------------------------------------

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <backup-directory>"
  echo "Example: $0 ./backups/20260409_020000"
  exit 1
fi

BACKUP_DIR="$1"
MONGO_URI="${MONGODB_URI:-mongodb://admin:admin123@localhost:27017/procurement?authSource=admin}"
DB_NAME="procurement"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: Backup directory not found: $BACKUP_DIR"
  exit 1
fi

echo "=== Procurement Agent Restore ==="
echo "  Source: $BACKUP_DIR"
echo ""

# Safety: create a pre-restore snapshot
SAFETY_DIR="./backups/pre-restore-$(date +%Y%m%d_%H%M%S)"
echo "[0/3] Creating safety snapshot at $SAFETY_DIR ..."
mkdir -p "$SAFETY_DIR"
if command -v mongodump &> /dev/null; then
  mongodump --uri="$MONGO_URI" --db="$DB_NAME" --out="$SAFETY_DIR/mongodump" --quiet
else
  docker exec procurement-mongodb mongodump \
    --username=admin --password=admin123 --authenticationDatabase=admin \
    --db="$DB_NAME" --out=/tmp/safety --quiet 2>/dev/null
  docker cp procurement-mongodb:/tmp/safety "$SAFETY_DIR/mongodump"
  docker exec procurement-mongodb rm -rf /tmp/safety
fi
echo "  -> safety snapshot saved"

# 1. Restore MongoDB dump
if [ -d "$BACKUP_DIR/mongodump" ]; then
  echo "[1/3] Restoring MongoDB dump..."
  if command -v mongorestore &> /dev/null; then
    mongorestore --uri="$MONGO_URI" --db="$DB_NAME" \
      --drop "$BACKUP_DIR/mongodump/$DB_NAME" --quiet
  else
    docker cp "$BACKUP_DIR/mongodump" procurement-mongodb:/tmp/restore
    docker exec procurement-mongodb mongorestore \
      --username=admin --password=admin123 --authenticationDatabase=admin \
      --db="$DB_NAME" --drop /tmp/restore/$DB_NAME --quiet 2>/dev/null
    docker exec procurement-mongodb rm -rf /tmp/restore
  fi
  echo "  -> MongoDB restored"
else
  echo "[1/3] No mongodump found, skipping MongoDB restore"
fi

# 2. Restore sessions
if [ -d "$BACKUP_DIR/sessions" ]; then
  echo "[2/3] Restoring session files..."
  mkdir -p ./sessions
  cp -r "$BACKUP_DIR/sessions/"* ./sessions/ 2>/dev/null || true
  echo "  -> sessions restored"
else
  echo "[2/3] No sessions in backup, skipping"
fi

echo "[3/3] Verifying..."
echo ""

# Quick verification: count documents
if command -v mongosh &> /dev/null; then
  echo "Collection counts:"
  mongosh "$MONGO_URI" --quiet --eval "
    const db = db.getSiblingDB('$DB_NAME');
    const colls = ['vendors', 'categories', 'items', 'prices', 'rfqs', 'matchfeedbacks'];
    colls.forEach(c => {
      const n = db.getCollection(c).countDocuments();
      print('  ' + c + ': ' + n);
    });
  "
fi

echo ""
echo "=== Restore complete ==="
echo "  Safety snapshot: $SAFETY_DIR"
echo "  Restart the app to pick up restored data."
