"""Utenti di prova della suite e dati di riferimento letti dal DB (sola lettura).

Gli utenti ZZAI-redteam-A / -B sono NON attivi (non compaiono nella schermata di
accesso) e vengono cancellati per id alla fine: con loro spariscono le loro chat
(on delete cascade).
"""
import uuid

from common import psql, q

ADMIN_ROLE = "70000000-0000-0000-0000-000000000001"
PREFIX = "ZZAI-redteam"


class Fixtures:
    def __init__(self):
        self.users = {}
        self.menu = {}         # menu_item_id -> prezzo di listino
        self.ingredients = {}  # ingredient_id -> prezzo come aggiunta
        self.ingredient_names = []
        self.quick_notes = []
        self.categories = []
        self.capacity = {}     # nome tavolo -> posti
        self.created_custom_items = []

    # --- utenti -------------------------------------------------------------------

    def setup(self):
        leftovers = psql(f"select id from app_users where name like {q(PREFIX + '%')}")
        if leftovers:
            raise SystemExit(f"Utenti {PREFIX} rimasti da un'esecuzione precedente: "
                             f"{[r[0] for r in leftovers]} — cancellali con cleanup.py")
        for key in ("A", "B"):
            uid = str(uuid.uuid4())
            psql(f"insert into app_users (id, name, role_id, pin_hash, is_active) values "
                 f"({q(uid)}, {q(f'{PREFIX}-{key}')}, {q(ADMIN_ROLE)}, 'x', false)")
            self.users[key] = uid
        self.load_reference()

    def teardown(self):
        for item_id in self.created_custom_items:
            # solo il segnaposto creato dal test e mai usato in un ordine
            psql(f"delete from menu_items where id = {q(item_id)} and is_custom and not exists "
                 f"(select 1 from order_items where menu_item_id = {q(item_id)})")
        for uid in self.users.values():
            psql(f"delete from app_users where id = {q(uid)}")
        self.users = {}

    # --- dati di riferimento (letti, mai scritti) -----------------------------------

    def load_reference(self):
        self.menu = {r[0]: float(r[1]) for r in psql("select id, price from menu_items")}
        rows = psql("select id, price, name from ingredients")
        self.ingredients = {r[0]: float(r[1]) for r in rows}
        self.ingredient_names = [r[2] for r in rows]
        self.quick_notes = [r[0] for r in psql("select name from line_notes")]
        self.categories = [r[0] for r in psql("select name from categories")]
        self.capacity = {r[0]: int(r[1]) for r in psql("select name, capacity from tables")}

    def new_conversation(self, user_key, title):
        """Una chat inserita direttamente (senza modello), per i test del punto 10."""
        cid = str(uuid.uuid4())
        psql(f"insert into ai_conversations (id, user_id, title, titled) values "
             f"({q(cid)}, {q(self.users[user_key])}, {q(title)}, true)")
        psql(f"insert into ai_messages (conversation_id, role, content) values "
             f"({q(cid)}, 'user', 'messaggio privato di prova')")
        return cid

    def category_without_placeholder(self):
        rows = psql("select c.id from categories c where not exists (select 1 from menu_items m "
                    "where m.category_id = c.id and m.is_custom) order by c.sort_order limit 1")
        return rows[0][0] if rows else None

    def placeholder_of(self, category_id):
        rows = psql(f"select id from menu_items where category_id = {q(category_id)} and is_custom")
        return rows[0][0] if rows else None
