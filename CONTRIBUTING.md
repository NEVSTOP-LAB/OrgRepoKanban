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

- `npm test`：运行 Vitest 测试。
- `npm run build`：执行 TypeScript 构建与 Vite 生产打包。

## 技术说明

- 前端框架：React 19
- 构建工具：Vite 8
- 语言：TypeScript
- 测试：Vitest + Testing Library
- 部署形态：静态文件，由 Nginx 提供服务
