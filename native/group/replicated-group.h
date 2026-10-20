/* Copyright (c) 2026 mGBA contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#ifndef AW_REPLICATED_GROUP_H
#define AW_REPLICATED_GROUP_H

#include <mgba-util/common.h>

CXX_GUARD_START

#include "group-replica.h"
#include <mgba/internal/gba/sio/lockstep.h>

enum AWReplicatedGroupResult {
	AW_REPLICATED_GROUP_OK = 0,
	AW_REPLICATED_GROUP_INVALID_ARGUMENT,
	AW_REPLICATED_GROUP_INVALID_STATE,
	AW_REPLICATED_GROUP_ALLOCATION_FAILED,
	AW_REPLICATED_GROUP_CORE_FAILED,
	AW_REPLICATED_GROUP_RESTORE_FAILED,
	AW_REPLICATED_GROUP_INPUT_CONFLICT,
	AW_REPLICATED_GROUP_DEADLOCK,
	AW_REPLICATED_GROUP_FRAME_OVERSHOOT,
};

enum {
	AW_REPLICATED_GROUP_DIGEST_VERSION = 1,
};

struct AWReplicatedGroupUser {
	struct mLockstepUser d;
	int requestedId;
	bool asleep;
	uint64_t sleeps;
	uint64_t wakes;
};

struct AWReplicatedGroupPlayer {
	struct mCore* core;
	struct VFile* temporarySave;
	mColor* videoBuffer;
	struct GBASIOLockstepDriver driver;
	struct AWReplicatedGroupUser user;
	bool attached;
	uint64_t runLoops;
	uint64_t saveGeneration;
	enum GBASavedataType observedSaveType;
	int observedSaveDirty;
	uint32_t observedSaveDirtAge;
	bool configInitialized;
};

struct AWReplicatedGroupMetrics {
	uint64_t frameNumber;
	uint8_t stateTrace[4][MGBA_SHA256_DIGEST_SIZE];
	uint64_t runLoops[4];
	uint64_t sleeps[4];
	uint64_t wakes[4];
	uint64_t saveGenerations[4];
	uint64_t recoveredFrameLeads[4];
	uint64_t transferStarts;
	uint64_t transferCompletions;
	uint64_t transferredWords;
	uint64_t waitEvents;
};

struct AWReplicatedGroup {
	unsigned count;
	struct GBASIOLockstepCoordinator coordinator;
	struct AWReplicatedGroupPlayer players[4];
	uint8_t* rom;
	size_t romSize;
	uint8_t* bios;
	size_t biosSize;
	uint64_t snapshotGeneration;
	uint64_t frameNumber;
	uint64_t inputFrame;
	uint16_t inputs[4];
	uint8_t stateTrace[4][MGBA_SHA256_DIGEST_SIZE];
	uint32_t nextFrameCounters[4];
	uint64_t recoveredFrameLeads[4];
	/* Diagnostic-only state from the most recent frame attempt. */
	enum AWReplicatedGroupResult lastRunResult;
	uint64_t failureIteration;
	uint32_t startingFrames[4];
	uint32_t observedFrames[4];
	bool initialized;
	bool installed;
	bool inputsReady;
	bool stopped;
};

const char* AWReplicatedGroupResultName(enum AWReplicatedGroupResult result);
void AWReplicatedGroupInit(struct AWReplicatedGroup* pair);
enum AWReplicatedGroupResult AWReplicatedGroupInstall(
	struct AWReplicatedGroup* pair, struct mCore* templateCore,
	const struct GBAReplicaManifest manifests[4],
	const struct GBAReplicaPayload payloads[4], uint64_t generation, unsigned count);
enum AWReplicatedGroupResult AWReplicatedGroupSetInputs(
	struct AWReplicatedGroup* pair, uint64_t frame,
	const uint16_t inputs[4]);
enum AWReplicatedGroupResult AWReplicatedGroupRunFrame(
	struct AWReplicatedGroup* pair);
struct mCore* AWReplicatedGroupCore(
	struct AWReplicatedGroup* pair, uint8_t player);
const struct mCore* AWReplicatedGroupCoreConst(
	const struct AWReplicatedGroup* pair, uint8_t player);
mColor* AWReplicatedGroupVideoBuffer(
	struct AWReplicatedGroup* pair, uint8_t player);
bool AWReplicatedGroupAssignFrontend(
	struct AWReplicatedGroup* pair, uint8_t player,
	struct mCore* frontendCore);
bool AWReplicatedGroupDrainShadowAudio(
	struct AWReplicatedGroup* pair, uint8_t presentedPlayer);
bool AWReplicatedGroupAssignSaveBacking(
	struct AWReplicatedGroup* pair, uint8_t player,
	void* data, size_t capacity);
bool AWReplicatedGroupStateDigest(
	const struct AWReplicatedGroup* pair, uint8_t player,
	uint8_t digest[MGBA_SHA256_DIGEST_SIZE]);
bool AWReplicatedGroupGetMetrics(
	const struct AWReplicatedGroup* pair,
	struct AWReplicatedGroupMetrics* metrics);
void AWReplicatedGroupStop(struct AWReplicatedGroup* pair);

CXX_GUARD_END

#endif
