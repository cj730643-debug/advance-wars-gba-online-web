/* Copyright (c) 2026 mGBA contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#include "replicated-group.h"
#include "group-replica.h"
/* Advance Wars Online, 2026: separate 2-4-player group adapter derived from
 * upstream 9e919b0c. Existing pair implementation and wire protocol unchanged. */


#include <mgba/core/core.h>
#include <mgba/gba/core.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/serialize.h>
#include <mgba-util/audio-buffer.h>
#include <mgba-util/vfs.h>

enum {
	AW_REPLICATED_GROUP_MAX_RUN_LOOPS = 4000000,
	AW_REPLICATED_GROUP_MAX_FRAME_LEAD = 1,
	AW_REPLICATED_GROUP_VIDEO_WIDTH = 256,
	AW_REPLICATED_GROUP_VIDEO_HEIGHT = 224,
};

static int _requestedId(struct mLockstepUser* user) {
	return ((struct AWReplicatedGroupUser*) user)->requestedId;
}

/* Advance Wars Online modification: avoid the Windows CRT _sleep symbol.
 * Callback behavior and scheduler timing are unchanged. */
static void _pairSleep(struct mLockstepUser* user) {
	struct AWReplicatedGroupUser* pairUser =
	    (struct AWReplicatedGroupUser*) user;
	pairUser->asleep = true;
	++pairUser->sleeps;
}

static void _wake(struct mLockstepUser* user) {
	struct AWReplicatedGroupUser* pairUser =
	    (struct AWReplicatedGroupUser*) user;
	pairUser->asleep = false;
	++pairUser->wakes;
}

const char* AWReplicatedGroupResultName(enum AWReplicatedGroupResult result) {
	switch (result) {
	case AW_REPLICATED_GROUP_OK: return "ok";
	case AW_REPLICATED_GROUP_INVALID_ARGUMENT: return "invalid argument";
	case AW_REPLICATED_GROUP_INVALID_STATE: return "invalid pair state";
	case AW_REPLICATED_GROUP_ALLOCATION_FAILED: return "allocation failed";
	case AW_REPLICATED_GROUP_CORE_FAILED: return "logical core creation failed";
	case AW_REPLICATED_GROUP_RESTORE_FAILED: return "replica restore failed";
	case AW_REPLICATED_GROUP_INPUT_CONFLICT: return "input frame conflict";
	case AW_REPLICATED_GROUP_DEADLOCK: return "cooperative scheduler deadlock";
	case AW_REPLICATED_GROUP_FRAME_OVERSHOOT: return "logical frame overshoot";
	}
	return "unknown";
}

void AWReplicatedGroupInit(struct AWReplicatedGroup* pair) {
	if (!pair) {
		return;
	}
	memset(pair, 0, sizeof(*pair));
	GBASIOLockstepCoordinatorInit(&pair->coordinator);
	pair->initialized = true;
}

static bool _copyTemplateAssets(
	struct AWReplicatedGroup* pair, struct mCore* templateCore) {
	if (!templateCore || !templateCore->platform ||
	    templateCore->platform(templateCore) != mPLATFORM_GBA ||
	    !templateCore->board || !templateCore->romSize) {
		return false;
	}
	const struct GBA* gba = templateCore->board;
	pair->romSize = templateCore->romSize(templateCore);
	if (!pair->romSize || !gba->memory.rom) {
		return false;
	}
	pair->rom = malloc(pair->romSize);
	if (!pair->rom) {
		return false;
	}
	memcpy(pair->rom, gba->memory.rom, pair->romSize);
	if (gba->biosVf) {
		pair->biosSize = GBA_SIZE_BIOS;
		pair->bios = malloc(pair->biosSize);
		if (!pair->bios) {
			return false;
		}
		memcpy(pair->bios, gba->memory.bios, pair->biosSize);
	}
	return true;
}

