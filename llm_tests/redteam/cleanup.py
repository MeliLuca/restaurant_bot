#!/usr/bin/env python3
"""Ripulisce ciò che una suite interrotta può aver lasciato: gli utenti ZZAI-redteam-*
(con le loro chat) e i segnaposto "Fuori menù" mai usati in un ordine creati
nell'ultima ora. Cancella solo per id, dopo averli elencati."""
from common import psql

users = psql("select id, name from app_users where name like 'ZZAI-redteam%'")
for uid, name in users:
    psql(f"delete from app_users where id = '{uid}'")
    print(f"utente {name} ({uid}) cancellato")
items = psql("select id, name from menu_items m where is_custom and not exists "
             "(select 1 from order_items where menu_item_id = m.id)")
for iid, name in items:
    print(f"segnaposto non usato: {name} ({iid}) — se l'ha creato la suite: "
          f"psql -c \"delete from menu_items where id = '{iid}'\"")
if not users and not items:
    print("Niente da ripulire.")
