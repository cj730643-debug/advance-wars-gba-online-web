#define GBA_LINK_CONTINUOUS
#ifndef GROUP_PLAYERS
#define GROUP_PLAYERS 4
#endif
/* SPDX-License-Identifier: CC0-1.0 */
#include <stdbool.h>
#include <stdint.h>

#define REG16(address) (*(volatile uint16_t*) (address))

#define REG_DISPCNT REG16(0x04000000)
#define REG_VCOUNT REG16(0x04000006)
#define REG_SIOMULTI0 REG16(0x04000120)
#define REG_SIOMULTI1 REG16(0x04000122)
#define REG_SIOMULTI2 REG16(0x04000124)
#define REG_SIOMULTI3 REG16(0x04000126)
#define REG_SIOCNT REG16(0x04000128)
#define REG_SIOMLT_SEND REG16(0x0400012A)
#define REG_RCNT REG16(0x04000134)
#define REG_IF REG16(0x04000202)

#define VRAM ((volatile uint16_t*) 0x06000000)

#define SIOCNT_SLAVE (1U << 2)
#define SIOCNT_READY (1U << 3)
#define SIOCNT_ID_MASK (3U << 4)
#define SIOCNT_ERROR (1U << 6)
#define SIOCNT_BUSY (1U << 7)
#define SIOCNT_MULTI (2U << 12)
#define SIOCNT_IRQ (1U << 14)
#define IRQ_SERIAL (1U << 7)

#define RESULT_MAGIC 0x31544B4CU /* "LKT1" */
#define RESULT_VERSION 1
#define STATUS_BOOT 1
#define STATUS_WAITING 2
#define STATUS_RUNNING 3
#define STATUS_PASS 4
#define STATUS_FAIL 0x80000000U

#define TRANSFERS_PER_BAUD 4
#define SPIN_LIMIT 0x02000000U
#define PRIMARY_START_SETTLE_CYCLES 4096U

struct LinkTestResult {
	uint32_t magic;
	uint32_t version;
	uint32_t status;
	uint32_t playerId;
	uint32_t observableAttachments;
	uint32_t effectiveParticipants;
	uint32_t transfers;
	uint32_t baudMask;
	uint32_t dataErrors;
	uint32_t missedIrqs;
	uint32_t duplicateIrqs;
	uint32_t busyObservations;
	uint32_t timeouts;
	uint16_t lastSIOCNT;
	uint16_t lastRCNT;
	uint16_t expected[4];
	uint16_t received[4];
	uint32_t completionSpins[4];
 uint32_t inputKeys; /* word 22 */
 uint32_t seenKeys; /* word 23 */
};

static volatile struct LinkTestResult* const result =
    (volatile struct LinkTestResult*) 0x02000000;

static void fillScreen(uint16_t color) {
	for (unsigned i = 0; i < 240U * 160U; ++i) {
		VRAM[i] = color;
	}
}

static void fail(uint32_t code) {
	result->status = STATUS_FAIL | code;
	result->lastSIOCNT = REG_SIOCNT;
	result->lastRCNT = REG_RCNT;
#ifdef GBA_LINK_CONTINUOUS
	fillScreen(0x0008); /* Low-luminance red for unattended OLED soaks. */
#else
	fillScreen(0x001F);
#endif
	for (;;) {
	}
}

#define FAIL_OR_RETRY(code) fail(code)

static uint16_t outgoingWord(unsigned playerId, unsigned baud, unsigned transfer) {
#ifdef GBA_LINK_CONTINUOUS
	/*
	 * A frontend-driven attachment can snapshot the two cartridges at
	 * different instruction phases. Keep the soak payload dependent on the
	 * cable role, but independent of each cartridge's local loop index, so
	 * late attachment does not turn harmless phase skew into a data failure.
	 * The one-shot fixture below retains the changing baud/transfer matrix.
	 */
	(void) baud;
	(void) transfer;
	return (uint16_t) (((playerId + 1U) << 12) | 0x005AU);
#else
	return (uint16_t) (
	    ((playerId + 1U) << 12) |
	    (baud << 4) | transfer);
#endif
}

#ifdef GBA_LINK_CONTINUOUS
#define CONTINUOUS_SPIN_LIMIT 0x00200000U
#define CONTINUOUS_SYNC_PRIMARY 0x1A5AU
#define CONTINUOUS_SYNC_SECONDARY 0x2A5AU

static void continuousWaitForFrameBoundary(void) {
	while (REG_VCOUNT < 160) {
	}
	while (REG_VCOUNT >= 160) {
	}
}

