-- Conținut de pornire: descrierea salonului, politica de anulare, descrierile serviciilor și bannerele de test.
UPDATE settings SET value = json_set(value,
  '$.description', 'TAFBarbers este un barbershop de top, care oferă o experiență de tuns și îngrijire masculină deosebită. Cu o estetică elegantă și modernă, TAFBarbers se remarcă prin atenția la detalii și servicii de cea mai înaltă calitate.',
  '$.cancellationPolicy', 'Poți anula programarea cu cel mult 12 ore înainte și se acceptă o singură neprezentare. Orice altă neprezentare sau anulare cu mai puțin de 12 ore înainte implică plata integrală a programării.',
  '$.minLeadMin', 30,
  '$.maxDaysAhead', 30
) WHERE key = 'business';

UPDATE services SET description = 'Skin Fade de la 0 / 0.5 pentru un final curat și precis, plus barbă.', color = '#3D4BE0' WHERE id = 'svc-haircut-beard-skin-fade';
UPDATE services SET description = 'Tuns clasic de la 0.5 în sus pentru un aspect natural, plus barbă.', color = '#3D4BE0' WHERE id = 'svc-haircut-beard-classic';
UPDATE services SET description = 'Tunsoare executată în intervalul 0.0 - 0.5.', color = '#5FE0D0' WHERE id = 'svc-skin-fade';
UPDATE services SET description = 'Tunsoare executată de la nr. 1 în sus, cu formă clasică.', color = '#62D6F0' WHERE id = 'svc-classic';
UPDATE services SET description = 'Tuns și contur barbă.', color = '#E5625E' WHERE id = 'svc-beard';
UPDATE services SET description = 'Valabil doar pentru copii sub 7 ani.', color = '#F2E85C' WHERE id = 'svc-kids';
UPDATE services SET description = 'Vopsit barbă (castaniu închis / negru).', color = '#444448' WHERE id = 'svc-beard-color';

INSERT INTO promos (id, kicker, title, text, cta, icon, action_type, action_value, sort) VALUES
  ('promo-week', 'OFERTA SĂPTĂMÂNII', '-15% la Haircut & Beard', 'De luni până miercuri, la orice frizer. Locuri limitate.', 'Rezervă oferta', 'pricetag', 'service', 'svc-haircut-beard-skin-fade', 1),
  ('promo-bestseller', 'CEL MAI CERUT SERVICIU', 'Skin Fade Haircut', 'Alegerea nr. 1 a clienților noștri săptămâna aceasta.', 'Programează-te', 'flame', 'service', 'svc-skin-fade', 2),
  ('promo-product', 'PRODUSUL SĂPTĂMÂNII', 'Ceară de păr mată', 'Fixare puternică, aspect natural. O găsești în salon.', 'Întreabă frizerul', 'bag-handle', 'book', NULL, 3),
  ('promo-academy', 'ACADEMIA TAF', 'Devino barber', 'Curs pentru începători, grupă nouă în curând. Rezervă-ți locul.', 'Află mai mult', 'school', 'url', 'https://www.tafbarbers.ro', 4);
