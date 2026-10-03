/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#ifndef RENODX_WUWA_CONTROL_API_H
#define RENODX_WUWA_CONTROL_API_H

#include <stddef.h>
#include <stdint.h>

/* Plain C ABI: no C++ objects, virtual calls, struct returns, or private offsets. */
#if defined(_WIN32)
#define WUWA_CONTROL_CALL __cdecl
#else
#define WUWA_CONTROL_CALL
#endif

#define WUWA_CONTROL_ABI_VERSION 1u
#define WUWA_GET_STATE_EXPORT "RenoDX_WuWa_GetState"
#define WUWA_SET_CONTROL_EXPORT "RenoDX_WuWa_SetControl"

enum WuWaControlResult {
  WUWA_CONTROL_OK = 0,
  WUWA_CONTROL_QUEUED = 1,
  WUWA_CONTROL_APPLIED = 2,
  WUWA_CONTROL_ERROR_VERSION = -1,
  WUWA_CONTROL_ERROR_SIZE = -2,
  WUWA_CONTROL_ERROR_COMMAND = -3,
  WUWA_CONTROL_ERROR_BUSY = -4,
  WUWA_CONTROL_ERROR_PROCESS = -5,
  WUWA_CONTROL_ERROR_INTERNAL = -6
};

enum WuWaControlId {
  WUWA_CONTROL_NR_ENABLED = 1, /* value 0 or 1 */
  WUWA_CONTROL_COST_MODE = 2, /* 0: every-frame NR; 1: interval-two guarded cache */
  WUWA_CONTROL_QUALITY_PERCENT = 3 /* value 50, 67, 75, 85, or 100 */
};

#pragma pack(push, 8)
typedef struct WuWaControlCommand {
  uint32_t struct_size;
  uint32_t abi_version;
  uint64_t request_id;
  uint32_t control_id;
  uint32_t value;
} WuWaControlCommand;

typedef struct WuWaControlState {
  uint32_t struct_size;
  uint32_t abi_version;
  uint64_t publish_sequence;
  uint64_t last_received_request_id;
  uint64_t last_completed_request_id;
  int32_t last_command_result;
  uint32_t last_command_control_id;
  uint32_t nr_enabled;
  uint32_t cost_mode;
  uint32_t quality_percent;
  uint32_t nr_runtime_ready;
  uint32_t driver_x100;
  uint32_t minimum_driver_x100;
  uint32_t driver_requirement_known;
  uint32_t process_allowed;
  uint32_t cache_contract_qualified;
  uint32_t last_decline_code;
  uint32_t nr_runtime_fault;
  uint32_t reserved0;
  uint64_t eligible_base_evaluations;
  uint64_t nr_successes;
  uint64_t cache_refreshes;
  uint64_t cache_reprojects;
  uint64_t fresh_fallbacks;
  uint64_t invalidations;
  uint64_t nr_last_success_ms;
  uint64_t cache_last_recorded_ms;
  /* UTF-8, NUL-terminated. Counts describe accepted/recorded work, not GPU fences. */
  char status_detail[192];
  /* Completed timestamp-query total only; unavailable until a real sample is read. */
  uint32_t gpu_timing_available;
  uint32_t gpu_timing_reserved;
  double gpu_total_ms;
  uint64_t gpu_timing_sample_ms;
  uint64_t gpu_timing_sample_count;
} WuWaControlState;
#pragma pack(pop)

/* GetState copies a coherent, read-only published snapshot; OK does not mean NR ran. */
typedef int32_t(WUWA_CONTROL_CALL* WuWaGetStateFn)(
    uint32_t abi_version, uint32_t state_size, WuWaControlState* state);
/* QUEUED is only an acknowledgement; inspect matching completed request + readback. */
typedef int32_t(WUWA_CONTROL_CALL* WuWaSetControlFn)(
    uint32_t abi_version, uint32_t command_size, const WuWaControlCommand* command);

#if defined(__cplusplus)
static_assert(sizeof(WuWaControlCommand) == 24);
static_assert(sizeof(WuWaControlState) == 376);
static_assert(offsetof(WuWaControlState, eligible_base_evaluations) == 88);
static_assert(offsetof(WuWaControlState, status_detail) == 152);
static_assert(offsetof(WuWaControlState, gpu_total_ms) == 352);
#endif

#endif
