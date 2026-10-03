/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#pragma once

// The cache and public control API exist only in an explicitly enabled build.
// WuWaCostMode/F8 may control that build; neither enables the compile-time gate.
#ifndef RENODX_WUWA_COST_EXPERIMENT
#define RENODX_WUWA_COST_EXPERIMENT 0
#endif

#include <d3d12.h>
#include <d3dcommon.h>
#include <array>
#include <atomic>
#include <bit>
#include <cmath>
#include <cstdint>
#include <span>
#include <vector>

#include "submission_tracker.hpp"
#include "wuwa_cost_policy.hpp"

namespace renodx::addons::dlss5::wuwa {

constexpr uint32_t kHistoryBytesPerPixel = 20;
constexpr uint32_t kRefreshInterval = 2;
inline std::atomic_uint64_t next_stream_id{0};
inline uint64_t NewStreamId() { return ++next_stream_id; }
// 20-byte record: three packed half pairs (edited RGB, reference RGB),
// float raw device depth, uint validity. Reference RGB enables chroma rejection.
struct Constants {
  uint32_t width, height, motion_width, motion_height;
  uint32_t depth_width, depth_height, motion_x, motion_y;
  uint32_t depth_x, depth_y, encoding;
  float maximum_motion_pixels;
  float mv_to_output_x, mv_to_output_y, depth_absolute, depth_relative;
  float luma_stops, color_relative, color_absolute, reserved;
};
static_assert(sizeof(Constants) == 20 * sizeof(uint32_t));

struct Contract {
  const void* source_handle = nullptr;
  uint64_t epoch = 0, settings_generation = 0, control_generation = 0;
  uint32_t width = 0, height = 0, motion_width = 0, motion_height = 0;
  uint32_t depth_width = 0, depth_height = 0, motion_x = 0, motion_y = 0;
  uint32_t depth_x = 0, depth_y = 0, flags = 0, output_format = 0;
  uint32_t motion_format = 0, depth_format = 0, encoding = 0, feed = 0;
  uint32_t motion_scale_x = 0, motion_scale_y = 0, unit_nits = 0;
  uint32_t nr_width = 0, nr_height = 0;
  bool operator==(const Contract&) const = default;
};

struct History {
  ID3D12Resource* buffers[2]{};
  ID3D12DescriptorHeap* descriptors = nullptr;
  ID3D12RootSignature* root = nullptr;
  ID3D12PipelineState* refresh = nullptr;
  ID3D12PipelineState* reproject = nullptr;
  // Retain borrowed objects referenced by immutable recorded descriptors.
  ID3D12Resource* views[5]{};
  Contract contract{};
  uint32_t width = 0, height = 0, written = 0;
  bool valid = false, contract_valid = false;
  uint64_t accepted_base_evaluations = 0;
  int64_t last_base_evaluate_ns = 0;
  Admission admission{};
  uint64_t timing_stream_id = NewStreamId();
};

struct Counters {
  std::atomic_uint64_t refreshes{0}, reprojects{0};
  std::atomic_uint64_t invalidations{0}, pending_history{0};
  std::atomic_uint64_t eligible_base_evaluations{0}, nr_refreshes{0};
  std::atomic_uint64_t fresh_fallbacks{0};
};
static Counters counters;
static std::vector<History> retired;

inline std::array<const void*, 11> Objects(const History& h) {
  return {h.buffers[0], h.buffers[1], h.descriptors, h.root, h.refresh,
          h.reproject, h.views[0], h.views[1], h.views[2], h.views[3], h.views[4]};
}
inline bool Complete(const History& h) {
  // Deliberately stronger than a fence for the last submit: every recording
  // must be closed (no replay) and every exact submission completed. This is
  // a nonblocking gate, not evidence of a future command list's queue.
  const auto objects = Objects(h);
  // Borrowed views may already be tracked by THIS frame's normal workset.
  // Our six owned objects uniquely name our older cache recordings; those
  // prove the lifetime of the immutable descriptors and all borrowed views.
  for (uint32_t i = 0; i < 6; ++i) {
    if (objects[i] != nullptr && !submission::ResourceReleasable(objects[i])) return false;
  }
  return true;
}
inline void Track(ID3D12GraphicsCommandList* list, const History& h) {
  for (const void* object : Objects(h)) {
    submission::TrackUse(list, object);
  }
}
template <class T>
inline void Release(T** object) {
  if (*object != nullptr) {
    (*object)->Release();
  }
  *object = nullptr;
}
inline void ReleaseNow(History* history) {
  auto& h = *history;
  for (auto*& view : h.views) {
    Release(&view);
  }
  for (auto*& buffer : h.buffers) {
    Release(&buffer);
  }
  Release(&h.descriptors);
  Release(&h.root);
  Release(&h.refresh);
  Release(&h.reproject);
  h = {};
}
inline void Invalidate(History* history) {
  history->valid = false;
  ++counters.invalidations;
}
inline void Retire(History* history) {
  auto& h = *history;
  if (h.buffers[0] || h.buffers[1] || h.descriptors || h.root) {
    retired.push_back(h);
  }
  h = {};
}
inline void RetireStoragePreservingContract(History* history) {
  const auto contract = history->contract;
  const bool contract_valid = history->contract_valid;
  const uint64_t accepted = history->accepted_base_evaluations;
  const int64_t evaluate_ns = history->last_base_evaluate_ns;
  const auto admission = history->admission;
  const uint64_t timing_stream_id = history->timing_stream_id;
  Retire(history);
  history->contract = contract;
  history->contract_valid = contract_valid;
  history->accepted_base_evaluations = accepted;
  history->last_base_evaluate_ns = evaluate_ns;
  history->admission = admission;
  history->timing_stream_id = timing_stream_id;
}
inline void Poll() {
  for (auto it = retired.begin(); it != retired.end();) {
    if (Complete(*it)) {
      ReleaseNow(&*it);
      it = retired.erase(it);
    } else {
      ++it;
    }
  }
}
inline void FlushAtDeviceShutdown() {
  for (auto& h : retired) {
    ReleaseNow(&h);
  }
  retired.clear();
}

// Must be called once for each admitted *base DLSS* evaluate. Present / FG
// events never touch this counter. Contract changes restart at a refresh.
inline bool RefreshDue(History* history, const Contract& contract, bool reset, int64_t evaluate_ns) {
  auto& h = *history;
  const bool long_gap = h.last_base_evaluate_ns != 0
      && (evaluate_ns < h.last_base_evaluate_ns || evaluate_ns - h.last_base_evaluate_ns > 100'000'000);
  const bool changed = !h.contract_valid || !(h.contract == contract);
  if (reset || long_gap || changed) {
    Invalidate(&h);
    h.timing_stream_id = NewStreamId();
    h.contract = contract;
    h.contract_valid = true;
    h.accepted_base_evaluations = 0;
    if (reset || changed) {
      h.admission = {};
    }
  }
  h.last_base_evaluate_ns = evaluate_ns;
  return (h.accepted_base_evaluations++ % kRefreshInterval) == 0;
}

using SerializeFn = HRESULT(WINAPI*)(const D3D12_ROOT_SIGNATURE_DESC*,
    D3D_ROOT_SIGNATURE_VERSION, ID3DBlob**, ID3DBlob**);
inline bool CreatePipeline(ID3D12Device* device, SerializeFn serialize,
    History* history, std::span<const uint8_t> refresh, std::span<const uint8_t> reproject) {
  auto& h = *history;
  if (h.root && h.refresh && h.reproject) return true;
  if (!device || !serialize) return false;
  D3D12_DESCRIPTOR_RANGE ranges[2]{};
  ranges[0] = {.RangeType = D3D12_DESCRIPTOR_RANGE_TYPE_SRV, .NumDescriptors = 4};
  ranges[1] = {.RangeType = D3D12_DESCRIPTOR_RANGE_TYPE_UAV, .NumDescriptors = 1};
  D3D12_ROOT_PARAMETER params[5]{};
  params[0].ParameterType = D3D12_ROOT_PARAMETER_TYPE_DESCRIPTOR_TABLE;
  params[0].DescriptorTable = {.NumDescriptorRanges = 1, .pDescriptorRanges = &ranges[0]};
  params[1].ParameterType = D3D12_ROOT_PARAMETER_TYPE_DESCRIPTOR_TABLE;
  params[1].DescriptorTable = {.NumDescriptorRanges = 1, .pDescriptorRanges = &ranges[1]};
  params[2].ParameterType = D3D12_ROOT_PARAMETER_TYPE_UAV;
  params[2].Descriptor = {.ShaderRegister = 1};
  params[3].ParameterType = D3D12_ROOT_PARAMETER_TYPE_UAV;
  params[3].Descriptor = {.ShaderRegister = 2};
  params[4].ParameterType = D3D12_ROOT_PARAMETER_TYPE_32BIT_CONSTANTS;
  params[4].Constants = {.Num32BitValues = sizeof(Constants) / sizeof(uint32_t)};
  D3D12_ROOT_SIGNATURE_DESC desc{.NumParameters = 5, .pParameters = params};
  ID3DBlob* blob = nullptr;
  ID3DBlob* errors = nullptr;
  HRESULT result = serialize(&desc, D3D_ROOT_SIGNATURE_VERSION_1, &blob, &errors);
  Release(&errors);
  if (FAILED(result) || !blob) {
    Release(&blob);
    return false;
  }
  result = device->CreateRootSignature(0, blob->GetBufferPointer(),
      blob->GetBufferSize(), IID_PPV_ARGS(&h.root));
  Release(&blob);
  if (FAILED(result)) return false;
  D3D12_COMPUTE_PIPELINE_STATE_DESC pso{.pRootSignature = h.root};
  pso.CS = {refresh.data(), refresh.size()};
  if (FAILED(device->CreateComputePipelineState(&pso, IID_PPV_ARGS(&h.refresh)))) return false;
  pso.CS = {reproject.data(), reproject.size()};
  return SUCCEEDED(device->CreateComputePipelineState(&pso, IID_PPV_ARGS(&h.reproject)));
}

inline bool Allocate(ID3D12Device* device, History* history, uint32_t width, uint32_t height) {
  auto& h = *history;
  if (!device) return false;
  if (h.width == width && h.height == height && h.buffers[0] && h.buffers[1]
      && h.descriptors) return true;
  // Caller retires a mismatched history before allocating. No live object is
  // silently dropped on a partial allocation failure.
  if (h.buffers[0] || h.buffers[1] || h.descriptors) return false;
  const uint64_t bytes = uint64_t(width) * height * kHistoryBytesPerPixel;
  if (!width || !height || bytes > 128ull * 1024 * 1024) return false;
  D3D12_RESOURCE_DESC desc{};
  desc.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER;
  desc.Width = bytes;
  desc.Height = 1;
  desc.DepthOrArraySize = 1;
  desc.MipLevels = 1;
  desc.SampleDesc.Count = 1;
  desc.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
  desc.Flags = D3D12_RESOURCE_FLAG_ALLOW_UNORDERED_ACCESS;
  D3D12_HEAP_PROPERTIES heap{};
  heap.Type = D3D12_HEAP_TYPE_DEFAULT;
  heap.CreationNodeMask = 1;
  heap.VisibleNodeMask = 1;
  for (auto*& buffer : h.buffers) {
    if (FAILED(device->CreateCommittedResource(&heap, D3D12_HEAP_FLAG_NONE, &desc,
        D3D12_RESOURCE_STATE_COMMON, nullptr, IID_PPV_ARGS(&buffer)))) return false;
  }
  D3D12_DESCRIPTOR_HEAP_DESC hd{};
  hd.Type = D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV;
  hd.NumDescriptors = 5;
  hd.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE;
  if (FAILED(device->CreateDescriptorHeap(&hd, IID_PPV_ARGS(&h.descriptors)))) return false;
  h.width = width;
  h.height = height;
  return true;
}

inline bool BindViews(ID3D12Device* device, History* history,
    const std::array<ID3D12Resource*, 5>& resources,
    const std::array<DXGI_FORMAT, 5>& formats) {
  auto& h = *history;
  // Descriptor contents and borrowed COM refs are rewritten only after the
  // exact recording proof, never while a closed/submitted list can read them.
  if (!device || !Complete(h) || !h.descriptors) return false;
  for (uint32_t i = 0; i < 5; ++i) {
    if (!resources[i] || formats[i] == DXGI_FORMAT_UNKNOWN) return false;
  }
  for (auto*& view : h.views) {
    Release(&view);
  }
  auto cpu = h.descriptors->GetCPUDescriptorHandleForHeapStart();
  const UINT stride = device->GetDescriptorHandleIncrementSize(
      D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);
  for (uint32_t i = 0; i < 5; ++i) {
    h.views[i] = resources[i];
    h.views[i]->AddRef();
    if (i < 4) {
      D3D12_SHADER_RESOURCE_VIEW_DESC srv{};
      srv.Format = formats[i];
      srv.ViewDimension = D3D12_SRV_DIMENSION_TEXTURE2D;
      srv.Shader4ComponentMapping = D3D12_DEFAULT_SHADER_4_COMPONENT_MAPPING;
      srv.Texture2D.MipLevels = 1;
      device->CreateShaderResourceView(resources[i], &srv, cpu);
    } else {
      D3D12_UNORDERED_ACCESS_VIEW_DESC uav{};
      uav.Format = formats[i];
      uav.ViewDimension = D3D12_UAV_DIMENSION_TEXTURE2D;
      device->CreateUnorderedAccessView(resources[i], nullptr, &uav, cpu);
    }
    cpu.ptr += stride;
  }
  return true;
}

inline bool Dispatch(ID3D12GraphicsCommandList* list, ID3D12Device* device,
    History* history, const Constants& constants, bool refresh) {
  auto& h = *history;
  if (!list || !device || !h.buffers[0] || !h.buffers[1] || !h.root || !h.refresh || !h.reproject
      || !h.descriptors || (!refresh && !h.valid) || !Complete(h)) return false;
  const uint32_t read = h.written;
  const uint32_t write = read ^ 1;
  const auto barrier = [&](ID3D12Resource* resource) {
    D3D12_RESOURCE_BARRIER b{};
    b.Type = D3D12_RESOURCE_BARRIER_TYPE_UAV;
    b.UAV.pResource = resource;
    list->ResourceBarrier(1, &b);
  };
  // Tracking is published BEFORE the first GPU-visible recording.
  Track(list, h);
  barrier(h.buffers[read]);
  barrier(h.buffers[write]);
  ID3D12DescriptorHeap* heaps[]{h.descriptors};
  list->SetDescriptorHeaps(1, heaps);
  list->SetComputeRootSignature(h.root);
  list->SetPipelineState(refresh ? h.refresh : h.reproject);
  auto gpu = h.descriptors->GetGPUDescriptorHandleForHeapStart();
  list->SetComputeRootDescriptorTable(0, gpu);
  gpu.ptr += uint64_t(4) * device->GetDescriptorHandleIncrementSize(
      D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);
  list->SetComputeRootDescriptorTable(1, gpu);
  list->SetComputeRootUnorderedAccessView(2, h.buffers[read]->GetGPUVirtualAddress());
  list->SetComputeRootUnorderedAccessView(3, h.buffers[write]->GetGPUVirtualAddress());
  list->SetComputeRoot32BitConstants(4, sizeof(Constants) / 4, &constants, 0);
  list->Dispatch((h.width + 7) / 8, (h.height + 7) / 8, 1);
  barrier(h.buffers[write]);
  h.written = write;
  h.valid = true;
  if (refresh) {
    ++counters.refreshes;
  } else {
    ++counters.reprojects;
  }
  return true;
}
}  // namespace renodx::addons::dlss5::wuwa
