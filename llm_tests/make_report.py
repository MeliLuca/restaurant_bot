#!/usr/bin/env python3
"""Legge results.jsonl, ricalcola i punteggi dalle risposte grezze e scrive risultati.xlsx (3 fogli).

  python make_report.py                                   # results.jsonl -> risultati.xlsx
  python make_report.py --results results_smoke.jsonl --out risultati_smoke.xlsx
"""
import argparse
import json
import os
import statistics as st
from collections import Counter, defaultdict

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

import bot
from cases import A, CASI
from run_tests import CONFIGS, carica_righe
from scoring import firma, valuta

HERE = os.path.dirname(os.path.abspath(__file__))
CASO = {c["id"]: c for c in CASI}
CFG = {c["id"]: c for c in CONFIGS}
ORDINE = [c["id"] for c in CONFIGS]
LABEL = {c["id"]: c["etichetta"] for c in CONFIGS}


def media(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 3) if xs else None


def testo_atteso(turno):
    alt = turno["items"] if isinstance(turno["items"], list) else [turno["items"]]
    parti = []
    for d in alt:
        parti.append(", ".join(f"{q}x {A[k][1]}" for k, q in d.items()) or "(nessun articolo)")
    mods = "; ".join(f"{A[a][1]}: {c}~{p}" for a, c, p in turno["mods"])
    return " | ".join(parti) + (f"  [mod: {mods}]" if mods else ""), "/".join(turno["stati"])


def carica(path):
    idx = bot.indice_menu(bot.carica_menu())
    righe = carica_righe(path)
    calls, warm, cfg_skip = [], {}, {}
    for r in righe:
        k = r.get("kind")
        if k == "warmup":
            warm[r["config"]] = r  # l'ultimo vince
        elif k == "config":
            cfg_skip[r["config"]] = r
        elif k == "call":
            calls.append(r)
    # ultima riga per chiave (un errore ritentato sostituisce il precedente)
    ultimi = {}
    for r in calls:
        ultimi[(r["config"], r["caso"], r["turno"], r["rep"])] = r
    out = []
    for r in ultimi.values():
        turno = CASO[r["caso"]]["turni"][r["turno"] - 1]
        if r["status"] == "ok":
            val = bot.valida(r["content"], idx)
            ris = valuta(val, turno)
            r["_val"], r["_ris"], r["_firma"] = val, ris, firma(val, ris)
        else:
            r["_val"] = r["_ris"] = r["_firma"] = None
        r["_turno"] = turno
        out.append(r)
    out.sort(key=lambda r: (ORDINE.index(r["config"]) if r["config"] in ORDINE else 99, r["rep"], r["caso"], r["turno"]))
    return out, warm, cfg_skip


def coerenza(calls):
    """Per ogni (config, caso, turno) con >=2 ripetizioni riuscite: quota di rep uguali alla risposta più frequente."""
    g = defaultdict(list)
    for r in calls:
        if r["_firma"] is not None:
            g[(r["config"], r["caso"], r["turno"])].append(r["_firma"])
    per_cfg = defaultdict(list)
    for (cfg, _, _), fs in g.items():
        if len(fs) >= 2:
            per_cfg[cfg].append(Counter(fs).most_common(1)[0][1] / len(fs))
    return {c: round(sum(v) / len(v), 3) for c, v in per_cfg.items()}