static enum AWReplicatedGroupResult _createPlayer(
	struct AWReplicatedGroup* pair, unsigned playerId,
	struct mCore* templateCore,
	const struct GBAReplicaManifest* manifest,
	const struct GBAReplicaPayload* payload) {
	struct AWReplicatedGroupPlayer* player = &pair->players[playerId];
	player->core = GBACoreCreate();
	if (!player->core || !player->core->init(player->core)) {
		return AW_REPLICATED_GROUP_CORE_FAILED;
	}
	mCoreInitConfig(player->core, NULL);
	player->configInitialized = true;
	mCoreLoadForeignConfig(player->core, &templateCore->config);
	struct VFile* rom = VFileFromConstMemory(pair->rom, pair->romSize);
	if (!rom || !player->core->loadROM(player->core, rom)) {
		if (rom) {
			rom->close(rom);
		}
		return AW_REPLICATED_GROUP_CORE_FAILED;
	}
	if (pair->bios) {
		struct VFile* bios = VFileFromConstMemory(pair->bios, pair->biosSize);
		if (!bios || !player->core->loadBIOS(player->core, bios, 0)) {
			if (bios) {
				bios->close(bios);
			}
			return AW_REPLICATED_GROUP_CORE_FAILED;
		}
	}
	player->temporarySave = VFileMemChunk(NULL, 0);
	if (!player->temporarySave ||
	    !player->core->loadTemporarySave(
	        player->core, player->temporarySave)) {
		return AW_REPLICATED_GROUP_CORE_FAILED;
	}
	player->videoBuffer = malloc(
	    AW_REPLICATED_GROUP_VIDEO_WIDTH *
	    AW_REPLICATED_GROUP_VIDEO_HEIGHT *
	    sizeof(*player->videoBuffer));
	if (!player->videoBuffer) {
		return AW_REPLICATED_GROUP_ALLOCATION_FAILED;
	}
	player->core->setVideoBuffer(
	    player->core, player->videoBuffer,
	    AW_REPLICATED_GROUP_VIDEO_WIDTH);
	player->core->setAudioBufferSize(
	    player->core, templateCore->getAudioBufferSize(templateCore));
	player->core->reset(player->core);
	if (AWGroupReplicaRestore(
	        player->core, manifest, payload, playerId,
	        pair->snapshotGeneration) != GBA_REPLICA_OK) {
		return AW_REPLICATED_GROUP_RESTORE_FAILED;
	}
	struct GBA* gba = player->core->board;
	player->observedSaveType = gba->memory.savedata.type;
	player->observedSaveDirty = gba->memory.savedata.dirty;
	player->observedSaveDirtAge = gba->memory.savedata.dirtAge;
	player->saveGeneration = 1;
	player->user.requestedId = playerId;
	player->user.d.requestedId = _requestedId;
	player->user.d.sleep = _pairSleep;
	player->user.d.wake = _wake;
	GBASIOLockstepDriverCreate(&player->driver, &player->user.d);
	GBASIOLockstepCoordinatorAttach(&pair->coordinator, &player->driver);
	player->core->setPeripheral(
	    player->core, mPERIPH_GBA_LINK_PORT, &player->driver.d);
	player->attached = true;
	return AW_REPLICATED_GROUP_OK;
}

enum AWReplicatedGroupResult AWReplicatedGroupInstall(
	struct AWReplicatedGroup* pair, struct mCore* templateCore,
	const struct GBAReplicaManifest manifests[4],
	const struct GBAReplicaPayload payloads[4], uint64_t generation, unsigned count) {
	if (!pair || !templateCore || !manifests || !payloads || !generation || count < 2 || count > 4) {
		return AW_REPLICATED_GROUP_INVALID_ARGUMENT;
	}
	if (!pair->initialized || pair->installed || pair->stopped) {
		return AW_REPLICATED_GROUP_INVALID_STATE;
	}
	for(unsigned i=0;i<count;++i) if(manifests[i].player!=i || manifests[i].generation!=generation) return AW_REPLICATED_GROUP_INVALID_ARGUMENT;
	pair->count=count;
	pair->snapshotGeneration = generation;
	if (!_copyTemplateAssets(pair, templateCore)) {
		AWReplicatedGroupStop(pair);
		return pair->rom ? AW_REPLICATED_GROUP_ALLOCATION_FAILED
		                 : AW_REPLICATED_GROUP_CORE_FAILED;
	}
	for (unsigned i = 0; i < pair->count; ++i) {
		enum AWReplicatedGroupResult result = _createPlayer(
		    pair, i, templateCore, &manifests[i], &payloads[i]);
		if (result != AW_REPLICATED_GROUP_OK) {
			AWReplicatedGroupStop(pair);
			return result;
		}
	}
	bool valid=GBASIOLockstepCoordinatorAttached(&pair->coordinator)==count;
	for(unsigned i=0;i<count;++i) valid=valid && pair->players[i].driver.d.deviceId(&pair->players[i].driver.d)==(int)i;
	if(!valid || !GBASIOLockstepCoordinatorSettleTopology(&pair->coordinator)) { AWReplicatedGroupStop(pair);return AW_REPLICATED_GROUP_CORE_FAILED; }
	for (unsigned i = 0; i < pair->count; ++i) {
		pair->nextFrameCounters[i] =
		    pair->players[i].core->frameCounter(
		        pair->players[i].core) + 1;
	}
	pair->installed = true;
	return AW_REPLICATED_GROUP_OK;
}

