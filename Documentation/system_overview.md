# DisCrowd Simulation — System Overview

## What It Is

DisCrowd is an LLM-powered social simulation that runs inside a Discord server. A user triggers the simulation with a slash command, describes an emergency scenario, and a cast of AI-driven "residents" react to it — first individually, then in conversation with each other, grouped by location. The goal is to observe how different personalities in a simulated town respond to and discuss a crisis.

---

## High-Level Flow

```
User runs /simulate in Discord
        ↓
App receives location count + round count + emergency message
        ↓
Random locations are selected from the preset list
        ↓
All residents are assigned to locations (weighted by personality)
        ↓
Round 0: Every bot reads the emergency message and posts an initial response
        ↓
Rounds 1–N: Inside each location's thread, bots read the last 10 messages
            and respond to each other
        ↓
Simulation ends, summary is posted to Discord
```

---

## Components

### 1. Discord Interface (`app.js` + `commands.js`)

The app exposes two slash commands:

- `/test` — sanity check; returns "Hello World" with a random emoji.
- `/simulate <locations> <rounds>` — launches the simulation.

When `/simulate` is called, Discord presents a modal where the user types their emergency message. The app then orchestrates the entire simulation and posts results back into the server.

### 2. Residents (`residents.js`)

Residents are the simulated townspeople. Each resident has:

- **Name and emoji** — their identity in chat.
- **Role** — a short label (e.g. `elderly_disabled`, `parent`, `local_official`).
- **System prompt** — the LLM instruction that defines their personality, concerns, and voice. All prompts share two global constants:
  - `FROM` — establishes the shared setting: *"You are a resident of Manteo, North Carolina."*
  - `RESPONSE_DETAIL` — constrains response length to 2–4 sentences and under 2000 characters (Discord's message limit).
- **Location affinities** — a map of specific locations to a probability weight (e.g. Eleanor has a 0.7 affinity for the library). A `defaultLocationWeight` (typically 0.25) applies to any location not explicitly listed.

### 3. Locations (`locations.js`)

Locations are the physical places in the simulated town. Each location has:

- **Name and emoji**
- **Type** (e.g. `commercial`, `civic`, `medical`)
- **Capacity range** (`min`/`max` number of residents that can occupy it)
- **Description** — context passed to the LLM so bots know where they are

There are more preset locations than any single simulation uses. Each run randomly selects a subset (4–6) via `getRandomLocations`.

### 4. Bot Allocator (`bot_allocator.js`)

Before the simulation starts, every resident must be assigned to exactly one location. The allocator does this in three steps:

1. **Calculate weights** — for each resident, look up their affinity for each available location. If a location isn't in their affinity map, use the default weight.
2. **Normalize to probabilities** — convert raw weights into a probability distribution across available locations.
3. **Assign greedily** — pick a location for each resident by sampling from their probability distribution, skipping any location that has hit its max capacity.

After assignment, `validateAssignments` checks that no resident is assigned twice and no location exceeds capacity. Stats (total bots, average per location, min/max) are computed and printed as a summary in Discord.

### 5. Simulation Engine (`simulation_engine.js`)

The simulation object is the central state store for a run. It tracks:

- The list of locations and which bots are at each one
- A Discord thread ID per location (each location gets its own thread)
- The current round number per location
- Message counts and round completion stats

Key operations during a run:

| Function | What it does |
|---|---|
| `createSimulation` | Initializes the simulation from user inputs |
| `setLocationThreadId` | Links each location to its Discord thread |
| `getBotsAtLocation` | Returns the residents assigned to a location |
| `setLocationRound` | Tracks which conversation round a location is on |
| `completeRound` | Increments the global rounds-completed counter |
| `incrementMessageCount` | Tracks how many messages have been posted per location |
| `getSimulationStats` | Returns a full stats snapshot |
| `formatSimulationSummary` / `formatCompletionSummary` | Pretty-print summaries for Discord |

### 6. LLM Backend (Ollama)

Bots generate their responses using a locally-running Ollama instance. The default model is `gemma3:1b`. Each bot's system prompt is sent along with the conversation context (up to the last 10 messages in a thread) so the bot can respond in-character to what others have said.

---

## Conversation Structure

Each simulation run creates **one Discord thread per location**. The conversation inside a thread proceeds in rounds:

- **Round 0** — Each bot at the location posts a response to the original emergency message. This is their uninfluenced, in-character reaction.
- **Rounds 1–N** — Each bot reads the last 10 messages in the thread and posts a follow-up, simulating discussion between residents who happen to be in the same place.

The number of rounds is chosen by the user (1–10). More rounds = longer runtime.

---

## Configuration

| What to change | Where |
|---|---|
| Bot personalities | `residents.js` — edit system prompts or add new residents |
| Town setting | `residents.js` — change the `FROM` constant |
| Response length | `residents.js` — change the `RESPONSE_DETAIL` constant |
| Available locations | `locations.js` — add/remove location objects |
| Location count options | `commands.js` — add choices to the `/simulate` command |
| Round count options | `commands.js` — add `{ name: 'X rounds', value: X }` entries |
| LLM model | Ollama config — swap `gemma3:1b` for another model |

---

## Dependencies and Setup

- **Node.js** — runtime
- **Ollama** — local LLM inference (`gemma3:1b` by default)
- **Ngrok** — tunnels localhost:3000 so Discord can reach the app
- **Discord App** — requires `applications.commands` and `bot` (Send Messages) permissions
- **`.env`** — must contain `APP_ID`, `DISCORD_TOKEN`, and `PUBLIC_KEY`

Run order:
1. Start Ollama with the model loaded
2. `npm start` to start the app on port 3000
3. `ngrok http 3000` and paste the HTTPS URL into Discord's Interactions Endpoint URL as `<url>/interactions`

---

## Data Flow Diagram

```
Discord User
    │
    │  /simulate 4 locations, 3 rounds
    ▼
app.js  ──── modal prompt ────► user types emergency message
    │
    ├── locations.js        select 4 random locations
    ├── residents.js        load all residents
    ├── bot_allocator.js    assign each resident to a location (weighted)
    ├── simulation_engine.js  create simulation state object
    │
    │  For each location:
    │    create Discord thread
    │    Round 0: each bot → Ollama → post response to emergency
    │    Rounds 1–3: each bot reads thread history → Ollama → post reply
    │
    └── post completion summary to Discord channel
```
