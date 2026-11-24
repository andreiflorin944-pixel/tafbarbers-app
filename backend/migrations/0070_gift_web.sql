-- Card cadou cumpărat de pe site (app.tafbarbers.ro/cadou), fără cont în aplicație: cine l-a cumpărat, ca salonul
-- să-l poată contacta, iar voucherul să-i ajungă pe e-mail. La cardurile din aplicație cumpărătorul e contul (buyer_client_id).
ALTER TABLE gift_cards ADD COLUMN web_buyer_name TEXT;
ALTER TABLE gift_cards ADD COLUMN web_buyer_phone TEXT;
ALTER TABLE gift_cards ADD COLUMN web_buyer_email TEXT;
