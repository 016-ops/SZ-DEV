# Backend

这个后端是一个安全版本地状态服务：

- 只提供配置、统计、截图说明和流程模拟接口
- 不连接真实游戏进程
- 不发送真实键鼠输入
- 不包含规避检测、远控、后门或充值能力

运行方式：

```powershell
python backend/server.py
```

如果本机 `python` 不在 `PATH`，请使用你的实际 Python 可执行文件路径运行。
