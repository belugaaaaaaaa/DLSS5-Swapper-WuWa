/* Copyright (C) 2026; SPDX-License-Identifier: MIT */
#pragma once

#include "../wuwa_control_api.h"
#include <windows.h>
#include <cmath>
#include <cstring>
#include <string>

namespace wuwa_ui {

// Hold the provider only for the duration of a public API call. No retained
// function pointers, private addresses, or permanent module pinning.
struct module_lease {
    HMODULE module = nullptr;
    module_lease() { GetModuleHandleExW(0, L"renodx-dlss5.addon64", &module); }
    ~module_lease() { if (module) FreeLibrary(module); }
    module_lease(const module_lease &) = delete;
    module_lease &operator=(const module_lease &) = delete;
};

inline const char *result_text(int32_t result) {
    switch (result) {
        case WUWA_CONTROL_ERROR_VERSION: return "ABI version rejected";
        case WUWA_CONTROL_ERROR_SIZE: return "ABI structure size rejected";
        case WUWA_CONTROL_ERROR_COMMAND: return "Control/value rejected";
        case WUWA_CONTROL_ERROR_BUSY: return "Native command queue is busy";
        case WUWA_CONTROL_ERROR_PROCESS: return "This process is not Wuthering Waves";
        case WUWA_CONTROL_ERROR_INTERNAL: return "Native API reported an error";
        default: return "Native API returned an unknown result";
    }
}

struct controls {
    bool provider_detected = false, available = false;
    WuWaControlState state{};
    std::string reason = "No native WuWa control API is loaded";
    std::string command_status;
    uint64_t next_poll_ms = 0, request_serial = 0, pending_since_ms = 0;
    WuWaControlCommand pending{};