enum AWReplicatedGroupResult AWReplicatedGroupSetInputs(struct AWReplicatedGroup* pair,uint64_t frame,const uint16_t inputs[4]) {
 if(!pair||!inputs)return AW_REPLICATED_GROUP_INVALID_ARGUMENT;
 if(!pair->installed||pair->stopped||frame!=pair->frameNumber)return AW_REPLICATED_GROUP_INVALID_STATE;
 for(unsigned i=0;i<pair->count;++i)if(inputs[i]&~0x03FF)return AW_REPLICATED_GROUP_INVALID_ARGUMENT;
 if(pair->inputsReady)return pair->inputFrame==frame&&!memcmp(pair->inputs,inputs,pair->count*sizeof(uint16_t))?AW_REPLICATED_GROUP_OK:AW_REPLICATED_GROUP_INPUT_CONFLICT;
 pair->inputFrame=frame;memcpy(pair->inputs,inputs,pair->count*sizeof(uint16_t));pair->inputsReady=true;return AW_REPLICATED_GROUP_OK;
}

static void _recordTrace(
	struct AWReplicatedGroup* pair, unsigned playerId) {
	struct GBASerializedState* state = calloc(1, sizeof(*state));
	if (!state) {
		memset(pair->stateTrace[playerId], 0,
		    sizeof(pair->stateTrace[playerId]));
		return;
	}
	GBASerialize(pair->players[playerId].core->board, state);
	struct SHA256Context context;
	sha256Init(&context);
	sha256Update(&context, pair->stateTrace[playerId],
	    sizeof(pair->stateTrace[playerId]));
	uint8_t frame[8];
	for (unsigned i = 0; i < sizeof(frame); ++i) {
		frame[i] = pair->frameNumber >> (i * 8);
	}
	sha256Update(&context, frame, sizeof(frame));
	sha256Update(&context, state, sizeof(*state));
	sha256Finalize(pair->stateTrace[playerId], &context);
	free(state);
}

static void _updateSaveGeneration(
		struct AWReplicatedGroupPlayer* player) {
	struct GBASavedata* savedata =
	    &((struct GBA*) player->core->board)->memory.savedata;
	if (savedata->type != player->observedSaveType ||
	    savedata->dirty != player->observedSaveDirty ||
	    savedata->dirtAge != player->observedSaveDirtAge) {
		++player->saveGeneration;
		player->observedSaveType = savedata->type;
		player->observedSaveDirty = savedata->dirty;
		player->observedSaveDirtAge = savedata->dirtAge;
	}
}

