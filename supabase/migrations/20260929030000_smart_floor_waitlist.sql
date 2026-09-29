-- Gestione Sala Smart, the waitlist ("coda"): a party not at the door when
-- its table frees up is skipped for a while, and the table goes to the next
-- one in line. Shared by every device, like reservations' "Aspetta".
alter table waitlist add column skip_until timestamptz;
