# Step 文搜图 Skill

用于把自然语言图片需求转换成图片检索、候选核验和来源整理。技能本身不提供图片搜索服务；Step 会调用当前会话中可用的搜索工具。

## 在 Step Code 中加载

解压后从目录显式加载：

```bash
step --skill ./step-image-search
```

也可以传入 `SKILL.md` 文件路径：

```bash
step --skill ./step-image-search/SKILL.md
```

当前 Step Code CLI 的 `--skill` 参数支持加载 skill 文件或目录。此包不改动全局配置。
