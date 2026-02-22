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
   - **ALWAYS** use `create_research_ontology_paper_and_claims` (NOT `create_knowledge_graph` or `build_schema`)
   - This tool uses canonical GeoBrowser types (Paper, Claim, Person, Project, Topic) with IDs that match Knowledgebook/GeoBrowser UIs

4. **Provide paper metadata**:
   - `title` (required)
   - `arxivId`, `publicationDate`, `authors`, `topics`, `venue`, `doi`, `keyContribution` (optional)

5. **Extract and provide claims**:
   - Each claim needs `text` (required)
   - Optional: `sourceQuote`, `topics`

6. **Publish the edit**:
   - Call `publish_edit` to send accumulated ops to the personal space

## Important

- The canonical Claim type ID is `96f859efa1ca4b229372c86ad58b694b` -- only `create_research_ontology_paper_and_claims` uses this correctly
- Claims must be atomic and decontextualized (understandable without reading the paper)
- The knowledgebook app at `../knowledgebook` reads from these published entities

## For DAO publishing

To publish to the DAO space instead of personal space:
- Use `propose_dao_edit` instead of `publish_edit`
- Then `vote_on_proposal` to vote YES on the proposal
- DAO space ID: `6b05a4fc85e69e56c15e2c6891e1df32`
- DAO space address: `0xd3a0cce0d01214a1fc5cdedf8ca78bc1618f7c2f`
