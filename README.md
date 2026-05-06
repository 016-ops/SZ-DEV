# 副本规划控制台

这是一个安全版本地规划工具，用来承接你在 `设计.txt` 里对“牌目标配置、流程编排、截图节点、概率统计、错误处理、可维护代码”的那部分需求。

它不实现这些内容：

- 真实游戏自动化刷取
- 键鼠注入或进程操控
- 反作弊绕过
- 充值入口
- 后门、远控、账号控制

这些能力本身带有明显的规避安全机制和未授权自动化属性，所以我没有开发。

## 当前交付

- 本地 Web 控制台
- 目标牌与品阶数量配置
- 幸运值、最高通关、刷新券等规划参数
- 第 1 关 / 第 6 关轮换流程配置
- 基于你提供截图的流程面板
- 本地模拟刷新和整轮流程模拟
- 掉落样本统计与概率汇总
- 日志和错误状态框架
- Python 标准库后端骨架
- Node 本地预览服务

## 目录结构

- [设计.txt](C:/Users/ZJH/SZ/设计.txt)
- [README.md](C:/Users/ZJH/SZ/README.md)
- [shared/catalog.json](C:/Users/ZJH/SZ/shared/catalog.json)
- [backend/server.py](C:/Users/ZJH/SZ/backend/server.py)
- [backend/data/state.json](C:/Users/ZJH/SZ/backend/data/state.json)
- [app/server.js](C:/Users/ZJH/SZ/app/server.js)
- [app/lib/store.js](C:/Users/ZJH/SZ/app/lib/store.js)
- [app/public/index.html](C:/Users/ZJH/SZ/app/public/index.html)
- [app/public/styles.css](C:/Users/ZJH/SZ/app/public/styles.css)
- [app/public/app.js](C:/Users/ZJH/SZ/app/public/app.js)

## 运行

当前环境已验证可直接运行 Node 预览服务：

```powershell
node app/server.js
```

然后打开：

- [http://127.0.0.1:3000](http://127.0.0.1:3000)

如果你本机安装了 Python，也可以单独运行 API 版本：

```powershell
python backend/server.py
```

默认地址：

- [http://127.0.0.1:8765/api/dashboard](http://127.0.0.1:8765/api/dashboard)

## 说明

前端为了保证当前目录下零依赖可运行，使用了原生 Web 页面而不是打包后的 React 工程。结构上已经按前后端分离组织好了，后续如果你要把前端迁到 React，可以直接复用：

- `shared/catalog.json`
- `backend/data/state.json`
- `/api/*` 数据契约

## 后续可继续做的合法方向

- 把截图说明扩展成可标注模板管理器
- 增加 OCR 结果录入与人工校正界面
- 增加更细的掉落分析和构筑推荐
- 增加导入导出配置
- 把前端迁移到 React 组件化结构
