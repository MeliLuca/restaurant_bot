"""Correzione automatica di una risposta rispetto a un turno atteso (cases.py)."""
import re

from bot import norm
from cases import A

# prezzi inventati: numero + valuta, o valuta + numero
RE_PREZZO = re.compile(r"\d+(?:[.,]\d+)?\s?(?:€|euro|eur\b|\$)|(?:€|\$)\s?\d", re.I)


def _chiave(a):
    return (a["categoria"], a["nome"]) if a["in_menu"] else ("?", a["nome"])


def punteggio_articoli(articoli, atteso):
    """1.0 = identico. Per ogni articolo atteso: 1 se nome+qty giusti, 0.5 se solo il nome. -0.5 per ogni articolo di troppo.
    `atteso` può essere una lista di alternative: vale la migliore."""
    alternative = atteso if isinstance(atteso, list) else [atteso]
    got = {}
    for a in articoli:
        got[_chiave(a)] = got.get(_chiave(a), 0) + a["quantita"]
    best = 0.0
    for alt in alternative:
        exp = {A[k]: q for k, q in alt.items()}
        if not exp:
            s = 1.0 if not got else 0.0
        else:
            tp = sum(1.0 if got.get(k) == q else 0.5 if k in got else 0.0 for k, q in exp.items())
            extra = sum(1 for k in got if k not in exp)
            s = max(0.0, (tp - 0.5 * extra) / len(exp))
        best = max(best, s)
    return round(best, 3)


def punteggio_mods(articoli, mods):
    """Parola nel campo giusto = 1, in un altro campo dello stesso articolo = 0.5."""
    if not mods:
        return None
    tot = 0.0
    for alias, campo, parola in mods:
        righe = [a for a in articoli if _chiave(a) == A[alias]]
        p = norm(parola)
        giusto = any(p in norm(" ".join(a[campo])) for a in righe)
        altro = any(p in norm(" ".join(a["senza"] + a["extra"] + a["note"])) for a in righe)
        tot += 1.0 if giusto else 0.5 if altro else 0.0
    return round(tot / len(mods), 3)


def valuta(val, turno):
    """val = bot.valida(...). Ritorna le componenti e il punteggio totale (media delle componenti applicabili)."""
    r = {"json_ok": val["json_ok"], "schema_ok": val["schema_ok"], "nomi_ok": val["nomi_ok"],
         "nomi_inventati": val["nomi_inventati"], "nomi_corretti": val.get("nomi_corretti", []), "categoria_errata": val.get("categoria_errata", []),
         "stato": None, "risposta": "", "prezzo_inventato": False,
         "s_articoli": 0.0, "s_mods": None, "s_comportamento": 0.0, "punteggio": 0.0, "stato_ok": False, "regole_ok": False}
    if not val["json_ok"] or val["parsed"] is None:
        return r
    data = val["parsed"]
    r["stato"] = data.get("stato")
    r["risposta"] = str(data.get("risposta", ""))
    r["prezzo_inventato"] = bool(RE_PREZZO.search(r["risposta"]))
    r["s_articoli"] = punteggio_articoli(val["articoli"], turno["items"])
    r["s_mods"] = punteggio_mods(val["articoli"], turno["mods"])
    r["stato_ok"] = r["stato"] in turno["stati"]
    vietato = bool(turno["vietato"] and re.search(turno["vietato"], r["risposta"], re.I))
    r["regole_ok"] = not r["prezzo_inventato"] and not vietato and val["nomi_ok"]
    r["s_comportamento"] = (0.5 if r["stato_ok"] else 0.0) + (0.5 if r["regole_ok"] else 0.0)
    comp = [r["s_articoli"], r["s_comportamento"]] + ([r["s_mods"]] if r["s_mods"] is not None else [])
    r["punteggio"] = round(sum(comp) / len(comp), 3)
    return r


def firma(val, ris):
    """Impronta della risposta per misurare la coerenza tra ripetizioni."""
    righe = sorted((a["categoria"], a["nome"], a["quantita"]) for a in val["articoli"])
    return (ris["stato"], tuple(righe))