def riepilogo_config(calls, warm, cfg_skip):
    coer = coerenza(calls)
    righe = []
    for cid in ORDINE:
        cs = [r for r in calls if r["config"] == cid]
        if not cs:
            if cid in cfg_skip:
                righe.append({"cfg": cid, "nota": f"NON SUPPORTATA: {cfg_skip[cid].get('errore', '')}"})
            continue
        ok = [r for r in cs if r["status"] == "ok"]
        ris = [r["_ris"] for r in ok]
        saltati = sum(1 for r in cs if r["status"] == "saltato")
        valutabili = [r for r in cs if r["status"] != "saltato"]
        think5 = [r["_ris"]["punteggio"] for r in ok if CASO[r["caso"]]["think5"]]
        toks = [r["tok_s"] for r in ok if r["tok_s"]]
        w = warm.get(cid, {})
        righe.append({
            "cfg": cid, "chiamate": len(cs), "ok": len(ok),
            "timeout": sum(1 for r in cs if r["status"] == "timeout"),
            "errori": sum(1 for r in cs if r["status"] in ("errore", "non_supportato")), "saltati": saltati,
            "json_ok": media([1.0 if x["json_ok"] else 0.0 for x in ris]),
            "schema_ok": media([1.0 if x["schema_ok"] else 0.0 for x in ris]),
            "q_ok": media([x["punteggio"] for x in ris]),
            "q_tot": media([r["_ris"]["punteggio"] if r["status"] == "ok" else 0.0 for r in valutabili]),
            "q_articoli": media([x["s_articoli"] for x in ris]),
            "q_comport": media([x["s_comportamento"] for x in ris]),
            "q_think5": media(think5),
            "nomi_inventati": sum(len(x["nomi_inventati"]) for x in ris),
            "nomi_corretti": sum(len(x["nomi_corretti"]) for x in ris),
            "prezzi_inventati": sum(1 for x in ris if x["prezzo_inventato"]),
            "loop": sum(1 for r in ok if r.get("loop")),
            "cat_errata": sum(len(x["categoria_errata"]) for x in ris),
            "t_medio": media([r["wall_s"] for r in ok]),
            "t_mediana": round(st.median([r["wall_s"] for r in ok]), 2) if ok else None,
            "t_max": max([r["wall_s"] for r in cs]) if cs else None,
            "tok_s": media(toks),
            "tok_gen": media([r["eval_tokens"] for r in ok]),
            "tok_think": media([r["think_tokens_stima"] for r in ok]) if CFG[cid]["think"] else 0,
            "prompt_tok": media([r["prompt_tokens"] for r in ok]),
            "carico_s": w.get("load_s"), "warmup_s": w.get("wall_s"), "warmup_prompt_s": w.get("prompt_s"),
            "coerenza": coer.get(cid),
            "nota": f"think supportato={w.get('think_supportato')}, think usato={w.get('think_usato')}",
        })
    return righe


def riepilogo_categorie(calls):
    cats = []
    for c in CASI:
        if c["categoria"] not in cats:
            cats.append(c["categoria"])
    q, t, q5 = defaultdict(list), defaultdict(list), defaultdict(list)
    for r in calls:
        if r["status"] == "saltato":
            continue
        s = r["_ris"]["punteggio"] if r["status"] == "ok" else 0.0
        q[(r["categoria"], r["config"])].append(s)
        if r["status"] == "ok":
            t[(r["categoria"], r["config"])].append(r["wall_s"])
    return cats, q, t


STYLE_H = PatternFill("solid", fgColor="1F3A5F")


