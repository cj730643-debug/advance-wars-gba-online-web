/* Copyright (c) 2026 mGBA contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
/* AW group adapter, 2026: group-only snapshot owner bounds 0–3. */
#pragma once
#include <mgba/internal/gba/replica.h>
CXX_GUARD_START
extern const struct GBAReplicaLimits AW_GROUP_REPLICA_DEFAULT_LIMITS;
const char* AWGroupReplicaResultName(enum GBAReplicaResult result);
bool AWGroupReplicaIsQuiescent(const struct mCore* core);

enum GBAReplicaResult AWGroupReplicaManifestValidate(
	const struct GBAReplicaManifest* manifest,
	const struct GBAReplicaLimits* limits);
enum GBAReplicaResult AWGroupReplicaManifestEncode(
	const struct GBAReplicaManifest* manifest,
	uint8_t output[GBA_REPLICA_MANIFEST_SIZE]);
enum GBAReplicaResult AWGroupReplicaManifestDecode(
	const uint8_t* input, size_t size,
	const struct GBAReplicaLimits* limits,
	struct GBAReplicaManifest* manifest);

enum GBAReplicaResult AWGroupReplicaCapture(
	struct mCore* source, uint8_t player, uint64_t generation,
	enum GBAReplicaEncoding encoding, uint32_t chunkSize,
	struct GBAReplicaBundle* bundle);
void AWGroupReplicaBundleDeinit(struct GBAReplicaBundle* bundle);

enum GBAReplicaResult AWGroupReplicaAssemblerInit(
	struct GBAReplicaAssembler* assembler,
	const struct GBAReplicaManifest* manifest,
	uint8_t expectedPlayer, uint64_t expectedGeneration,
	const struct GBAReplicaLimits* limits);
enum GBAReplicaResult AWGroupReplicaAssemblerAdd(
	struct GBAReplicaAssembler* assembler,
	uint8_t player, uint64_t generation, uint32_t offset,
	const void* data, size_t size);
enum GBAReplicaResult AWGroupReplicaAssemblerFinalize(
	struct GBAReplicaAssembler* assembler,
	struct GBAReplicaPayload* payload);
void AWGroupReplicaAssemblerDeinit(struct GBAReplicaAssembler* assembler);
void AWGroupReplicaPayloadDeinit(struct GBAReplicaPayload* payload);

enum GBAReplicaResult AWGroupReplicaRestore(
	struct mCore* target,
	const struct GBAReplicaManifest* manifest,
	const struct GBAReplicaPayload* payload,
	uint8_t expectedPlayer, uint64_t expectedGeneration);


CXX_GUARD_END