enum AWReplicatedGroupResult AWReplicatedGroupRunFrame(
	struct AWReplicatedGroup* pair) {
	if (!pair) {
		return AW_REPLICATED_GROUP_INVALID_STATE;
	}
	pair->lastRunResult = AW_REPLICATED_GROUP_OK;
	pair->failureIteration = 0;
	if (!pair->installed || pair->stopped || !pair->inputsReady ||
	    pair->inputFrame != pair->frameNumber) {
		pair->lastRunResult = AW_REPLICATED_GROUP_INVALID_STATE;
		return pair->lastRunResult;
	}
	for (unsigned i = 0; i < pair->count; ++i) {
		pair->startingFrames[i] = pair->players[i].core->frameCounter(
		    pair->players[i].core);
		pair->observedFrames[i] = pair->startingFrames[i];
		pair->players[i].core->setKeys(
		    pair->players[i].core, pair->inputs[i]);
	}
	for (uint64_t iteration = 0;
	     iteration < AW_REPLICATED_GROUP_MAX_RUN_LOOPS; ++iteration) {
		bool complete[4];
		int32_t distance[4];
		for (unsigned i = 0; i < pair->count; ++i) {
			uint32_t frame = pair->players[i].core->frameCounter(
			    pair->players[i].core);
			pair->observedFrames[i] = frame;
			distance[i] =
			    (int32_t) (frame - pair->nextFrameCounters[i]);
			if (distance[i] < -1) {
				pair->lastRunResult =
				    AW_REPLICATED_GROUP_FRAME_OVERSHOOT;
				pair->failureIteration = iteration;
				return pair->lastRunResult;
			}
			complete[i] = distance[i] >= 0;
		}
		bool allComplete=true;for(unsigned i=0;i<pair->count;++i)allComplete=allComplete&&complete[i];
		if (allComplete) {
			/* A run loop may cross one additional video boundary while
			 * servicing the local cable peer. Judge the lead only after
			 * both players reach their targets, then rebase from the
			 * counters actually observed. */
			for(unsigned i=0;i<pair->count;++i) if(distance[i]>AW_REPLICATED_GROUP_MAX_FRAME_LEAD) {pair->lastRunResult=AW_REPLICATED_GROUP_FRAME_OVERSHOOT;pair->failureIteration=iteration;return pair->lastRunResult;}
			for (unsigned i = 0; i < pair->count; ++i) {
				uint32_t frame =
				    pair->players[i].core->frameCounter(
				        pair->players[i].core);
				if (frame != pair->nextFrameCounters[i]) {
					++pair->recoveredFrameLeads[i];
				}
				pair->nextFrameCounters[i] = frame + 1;
			}
			++pair->frameNumber;
			pair->inputsReady = false;
			for(unsigned i=0;i<pair->count;++i){_updateSaveGeneration(&pair->players[i]);_recordTrace(pair,i);}
			return AW_REPLICATED_GROUP_OK;
		}
		bool ran = false;
		for (unsigned i = 0; i < pair->count; ++i) {
			struct AWReplicatedGroupPlayer* player = &pair->players[i];
			if (!player->user.asleep) {
				player->core->runLoop(player->core);
				++player->runLoops;
				ran = true;
			}
		}
		if (!ran) {
			pair->lastRunResult = AW_REPLICATED_GROUP_DEADLOCK;
			pair->failureIteration = iteration;
			return pair->lastRunResult;
		}
	}
	pair->lastRunResult = AW_REPLICATED_GROUP_DEADLOCK;
	pair->failureIteration = AW_REPLICATED_GROUP_MAX_RUN_LOOPS;
	return pair->lastRunResult;
}

struct mCore* AWReplicatedGroupCore(
	struct AWReplicatedGroup* pair, uint8_t player) {
	return pair && pair->installed && !pair->stopped && player < pair->count
	    ? pair->players[player].core
	    : NULL;
}

const struct mCore* AWReplicatedGroupCoreConst(
	const struct AWReplicatedGroup* pair, uint8_t player) {
	return pair && pair->installed && !pair->stopped && player < pair->count
	    ? pair->players[player].core
	    : NULL;
}

mColor* AWReplicatedGroupVideoBuffer(
	struct AWReplicatedGroup* pair, uint8_t player) {
	return pair && pair->installed && !pair->stopped && player < pair->count
	    ? pair->players[player].videoBuffer
	    : NULL;
}

bool AWReplicatedGroupAssignFrontend(
	struct AWReplicatedGroup* pair, uint8_t player,
	struct mCore* frontendCore) {
	if (!pair || !pair->installed || pair->stopped || player >= pair->count ||
	    !frontendCore || !frontendCore->getPeripheral) {
		return false;
	}
	const int peripherals[] = {
		mPERIPH_RUMBLE,
		mPERIPH_ROTATION,
		mPERIPH_GBA_LUMINANCE,
	};
	for (unsigned logical = 0; logical < pair->count; ++logical) {
		for (unsigned i = 0;
		     i < sizeof(peripherals) / sizeof(*peripherals); ++i) {
			void* peripheral = logical == player
			    ? frontendCore->getPeripheral(
			          frontendCore, peripherals[i])
			    : NULL;
			pair->players[logical].core->setPeripheral(
			    pair->players[logical].core,
			    peripherals[i], peripheral);
		}
	}
	return true;
}

