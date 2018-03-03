const { spawn } = require('child_process');
const Server = require('./hope');

function init(argv) {
    // 如果配置为子进程开启服务
    if (argv.child) {
        //子进程启动服务
        const child = spawn('node', ['hope.js', JSON.stringify(argv)], {
            cwd: __dirname,
            detached: true,
            stdio: 'inherit'
        });

        //后台运行
        child.unref();
        process.exit(0);
    } else {
        const server = new Server(argv);
        server.start();
    }
}

module.exports = init;
