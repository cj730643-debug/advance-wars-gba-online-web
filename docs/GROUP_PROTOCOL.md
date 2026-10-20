# AW group protocol 1 (experimental)

All browser **2–4-player options use the group path**. The legacy pair implementation remains for native regression only. All members choose the same fixed count. No ROM patch or change to game rules is made.

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

Relay validates sender/count/kind/sequence/size and forwards to every other authenticated room member. Limits remain 100 rooms, 200 sockets, 65548 bytes/message, 600 messages/s and 8 MiB/s per socket, 4 MiB queued outbound per recipient, 300-second heartbeat timeout. It does not decode snapshots, inputs or state hashes. WSS uses platform TLS.

## Core adapter and startup

Each owner captures a quiescent logical machine including its savedata/normalized RTC. The existing replica manifest, chunk and SHA validation are retained with group-only owner bounds 0–3. Chunk payload is total uint32, offset uint32, then at most 16384 bytes; client bounds a snapshot to 2 MiB and requires exact ordered assembly. Each client recreates the same ordered N logical GBAs, restores each owner's snapshot, attaches them to the existing four-way serial coordinator and validates assigned IDs. Handshake timeout is 300 seconds, tolerating background dispatch suspension.

Inputs carry version=1, owner, record count, reserved zero, snapshot generation uint64, then contiguous (frame uint64, digital keys uint16) records. The original input ring algorithm rejects wrong owner/generation, illegal keys, conflicting duplicates, noncontiguous batches and out-of-window records. Identical in-window duplicates are accepted. The manifest binds an 8, 16 or 32 frame input delay (default 32). Neutral seed inputs are split into batches of at most 16 records, preserving the existing packet bound. Each owner authors exactly once per frame; each frame waits for every owner before running. Window or game frame cannot advance using missing inputs. Input wait timeout is 300 seconds; there is no promise of seamless recovery.

Each client cooperatively runs all N cores using the original serial scheduler behavior. Its screen/audio correspond to its own role. No browser networking callback runs inside a logical CPU step. Between frames the Worker yields to receive messages.

## Consensus and saves

Before frame 0 and every 60 frames, all clients exchange (frame uint64, combined SHA-256), then acknowledgements of unanimous matching hashes. An acknowledgement uses bit 63 of the frame uint64, with the lower 63 bits retaining the checkpoint frame and the same digest. Only after every acknowledgement matches is that checkpoint confirmed. The profile binds this two-phase policy; it must not mix with older single-phase clients. The domain-separated combined hash covers ordered logical-machine serialized state, RTC, savedata type/bytes and complete SIO driver state, plus group size and frame. Frame 0 requires unanimous agreement before play. Later checkpoint hashes are checked asynchronously: a client may advance at most 60 frames beyond a pending checkpoint, and must confirm it before starting the following checkpoint. Mismatch, missing peer, malformed packet or timeout ends the session. This is bounded speculative presentation, not rollback; at most 120 frames may exist beyond the last confirmed checkpoint. Digests are an inconsistency detector; TLS and authenticated relay roles provide transport authentication.

Each checkpoint first stages the local logical player's battery at that exact frame. Only unanimous agreement promotes that staged battery to the verified export buffer, even if the live simulation has since advanced. Remote logical saves stay in temporary memory. The last verified local battery is exported to the ROM-hash/role IndexedDB slot approximately every five seconds and on termination. Unverified staged data is never promoted after an error. Multiplayer instant states, rollback and reconnect/resume are not implemented; refreshing any player still ends the entire room. Solo instant states use a separate local-only serialized-state namespace.
