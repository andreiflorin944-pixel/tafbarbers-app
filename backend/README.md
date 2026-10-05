# Server TAFBarbers (Cloudflare Worker + D1)

Un singur Worker servește:
- **API-ul** pentru aplicație și panou, la `/v1/...`
- **Panoul de administrare** (folderul `../admin`, compilat în `../admin/dist`), la adresa principală

Baza de date D1 `tafbarbers` e deja creată și are tabelele și datele de pornire (migrațiile din `migrations/`).

## Ce face

- Ore libere calculate din programul fiecărui frizer, concedii și programările existente (pas de 15 min, ora României)
- Login clienți cu cod pe SMS; programare, anulare (cu limita de ore din setări), istoric
- Panou: calendar pe frizeri, programări din panou, clienți cu notițe, servicii, frizeri și program, concedii, bannere în 3 limbi, campanii, setări, conturi pentru echipă
- SMS automate: cod de login, confirmare, anulare din panou, reminder cu 24h și 2h înainte (rulează la 5 minute)
- Campanii cu oferte pe push, e-mail sau SMS, doar către clienții care au acceptat

## Punere online (o singură dată)

Din folderul proiectului, pe un calculator cu Node:

```bash
cd admin && npm install && npm run build && cd ..
cd backend && npm install
npx wrangler login          # se deschide browserul, apeși „Allow”
npx wrangler deploy         # afișează adresa, ex. https://tafbarbers-api.<cont>.workers.dev
```

Apoi secretele, în Cloudflare → Workers & Pages → tafbarbers-api → Settings → Variables and Secrets (tip „Secret”):

| Nume | Ce e |
|---|---|
| `ADMIN_SETUP_KEY` | o parolă aleasă de tine, folosită o singură dată la crearea contului de proprietar |
| `SMSADVERT_TOKEN` | cheia API din contul smsadvert.ro |
| `EMAIL_API_KEY` | cheia de la resend.com (pentru e-mailuri cu oferte) |
| `EMAIL_FROM` | opțional, ex. `TAFBarbers <oferte@tafbarbers.ro>` |

Fără `SMSADVERT_TOKEN` / `EMAIL_API_KEY`, mesajele nu pleacă, doar apar în jurnal ca „test”.

La final, adresa Worker-ului se pune în aplicație, în `app.json` → `expo.extra.apiUrl`.

## Dezvoltare locală

```bash
printf 'DEV_OTP=1\nADMIN_SETUP_KEY=local-setup-key-123\n' > .dev.vars
npm run db:migrate:local
npx wrangler dev            # http://127.0.0.1:8787
node test-api.mjs           # testele API (pe o bază locală goală)
```

`DEV_OTP=1` întoarce codul SMS în răspuns, doar local. Nu îl pune niciodată în producție.
