#!/usr/bin/env python3
"""Esegue il benchmark. Salva una riga JSON per chiamata in results.jsonl e riprende da dove era arrivato.

  python run_tests.py                 # test completo
  python run_tests.py --smoke         # 2 casi per configurazione, su results_smoke.jsonl
  python run_tests.py --configs gemma4-think --cases all_01,sem_01
"""
import argparse
import json
import os
import sys
import time

import bot
from cases import CASI
from scoring import valuta

HERE = os.path.dirname(os.path.abspath(__file__))

# Ordine: i veloci prima, quelli con thinking per ultimi.
# Versione "1 ora": 10 casi, 2 ripetizioni per i modelli senza thinking, 3 casi per quelli con thinking.
CONFIGS = [
    dict(id="qwen2.5-3b", etichetta="Qwen2.5-3B-Instruct", model="modelscope.cn/Qwen/Qwen2.5-3B-Instruct-GGUF:latest",
         think=None, reps=2, subset="core", deadline=bot.DEADLINE_S),
    dict(id="qwen3-4b-instruct", etichetta="qwen3:4b-instruct (no think)", model="qwen3:4b-instruct",
         think=False, reps=2, subset="core", deadline=bot.DEADLINE_S),
    dict(id="gemma4-nothink", etichetta="gemma4:e4b think OFF", model="gemma4:e4b",
         think=False, reps=2, subset="core", deadline=bot.DEADLINE_S),
    dict(id="gemma4-think", etichetta="gemma4:e4b think ON", model="gemma4:e4b",
         think=True, reps=1, subset="think5", deadline=300),
    dict(id="qwen3-4b-think", etichetta="qwen3:4b think ON", model="qwen3:4b",
         think=True, reps=1, subset="think5", deadline=300),
]
SMOKE_CASI = ["sem_01", "all_01"]


def carica_righe(path):
    righe = []
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        righe.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass  # riga troncata da un'interruzione brusca
    return righe


