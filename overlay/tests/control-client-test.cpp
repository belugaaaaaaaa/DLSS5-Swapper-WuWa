#define WUWA_CONTROL_NO_IMGUI
#include "../src/wuwa-controls.hpp"
#include "../src/overlay-hotkey.hpp"
#include <cstdio>

static unsigned assertions = 0, failures = 0;
#define CHECK(condition) do { ++assertions; if (!(condition)) { ++failures; printf("FAIL line %d: %s\n", __LINE__, #condition); } } while (false)
int main() {
    CHECK(sizeof(WuWaControlState) == 376);
    CHECK(sizeof(WuWaControlCommand) == 24);
    CHECK(offsetof(WuWaControlState, gpu_total_ms) == 352);
    HMODULE provider = LoadLibraryW(L"renodx-dlss5.addon64"); CHECK(provider != nullptr);
    if (!provider) return 2;
    const auto get = reinterpret_cast<WuWaGetStateFn>(GetProcAddress(provider, WUWA_GET_STATE_EXPORT));
    const auto set = reinterpret_cast<WuWaSetControlFn>(GetProcAddress(provider, WUWA_SET_CONTROL_EXPORT));
    const auto process = reinterpret_cast<int32_t(WUWA_CONTROL_CALL*)()>(GetProcAddress(provider, "WuWaTest_ProcessQueued"));
    const auto mismatch = reinterpret_cast<void(WUWA_CONTROL_CALL*)()>(GetProcAddress(provider, "WuWaTest_MismatchNextReadback"));
    const auto allow = reinterpret_cast<void(WUWA_CONTROL_CALL*)(uint32_t)>(GetProcAddress(provider, "WuWaTest_SetProcessAllowed"));
    CHECK(get && set && process && mismatch && allow);
    WuWaControlState s{};
    CHECK(get(2, sizeof(s), &s) == WUWA_CONTROL_ERROR_VERSION);
    CHECK(get(1, sizeof(s) - 8, &s) == WUWA_CONTROL_ERROR_SIZE);
    CHECK(get(1, sizeof(s), nullptr) == WUWA_CONTROL_ERROR_SIZE);
    CHECK(get(1, sizeof(s), &s) == WUWA_CONTROL_OK);
    CHECK(s.driver_x100 == 61088 && s.minimum_driver_x100 == 61500);
    WuWaControlCommand command{sizeof(command), 1, 7, 99, 1};
    CHECK(set(1, sizeof(command), &command) == WUWA_CONTROL_ERROR_COMMAND);
    command.control_id = WUWA_CONTROL_NR_ENABLED; command.value = 2;
    CHECK(set(1, sizeof(command), &command) == WUWA_CONTROL_ERROR_COMMAND);
    command.control_id = WUWA_CONTROL_QUALITY_PERCENT; command.value = 51;
    CHECK(set(1, sizeof(command), &command) == WUWA_CONTROL_ERROR_COMMAND);
    CHECK(set(2, sizeof(command), &command) == WUWA_CONTROL_ERROR_VERSION);
    CHECK(set(1, sizeof(command) - 4, &command) == WUWA_CONTROL_ERROR_SIZE);
    wuwa_ui::controls client; client.poll(true);
    CHECK(client.provider_detected && client.available);
    CHECK(client.state.nr_enabled == 1 && !client.recorded_activity(GetTickCount64()));
    CHECK(client.request(WUWA_CONTROL_NR_ENABLED, 0));
    CHECK(client.pending.request_id != 0 && client.state.nr_enabled == 1);
    CHECK(client.command_status.find("Queued") != std::string::npos);
    CHECK(!client.request(WUWA_CONTROL_COST_MODE, 0));
    CHECK(process() == 1); client.poll(true);
    CHECK(!client.pending.request_id && client.state.nr_enabled == 0);
    CHECK(client.command_status.find("confirmed") != std::string::npos);
    CHECK(client.request(WUWA_CONTROL_COST_MODE, 0)); CHECK(process() == 1); client.poll(true);
    CHECK(client.state.cost_mode == 0 && !client.pending.request_id);
    CHECK(client.request(WUWA_CONTROL_QUALITY_PERCENT, 75)); CHECK(process() == 1); client.poll(true);
    CHECK(client.state.quality_percent == 75 && !client.pending.request_id);
    CHECK(!client.request(99, 1));
    CHECK(client.command_status.find("rejected") != std::string::npos);
    mismatch(); CHECK(client.request(WUWA_CONTROL_NR_ENABLED, 1)); CHECK(process() == 1); client.poll(true);
    CHECK(client.command_status.find("mismatch") != std::string::npos);
    CHECK(!client.recorded_activity(GetTickCount64()));
    allow(0); client.poll(true); CHECK(!client.request(WUWA_CONTROL_NR_ENABLED, 1)); allow(1);
    CHECK(!wuwa_ui::controls::recent(0, 100));
    CHECK(!wuwa_ui::controls::recent(101, 100));
    CHECK(!wuwa_ui::controls::recent(1, 2000));
    CHECK(wuwa_ui::controls::recent(1000, 2000));
    // A cache refresh alone must never be presented as reuse or active NR.
    wuwa_ui::controls recorded;
    recorded.available = true; recorded.state.nr_enabled = 1; recorded.state.cost_mode = 1;
    recorded.state.nr_successes = 2; recorded.state.nr_last_success_ms = 1000;
    recorded.state.cache_refreshes = 5; recorded.state.cache_last_recorded_ms = 3000;
    CHECK(!wuwa_ui::controls::recent_reuse(recorded.state, 3000));
    CHECK(!recorded.recorded_activity(3000));
    recorded.state.cache_reprojects = 1;
    CHECK(wuwa_ui::controls::recent_reuse(recorded.state, 3000));
    CHECK(recorded.recorded_activity(3000));
    recorded.state.nr_enabled = 0; CHECK(!recorded.recorded_activity(3000));
    recorded.state.nr_enabled = 1; recorded.state.nr_runtime_fault = 1; CHECK(!recorded.recorded_activity(3000));
    s = client.state; s.gpu_timing_available = 1; s.gpu_total_ms = NAN;
    CHECK(!wuwa_ui::controls::valid_snapshot(s));
    s = client.state; s.status_detail[191] = 'x'; CHECK(!wuwa_ui::controls::valid_snapshot(s));
    struct fake_runtime {
        bool f8 = true, ctrl = false;
        bool is_key_pressed(int key) const { return key == VK_F8 && f8; }
        bool is_key_down(int key) const { return key == VK_CONTROL && ctrl; }
    } runtime;
    lab_hotkey::binding hotkey;
    CHECK(hotkey.key == VK_F8 && hotkey.mods == 0);
    CHECK(hotkey.pressed(&runtime)); runtime.ctrl = true; CHECK(!hotkey.pressed(&runtime));
    FreeLibrary(provider); client.poll(true);
    CHECK(!GetModuleHandleW(L"renodx-dlss5.addon64"));
    CHECK(!client.provider_detected && !client.available && !client.recorded_activity(GetTickCount64()));
    printf("WUWA_C_ABI_CONTROL_TRANSPORT assertions=%u failures=%u; MSVC provider / GNU consumer; no NR/GPU work\n", assertions, failures);
    return failures ? 1 : 0;
}
