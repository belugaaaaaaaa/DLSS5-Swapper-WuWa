/* SPDX-License-Identifier: MIT */
#pragma once

#include <Windows.h>
#include <tlhelp32.h>
#include <detours.h>
#include <cstdint>
#include <atomic>
#include <mutex>
#include <vector>

// ReShade must see the matching ImGui version on its first include, otherwise
// its overlay function-table bindings are not instantiated.
#include <deps/imgui/imgui.h>
#include "../../utils/directx.hpp"
#include "../../utils/vtable.hpp"

namespace renodx::utils::vtable {
inline std::atomic<uint64_t> transaction_contended = 0;
}

// Adapter for APIs referenced by the public Generic rc5 snapshot but absent
// from the checked-out RenoDX commit. This is local to this experimental addon.
namespace renodx::utils::directx {

inline IUnknown* NativeIdentity(IUnknown* object) {
  if (object == nullptr) return nullptr;
  (void)NativeFromReShadeProxy(&object);
  IUnknown* identity = nullptr;
  if (FAILED(object->QueryInterface(IID_PPV_ARGS(&identity)))) return nullptr;
  // The caller continues to own the device/proxy; this is a borrowed identity.
  identity->Release();
  return identity;
}

inline bool SameNativeObject(IUnknown* first, IUnknown* second) {
  IUnknown* identity = NativeIdentity(first);
  return identity != nullptr && identity == NativeIdentity(second);
}

}  // namespace renodx::utils::directx

namespace renodx::addons::dlss5::compat {
namespace internal {

struct TransactionState {
  std::mutex mutex;
  std::vector<HANDLE> thread_handles;
  uint64_t opened = 0;
  uint64_t closed = 0;
  bool active = false;
  DWORD owner_thread_id = 0;
#ifdef WUWA_GENERIC_COMPAT_TESTING
  int fail_after_updates = -1;
#endif
};

inline TransactionState state;

inline void CloseThreadHandles() {
  // Detours stores the HANDLE itself and uses it to ResumeThread. Therefore
  // handles must remain open until the real commit or abort has returned.
  for (HANDLE thread : state.thread_handles) {
    CloseHandle(thread);
    ++state.closed;
  }
  state.thread_handles.clear();
}

}  // namespace internal

inline LONG AbortTransaction() {
  const bool owns_handles = internal::state.active
      && internal::state.owner_thread_id == GetCurrentThreadId();
  const LONG result = DetourTransactionAbort();
  if (owns_handles && result == NO_ERROR) {
    internal::state.active = false;
    internal::state.owner_thread_id = 0;
    internal::CloseThreadHandles();
  }
  return result;
}

inline LONG CommitTransaction() {
  const bool owns_handles = internal::state.active
      && internal::state.owner_thread_id == GetCurrentThreadId();
  const LONG result = DetourTransactionCommit();
  if (result != NO_ERROR && owns_handles) {
    (void)DetourTransactionAbort();
  }
  if (owns_handles) {
    internal::state.active = false;
    internal::state.owner_thread_id = 0;
    internal::CloseThreadHandles();
  }
  return result;
}

inline bool BeginTransaction() {
  auto& state = internal::state;
  if (state.active || !state.thread_handles.empty()) return false;
  const LONG begin_result = DetourTransactionBegin();
  if (begin_result != NO_ERROR) {
    if (begin_result == ERROR_INVALID_OPERATION) {
      renodx::utils::vtable::transaction_contended.fetch_add(1, std::memory_order_relaxed);
    }
    return false;
  }
  state.active = true;
  state.owner_thread_id = GetCurrentThreadId();
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    (void)AbortTransaction();
    return false;
  }
  bool success = true;
  THREADENTRY32 entry{.dwSize = sizeof(THREADENTRY32)};
  if (Thread32First(snapshot, &entry) == FALSE) {
    success = false;
  } else {
    do {
      if (entry.th32OwnerProcessID != GetCurrentProcessId()
          || entry.th32ThreadID == GetCurrentThreadId()) continue;
      HANDLE thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT
                                    | THREAD_SET_CONTEXT | THREAD_QUERY_INFORMATION,
                                FALSE, entry.th32ThreadID);
      if (thread == nullptr) {
        // A thread may exit between the snapshot and OpenThread. Other errors
        // must fail the transaction instead of silently excluding live threads.
        if (GetLastError() == ERROR_INVALID_PARAMETER) continue;
        success = false;
        break;
      }
      try {
        state.thread_handles.push_back(thread);
      } catch (...) {
        CloseHandle(thread);
        success = false;
        break;
      }
      ++state.opened;
    } while (Thread32Next(snapshot, &entry) != FALSE);
    if (success && GetLastError() != ERROR_NO_MORE_FILES) success = false;
  }
  CloseHandle(snapshot);
  // Finish vector growth before suspending any thread that could hold an
  // allocator lock. Detours itself manages the instruction-pointer fixups.
  if (success) {
    for (HANDLE thread : state.thread_handles) {
      if (DetourUpdateThread(thread) != NO_ERROR) {
        success = false;
        break;
      }
#ifdef WUWA_GENERIC_COMPAT_TESTING
      if (state.fail_after_updates == 0) {
        success = false;
        break;
      }
      if (state.fail_after_updates > 0) --state.fail_after_updates;
#endif
    }
  }
  if (!success) (void)AbortTransaction();
  return success;
}

}  // namespace renodx::addons::dlss5::compat

namespace renodx::utils::vtable {

inline std::mutex& TransactionMutex() {
  return renodx::addons::dlss5::compat::internal::state.mutex;
}

inline bool BeginTransaction() {
  return renodx::addons::dlss5::compat::BeginTransaction();
}

}  // namespace renodx::utils::vtable

// Only the source compiled after this private include is routed; vendor and
// shared utility definitions above retain their original code.
#define DetourTransactionCommit() ::renodx::addons::dlss5::compat::CommitTransaction()
#define DetourTransactionAbort() ::renodx::addons::dlss5::compat::AbortTransaction()
