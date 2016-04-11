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
import {installTreeInto} from '../src/install'
import {cspAll, spawnWorkers, cspy, cspStat} from '../src/lib/csp_utils'
import csp from 'js-csp'
const rimraf = require('rimraf')

describe('Install', function() {
  this.timeout(64000)

  const targetPath = './_test'

/*
  it('should work with ExtractTarballDownload', function(done) {
    let tarUrl = 'https://registry.npmjs.org/slash/-/slash-1.0.0.tgz'
    //Math.random().toString(36).substring(8)
    extractTarballDownload(
      tarUrl,
      `${targetPath}/tmp_modules/${tarUrl.split('/').pop()}`,
      `${targetPath}/vpm_modules/slash1.0.0-wat`,
      {},
      () => done()
    )
  })
*/

  it('should download and install single package', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield cspy(rimraf, targetPath)
      yield (yield resolveNode('lodash', '4.9.0')).downloadAndInstall(targetPath.replace(/\/+$/, ''))
      //check manually for now (TODO, use cspStat)
    }), () => done())
  })

/*
  it('should download and install flat hierarchy', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield cspy(rimraf, targetPath)
      let allNodes = (yield resolveNode('babel-core', '*')).crawlAndFlatten()
      yield cspAll(allNodes.map(node => installer(node.downloadAndInstall.bind(null, targetPath.replace(/\/+$/, '')))))
      //check manually for now (TODO, use cspStat)
    }), () => done())
  })
*/

  it('should install', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield cspy(rimraf, targetPath)
      yield installTreeInto(yield resolveNode('babel-core', '*'), targetPath)
      //check manually for now (TODO, use cspStat)
    }), () => done())
  })
})
