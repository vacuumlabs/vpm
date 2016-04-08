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

  const getter = getPackageInfo()

  beforeEach(() => {
    resetRegistry()
  })

  // copy own properties, get rid of "cannot convert symbol to string" error
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
    // we're good if no error is thrown
    nodeFactory('babel-core')
  })

  it('should peek', function(done) {
    let c = csp.chan(1)
    expect(csp.offer(c, 'foobar')).to.equal(true)
    csp.takeAsync(csp.go(function*() {
      for (let i = 0; i < 20; i++) {
        yield csp.peek(c)
      }
    }), () => done())
  })


  it('should pass at least through this', function(done) {
    csp.takeAsync(nodeFactory('babel-core').test(), () => done())
  })
/*
  it('should resolve node', function(done) {
    let node = csp.takeAsync(resolveNode('babel-core'), () => {
      let nodetwo = nodeFactory('babel-core')
      nodetwo.resolveVersion()
      console.log('WHAAAAT')
      console.log(node)
      console.log(nodetwo)
      expect(projection(node)).to.deep.equal(projection(nodetwo))
      done()
    })
  })
*/
})