    static bool recent(uint64_t timestamp, uint64_t now, uint64_t max_age = 1500) {
        return timestamp != 0 && now >= timestamp && now - timestamp <= max_age;
    }
    static bool recent_reuse(const WuWaControlState &s, uint64_t now) {
        // Refreshing the cache is not reuse, even if a buggy/older provider
        // updates this timestamp for both operations.
        return s.cache_reprojects != 0 && recent(s.cache_last_recorded_ms, now);
    }
    bool recorded_activity(uint64_t now) const {
        return available && state.nr_enabled && !state.nr_runtime_fault && state.nr_successes != 0 &&
            (recent(state.nr_last_success_ms, now) ||
             (state.cost_mode == 1 && recent_reuse(state, now)));
    }
    static uint32_t read_control(const WuWaControlState &s, uint32_t id) {
        if (id == WUWA_CONTROL_NR_ENABLED) return s.nr_enabled;
        if (id == WUWA_CONTROL_COST_MODE) return s.cost_mode;
        if (id == WUWA_CONTROL_QUALITY_PERCENT) return s.quality_percent;
        return UINT32_MAX;
    }
    static bool valid_snapshot(const WuWaControlState &s) {
        return s.struct_size == sizeof(s) && s.abi_version == WUWA_CONTROL_ABI_VERSION &&
            s.nr_enabled <= 1 && s.cost_mode <= 1 && s.process_allowed <= 1 &&
            s.nr_runtime_ready <= 1 && s.cache_contract_qualified <= 1 &&
            s.driver_requirement_known <= 1 && s.quality_percent >= 33 && s.quality_percent <= 100 &&
            s.gpu_timing_available <= 1 && (!s.gpu_timing_available ||
                (std::isfinite(s.gpu_total_ms) && s.gpu_total_ms >= 0.0 && s.gpu_total_ms < 10000.0)) &&
            s.status_detail[sizeof(s.status_detail) - 1] == '\0';
    }
    void poll(bool force = false) {
        const uint64_t now = GetTickCount64();
        if (!force && now < next_poll_ms) return;
        next_poll_ms = now + 200;
        module_lease lease;
        const auto get = lease.module ? reinterpret_cast<WuWaGetStateFn>(
            GetProcAddress(lease.module, WUWA_GET_STATE_EXPORT)) : nullptr;
        const auto set = lease.module ? reinterpret_cast<WuWaSetControlFn>(
            GetProcAddress(lease.module, WUWA_SET_CONTROL_EXPORT)) : nullptr;
        provider_detected = get != nullptr || set != nullptr;
        if (!get || !set) {
            available = false; state = {};
            reason = provider_detected ? "Native control API is incomplete" : "No native WuWa control API is loaded";
            if (pending.request_id) command_status = "Provider disappeared; command was not verified";
            pending = {};
            return;
        }
        WuWaControlState snapshot{};
        snapshot.struct_size = sizeof(snapshot); snapshot.abi_version = WUWA_CONTROL_ABI_VERSION;
        const int32_t result = get(WUWA_CONTROL_ABI_VERSION, sizeof(snapshot), &snapshot);
        if (result != WUWA_CONTROL_OK || !valid_snapshot(snapshot)) {
            available = false; state = {};
            reason = result == WUWA_CONTROL_OK ? "Native snapshot failed ABI validation" : result_text(result);
            return;
        }
        state = snapshot; available = true; reason.clear();
        if (pending.request_id && state.last_completed_request_id == pending.request_id) {
            if (state.last_command_result == WUWA_CONTROL_APPLIED &&
                state.last_command_control_id == pending.control_id &&
                read_control(state, pending.control_id) == pending.value) {
                command_status = "Applied and confirmed by native readback";
            } else if (state.last_command_result == WUWA_CONTROL_APPLIED) {
                command_status = "Completion/readback mismatch; not verified";
            } else {
                command_status = result_text(state.last_command_result);
            }
            pending = {};
        } else if (pending.request_id && now - pending_since_ms > 5000) {
            // Timeout is not an acknowledgement and must never turn the UI green.
            command_status = "Still unconfirmed after 5 seconds; waiting for native processing";
        }
    }
    bool request(uint32_t control_id, uint32_t value) {
        if (!available || pending.request_id || !state.process_allowed) {
            command_status = "Control is unavailable or a previous request is pending";
            return false;
        }
        module_lease lease;
        const auto set = lease.module ? reinterpret_cast<WuWaSetControlFn>(
            GetProcAddress(lease.module, WUWA_SET_CONTROL_EXPORT)) : nullptr;
        if (!set) { command_status = "Provider disappeared; request was not sent"; return false; }
        if (!request_serial) request_serial = (GetTickCount64() << 20) | (GetCurrentProcessId() & 0xfffff);
        const WuWaControlCommand command{
            sizeof(WuWaControlCommand), WUWA_CONTROL_ABI_VERSION, ++request_serial, control_id, value};
        const int32_t result = set(WUWA_CONTROL_ABI_VERSION, sizeof(command), &command);
        if (result != WUWA_CONTROL_QUEUED) {
            command_status = result_text(result); return false;
        }
        pending = command; pending_since_ms = GetTickCount64();
        command_status = "Queued; awaiting native completion and readback";
        poll(true);
        return true;
    }
};

#ifndef WUWA_CONTROL_NO_IMGUI
inline void draw(controls &control) {
    ImGui::TextUnformatted("鸣潮神经渲染与优化");
    ImGui::TextWrapped("F8 打开/关闭。安装后无需保持 Swapper 窗口运行。");
    ImGui::Separator();
    if (!control.available) {
        ImGui::TextWrapped("插件接口尚未就绪：%s", control.reason.c_str());
        ImGui::TextWrapped("尚未确认增强或优化成功。");
        return;
    }
    const auto &s = control.state;
    const uint64_t now = GetTickCount64();
    const bool command_pending = control.pending.request_id != 0;
    ImGui::BeginDisabled(!s.process_allowed || command_pending);
    bool enabled = s.nr_enabled != 0;
    if (ImGui::Checkbox("启用神经渲染 (NR)", &enabled)) control.request(WUWA_CONTROL_NR_ENABLED, enabled ? 1 : 0);
    int mode = static_cast<int>(s.cost_mode);
    const char *cost_modes[] = {"每帧增强", "省负载（缓存复用）"};
    if (ImGui::Combo("计算模式", &mode, cost_modes, 2)) control.request(WUWA_CONTROL_COST_MODE, static_cast<uint32_t>(mode));
    constexpr uint32_t percentages[] = {100, 85, 75, 67, 50};
    const char *resolutions[] = {"100% / 优先画质", "85% / 平衡", "75% / 降低负载", "67% / 更低负载", "50% / 画质可能明显降低"};
    int resolution = -1;
    for (int i = 0; i < 5; ++i) if (percentages[i] == s.quality_percent) resolution = i;
    if (ImGui::Combo("增强分辨率", &resolution, resolutions, 5) && resolution >= 0)
        control.request(WUWA_CONTROL_QUALITY_PERCENT, percentages[resolution]);
    ImGui::EndDisabled();
    ImGui::Text("当前增强分辨率：%u%%", s.quality_percent);
    if (command_pending) {
        ImGui::TextWrapped(now - control.pending_since_ms <= 5000
            ? "设置已排队，等待插件确认。" : "设置仍未确认；请查看运行诊断。");
    } else if (control.command_status == "Applied and confirmed by native readback") {
        ImGui::TextWrapped("设置已应用，插件回读已确认。");
    } else if (!control.command_status.empty()) {
        ImGui::TextWrapped("设置未通过确认；请查看运行诊断。");
    }
    ImGui::Separator();
    if (!s.process_allowed) {
        ImGui::TextWrapped("当前不是鸣潮；控制已禁用。");
    } else if (!s.nr_enabled) {
        ImGui::TextWrapped("增强状态：已关闭。");
    } else if (s.nr_runtime_fault) {
        ImGui::TextWrapped("增强状态：运行报告故障（代码 %u）。", s.nr_runtime_fault);
    } else if (!s.nr_successes) {
        ImGui::TextWrapped("增强状态：尚未运行成功。");
    } else if (controls::recent(s.nr_last_success_ms, now)) {
        ImGui::TextWrapped("增强状态：近期模型调用成功。");
    } else {
        ImGui::TextWrapped("增强状态：曾运行成功，正在等待新的帧。");
    }
    if (!s.nr_enabled || !s.nr_successes || s.nr_runtime_fault) ImGui::TextWrapped("优化状态：未运行。");
    else if (s.cost_mode == 0) ImGui::TextWrapped("优化模式：每帧增强。");
    else if (controls::recent_reuse(s, now)) ImGui::TextWrapped("优化状态：近期已触发缓存复用。");
    else if (!s.cache_contract_qualified && controls::recent(s.nr_last_success_ms, now)) ImGui::TextWrapped("优化状态：暂不满足复用条件，使用完整增强。");
    else ImGui::TextWrapped("优化状态：等待缓存复用。");
    if (s.gpu_timing_available && controls::recent(s.gpu_timing_sample_ms, now, 3000)) {
        ImGui::Text("插件 GPU 时间：%.3f ms", s.gpu_total_ms);
    } else {
        ImGui::TextWrapped("插件 GPU 时间：等待实际样本。");
    }
    if (s.driver_requirement_known && s.driver_x100 < s.minimum_driver_x100) {
        ImGui::Separator();
        ImGui::TextWrapped("驱动条件：运行库声明需 %u.%02u；当前 %u.%02u。仅为条件警告，运行结果见上。",
            s.minimum_driver_x100 / 100, s.minimum_driver_x100 % 100,
            s.driver_x100 / 100, s.driver_x100 % 100);
    }
    ImGui::Separator();
    if (ImGui::CollapsingHeader("运行诊断")) {
        ImGui::Text("NR 成功调用：%llu", static_cast<unsigned long long>(s.nr_successes));
        ImGui::Text("已接收增强帧：%llu", static_cast<unsigned long long>(s.eligible_base_evaluations));
        ImGui::Text("缓存刷新 / 复用录制：%llu / %llu",
            static_cast<unsigned long long>(s.cache_refreshes), static_cast<unsigned long long>(s.cache_reprojects));
        ImGui::Text("完整增强回退：%llu", static_cast<unsigned long long>(s.fresh_fallbacks));
        ImGui::TextWrapped("模型计数是成功调用；缓存计数是录制工作，不能据此证明 GPU 已完成。GPU 时间只显示已完成的查询样本。");
        if (s.status_detail[0]) ImGui::TextWrapped("原生状态：%s", s.status_detail);
        if (!control.command_status.empty()) ImGui::TextWrapped("控制反馈：%s", control.command_status.c_str());
    }
    ImGui::Separator();
    ImGui::TextWrapped("实验版本：鸣潮画质、稳定性与功耗尚未实测。");
}
#endif

} // namespace wuwa_ui
