# 3/4-player serial diagnostic (CC0-1.0)

Derived from the pinned upstream `tools/gba-link-test-rom` CC0 fixture. Commercial game content is absent. The two original fixtures are retained unchanged.

`main.c` exchanges distinct role words through all four Multi-Pak receive registers, cycles every baud rate, checks IDs/IRQs/errors, and records independent digital input. `GROUP_PLAYERS=3` additionally requires the unused fourth receive register to remain `0xFFFF`. Status in EWRAM starts at `0x02000000`; fields retain upstream layout, with inputKeys/seenKeys appended as words 22/23. Status RUNNING=3 is a continuous test; a failure latches high-bit status.

Build with GNU Arm Embedded GCC 13.2.1, binutils 2.42 and Python 3:

```
CROSS=/absolute/path/arm-none-eabi- sh tests/group-rom/build.sh
```

No Nintendo BIOS is required or included. Header and checksum tools retain the upstream CC0 license. The 156-byte console logo header constant comes from that existing redistributable diagnostic source, not a commercial ROM dump.