bool AWReplicatedGroupDrainShadowAudio(
		struct AWReplicatedGroup* pair, uint8_t presentedPlayer) {
	if (!pair || !pair->installed || pair->stopped ||
	    presentedPlayer >= pair->count) {
		return false;
	}
	for(unsigned i=0;i<pair->count;++i)if(i!=presentedPlayer){struct mCore* shadow=pair->players[i].core;mAudioBufferClear(shadow->getAudioBuffer(shadow));}
	return true;
}

bool AWReplicatedGroupAssignSaveBacking(
	struct AWReplicatedGroup* pair, uint8_t player,
	void* data, size_t capacity) {
	if (!pair || !pair->installed || pair->stopped || player >= pair->count ||
	    !data || capacity < GBA_SIZE_FLASH1M) {
		return false;
	}
	struct VFile* backing = VFileFromMemory(data, capacity);
	if (!backing ||
	    !pair->players[player].core->loadTemporarySave(
	        pair->players[player].core, backing)) {
		if (backing) {
			backing->close(backing);
		}
		return false;
	}
	/*
	 * GBASavedataMask closed the previous temporary file. The pair owns
	 * this replacement until core teardown.
	 */
	pair->players[player].temporarySave = backing;
	struct GBASavedata* savedata =
	    &((struct GBA*) pair->players[player].core->board)->memory.savedata;
	pair->players[player].observedSaveType = savedata->type;
	pair->players[player].observedSaveDirty = savedata->dirty;
	pair->players[player].observedSaveDirtAge = savedata->dirtAge;
	return true;
}

static void _digestU32(struct SHA256Context* context, uint32_t value) {
	uint8_t encoded[4];
	for (unsigned i = 0; i < sizeof(encoded); ++i) {
		encoded[i] = value >> (i * 8);
	}
	sha256Update(context, encoded, sizeof(encoded));
}

static void _digestU64(struct SHA256Context* context, uint64_t value) {
	uint8_t encoded[8];
	for (unsigned i = 0; i < sizeof(encoded); ++i) {
		encoded[i] = value >> (i * 8);
	}
	sha256Update(context, encoded, sizeof(encoded));
}

static bool _digestSave(
		struct SHA256Context* context,
		struct GBASavedata* savedata, size_t size) {
	if (!size) {
		return true;
	}
	if (savedata->data) {
		sha256Update(context, savedata->data, size);
		return true;
	}
	if (!savedata->vf) {
		return false;
	}
	off_t position = savedata->vf->seek(
	    savedata->vf, 0, SEEK_CUR);
	if (position < 0 ||
	    savedata->vf->seek(savedata->vf, 0, SEEK_SET) != 0) {
		return false;
	}
	uint8_t buffer[2048];
	size_t remaining = size;
	bool valid = true;
	while (remaining) {
		size_t request = remaining < sizeof(buffer)
		    ? remaining : sizeof(buffer);
		ssize_t read = savedata->vf->read(
		    savedata->vf, buffer, request);
		if (read != (ssize_t) request) {
			valid = false;
			break;
		}
		sha256Update(context, buffer, request);
		remaining -= request;
	}
	if (savedata->vf->seek(
	        savedata->vf, position, SEEK_SET) != position) {
		valid = false;
	}
	return valid;
}

