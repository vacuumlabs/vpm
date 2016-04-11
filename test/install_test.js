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
const mkdirp = require('mkdirp')

describe('Install', function() {
  this.timeout(64000)

  const targetPath = './_test/install'

  beforeEach((done) => {
    csp.takeAsync(csp.go(function*() {
      yield cspy(rimraf, targetPath)
      yield cspy(mkdirp, targetPath)
    }), () => done())
  })

  it('should download and install single package', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield (yield resolveNode('underscore', '*')).downloadAndInstall(targetPath.replace(/\/+$/, ''))
      //check manually for now (TODO, use cspStat)
    }), () => done())
  })

  it('should install', function(done) {
    csp.takeAsync(csp.go(function*() {
      yield installTreeInto(yield resolveNode('babel-core', '*'), targetPath, false)
      //check manually for now (TODO, use cspStat)
    }), () => done())
  })
})
