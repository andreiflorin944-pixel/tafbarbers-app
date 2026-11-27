-- Pachetul de sezon cumpărat ca voucher (ex. „Experiența TAF”: tuns, aranjarea bărbii, 2 spălări…), ca să apară pe voucher și în registru.
ALTER TABLE gift_cards ADD COLUMN package_name TEXT;
ALTER TABLE gift_cards ADD COLUMN package_items TEXT;