def intestazione(ws, cols, widths=None):
    ws.append(cols)
    for i, c in enumerate(ws[1], 1):
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = STYLE_H
        c.alignment = Alignment(wrap_text=True, vertical="center")
    ws.freeze_panes = "A2"
    for i, w in enumerate(widths or [], 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def scrivi(path_in, path_out):
    calls, warm, cfg_skip = carica(path_in)
    wb = Workbook()

    # ---- Dettaglio
    ws = wb.active
    ws.title = "Dettaglio"
    cols = ["Configurazione", "Modello", "Caso", "Categoria", "Turno", "Rep", "Messaggio del cliente", "Esito chiamata",
            "JSON valido", "Schema ok", "Nomi nel menù", "Stato (modello)", "Stato atteso", "Punteggio", "P. articoli",
            "P. modifiche", "P. comportamento", "Articoli ottenuti", "Articoli attesi", "Nomi inventati", "Nomi corretti (quasi-giusti)", "Prezzo inventato",
            "Categoria errata", "Secondi", "Caricamento (s)", "Token prompt", "Token generati", "Token thinking (stima)",
            "Token/s", "Risposta completa (JSON)", "Thinking", "Errore"]
    intestazione(ws, cols, [24, 22, 9, 22, 6, 5, 50, 11, 8, 8, 9, 12, 14, 9, 9, 9, 11, 50, 50, 22, 24, 9, 14, 9, 9, 9, 9, 10, 8, 70, 50, 30])
    for r in calls:
        ris, val = r["_ris"], r["_val"]
        att, stati = testo_atteso(r["_turno"])
        ott = ""
        if val:
            ott = ", ".join(f"{a['quantita']}x {a['nome']}" + ("" if a["in_menu"] else " [NON IN MENÙ]")
                            + ("".join(f" (senza {s})" for s in a["senza"])) + ("".join(f" (extra {s})" for s in a["extra"]))
                            + ("".join(f" [{s}]" for s in a["note"])) for a in val["articoli"])
        yn = lambda b: "sì" if b else "no"  # noqa: E731
        ws.append([
            LABEL.get(r["config"], r["config"]), r["model"], r["caso"], r["categoria"], r["turno"], r["rep"], r["messaggio"],
            r["status"], yn(ris["json_ok"]) if ris else "", yn(ris["schema_ok"]) if ris else "",
            yn(ris["nomi_ok"]) if ris else "", ris["stato"] if ris else "", stati,
            ris["punteggio"] if ris else (0 if r["status"] != "saltato" else None),
            ris["s_articoli"] if ris else None, ris["s_mods"] if ris else None, ris["s_comportamento"] if ris else None,
            ott, att, ", ".join(ris["nomi_inventati"]) if ris else "", ", ".join(ris["nomi_corretti"]) if ris else "", yn(ris["prezzo_inventato"]) if ris else "",
            ", ".join(ris["categoria_errata"]) if ris else "",
            r.get("wall_s"), r.get("load_s"), r.get("prompt_tokens"), r.get("eval_tokens"),
            r.get("think_tokens_stima") if CFG.get(r["config"], {}).get("think") else 0, r.get("tok_s"),
            (r.get("content") or "")[:32000], (r.get("thinking") or "")[:32000], r.get("errore", ""),
        ])
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")

    # ---- Riepilogo per configurazione
    ws2 = wb.create_sheet("Riepilogo configurazione")
    cols2 = [("Configurazione", "cfg"), ("Chiamate", "chiamate"), ("Riuscite", "ok"), ("Timeout", "timeout"),
             ("Errori", "errori"), ("Saltate", "saltati"), ("JSON valido (quota)", "json_ok"), ("Schema ok (quota)", "schema_ok"),
             ("Qualità media (riuscite)", "q_ok"), ("Qualità media (timeout/errori = 0)", "q_tot"),
             ("Qualità articoli", "q_articoli"), ("Qualità comportamento", "q_comport"),
             ("Qualità sui 5 casi 'think'", "q_think5"), ("Nomi inventati (n)", "nomi_inventati"),
             ("Nomi quasi-giusti corretti (n)", "nomi_corretti"), ("Prezzi inventati (n)", "prezzi_inventati"), ("Risposte degenerate/loop (n)", "loop"), ("Categoria errata (n)", "cat_errata"),
             ("Tempo medio (s)", "t_medio"), ("Tempo mediano (s)", "t_mediana"), ("Tempo max (s)", "t_max"),
             ("Token/s (generazione)", "tok_s"), ("Token generati (medi)", "tok_gen"), ("di cui thinking (stima)", "tok_think"),
             ("Token prompt elaborati (medi)", "prompt_tok"), ("Caricamento a freddo (s)", "carico_s"),
             ("Warm-up totale (s)", "warmup_s"), ("Warm-up: prefill prompt (s)", "warmup_prompt_s"),
             ("Coerenza tra ripetizioni", "coerenza"), ("Note", "nota")]
    intestazione(ws2, [c[0] for c in cols2], [26] + [12] * (len(cols2) - 2) + [60])
    righe = riepilogo_config(calls, warm, cfg_skip)
    for r in righe:
        r = dict(r)
        r["cfg"] = LABEL.get(r["cfg"], r["cfg"])
        ws2.append([r.get(k) for _, k in cols2])
    for row in ws2.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")

    # ---- Riepilogo per categoria
    ws3 = wb.create_sheet("Riepilogo categoria")
    cats, q, t = riepilogo_categorie(calls)
    cfgs = [c for c in ORDINE if any(r["config"] == c for r in calls)]
    intestazione(ws3, ["Categoria · qualità media (0-1)"] + [LABEL[c] for c in cfgs], [34] + [22] * len(cfgs))
    for cat in cats:
        ws3.append([cat] + [media(q.get((cat, c), [])) for c in cfgs])
    ws3.append([])
    ws3.append(["Categoria · tempo medio (s)"] + [LABEL[c] for c in cfgs])
    for c in ws3[ws3.max_row]:
        c.font = Font(bold=True, color="FFFFFF"); c.fill = STYLE_H
    for cat in cats:
        ws3.append([cat] + [media(t.get((cat, c), [])) for c in cfgs])
    wb.save(path_out)
    return righe, cats, q, t, cfgs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default=os.path.join(HERE, "results.jsonl"))
    ap.add_argument("--out", default=os.path.join(HERE, "risultati.xlsx"))
    args = ap.parse_args()
    righe, cats, q, t, cfgs = scrivi(args.results, args.out)
    print(f"scritto {args.out}")
    for r in righe:
        print(json.dumps(r, ensure_ascii=False))
    print("\nqualità per categoria:")
    for cat in cats:
        print(f"  {cat:<28}", "  ".join(f"{LABEL[c][:14]}={media(q.get((cat, c), []))}" for c in cfgs))


if __name__ == "__main__":
    main()
