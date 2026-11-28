# Versioned geography serving data

Processing and serving have separate version contracts. **All geographies use the
same formats**, independent of hosting, SQLite/PostgreSQL, or the app release tag.

- `aviquiz-seasonal-package-v1` is the existing portable processing/assembly output:
  sealed `package.json`, `manifest.json`, `places.json`, `species.json`, gzip fact
  chunks and optional photo coverage. Export, conversion, validation, collector
  queueing and photo assembly retain this format unchanged.
- `aviquiz-serving-release-v1` is the serving manifest generated from a complete
  set of validated processing packages. It replaces the old embedded registry
  (`schema: 1`), not the underlying processing package format.

A serving format change that alters interpretation gets a new schema identifier
and explicit reader support. Unknown schema versions fail closed. New geography
packages and photo revisions normally change content hashes, not schema versions.
Application semver, processing-package revision and serving-release revision are
independent; a deployment receipt records all three.

## Manifest and objects

The small committed `worker/seasonal-packages.json` is the active release manifest.
It includes schema/revision, aggregate coverage, taxonomically ordered families,
package geography/revision/year range and fact-chunk descriptors, plus references
to bird-index, navigation and species objects. It contains no photo records or
complete place tree. Its revision is SHA-256 over compact JSON with the `revision`
property removed, preserving generated property order. Generation is deterministic.

Objects use the bare SHA-256 of their exact stored bytes as their key. Each
reference has `sha256` and `bytes`. JSON metadata additionally has
`encoding: "gzip-json"` and the exact decompressed `rawBytes`. Object names never
contain account identities, secrets or input file paths. Metadata is gzip-compressed
JSON; content encoding is deliberately not set at the storage HTTP layer because
the reader verifies and decompresses the exact stored bytes itself.

| Object | Schema and contents |
| --- | --- |
| Bird index per package | `aviquiz-bird-index-v1`; `birds` array maps original numeric fact indexes to species-record hashes |
| Species shards | `aviquiz-species-shard-v1`; `records` maps each species-record hash to its complete public bird/photo record |
| Navigation shards | `aviquiz-navigation-shard-v1`; `records` maps place IDs to a node, immediate child nodes and ordered package/fact routes |
| Seasonal fact chunks | Existing concatenated gzip records; manifest routes identify chunk index, byte offset/length, decompressed size and record digest |

Species-record hashes are SHA-256 of compact JSON for the original bird record.
Identical records across countries share one record. Different metadata for the
same biological species remains separate, preserving each approved package's exact
names, photo order, dates, credits and seasonal behavior. A future deliberate media
update can unify variants through assembly; the storage migration does not do so.

Species records are grouped by their record hash's first two hexadecimal digits.
Navigation records are grouped by the first two hexadecimal digits of SHA-256 over
the UTF-8 place ID. There are at most 256 objects of each shard type per release.
Child nodes include precomputed coverage flags. Routes prefer the most specific
geography, matching the earlier reader's overlap rule. Country/continent ancestors
are navigable when they contain processed descendants; only places with facts can
launch their own quiz. Coverage totals deduplicate species and site IDs and count
first-level administrative regions rather than countries or counties.

## Reading and resource bounds

The same Worker reader uses an `EBD_BUCKET` interface (`get` including byte ranges,
`head`, and operator-only optional `put`). Bindings are R2 in staging, a read-only
Spaces adapter on DigitalOcean, and a read-only filesystem adapter locally.
PostgreSQL/SQLite retain accounts, statistics, permissions and location cache;
they do not need new tables for these serving objects.

The catalog summary requires no object reads. Geography navigation reads its shard
and ancestor shards. Quiz generation reads the selected place route, verifies a
bounded fact range, computes the requested season, then resolves only the required
species records. It does not preload all country catalogs at startup.

