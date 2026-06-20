# CLAUDE.md

Index and working guide for this repository. Read this first to orient quickly.

## What this repo is

An open-source library of **754 cybersecurity skills** for AI agents. Each skill is a
self-contained, progressively-disclosed playbook (YAML frontmatter + Markdown workflow)
that teaches an agent how a senior security analyst performs a specific task — disk
imaging, memory forensics, threat hunting, cloud hardening, malware analysis, etc.

Skills are designed for cheap discovery (~30 tokens to scan frontmatter) and on-demand
loading (~500–2,000 tokens for the full workflow).

## Repository layout

```
.
├── skills/                     ← 754 skill directories (the core content)
│   └── <skill-name>/
│       ├── SKILL.md            ← definition: YAML frontmatter + Markdown body
│       ├── LICENSE
│       ├── references/         ← standards.md (ATT&CK/ATLAS/D3FEND/NIST), workflows.md
│       ├── scripts/            ← working helper scripts (all 754 skills have this)
│       └── assets/             ← templates/checklists (~280 skills have this)
├── index.json                  ← generated machine index of all skills (do not hand-edit)
├── mappings/                   ← framework coverage maps
│   ├── mitre-attack/           ← coverage-summary.md, README
│   ├── nist-csf/               ← csf-alignment.md, README
│   ├── owasp/                  ← README
│   └── attack-navigator-layer.json
├── tools/
│   ├── validate-skill.py       ← skill validator
│   └── README.md
├── .claude-plugin/             ← marketplace.json + plugin.json (Claude Code plugin)
├── .github/workflows/          ← validate-skills, update-index, sync-marketplace-version
├── ATTACK_COVERAGE.md          ← MITRE ATT&CK coverage (754/754 mapped)
└── README.md                   ← full project documentation
```

## Finding a skill

- **By keyword/capability:** search `index.json` (every skill's name + description) or
  grep `skills/*/SKILL.md` frontmatter.
- **Naming convention:** directories are kebab-case and verb-led, e.g.
  `analyzing-azure-activity-logs-for-threats`, `acquiring-disk-image-with-dd-and-dcfldd`.
- **By framework:** see `mappings/` and `ATTACK_COVERAGE.md`.

## SKILL.md format

Required frontmatter fields (enforced by CI — see `.github/workflows/validate-skills.yml`):
`name`, `description`, `domain`, `subdomain`, `tags`, `version`, `author`, `license`.

Common optional mapping fields: `mitre_attack`, `atlas_techniques`, `d3fend_techniques`,
`nist_ai_rmf`, `nist_csf`.

Rules: `name` is kebab-case, ≤64 chars, and must be unique across the repo.

Body sections (in order): `## When to Use`, `## Prerequisites`, `## Workflow`,
`## Verification`.

## Tooling and conventions

- **Validate a skill:** `python3 tools/validate-skill.py` (see `tools/README.md`).
  CI also checks required frontmatter fields, kebab-case names, and duplicate names.
- **Regenerate `index.json`:** it is auto-generated on push to `main` by
  `.github/workflows/update-index.yml` from `skills/*/SKILL.md`. Do not edit it by hand;
  it is currently in sync with the `skills/` directory (754 skills).
- **Adding a skill:** create `skills/<kebab-name>/SKILL.md` with the required frontmatter
  and the four body sections; add `references/`, `scripts/`, and (optionally) `assets/`;
  run the validator. The index and marketplace version are updated automatically by CI.

## Domains

26 security domains span the library (full counts in `README.md`): Cloud Security,
Threat Hunting, Threat Intelligence, Web Application Security, Network Security, Malware
Analysis, Digital Forensics, Security Operations, IAM, SOC Operations, Container Security,
OT/ICS Security, API Security, Vulnerability Management, Incident Response, Red Teaming,
Penetration Testing, Endpoint Security, DevSecOps, Phishing Defense, Cryptography, Zero
Trust Architecture, Mobile Security, Ransomware Defense, Compliance & Governance,
Deception Technology.
