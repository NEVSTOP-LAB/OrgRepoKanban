# 开发指南

## 本地开发

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

默认开发地址由 Vite 提供，通常为 `http://localhost:5173`。

### 运行测试

```bash
npm test
```

### 生成生产构建

```bash
npm run build
```

## 自动化验证

当前仓库包含以下验证方式：

- `npm test`：运行 Vitest 测试（10 个测试文件，65 个测试用例）。
- `npm run build`：执行 TypeScript 构建与 Vite 生产打包。

## 项目结构

```
src/
├── main.tsx                  # 入口：渲染 Root 组件
├── Root.tsx                  # 页面路由（home / permissions / secrets）
├── App.tsx                   # 权限看板（已有功能，零改动）
├── App.css                   # 全局样式（含新页面样式）
├── index.css                 # 设计令牌与基础样式
├── components/
│   ├── HomePage.tsx          # 首页导航
│   ├── SecretManager.tsx     # Secret 管理页
│   └── PermissionBoard.tsx   # 权限看板展示组件
├── domain/
│   ├── secret.ts             # Secret 操作领域逻辑
│   ├── secret.test.ts        # Secret 领域逻辑测试（17 用例）
│   ├── board.ts              # 看板列构建逻辑
│   ├── batch.ts              # 批量操作乐观更新与对账
│   ├── permissions.ts        # 权限等级定义与比较
│   └── selection.ts          # 多选逻辑
└── github/
    ├── client.ts             # GitHub API 客户端（含 Secret API 方法）
    ├── client.test.ts        # 客户端测试
    ├── data.ts               # 数据结构与转换
    ├── data.test.ts          # 数据转换测试
    ├── mutations.ts          # 权限变更批量执行
    ├── mutations.test.ts     # 变更执行测试
    └── secrets.ts            # libsodium 加密工具
```

## 技术说明

- 前端框架：React 19
- 构建工具：Vite 8
- 语言：TypeScript（strict 模式，`erasableSyntaxOnly`）
- 测试：Vitest + Testing Library（jsdom）
- 加密：libsodium-wrappers（Secret 密封盒加密 `crypto_box_seal`）
- 拖拽：原生 HTML5 Drag & Drop API（无第三方库）
- 路由：基于 state 的简单页面切换（无 react-router 依赖）
- 部署形态：GitHub Pages 静态文件或 Docker + Nginx
- 后端：无自定义后端，所有 API 调用直连 `https://api.github.com`
