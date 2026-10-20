// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
int awGroupCapture(unsigned role,unsigned count);
const uint8_t* awGroupSnapshotData(void);
size_t awGroupSnapshotSize(void);
int awGroupReceiveSnapshot(unsigned role,const uint8_t* data,size_t size);
int awGroupInstall(void);
int awGroupSeed(void);
int awGroupAuthor(unsigned keys);
const uint8_t* awGroupInputData(void);
size_t awGroupInputSize(void);
int awGroupFeedInput(unsigned sender,const uint8_t* data,size_t size);
int awGroupFrameReady(void);
int awGroupRun(void);
const void* awGroupVideo(unsigned* w,unsigned* h);
size_t awGroupAudio(int16_t* output,size_t max);
const uint8_t* awGroupDigest(void);
void awGroupCommit(void);
void awGroupStop(void);
double awGroupFrame(void);
unsigned awGroupProbe(unsigned player,unsigned word);
const char* awGroupError(void);
#ifdef __cplusplus
}
#endif
