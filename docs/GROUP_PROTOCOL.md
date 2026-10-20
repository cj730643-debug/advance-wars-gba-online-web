# AW group protocol 1 (experimental)

The browser's **2-player option keeps the original v1/pair path**. The 3- and 4-player options use a separate protocol. All members choose the same fixed count. No ROM patch or change to game rules is made.

## Admission and Relay

`POST /v2/rooms` and `/v2/rooms/{code}/join` accept a manifest:

```
game: aw1 | aw2 | diagnostic
protocol: aw-relay-group-1
coreProtocol: mgba-gba-link-group-1
players: 2 | 3 | 4
rom, core, config: lowercase SHA-256 of exact bytes / fixed profile
```

Admission returns an unpredictable eight-character code, immutable role (0 through count−1), count, and one-use 60-second random token. A room expires after ten minutes waiting or eight hours total. Tokens are sent only in the first TLS WebSocket message to `/v1/relay`, never as a URL. A code grants temporary admission to an empty slot; it is not a reusable authentication token. The room becomes ready only when every authenticated socket is present. No member replacement or reconnect is allowed. A departure ends the entire room.

Group binary envelope (network byte order):

| Offset | Size | Meaning |
| --- | --- | --- |
| 0 | 4 | ASCII AWG1 |
| 4 | 1 | authenticated sender role |
| 5 | 1 | fixed room size |
| 6 | 1 | kind: snapshot=1, input=2, consensus=3 |
| 7 | 1 | reserved zero |
| 8 | 8 | strictly increasing sequence, starts at 1 |
| 16 | variable | opaque payload |

Relay validates sender/count/kind/sequence/size and forwards to every other authenticated room member. Limits remain 100 rooms, 200 sockets, 65548 bytes/message, 600 messages/s and 8 MiB/s per socket, 4 MiB queued outbound per recipient, 15-second heartbeat timeout. It does not decode snapshots, inputs or state hashes. WSS uses platform TLS.

## Core adapter and startup

Each owner captures a quiescent logical machine including its savedata/normalized RTC. The existing replica manifest, chunk and SHA validation are retained with group-only owner bounds 0–3. Chunk payload is total uint32, offset uint32, then at most 16384 bytes; client bounds a snapshot to 2 MiB and requires exact ordered assembly. Each client recreates the same ordered N logical GBAs, restores each owner's snapshot, attaches them to the existing four-way serial coordinator and validates assigned IDs. Handshake timeout is 30 seconds.

Inputs carry version=1, owner, record count, reserved zero, snapshot generation uint64, then contiguous (frame uint64, digital keys uint16) records. The original input ring algorithm rejects wrong owner/generation, illegal keys, conflicting duplicates, noncontiguous batches and out-of-window records. Identical in-window duplicates are accepted. Eight frames of neutral input are seeded. Each owner authors exactly once per frame; each frame waits for every owner before running. Window or game frame cannot advance using missing inputs. Input wait timeout is ten seconds; there is no promise of seamless recovery.

Each client cooperatively runs all N cores using the original serial scheduler behavior. Its screen/audio correspond to its own role. No browser networking callback runs inside a logical CPU step. Between frames the Worker yields to receive messages.

## Consensus and saves

Before frame 0 and every 60 frames, all clients exchange (frame uint64, combined SHA-256). The domain-separated combined hash covers ordered logical-machine serialized state, RTC, savedata type/bytes and complete SIO driver state, plus group size and frame. No client advances past that barrier until every member's hash matches; mismatch, missing peer, malformed packet or timeout ends the session. Digests are an inconsistency detector; TLS and authenticated relay roles provide transport authentication.

Only after unanimous agreement does each client copy its own logical player's battery into its verified export buffer. Remote logical saves stay in temporary memory. On termination, the last verified local battery is exported to the ROM-hash/role IndexedDB slot. Up to 59 unverified frames can be discarded; this is deliberate. Instant states, rollback and reconnect/resume are not implemented.
