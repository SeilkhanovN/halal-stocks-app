# backend

Node.js + TypeScript + Fastify API for halal-stocks.

Not yet scaffolded. Planned layout once it is:

```
backend/
├── src/
│   ├── routes/          # one file per route (see .claude/skills/api-conventions)
│   ├── lib/
│   │   └── halal-screen.ts   # AAOIFI ratio calculation, kept separate & testable
│   ├── types/
│   └── server.ts        # Fastify app entry point
├── package.json
├── tsconfig.json
└── Dockerfile            # added later, once Docker is in scope
```
