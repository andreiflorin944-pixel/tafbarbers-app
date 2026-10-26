#!/bin/sh
# Restaurare de probă: încarcă ultimul backup într-o bază de date locală, separată (nu atinge nimic din Cloudflare),
# și compară numărul de clienți și de programări cu baza de date reală.
# Rulează din folderul backend:  npm run backup:test   (sau:  sh scripts/backup-test.sh fisierul.sql)
set -e
DIR="${TAF_BACKUP_DIR:-$HOME/tafbarbers-backups}"
FILE="${1:-$(ls -t "$DIR"/tafbarbers-*.sql 2>/dev/null | head -1)}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Nu am găsit niciun backup în $DIR. Rulează întâi:  npm run backup"
  exit 1
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "Restaurez $FILE într-o bază de probă ($TMP)..."
npx wrangler d1 execute tafbarbers --local --persist-to="$TMP" --file="$FILE" >/dev/null
Q="SELECT (SELECT count(*) FROM clients) AS clienti, (SELECT count(*) FROM bookings) AS programari, (SELECT max(created_at) FROM bookings) AS ultima_programare"
echo ""
echo "În backup-ul restaurat:"
npx wrangler d1 execute tafbarbers --local --persist-to="$TMP" --command="$Q"
echo ""
echo "În baza de date reală (acum):"
npx wrangler d1 execute tafbarbers --remote --command="$Q"
echo ""
echo "Dacă cifrele sunt aproape la fel (diferă doar ce s-a programat de la backup încoace), restaurarea merge."
