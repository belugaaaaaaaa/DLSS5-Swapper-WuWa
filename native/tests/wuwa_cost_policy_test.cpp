/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#include <bit>
#include <cstdint>
#include <iostream>

#include "../wuwa_cost_history.hpp"

// CPU execution of the ACTUAL header policy. No GPU mock or performance claim.
int main() {
  namespace wuwa = renodx::addons::dlss5::wuwa;
  uint32_t assertions = 0;
  uint32_t failures = 0;
  const auto require = [&](bool passed, const char* message) {
    ++assertions;
    if (!passed) {
      ++failures;
      std::cerr << "FAIL: " << message << '\n';
    }
  };
  const wuwa::Contract baseline{
      .source_handle = reinterpret_cast<const void*>(uintptr_t{1}),
      .epoch = 1,
      .settings_generation = 1,
      .width = 2560, .height = 1440, .motion_width = 1280, .motion_height = 720,
      .depth_width = 1280, .depth_height = 720,
      .output_format = uint32_t(DXGI_FORMAT_R16G16B16A16_FLOAT),
      .motion_format = uint32_t(DXGI_FORMAT_R16G16_FLOAT),
      .depth_format = uint32_t(DXGI_FORMAT_R32_FLOAT),
      .encoding = 2,
      .motion_scale_x = std::bit_cast<uint32_t>(1280.f),
      .motion_scale_y = std::bit_cast<uint32_t>(720.f),
      .nr_width = 2176, .nr_height = 1224,
  };
  wuwa::History history;
  int64_t now = 1'000'000'000;
  for (uint32_t base = 0; base < 8; ++base) {
    require(wuwa::RefreshDue(&history, baseline, false, now) == (base % 2 == 0),
        "exact alternating base-evaluation cadence");
    now += 16'666'667;
  }
  require(history.accepted_base_evaluations == 8, "eight base evaluations accepted");
  // FG/Present never call RefreshDue. No simulated Present hook advances it.
  require(history.accepted_base_evaluations == 8, "non-base events cannot advance policy");
  history.valid = true;
  require(wuwa::RefreshDue(&history, baseline, true, now), "game Reset restarts refresh");
  require(!history.valid && history.accepted_base_evaluations == 1,
      "game Reset invalidates history and restarts phase");
  now += 16'666'667;
  require(!wuwa::RefreshDue(&history, baseline, false, now), "post-reset next base is reuse");
  history.valid = true;
  wuwa::Invalidate(&history);
  require(!history.valid && history.accepted_base_evaluations == 2,
      "cache invalidation does not pretend a base evaluation happened");

  for (uint32_t field = 0; field < 13; ++field) {
    wuwa::Contract changed = baseline;
    switch (field) {
      case 0: changed.source_handle = reinterpret_cast<const void*>(uintptr_t{2}); break;
      case 1: ++changed.epoch; break;
      case 2: ++changed.settings_generation; break;
      case 3: ++changed.width; break;
      case 4: ++changed.motion_width; break;
      case 5: ++changed.depth_x; break;
      case 6: changed.output_format = uint32_t(DXGI_FORMAT_R8G8B8A8_UNORM); break;
      case 7: changed.motion_scale_x = std::bit_cast<uint32_t>(640.f); break;
      case 8: changed.encoding = 1; break;
      case 9: ++changed.feed; break;
      case 10: ++changed.nr_width; break;
      case 11: changed.unit_nits = std::bit_cast<uint32_t>(80.f); break;
      case 12: ++changed.control_generation; break;
    }
    history = {};
    require(wuwa::RefreshDue(&history, baseline, false, now), "baseline starts refresh");
    now += 16'666'667;
    history.valid = true;
    require(wuwa::RefreshDue(&history, changed, false, now), "contract field change forces refresh");
    require(!history.valid && history.accepted_base_evaluations == 1,
        "contract field change invalidates and restarts phase");
    now += 16'666'667;
  }

  history = {};
  require(wuwa::RefreshDue(&history, baseline, false, now), "long-gap baseline starts refresh");
  now += 100'000'001;
  require(wuwa::RefreshDue(&history, baseline, false, now), "over 100ms gap forces refresh");
  require(wuwa::RefreshDue(&history, baseline, false, now - 1), "time reversal forces refresh");

  history = {};
  require(wuwa::RefreshDue(&history, baseline, false, now), "rotation baseline starts refresh");
  // Color/output COM pointer identity is deliberately absent from Contract.
  // Rotating physical buffers retain the same stable logical SR contract.
  const wuwa::Contract rotating_output_contract = baseline;
  require(!wuwa::RefreshDue(&history, rotating_output_contract, false, now + 16'666'667),
      "rotating physical outputs preserve logical-stream cadence");

  history.width = baseline.width;
  history.height = baseline.height;
  const uint64_t phase = history.accepted_base_evaluations;
  const int64_t last_ns = history.last_base_evaluate_ns;
  const uint64_t stream_id = history.timing_stream_id;
  history.admission.cooldown = 120;
  history.admission.cooldown_level = 2;
  wuwa::RetireStoragePreservingContract(&history);
  require(history.width == 0 && history.height == 0 && !history.valid,
      "storage retirement clears allocation and validity");
  require(history.contract == baseline && history.contract_valid,
      "storage retirement preserves target geometry and full contract");
  require(history.accepted_base_evaluations == phase && history.last_base_evaluate_ns == last_ns,
      "storage retirement preserves exact phase and last base timestamp");
  require(history.timing_stream_id == stream_id && history.admission.cooldown == 120
              && history.admission.cooldown_level == 2,
      "storage retirement preserves logical timing nonce and readiness policy");
  require(wuwa::RefreshDue(&history, baseline, false, last_ns + 100'000'001),
      "cooldown recovery after long gap starts with fresh capture");
  require(history.admission.cooldown_level == 2,
      "long-gap cache invalidation retains readiness failure escalation");
  auto changed = baseline;
  ++changed.settings_generation;
  require(wuwa::RefreshDue(&history, changed, false, last_ns + 116'666'668),
      "settings change resets freshness even after cooldown");
  require(history.admission.cooldown == 0 && history.admission.cooldown_level == 0,
      "settings change clears stale budget and readiness admission state");
  history.admission.cooldown = 120;
  require(wuwa::RefreshDue(&history, changed, true, last_ns + 133'333'335)
              && history.admission.cooldown == 0,
      "GameReset clears readiness and budget admission state");
  wuwa::Retire(&history);
  require(!history.contract_valid && history.accepted_base_evaluations == 0
              && history.last_base_evaluate_ns == 0,
      "stream retirement clears phase, timestamp and contract");
  require(history.timing_stream_id != stream_id,
      "new stream nonce rejects completed samples from reused handle identity");
  std::cout << "wuwa_cost_policy: " << assertions << " assertions, " << failures << " failures\n";
  return failures ? 1 : 0;
}
