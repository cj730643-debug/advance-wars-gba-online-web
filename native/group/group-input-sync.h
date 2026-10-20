/* Copyright (c) 2026 mGBA contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* AW group adapter, 2026: active 2–4 owner count and four rings. */
#pragma once
#include <mgba/internal/gba/sio/netplay/input-sync.h>
CXX_GUARD_START
struct AWGroupInputSync {
	struct GBALinkInputSlot rings[4][GBA_LINK_INPUT_RING_CAPACITY];
	uint64_t snapshotGeneration;
	uint64_t nextFrame;
	uint64_t lastAuthoredFrame;
	uint16_t delay;
	uint8_t localPlayer;
 unsigned count;
	bool initialized;
	bool authored;
};

const char* AWGroupLinkInputResultName(enum GBALinkInputResult result);
uint16_t AWGroupLinkInputSelectDelay(
	uint16_t minimum, uint16_t maximum,
	uint32_t roundTripMs, uint32_t jitterMs);
bool AWGroupLinkInputCalibrationDigest(
	const struct GBALinkInputCalibration* calibration,
	uint8_t digest[MGBA_SHA256_DIGEST_SIZE]);
enum GBALinkInputSelectionResult AWGroupLinkInputSelectCalibratedDelay(
	const struct GBALinkInputCalibration* calibration,
	uint16_t overlappingMinimum, uint16_t overlappingMaximum,
	uint16_t productionFloor, struct GBALinkInputSelection* selection);
bool AWGroupInputSyncInit(
	struct AWGroupInputSync* sync, uint64_t snapshotGeneration,
	uint8_t localPlayer, uint16_t delay, uint64_t firstFrame, unsigned count);
enum GBALinkInputResult AWGroupInputSyncSeedLocal(
	struct AWGroupInputSync* sync, uint16_t keys,
	struct GBALinkV2Packet* batch);
enum GBALinkInputResult AWGroupInputSyncSeedChunk(struct AWGroupInputSync* sync, unsigned offset, struct GBALinkV2Packet* batch);
enum GBALinkInputResult AWGroupInputSyncAuthor(
	struct AWGroupInputSync* sync, uint64_t currentFrame,
	uint16_t keys, struct GBALinkV2Packet* batch);
enum GBALinkInputResult AWGroupInputSyncHandleBatch(
	struct AWGroupInputSync* sync, uint8_t senderPlayer,
	const struct GBALinkV2InputBatch* batch);
bool AWGroupInputSyncReady(
	const struct AWGroupInputSync* sync, uint64_t frame);
enum GBALinkInputResult AWGroupInputSyncConsume(
	struct AWGroupInputSync* sync, uint64_t frame,
	uint16_t keys[4]);


CXX_GUARD_END