bool AWReplicatedGroupStateDigest(
		const struct AWReplicatedGroup* pair, uint8_t playerId,
		uint8_t digest[MGBA_SHA256_DIGEST_SIZE]) {
	if (!pair || !digest || !pair->installed || pair->stopped ||
	    playerId >= pair->count) {
		return false;
	}
	const struct AWReplicatedGroupPlayer* player =
	    &pair->players[playerId];
	struct GBA* gba = player->core->board;
	struct GBASerializedState* state = calloc(1, sizeof(*state));
	void* driverState = NULL;
	size_t driverSize = 0;
	if (!state || !gba || !gba->sio.driver ||
	    !gba->sio.driver->driverId || !gba->sio.driver->saveState) {
		free(state);
		return false;
	}
	GBASerialize(gba, state);
	gba->sio.driver->saveState(
	    gba->sio.driver, &driverState, &driverSize);
	if (!driverState || !driverSize) {
		free(driverState);
		free(state);
		return false;
	}

	struct GBASavedata* savedata = &gba->memory.savedata;
	size_t saveSize = GBASavedataSize(savedata);

	static const char domain[] = "mGBA replicated-group state digest";
	struct SHA256Context context;
	sha256Init(&context);
	sha256Update(&context, domain, sizeof(domain));
	_digestU32(&context, AW_REPLICATED_GROUP_DIGEST_VERSION);
	_digestU32(&context, GBASavestateMagic + GBASavestateVersion);
	_digestU64(&context, sizeof(*state));
	sha256Update(&context, state, sizeof(*state));
	_digestU32(&context, player->core->rtc.override);
	_digestU64(&context, player->core->rtc.value);
	_digestU32(&context, savedata->type);
	_digestU64(&context, saveSize);
	if (!_digestSave(&context, savedata, saveSize)) {
		free(driverState);
		free(state);
		return false;
	}
	_digestU32(&context, gba->sio.driver->driverId(gba->sio.driver));
	_digestU64(&context, driverSize);
	sha256Update(&context, driverState, driverSize);
	sha256Finalize(digest, &context);

	free(driverState);
	free(state);
	return true;
}

bool AWReplicatedGroupGetMetrics(
	const struct AWReplicatedGroup* pair,
	struct AWReplicatedGroupMetrics* metrics) {
	if (!pair || !metrics || !pair->installed || pair->stopped) {
		return false;
	}
	memset(metrics, 0, sizeof(*metrics));
	metrics->frameNumber = pair->frameNumber;
	memcpy(metrics->stateTrace, pair->stateTrace,
	    sizeof(metrics->stateTrace));
	for (unsigned i = 0; i < pair->count; ++i) {
		metrics->runLoops[i] = pair->players[i].runLoops;
		metrics->sleeps[i] = pair->players[i].user.sleeps;
		metrics->wakes[i] = pair->players[i].user.wakes;
		metrics->saveGenerations[i] =
		    pair->players[i].saveGeneration;
		metrics->recoveredFrameLeads[i] =
		    pair->recoveredFrameLeads[i];
	}
	metrics->transferStarts = pair->coordinator.transferStarts;
	metrics->transferCompletions = pair->coordinator.transferCompletions;
	metrics->transferredWords = pair->coordinator.transferredWords;
	metrics->waitEvents = pair->coordinator.waitEvents;
	return true;
}

void AWReplicatedGroupStop(struct AWReplicatedGroup* pair) {
	if (!pair || !pair->initialized || pair->stopped) {
		return;
	}
	for (int i = (int)pair->count-1; i >= 0; --i) {
		struct AWReplicatedGroupPlayer* player = &pair->players[i];
		if (player->attached && player->core) {
			player->core->setPeripheral(
			    player->core, mPERIPH_GBA_LINK_PORT, NULL);
			GBASIOLockstepCoordinatorDetach(
			    &pair->coordinator, &player->driver);
			player->attached = false;
		}
	}
	for (unsigned i = 0; i < pair->count; ++i) {
		struct AWReplicatedGroupPlayer* player = &pair->players[i];
		struct VFile* orphanedSave = NULL;
		if (player->core) {
			struct GBA* gba = player->core->board;
			if (player->temporarySave &&
			    !gba->memory.savedata.realVf) {
				/* With no persistent save underneath the mask, core
				 * teardown unmaps but deliberately does not close the
				 * temporary VFile. */
				orphanedSave = player->temporarySave;
			}
			if (player->configInitialized) {
				mCoreConfigDeinit(&player->core->config);
				player->configInitialized = false;
			}
			player->core->deinit(player->core);
			player->core = NULL;
			player->temporarySave = NULL;
			if (orphanedSave) {
				orphanedSave->close(orphanedSave);
			}
		}
		if (player->temporarySave) {
			player->temporarySave->close(player->temporarySave);
			player->temporarySave = NULL;
		}
		free(player->videoBuffer);
		player->videoBuffer = NULL;
	}
	GBASIOLockstepCoordinatorDeinit(&pair->coordinator);
	free(pair->bios);
	free(pair->rom);
	pair->bios = NULL;
	pair->rom = NULL;
	pair->installed = false;
	pair->stopped = true;
}
