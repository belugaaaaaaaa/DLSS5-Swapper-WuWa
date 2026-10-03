/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace renodx::addons::dlss5::wuwa {

// This adapts cache admission, never turns NR off. Unsupported/pending cache
// always falls back to the normal full NR result on the same base evaluation.
struct Admission {
  uint32_t consecutive_misses = 0, cooldown = 0;
  uint32_t cooldown_level = 0;
  uint64_t last_timing_sample = 0;
  double fresh_us = 0.0, reuse_us = 0.0;
  uint32_t fresh_samples = 0, reuse_samples = 0;
};
constexpr uint32_t kMissLimit = 3;
constexpr uint32_t kProbeInterval = 120;
constexpr uint32_t kMaxProbeInterval = 960;

inline bool AdmitCache(Admission* admission) {
  if (admission->cooldown == 0) return true;
  --admission->cooldown;
  return false;
}
inline void CacheMiss(Admission* admission) {
  if (++admission->consecutive_misses >= kMissLimit) {
    admission->cooldown = std::min(kMaxProbeInterval,
        kProbeInterval << std::min(admission->cooldown_level, 3u));
    admission->cooldown_level = std::min(admission->cooldown_level + 1, 3u);
    admission->consecutive_misses = 0;
  }
}
inline void CacheHit(Admission* admission) {
  admission->consecutive_misses = 0;
  admission->cooldown_level = 0;
}
// Only completed, source/epoch-tagged GPU samples may enter this policy.
// The two-base-frame candidate is fresh(NR+capture) + reuse. If reuse costs
// >= 80% of a fresh frame, use every-frame NR for a bounded recovery window.
// No guesses about FPS, Present count, CPU evaluate duration or future queues.
inline bool ObserveBudget(Admission* admission, uint64_t sample, double total_us, bool reused) {
  if (sample == 0 || sample == admission->last_timing_sample
      || !std::isfinite(total_us) || total_us <= 0.0) return false;
  admission->last_timing_sample = sample;
  double* average = reused ? &admission->reuse_us : &admission->fresh_us;
  uint32_t* count = reused ? &admission->reuse_samples : &admission->fresh_samples;
  *average = *count == 0 ? total_us : *average * 0.875 + total_us * 0.125;
  *count = std::min(*count + 1, 1000u);
  if (admission->fresh_samples < 4 || admission->reuse_samples < 4
      || admission->reuse_us < admission->fresh_us * 0.8) return false;
  admission->cooldown = kProbeInterval;
  admission->fresh_samples = admission->reuse_samples = 0;
  return true;
}
}  // namespace renodx::addons::dlss5::wuwa
