struct NgxLike {
  virtual void Set(const char*, unsigned long long) = 0;
  virtual void Set(const char*, float) = 0;
  virtual void Set(const char*, double) = 0;
  virtual int Get(const char*, unsigned long long*) = 0;
  virtual int Get(const char*, float*) = 0;
  virtual int Get(const char*, double*) = 0;
};
extern "C" int call_ngx_like(NgxLike* params) {
  params->Set("Float", 0.5f);
  unsigned long long result = 0;
  return params->Get("Integer", &result);
}
extern "C" int structured_exception_probe(volatile int* pointer) {
  __try {
    return *pointer;
  } __except (1) {
    return -1;
  }
}
