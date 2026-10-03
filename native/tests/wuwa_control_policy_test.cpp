/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#include <atomic>
#include <cstdio>
#include <limits>
#include <thread>
#include <vector>

#include "../wuwa_control.hpp"
#include "../wuwa_cost_policy.hpp"

namespace {
namespace control = renodx::addons::dlss5::wuwa::control;
namespace wuwa = renodx::addons::dlss5::wuwa;
int assertions = 0, failures = 0;
void Check(bool condition, const char* description) {
  ++assertions;
  if (!condition) {
    ++failures;
    std::printf("FAIL: %s\n", description);
  }
}
WuWaControlCommand Command(uint64_t request, uint32_t id, uint32_t value) {
  return {.struct_size = sizeof(WuWaControlCommand), .abi_version = WUWA_CONTROL_ABI_VERSION,
          .request_id = request, .control_id = id, .value = value};
}
void TestTransport() {
  WuWaControlState snapshot{};
  auto command = Command(1, WUWA_CONTROL_NR_ENABLED, 1);
  Check(control::Get(2, sizeof(snapshot), &snapshot) == WUWA_CONTROL_ERROR_VERSION, "get version rejected");
  Check(control::Get(1, 344, &snapshot) == WUWA_CONTROL_ERROR_SIZE, "old 344-byte size rejected");
  Check(control::Get(1, sizeof(snapshot), nullptr) == WUWA_CONTROL_ERROR_SIZE, "null getter rejected");
  Check(control::Get(1, sizeof(snapshot), &snapshot) == WUWA_CONTROL_ERROR_BUSY, "unpublished snapshot unavailable");
  Check(control::Queue(1, sizeof(command), &command) == WUWA_CONTROL_ERROR_PROCESS, "other process cannot queue");
  control::process_allowed = true;
  Check(control::Queue(2, sizeof(command), &command) == WUWA_CONTROL_ERROR_VERSION, "setter version rejected");
  Check(control::Queue(1, sizeof(command) - 1, &command) == WUWA_CONTROL_ERROR_SIZE, "setter outer size rejected");
  command.abi_version = 2;
  Check(control::Queue(1, sizeof(command), &command) == WUWA_CONTROL_ERROR_VERSION, "setter embedded version rejected");
  command = Command(1, WUWA_CONTROL_QUALITY_PERCENT, 84);
  Check(control::Queue(1, sizeof(command), &command) == WUWA_CONTROL_ERROR_COMMAND, "unsupported quality rejected");
  command = Command(0, WUWA_CONTROL_NR_ENABLED, 1);
  Check(control::Queue(1, sizeof(command), &command) == WUWA_CONTROL_ERROR_COMMAND, "zero request rejected");
  command = Command(1, 99, 0);
  Check(control::Queue(1, sizeof(command), &command) == WUWA_CONTROL_ERROR_COMMAND, "unknown control rejected");
  command = Command(1, WUWA_CONTROL_COST_MODE, 2);
  Check(control::Queue(1, sizeof(command), &command) == WUWA_CONTROL_ERROR_COMMAND, "unknown mode rejected");
  for (uint32_t index = 0; index < control::kQueueCapacity; ++index) {
    command = Command(index + 1, WUWA_CONTROL_NR_ENABLED, index & 1);
    Check(control::Queue(1, sizeof(command), &command) == WUWA_CONTROL_QUEUED, "bounded FIFO accepts command");
  }
  Check(control::last_completed == 0, "queued is not applied");
  Check(control::Queue(1, sizeof(command), &command) == WUWA_CONTROL_ERROR_BUSY, "queue overflow rejected");
  for (uint32_t index = 0; index < control::kQueueCapacity; ++index) {
    Check(control::Pop(&command) && command.request_id == index + 1, "FIFO command order retained");
  }
  Check(!control::Pop(&command), "empty queue does not invent command");
  control::last_completed = 16;
  control::last_control = WUWA_CONTROL_NR_ENABLED;
  control::last_result = WUWA_CONTROL_APPLIED;
  snapshot.nr_enabled = 1;
  snapshot.quality_percent = 85;
  control::Publish(snapshot);
  Check(control::Get(1, sizeof(snapshot), &snapshot) == WUWA_CONTROL_OK, "published getter succeeds");
  Check(snapshot.struct_size == 376 && snapshot.abi_version == 1, "ABI layout tagged");
  Check(snapshot.last_received_request_id == 16 && snapshot.last_completed_request_id == 16
      && snapshot.last_command_result == WUWA_CONTROL_APPLIED && snapshot.nr_enabled == 1,
      "acknowledgement and readback coherent");
  std::atomic_bool done{false};
  std::atomic_uint64_t good_reads{0}, torn_reads{0};
  std::vector<std::thread> readers;
  for (uint32_t index = 0; index < 3; ++index) {
    readers.emplace_back([&] {
      do {
        WuWaControlState state{};
        if (control::Get(1, sizeof(state), &state) == WUWA_CONTROL_OK && state.nr_successes != 0) {
          ++good_reads;
          if (state.cache_reprojects != state.nr_successes * 3
              || state.gpu_timing_sample_count != state.nr_successes * 7
              || state.gpu_total_ms != double(state.nr_successes)
              || (state.publish_sequence & 1)) ++torn_reads;
        }
      } while (!done.load());
    });
  }
  for (uint64_t index = 1; index <= 100'000; ++index) {
    snapshot.nr_successes = index;
    snapshot.cache_reprojects = index * 3;
    snapshot.gpu_timing_sample_count = index * 7;
    snapshot.gpu_total_ms = double(index);
    control::Publish(snapshot);
  }
  done = true;
  for (auto& reader : readers) reader.join();
  Check(good_reads != 0, "stress obtains accepted snapshots");
  Check(torn_reads == 0, "100000 publishes / 3 readers have no torn POD snapshot");
  std::printf("coherent snapshot stress: %llu accepted reads, %llu torn reads\n",
      static_cast<unsigned long long>(good_reads.load()), static_cast<unsigned long long>(torn_reads.load()));
}
void TestReadinessPolicy() {
  wuwa::Admission admission{};
  Check(wuwa::AdmitCache(&admission), "cache initially admitted");
  wuwa::CacheMiss(&admission);
  wuwa::CacheMiss(&admission);
  Check(admission.cooldown == 0, "two misses do not prematurely back off");
  wuwa::CacheMiss(&admission);
  Check(admission.cooldown == 120, "three failures trigger 120-base-eval cooldown");
  uint32_t skipped = 0;
  while (!wuwa::AdmitCache(&admission)) ++skipped;
  Check(skipped == 120, "no cache admission during exact cooldown");
  for (uint32_t stage = 1; stage <= 4; ++stage) {
    for (uint32_t miss = 0; miss < 3; ++miss) wuwa::CacheMiss(&admission);
    Check(admission.cooldown == (stage < 3 ? 120u << stage : 960u), "persistent failure interval expands and caps");
    while (!wuwa::AdmitCache(&admission)) {}
  }
  wuwa::CacheHit(&admission);
  Check(admission.cooldown_level == 0 && admission.consecutive_misses == 0, "actual reuse restores initial probe rate");
  for (uint32_t miss = 0; miss < 3; ++miss) wuwa::CacheMiss(&admission);
  Check(admission.cooldown == 120, "after a real hit subsequent failures start fresh");
}
void TestCompletedBudget() {
  wuwa::Admission admission{};
  Check(!wuwa::ObserveBudget(&admission, 0, 100.0, false), "unidentified GPU sample rejected");
  Check(!wuwa::ObserveBudget(&admission, 1, std::numeric_limits<double>::quiet_NaN(), false), "NaN timing rejected");
  Check(!wuwa::ObserveBudget(&admission, 1, 0.0, false), "zero timing rejected");
  Check(!wuwa::ObserveBudget(&admission, 1, 100.0, false), "one fresh sample is insufficient");
  Check(!wuwa::ObserveBudget(&admission, 1, 10000.0, false) && admission.fresh_samples == 1,
      "duplicate completed sample is not counted twice");
  for (uint64_t sample = 2; sample <= 4; ++sample) wuwa::ObserveBudget(&admission, sample, 100.0, false);
  for (uint64_t sample = 5; sample <= 7; ++sample) {
    Check(!wuwa::ObserveBudget(&admission, sample, 90.0, true), "fewer than four reuse samples cannot change cadence");
  }
  Check(wuwa::ObserveBudget(&admission, 8, 90.0, true) && admission.cooldown == 120,
      "expensive cache requests bounded every-frame-NR recovery window");
  admission = {};
  for (uint64_t sample = 1; sample <= 8; ++sample) {
    Check(!wuwa::ObserveBudget(&admission, sample, sample <= 4 ? 1000.0 : 300.0, sample > 4),
        "cheap completed cache retains interval-two candidate");
  }
  Check(admission.cooldown == 0 && admission.fresh_samples == 4 && admission.reuse_samples == 4,
      "successful inexpensive cache does not silently disable NR or change quality");
}
}  // namespace

int main() {
  TestTransport();
  TestReadinessPolicy();
  TestCompletedBudget();
  std::printf("wuwa_control_policy: %d assertions, %d failures\n", assertions, failures);
  return failures == 0 ? 0 : 1;
}
