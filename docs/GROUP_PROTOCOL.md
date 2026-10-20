# AW group protocol 2 (experimental, resumable transport)

All browser **2–4-player options use the group path**. The legacy pair implementation remains for native regression only. All members choose the same fixed count. No ROM patch or change to game rules is made.

## Admission and Relay

`POST /v2/rooms` and `/v2/rooms/{code}/join` accept a manifest:

```
game: aw1 | aw2 | diagnostic
protocol: aw-relay-group-2
coreProtocol: mgba-gba-link-group-1
players: 2 | 3 | 4
rom, core, config: lowercase SHA-256 of exact bytes / fixed profile
```

Admission returns an unpredictable eight-character code, immutable role (0 through count−1), count, and one-use 60-second random token. A room expires after ten minutes waiting or eight hours total. Tokens are sent only in the first TLS WebSocket message to `/v1/relay`, never as a URL. A code grants temporary admission to an empty slot; it is not a reusable authentication token. The room becomes ready only when every authenticated socket is present. A separate unpredictable role-bound resume token is returned by admission and kept only in Worker memory. It is sent in the TLS authentication message, never in URLs, logs or browser storage. Unexpected departures retain the role and room for at most 120 seconds; new members cannot replace an occupied role. A holder can replace its half-open socket. Explicit leave ends the room. Legacy group-1 rooms retain their original departure behavior.

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

Relay validates sender/count/kind/sequence/size and forwards to every other authenticated room member. For group-2 it also retains each accepted envelope until all recipients acknowledge receipt via heartbeat/authentication cursors. Per sender replay is capped at 4 MiB; total retained replay is capped at 64 MiB. Overflow ends the room rather than silently dropping required data. Limits remain 100 rooms, 200 sockets, 65548 bytes/message, 600 messages/s and 8 MiB/s per socket, 4 MiB queued outbound per recipient, 300-second heartbeat timeout. It does not decode snapshots, inputs or state hashes. WSS uses platform TLS.

## Core adapter and startup

Each owner captures a quiescent logical machine including its savedata/normalized RTC. The existing replica manifest, chunk and SHA validation are retained with group-only owner bounds 0–3. Chunk payload is total uint32, offset uint32, then at most 16384 bytes; client bounds a snapshot to 2 MiB and requires exact ordered assembly. Each client recreates the same ordered N logical GBAs, restores each owner's snapshot, attaches them to the existing four-way serial coordinator and validates assigned IDs. Handshake timeout is 300 seconds, tolerating background dispatch suspension.

Inputs carry version=1, owner, record count, reserved zero, snapshot generation uint64, then contiguous (frame uint64, digital keys uint16) records. The original input ring algorithm rejects wrong owner/generation, illegal keys, conflicting duplicates, noncontiguous batches and out-of-window records. Identical in-window duplicates are accepted. The manifest binds an 8, 16 or 32 frame input delay (default 32). Neutral seed inputs are split into batches of at most 16 records, preserving the existing packet bound. Each owner authors exactly once per frame; each frame waits for every owner before running. Window or game frame cannot advance using missing inputs. Input wait timeout is 300 seconds; there is no promise of seamless recovery.

Each client cooperatively runs all N cores using the original serial scheduler behavior. Its screen/audio correspond to its own role. No browser networking callback runs inside a logical CPU step. Between frames the Worker yields to receive messages.

## Consensus and saves

Before frame 0 and every 60 frames, all clients exchange (frame uint64, combined SHA-256), then acknowledgements of unanimous matching hashes. An acknowledgement uses bit 63 of the frame uint64, with the lower 63 bits retaining the checkpoint frame and the same digest. Only after every acknowledgement matches is that checkpoint confirmed. The profile binds this two-phase policy; it must not mix with older single-phase clients. The domain-separated combined hash covers ordered logical-machine serialized state, RTC, savedata type/bytes and complete SIO driver state, plus group size and frame. Frame 0 requires unanimous agreement before play. Later checkpoint hashes are checked asynchronously: a client may advance at most 60 frames beyond a pending checkpoint, and must confirm it before starting the following checkpoint. Mismatch, malformed packet or expired wait ends the session. A transient transport loss pauses frame advancement while retaining all logical cores, inputs and consensus state. Recovery does not reset the simulation. This is bounded speculative presentation, not rollback; at most 120 frames may exist beyond the last confirmed checkpoint. Digests are an inconsistency detector; TLS and authenticated relay roles provide transport authentication.

Each checkpoint first stages the local logical player's battery at that exact frame. Only unanimous agreement promotes that staged battery to the verified export buffer, even if the live simulation has since advanced. Remote logical saves stay in temporary memory. The last verified local battery is exported to the ROM-hash/role IndexedDB slot approximately every five seconds and on termination. Unverified staged data is never promoted after an error. Reconnect/resume is limited to the same live Worker after transient transport loss. Refreshing, closing or manually ending a session discards the Worker and cannot restore that multiplayer state; an offline role eventually expires. Relay process restart also invalidates its in-memory rooms. Multiplayer instant-state persistence and rollback are not implemented. Solo instant states use a separate local-only serialized-state namespace.


## Recovery exchange

A reconnect authenticates with the same code/role and its resume token, plus the next expected envelope sequence for every other sender. The relay validates monotonic receipt cursors and that no cursor claims a future sequence. A `session` control reply returns the next outgoing sequence the relay expects; the sender prunes already accepted local packets and retransmits only the remainder. The relay replays the recipient's missing envelopes in per-sender sequence order before broadcasting `resumed` when all sockets are back. Client input authorship/frame counters, native snapshots and state checks are not restarted. The simulation only advances using complete validated inputs. Cursors/history stay bounded; invalid receipts, missing replay, state mismatch or expiry fail closed.

`reconnecting` retains the room and pauses advancement. The UI offers `立即重试` to restart the local socket attempt, alongside automatic retries with backoff. The default grace is 120 seconds and is independent of the existing 300-second background heartbeat tolerance. Recovery credentials are not transferable to a fresh page: the corresponding live simulation is required.

## Optional presentation blending

The display-only `补帧` switch blends the previous and latest received RGBA source frames with Canvas alpha compositing. Two scratch surfaces and one scheduled callback are retained; paint updates are capped near 60 Hz, and no new draws are scheduled after the latest transition completes (maximum 80 ms transition). It is not optical-flow/AI motion synthesis, does not predict input or change core timing, and can produce ghosting. The HUD always reports real simulation FPS separately and labels blended paint rate as `含补间`. This option cannot restore missing network input, reduce an underpowered core's compute time, or guarantee 60 FPS on user devices.
