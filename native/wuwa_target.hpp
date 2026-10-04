/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#pragma once

#include <Windows.h>
#include <cstddef>
#include <cwchar>

// The public build generates this macro from an explicitly selected canonical
// game executable. An unconfigured build must never enable cost controls.
#ifndef WUWA_TARGET_EXE_W
#define WUWA_TARGET_EXE_W L""
#endif

#ifndef WUWA_TARGET_TEMPLATE
#define WUWA_TARGET_TEMPLATE 0
#endif

#if WUWA_TARGET_TEMPLATE
// The installer binds this exported data in an independently copied, hash-checked
// template before loading it. Volatile reads prevent an unbound O2 build from
// folding the process guard to false. Never edit a loaded module's target.
extern "C" {
__declspec(dllexport) inline volatile wchar_t RenoDX_WuWa_TargetExe[260] = L"WUWA_UNBOUND_V1";
}
static_assert(sizeof(wchar_t) == 2);
static_assert(sizeof(RenoDX_WuWa_TargetExe) == 520);
#endif

namespace renodx::addons::dlss5 {
inline bool IsWuWaCostProcess() {
  static const bool matches = [] {
#if WUWA_TARGET_TEMPLATE
    wchar_t target[260]{};
    bool terminated = false;
    for (size_t index = 0; index < 260; ++index) {
      target[index] = RenoDX_WuWa_TargetExe[index];
      if (target[index] == L'\0') {
        terminated = true;
        break;
      }
    }
    if (!terminated) return false;
#else
    constexpr const wchar_t* target = WUWA_TARGET_EXE_W;
#endif
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
