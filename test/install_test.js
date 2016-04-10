import {expect} from 'chai'
import 'co-mocha'
import {cspHttpGet} from '../src/pkg_registry.js'
import http from 'http'
import url from 'url'
import {
  nodeFactory,
  resetRegistry,
  resolveNode,
  getConflictingNodes,
} from '../src/node_registry.js'
import {cspAll, spawnWorkers, cspy, cspStat} from '../src/lib/csp_utils'
import csp from 'js-csp'
import {extractTarballDownload} from 'tarball-extract'
const rimraf = require('rimraf')

describe('Install', function() {
  this.timeout(32000)

  const installer = spawnWorkers(5)

  // TODO create _test folder, clear it if necessary
  const targetPath = './_test'

  beforeEach(() => {
    //resetRegistry()
  })

  it('should pass empty', function() {
    // TODO
  })

  it('should work with ExtractTarballDownload', function(done) {
    let tarUrl = 'https://registry.npmjs.org/slash/-/slash-1.0.0.tgz'
    //Math.random().toString(36).substring(8)
    extractTarballDownload(
      tarUrl,
      `${targetPath}/_tmp/${tarUrl.split('/').pop()}`,
      `${targetPath}/vpm_modules/slash1.0.0-wat`,
      {},
      () => done()
    )
  })

  it('should download and install single package', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield cspy(rimraf, targetPath)
      yield (yield resolveNode('lodash', '4.9.0')).downloadAndInstall(targetPath.replace(/\/+$/, ''))
      //check manually for now (TODO, use cspStat)
    }), () => done())
  })

  it('should download and install flat hierarchy', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield cspy(rimraf, targetPath)
      let allNodes = (yield resolveNode('babel-core', '*')).crawlAndFlatten()
      yield cspAll(allNodes.map(node => installer(node.downloadAndInstall.bind(null, targetPath.replace(/\/+$/, '')))))
      //check manually for now (TODO, use cspStat)
    }), () => done())
  })
})
