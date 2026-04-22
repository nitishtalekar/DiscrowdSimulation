# DisCrowd Simulation — System Overview

DisCrowd is an LLM-powered social simulation that runs inside a Discord server. A user triggers it with a slash command, describes an emergency scenario, and a cast of AI-driven "residents" react to it — first individually, then in location-grouped conversation with each other across multiple rounds. The goal is to observe how different personalities and life circumstances affect how people respond to and discuss a crisis.

---

## High-Level Flow

```
User runs /simulate <locations> <rounds> in Discord
        ↓
User types emergency message in modal
        ↓
Random subset of locations selected from preset list
        ↓
All residents assigned to locations (weighted by role)
        ↓
One Discord thread created per location
        ↓
Phase 1 — Round 0: Every bot gives an immediate reaction to the alert
        ↓
Phase 2 — Rounds 1–N: Bots converse with each other in their location thread
        ↓
Phase 3 — Final Round: Each bot synthesizes what they learned and states their evacuation decision
        ↓
JSON transcripts written to ./Transcripts/{simulationId}/{locationName}.json
Simulation summary posted to Discord channel
```

---

## Components

### `residents.js` — Resident Definitions

Holds the `TOWN_RESIDENTS` array. Each resident has **five base properties only** — no hand-written prompts or affinity weights:

```javascript
{
  name: 'Eleanor',           // first name only (no emoji prefix)
  emoji: '👵',
  role: 'elderly_disabled',  // drives affinity lookup
  backstory: 'Retired librarian, wheelchair-bound...',  // personality context
  personality: 'ISFJ'        // MBTI code string
}
```

The 30 residents span roles including: elderly, disabled, homeless, parent, student, non-English speaker, established resident, young resident, storm skeptic, conspiracy theorist, and protective homeowner.

---

### `prompt_builder.js` — Dynamic System Prompt Generation

Exports `buildSystemPrompt(resident, townContext?)`. Assembles the LLM system prompt at runtime from the resident's base properties + the MBTI description from `personalities.js`.

**Output structure:**
```
You are {name}. You are a resident of Manteo, North Carolina. {backstory} {MBTI personality description} {response constraints}
```

The `townContext` parameter defaults to Manteo but can be overridden for future multi-town scenarios.

---

### `affinity_calculator.js` — Location Affinity by Role

Exports `calculateAffinities(resident)`. Uses a static rule table mapping each `role` to a partial `locationAffinities` object with three named locations at HIGH (0.7), MID (0.5), and LOW (0.4) weights. All other locations receive a DEFAULT weight of 0.25.

**Example rule:**
```
elderly_disabled → { 'Beachside Library': 0.7, 'Coastal Community Church': 0.5, 'Main Street General Store': 0.4 }
```

Returns `{ locationAffinities, defaultLocationWeight }` — the same shape `bot_allocator.js` uses internally.

---

### `bot_allocator.js` — Resident-to-Location Assignment

Assigns every resident to exactly one location before the simulation starts. The algorithm:

1. For each resident, call `calculateAffinities(bot)` to get weights for available locations
2. Normalize weights to probabilities (sum = 1.0)
3. Sample a location using weighted random selection
4. Skip locations that have hit max capacity

After all assignments, `validateAssignments` confirms no resident is assigned twice and no location exceeds capacity.

---

### `locations.js` — Location Presets

Holds `LOCATION_PRESETS` — a list of physical places in the simulated coastal NC town. Each location has:

- `name`, `emoji`, `type` (`commercial` / `civic` / `community`)
- `capacity: { min, max }` — resident occupancy range
- `description` — context string available to the LLM

Each simulation run randomly selects a subset (4–6) via `getRandomLocations(count)`. There are more preset locations than any single run uses.

---

### `simulation_engine.js` — Simulation State

`createSimulation(locationCount, roundCount, emergencyMessage)` builds the central simulation object, which tracks:

- Selected locations and their assigned bots
- Per-location Discord thread IDs
- Per-location message counts and current round number
- Global stats (total bots, rounds completed, messages posted)

Other exports (`setLocationThreadId`, `setLocationRound`, `completeRound`, etc.) are used by `app.js` to update state as the simulation progresses.

---

### `app.js` — Discord Interface and Simulation Orchestration

The main entry point. Runs an Express server on port 3000 and receives Discord interaction webhooks.

**Slash commands:**
- `/test` — returns "Hello World + emoji", confirms connectivity
- `/simulate <locations> <rounds>` — opens a modal for the emergency message, then runs the full simulation

**LangChain client:**
```javascript
const ollamaClient = new ChatOllama({ baseUrl: 'http://localhost:11434', model: 'gemma3:1b' });
```

**Conversation store:**
An in-memory `Map<simulationId, Map<locationName, Array<{role, name, content}>>>` accumulates every message (including the initial emergency alert) as a structured JSON list throughout the simulation. This replaces re-fetching Discord messages each round.

---

## Conversation History & LangChain Integration

Each location has one **shared conversation history** — all bots at a location read from and write to the same list. This mirrors a real room conversation where everyone hears everything.

**History entry shape:**
```json
{ "role": "user" | "assistant", "name": "EMERGENCY ALERT" | "<bot name>", "content": "..." }
```

Before each LLM call, `buildLangChainMessages` constructs a proper LangChain message array:

```
[ SystemMessage(bot's system prompt),
  HumanMessage("EMERGENCY ALERT: ..."),   ← from history (windowed)
  AIMessage("Eleanor: ..."),              ← from history (windowed)
  AIMessage("James: ..."),                ← from history (windowed)
  ...up to CONTEXT_WINDOW_SIZE entries...
  HumanMessage(current round prompt) ]    ← always appended last
```

`user` entries become `HumanMessage`, `assistant` entries become `AIMessage`. The window slides forward as history grows — older messages naturally fall out. The full history is always preserved in memory for the transcript.

---

## Round Structure

| Phase | Prompt intent | Context passed |
|---|---|---|
| **Phase 1 — Round 0** | "Respond with your immediate reaction to the alert" | Emergency message only (no prior messages) |
| **Phase 2 — Rounds 1–N** | "Respond naturally to what others have said" | Sliding window of last N messages from shared history |
| **Phase 3 — Final Round** | "Describe your understanding of the situation. Will you evacuate?" | Sliding window of last N messages from shared history |

The Final Round uses a distinct prompt that forces synthesis and a concrete decision (stay or evacuate) in under 500 characters.

---

## Transcript Output

At the end of Phase 3, each location's full conversation history is written to disk as a JSON file:

**Path:** `./Transcripts/{simulationId}/{locationName}.json`

**Format:**
```json
{
  "simulationId": "sim_1713456789_abc123",
  "location": "The Dockside Diner",
  "emergencyMessage": "Hurricane Category 4 approaching...",
  "messages": [
    { "role": "user",      "name": "EMERGENCY ALERT", "content": "Hurricane Category 4..." },
    { "role": "assistant", "name": "James",            "content": "We need to leave now..." },
    { "role": "assistant", "name": "Frank",            "content": "I've seen worse. I'm staying." },
    ...
  ]
}
```

---

## Configuration Reference

| Setting | Where | Effect |
|---|---|---|
| `CONTEXT_WINDOW_SIZE` | `.env` | Number of history messages included in each LLM call (default: 10) |
| `APP_ID`, `DISCORD_TOKEN`, `PUBLIC_KEY` | `.env` | Discord app credentials |
| Town setting | `prompt_builder.js` → `TOWN_CONTEXT` | The shared location backstory for all residents |
| Response length | `prompt_builder.js` → `RESPONSE_CONSTRAINTS` | Constraints injected into every system prompt |
| LLM model | `app.js` → `MODEL` | Ollama model name (default: `gemma3:1b`) |
| Add a resident | `residents.js` → `TOWN_RESIDENTS` | Add an object with `name`, `emoji`, `role`, `backstory`, `personality` |
| Add a location | `locations.js` → `LOCATION_PRESETS` + `commands.js` | Add the location object and increase the max choice in `/simulate` |
| Add a role affinity rule | `affinity_calculator.js` → `ROLE_AFFINITIES` | Add a new `role: { locationName: weight }` entry |
| Add an MBTI type | `personalities.js` → `personalities` | Add a new key with its behavioral description string |

---

## Dependencies and Setup

| Dependency | Purpose |
|---|---|
| Node.js ≥ 18 | Runtime |
| Ollama | Local LLM inference (`gemma3:1b` by default) |
| `@langchain/community` | `ChatOllama` client |
| `@langchain/core` | `SystemMessage`, `HumanMessage`, `AIMessage` classes |
| `discord-interactions` | Discord webhook verification and response types |
| `express` | HTTP server |
| `dotenv` | `.env` loading |
| Ngrok | Tunnels `localhost:3000` for Discord's webhook delivery |

**Run order:**
1. Ensure Ollama is running with the model loaded: `ollama run gemma3:1b`
2. Register slash commands (first time only): `npm run register`
3. Start the app: `npm start`
4. Start ngrok: `ngrok http 3000`
5. Paste the ngrok HTTPS URL + `/interactions` into Discord App → General Information → Interactions Endpoint URL

---

## Data Flow Diagram

```
Discord User
    │
    │  /simulate 4 locations, 3 rounds
    ▼
app.js ──── modal ────► user types emergency message
    │
    ├── locations.js          getRandomLocations(4)
    ├── residents.js          TOWN_RESIDENTS (base properties)
    ├── affinity_calculator   calculateAffinities(bot) per resident
    ├── bot_allocator.js      assignBotsToLocations(residents, locations)
    ├── simulation_engine.js  createSimulation(...)  → simulation state object
    │
    │  Initialize: locationConversations Map per location
    │
    │  Phase 1 — For each location:
    │    POST alert to Discord thread
    │    push { role:'user', name:'EMERGENCY ALERT', content } to convHistory
    │    For each bot:
    │      prompt_builder.buildSystemPrompt(bot)
    │      buildLangChainMessages(systemPrompt, convHistory, windowSize, prompt)
    │      ChatOllama.invoke(messages) → responseText
    │      POST responseText to Discord thread
    │      push { role:'assistant', name, content } to convHistory
    │
    │  Phase 2 — For each round 1..N, for each location, for each bot:
    │    (same as Phase 1 but with ROUND_PROMPT — no Discord fetch needed)
    │
    │  Phase 3 — Final Round, for each location, for each bot:
    │    (same as Phase 2 but with FINAL_PROMPT)
    │    write ./Transcripts/{simId}/{locationName}.json
    │
    └── POST completion summary to Discord channel
        locationConversations.delete(simulationId)  ← cleanup
```
