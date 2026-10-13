# Google Play: pașii până la publicare (TAFBarbers)

Aplicația: **ro.tafbarbers.app**, nume „TAFBarbers”. Răspunsurile despre date sunt în [magazine-confidentialitate.md](magazine-confidentialitate.md).

## 1. Termini verificarea contului
- Verificarea identității, apoi verificarea telefonului din Play Console (Console → Verificare cont). Fără ele nu poți publica nimic.

## 2. Build-ul Android nou (AAB)
- Pe laptop, în `~/tafbarbers-app`, după ce aduci ultima versiune de pe GitHub: `npx eas build -p android --profile production`.
- Iese un fișier `.aab` (îl descarci din linkul dat de EAS). Numărul versiunii crește singur la fiecare build.
- Build-ul de azi e vechi (fără Lângă salon, poza frizerului, eticheta TAF Club), deci faci unul nou.

## 3. Creezi aplicația în Play Console
- Create app → nume „TAFBarbers”, limba implicită Română, App (nu joc), Free.
- Bifezi declarațiile (politici, legi de export). Le citești și le accepți tu.

## 4. Testare internă (imediat, fără revizie lungă)
- Testing → Internal testing → Create release → încarci `.aab`-ul.
- Testers: o listă cu adresele Gmail ale echipei (până la 100). Le trimiți linkul de înscriere și își instalează aplicația din Play.
- Prima dată Play îți cere să accepți **Play App Signing** (recomandat, Google păstrează cheia de semnare).

## 5. Testare închisă: obligatorie la conturile personale noi
- Tipul contului îl vezi în Play Console → Contul dezvoltatorului → Detalii de cont („Persoană fizică” sau „Organizație”).
- Dacă contul e **personal** (nu de firmă cu D-U-N-S), Google cere înainte de publicare: **minimum 12 testeri înscriși, timp de 14 zile la rând**, într-un test închis.
- Testing → Closed testing → creezi o pistă, încarci același `.aab`, adaugi testerii (Gmail-uri: echipa, prieteni, clienți fideli) și le dai linkul.
- Testerii trebuie să rămână înscriși toate cele 14 zile. Ia 15-20 de oameni ca să ai rezervă.
- După 14 zile apare butonul **Apply for production**: răspunzi la câteva întrebări despre test și Google aprobă de obicei în câteva zile.
- Dacă contul e de firmă, sari peste acest pas.

## 6. App content (meniul Policy → App content)
| Secțiune | Ce pui |
|---|---|
| Privacy policy | `https://app.tafbarbers.ro/legal/privacy` |
| App access | „Toate sau unele funcții sunt restricționate” → adaugi contul demo (vezi „Contul demo pentru Google” mai jos). |
| Ads | Nu conține reclame |
| Content rating | Chestionarul IARC: e-mailul tău, categoria „Toate celelalte tipuri de aplicații”. Violență, sex, limbaj, droguri, jocuri de noroc: Nu. Utilizatorii comunică între ei sau își partajează locația cu alții: Nu. Cumpărături digitale: Nu (cardurile cadou și abonamentele sunt pentru servicii la salon, plătite prin Stripe). Iese PEGI 3 / Everyone. |
| Target audience | 18+ (sau 16+ dacă vrei; nu alege sub 13) |
| Data safety | După [magazine-confidentialitate.md](magazine-confidentialitate.md) |
| Account deletion | `https://app.tafbarbers.ro/sterge-cont` |
| Location permissions | Declarația pentru locația în fundal plus un video scurt (vezi mai jos). |
| Government / Financial / Health / News | Nu |

## 7. Fișa din magazin (Grow → Store presence → Main store listing)
- **Nume** (max 30): `TAF Barbers – programări`
- **Descriere scurtă** (max 80): `Programează-te la TAF Barbers în câteva secunde, fără telefoane și așteptare.`
- **Descriere completă** (propunere, o ajustezi tu):

> Aplicația oficială TAF Barbers. Îți alegi salonul, frizerul și serviciul, vezi orele libere și te programezi în câteva secunde.
>
> • Programări rapide, cu reamintire înainte de vizită
> • Îți alegi frizerul preferat și vezi profilul lui
> • Muți sau anulezi programarea direct din aplicație
> • TAF Club: servicii și ore rezervate doar membrilor
> • Carduri cadou și produse din magazinul salonului
> • Oferte și bonus de ziua ta, doar dacă vrei să le primești
>
> Fără apeluri, fără așteptare. Ne vedem pe scaun.

- **Icon 512×512**: îl generez din `assets/icon.png`.
- **Feature graphic 1024×500**: îl pot face eu.
- **Capturi de ecran telefon**: minimum 2 (recomandat 4-8), format 9:16. Cel mai simplu le faci tu de pe un telefon cu aplicația instalată din testul intern.
- **Categorie**: Beauty (sau Lifestyle). **E-mail de contact**: cel al salonului.

## Lângă salon pe Android (rămâne în prima versiune)
Google cere o declarație separată pentru locația în fundal: Policy → App content → **Sensitive app permissions → Location permissions**.
- **Ce funcție o folosește:** „Notificare când clientul ajunge lângă salon (geofence), pornită doar de el din Contul meu.”
- **De ce în fundal:** „Clientul nu are aplicația deschisă când trece pe lângă salon; poziția rămâne pe telefon, serverul află doar salonul lângă care a ajuns.”
- **Video (max 30 s, link YouTube nelistat):** deschizi aplicația → Contul meu → pornești „Lângă salon” → apare explicația noastră → apeși Continuă → fereastra Android de permisiune → alegi „Permite tot timpul”. Filmezi ecranul telefonului cu înregistrarea de ecran din Android.
- Dacă Google respinge declarația, versiunea rămâne blocată până o refaci sau scoatem permisiunea; atunci o scot eu din aplicație într-un build nou.

## Contul demo pentru Google
Google verifică aplicația logându-se în ea, dar nu poate primi codul prin SMS. De aceea un număr anume primește mereu același cod de 6 cifre, fără SMS.
1. Alegi un număr care nu e al nimănui (de exemplu 0700 000 000) și un cod de 6 cifre. Nu le trimite pe chat.
2. În Terminal, în `~/tafbarbers-app/backend`: `npx wrangler secret put REVIEW_LOGIN`. Când te întreabă valoarea, scrii `numărul:codul`, de exemplu `0700000000:123456`.
3. În aplicație, la Creează cont, faci un cont cu numărul acela, numele „Google Review” și un e-mail al vostru. Codul cerut e cel ales de tine.
4. În Play Console → App access scrii: telefon, e-mail și cod, plus „Pe ecranul Intră în cont introduceți telefonul și e-mailul, apoi codul de mai sus.”
