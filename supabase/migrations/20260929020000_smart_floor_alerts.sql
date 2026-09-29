-- Gestione Sala Smart, phase 4: late-booking and "table still occupied"
-- alerts. "Aspetta" puts an alert off for everyone at once, so every
-- manager's screen agrees on what still needs an answer.

alter table reservations add column alert_snoozed_until timestamptz;
