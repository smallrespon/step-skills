# Step Skills

两个用于 AI 编程助手的 Agent Skills：

- `skills/stepcode-cli`：通过 CLI、JSON 和 RPC 非交互式使用 StepCode，包含参考资料和 Node.js 辅助脚本。
- `skills/step-image-search`：基于现有搜索工具查找图片，核验来源并整理结果；本身不提供搜索服务。

## 在 CC Switch 中使用

在技能仓库管理中添加 `https://github.com/smallrespon/step-skills`，分支填写 `main`，然后在发现页面选择需要的技能。也可将对应技能目录复制到支持 Agent Skills 的工具的技能目录。

## 使用条件

`stepcode-cli` 的命令和参考资料基于 StepCode 0.1.7 的 Windows 版本及其附带文档整理，其他版本或平台可能不同。辅助脚本需要 Node.js 和已安装的 StepCode；默认调用 Windows 用户目录下的 StepCode，或在其他平台从 PATH 查找 `step`，也可通过 `--step` 指定可执行文件。

`step-image-search` 需要当前助手具备网页或图片搜索工具。StepCode 的安装、登录及第三方服务使用受各自条款约束。

## 许可与声明

本仓库以 [MIT License](LICENSE) 发布；StepCode 及其他第三方产品、名称和资料的权利仍归其各自权利人所有。本项目为社区技能，不代表 StepFun 官方项目。
