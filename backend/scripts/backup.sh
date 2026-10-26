#!/bin/sh
# Copie de siguranță a bazei de date din Cloudflare (D1) pe acest calculator.
# Rulează din folderul backend:  npm run backup
# Fișierul conține datele clienților: ține-l doar pe calculatorul tău (sau pe un disc criptat), nu în Git și nu pe e-mail.
set -e
DIR="${TAF_BACKUP_DIR:-$HOME/tafbarbers-backups}"
mkdir -p "$DIR"
FILE="$DIR/tafbarbers-$(date +%Y-%m-%d-%H%M).sql"
npx wrangler d1 export tafbarbers --remote --output="$FILE"
echo ""
echo "Backup salvat: $FILE ($(du -h "$FILE" | cut -f1))"
echo "Verifică-l cu:  npm run backup:test"
