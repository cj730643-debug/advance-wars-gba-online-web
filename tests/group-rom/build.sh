#!/bin/sh
set -eu
cd "$(dirname "$0")"
CROSS=${CROSS:-arm-none-eabi-}
mkdir -p ../../build/group-rom
for n in 3 4; do
 "${CROSS}gcc" -mcpu=arm7tdmi -marm -Os -ffreestanding -fno-builtin -fomit-frame-pointer -ffunction-sections -fdata-sections -Wall -Wextra -Werror -DGROUP_PLAYERS=$n -nostdlib -Wl,--gc-sections -Wl,-T,linker.ld header.s main.c -o ../../build/group-rom/group-$n.elf
 "${CROSS}objcopy" -O binary ../../build/group-rom/group-$n.elf ../fixtures/gba-link-group-$n.gba
 python3 fix-header.py ../fixtures/gba-link-group-$n.gba
done
