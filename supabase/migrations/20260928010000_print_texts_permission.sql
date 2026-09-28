-- "Testi di stampa": a narrower permission than manage_printers. Whoever holds
-- it can change the wording of a print template's static text blocks (header
-- lines, greeting, footer notes) but not the layout, the printers, or which
-- template each printer uses. New key in src/lib/auth/permissions.ts.
--
-- Granted to whoever already manages printers: the wider permission implies
-- the narrower one, and matching on the capability rather than on role names
-- keeps this correct for renamed and custom roles.
update roles
set permissions = permissions || 'edit_print_texts'::text
where 'manage_printers' = any (permissions)
  and not ('edit_print_texts' = any (permissions));
