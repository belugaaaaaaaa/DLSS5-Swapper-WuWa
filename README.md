# DLSS5-Swapper WuWa · 社区显卡减负项目

**让更多玩家在保留满意画质的前提下，减少神经渲染带来的额外显卡负担。**

我们从鸣潮开始，把 Swapper 的使用体验、NR（神经渲染）计算开销和玩家可接受的画质放在一起优化。开源的目的，是让玩家能分享有效设置、发现不同机器上的问题，也让开发者共同改进算法和使用流程。改进是否有价值，要看玩家能否以满意的画面更舒适地玩游戏。

**当前发布源码，尚无面向所有玩家安装路径的通用一键包。** 已安装的鸣潮本地版本获得用户验收，用户确认显卡“起飞”的体验问题改善；游戏日志也确认 NR 实际运行。这是已有成果，后续要靠更多机器和场景的反馈，找出哪些改动有效、哪些还需要调整。

Our goal is to help players reduce neural-rendering GPU overhead while keeping image quality they enjoy. We start with Wuthering Waves and welcome test reports, settings, visual comparisons and code contributions. The current release is source-only; the installed local build has user acceptance, while broader hardware support and controlled A/B results are still being developed.

## 玩家怎样参与

- **想了解和使用：**先看 [玩家指南](docs/PLAYERS.zh-CN.md)，了解当前版本、F8 控制和使用流程。
- **愿意分享实测或设置：**提交 [玩家实测反馈](https://github.com/belugaaaaaaaa/DLSS5-Swapper-WuWa/issues/new?template=player-test.zh-CN.md)。有效改善、没有改善、风扇感受和画质取舍都值得记录；缺少仪器的数据可以注明未知。
- **遇到画质、运行或安装问题：**提交 [问题反馈](https://github.com/belugaaaaaaaa/DLSS5-Swapper-WuWa/issues/new?template=quality-or-bug.zh-CN.md)，描述出现问题的场景和复现方法。
- **希望贡献代码：**阅读 [贡献指南](CONTRIBUTING.md)，围绕减少额外计算、保留画质和方便玩家使用提出改进。

不会编译也可以参与。请说明显卡、分辨率、设置和体验变化，让后来的玩家知道你的结果适用于什么条件。

## 我们围绕哪些负担做优化

| 玩家关心的问题 | 目前的做法 | 使用时需要了解 |
| --- | --- | --- |
| 神经渲染反复计算 | 条件满足时重投影并复用上次 NR 结果 | 收益取决于实际命中；条件不满足时继续正常 NR |
| 缓存自己增加负担 | 按完成的 GPU 工作和耗时决定是否复用，失败时暂停缓存尝试 | 暂停的是额外缓存工作，普通 NR 仍会运行 |
| 画质与负担难以取舍 | 原生中文 F8 面板提供 NR 开关、刷新/缓存模式和处理比例 | 选择自己满意的画质；复用拒绝的像素可能失去 NR 增强 |
| 安装或卸载难以恢复 | 鸣潮专用插件流程、保留设置、已知文件校验和插件卸载 | 不覆盖未知插件，不替换游戏原有 SR/Streamline 文件 |
| 使用时还要挂着启动器 | F8 在插件内运行，无面板客户端时停止 Electron 隐藏绘制 | 安装后无需让 Swapper 常驻 |

相较上游的完整改动见 [改动说明](docs/CHANGES.zh-CN.md)，算法与当前限制见 [设计说明](docs/DESIGN.md)。

## 已有成果与下一步

首位使用者已在实际鸣潮中验收并确认体验改善，NR 执行也有游戏日志支持，见 [用户实测记录](docs/USER_VALIDATION.zh-CN.md)。源码构建、安装流程、控制接口和独立 CPU/GPU 测试已通过。

接下来优先让玩家更容易参与、收集可比较的实测、减少无效计算并检查运动中的画质，再逐步扩展经过验证的配置。具体优先级见 [社区研发方向](docs/ROADMAP.zh-CN.md)。

目前还没有同场景对照支持的通用降耗百分比，也没有覆盖所有显卡与场景的画质结论。反馈中同时记录体验改善和问题，才能帮助其他玩家做合适的选择。

## 源码结构

- `swapper/`：上游 Swapper 源码及鸣潮安装流程。
- `native/`：NR 缓存、GPU 提交检查、控制接口及测试。
- `overlay/`：原生 F8 面板。
- `build/`：固定依赖版本、编译与本地插件准备方法。
- `tests/gpu/`、`validation/`：独立 GPU/CPU 测试、数值结果与测试条件。

## 构建与使用

玩家入口是 [玩家指南](docs/PLAYERS.zh-CN.md)。开发者本地构建请阅读 [原生插件构建方法](build/README.md) 和 [Swapper 构建说明](swapper/BUILD.md)。本仓库不提供 NVIDIA 模型、运行库、游戏文件、编译器或整包启动器；第三方组件由使用者按各自许可证另行取得。

鸣潮目标路径由使用者本地指定。原生插件必须针对同一个主程序路径构建；Swapper 安装时验证目标元数据。源码中不包含开发者的本机游戏路径。

安装完成后，启动鸣潮并使用 F8 面板。打开面板和插件加载成功，并不能证明 NR 或缓存已经在当前场景执行；应查看面板中的实际状态，并按 [游戏验收方法](docs/GAME_VALIDATION.zh-CN.md) 进行对照测试。

## 已有证据

2026-10-03，使用者提供实际鸣潮截图并明确确认问题已解决。游戏日志包含 NR `ENGAGED`、实际求值计数和非零模型 GPU 时间。截图叠加层显示约 196 FPS、77°C、99% GPU 利用率及 236.9 W；这些是单个时刻的读数，风扇体验改善来自使用者反馈，尚无改动前对照或风扇转速采样。完整证据范围见 [用户验收记录](docs/USER_VALIDATION.zh-CN.md)。

在 RTX 5070 上，独立 2560×1440 RGBA16F 合成输入测试中，缓存写入中位数为 **0.215440 ms**，重投影为 **0.327296 ms**；对应 p95 为 0.224165 ms 和 0.493562 ms。每项 2 次预热、10 次采样，单测试队列、均匀输入、零运动。这不包含 NR 模型、NGX、真实游戏、完整帧或功耗测量。

新 shader 的 19 项 CPU 参考测试和 33 项独立 GPU 检查通过，条件与来源见 [验证记录](validation/README_VALIDATION.md)。控制接口及源码构建的复现方法见 [构建说明](build/README.md)；Swapper 源码测试见 [Swapper 构建说明](swapper/BUILD.md)。本仓库使用公开路径配置重新整理源码，原部署二进制的哈希仅作为历史来源记录；不同路径和编译时间的重编译结果不保证逐字节相同。

## 许可与来源

本项目基于 [DLSS5-Swapper v2.2.7](https://github.com/rakanki911/DLSS5-Swapper)、[RenoDX](https://github.com/clshortfuse/renodx) 和 [RenoDX-DLSS5-Generic](https://github.com/PEQHUB/RenoDX-DLSS5-Generic)。这里的“DLSS5”沿用上游项目名称，项目为独立社区适配。

本项目源码使用 MIT 许可证；各上游版权声明保留在对应目录。第三方依赖继续适用其自己的许可证，根目录 MIT 不重新授权这些依赖、模型或游戏文件。见 [LICENSE](LICENSE)、[第三方说明](THIRD_PARTY_NOTICES.md) 和 [来源记录](docs/PROVENANCE.md)。

欢迎把你的设置经验、实测结果或代码改进贡献回来，让更多玩家找到适合自己的低负担玩法。
