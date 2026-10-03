#define WUWA_GENERIC_COMPAT_TESTING
#include <generic_compat.hpp>
#include <cstdio>

struct FakeNative final : IUnknown {
  ULONG references = 1;
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** output) override {
    if (output == nullptr) return E_POINTER;
    *output = nullptr;
    if (id != __uuidof(IUnknown)) return E_NOINTERFACE;
    *output = static_cast<IUnknown*>(this);
    AddRef();
    return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++references; }
  ULONG STDMETHODCALLTYPE Release() override { return --references; }
};

struct FakeProxy final : IUnknown {
  FakeNative* native = nullptr;
  ULONG references = 1;
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** output) override {
    if (output == nullptr) return E_POINTER;
    *output = nullptr;
    if (id == __uuidof(renodx::utils::directx::ReShadeRetrieveBaseInterface)) {
      *output = static_cast<IUnknown*>(native);
      native->AddRef();
      return S_OK;
    }
    if (id != __uuidof(IUnknown)) return E_NOINTERFACE;
    *output = static_cast<IUnknown*>(this);
    AddRef();
    return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++references; }
  ULONG STDMETHODCALLTYPE Release() override { return --references; }
};

struct WorkerState {
  HANDLE stop;
  std::atomic<uint64_t> iterations = 0;
};

DWORD WINAPI Worker(void* data) {
  auto* state = static_cast<WorkerState*>(data);
  while (WaitForSingleObject(state->stop, 1) == WAIT_TIMEOUT) ++state->iterations;
  return 0;
}

int main() {
  using namespace renodx::addons::dlss5;
  FakeNative first;
  FakeNative second;
  FakeProxy proxy;
  proxy.native = &first;
  if (renodx::utils::directx::NativeIdentity(&first) != &first
      || renodx::utils::directx::NativeIdentity(&proxy) != &first
      || !renodx::utils::directx::SameNativeObject(&proxy, &first)
      || renodx::utils::directx::SameNativeObject(&proxy, &second)
      || renodx::utils::directx::NativeIdentity(nullptr) != nullptr
      || first.references != 1 || second.references != 1 || proxy.references != 1) {
    std::puts("FAIL COM canonical identity or reference balance");
    return 1;
  }
  std::puts("PASS native/proxy canonical identity and AddRef/Release balance");
  WorkerState worker{.stop = CreateEventW(nullptr, TRUE, FALSE, nullptr)};
  HANDLE thread = CreateThread(nullptr, 0, Worker, &worker, 0, nullptr);
  if (worker.stop == nullptr || thread == nullptr) return 2;
  Sleep(15);
  DWORD handles_before = 0;
  GetProcessHandleCount(GetCurrentProcess(), &handles_before);
  {
    std::lock_guard<std::mutex> lock(renodx::utils::vtable::TransactionMutex());
    const uint64_t opened_before = compat::internal::state.opened;
    if (!compat::BeginTransaction() || !compat::internal::state.active
        || compat::internal::state.thread_handles.empty()) return 3;
    if (compat::CommitTransaction() != NO_ERROR
        || compat::internal::state.active || !compat::internal::state.thread_handles.empty()
        || compat::internal::state.opened == opened_before
        || compat::internal::state.opened != compat::internal::state.closed) return 4;
  }
  std::puts("PASS success commit keeps handles through resume and balances closure");
  const uint64_t iterations_before = worker.iterations;
  Sleep(15);
  if (worker.iterations <= iterations_before) return 5;
  {
    std::lock_guard<std::mutex> lock(renodx::utils::vtable::TransactionMutex());
    compat::internal::state.fail_after_updates = 0;
    if (compat::BeginTransaction() || compat::internal::state.active
        || !compat::internal::state.thread_handles.empty()
        || compat::internal::state.opened != compat::internal::state.closed) return 6;
    compat::internal::state.fail_after_updates = -1;
    if (!compat::BeginTransaction() || compat::AbortTransaction() != NO_ERROR) return 7;
  }
  Sleep(15);
  if (worker.iterations <= iterations_before) return 8;
  DWORD handles_after = 0;
  GetProcessHandleCount(GetCurrentProcess(), &handles_after);
  if (handles_after != handles_before) {
    std::printf("FAIL process handles before=%lu after=%lu\n", handles_before, handles_after);
    return 9;
  }
  std::printf("PASS injected failure abort/resume/cleanup and retry; thread handles opened=%llu closed=%llu\n",
              compat::internal::state.opened, compat::internal::state.closed);
  SetEvent(worker.stop);
  if (WaitForSingleObject(thread, 1000) != WAIT_OBJECT_0) return 10;
  CloseHandle(thread);
  CloseHandle(worker.stop);
  return 0;
}
