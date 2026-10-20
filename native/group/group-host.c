// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
// Four independent logical GBAs, existing serial coordinator and copied-state/ring code.
#include "group-host.h"
#include "replicated-group.h"
#include "group-input-sync.h"
#include <mgba/core/core.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/sio/netplay/rtc-sync.h>
#include <mgba-util/audio-buffer.h>
#include "libretro.h"
extern struct mCore* mLibretroAWGroupCore(void);
static struct AWReplicatedGroup group;
static struct AWGroupInputSync inputSync;
static struct GBAReplicaManifest manifests[4];
static struct GBAReplicaPayload payloads[4];
static bool snapshots[4],captured,active;
static unsigned local,count;
static uint8_t* snapshot;
static size_t snapshotSize;
static uint8_t inputPacket[1024],digest[32],verifiedSave[GBA_SIZE_FLASH1M];
static size_t inputSize;
static unsigned inputDelay=8,seedOffset=0;
static uint8_t stagedSave[GBA_SIZE_FLASH1M];
static bool stagedSaveValid=false;
static uint64_t stagedFrame=0,verifiedFrame=0;
static const char* error;
static uint64_t load64(const uint8_t*p){uint64_t n=0;for(unsigned i=0;i<8;++i)n=n<<8|p[i];return n;}
static void store64(uint8_t*p,uint64_t n){for(int i=7;i>=0;--i){p[i]=n;n>>=8;}}
static int reject(const char* reason){error=reason;return 0;}
const char* awGroupError(void){return error?error:"GROUP_CORE_FAILED";}
const uint8_t* awGroupSnapshotData(void){return snapshot;}
size_t awGroupSnapshotSize(void){return snapshotSize;}
int awGroupReceiveSnapshot(unsigned role,const uint8_t*data,size_t size){
 if(!captured||active||role>=count||snapshots[role]||!data||size<=GBA_REPLICA_MANIFEST_SIZE||size>GBA_REPLICA_MANIFEST_SIZE+GBA_REPLICA_MAX_ENCODED_SIZE)return reject("GROUP_INVALID_SNAPSHOT");
 struct GBAReplicaManifest m;struct GBAReplicaAssembler assembler;
 if(AWGroupReplicaManifestDecode(data,GBA_REPLICA_MANIFEST_SIZE,NULL,&m)!=GBA_REPLICA_OK||m.player!=role||m.generation!=1||m.encodedSize!=size-GBA_REPLICA_MANIFEST_SIZE)return reject("GROUP_INVALID_MANIFEST");
 if(AWGroupReplicaAssemblerInit(&assembler,&m,role,1,NULL)!=GBA_REPLICA_OK)return reject("GROUP_ASSEMBLER_FAILED");
 enum GBAReplicaResult result=GBA_REPLICA_OK;
 for(size_t offset=0;offset<m.encodedSize;offset+=m.chunkSize){size_t n=m.encodedSize-offset;if(n>m.chunkSize)n=m.chunkSize;result=AWGroupReplicaAssemblerAdd(&assembler,role,1,offset,data+GBA_REPLICA_MANIFEST_SIZE+offset,n);if(result!=GBA_REPLICA_OK)break;}
 if(result==GBA_REPLICA_OK)result=AWGroupReplicaAssemblerFinalize(&assembler,&payloads[role]);
 AWGroupReplicaAssemblerDeinit(&assembler);if(result!=GBA_REPLICA_OK)return reject("GROUP_SNAPSHOT_DIGEST_FAILED");manifests[role]=m;snapshots[role]=true;return 1;
}
int awGroupCapture(unsigned role,unsigned players){
 if(captured||role>=players||players<2||players>4)return reject("GROUP_INVALID_ROLE");
 struct mCore*core=mLibretroAWGroupCore();if(!core||!GBAReplicaIsQuiescent(core))return reject("GROUP_NOT_QUIESCENT");
 struct GBA*gba=core->board;if(GBALinkV2RequiredInputMaskForHardware(gba->memory.hw.devices,false)!=GBA_LINK_V2_INPUT_DIGITAL||gba->memory.hw.devices&HW_EREADER)return reject("GROUP_UNSUPPORTED_HARDWARE");
 struct GBALinkV2RTCNormalization rtc;if(GBALinkV2RTCNormalize(&core->rtc,core->frameCounter(core),core->frameCycles(core),core->frequency(core),&rtc)!=GBA_LINK_V2_RTC_OK||!GBALinkV2RTCApplyNormalized(&core->rtc,&rtc))return reject("GROUP_RTC_FAILED");
 struct GBAReplicaBundle bundle;enum GBAReplicaResult result=AWGroupReplicaCapture(core,role,1,GBA_REPLICA_ENCODING_NONE,GBA_REPLICA_DEFAULT_CHUNK_SIZE,&bundle);GBALinkV2RTCRestoreOriginal(&core->rtc,&rtc);
 if(result!=GBA_REPLICA_OK)return reject("GROUP_CAPTURE_FAILED");
 snapshotSize=GBA_REPLICA_MANIFEST_SIZE+bundle.encodedSize;snapshot=malloc(snapshotSize);if(!snapshot){AWGroupReplicaBundleDeinit(&bundle);return reject("GROUP_ALLOCATION_FAILED");}
 if(AWGroupReplicaManifestEncode(&bundle.manifest,snapshot)!=GBA_REPLICA_OK){AWGroupReplicaBundleDeinit(&bundle);return reject("GROUP_INVALID_MANIFEST");}
 memcpy(snapshot+GBA_REPLICA_MANIFEST_SIZE,bundle.encodedData,bundle.encodedSize);AWGroupReplicaBundleDeinit(&bundle);captured=true;local=role;count=players;
 if(retro_get_memory_size(RETRO_MEMORY_SAVE_RAM)!=sizeof(verifiedSave)||!retro_get_memory_data(RETRO_MEMORY_SAVE_RAM))return reject("GROUP_SAVE_CAPACITY");
 memcpy(verifiedSave,retro_get_memory_data(RETRO_MEMORY_SAVE_RAM),sizeof(verifiedSave));
 return awGroupReceiveSnapshot(role,snapshot,snapshotSize);
}
int awGroupSetDelay(unsigned delay){if(active||delay<1||delay>32)return reject("GROUP_INVALID_DELAY");inputDelay=delay;return 1;}
int awGroupInstall(void){
 if(!captured||active)return reject("GROUP_INVALID_STATE");for(unsigned i=0;i<count;++i)if(!snapshots[i])return reject("GROUP_MISSING_SNAPSHOT");
 AWReplicatedGroupInit(&group);
 if(AWReplicatedGroupInstall(&group,mLibretroAWGroupCore(),manifests,payloads,1,count)!=AW_REPLICATED_GROUP_OK)return reject("GROUP_INSTALL_FAILED");
 if(!AWGroupInputSyncInit(&inputSync,1,local,inputDelay,0,count))return reject("GROUP_INIT_FAILED");
 for(unsigned i=0;i<count;++i)AWGroupReplicaPayloadDeinit(&payloads[i]);active=true;return 1;
}
static int encode(struct GBALinkV2Packet* p){const struct GBALinkV2InputBatch*b=&p->payload.inputBatch;inputSize=12+10*b->count;if(inputSize>sizeof(inputPacket))return reject("GROUP_INPUT_LIMIT");inputPacket[0]=1;inputPacket[1]=b->player;inputPacket[2]=b->count;inputPacket[3]=0;store64(inputPacket+4,b->snapshotGeneration);for(unsigned i=0;i<b->count;++i){uint8_t*d=inputPacket+12+10*i;store64(d,b->records[i].frame);d[8]=b->records[i].keys>>8;d[9]=b->records[i].keys;}return 1;}
static uint16_t gbaKeys(unsigned keys){const unsigned map[10]={8,0,2,3,7,6,4,5,11,10};uint16_t out=0;for(unsigned i=0;i<10;++i)out|=((keys>>map[i])&1)<<i;return out;}
int awGroupSeed(void){struct GBALinkV2Packet p;if(!active||AWGroupInputSyncSeedLocal(&inputSync,0,&p)!=GBA_LINK_INPUT_OK)return reject("GROUP_SEED_FAILED");seedOffset=p.payload.inputBatch.count;return encode(&p);}
int awGroupSeedNext(void){if(seedOffset>=inputDelay)return 0;struct GBALinkV2Packet p;if(AWGroupInputSyncSeedChunk(&inputSync,seedOffset,&p)!=GBA_LINK_INPUT_OK)return -1;seedOffset+=p.payload.inputBatch.count;return encode(&p);}
int awGroupAuthor(unsigned keys){struct GBALinkV2Packet p;enum GBALinkInputResult r=AWGroupInputSyncAuthor(&inputSync,inputSync.nextFrame,gbaKeys(keys),&p);return r==GBA_LINK_INPUT_OK||r==GBA_LINK_INPUT_DUPLICATE?encode(&p):reject("GROUP_INPUT_AUTHOR_FAILED");}
const uint8_t* awGroupInputData(void){return inputPacket;}
size_t awGroupInputSize(void){return inputSize;}
int awGroupFeedInput(unsigned sender,const uint8_t*d,size_t n){
 if(!active||!d||n<12||d[0]!=1||d[1]!=sender||d[3]||!d[2]||d[2]>GBA_LINK_V2_MAX_INPUT_RECORDS||n!=12+10*(size_t)d[2])return reject("GROUP_BAD_INPUT");
 struct GBALinkV2InputBatch b={0};b.player=d[1];b.count=d[2];b.snapshotGeneration=load64(d+4);
 for(unsigned i=0;i<b.count;++i){b.records[i].frame=load64(d+12+10*i);b.records[i].keys=(uint16_t)d[20+10*i]<<8|d[21+10*i];}
 enum GBALinkInputResult r=AWGroupInputSyncHandleBatch(&inputSync,sender,&b);return r==GBA_LINK_INPUT_OK||r==GBA_LINK_INPUT_DUPLICATE?1:reject("GROUP_INPUT_REJECTED");
}
int awGroupFrameReady(void){return active&&AWGroupInputSyncReady(&inputSync,inputSync.nextFrame);}
int awGroupRun(void){uint16_t keys[4];if(!active||AWGroupInputSyncConsume(&inputSync,inputSync.nextFrame,keys)!=GBA_LINK_INPUT_OK)return reject("GROUP_INPUT_MISSING");if(AWReplicatedGroupSetInputs(&group,group.frameNumber,keys)!=AW_REPLICATED_GROUP_OK)return reject("GROUP_INPUT_CONFLICT");enum AWReplicatedGroupResult r=AWReplicatedGroupRunFrame(&group);if(r!=AW_REPLICATED_GROUP_OK){error=AWReplicatedGroupResultName(r);return 0;}return AWReplicatedGroupDrainShadowAudio(&group,local);}
const void* awGroupVideo(unsigned*w,unsigned*h){if(!active)return NULL;struct mCore*c=group.players[local].core;c->currentVideoSize(c,w,h);return group.players[local].videoBuffer;}
size_t awGroupAudio(int16_t*out,size_t max){if(!active)return 0;struct mCore*c=group.players[local].core;size_t n=mAudioBufferAvailable(c->getAudioBuffer(c));if(n>max)n=max;return mAudioBufferRead(c->getAudioBuffer(c),out,n);}
const uint8_t* awGroupDigest(void){if(!active)return NULL;struct SHA256Context sha;sha256Init(&sha);const char domain[]="AW group v1 state consensus";sha256Update(&sha,domain,sizeof(domain));uint8_t p[8];store64(p,group.frameNumber);sha256Update(&sha,p,8);p[0]=count;sha256Update(&sha,p,1);for(unsigned i=0;i<count;++i){uint8_t h[32];if(!AWReplicatedGroupStateDigest(&group,i,h)){error="GROUP_DIGEST_FAILED";return NULL;}sha256Update(&sha,h,32);}sha256Finalize(digest,&sha);return digest;}
int awGroupStageSave(void){if(!active||stagedSaveValid)return reject("GROUP_INVALID_SAVE_STAGE");void*save=NULL;struct mCore*c=group.players[local].core;size_t n=c->savedataClone(c,&save);if(n>sizeof(stagedSave)||(n&&!save)){free(save);return reject("GROUP_SAVE_CAPACITY");}memcpy(stagedSave,verifiedSave,sizeof(stagedSave));if(n)memcpy(stagedSave,save,n);free(save);stagedFrame=group.frameNumber;stagedSaveValid=true;return 1;}
double awGroupVerifiedFrame(void){return verifiedFrame;}
void awGroupCommit(void){if(active&&stagedSaveValid){memcpy(verifiedSave,stagedSave,sizeof(verifiedSave));memcpy(retro_get_memory_data(RETRO_MEMORY_SAVE_RAM),verifiedSave,sizeof(verifiedSave));verifiedFrame=stagedFrame;stagedSaveValid=false;return;}if(active){
 void* save=NULL;struct mCore*c=group.players[local].core;size_t n=c->savedataClone(c,&save);
 if(save && n<=sizeof(verifiedSave)){memcpy(verifiedSave,save,n);memcpy(retro_get_memory_data(RETRO_MEMORY_SAVE_RAM),verifiedSave,sizeof(verifiedSave));verifiedFrame=group.frameNumber;}free(save);
}}
void awGroupStop(void){AWReplicatedGroupStop(&group);if(active){memcpy(retro_get_memory_data(RETRO_MEMORY_SAVE_RAM),verifiedSave,sizeof(verifiedSave));active=false;}for(unsigned i=0;i<4;++i)AWGroupReplicaPayloadDeinit(&payloads[i]);free(snapshot);snapshot=NULL;snapshotSize=0;}
double awGroupFrame(void){return group.frameNumber;}
unsigned awGroupProbe(unsigned player,unsigned word){if(!active||player>=count||word>64)return 0;struct mCore*c=group.players[player].core;return c->rawRead32(c,0x02000000+4*word,-1);}