static bool continuousTransfer(unsigned playerId, unsigned baud,
		uint16_t local, bool rendezvous) {
	continuousWaitForFrameBoundary();
	unsigned participants=0;
	result->dataErrors = 0;
	result->missedIrqs = 0;
	result->duplicateIrqs = 0;
	REG_RCNT = 0;
	REG_SIOCNT = SIOCNT_MULTI | SIOCNT_IRQ;
	uint16_t observedId = (REG_SIOCNT & SIOCNT_ID_MASK) >> 4;
	if (observedId != playerId) {
		return false;
	}

	uint16_t control = SIOCNT_MULTI | SIOCNT_IRQ | baud;
	REG_IF = IRQ_SERIAL;
	REG_SIOMLT_SEND = local;
	REG_SIOCNT = control;
	uint32_t spins = CONTINUOUS_SPIN_LIMIT;
	if (playerId == 0) {
		for (volatile unsigned settle = 0;
		     settle < PRIMARY_START_SETTLE_CYCLES; ++settle) {
			__asm__ volatile("nop");
		}
		REG_SIOCNT = control | SIOCNT_BUSY;
	}

	spins = CONTINUOUS_SPIN_LIMIT;
	while (!(REG_SIOCNT & SIOCNT_BUSY) &&
	       !(REG_IF & IRQ_SERIAL) && --spins) {
	}
	if (!spins) {
		++result->timeouts;
		return false;
	}
	if (REG_SIOCNT & SIOCNT_BUSY) {
		++result->busyObservations;
		spins = CONTINUOUS_SPIN_LIMIT;
		while ((REG_SIOCNT & SIOCNT_BUSY) && --spins) {
		}
		result->completionSpins[baud] +=
		    CONTINUOUS_SPIN_LIMIT - spins;
		if (!spins) {
			++result->timeouts;
			return false;
		}
	}

	result->lastSIOCNT = REG_SIOCNT;
	result->lastRCNT = REG_RCNT;
	result->received[0] = REG_SIOMULTI0;
	result->received[1] = REG_SIOMULTI1;
	result->received[2] = REG_SIOMULTI2;
	result->received[3] = REG_SIOMULTI3;
 for(unsigned i=0;i<4;++i){
  result->expected[i]=i<GROUP_PLAYERS ? (rendezvous ? ((i+1)<<12)|0xA5A : outgoingWord(i,baud,0)) : 0xFFFF;
  if(result->received[i]!=0xFFFF)++participants;
 }
	for (unsigned i = 0; i < 4; ++i) {
		if (result->received[i] != result->expected[i]) {
			++result->dataErrors;
		}
	}
	if ((REG_SIOCNT & (SIOCNT_ERROR | SIOCNT_BUSY)) ||
	    !!(REG_SIOCNT & SIOCNT_SLAVE) != !!playerId ||
	    ((REG_SIOCNT & SIOCNT_ID_MASK) >> 4) != playerId) {
		++result->dataErrors;
	}
	if (!(REG_IF & IRQ_SERIAL)) {
		++result->missedIrqs;
	}
	REG_IF = IRQ_SERIAL;
	for (volatile unsigned settle = 0; settle < 32; ++settle) {
		__asm__ volatile("nop");
	}
	if (REG_IF & IRQ_SERIAL) {
		++result->duplicateIrqs;
		REG_IF = IRQ_SERIAL;
	}
	result->effectiveParticipants=participants;
 return participants == GROUP_PLAYERS &&
	       !result->dataErrors && !result->missedIrqs &&
	       !result->duplicateIrqs;
}

static void continuousMain(void) {
	/*
	 * Both cartridges may be snapshotted at unrelated instructions before
	 * the frontend attaches the replicated cable. A distinguished transfer
	 * proves that each cartridge has reached this rendezvous and brings both
	 * programs through the same completion boundary before measurement.
	 */
	result->status = STATUS_WAITING;
	for (;;) {
		REG_RCNT = 0;
		REG_SIOCNT = SIOCNT_MULTI | SIOCNT_IRQ;
		unsigned playerId = (REG_SIOCNT & SIOCNT_ID_MASK) >> 4;
		if (playerId >= GROUP_PLAYERS) {
			continue;
		}
		result->playerId = playerId;
		uint16_t local = ((playerId+1)<<12)|0xA5A;
		(void) continuousTransfer(playerId, 0, local, true);
  bool ready=result->effectiveParticipants == GROUP_PLAYERS;
  for(unsigned i=0;i<GROUP_PLAYERS;++i)ready=ready && result->received[i]==(((i+1)<<12)|0xA5A);
  if(ready){
			break;
		}
	}

	result->observableAttachments = 1;
	result->status = STATUS_RUNNING;
	result->transfers = 0;
	result->baudMask = 0;
	result->busyObservations = 0;
	result->timeouts = 0;
	for (unsigned baud = 0; baud < 4; ++baud) {
		result->completionSpins[baud] = 0;
	}
	fillScreen(0x0000);

	for (;;) {
		REG_SIOCNT = SIOCNT_MULTI | SIOCNT_IRQ;
		unsigned playerId = (REG_SIOCNT & SIOCNT_ID_MASK) >> 4;
		if (playerId >= GROUP_PLAYERS || playerId != result->playerId) {
			fail(2);
		}
		unsigned baud = result->transfers & 3U;
		uint16_t local = outgoingWord(playerId, baud, 0);
		if (!continuousTransfer(playerId, baud, local, false)) {
			fail(5);
		}
		result->inputKeys=(~REG16(0x04000130))&0x3FF; result->seenKeys|=result->inputKeys;
  ++result->transfers;
		result->baudMask |= 1U << baud;
	}
}

#endif

void main(void) {
 REG_DISPCNT = 0x0403; fillScreen(0);
 for(unsigned i=0;i<sizeof(*result)/4;++i)((volatile uint32_t*)result)[i]=0;
 result->magic=RESULT_MAGIC;result->version=2;result->status=STATUS_BOOT;
 continuousMain();
}
