/**
 * @file index.js
 * @author lihuanji
 *
 *  hope静态服务器
 */

const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const handlebars = require('handlebars');
const mime = require('mime');
const crypto = require('crypto');
const zlib = require('zlib');

class Hope{
    constructor(argv) {
        this.config = Object.assign({}, this.config, argv);
    }

    // 开始启动静态文件服务
    start() {
        const server = http.createServer();

        // 监听请求
        server.on('request', this.request.bind(this));

        server.listen(this.config.port, () => {
            console.log(`静态文件服务启动成功, 访问localhost:${this.config.port}`);
        })
    }

    // 处理请求方法
    request(req, res) {
        const { pathname } = url.parse(req.url); // 访问路径
        let filepath = path.join(this.config.root, pathname); // 文件路径
        // 如果访问根目录，自动寻找index.html
        if (pathname === '/') {
            const rootPath = path.join(this.config.root, 'index.html');
            try{
                const indexStat = fs.statSync(rootPath);
                if (indexStat) {
                    filepath = rootPath;
                }
            } catch(e) {
                
            }
        }

        fs.stat(filepath, (err, stats) => {
            if (err) {
                this.sendError('not found', req, res);
                return;
            }
            // 判断是否是文件夹
            // 文件夹返回文件列表
            if (stats.isDirectory()) {
                let files = fs.readdirSync(filepath);
                files = files.map(file => ({
                    name: file,
                    url: path.join(pathname, file)
                }));
                let html = this.list()({
                    title: pathname,
                    files
                });
                res.setHeader('Content-Type', 'text/html');
                res.end(html);
            } else {
                this.sendFile(req, res, filepath, stats);
            }
        });
    }

    // 文件列表模板渲染
    list() {
        let tmpl = fs.readFileSync(path.resolve(__dirname, 'template', 'list.html'), 'utf8');
        return handlebars.compile(tmpl);
    }

    /**
     * 发送文件
     * @param {*} req 请求流
     * @param {*} res 响应流
     * @param {*} filepath 文件路径 
     * @param {*} stats 文件信息
     */
    sendFile(req, res, filepath, stats) {
        // 为文件生成hash值
        const sha1 = crypto.createHash('sha1');
        const fileRS = fs.createReadStream(filepath);
        fileRS.on('data', (data) => {
            sha1.update(data);
        });
        fileRS.on('end', () => {
            const hash = sha1.digest('hex');

            // 判断是否走缓存
            if (this.handleCache(req, res, stats, hash)) return;
            
            // 获取压缩流
            const encoding = this.getEncoding(req, res);
            // 获取文件流，并支持断点续传
            const rs = this.getStream(req, res, filepath, stats);
            // 设置content-type 并设置编码
            res.setHeader('Content-Type', mime.getType(filepath) + ';charset=utf-8');

            // 响应数据
            if (encoding) {
                rs.pipe(encoding).pipe(res);
            } else {
                rs.pipe(res);
            }
        });
    }

    /**
     * 错误处理
     * @param {*} err 处理信息
     * @param {*} req 请求流
     * @param {*} res 响应流
     */
    sendError(err, req, res) {
        res.statusCode = 500;
        res.end(`${err.toString()}`);
    }

    /**
     * 缓存
     * @param {*} req 请求流
     * @param {*} res 响应流
     * @param {*} stats 文件信息
     * @param {*} hash 文件hash值
     */
    handleCache(req, res, stats, hash) {
        // 当资源过期时, 客户端发现上一次请求资源，服务器有发送Last-Modified, 则再次请求时带上if-modified-since
        const ifModifiedSince = req.headers['if-modified-since'];
        // 服务器发送了etag,客户端再次请求时用If-None-Match字段来询问是否过期
        const ifNoneMatch = req.headers['if-none-match'];
        // http1.1内容 max-age=30 为强行缓存30秒 30秒内再次请求则用缓存  private 仅客户端缓存，代理服务器不可缓存
        res.setHeader('Cache-Control', 'private,max-age=30');
        // http1.0内容 作用与Cache-Control一致 告诉客户端什么时间，资源过期 优先级低于Cache-Control
        res.setHeader('Expires', new Date(Date.now() + 30 * 1000).toGMTString());
        // 设置ETag 根据内容生成的hash
        res.setHeader('ETag', hash);
        // 设置Last-Modified 文件最后修改时间
        const lastModified = stats.ctime.toGMTString();
        res.setHeader('Last-Modified', lastModified);

        // 判断ETag是否过期
        if (ifNoneMatch && ifNoneMatch != hash) {
            return false;
        }
        // 判断文件最后修改时间
        if (ifModifiedSince && ifModifiedSince != lastModified) {
            return false;
        }
        // 如果存在且相等，走缓存304
        if (ifNoneMatch || ifModifiedSince) {
            res.writeHead(304);
            res.end();
            return true;
        } else {
            return false;
        }
    }

    /**
     * 压缩
     * @param {*} req 请求流
     * @param {*} res 响应流
     */
    getEncoding(req, res) {
        //Accept-Encoding: gzip, deflate  客户端发送内容，告诉服务器支持哪些压缩格式，服务器根据支持的压缩格式，压缩内容。如服务器不支持，则不压缩。
        const acceptEncoding = req.headers['accept-encoding'];
        // gzip和deflate压缩
        if (/\bgzip\b/.test(acceptEncoding)) {
            res.setHeader('Content-Encoding', 'gzip');
            return zlib.createGzip();
        } else if (/\bdeflate\b/.test(acceptEncoding)) {
            res.setHeader('Content-Encoding', 'deflate');
            return zlib.createDeflate();
        } else {
            return null;
        }
    }

    /**
     * 断点续传支持
     * @param {*} req 
     * @param {*} res 
     * @param {*} filepath 
     * @param {*} statObj 
     */
    getStream(req, res, filepath, statObj) {
        let start = 0;
        let end = statObj.size - 1;
        const range = req.headers['range'];
        if (range) {
            res.setHeader('Accept-Range', 'bytes');
            res.statusCode = 206;//返回整个内容的一块
            let result = range.match(/bytes=(\d*)-(\d*)/);
            if (result) {
                start = isNaN(result[1]) ? start : parseInt(result[1]);
                end = isNaN(result[2]) ? end : parseInt(result[2]) - 1;
            }
        }
        return fs.createReadStream(filepath, {
            start, end
        });
    }
}

if (process.argv[2] && process.argv[2].startsWith('{')) {
    const argv = JSON.parse(process.argv[2]);
    const server = new Hope(argv);
    server.start();
}

module.exports = Hope;
