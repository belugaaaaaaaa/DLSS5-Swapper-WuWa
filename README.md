# DLSS5-Swapper · 鸣潮适配实验版

基于 [DLSS5-Swapper v2.2.7](https://github.com/rakanki911/DLSS5-Swapper)、[RenoDX](https://github.com/clshortfuse/renodx) 和 [RenoDX-DLSS5-Generic](https://github.com/PEQHUB/RenoDX-DLSS5-Generic) 的鸣潮专用修改：带检查的 NR 历史缓存、原生 F8 面板，以及插件安装与卸载流程。

**状态：实验源码，尚未完成实际鸣潮场景验收。** 已验证部分独立 GPU 运算、控制接口和安装逻辑；尚未验证游戏中的缓存命中率、拖影、整体帧率、功耗、温度或风扇转速。这里的“DLSS5”沿用上游项目名称，不代表本仓库是 NVIDIA 官方发布或官方游戏支持。

This is an experimental, source-only Wuthering Waves integration. Component tests do not establish in-game performance, image quality, or power savings.

## 相比原版改了什么

| 部分 | 本仓库的修改 | 作用和边界 |
| --- | --- | --- |
| NR 计算 | 在满足安全条件时，隔一个基础 DLSS 求值复用并重投影上次增强结果 | 有机会减少完整 NR 调用；条件不满足时仍执行完整 NR，不能据此宣称计算量减半 |
| 鸣潮适配 | 缓存与控制只对编译时指定的鸣潮主程序启用，缓存限定 DX12、SR 后及单次处理路径 | 适配其调用位置；默认未指定路径时拒绝启用缓存与控制。未改游戏程序、资源或设置文件 |
| 复用检查 | 检查运动、深度、颜色、有限数值、资源状态及完成的 GPU 提交 | 无效像素使用当前 DLSS 结果，局部可能失去 NR 增强；这不是画质等价保证 |
| 负载控制 | 冷启动观察、失败退避、按已完成的 GPU 时间关闭不划算的缓存尝试 | 连续未命中或复用成本过高时暂停缓存工作；完整 NR 自身仍可能较重 |
| F8 控制 | 原生中文面板，使用版本化公开 C 接口读取状态、发送命令 | 显示实际执行状态；排队成功不会被显示为已经生效。使用时无需保持 Swapper 窗口打开 |
| 安装与卸载 | 专用插件升级、未知文件保护、保留设置、仅卸载本项目插件 | 不替换游戏原有 SR/Streamline DLL；保留既有备份记录，不覆盖来历不明的插件 |
| 后台开销 | Electron 无面板客户端时停止隐藏面板绘制 | 减少启动器后台工作，不等于游戏 GPU 降载已经验证 |

详见 [改动说明](docs/CHANGES.zh-CN.md)、[验证范围](validation/README_VALIDATION.md) 和 [设计及限制](docs/DESIGN.md)。

## 源码结构

- `swapper/`：上游 Swapper 源码及鸣潮安装流程。
- `native/`：NR 缓存、GPU 提交检查、控制接口及测试。
- `overlay/`：原生 F8 面板。
- `build/`：固定依赖版本、编译与本地插件准备方法。
- `tests/gpu/`、`validation/`：独立 GPU/CPU 测试、数值结果与测试条件。

## 构建与使用

请先阅读 [构建方法](build/README.md) 和 [Swapper 构建说明](swapper/README.md)。本仓库不提供 NVIDIA 模型、运行库、游戏文件、编译器或整包启动器。需要的第三方文件由使用者根据各自许可证另行取得并明确提供。

鸣潮目标路径由使用者本地指定。原生插件必须针对同一个主程序路径构建；Swapper 安装时验证目标元数据。源码中不包含开发者的本机游戏路径。

安装完成后，启动鸣潮并使用 F8 面板。打开面板和插件加载成功，并不能证明 NR 或缓存已经在当前场景执行；应查看面板中的实际状态，并按 [游戏验收方法](docs/GAME_VALIDATION.zh-CN.md) 进行对照测试。

## 已有证据

在 RTX 5070 上，独立 2560×1440 RGBA16F 合成输入测试中，缓存写入中位数为 **0.215440 ms**，重投影为 **0.327296 ms**；对应 p95 为 0.224165 ms 和 0.493562 ms。每项 2 次预热、10 次采样，单测试队列、均匀输入、零运动。这不包含 NR 模型、NGX、真实游戏、完整帧或功耗测量。

新 shader 的 19 项 CPU 参考测试和 33 项独立 GPU 检查通过，条件与来源见 [验证记录](validation/README_VALIDATION.md)。控制接口及源码构建的复现方法见 [构建说明](build/README.md)；Swapper 源码测试见 [Swapper 构建说明](swapper/BUILD.md)。本仓库使用公开路径配置重新整理源码，原部署二进制的哈希仅作为历史来源记录；不同路径和编译时间的重编译结果不保证逐字节相同。

## 许可与来源

本项目源码使用 MIT 许可证；各上游版权声明保留在对应目录。第三方依赖继续适用其自己的许可证，根目录 MIT 不重新授权这些依赖、模型或游戏文件。见 [LICENSE](LICENSE)、[第三方说明](THIRD_PARTY_NOTICES.md) 和 [来源记录](docs/PROVENANCE.md)。

欢迎提供可复现问题、带测试条件的数据或改进补丁。未完成实测的修改请继续标注为实验性。
