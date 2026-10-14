-- Reducerea unui banner cu serviciu (ex. -15% la Haircut & Beard): cât e activ bannerul, serviciul costă mai puțin
-- în aplicație și la programare. NULL = bannerul e doar anunț.
ALTER TABLE promos ADD COLUMN discount_percent INTEGER;
