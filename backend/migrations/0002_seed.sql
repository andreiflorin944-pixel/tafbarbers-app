-- Date de pornire (aceleași ca datele de test din aplicație). Se pot edita din dashboard.
INSERT INTO settings (key, value) VALUES
  ('business', '{"name":"TAFBarbers","tagline":"Barbershop","address":"","phone":"","website":"https://www.tafbarbers.ro","instagram":"tafbarbers","timezone":"Europe/Bucharest","slotStepMin":15,"cancelHours":12}');

INSERT INTO services (id, name, description, duration_min, price_bani, sort) VALUES
  ('svc-haircut-beard-skin-fade','Haircut & Beard – TAF Skin Fade','',45,10000,1),
  ('svc-haircut-beard-classic','Haircut & Beard – TAF Classic','',45,9000,2),
  ('svc-skin-fade','Skin Fade Haircut / Tuns Skin Fade','',30,7000,3),
  ('svc-classic','Classic Haircut / Tuns Clasic','',30,6000,4),
  ('svc-beard','Beard Trim & Contour / Tuns & Contur Barbă','',15,3500,5),
  ('svc-kids','Kids Haircut / Tuns Copii (sub 7 ani)','',30,5500,6),
  ('svc-beard-color','Beard Coloring / Vopsit Barbă','',15,5000,7);

INSERT INTO barbers (id, name, sort) VALUES ('barber-florin','Florin',1), ('barber-andrei','Andrei',2);
INSERT INTO barber_services (barber_id, service_id) SELECT b.id, s.id FROM barbers b, services s;

-- Program provizoriu: L–V 10–20, S 10–16, D închis.
INSERT INTO working_hours (barber_id, weekday, start_min, end_min)
  SELECT b.id, d.wd, 600, 1200 FROM barbers b, (SELECT 1 wd UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5) d;
INSERT INTO working_hours (barber_id, weekday, start_min, end_min) SELECT id, 6, 600, 960 FROM barbers;
