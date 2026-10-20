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
target_compile_definitions(mgba_libretro PRIVATE _POSIX_C_SOURCE=200809L _GNU_SOURCE AW_WEB_GROUP_HOST)
add_executable(aw-core core-host.cpp group/group-host.c group/group-replica.c group/replicated-group.c group/group-input-sync.c)
target_compile_definitions(aw-core PRIVATE __LIBRETRO__ COLOR_16_BIT COLOR_5_6_5 DISABLE_THREADING MGBA_STANDALONE ENABLE_VFS MINIMAL_CORE=2 _POSIX_C_SOURCE=200809L _GNU_SOURCE)
target_include_directories(aw-core PRIVATE "${MGBA_SOURCE_DIR}/src/platform/libretro" "${MGBA_SOURCE_DIR}/include" "${CMAKE_BINARY_DIR}/core/include" "${MGBA_SOURCE_DIR}/src")
target_link_libraries(aw-core PRIVATE mgba_libretro)
target_compile_options(aw-core PRIVATE -O2)
set_target_properties(aw-core PROPERTIES SUFFIX .mjs)
target_link_options(aw-core PRIVATE -O2 --no-entry
 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createAwCore
 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1
 -sINITIAL_MEMORY=134217728 -sMAXIMUM_MEMORY=536870912
 -sSTACK_SIZE=1048576 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=131072
 -sFORCE_FILESYSTEM=1 -sASSERTIONS=1
 "-sEXPORTED_RUNTIME_METHODS=['ccall','UTF8ToString']"
 "-sEXPORTED_FUNCTIONS=['_malloc','_free','_aw_load','_aw_link','_aw_run','_aw_stop','_aw_save_size','_aw_save_data','_aw_import_save','_aw_ready','_aw_state_sent','_aw_state_received','_aw_terminal','_aw_sample_rate','_aw_group_capture','_aw_group_snapshot_ptr','_aw_group_snapshot_size','_aw_group_receive_snapshot','_aw_group_install','_aw_group_seed','_aw_group_author','_aw_group_input_ptr','_aw_group_input_size','_aw_group_feed_input','_aw_group_frame_ready','_aw_group_run','_aw_group_digest','_aw_group_commit','_aw_group_stop','_aw_group_frame','_aw_group_probe','_aw_group_error']")
