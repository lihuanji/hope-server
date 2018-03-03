## 基于node的静态文件服务器


## Install
```
    npm install hope-server -g
```

## Start

```
    hope-server
```

## 配置

选项：
  --version    显示版本号                                                 
  -d, --root   静态文件根目录        
  -o, --host   配置监听的主机              
  -p, --port   配置端口号                           
  -c, --child  是否子进程运行                      
  -h           显示帮助信息                

示例：
  hope-server -d / -p 9090 -o localhost  在本机的9090端口上监听客户端的请求