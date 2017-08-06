const path = require('path')
const url = require('url')
const express = require('express')
const finalhandler = require('finalhandler')
const createConfig = require('./create-config')
const runWebpack = require('./run-webpack')
const Router = require('./router')

const serveStatic = (path, cache) => express.static(path, {
  maxAge: cache ? '1d' : 0
})

module.exports = class Ream {
  constructor({
    entry = 'src/index.js',
    renderer,
    output,
    dev,
    cwd = process.cwd(),
    devServer,
    host,
    port
  } = {}) {
    this.host = host
    this.port = port
    this.dev = dev
    this.entry = entry
    this.cwd = cwd
    this.devServerOptions = Object.assign({
      host: '0.0.0.0',
      port: 34592
    }, devServer)
    this.output = Object.assign({
      path: path.resolve('.ream'),
      dist: 'dist'
    }, output)
    this.renderer = renderer
    this.serverConfig = createConfig(this, 'server')
    this.clientConfig = createConfig(this, 'client')

    this.renderer.rendererInit(this)
  }

  ownDir(...args) {
    return path.join(__dirname, '../', ...args)
  }

  resolvePath(...args) {
    return path.resolve(this.cwd, ...args)
  }

  resolveDistPath(type, ...args) {
    return this.resolvePath(this.output.path, `dist-${type}`, ...args)
  }

  build() {
    return Promise.all([
      runWebpack(this.serverConfig.toConfig()),
      runWebpack(this.clientConfig.toConfig())
    ])
  }

  prepare() {
    this.renderer.rendererPrepareRequests()
    if (this.dev) {
      require('./setup-dev-server')(this)
    }
    return this
  }

  getRequestHandler() {
    const router = new Router()

    const serverInfo = `ream/${require('../package.json').version}`

    const proxyDevServer = (req, res) => {
      require('http-proxy').createProxyServer({
        target: `http://${this.devServerOptions.host}:${this.devServerOptions.port}`
      }).web(req, res)
    }

    const routes = {}

    if (this.dev) {
      routes['/__webpack_hmr'] = proxyDevServer
    }

    routes['/favicon.ico'] = (req, res) => {
      res.statucCode = 404
      res.end('404')
    }

    routes['/_ream/*'] = (req, res) => {
      if (this.dev) {
        return proxyDevServer(req, res)
      }

      req.url = req.url.replace(/^\/_ream/, '')

      serveStatic(this.resolvePath(this.output.path, 'dist-client'), !this.dev)(req, res, finalhandler(req, res))
    }

    routes['/public/*'] = (req, res) => {
      req.url = req.url.replace(/^\/public/, '')
      serveStatic(this.getCwd('public'), !this.dev)(req, res, finalhandler(req, res))
    }

    routes['*'] = this.renderer.rendererHandleRequests.bind(this.renderer)

    for (const method of ['GET', 'HEAD']) {
      for (const p of Object.keys(routes)) {
        router.add(method, p, routes[p])
      }
    }

    return (req, res) => {
      router.match(req, res, url.parse(req.url, true))
    }
  }
}