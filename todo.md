# TODO

## IBKR 实时看板

前端入口已隐藏，后端代码已就绪（`/api/ibkr/live/overview`）。

### 要启用需要完成：

1. 在服务器上安装 Java + Xvfb 虚拟显示
   ```bash
   sudo apt install -y default-jre xvfb
   ```
2. 下载并安装 [IB Gateway](https://www.interactivebrokers.com/en/trading/ibgateway-stable.php)
3. 下载并配置 [IBC](https://github.com/IbcAlpha/IBC) 自动化登录（config.ini 填入 IBKR 用户名密码）
4. 用 systemd 管理 IBC + IB Gateway 进程，实现开机自启和每日自动重连
5. 修改 `.dev.vars`：
   ```
   IBKR_LIVE_USE_MOCK=false
   IBKR_LIVE_ACCOUNT=你的真实账号
   IBKR_LIVE_PORT=4001
   ```
6. 安装 Python 依赖：`pip install ib_insync`
7. 重启 stockview 服务
8. 恢复前端 `index.html` 中被注释的 IBKR 实时看板链接
