import {expect} from 'chai'
import 'co-mocha'
import {getPackageInfo} from '../src/pkg_registry.js'
import {
  nodeFactory,
  resetRegistry,
  resolveNode,
} from '../src/node_registry.js'
import csp from 'js-csp'

describe('Node registry', function() {
  this.timeout(8000)

  const getter = getPackageInfo()

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

  function flattenDependencies(depSet) {
    const ret = []
    for (let dep in depSet) {
      for (let version in depSet[dep]) {
        ret.push(depSet[dep][version])
      }
    }
    return ret
  }

  function dumbPrint(obj, updateToken = Symbol(), offset = 0) {
    if (obj.checkToken === updateToken) return
    console.log(`${' '.repeat(offset)}${obj.name}`)
    obj.checkToken = updateToken
    flattenDependencies(obj.dependencies).forEach(d => dumbPrint(d.resolvedIn, updateToken, offset+2))
  }

  it('should create empty node', function() {
    //csp.takeAsync(nodeFactory('babel-core').test(), () => done())
    // we're good if no error is thrown
    nodeFactory('babel-core')
  })

  it('should pass at least through this', function(done) {
    csp.takeAsync(nodeFactory('babel-core').test(), () => done())
  })

  it('resolve node version', function(done) {
    csp.takeAsync(csp.go(function*() {
      let node = nodeFactory('babel-core')
      yield node.resolveVersion()
      console.log(node.version)
      expect(node.version).to.not.equal(undefined)
    }), () => done())
  })

  it('resolve node and ignore it`s dependencies', function(done) {
    csp.takeAsync(csp.go(function*() {
      // should create once and then always return the same object
      let arr = []
      for (let i = 0; i < 8; i++) {
        arr.push(yield csp.peek(resolveNode('babel-core', '*', true)))
        expect(arr[0] === arr[i])
      }
    }), () => done())
  })

  it('resolve node', function(done) {
    csp.takeAsync(csp.go(function*() {
      // should create once and then always return the same object
      let arr = []
      for (let i = 0; i < 8; i++) {
        arr.push(yield csp.peek(resolveNode('babel-core', '*')))
        expect(arr[0] === arr[i])
      }
      console.log(arr[0].dependencies)
      dumbPrint(arr[0])
    }), () => done())
  })
})
