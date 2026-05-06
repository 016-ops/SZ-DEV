# 副本规划控制台

这是一个本地规划与测试工具，用来承接你在 `设计.txt` 里对“牌目标配置、流程编排、截图节点、概率统计、错误处理、可维护代码”的那部分需求。

它不实现这些内容：

- 真实游戏自动化刷取
- 键鼠注入或进程操控
- 反作弊绕过
- 充值入口
- 后门、远控、账号控制

这些能力本身带有明显的规避安全机制和未授权自动化属性，所以我没有开发。

## 当前交付

- Python 标准库后端，提供 API、静态页面和截图媒体
- React 前端控制台，构建后输出到 `app/public/assets/app.bundle.js`
- 目标牌与品阶数量配置
- 幸运值、最高通关、刷新券等规划参数
- 左侧属性面板人工记录与校正
- 第 1 关 / 第 6 关轮换流程配置
- 基于你提供截图的流程面板和标注层
- 本地模拟刷新和整轮流程模拟
- 手动掉落样本录入
- 掉落样本统计与概率汇总
- 日志和错误状态框架

## 目录结构

- [设计.txt](C:/Users/ZJH/SZ/设计.txt)
- [README.md](C:/Users/ZJH/SZ/README.md)
- [shared/catalog.json](C:/Users/ZJH/SZ/shared/catalog.json)
- [shared/templates.json](C:/Users/ZJH/SZ/shared/templates.json)
- [backend/server.py](C:/Users/ZJH/SZ/backend/server.py)
- [backend/data/state.json](C:/Users/ZJH/SZ/backend/data/state.json)
- [app/src/main.js](C:/Users/ZJH/SZ/app/src/main.js)
- [app/scripts/build-react.js](C:/Users/ZJH/SZ/app/scripts/build-react.js)
- [app/public/index.html](C:/Users/ZJH/SZ/app/public/index.html)
- [app/public/styles.css](C:/Users/ZJH/SZ/app/public/styles.css)

## 运行

构建 React 前端：

```powershell
npm run build
```

启动 Python 服务：

```powershell
npm run start:python
```

默认地址：

- [http://127.0.0.1:8765](http://127.0.0.1:8765)
- [http://127.0.0.1:8765/api/dashboard](http://127.0.0.1:8765/api/dashboard)

也可以一条命令构建并启动：

```powershell
npm start
```

如需换端口：

```powershell
$env:PORT=8876
npm run start:python
```

## 说明

前端使用当前目录已有的 `react` 和 `react-dom`，通过 `app/scripts/build-react.js` 做本地轻量打包，不依赖 Vite/Webpack 下载额外依赖。

`backend/server.py` 同时提供：

- `/api/dashboard`
- `/api/profile`
- `/api/attributes`
- `/api/targets`
- `/api/workflow`
- `/api/annotations`
- `/api/statistics/sample`
- `/api/simulate/refresh`
- `/api/simulate/run`
- `/api/export`

## 后续可继续做的合法方向

- 增加 OCR 结果录入与人工校正界面
- 增加更细的掉落分析和构筑推荐
- 增加导入导出配置
- 增加 MySQL 持久化适配层
