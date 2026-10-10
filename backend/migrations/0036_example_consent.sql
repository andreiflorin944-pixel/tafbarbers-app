-- Dovada acordului pentru perechile înainte/după arătate ca exemplu altor clienți (consilierul AI de tunsori):
-- când s-a bifat și cine din echipă a bifat (doar proprietarul poate bifa). Clientul vede bifa în aplicație și o poate scoate.
ALTER TABLE before_after ADD COLUMN example_consent_at TEXT;
ALTER TABLE before_after ADD COLUMN example_consent_by TEXT;
-- Când a scos clientul acordul din aplicație (sau proprietarul bifa), pentru istoric.
ALTER TABLE before_after ADD COLUMN example_withdrawn_at TEXT;