Metadata shards are limited to 4 MiB decompressed; whole object/range reads are
limited to 32 MiB. The generator rejects oversized metadata rather than silently
changing the partitioning rule. The reader bounds decompression, verifies sizes
and SHA-256, rejects unknown schemas, and verifies species record identities.
The per-bucket LRU cache has a 12 MiB accounting budget (three times source JSON
size to estimate parsed-object overhead, not an exact JavaScript heap guarantee).
Concurrent reads of the same shard share a promise; at most four metadata objects
are fetched/decompressed concurrently. A quiz retains its selected result records
while rendering its response. Country-wide response size still grows with its
species/media set; measure that as additional large countries are added.

## Storage and publication

Production uses `aviquiz-data` in NYC3; `aviquiz-archive` is for original EBD archive
retention, not runtime queries. No derived split partitions are uploaded by this
workflow. Metadata contains remote Cornell references, never downloaded photos.
Staging uses its existing R2 bucket; local development uses the same object files.

Compile and verify the full release, preload all objects, and verify a receipt
before activating the code-pinned manifest. Retain earlier objects and manifests
for rollback; never overwrite a hash with different content or delete old objects
as part of an ordinary deployment. The active manifest remains bundled and committed,
so this implementation does not introduce an independently mutable `latest` pointer.
Changing data selection still requires a reviewed code deployment. Publication of
facts and metadata is independent of the relational database migration lifecycle.

Spaces CLI preloading works before activation. The staging import route accepts
only hashes compiled into its running manifest. Therefore the initial staging
transition still needs a controlled compatible preload/bootstrap procedure; do not
claim zero-gap preloading through an old Worker that does not recognize new hashes.
The refactor is not automatically deployed to staging or production.

## Spaces configuration

`EBD_STORAGE=spaces` selects the adapter; `files` (the default) keeps existing local
behavior. Set `SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com`,
`SPACES_BUCKET=aviquiz-data`, `SPACES_ACCESS_KEY_ID`, and
`SPACES_SECRET_KEY_FILE` to a protected secret file. Never use the AWS default
credential chain for Spaces or expose these values through browser configuration.
The runtime adapter is read-only; the upload CLI explicitly enables private writes.

`SPACES_REQUIRE_PRIVATE=true` is the default. The HTTPS connection's DNS lookup
requires RFC1918 IPv4 answers and rejects public/mixed addresses. TLS hostname and
certificate verification remain enabled; there is no public-network fallback.
On the current NYC1 Droplet the VPC-local resolver is `10.116.15.254`; the NYC3 Spaces
hostname resolves privately. Configure the VPC-local resolver persistently using
[DigitalOcean's procedure](https://docs.digitalocean.com/products/networking/vpc/how-to/use-local-dns-resolver/).
Use the origin Spaces endpoint, not its public CDN endpoint. Cross-datacenter private
routing in the NYC group is supported by DO. SDK configuration follows
[DO's S3-compatible SDK guidance](https://docs.digitalocean.com/products/spaces/reference/aws-sdks/).

An operator uploading directly from a development computer can explicitly set
`SPACES_REQUIRE_PRIVATE=false`; this is not appropriate for Droplet jobs. Prefer
preloading from the Droplet so its transfers use the private network. Protect key
files with owner-only permissions (or a dedicated service-readable group). Upload
receipts contain only object hashes, bucket, counts and timestamps.

## NC and Colombia migration baseline

The conversion preserves the alpha.2 package revisions and 2,171 species, 34
first-level geographies and 8,872 sites. The prepared manifest is about 74 KiB,
replacing approximately 16 MiB of embedded catalogs/place metadata. The 525 unique
objects total 44,176,716 bytes, including the unchanged 41,619,824 fact bytes;
metadata adds about 2.44 MiB of compressed objects. Hash-based deduplication is
within this complete release and across retained releases, not a per-country quota.
No EBD rescan or collector restart is required for this migration.

For production packaging, `EBD_PACKAGE_STORAGE=spaces` plus
`EBD_UPLOAD_RECEIPT` omits the data mirror only after checking that a matching
verified receipt covers every common and legacy NC object. The default `files`
packaging mode retains the mirror. The runtime independently requires
`EBD_STORAGE=spaces`; a deployment must verify agreement between the release's
`servingStorage` and its protected environment before activation. This avoids
accumulating a complete Americas data copy in every application release directory.
