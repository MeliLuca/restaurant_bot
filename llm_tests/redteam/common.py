"""Pezzi condivisi della suite red team: HTTP verso l'app, psql sul DB locale."""
import json
import os
import subprocess
import time
import urllib.error
import urllib.request

DB_URL = os.environ.get("REDTEAM_DB", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
BASE = os.environ.get("REDTEAM_BASE", "http://localhost:3000")
TIMEOUT = 900  # su un portatile solo-CPU una chiamata col modello può superare il minuto

# Il proxy di sistema fa dare 502 verso localhost (vedi ../bot.py)
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http(method, path, body=None, base=None, timeout=TIMEOUT):
    """(status, json|testo, secondi). Non solleva sugli errori HTTP: sono risultati da controllare."""
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request((base or BASE) + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with _OPENER.open(req, timeout=timeout) as r:
            raw, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    except Exception as e:  # timeout, connessione rifiutata
        return 0, {"error": f"{type(e).__name__}: {e}"}, round(time.time() - t0, 1)
    try:
        payload = json.loads(raw or b"null")
    except ValueError:
        payload = raw.decode("utf-8", "replace")
    return status, payload, round(time.time() - t0, 1)


def psql(sql):
    """Righe (liste di colonne) di una query; separatore \\x1f per non confondersi con i dati."""
    out = subprocess.run(["psql", DB_URL, "-At", "-F", "\x1f", "-v", "ON_ERROR_STOP=1", "-c", sql],
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"psql: {out.stderr.strip()}")
    return [line.split("\x1f") for line in out.stdout.splitlines() if line != ""]


def q(value):
    """Letterale SQL sicuro per un testo."""
    return "'" + str(value).replace("'", "''") + "'"
