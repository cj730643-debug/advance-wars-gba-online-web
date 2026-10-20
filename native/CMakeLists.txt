cmake_minimum_required(VERSION 3.21)
project(aw_web LANGUAGES C CXX)
if(NOT EMSCRIPTEN)
 message(FATAL_ERROR "Use the Emscripten toolchain")
endif()
set(CMAKE_CXX_STANDARD 17)
set(BUILD_LIBRETRO ON CACHE BOOL "" FORCE)
set(SKIP_LIBRARY ON CACHE BOOL "" FORCE)
foreach(opt BUILD_TEST BUILD_SUITE USE_PTHREADS BUILD_QT BUILD_SDL BUILD_CINEMA BUILD_HEADLESS BUILD_EXAMPLE BUILD_GL BUILD_GLES2 BUILD_GLES3 USE_EPOXY USE_ZLIB USE_MINIZIP USE_PNG USE_LIBZIP USE_SQLITE3 USE_LZMA USE_JSON_C USE_FREETYPE USE_FFMPEG USE_ELF USE_LUA ENABLE_SCRIPTING USE_DISCORD_RPC)
 set(${opt} OFF CACHE BOOL "" FORCE)
endforeach()
set(HAVE_PTHREAD_H FALSE CACHE INTERNAL "Single Worker host" FORCE)
add_subdirectory("${MGBA_SOURCE_DIR}" core)
target_compile_definitions(mgba_libretro PRIVATE _POSIX_C_SOURCE=200809L _GNU_SOURCE)
add_executable(aw-core core-host.cpp)
target_include_directories(aw-core PRIVATE "${MGBA_SOURCE_DIR}/src/platform/libretro")
target_link_libraries(aw-core PRIVATE mgba_libretro)
target_compile_options(aw-core PRIVATE -O2)
set_target_properties(aw-core PROPERTIES SUFFIX .mjs)
target_link_options(aw-core PRIVATE -O2 --no-entry
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createAwCore
 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1
 -sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=536870912
 -sSTACK_SIZE=1048576 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=131072
 -sFORCE_FILESYSTEM=1 -sASSERTIONS=1
 "-sEXPORTED_RUNTIME_METHODS=['ccall']"
 "-sEXPORTED_FUNCTIONS=['_malloc','_free','_aw_load','_aw_link','_aw_run','_aw_stop','_aw_save_size','_aw_save_data','_aw_import_save','_aw_ready','_aw_state_sent','_aw_state_received','_aw_terminal','_aw_sample_rate']")
