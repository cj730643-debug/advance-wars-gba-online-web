// Copyright 2026 Advance Wars GBA Online contributors. MPL-2.0.
// Browser host adapter; core CPU, serial timing and synchronization are retained.
#include "bridge.hpp"
#include <emscripten.h>
#include <cstdarg>
#include <cstdio>
#include <string>
#include <map>
static aw::Bridge bridge;
static bool loaded=false, ready=false, failed=false;
static unsigned pixel=0;
static double sampleRate=32768;
static std::vector<uint8_t> rom;
static std::vector<uint32_t> rgba;
static std::map<std::string,std::string> variables;
EM_JS(void,notice,(const char* p,int error),{Module.frontend?.notice?.(UTF8ToString(p),!!error);});
EM_JS(int,keys,(),{return Module.frontend?.keys||0;});
EM_JS(int,stopped,(),{return Module.frontend?.terminal?1:0;});
EM_JS(int,sendPacket,(const uint8_t* p,int n),{return Module.frontend?.send?.(HEAPU8.slice(p,p+n))?1:0;});
EM_JS(int,nextSize,(),{return Module.frontend?.incoming?.[0]?.length||0;});
EM_JS(void,takePacket,(uint8_t* p,int n),{const b=Module.frontend.incoming.shift();HEAPU8.set(b,p);});
EM_JS(void,videoJs,(const uint32_t* p,int w,int h),{Module.frontend?.video?.(HEAPU8.slice(p,p+w*h*4),w,h);});
EM_JS(void,audioJs,(const int16_t* p,int n,double rate),{Module.frontend?.audio?.(HEAP16.slice(p>>1,(p>>1)+n*2),rate);});
static void pump(){
 if(stopped()){bridge.fail("SESSION_STOPPED");return;}
 bool got=false;
 for(int i=0;i<64;++i){int n=nextSize();if(!n)break;if(n<=12||n>65548){bridge.fail("BAD_PACKET");return;}std::vector<uint8_t>b(n);takePacket(b.data(),n);bridge.receive(b);got=true;if(bridge.terminal)break;}
 if(!got&&!bridge.terminal)emscripten_sleep(1);
 if(stopped())bridge.fail("SESSION_STOPPED");
}
static void inspect(const char* msg,bool error=false){
 if(std::strstr(msg,"ready: player"))ready=true;
 if(std::strstr(msg,"failure schema="))failed=true;
 if(error&&std::strstr(msg,"GBA Wi-Fi Link"))failed=true;
 if(error||std::strstr(msg,"GBA Wi-Fi Link"))notice(msg,error||failed);
}
static void RETRO_CALLCONV logCore(enum retro_log_level level,const char* fmt,...){char b[4096];va_list ap;va_start(ap,fmt);vsnprintf(b,sizeof(b),fmt,ap);va_end(ap);inspect(b,level>=RETRO_LOG_ERROR);}
static bool RETRO_CALLCONV environment(unsigned cmd,void* data){
 switch(cmd){
 case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:static_cast<retro_log_callback*>(data)->log=logCore;return true;
 case RETRO_ENVIRONMENT_SET_NETPACKET_INTERFACE:bridge.core=*static_cast<retro_netpacket_callback*>(data);return true;
 case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:pixel=*static_cast<unsigned*>(data);return pixel<=2;
 case RETRO_ENVIRONMENT_GET_CAN_DUPE:*static_cast<bool*>(data)=true;return true;
 case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:*static_cast<const char**>(data)="/";return true;
 case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:*static_cast<unsigned*>(data)=0;return true;
 case RETRO_ENVIRONMENT_SET_VARIABLES:{auto* v=static_cast<retro_variable*>(data);for(;v&&v->key;++v){std::string s=v->value?v->value:"";auto pos=s.find("; ");if(pos!=std::string::npos)s=s.substr(pos+2);pos=s.find('|');variables[v->key]=s.substr(0,pos);}return true;}
 case RETRO_ENVIRONMENT_GET_VARIABLE:{auto*v=static_cast<retro_variable*>(data);std::string k=v->key?v->key:"";if(k=="mgba_use_bios")v->value="OFF";else if(k=="mgba_skip_bios")v->value="ON";else if(k=="mgba_link_netplay_network")v->value="internet";else {auto i=variables.find(k);v->value=i==variables.end()?nullptr:i->second.c_str();}return v->value!=nullptr;}
 case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:*static_cast<bool*>(data)=false;return true;
 case RETRO_ENVIRONMENT_GET_MESSAGE_INTERFACE_VERSION:*static_cast<unsigned*>(data)=1;return true;
 case RETRO_ENVIRONMENT_SET_MESSAGE:inspect(static_cast<retro_message*>(data)->msg);return true;
 case RETRO_ENVIRONMENT_SET_MESSAGE_EXT:{auto*m=static_cast<retro_message_ext*>(data);inspect(m->msg,m->level>=RETRO_LOG_ERROR);return true;}
 case RETRO_ENVIRONMENT_SET_SUPPORT_ACHIEVEMENTS:case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:return true;
 case RETRO_ENVIRONMENT_SHUTDOWN:failed=true;return true;
 default:return false;
 }
}
static void RETRO_CALLCONV video(const void* data,unsigned w,unsigned h,size_t pitch){
 if(!data||data==RETRO_HW_FRAME_BUFFER_VALID||w>512||h>512)return;
 rgba.resize(w*h);
 for(unsigned y=0;y<h;++y)for(unsigned x=0;x<w;++x){unsigned r,g,b;if(pixel==RETRO_PIXEL_FORMAT_XRGB8888){auto v=*reinterpret_cast<const uint32_t*>(static_cast<const uint8_t*>(data)+y*pitch+x*4);r=v>>16&255;g=v>>8&255;b=v&255;}else{auto v=*reinterpret_cast<const uint16_t*>(static_cast<const uint8_t*>(data)+y*pitch+x*2);r=(v>>(pixel==RETRO_PIXEL_FORMAT_RGB565?11:10)&31)*255/31;g=(v>>5&(pixel==RETRO_PIXEL_FORMAT_RGB565?63:31))*255/(pixel==RETRO_PIXEL_FORMAT_RGB565?63:31);b=(v&31)*255/31;}rgba[y*w+x]=0xff000000|(b<<16)|(g<<8)|r;}
 videoJs(rgba.data(),w,h);
}
static size_t RETRO_CALLCONV audioBatch(const int16_t* p,size_t frames){if(frames&&frames<=8192)audioJs(p,frames,sampleRate);return frames;}
static void RETRO_CALLCONV audio(int16_t l,int16_t r){int16_t p[]={l,r};audioBatch(p,1);}
static void RETRO_CALLCONV pollInput(){}
static int16_t RETRO_CALLCONV input(unsigned port,unsigned device,unsigned,unsigned id){return port==0&&device==RETRO_DEVICE_JOYPAD&&id<16?!!(keys()&(1<<id)):0;}
extern "C" {
EMSCRIPTEN_KEEPALIVE int aw_load(const uint8_t* p,size_t n){
 if(loaded||n<192||n>32*1024*1024||p[0xb2]!=0x96)return 0;
 rom.assign(p,p+n);bridge.transmit=[](auto&b){return !!sendPacket(b.data(),b.size());};bridge.pump=pump;bridge.onFailure=[](const char*r){failed=true;notice(r,1);};
 retro_set_environment(environment);retro_set_video_refresh(video);retro_set_audio_sample(audio);retro_set_audio_sample_batch(audioBatch);retro_set_input_poll(pollInput);retro_set_input_state(input);retro_init();
 if(retro_api_version()!=1)return 0;retro_game_info info{};info.data=rom.data();info.size=rom.size();loaded=retro_load_game(&info);
 if(loaded){retro_system_av_info av{};retro_get_system_av_info(&av);if(av.timing.sample_rate>=8000&&av.timing.sample_rate<=192000)sampleRate=av.timing.sample_rate;}return loaded;
}
EMSCRIPTEN_KEEPALIVE int aw_link(unsigned role){return loaded&&!failed&&role<=1&&bridge.start(role);}
EMSCRIPTEN_KEEPALIVE int aw_run(){if(!loaded||failed||stopped()||bridge.terminal)return 0;if(bridge.active){pump();bridge.tick();}if(failed||stopped()||bridge.terminal)return 0;retro_run();return !failed&&!stopped()&&!bridge.terminal;}
EMSCRIPTEN_KEEPALIVE void aw_stop(){bridge.stop();}
EMSCRIPTEN_KEEPALIVE size_t aw_save_size(){return loaded?retro_get_memory_size(RETRO_MEMORY_SAVE_RAM):0;}
EMSCRIPTEN_KEEPALIVE void* aw_save_data(){return loaded?retro_get_memory_data(RETRO_MEMORY_SAVE_RAM):nullptr;}
EMSCRIPTEN_KEEPALIVE int aw_import_save(const uint8_t*p,size_t n){auto* d=aw_save_data();if(!d||bridge.active||n!=aw_save_size())return 0;std::memcpy(d,p,n);return 1;}
EMSCRIPTEN_KEEPALIVE int aw_ready(){return ready;}
EMSCRIPTEN_KEEPALIVE double aw_state_sent(){return bridge.stateChecksSent;}
EMSCRIPTEN_KEEPALIVE double aw_state_received(){return bridge.stateChecksReceived;}
EMSCRIPTEN_KEEPALIVE int aw_terminal(){return failed||bridge.terminal;}
EMSCRIPTEN_KEEPALIVE double aw_sample_rate(){return sampleRate;}
}
