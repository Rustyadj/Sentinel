# Embedding architecture

Sentinel's embeddings are provider- and dimension-independent by construction.
Which provider is used is a configuration and benchmark question, never a
schema one.

## Why this changed

`memories.embedding` has been `vector(1536)` since the initial migration and
nothing ever wrote to it. The first embedding seam treated that column width as
a hard contract and refused any model that did not emit exactly 1536
dimensions. That made a column type the thing that chose the provider:
`voyage-3-lite` (512) and `voyage-3` (1024) were rejected on a detail unrelated
to retrieval quality, and there was nowhere to put a second provider's vectors,
so "Voyage or OpenAI?" could not be answered with evidence.

## Shape

`memory_embeddings`, one row per `(memoryId, provider, model, version)`:

| Column | Purpose |
|---|---|
| `provider`, `model` | which space this vector lives in |
| `dimensions` | denormalised, selects the vector column |
| `version` | bumped when the same model is re-run with different preparation |
| `vector512` / `vector1024` / `vector1536` / `vector3072` | exactly one is set |
| `embedMs` | per-provider embedding latency, measured not estimated |
| `createdAt` | when this vector was produced |

A database `CHECK` enforces that exactly one vector column is non-null *and*
that it is the one matching `dimensions`. This is in the database rather than
application code because a vector in the wrong column yields a
plausible-looking distance instead of an error.

`memories.embedding` is untouched and still unused. It is kept, not dropped, so
reverting needs no migration.

### Consequences

- **Several embeddings per memory, on purpose.** Benchmarking two providers
  means embedding the same corpus twice and querying each independently.
- **Re-embedding is additive.** New rows are written; the old ones remain until
  the benchmark says the new ones are better. Cut-over and rollback are both
  data operations, not migrations.
- **Spaces never mix.** `findSimilar` requires provider, model and version.
  Cosine distance between two models' vectors is a number that means nothing.
- **Scope cannot be bypassed.** `findSimilar` ranks only the candidate ids it is
  given, which the caller has already filtered through `buildRetrievalFilters`.
  It has no notion of who may see what and must never acquire one.

### Adding a provider or width

Adding a provider is configuration (`SENTINEL_EMBEDDING_PROVIDER`,
`SENTINEL_EMBEDDING_MODEL`, the matching API key) plus an entry in
`MODEL_DIMENSIONS`. Adding a *new dimension family* (768, say) is a deliberate
migration adding a `vector(768)` column — `vectorColumnFor` throws
`UnsupportedDimensionError` rather than truncating. Vectors are never padded or
truncated to fit: that corrupts cosine geometry.

No ANN index exists yet. `ivfflat` needs representative data to build useful
lists, and pgvector will not index beyond 2000 dimensions at all, so the index
belongs in a follow-up once a provider has been chosen by benchmark and a
corpus exists. Exact scan is correct, only slower.

## Voyage status: supported, blocked by network

Voyage is **still a candidate primary provider** and remains fully supported in
code. It is currently unreachable from this VPS.

Probed 2026-09-20 from the VPS, identical invalid bearer token to each:

| Endpoint | Result |
|---|---|
| `POST https://api.voyageai.com/v1/embeddings` | **HTTP 403**, HTML error page from an edge proxy |
| `POST https://api.openai.com/v1/embeddings` | HTTP 401, JSON `invalid_api_key` |
| `POST https://api.anthropic.com/v1/messages` | HTTP 401, JSON `authentication_error` |

A credential problem returns 401 with a JSON body, as the other two do. Voyage
returns an HTML 403 *before* authentication is evaluated, which is an edge/WAF
block on egress from this host — environmental, not a key problem. So the
provider is kept rather than deleted, and the 512/1024 widths it needs are now
storable.

Resolving it means egress from an unblocked address (proxy or different host),
not a code change.

## How the provider gets chosen

By `bench/memory` — retrieval quality, latency and cost on the same fixed
cases — never by vector width. Embed the corpus under each provider, run the
benchmark against each, compare. The table exists so that comparison is
possible at all.
