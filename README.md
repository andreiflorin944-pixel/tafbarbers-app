# TAFBarbers – aplicația de programări

Aplicație Expo (React Native) pentru iOS, Android și web. Acum rulează cu **date de test**
(cele 7 servicii și frizerii Florin și Andrei din Barberly). Următorul pas e legarea la
Barberly Booking API printr-un server intermediar care ține cheia API.

## Cum o pornești

1. Instalează [Node.js LTS](https://nodejs.org).
2. Copiază folderul pe calculator, deschide un terminal în el și rulează:
   ```bash
   npm install
   npx expo start
   ```
3. Scanează codul QR cu aplicația **Expo Go** de pe telefon (sau apasă `w` pentru browser).

## Structura

- `src/app/` – ecranele (fiecare fișier e o pagină)
  - `(tabs)/index.tsx` – Acasă
  - `(tabs)/services.tsx` – alegerea serviciului
  - `book/barber.tsx`, `book/time.tsx`, `book/confirm.tsx`, `book/success.tsx` – pașii rezervării
  - `(tabs)/bookings.tsx` – programările mele (cu anulare)
  - `(tabs)/account.tsx`, `login.tsx` – cont cu telefonul
- `src/data/mock.ts` – serviciile, frizerii și programul (date de test)
- `src/api/client.ts` – interfața către backend; `src/api/mock.ts` e implementarea de test
- `src/theme.ts` – culorile (negru și auriu)

## Ce e provizoriu

- Programul de lucru (L–V 10–20, S 10–16, D închis), adresa și telefonul.
- Orele ocupate sunt generate, nu vin din Barberly.
- Login-ul acceptă orice cod din 4 cifre și nu se salvează după închiderea aplicației.
