/** Mermaid Catalog 专用样例：复杂拓扑、时序与状态机。 */

export const MERMAID_CONTROL_PLANE = `flowchart TB
  classDef web fill:#e8f4fc,stroke:#2563eb,color:#0f172a,stroke-width:1.5px
  classDef server fill:#fef3c7,stroke:#d97706,color:#451a03,stroke-width:1.5px
  classDef instance fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:1.5px
  classDef data fill:#f3e8ff,stroke:#9333ea,color:#581c87,stroke-width:1.5px

  subgraph Web["Web · SolidJS SPA"]
    direction TB
    P["pages"]
    W["widgets"]
    F["features"]
    E["entities · Yjs"]
    P --> W --> F
    W --> E
  end

  subgraph Server["peri-studio-server"]
    direction TB
    H["web · WS hub"]
    C["channel · runtime"]
    R["control · registry"]
    D[("persist · SQLite")]
    H --> C
    C --> R
    C --> D
  end

  subgraph Instance["peri-instance"]
    direction TB
    PR["protocol · ACP"]
    CH["child supervisor"]
    PR --> CH
  end

  E <-->|"read-only Yjs"| H
  C <-->|"orchestration"| PR
  C -.->|"commandId dedupe"| D
  CH -->|"stdio"| ACP["ACP durable thread"]

  class P,W,F,E web
  class H,C,R server
  class PR,CH instance
  class D data`;

export const MERMAID_SESSION_SEQUENCE = `sequenceDiagram
  autonumber
  participant U as User
  participant W as Web panel
  participant S as Server
  participant I as Instance
  participant A as ACP child

  U->>W: Open project session
  W->>S: session/load + commandId
  alt Runtime missing
    S->>I: create runtime
    I->>A: spawn process
  else Runtime warm
    S->>I: attach session
  end
  A-->>I: replay durable thread
  I-->>S: projection frames
  S-->>W: Yjs diff
  W-->>U: Render chat history
  Note over W,S: Same commandId must not duplicate side-effects`;

export const MERMAID_RUNTIME_STATE = `stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: session/load
  Loading --> Active: runtime ready
  Loading --> Unknown: DELIVERY_UNKNOWN
  Active --> Streaming: prompt in flight
  Streaming --> Active: turn complete
  Active --> Draining: cancel / close
  Draining --> Idle: child exited
  Unknown --> Idle: operator reset
  Failed --> Idle: discard runtime
  Loading --> Failed: hard error`;

export const MERMAID_LAB_MARKDOWN = `Complex Mermaid blocks stress subgraphs, styling, sequence timing, and state transitions. Each diagram renders through the same \`MermaidBlock\` path used in chat.

### Control plane topology

\`\`\`mermaid
${MERMAID_CONTROL_PLANE}
\`\`\`

### Session load sequence

\`\`\`mermaid
${MERMAID_SESSION_SEQUENCE}
\`\`\`

### Runtime lifecycle

\`\`\`mermaid
${MERMAID_RUNTIME_STATE}
\`\`\`
`;
