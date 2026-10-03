/* Isolated control-transport fixture. It performs no NR or GPU work. */
#include "../wuwa_control_api.h"
#include <windows.h>
#include <cstring>

static WuWaControlState state = [] {
    WuWaControlState s{};
    s.struct_size = sizeof(s); s.abi_version = WUWA_CONTROL_ABI_VERSION;
    s.publish_sequence = 1; s.nr_enabled = 1; s.cost_mode = 1;
    s.quality_percent = 85; s.process_allowed = 1;
    s.driver_x100 = 61088; s.minimum_driver_x100 = 61500; s.driver_requirement_known = 1;
    strcpy_s(s.status_detail, "CPU control-transport fixture: no NR/GPU work");
    return s;
}();
static WuWaControlCommand pending{};
static bool mismatch = false;

extern "C" __declspec(dllexport) int32_t WUWA_CONTROL_CALL RenoDX_WuWa_GetState(
    uint32_t version, uint32_t size, WuWaControlState *out) {
    if (version != WUWA_CONTROL_ABI_VERSION) return WUWA_CONTROL_ERROR_VERSION;
    if (size != sizeof(state) || !out) return WUWA_CONTROL_ERROR_SIZE;
    *out = state; return WUWA_CONTROL_OK;
}
extern "C" __declspec(dllexport) int32_t WUWA_CONTROL_CALL RenoDX_WuWa_SetControl(
    uint32_t version, uint32_t size, const WuWaControlCommand *command) {
    if (version != WUWA_CONTROL_ABI_VERSION) return WUWA_CONTROL_ERROR_VERSION;
    if (size != sizeof(WuWaControlCommand) || !command || command->struct_size != size)
        return WUWA_CONTROL_ERROR_SIZE;
    if (command->abi_version != version) return WUWA_CONTROL_ERROR_VERSION;
    if (!state.process_allowed) return WUWA_CONTROL_ERROR_PROCESS;
    const bool boolean = command->control_id == WUWA_CONTROL_NR_ENABLED || command->control_id == WUWA_CONTROL_COST_MODE;
    const bool quality = command->control_id == WUWA_CONTROL_QUALITY_PERCENT &&
        (command->value == 50 || command->value == 67 || command->value == 75 || command->value == 85 || command->value == 100);
    if (!command->request_id || !(quality || (boolean && command->value <= 1))) return WUWA_CONTROL_ERROR_COMMAND;
    if (pending.request_id) return WUWA_CONTROL_ERROR_BUSY;
    pending = *command; state.last_received_request_id = command->request_id;
    state.last_command_result = WUWA_CONTROL_QUEUED;
    state.last_command_control_id = command->control_id;
    ++state.publish_sequence; return WUWA_CONTROL_QUEUED;
}
extern "C" __declspec(dllexport) int32_t WUWA_CONTROL_CALL WuWaTest_ProcessQueued() {
    if (!pending.request_id) return 0;
    const uint32_t value = mismatch ? (pending.value ? 0 : 1) : pending.value;
    if (pending.control_id == WUWA_CONTROL_NR_ENABLED) state.nr_enabled = value;
    if (pending.control_id == WUWA_CONTROL_COST_MODE) state.cost_mode = value;
    if (pending.control_id == WUWA_CONTROL_QUALITY_PERCENT) state.quality_percent = value;
    state.last_completed_request_id = pending.request_id; state.last_command_result = WUWA_CONTROL_APPLIED;
    state.last_command_control_id = pending.control_id; pending = {}; mismatch = false;
    ++state.publish_sequence; return 1;
}
extern "C" __declspec(dllexport) void WUWA_CONTROL_CALL WuWaTest_MismatchNextReadback() { mismatch = true; }
extern "C" __declspec(dllexport) void WUWA_CONTROL_CALL WuWaTest_SetProcessAllowed(uint32_t allowed) { state.process_allowed = allowed; }
