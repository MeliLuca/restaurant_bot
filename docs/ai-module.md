# Assistente AI — prototipo

> **Solo prototipo.** Non va messo in produzione. Senza le variabili `AI_PROTOTYPE=1` / `NEXT_PUBLIC_AI_PROTOTYPE=1` il modulo non esiste: nessuna voce di menù, nessuna card, tutte le route `/api/ai/*` rispondono 404.

Un modello linguistico **locale** (Ollama) aiuta in quattro compiti:

1. **Ordinazioni intelligenti**: testo libero → righe del menù con variazioni già prezzate; piatto **fuori menù** → prezzo proposto e riga nel conto.
2. **Tavoli**: persone (+ orario) → tavolo migliore, considerando liberi, da pulire e tavoli che stanno per liberarsi (pre-conto, al dolce, seduti oltre la durata media).
3. **Cucina**: avvisi sugli articoli in preparazione da troppo (soglie per reparto).
4. **Analisi**: rotazione e resa di ogni tavolo e di ogni prodotto (margine dove c'è il costo).

**Regola di base: i numeri li calcola il codice, il modello legge il testo e spiega.** Prezzi (`lib/money.ts`, `lib/pos/variation-selection.ts`), tavoli (motore Gestione Sala Smart, `lib/smart-floor`), minuti di attesa e statistiche (`lib/analytics/aggregate.ts`) sono deterministici. Ogni cosa che il modello restituisce viene validata sui dati reali (nomi → id esistenti); le frasi che citano numeri non presenti nei dati vengono scartate. Se il modello non risponde, le API restituiscono comunque i dati calcolati con `ai: null`.

## Hardware di riferimento: Mac mini M4, 32 GB

| | |
|---|---|
| Modello di default | `gemma4:e4b` (≈ 6,6 GB) — vincitore del benchmark in `llm_tests/` (qualità 0,87, JSON sempre valido, thinking spento) |
| Opzione "qualità" | `gemma4:26b` (MoE, ~4B parametri attivi, ≈ 18 GB) — sta nei 32 GB ma stretto insieme a Docker |
| Budget memoria | modello + contesto 8k ≈ 8 GB · Supabase in Docker ≈ 3–4 GB · Next ≈ 1 GB |
| Contesto | 8192 token: i prompt sono corti (il menù non viene mai mandato intero) |
| Concorrenza | max 2 generazioni insieme (semaforo nel server Next), le altre in coda |

I tempi misurati **su questo MacBook Pro 2019 (Intel, solo CPU)** sono 30–120 s per risposta e ~45 s di primo caricamento: non sono rappresentativi. Sul Mac mini vanno rimisurati con `llm_tests/ai_module_eval.py`.

### Installazione sul Mac mini

```bash
brew install ollama            # oppure l'app da ollama.com
ollama pull gemma4:e4b
launchctl setenv OLLAMA_KEEP_ALIVE 30m
launchctl setenv OLLAMA_NUM_PARALLEL 2
launchctl setenv OLLAMA_FLASH_ATTENTION 1
```

In `.env.local` (vedi `.env.local.example`):

```
AI_PROTOTYPE=1
NEXT_PUBLIC_AI_PROTOTYPE=1
OLLAMA_HOST=http://127.0.0.1:11434
AI_MODEL=gemma4:e4b
AI_TIMEOUT_MS=30000            # su una macchina solo-CPU: 180000
```

Altre variabili facoltative: `AI_NUM_CTX`, `AI_MAX_CONCURRENCY`, `AI_KEEP_ALIVE`, `AI_QUEUE_TIMEOUT_MS`. Dopo una modifica serve riavviare il server Next (`NEXT_PUBLIC_*` è letta all'avvio).

Poi: **Impostazioni → Moduli → Assistente AI (prototipo)** → accendi, controlla "Stato del modello" e "Prova velocità".

## Accesso

- Pagina **/assistente** (voce "Assistente" nella barra laterale, solo desktop): permesso `use_ai` (Admin, Sala Manager).
- Bottone **"Scrivi l'ordine"** in Cassa: modulo acceso + `take_orders`; il prezzo si modifica solo con `override_price`.
- Card **ritardi cucina**: modulo acceso + `floor_alerts`.
- Come il resto dell'app, le route non hanno autenticazione lato server (login PIN lato client, RLS rinviata).

## Dati (migrazione `20261026000000_ai_assistant.sql`)

- `ai_settings` (riga unica): `enabled` (default spento), `kitchen_late_minutes` 20, `bar_late_minutes` 8, `custom_dish_min_overlap` 0,50.
- `menu_items.is_custom`: segnaposto "Fuori menù — <Categoria>", uno per categoria, creato al primo uso con la stampante più usata della categoria; nascosto dalla griglia della Cassa.
- `order_items.custom_name`: nome libero della riga; lo stampano comanda e conto ("FUORI MENÙ …") e lo mostrano cucina, conti e telefono.
- `menu_items.cost`, `ingredients.cost`: costo d'acquisto facoltativo (Impostazioni → Menu, campo "Costo").
- `ai_conversations` / `ai_messages` (migrazione `20261027000000_ai_chat_history.sql`): le chat salvate, una proprietaria ciascuna. `context` tiene la richiesta in corso (es. il tavolo: persone, orario, esigenze, sala) così un messaggio successivo la completa invece di ricominciare.

## Codice

| Dove | Cosa |
|---|---|
| `src/lib/ai/config.ts`, `ollama.ts`, `guard.ts` | profilo Mac mini, client Ollama (output JSON con schema, semaforo, timeout, `tryAi`), guardia delle route |
| `src/lib/ai/contracts/*.ts` | tipi request/response di ogni API (unica fonte di verità) |
| `src/lib/ai/order/` | estrazione dal testo, abbinamento al menù, prezzo fuori menù, segnaposto |
| `src/lib/ai/tables/` | lettura della richiesta, uso del motore Sala Smart |
| `src/lib/ai/kitchen/` | `lateItems`, riepilogo |
| `src/lib/ai/analytics/` + `src/lib/analytics/aggregate.ts` (`tableStats`, `productStats`) | statistiche e osservazioni |
| `src/lib/ai/chat/` | smistamento della chat verso il compito giusto |
| `src/components/ai/` | pagina /assistente, dialog della Cassa, card ritardi |
| `src/lib/i18n/ai/` | testi it/en, un file per compito |

## API

Tutte le risposte di errore: `{ "error": string, "code"?: "not_found" | "module_off" | "bad_request" | "ai_unavailable" | "failed" }` (404 prototipo assente, 503 modulo spento, 400 richiesta non valida, 500).

| Metodo | Route | Richiesta → risposta (tipi in `src/lib/ai/contracts/`) |
|---|---|---|
| GET | `/api/ai/health[?bench=1]` | stato modulo, configurazione, Ollama (raggiungibile, installato, caricato), coda, velocità (`health.ts`) |
| POST | `/api/ai/chat` | salvata: `{userId, conversationId?, message}` → `{intent, reply, data, ai, conversation, messages}`; senza salvataggio: `{messages:[{role,content}]}` (`chat.ts`) |
| GET | `/api/ai/conversations?userId=` | le chat salvate dell'utente, dalla più recente |
| GET · PATCH · DELETE | `/api/ai/conversations/:id` | apri (`?userId=`), rinomina (`{userId, title}`), elimina (`?userId=`) |
| POST | `/api/ai/order/parse` | `{text}` → `{status, lines[], customDishes[], unresolved[], clarification, reply, extractedBy, ai}` (`order.ts`) |
| POST | `/api/ai/order/price` | `{text}` oppure `{categoryId, ingredients[], name?}` → proposta fuori menù |
| POST | `/api/ai/order/custom-item` | `{categoryId}` → segnaposto "Fuori menù" della categoria |
| POST | `/api/ai/tables/suggest` | `{text}` oppure `{partySize, time?, tagIds?, mapId?}` → `{request, options[], reason, explanation, ai}` (`tables.ts`) |
| GET | `/api/ai/kitchen/alerts[?summary=1]` | `{thresholds, late[], byOrder[], summary, checkedAt, ai}` (`kitchen.ts`) |
| POST | `/api/ai/analytics/tables` | `{from, to, weekday?, insights?}` → statistiche per tavolo (`analytics.ts`) |
| POST | `/api/ai/analytics/products` | `{from, to, weekday?, categoryId?, insights?}` → statistiche per prodotto |

Le domande libere sulle analisi ("quali tavoli rendono di più il venerdì?") passano dalla chat, che le smista su `analytics/tables` o `analytics/products`.

### Esempi

```bash
curl -s localhost:3000/api/ai/health?bench=1
```

```bash
curl -s -X POST localhost:3000/api/ai/order/parse -H 'Content-Type: application/json' -d '{"text":"2 margherite senza basilico con bufala e una 1202 ben cotta"}'
```

```bash
curl -s -X POST localhost:3000/api/ai/order/price -H 'Content-Type: application/json' -d '{"text":"pizza con burrata, crudo e pistacchio"}'
```

```bash
curl -s -X POST localhost:3000/api/ai/tables/suggest -H 'Content-Type: application/json' -d '{"text":"6 persone alle 21, una carrozzina"}'
```

```bash
curl -s 'localhost:3000/api/ai/kitchen/alerts?summary=1'
```

```bash
curl -s -X POST localhost:3000/api/ai/analytics/tables -H 'Content-Type: application/json' -d '{"from":"2026-09-01","to":"2026-10-26"}'
```

```bash
curl -s -X POST localhost:3000/api/ai/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"siamo in 4, c è un tavolo adesso?"}]}'
```

## Comportamenti da sapere

- **Chat**: ogni utente ha le sue chat salvate (titolo e orario dell'ultimo messaggio, raggruppate per Oggi / Ieri / Ultimi 7 giorni / Più vecchie); si riaprono, si rinominano, si eliminano; rientrando si riapre l'ultima. Il titolo provvisorio sono le prime parole; il modello lo sostituisce dopo la prima risposta. Si salva solo il testo: i dati dietro una risposta vengono ricalcolati quando si richiede.
- **Una chat è sempre lo stesso modello**: le 5 schede non sono 5 agenti. La Chat sceglie da sola lo strumento giusto; le altre 4 schede usano direttamente un singolo strumento.
- **Domande che continuano**: la richiesta di tavolo in corso è tenuta dall'app, non riscritta dal modello. "6 persone, vogliamo vedere la partita" → "abbiamo anche dei bambini" cerca tavoli con TV **e** adatti ai bambini; "la TV non serve più" la toglie; "e alle 22?" o "e se fossero 8?" cambiano solo quel dato.
- **Ordini**: allergie/celiachia → stato `staff` (mai garantire un piatto); "ignora le istruzioni / gratis / sconto" → `refuse`; una risposta del modello che parla di soldi viene scartata. Senza modello, un lettore a regole gestisce gli ordini semplici (`extractedBy: "rules"`). Le righe aggiunte vanno nel ticket **in attesa**: il cameriere le invia come sempre.
- **Fuori menù**: base = piatto della stessa categoria con più ingredienti in comune; prezzo = base + regole variazioni della Cassa. Sopra la soglia (`custom_dish_min_overlap`) viene proposto come variazione del piatto, sotto come riga "Fuori menù".
- **Tavoli**: senza orario (o entro 15') = "Trova posto" della Sala, con i tavoli tenuti per la coda esclusi; con un orario = `suggestTables` come il modulo Prenotazioni. Un "HH:MM" già passato da più di 15' vale per domani. Dal prototipo non si fa accomodare né si prenota.
- **Cucina**: un articolo è in ritardo quando non è pronto da almeno la soglia del suo reparto (dal momento dell'invio). Card ambra in ritardo, rosse oltre il doppio; "Visto" le nasconde per 10' su quel dispositivo. Su /kitchen, con il modulo acceso, rosso alla soglia e ambra a metà (spento: 10/20 come prima). Anche il Coperto compare se il menù gli assegna una stampante di produzione.
- **Analisi**: incasso tavolo = Σ `orders.total`; incasso prodotto = Σ `unit_price × quantità`; una "seduta" = conti dello stesso tavolo sovrapposti nel tempo (i sottoconti contano una volta); rotazioni = sedute / giorni di servizio con almeno un conto. Il margine c'è solo per i prodotti con costo.

## Test di sicurezza (red team)

`llm_tests/redteam/` prova a manipolare l'Assistente (un caso per ogni tipo di attacco) e misura i danni nel database; l'agente `.claude/agents/ai-redteam.md` la esegue e propone correzioni. Vedi `llm_tests/redteam/README.md`.

## Limiti noti del prototipo

- Il modello piccolo sbaglia ancora su ordini con correzioni complesse ("togli la birra e metti un tiramisù" perde il tiramisù).
- Nessuna autenticazione server; "Visto" sulle card è per dispositivo.
- Le osservazioni delle analisi arrivano con una seconda chiamata (lente su CPU); una richiesta già partita non si annulla.
- Le valute seguono il formato del resto dell'app.
