/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#define WUWA_TARGET_TEMPLATE 1
#include "../wuwa_target.hpp"

#include <cstdio>
#include <cstring>

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  wchar_t target[260]{};
  bool expected = false;
  if (std::strcmp(argv[1], "self") == 0 || std::strcmp(argv[1], "canonical") == 0) {
    if (GetModuleFileNameW(nullptr, target, 260) == 0) return 2;
    expected = true;
    if (std::strcmp(argv[1], "canonical") == 0) {
      for (size_t index = 0; target[index] != L'\0'; ++index) {
        if (target[index] == L'\\') {
          target[index] = L'/';
        } else if (target[index] >= L'A' && target[index] <= L'Z') {
          target[index] += L'a' - L'A';
        }
      }
    }
  } else if (std::strcmp(argv[1], "wrong") == 0) {
    std::memcpy(target, L"C:\\different-install\\Client-Win64-Shipping.exe",
                sizeof(L"C:\\different-install\\Client-Win64-Shipping.exe"));
  } else if (std::strcmp(argv[1], "relative") == 0) {
    std::memcpy(target, L".\\Client-Win64-Shipping.exe", sizeof(L".\\Client-Win64-Shipping.exe"));
  } else if (std::strcmp(argv[1], "unterminated") == 0) {
    for (wchar_t& character : target) {
      character = L'x';
    }
  } else if (std::strcmp(argv[1], "marker") == 0) {
    std::memcpy(target, L"WUWA_UNBOUND_V1", sizeof(L"WUWA_UNBOUND_V1"));
  } else if (std::strcmp(argv[1], "empty") != 0) {
    return 2;
  }
  for (size_t index = 0; index < 260; ++index) {
    RenoDX_WuWa_TargetExe[index] = target[index];
  }
  const bool actual = renodx::addons::dlss5::IsWuWaCostProcess();
  std::printf("Actual volatile-slot process guard: mode=%s expected=%d actual=%d\n", argv[1], expected, actual);
  return actual == expected ? 0 : 1;
}
