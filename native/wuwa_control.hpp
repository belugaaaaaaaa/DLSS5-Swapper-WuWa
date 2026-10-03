/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#pragma once

#include <array>
#include <atomic>
#include <cstring>
#include <mutex>

#include "wuwa_control_api.h"

namespace renodx::addons::dlss5::wuwa::control {

// Exported calls never enter the NGX/runtime mutex. Commands are consumed by
// the existing lifecycle owner; only that owner publishes snapshots.
constexpr size_t kQueueCapacity = 16;
constexpr size_t kStateWords = sizeof(WuWaControlState) / sizeof(uint64_t);
static_assert(sizeof(WuWaControlState) % sizeof(uint64_t) == 0);
inline std::array<std::atomic_uint64_t, kStateWords> published_words{};
inline std::atomic_uint64_t sequence{0};
inline std::atomic_bool process_allowed{false};
inline std::mutex queue_mutex;
inline std::array<WuWaControlCommand, kQueueCapacity> queue{};
inline size_t queue_start = 0, queue_size = 0;
// These acknowledgements are owned by the lifecycle thread under runtime_mutex.
inline uint64_t last_received = 0, last_completed = 0;
inline uint32_t last_control = 0;
inline int32_t last_result = WUWA_CONTROL_OK;
inline std::atomic_uint32_t cost_mode{1};
inline std::atomic_uint64_t policy_generation{1};
inline std::atomic_uint32_t driver_x100{0}, minimum_driver_x100{0};
inline std::atomic_uint64_t last_nr_success_ms{0}, last_cache_recorded_ms{0};
inline std::atomic_uint32_t last_decline{0};
inline std::atomic_bool cache_qualified{false};

enum Decline : uint32_t {
  kNone = 0, kUnsupportedContract = 1, kPendingHistory = 2,
  kCacheResources = 3, kNoValidHistory = 4, kBackoff = 5, kBudget = 6,
  kStabilizing = 7,
};

inline int32_t Queue(uint32_t abi, uint32_t size, const WuWaControlCommand* command) {
  if (abi != WUWA_CONTROL_ABI_VERSION) return WUWA_CONTROL_ERROR_VERSION;
  if (command == nullptr || size != sizeof(WuWaControlCommand)) return WUWA_CONTROL_ERROR_SIZE;
  if (command->abi_version != abi) return WUWA_CONTROL_ERROR_VERSION;
  if (command->struct_size != size) return WUWA_CONTROL_ERROR_SIZE;
  if (!process_allowed.load(std::memory_order_acquire)) return WUWA_CONTROL_ERROR_PROCESS;
  const bool quality = command->value == 50 || command->value == 67
      || command->value == 75 || command->value == 85 || command->value == 100;
  if (command->request_id == 0
      || (command->control_id != WUWA_CONTROL_NR_ENABLED
          && command->control_id != WUWA_CONTROL_COST_MODE
          && command->control_id != WUWA_CONTROL_QUALITY_PERCENT)
      || (command->control_id == WUWA_CONTROL_QUALITY_PERCENT ? !quality : command->value > 1)) {
    return WUWA_CONTROL_ERROR_COMMAND;
  }
  std::unique_lock lock(queue_mutex, std::try_to_lock);
  if (!lock.owns_lock() || queue_size == kQueueCapacity) return WUWA_CONTROL_ERROR_BUSY;
  queue[(queue_start + queue_size++) % kQueueCapacity] = *command;
  return WUWA_CONTROL_QUEUED;
}

inline bool Pop(WuWaControlCommand* command) {
  std::scoped_lock lock(queue_mutex);
  if (queue_size == 0) return false;
  *command = queue[queue_start];
  queue_start = (queue_start + 1) % kQueueCapacity;
  --queue_size;
  last_received = command->request_id;
  return true;
}

inline void Publish(const WuWaControlState& snapshot) {
  auto state = snapshot;
  const uint64_t odd = sequence.fetch_add(1, std::memory_order_seq_cst) + 1;
  state.struct_size = sizeof(state);
  state.abi_version = WUWA_CONTROL_ABI_VERSION;
  state.publish_sequence = odd + 1;
  state.last_received_request_id = last_received;
  state.last_completed_request_id = last_completed;
  state.last_command_control_id = last_control;
  state.last_command_result = last_result;
  std::array<uint64_t, kStateWords> words{};
  std::memcpy(words.data(), &state, sizeof(state));
  for (size_t index = 0; index < kStateWords; ++index) {
    published_words[index].store(words[index], std::memory_order_seq_cst);
  }
  sequence.store(odd + 1, std::memory_order_seq_cst);
}

inline int32_t Get(uint32_t abi, uint32_t size, WuWaControlState* state) {
  if (abi != WUWA_CONTROL_ABI_VERSION) return WUWA_CONTROL_ERROR_VERSION;
  if (state == nullptr || size != sizeof(WuWaControlState)) return WUWA_CONTROL_ERROR_SIZE;
  for (uint32_t attempt = 0; attempt < 8; ++attempt) {
    const uint64_t before = sequence.load(std::memory_order_seq_cst);
    if (before == 0 || (before & 1)) continue;
    std::array<uint64_t, kStateWords> words{};
    for (size_t index = 0; index < kStateWords; ++index) {
      words[index] = published_words[index].load(std::memory_order_seq_cst);
    }
    // All words and the sequence share the C++ sequentially consistent order;
    // seeing any newer word forces this check to observe the writer's sequence.
    if (sequence.load(std::memory_order_seq_cst) != before) continue;
    std::memcpy(state, words.data(), sizeof(*state));
    return WUWA_CONTROL_OK;
  }
  return WUWA_CONTROL_ERROR_BUSY;
}
}  // namespace renodx::addons::dlss5::wuwa::control
