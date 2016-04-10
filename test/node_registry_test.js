import {expect} from 'chai'
import 'co-mocha'
import {getPackageInfo} from '../src/pkg_registry.js'
import {
  nodeFactory,
  resetRegistry,
  resolveNode,
  getConflictingNodes,
} from '../src/node_registry.js'
import csp from 'js-csp'

describe('Node registry', function() {
  this.timeout(16000)

  beforeEach(() => {
    resetRegistry()
  })

  // TODO might be usefull later ? kept for now
  function projection(obj) {
    let ret = {}
    for (let key in obj) {
      if (!obj.hasOwnProperty(key) || typeof key === 'symbol') continue
      if (typeof obj[key] === Object) {
        ret[key] = projection(obj[key])
      } else {
        ret[key] = obj[key]
      }
    }
    return ret
  }

  it('should create empty node', function() {
    //csp.takeAsync(nodeFactory('babel-core').test(), () => done())
    // we're good if no error is thrown
    nodeFactory('babel-core')
  })

  it('should pass at least through this', function(done) {
    csp.takeAsync(nodeFactory('babel-core').test(), () => done())
  })

  it('should resolve node version', function(done) {
    csp.takeAsync(csp.go(function*() {
      let node = nodeFactory('babel-core')
      yield node.resolveVersion()
      console.log(node.version)
      expect(node.version).to.not.equal(undefined)
    }), () => done())
  })

  it('should resolve node and ignore it`s dependencies', function(done) {
    csp.takeAsync(csp.go(function*() {
      // should create once and then always return the same object
      let arr = []
      for (let i = 0; i < 8; i++) {
        arr.push(yield resolveNode('babel-core', '*', true))
        expect(arr[0] === arr[i])
      }
    }), () => done())
  })

  it('should resolve node', function(done) {
    csp.takeAsync(csp.go(function*() {
      (yield resolveNode('babel-core', '*')).crawlAndPrint()
    }), () => done())
  })

  it('should crawl, collect and check public successors', function(done) {
    csp.takeAsync(csp.go(function*() {
      let root = yield resolveNode('babel-core', '*')
      root.crawlAndCollectSuccessorDeps()
      root.crawlAndCheck()
      console.log(getConflictingNodes())
    }), () => done())
  })
})
