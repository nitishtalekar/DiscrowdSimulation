# Conversation Prompting & Traversal Spec

How the simulation constructs prompts, calls the LLM, and routes turns between characters using LangChain and LangGraph.

---

## Overview

Each simulation runs as a **LangGraph state machine** where nodes are characters. The graph holds a shared conversation history (`MessagesAnnotation`). On every turn, one character reads the full history, generates a reply, and appends it — then the next character node fires.

---

## Prompt Construction (per turn)

Every character turn calls `createSimulatedUser` in [src/utils/simulation_utils.ts](src/utils/simulation_utils.ts), which builds a fresh `ChatPromptTemplate` with two slots:

```
[system]  prompts.system  (filled with character-specific variables)
[human]   {messages}      (the full conversation history so far)
```

### System prompt template (`prompts.system`)

```
You are {name}, a {profession}. You are in a conversation with other characters.
You are debating the following topic statement: {topic}.
You have a specific opinion on the topic, and you will respond to the other characters
based on your personality and opinion. ALWAYS respond like you are talking to either
one of the characters in the conversation or all characters in the conversation.
DO NOT GREET EVERYTIME.

{personality}

This is your current opinion strength on a scale for the topic:
{opinion_strength}  (-1 to 1 scale, -1 = strongly disagree, 0 = neutral, 1 = strongly agree)

{additional_info}

Respond with a response as part of a conversation.
```

### Variable binding

| Variable | Source |
|---|---|
| `{name}` | `character.name` |
| `{profession}` | `character.profession` |
| `{topic}` | the debate topic string |
| `{personality}` | `personalities[character.personality]` — full MBTI instruction string |
| `{opinion_strength}` | `character.opinion_strength` (−1 to 1 float) |
| `{additional_info}` | `character.additional_info` |

The system prompt is **re-sent on every LLM call** — the API is stateless, so context must be re-included each turn.

---

## Conversation History Management

LangGraph's `MessagesAnnotation` accumulates messages as an array of `BaseMessage` objects (alternating `HumanMessage` / `AIMessage`). Before each LLM call, `swapRoles` flips the polarity of every message:

- `AIMessage → HumanMessage`
- `HumanMessage → AIMessage`

This is necessary because each character is modeled as the "assistant" role from its own perspective. Swapping ensures the current speaker sees all prior messages as coming from "the human" (i.e. others), and its own prior turns as AI turns — satisfying the OpenAI/Anthropic role alternation requirement.

If the conversation history is empty (first turn), a default `HumanMessage("Hello. Shall we have a discussion?")` is injected to seed the exchange.

---

## Graph Traversal

### Node setup (`createSimulation` in [src/lib/simulation.ts](src/lib/simulation.ts))

1. Characters are **shuffled** at simulation start to randomize speaking order.
2. Each character becomes a named LangGraph node. The node function closes over `(llm, character, topic)`.
3. **Sequential edges** are added: `A → B → C → ... → N` (one-directional pass).
4. **Conditional looping edges** are added from every node: after each character speaks, `shouldContinue` decides whether to route to the next character or end.

```
START → A → B → C → D ─┐
        ↑               │ (if shouldContinue)
        └───────────────┘
                        │ (if message limit hit)
                        END
```

### Turn termination (`shouldContinue`)

```ts
if (messages.length > messageLimit) → END   // messageLimit = 24
else                                 → continue (next character)
```

The limit is a flat count of messages across all characters — not turns per character.

---

## Per-Turn Execution Flow

```
simulatedUserNode called for character X
│
├─ Read state.messages (full shared history)
│
├─ If empty → inject seed HumanMessage
│
├─ swapRoles(messages)         // flip Human ↔ AI
│
├─ createSimulatedUser(llm, character, topic)
│   └─ ChatPromptTemplate([system, human])
│       └─ .partial({ topic, name, profession, personality, opinion_strength, additional_info })
│       └─ .pipe(llm)
│
├─ simulatedUser.invoke({ messages: swappedHistory })
│   └─ sends: [system prompt] + [swapped history]  →  LLM
│
├─ append response to state.messages as { role: "user", content: ... }
│
└─ rateOpinionOnTopic(llm, topic, response)   // separate evaluation call
    └─ prompts.evaluation filled inline, raw llm.invoke(string)
    └─ returns float −1 to 1
```

---

## Opinion Evaluation (separate LLM call)

After each character responds, a second LLM call rates the opinion expressed, using a different prompt (`prompts.evaluation`). This call is **not part of the conversation history** — it is a side-channel evaluation and its result is attached to the streamed message object as `values.opinion`.

---

## Streaming Output

`runSimulationStream` iterates `simulation.stream({}, { recursionLimit: 100 })`. For each chunk (one character turn), it emits a Server-Sent Event:

```json
{
  "role": "CharacterName",
  "content": "...",
  "values": { "opinion": 0.7 },
  "turn": 2
}
```

`turn` is a per-character counter tracked outside the graph state.
