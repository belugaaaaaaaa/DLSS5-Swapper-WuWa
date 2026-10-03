#include <cstdio>
struct NgxLike {
  virtual void Set(const char*, unsigned long long) = 0;
  virtual void Set(const char*, float) = 0;
  virtual void Set(const char*, double) = 0;
  virtual int Get(const char*, unsigned long long*) = 0;
  virtual int Get(const char*, float*) = 0;
  virtual int Get(const char*, double*) = 0;
};
struct Implementation final : NgxLike {
  bool float_called = false;
  void Set(const char*, unsigned long long) override { float_called = false; }
  void Set(const char*, float value) override { float_called = value == 0.5f; }
  void Set(const char*, double) override { float_called = false; }
  int Get(const char*, unsigned long long* value) override { *value = 9; return float_called ? 73 : -1; }
  int Get(const char*, float*) override { return -2; }
  int Get(const char*, double*) override { return -3; }
};
extern "C" int call_ngx_like(NgxLike* params);
extern "C" int structured_exception_probe(volatile int* pointer);
int main() {
  Implementation params;
  if (call_ngx_like(&params) != 73) return 1;
  std::puts("PASS Zig Microsoft ABI dispatch into MSVC overloaded virtual table");
  volatile int value = 5;
  if (structured_exception_probe(&value) != 5 || structured_exception_probe(nullptr) != -1) return 2;
  std::puts("PASS Zig __try/__except handles real access violation with MSVC CRT");
  return 0;
}
