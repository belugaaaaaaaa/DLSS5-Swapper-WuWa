/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#pragma once

#include <Windows.h>
#include <cwchar>

// The public build generates this macro from an explicitly selected canonical
// game executable. An unconfigured build must never enable cost controls.
#ifndef WUWA_TARGET_EXE_W
#define WUWA_TARGET_EXE_W L""
#endif

namespace renodx::addons::dlss5 {
inline bool IsWuWaCostProcess() {
  static const bool matches = [] {
    constexpr const wchar_t* target = WUWA_TARGET_EXE_W;
    const size_t target_length = std::wcslen(target);
    if (target_length == 0 || target_length >= MAX_PATH) return false;
    const bool drive_absolute = target_length >= 3
        && ((target[0] >= L'A' && target[0] <= L'Z') || (target[0] >= L'a' && target[0] <= L'z'))
        && target[1] == L':' && (target[2] == L'\\' || target[2] == L'/');
    const bool unc_absolute = target_length >= 5 && target[0] == L'\\' && target[1] == L'\\';
    if (!drive_absolute && !unc_absolute) return false;
    wchar_t expected[MAX_PATH]{};
    const DWORD expected_length = GetFullPathNameW(target, MAX_PATH, expected, nullptr);
    if (!expected_length || expected_length >= MAX_PATH) return false;
    wchar_t path[MAX_PATH]{};
    const DWORD length = GetModuleFileNameW(nullptr, path, MAX_PATH);
    if (!length || length >= MAX_PATH) return false;
    wchar_t canonical[MAX_PATH]{};
    const DWORD canonical_length = GetFullPathNameW(path, MAX_PATH, canonical, nullptr);
    if (!canonical_length || canonical_length >= MAX_PATH) return false;
    // Complete path identity, not the common Unreal shipping basename.
    return _wcsicmp(canonical, expected) == 0;
  }();
  return matches;
}
}  // namespace renodx::addons::dlss5
