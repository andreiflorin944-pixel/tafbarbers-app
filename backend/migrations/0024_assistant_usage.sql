-- Câte mesaje trimite pe zi fiecare client (sau adresă IP) asistentului din aplicație, ca să nu fie folosit abuziv.
CREATE TABLE assistant_usage (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
