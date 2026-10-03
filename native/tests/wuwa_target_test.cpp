/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#include "../wuwa_target.hpp"
#include <cstdio>

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const bool expected = argv[1][0] == '1';
  const bool actual = renodx::addons::dlss5::IsWuWaCostProcess();
  std::printf("Actual complete-path process guard: expected=%d actual=%d\n", expected, actual);
  return actual == expected ? 0 : 1;
}
