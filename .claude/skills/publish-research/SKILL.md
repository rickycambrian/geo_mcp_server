---
name: publish-research
description: Publish a research paper with claims to the Geo knowledge graph using the canonical Research ontology. Use when the user wants to publish an arXiv paper or research findings.
---

# Publish Research Paper

Publish a research paper and its extracted claims to the Geo knowledge graph using the canonical Research ontology types.

## Steps

1. **Configure wallet** if not already done:
   - Use `configure_wallet` with the user's private key, or rely on `GEO_PRIVATE_KEY` env var

2. **Set up space**:
   - Call `setup_space` to ensure the personal space exists

3. **Use the correct tool**:
   - **MUST** use `create_research_ontology_paper_and_claims`
   - **NEVER** use `create_knowledge_graph`, `build_schema`, or `create_knowledge_graph_from_file` -- those create local types that do NOT match the canonical schema and claims will be invisible in Knowledgebook/GeoBrowser

4. **Provide paper metadata**:
   - `title` (required)
   - `arxivId`, `publicationDate`, `authors`, `topics`, `venue`, `doi`, `keyContribution` (optional)

5. **Extract and provide claims**:
   - Each claim needs `text` (required)
   - Optional: `sourceQuote`, `topics`

6. **Publish the edit**:
   - Call `publish_edit` to send accumulated ops to the personal space

## Canonical Research Ontology Type IDs

These are the production type IDs used by GeoBrowser and Knowledgebook. The `create_research_ontology_paper_and_claims` tool handles these automatically.

| Type    | ID                                 | Source                   |
|---------|------------------------------------|--------------------------|
| Paper   | `1d2f7884e64e005ad897425c9879b0da` | Research ontology space  |
| Claim   | `96f859efa1ca4b229372c86ad58b694b` | Research ontology space  |
| Person  | `7ed45f2bc48b419e8e4664d5ff680b0d` | SystemIds.PERSON_TYPE    |
| Topic   | `5ef5a5860f274d8e8f6c59ae5b3e89e2` | Research ontology space  |
| Project | `484a18c5030a499cb0f2ef588ff16d50` | SystemIds.PROJECT_TYPE   |

## Paper Property IDs

| Property          | ID                                 | Data Type |
|-------------------|------------------------------------|-----------|
| arXiv URL         | `b1417e3a509237b8f32970b6bf6f227e` | Text      |
| Publication date  | `3176c284b8653e6cfad174fb1ecd6af0` | Date      |
| DOI               | `0c9ad4f6d0cd852634d7361eb685b881` | Text      |
| Code URL          | `766386c7b6b1b77d4adac0ba8b5ba60d` | Text      |
| Semantic Scholar  | `044660dd8984d7b46e11dfefa29eb8d4` | Text      |
| Key contribution  | `875890d85e38caa08e325415d915b628` | Text      |
| Authors           | `5c8a2a40986a29fe3430775cc2c0fa2e` | Relation  |
| Venue             | `adb8047237cbc48a9bfe420b4cf8398f` | Relation  |
| Related topics    | `806d52bc27e94c9193c057978b093351` | Relation  |
| Tags              | `257090341ba5406f94e4d4af90042fba` | Text      |
| Web URL           | `412ff593e9154012a43d4c27ec5c68b6` | Text      |

## Claim Property IDs

| Property          | ID                                 | Data Type |
|-------------------|------------------------------------|-----------|
| Sources           | `49c5d5e1679a4dbdbfd33f618f227c94` | Relation  |
| Related topics    | `806d52bc27e94c9193c057978b093351` | Relation  |
| Quotes            | `f9eeaf9d9eb741b1ac5d257c6e82e526` | Text      |
| Tags              | `257090341ba5406f94e4d4af90042fba` | Text      |

## Modeling Rules

- Paper title is stored as the Paper entity `name` (not a property)
- Claim text is stored as the Claim entity `name` (not a property)
- Supporting quotes go in Claim.Quotes property or entity description
- All claims MUST be typed with the canonical Claim type `96f859efa1ca4b229372c86ad58b694b`

## For DAO Publishing

To publish to the DAO space instead of personal space:
- Use `propose_dao_edit` instead of `publish_edit`
- Then `vote_on_proposal` to vote YES on the proposal
- DAO space ID: `6b05a4fc85e69e56c15e2c6891e1df32`
- DAO space address: `0xd3a0cce0d01214a1fc5cdedf8ca78bc1618f7c2f`

## Related

- The `research-paper-analyst` agent in `../mcp_deployments_registry` uses this tool via the Geo MCP server
- Agent page: https://mcpmarketplace.rickydata.org/agents/research-paper-analyst
- Knowledgebook reads published data: https://knowledgebook.rickydata.org/geo
