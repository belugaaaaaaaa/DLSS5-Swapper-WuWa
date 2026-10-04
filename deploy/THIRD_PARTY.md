# 部署助手的组件与许可

这个社区项目希望在保留满意画质的前提下，减少 NR 带来的额外显卡负担。请在安装前阅读本页和随部署包提供的完整许可。源码仓库不含插件二进制；Releases 的轻量部署包加入本项目构建的原生插件模板和 F8 面板，以及部署脚本所需的 JavaScript 依赖。

**根目录 MIT 许可只授权本项目的原创贡献，不把第三方代码、SDK、运行库或模型改成 MIT。** 发布包保留各自完整许可及版权声明；索引在 `bundle/licenses/inventory.json`。来源和版本固定信息见 [构建依赖](../build/dependencies.json) 与 [下载清单](download-pins.json)。

## 随轻量包提供的部分

| 组件 | 适用许可与来源 | 包内完整文件 |
| --- | --- | --- |
| 本项目部署代码、缓存和 F8 改动 | MIT；上游衍生部分保留原作者声明 | `bundle/licenses/Project-MIT.txt` 与对应 NOTICE |
| RenoDX / RenoDX-DLSS5-Generic | MIT，Carlos Lopez Jr. | `RenoDX-MIT.txt`、`Generic-MIT.txt`、`Generic-NOTICE.md` |
| Swapper 安装代码、原 overlay 来源 | MIT，Rakan Alkhaldi / DLSS 5 Swapper contributors；安装器基础为 v2.2.7，overlay 来源为 v2.2.9 | `Swapper-MIT.txt`、`Swapper-NOTICES.md`、`Overlay-MIT.txt`、`Overlay-NOTICE.md` |
| Detours | Microsoft MIT | `Detours-MIT.txt` |
| ReShade 编程接口 | BSD 3-Clause；原生插件与 overlay 使用不同固定版本 | `ReShade-Native-BSD-3-Clause.txt`、`ReShade-Overlay-BSD-3-Clause.txt` |
| Dear ImGui、nlohmann/json | 各自 MIT | `ImGui-MIT.txt`、`nlohmann-json-MIT.txt` |
| frozen | Apache 2.0；保留作者名单 | `frozen-Apache-2.0.txt`、`frozen-AUTHORS.txt` |
| gtl、其中的 Abseil 派生片段及 Boost 哈希片段 | Apache 2.0；相关 Daniel James 片段为 Boost Software License 1.0 | `gtl-Apache-2.0.txt`、`gtl-CREDITS.txt`、`Boost-1.0.txt` |
| Streamline 接口声明 | MIT；完整上游说明还列出本插件没有使用的组件，不表示那些组件随包提供 | `Streamline-LICENSE.txt`、`Streamline-THIRD-PARTY.md` |
| NVIDIA DLSS/NGX SDK 接口声明 | NVIDIA RTX SDK 条款，**不属于 MIT** | `NVIDIA-DLSS-SDK-TERMS.txt` |
| 静态链接的 Microsoft C/C++ 运行库 | 适用 Microsoft 工具链及 Windows SDK 条款；没有复制编译器、原始 `.lib` 或调试 CRT | `Microsoft/` 中本次构建适用的完整许可 |
| extract-zip 及实际生产依赖 | 各包自己的 BSD/MIT 等许可；没有 Electron 或编译工具依赖 | `Node/` 下逐包完整许可及 `inventory.json` 的版本记录 |

以上表格的文件名除第一列说明外，均位于 `deploy/bundle/licenses/`。有上游 NOTICE 时也会原样保留。此包的自有插件使用 SDK 的类型、接口声明及少量常量/宏；没有链接 NVIDIA SDK 库，也没有加入 NVIDIA 模型、SDK 运行库或神经渲染实现。完整 SDK 条款仍被保留，不能把“没有运行库”理解成 SDK 条款不适用。

## 安装时在你的电脑取得的部分

部署助手会按 [固定下载清单](download-pins.json) 下载并校验：

- **Node.js 便携运行环境**：从 Node.js 官方站点取得，按其 `LICENSE` 及包含的第三方声明使用；保留在本地缓存中。无需提前安装 Node.js。
- **官方 DLSS5-Swapper v2.2.7 portable**：从上游 GitHub Release 取得；也可选择你已下载且哈希匹配的原版 EXE。工具只把它当归档提取，**不会运行它**。原包和其中第三方组件保留各自许可。
- **7zip-bin / 7-Zip 提取工具**：从固定 npm 包取得，包内 `LICENSE.txt` 的 MIT 许可只涵盖 Vladimir Krivosheev 的封装，不把 `7za.exe` 重新授权为 MIT。7-Zip 21.07 的源码许可按部分代码区分 LGPL、BSD、公共领域和 unRAR 限制；完整版本说明见 [21.07 License.txt](https://github.com/ip7z/7zip/blob/21.07/DOC/License.txt) 与 [LGPL 2.1 全文](https://github.com/ip7z/7zip/blob/21.07/DOC/copying.txt)。公开部署 ZIP 不含这个 EXE，不能用本项目 MIT 或封装 MIT 推断该程序的再分发权限。

从原版包取得的 ReShade loader、NVIDIA NR 运行库及模型只在本机用于准备鸣潮组件，不包含在我们公开的轻量 ZIP 中。这个流程没有为这些文件提供新的再分发授权。请遵守原发布者的完整条款，尤其不要把缓存中的第三方运行库、模型或原版 EXE重新当作本项目的 MIT 资产发布。

## SDK 与再分发边界

[NVIDIA SDK 固定版本条款](https://github.com/NVIDIA/DLSS/blob/a291cc7d2cc642a51566f3dfd5376f635cd1b284/LICENSE.txt)允许在满足条件时将 SDK 软件/材料并入应用目标代码，并禁止将 SDK 单独再分发。DLSS/NGX 补充条款的通知触发条件是**相关应用的商业发布之前**，包括用于商业应用的插件；它并没有把所有公开二进制发布一律写为通知条件。本项目是免费社区项目，这一说明不替其他发行者判断其发行是否属于商业发布。改作商业用途、改变分发内容或使用 NVIDIA 商标宣传时，应重新检查对应条款。

Microsoft 静态运行库不是独立的 MIT 文件。构建者须满足所使用工具链的许可与再分发条件；Windows SDK 的 `.lib` 条款针对与程序链接后的结果，不能据此分发原始库。可对照 [Microsoft 再分发说明](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170) 和随包完整条款。**附上许可文本不替代构建者所需的授权。**

此项目不宣称 NVIDIA、鸣潮运营方或上游开发者认可本适配。游戏可能限制插件使用；部署助手要求你自行了解游戏规则并明确同意后安装，不修改或关闭反作弊。安装完成也不保证当前机器或场景的 NR/缓存已经执行，请在游戏里按 F8 查看实际状态。
