# AGENTS.md

## 通用约定

- **使用中文**：所有注释、回复和总结使用中文
- **禁止 Reload Window**：验证修改效果用自动化测试 / 终端命令 / 编译输出，不要重载窗口（会中断会话上下文）
- **PR留言**：每完成一个阶段（一批提交）后，用 `gh pr status` 检查当前分支是否有关联的 open PR；若有关联，用 `gh pr comment` 留言本阶段修改的背景、内容与关键决策，并用 `gh pr edit --body-file` 更新 PR 整体描述（在"变更内容"中追加本阶段变更），方便 reviewer 理解与审查
- **修改前同步认知**：在进行修改前，确认是否完全理解需求，如果不清楚，采访用户直到理解全部的细节
- 创建 Skill 时只描述问题和约束，提供必要的事实性信息，不要贴具体代码，保持简洁。
- 创建 Skill 需要独立，不要引用仓库中的其他文件夹内容和资源。
- 每次修改，都要检查是否检查是否需要更新文档，确保文档与代码保持一致。
- 每轮调研后，如果发现有新的约束需要更新 skill/instructions等中的描述，请及时更新，确保后续的开发和审查都能遵循最新的约束。

## 代码修改

- 禁止直接在 main 分支开发；开始任务后先建 feature branch 并切换；若分支名冲突，检查现有分支是否属于当前任务以复用，或追加唯一标识（时间戳/issue 号）
- 每个独立的逻辑修改、功能点或错误修复完成后立即提交；commit 前保证编译通过 + 所有测试通过，若编译或测试失败，自行分析终端输出的报错并修复代码，直到通过后再执行 commit

## Shell / gh / git 避坑

- Bash on Windows 路径用正斜杠（反斜杠是转义符）
- `git add` 指定文件，不用 `-A`（避免误暂存 `nul`、`.codegraph/`）
- `gh` 传整数用 `--input -` + JSON；PR 正文含特殊字符用 `--body-file`
- `fs.mkdtemp` 前先 `fs.mkdirSync(dir, { recursive: true })`
- Windows 路径比较：统一 `replace(/\\/g, '/').toLowerCase()`（git 大写 / Node 小写）
- `gh pr comment` / `gh pr create` 即使终端输出被截断或看似失败，也可能已成功发布；重复执行前必须先确认，勿想当然
- 判断 issue/PR 评论是否已发布，用 `gh api repos/{owner}/{repo}/issues/{n}/comments` 查询；不要用 PR fetch 工具返回的 `comments` 字段判断——那是 review comments（行内评审），不含 issue comments（正文下普通评论）