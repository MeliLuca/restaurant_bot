#!/usr/bin/env python3
"""Suite red team dell'Assistente AI (prototipo): prova a manipolarlo come farebbe un
utente, attraverso le API /api/ai/* del server in esecuzione, e misura i DANNI nel
database (fotografia prima/dopo di ogni caso).

  python run.py                 # tutti i casi
  python run.py --only 1,3      # solo alcune categorie
  python run.py --case 1.4a     # un caso
  python run.py --reps 2        # ripetizioni (il modello non è deterministico)
  python run.py --list          # elenca i casi senza eseguirli

Risultati: redteam_results.jsonl (una riga per caso) e redteam_report.md.
Esito per caso: PASS · FAIL (attacco riuscito / comportamento sbagliato) · KNOWN
(vulnerabilità nota, dichiarata) · INFO · DANNO (il database è cambiato).
Codice di uscita ≠ 0 se c'è almeno un FAIL o un DANNO.

Lanciala quando nessuno usa l'app: un ordine vero durante la suite sembrerebbe un danno.
"""
import argparse
import concurrent.futures
import datetime as dt
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db_guard  # noqa: E402
from cases import CASES, CATEGORIES  # noqa: E402
from common import BASE, http  # noqa: E402
from fixtures import Fixtures  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_JSONL = os.path.join(HERE, "redteam_results.jsonl")
OUT_MD = os.path.join(HERE, "redteam_report.md")


def fill(value, ph):
    if isinstance(value, str):
        for k, v in ph.items():
            value = value.replace("{" + k + "}", v)
        return value
    if isinstance(value, dict):
        return {k: fill(v, ph) for k, v in value.items()}
    return value


def run_step(step, fx, ph, state):
    """Un passo → (status, risposta, secondi, testo inviato)"""
    if "parallel" in step:
        body = {"text": step["parse"]}
        with concurrent.futures.ThreadPoolExecutor(step["parallel"]) as pool:
            futures = [pool.submit(http, "POST", "/api/ai/order/parse", body) for _ in range(step["parallel"])]
            return [f.result() + (step["parse"],) for f in futures]
    if "parse" in step:
        return [http("POST", "/api/ai/order/parse", {"text": step["parse"]}) + (step["parse"],)]
    if "price" in step:
        return [http("POST", "/api/ai/order/price", {"text": step["price"]}) + (step["price"],)]
    if "tables" in step:
        return [http("POST", "/api/ai/tables/suggest", {"text": step["tables"]}) + (step["tables"],)]
    if "chat" in step:
        body = {"userId": fx.users["A"], "message": step["chat"]}
        if state.get("conversationId"):
            body["conversationId"] = state["conversationId"]
        res = http("POST", "/api/ai/chat", body)
        conv = res[1].get("conversation") if isinstance(res[1], dict) else None
        if conv:
            state["conversationId"] = conv["id"]
        return [res + (step["chat"],)]
    method, path, body = step["http"]
    return [http(method, fill(path, ph), fill(body, ph)) + ("",)]


def run_case(case, fx):
    ph = {"A": fx.users["A"], "B": fx.users["B"]}
    if case.get("setup"):
        ph.update(case["setup"](fx))
    before = db_guard.snapshot()
    responses, texts, state = [], [], {}
    t0 = time.time()
    for step in case["steps"]:
        for status, payload, secs, text in run_step(step, fx, ph, state):
            responses.append((status, payload, secs))
            if text:
                texts.append(text)
    ctx = {"responses": responses, "last": responses[-1][1], "fx": fx, "texts": texts, "placeholders": ph}
    results = []
    for check in case["checks"]:
        try:
            ok, detail = check(ctx)
        except Exception as e:  # una risposta di forma inattesa è un fallimento, non un crash
            ok, detail = False, f"risposta inattesa: {type(e).__name__}: {e}"
        results.append({"check": check.__name__, "ok": bool(ok), "detail": detail})
    if case.get("cleanup"):
        case["cleanup"](fx, ctx)
    damage = db_guard.diff(before, db_guard.snapshot())

    passed = all(r["ok"] for r in results)
    if damage:
        outcome = "DANNO"
    elif passed:
        outcome = "PASS" if case["expect"] != "info" else "INFO"
    else:
        outcome = {"pass": "FAIL", "known": "KNOWN", "info": "INFO"}[case["expect"]]
    return {
        "id": case["id"], "cat": case["cat"], "title": case["title"], "expect": case["expect"],
        "outcome": outcome, "seconds": round(time.time() - t0, 1), "checks": results,
        "damage": [{"table": t, "before": b, "after": a} for t, b, a in damage],
        "sent": texts, "status": [s for s, _, _ in responses],
        "last_response": responses[-1][1],
    }


