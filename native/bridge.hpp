// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
#pragma once
#include "libretro.h"
#include <cstdint>
#include <cstring>
#include <functional>
#include <vector>
#include <stdexcept>

namespace aw {
// Used exclusively on the emulation thread. Socket threads own copied queues;
// they never enter the core or call any Netpacket callback.
class Bridge {
 public:
  retro_netpacket_callback core{};
  std::function<bool(const std::vector<uint8_t>&)> transmit;
  std::function<void()> pump;
  std::function<void(const char*)> onFailure;
  bool active = false, terminal = false;
  uint16_t role = 0;
  uint64_t sent = 1, received = 1;
  uint64_t stateChecksSent = 0, stateChecksReceived = 0;
  static inline thread_local Bridge* current = nullptr;
  void fail(const char* reason) {
    if (!terminal) { terminal = true; if (onFailure) onFailure(reason); }
  }
  bool start(uint16_t player) {
    if (active || terminal || player > 1 || !core.start || !core.receive ||
        !core.stop || !core.protocol_version ||
        std::strcmp(core.protocol_version, "mgba-gba-link-replicated-v2")) return false;
    role = player; active = true; current = this;
    core.start(role, send, pollReceive);
    if (role == 0 && core.connected && !core.connected(1)) fail("CORE_ADMISSION_FAILED");
    return !terminal;
  }
  void stop() {
    if (active) {
      // stop() itself may log failures. The frontend is already terminal and
      // will not release another retro_run even after checkpoint restoration.
      terminal = true; active = false;
      if (role == 0 && core.disconnected) core.disconnected(1);
      core.stop();
    }
    if (current == this) current = nullptr;
  }
  void tick() { if (active && !terminal && core.poll) core.poll(); }
  void receive(const std::vector<uint8_t>& bytes) {
    if (!active || terminal) return;
    if (bytes.size() <= 12 || bytes.size() > 65548 || std::memcmp(bytes.data(), "AWR1", 4)) { fail("BAD_PACKET"); return; }
    uint64_t seq = 0; for (int i = 4; i < 12; ++i) seq = (seq << 8) | bytes[i];
    if (seq != received || seq == UINT64_MAX) { fail("BAD_SEQUENCE"); return; }
    ++received;
    if (isStateCheck(bytes.data()+12,bytes.size()-12)) ++stateChecksReceived;
    core.receive(bytes.data() + 12, bytes.size() - 12, 1 - role);
  }
 private:
  static bool isStateCheck(const void* data,size_t size) {
    const auto* p=static_cast<const uint8_t*>(data);
    return size>=32 && !std::memcmp(p,"GLR2",4) && p[4]==2 && !p[5] && p[6]==11 && !p[7];
  }
  static void RETRO_CALLCONV send(int flags, const void* data, size_t size, uint16_t target) {
    auto* b = current;
    if (!b || !b->active || b->terminal) return;
    if (!size && !data) return; // All queued sends already request immediate flush.
    if (!data || !size || size > 65536 || !(flags & RETRO_NETPACKET_RELIABLE) ||
        (flags & RETRO_NETPACKET_UNSEQUENCED) ||
        (target != 1 - b->role && target != RETRO_NETPACKET_BROADCAST) || b->sent == UINT64_MAX) {
      b->fail("INVALID_CORE_SEND"); return;
    }
    std::vector<uint8_t> frame(size + 12); std::memcpy(frame.data(), "AWR1", 4);
    auto seq = b->sent++;
    for (int i = 11; i >= 4; --i) { frame[i] = uint8_t(seq); seq >>= 8; }
    std::memcpy(frame.data() + 12, data, size);
    if (!b->transmit || !b->transmit(frame)) b->fail("SEND_FAILED");
    else if (isStateCheck(data,size)) ++b->stateChecksSent;
  }
  static void RETRO_CALLCONV pollReceive() {
    auto* b = current; if (b && b->active && !b->terminal && b->pump) b->pump();
  }
};
}