def salva(path, riga):
    with open(path, "a") as f:
        f.write(json.dumps(riga, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def casi_per(cfg, smoke, filtro):
    casi = [c for c in CASI if c["core"]]
    if smoke:
        casi = [c for c in casi if c["id"] in SMOKE_CASI]
    elif cfg["subset"] == "think5":
        casi = [c for c in casi if c["think5"]]
    if filtro:
        casi = [c for c in casi if c["id"] in filtro]
    return casi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--configs", help="id separati da virgola")
    ap.add_argument("--cases", help="id caso separati da virgola")
    ap.add_argument("--results", help="file risultati (default results.jsonl / results_smoke.jsonl)")
    args = ap.parse_args()

    path = args.results or os.path.join(HERE, "results_smoke.jsonl" if args.smoke else "results.jsonl")
    cfgs = [c for c in CONFIGS if not args.configs or c["id"] in args.configs.split(",")]
    filtro = args.cases.split(",") if args.cases else None
    reps_override = 1 if args.smoke else None

    menu = bot.carica_menu()
    idx = bot.indice_menu(menu)
    SYS = bot.system_prompt(menu)
    client = bot.nuovo_client()

    righe = carica_righe(path)
    done = {(r["config"], r["caso"], r["turno"], r["rep"]) for r in righe
            if r.get("kind") == "call" and r["status"] in ("ok", "timeout", "non_supportato", "saltato")}
    store = {(r["config"], r["caso"], r["turno"], r["rep"]): r for r in righe if r.get("kind") == "call"}
    config_skip = {r["config"] for r in righe if r.get("kind") == "config" and r["status"] == "non_supportato"}

    # piano: quante chiamate in tutto (per la riga di avanzamento)
    piano = []
    for cfg in cfgs:
        reps = reps_override or cfg["reps"]
        for rep in range(1, reps + 1):
            for c in casi_per(cfg, args.smoke, filtro):
                for ti in range(len(c["turni"])):
                    piano.append((cfg["id"], c["id"], ti + 1, rep))
    totale = len(piano)
    fatte = sum(1 for k in piano if k in done)
    n = fatte
    print(f"== {totale} chiamate pianificate, {fatte} già fatte -> {path}", flush=True)
    print(f"== prompt di sistema: {len(SYS)} caratteri, {len(menu['articoli'])} articoli, num_ctx={bot.NUM_CTX}", flush=True)

    modello_caricato = None
    for cfg in cfgs:
        if cfg["id"] in config_skip:
            print(f"-- {cfg['id']}: segnata NON SUPPORTATA in precedenza, salto", flush=True)
            continue
        reps = reps_override or cfg["reps"]
        casi = casi_per(cfg, args.smoke, filtro)
        da_fare = [(rep, c, ti) for rep in range(1, reps + 1) for c in casi for ti in range(len(c["turni"]))
                   if (cfg["id"], c["id"], ti + 1, rep) not in done]
        if not da_fare:
            print(f"-- {cfg['id']}: niente da fare", flush=True)
            continue

        print(f"\n=== {cfg['etichetta']} ({cfg['model']}) think={cfg['think']} ===", flush=True)
        if cfg["model"] != modello_caricato:
            bot.scarica_tutti(client)  # un solo modello in memoria
        modello_caricato = cfg["model"]
        supp = bot.supporta_think(client, cfg["model"])
        print(f"   ollama show -> thinking supportato: {supp}", flush=True)
        think = cfg["think"]
        if think is True and supp is False:
            print("   NON SUPPORTATA: il modello non dichiara 'thinking'. Configurazione saltata.", flush=True)
            salva(path, {"kind": "config", "config": cfg["id"], "model": cfg["model"], "status": "non_supportato",
                         "errore": "il modello non dichiara la capability 'thinking'", "think_supportato": supp})
            continue
        if think is False and supp is False:
            think = None  # modello senza think: il parametro si omette

        # warm-up: carica il modello e processa il prompt di sistema; tempi registrati a parte
        print("   warm-up (caricamento a freddo + prompt di sistema)...", flush=True)
        wm = [{"role": "system", "content": SYS}, {"role": "user", "content": "Una pizza wurstel"}]
        w = bot.chiedi(client, cfg["model"], wm, think=think, deadline=900, max_tokens=1)
        if w["status"] == "non_supportato" and think is not None:
            if think is True:
                print("   NON SUPPORTATA (errore da Ollama). Configurazione saltata.", flush=True)
                salva(path, {"kind": "config", "config": cfg["id"], "model": cfg["model"], "status": "non_supportato",
                             "errore": w["errore"], "think_supportato": supp})
                continue
            print("   think=False rifiutato: riprovo senza il parametro", flush=True)
            think = None
            w = bot.chiedi(client, cfg["model"], wm, think=think, deadline=900, max_tokens=1)
        w.update(kind="warmup", config=cfg["id"], model=cfg["model"], think_supportato=supp, think_usato=think,
                 ts=time.strftime("%Y-%m-%d %H:%M:%S"))
        w.pop("content", None)
        salva(path, w)
        print(f"   warm-up: {w['status']} | carico {w['load_s']}s | prompt {w['prompt_tokens']} tok in {w['prompt_s']}s "
              f"| totale {w['wall_s']}s", flush=True)
        if w["status"] != "ok":
            print("   warm-up fallito: configurazione saltata (si riprova al prossimo avvio)", flush=True)
            continue
        if (w["prompt_tokens"] or 0) > bot.NUM_CTX - 2500:
            print(f"   ATTENZIONE: prompt di {w['prompt_tokens']} token vicino a num_ctx={bot.NUM_CTX}", flush=True)

        for rep, c, ti in da_fare:
            n += 1
            turno = c["turni"][ti]
            key = (cfg["id"], c["id"], ti + 1, rep)
            # cronologia reale: le risposte precedenti dello STESSO modello nella stessa ripetizione
            msgs = [{"role": "system", "content": SYS}]
            saltato = None
            for j in range(ti):
                prev = store.get((cfg["id"], c["id"], j + 1, rep))
                if prev is None or prev["status"] != "ok":
                    saltato = prev["status"] if prev else "mancante"
                    break
                msgs += [{"role": "user", "content": c["turni"][j]["msg"]},
                         {"role": "assistant", "content": prev["content"]}]
            base = {"kind": "call", "config": cfg["id"], "model": cfg["model"], "caso": c["id"], "categoria": c["categoria"],
                    "turno": ti + 1, "rep": rep, "messaggio": turno["msg"], "ts": time.strftime("%Y-%m-%d %H:%M:%S")}
            if saltato:
                if saltato == "mancante" or saltato == "errore":
                    continue  # verrà rifatto al prossimo avvio, nell'ordine giusto
                salva(path, {**base, "status": "saltato", "errore": f"turno precedente: {saltato}", "content": "", "thinking": ""})
                done.add(key)
                print(f"[{n}/{totale}] {cfg['id']:<18} {c['id']:<7} t{ti+1} r{rep} | SALTATO ({saltato}) |", flush=True)
                continue
            msgs.append({"role": "user", "content": turno["msg"]})
            r = bot.chiedi(client, cfg["model"], msgs, think=think, deadline=cfg["deadline"])
            riga = {**base, **r, "think_usato": think}
            if r["status"] == "ok":
                val = bot.valida(r["content"], idx)
                ris = valuta(val, turno)
                riga["valutazione"] = ris
                esito = f"{'JSON ok' if val['json_ok'] else 'JSON KO'} punteggio {ris['punteggio']:.2f} stato={ris['stato']}"
            elif r["status"] == "timeout":
                esito = "TIMEOUT"
            else:
                esito = f"{r['status'].upper()}: {r['errore'][:80]}"
            salva(path, riga)
            store[key] = riga
            if r["status"] in ("ok", "timeout", "non_supportato"):
                done.add(key)
            ts = f"{r['tok_s']} tok/s" if r["tok_s"] else "- tok/s"
            print(f"[{n}/{totale}] {cfg['id']:<18} {c['id']:<7} t{ti+1} r{rep} | {esito} | {r['wall_s']:.0f}s | {ts}", flush=True)

    bot.scarica_tutti(client)
    print("\nFINE", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrotto: rilancia lo stesso comando per riprendere.", flush=True)
        sys.exit(130)