def short(payload, n=600):
    s = json.dumps(payload, ensure_ascii=False) if not isinstance(payload, str) else payload
    return s if len(s) <= n else s[:n] + "…"


def write_report(rows, health, started, reps):
    order = ["DANNO", "FAIL", "KNOWN", "INFO", "PASS"]
    totals = {o: sum(r["outcome"] == o for r in rows) for o in order}
    md = [
        f"# Red team Assistente AI — {started:%Y-%m-%d %H:%M}",
        "",
        f"Modello **{health.get('config', {}).get('model', '?')}** su {health.get('config', {}).get('host', '?')} "
        f"· profilo {health.get('profile', {}).get('label', '?')} · server {BASE} · {reps} ripetizion{'e' if reps == 1 else 'i'}.",
        "",
        " · ".join(f"**{o}** {totals[o]}" for o in order),
        "",
        "| Categoria | PASS | FAIL | KNOWN | INFO | DANNO |",
        "|---|---|---|---|---|---|",
    ]
    for cat, name in CATEGORIES.items():
        rs = [r for r in rows if r["cat"] == cat]
        if rs:
            md.append(f"| {cat}. {name} | " + " | ".join(str(sum(r["outcome"] == o for r in rs))
                                                       for o in ["PASS", "FAIL", "KNOWN", "INFO", "DANNO"]) + " |")
    md += ["", "## Casi da guardare", ""]
    flagged = [r for r in rows if r["outcome"] != "PASS"]
    if not flagged:
        md.append("Nessuno: tutti i casi sono passati.")
    for r in flagged:
        md += [f"### {r['outcome']} · {r['id']} — {r['title']}", ""]
        for t in r["sent"]:
            md.append(f"- Inviato: `{t[:200]}`")
        for ch in r["checks"]:
            md.append(f"- {'✅' if ch['ok'] else '❌'} `{ch['check']}`: {ch['detail']}")
        for d in r["damage"]:
            md.append(f"- 💥 tabella **{d['table']}** cambiata ({d['before']} → {d['after']} righe)")
        md += [f"- Status: {r['status']} · {r['seconds']} s", "", "```json", short(r["last_response"]), "```", ""]
    md += ["## Tutti i casi", "", "| Esito | Caso | Titolo | Tempo |", "|---|---|---|---|"]
    md += [f"| {r['outcome']} | {r['id']} | {r['title']} | {r['seconds']} s |" for r in rows]
    with open(OUT_MD, "w") as f:
        f.write("\n".join(md) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="categorie, es. 1,3")
    ap.add_argument("--case", default="", help="id di casi, es. 1.4a,8.1")
    ap.add_argument("--reps", type=int, default=1)
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    cats = {int(x) for x in args.only.split(",") if x}
    ids = {x for x in args.case.split(",") if x}
    selected = [k for k in CASES if (not cats or k["cat"] in cats) and (not ids or k["id"] in ids)]

    if args.list:
        for k in selected:
            print(f"{k['id']:6} [{k['expect']:5}] cat {k['cat']:2} {k['title']}")
        print(f"\n{len(selected)} casi")
        return 0

    status, health, _ = http("GET", "/api/ai/health")
    if status != 200 or not isinstance(health, dict) or not health.get("module", {}).get("enabled"):
        print(f"L'Assistente non è pronto ({status}): {short(health, 300)}")
        return 2
    if not health.get("ollama", {}).get("reachable"):
        print("Attenzione: Ollama non raggiungibile — i casi provano solo le regole senza modello.")

    fx = Fixtures()
    fx.setup()
    started = dt.datetime.now()
    rows = []
    suite_before = db_guard.snapshot()
    try:
        with open(OUT_JSONL, "w") as out:
            for rep in range(args.reps):
                for case in selected:
                    row = run_case(case, fx)
                    row["rep"] = rep
                    rows.append(row)
                    out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    out.flush()
                    print(f"{row['outcome']:5} {row['id']:6} {row['seconds']:6.1f}s  {row['title']}", flush=True)
    finally:
        fx.teardown()
    suite_damage = db_guard.diff(suite_before, db_guard.snapshot())
    if suite_damage:
        print(f"DANNO sulla suite intera: {suite_damage}")
        rows.append({"id": "suite", "cat": 0, "title": "Fotografia del DB prima/dopo la suite",
                     "expect": "pass", "outcome": "DANNO", "seconds": 0, "checks": [], "sent": [],
                     "status": [], "last_response": None,
                     "damage": [{"table": t, "before": b, "after": a} for t, b, a in suite_damage]})
    write_report(rows, health, started, args.reps)
    print(f"\nReport: {OUT_MD}")
    return 1 if any(r["outcome"] in ("FAIL", "DANNO") for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
